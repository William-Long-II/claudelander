import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import { getDatabase, closeDatabase } from './database';
import * as groupsRepo from './repositories/groups';
import * as sessionsRepo from './repositories/sessions';
import * as prefsRepo from './repositories/preferences';
import * as memoriesRepo from './repositories/memories';
import * as chatMessagesRepo from './repositories/chat-messages';
import * as templatesRepo from './repositories/session-templates';
import * as branchesRepo from './repositories/conversation-branches';
import * as knowledgeRepo from './repositories/knowledge';
import * as usageRepo from './repositories/usage';
import { randomUUID } from 'crypto';
import { createApplicationMenu } from './menu';
import { initAutoUpdater, checkForUpdatesManual, downloadUpdate } from './auto-updater';
import { notificationManager } from './notification-manager';
import { trayManager } from './tray-manager';
import { soundManager, SoundEvent } from './sound-manager';
import { Group, Session, MemoryCreateInput, MemoryUpdateInput, KnowledgeTier } from '../shared/types';
import { authService } from './sharing/auth';
import { shareManager } from './sharing/share-manager';
import { teamsAuthService } from './teams/teams-auth';
import { teamsNotifier } from './teams/teams-notifier';
import { registerMcpServer, registerHooks } from './mcp-config';
import log from 'electron-log';
import { getApiServer } from './api';
import { getVectorSearchManager, disposeVectorSearchManager } from './vector-search';
import { openInEditor, detectAvailableEditors, getEditorOptions, EditorType } from './editor-launcher';
import { claudeSessionManager } from './claude-session-manager';
import { resolveClaudeConfig, buildKnowledgeContext } from './claude-config-resolver';
import { extractKnowledgeCandidates } from './knowledge/extractor';
import * as permissionRulesRepo from './repositories/permission-rules';
import { inferToolPattern } from './permission-evaluator';
import { worktreeManager } from './worktree-manager';
import { detectDomains } from './knowledge/domain-tagger';
import { findPromotionCandidates, applyDecayPass } from './knowledge/promotion-engine';
import * as skillRegistry from './skill-registry';

// Global error handlers to catch uncaught exceptions and prevent silent crashes
process.on('uncaughtException', (error: Error) => {
  log.error('[Main] Uncaught exception:', error);
  log.error('[Main] Stack:', error.stack);
  // Don't exit immediately - let the error be logged
  // The process may still crash, but at least we'll have a log
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  const errorMsg = reason instanceof Error ? reason.stack || reason.message : String(reason);
  log.error('[Main] Unhandled rejection:', errorMsg);
  log.error('[Main] Promise:', promise);
});

// Use separate userData directory for development to avoid cache conflicts
if (!app.isPackaged) {
  const devUserData = path.join(app.getPath('userData'), 'dev');
  app.setPath('userData', devUserData);
}

// Set app name for Windows notifications
if (process.platform === 'win32') {
  app.setAppUserModelId('ClaudeLander');
}

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let isQuitting = false;

// Register deep link protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('claudelander', process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient('claudelander');
}

// Handle deep link on macOS
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Handle deep link on Windows/Linux (second instance)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    const url = commandLine.find((arg) => arg.startsWith('claudelander://'));
    if (url) {
      handleDeepLink(url);
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Broadcast an event to all open windows
function broadcastToAllWindows(channel: string, ...args: any[]) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(channel, ...args);
  }
}

async function handleDeepLink(url: string) {
  log.info('Received deep link:', url);
  const parsed = new URL(url);

  if (parsed.hostname === 'auth' || parsed.pathname === '/auth') {
    const token = parsed.searchParams.get('token');
    if (token) {
      try {
        const user = await authService.handleCallback(token);
        // Broadcast to all windows (main + settings)
        broadcastToAllWindows('auth:changed', { user, token });
      } catch (e) {
        log.error('Auth callback failed:', e);
        broadcastToAllWindows('auth:error', { error: (e as Error).message });
      }
    }
  }

  // Teams OAuth callback
  if (parsed.pathname === '/auth/teams' || (parsed.hostname === 'auth' && parsed.pathname.includes('teams'))) {
    const code = parsed.searchParams.get('code');
    if (code) {
      try {
        const user = await teamsAuthService.handleCallback(code);
        broadcastToAllWindows('teams:authChanged', { user, connected: true });
      } catch (e) {
        log.error('Teams auth callback failed:', e);
        broadcastToAllWindows('teams:authChanged', { error: (e as Error).message, connected: false });
      }
    }
  }
}

// Track sessions by state for tray updates
const sessionStates: Map<string, { name: string; state: string }> = new Map();

// Provide state lookup to sound manager for debounce validation
soundManager.setSessionStateLookup((sessionId: string) => {
  return sessionStates.get(sessionId)?.state;
});

const SPLASH_DURATION = 2500; // 2.5 seconds

function updateTrayWithActiveSessions(): void {
  const activeSessions = Array.from(sessionStates.entries())
    .filter(([_, info]) => info.state === 'working')
    .map(([id, info]) => ({ id, name: info.name }));

  trayManager.updateWaitingSessions(activeSessions);
}

function handleStateChange(sessionId: string, state: string, sessionName?: string): void {
  // Look up session name from database if not provided
  let name = sessionName;
  let projectPath = '';
  if (!name) {
    const existing = sessionStates.get(sessionId);
    if (existing?.name && existing.name !== sessionId) {
      name = existing.name;
    } else {
      // Look up from database
      try {
        const sessions = sessionsRepo.getAllSessions();
        const session = sessions.find(s => s.id === sessionId);
        name = session?.name || `Session`;
        projectPath = session?.workingDir || '';
      } catch {
        name = 'Session';
      }
    }
  }

  // Get previous state for sound manager
  const previousState = sessionStates.get(sessionId)?.state;

  // Update state but keep name
  const existing = sessionStates.get(sessionId);
  if (existing) {
    sessionStates.set(sessionId, { ...existing, state });
  } else {
    sessionStates.set(sessionId, { name, state });
  }

  // Play sound notification
  soundManager.handleStateChange(sessionId, state, previousState);

  // Teams notifications
  if (!projectPath) {
    try {
      const session = sessionsRepo.getAllSessions().find(s => s.id === sessionId);
      projectPath = session?.workingDir || '';
    } catch {
      // Ignore - projectPath remains empty
    }
  }

  if (state === 'error') {
    notificationManager.sendTeamsNotification(sessionId, name, projectPath, 'error');
  } else if (state === 'idle' && previousState === 'working') {
    notificationManager.sendTeamsNotification(sessionId, name, projectPath, 'complete');
  }

  // Update tray
  updateTrayWithActiveSessions();
}

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 450,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    center: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadFile(path.join(__dirname, '../renderer/splash.html'));

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createWindow(): void {
  // Initialize database
  getDatabase();

  // Register MCP server with Claude Code (auto-configure on startup)
  const mcpResult = registerMcpServer();
  if (mcpResult.success) {
    if (mcpResult.action !== 'unchanged') {
      log.info(`MCP server ${mcpResult.action}: ${mcpResult.path}`);
    }
  } else {
    log.warn('MCP server registration failed:', mcpResult.error);
  }

  // Register hooks with Claude Code (auto-configure on startup)
  const hooksResult = registerHooks();
  if (hooksResult.success) {
    if (hooksResult.action !== 'unchanged') {
      log.info(`Hooks ${hooksResult.action}`);
    }
  } else {
    log.warn('Hooks registration failed:', hooksResult.error);
  }

  // Mark all sessions as stopped on startup (PTY processes don't survive restarts)
  sessionsRepo.markAllSessionsStopped();

  // Clean up orphaned worktrees from previous crashes (3.1 Phase 2)
  try {
    const allGroups = groupsRepo.getAllGroups();
    const projectDirs = [...new Set(allGroups.map(g => g.workingDir).filter(Boolean))];
    if (projectDirs.length > 0) {
      worktreeManager.cleanupOrphaned(projectDirs);
    }
  } catch (err) {
    log.warn('[Worktree] Failed to clean orphaned worktrees:', err);
  }

  // Restore saved window bounds or use defaults
  const savedBounds = prefsRepo.getWindowBounds();
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: savedBounds?.width || 1200,
    height: savedBounds?.height || 800,
    show: false, // Don't show until splash is done
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  };

  if (savedBounds?.x !== undefined && savedBounds?.y !== undefined) {
    windowOptions.x = savedBounds.x;
    windowOptions.y = savedBounds.y;
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Maximize if it was maximized before
  if (savedBounds?.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Show main window and close splash after duration
  mainWindow.once('ready-to-show', () => {
    setTimeout(() => {
      if (splashWindow) {
        splashWindow.close();
      }
      mainWindow?.show();
    }, SPLASH_DURATION);
  });

  // Create custom application menu
  createApplicationMenu(mainWindow);

  // Initialize auto-updater (only in production)
  if (app.isPackaged) {
    initAutoUpdater(mainWindow);
  }

  // Initialize notification manager
  notificationManager.setMainWindow(mainWindow);

  // Initialize sound manager
  soundManager.setMainWindow(mainWindow);

  // Initialize tray manager
  trayManager.initialize(mainWindow);
  trayManager.setShowSettingsHandler(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('open-settings');
    }
  });

  // Initialize Teams auth service
  teamsAuthService.initialize();

  // Auto-start API server for MCP memory access
  getApiServer().start().then(({ port }) => {
    log.info(`[Main] API server auto-started on port ${port}`);
  }).catch((err) => {
    log.error('[Main] Failed to auto-start API server:', err);
  });

  // Run knowledge promotion engine periodically (every 30 min)
  const runPromotionCycle = () => {
    try {
      log.info('[Knowledge] Running promotion cycle...');
      const candidates = findPromotionCandidates();
      log.info(`[Knowledge] Found ${candidates.length} promotion candidates`);
      let promoted = 0;
      // Dedup by evidence key stored in T2 node tags
      const existingT2 = knowledgeRepo.getKnowledgeNodesByTier(2 as KnowledgeTier, 200);
      const existingEvidenceKeys = new Set(
        existingT2.flatMap(n => (n.tags || []).filter(t => t.startsWith('evidence:')))
      );

      for (const candidate of candidates) {
        const evidenceKey = `evidence:${candidate.evidence.sort().join(',')}`;
        if (existingEvidenceKeys.has(evidenceKey)) continue;

        const id = randomUUID();
        knowledgeRepo.createKnowledgeNode({
          id,
          tier: candidate.toTier,
          content: candidate.proposedContent,
          source: 'promoted',
          domains: candidate.domains,
          tags: ['auto-promoted', evidenceKey],
        });
        knowledgeRepo.logPromotion({
          id: randomUUID(),
          nodeId: id,
          fromTier: candidate.fromTier,
          toTier: candidate.toTier,
          trigger: candidate.trigger,
          evidence: candidate.evidence,
        });
        promoted++;
      }
      if (promoted > 0) {
        log.info(`[Knowledge] Promoted ${promoted} knowledge nodes (${candidates.length - promoted} skipped as duplicates)`);
      }
    } catch (error) {
      log.error('[Knowledge] Promotion cycle error:', error);
    }
  };

  // Run confidence decay separately — once per day, not every 30 min
  // applyDecayPass applies 5% flat to nodes older than 7 days
  const runDecayCycle = () => {
    try {
      const decayed = applyDecayPass();
      if (decayed > 0) {
        log.info(`[Knowledge] Applied confidence decay to ${decayed} nodes`);
      }
    } catch (error) {
      log.error('[Knowledge] Decay cycle error:', error);
    }
  };

  // Build skill registry on startup
  try {
    skillRegistry.buildRegistry();
  } catch (err) {
    log.error('[SkillRegistry] Failed to build on startup:', err);
  }

  // Promotion: startup + every 30 minutes
  setTimeout(runPromotionCycle, 10000);
  setInterval(runPromotionCycle, 30 * 60 * 1000);
  // Decay: startup + once per day (24 hours)
  setTimeout(runDecayCycle, 15000);
  setInterval(runDecayCycle, 24 * 60 * 60 * 1000);

  // Vector search event forwarding
  const vsManager = getVectorSearchManager();

  vsManager.on('indexing-progress', (progress) => {
    mainWindow?.webContents.send('vector-search:progress', progress);
  });

  vsManager.on('indexing-complete', (data) => {
    mainWindow?.webContents.send('vector-search:complete', data);
  });

  vsManager.on('indexing-error', (data) => {
    mainWindow?.webContents.send('vector-search:error', data);
  });

  // Claude session event forwarding (3.0)
  claudeSessionManager.on('event', ({ sessionId, event }: { sessionId: string; event: any }) => {
    mainWindow?.webContents.send('claude:event', sessionId, event);
  });

  claudeSessionManager.on('state-change', ({ sessionId, status }: { sessionId: string; status: any }) => {
    mainWindow?.webContents.send('claude:stateChange', sessionId, status);
    // Map 3.0 SessionState3 to legacy state for DB and notifications
    const legacyState = status.state === 'idle' ? 'idle'
      : status.state === 'error' ? 'error'
      : status.state === 'waiting_permission' ? 'waiting'
      : 'working';
    try {
      sessionsRepo.updateSession(sessionId, {
        state: legacyState,
        lastActivityAt: new Date(),
      });
    } catch (error) {
      log.error('Failed to update session state:', error);
    }
    handleStateChange(sessionId, legacyState);
  });

  claudeSessionManager.on('session-ended', ({ sessionId }: { sessionId: string }) => {
    // Persist the Claude session ID for resume across app restarts
    const claudeSessionId = claudeSessionManager.getClaudeSessionId(sessionId);
    if (claudeSessionId) {
      try {
        sessionsRepo.setClaudeSessionId(sessionId, claudeSessionId);
      } catch (error) {
        log.error('Failed to persist Claude session ID:', error);
      }
    }
    mainWindow?.webContents.send('claude:ended', sessionId);
  });

  claudeSessionManager.on('error', ({ sessionId, error }: { sessionId: string; error: string }) => {
    mainWindow?.webContents.send('claude:error', sessionId, error);
  });

  // Usage tracking (cost/token)
  claudeSessionManager.on('usage-update', ({ sessionId, usage, costUsd }: { sessionId: string; usage: any; costUsd: number }) => {
    try {
      usageRepo.addMessageUsage(sessionId, usage, costUsd);
      const sessionUsage = usageRepo.getSessionUsage(sessionId);
      if (sessionUsage) {
        mainWindow?.webContents.send('claude:usageUpdate', sessionId, sessionUsage);
      }
    } catch (error) {
      log.error('Failed to persist usage data:', error);
    }
  });

  // Permission request forwarding (3.1)
  claudeSessionManager.on('permission-request', ({ sessionId, request }: { sessionId: string; request: any }) => {
    log.info(`[Permissions] Forwarding permission request to renderer: ${request.toolName} (${request.requestId})`);
    mainWindow?.webContents.send('claude:permissionRequest', sessionId, request);
  });

  // Diff review forwarding (3.1 Phase 2 — fullAuto sandbox)
  claudeSessionManager.on('diff-review', ({ sessionId, diffData }: { sessionId: string; diffData: any }) => {
    log.info(`[Sandbox] Forwarding diff review to renderer: ${diffData.files.length} files for session ${sessionId}`);
    mainWindow?.webContents.send('claude:diffReview', sessionId, diffData);
  });

  // Permission response handler (3.1)
  ipcMain.handle('claude:respondPermission', async (_event, sessionId: string, requestId: string, decision: 'allow' | 'deny', scope: string, toolPattern?: string) => {
    log.info(`[Permissions] User responded: ${decision} (scope: ${scope}) for ${requestId}`);

    // Persist the decision if scope is not 'once'
    if (scope !== 'once' && toolPattern) {
      const session = sessionsRepo.getAllSessions().find(s => s.id === sessionId);
      try {
        permissionRulesRepo.createRule({
          id: randomUUID(),
          scope: scope as 'session' | 'group' | 'global',
          scopeId: scope === 'session' ? sessionId : scope === 'group' ? (session?.groupId || null) : null,
          toolPattern,
          decision,
          createdBy: 'user',
        });
        log.info(`[Permissions] Saved ${decision} rule: ${toolPattern} (${scope})`);
      } catch (err) {
        log.error(`[Permissions] Failed to save rule:`, err);
      }
    }

    claudeSessionManager.respondToPermission(sessionId, requestId, decision);
  });

  // Permission rules management (3.1)
  ipcMain.handle('permission:getRules', async () => {
    return permissionRulesRepo.getAllRules();
  });

  ipcMain.handle('permission:deleteRule', async (_event, id: string) => {
    permissionRulesRepo.deleteRule(id);
  });

  ipcMain.handle('permission:clearAll', async () => {
    permissionRulesRepo.clearAllRules();
  });

  // Worktree / Sandbox IPC Handlers (3.1 Phase 2)
  ipcMain.handle('sandbox:applyChanges', async (_event, sessionId: string, selectedFiles?: string[]) => {
    log.info(`[Sandbox] Applying changes for session ${sessionId}, files: ${selectedFiles?.length ?? 'all'}`);
    try {
      const result = worktreeManager.applyChanges(sessionId, selectedFiles);
      // Clean up the worktree after applying
      worktreeManager.cleanup(sessionId);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`[Sandbox] Failed to apply changes:`, err);
      throw new Error(msg);
    }
  });

  ipcMain.handle('sandbox:rejectChanges', async (_event, sessionId: string) => {
    log.info(`[Sandbox] Rejecting changes for session ${sessionId}`);
    worktreeManager.cleanup(sessionId);
    return { rejected: true };
  });

  ipcMain.handle('sandbox:isFullAuto', async (_event, sessionId: string) => {
    return claudeSessionManager.isFullAutoSession(sessionId);
  });

  ipcMain.handle('sandbox:getWorktreePath', async (_event, sessionId: string) => {
    return claudeSessionManager.getWorktreePath(sessionId);
  });

  // Usage / cost tracking
  ipcMain.handle('usage:getSession', async (_event, sessionId: string) => {
    return usageRepo.getSessionUsage(sessionId);
  });

  ipcMain.handle('usage:getAll', async () => {
    return usageRepo.getAllSessionUsage();
  });

  ipcMain.handle('usage:getTotalCost', async () => {
    return usageRepo.getTotalCost();
  });

  ipcMain.handle('usage:reset', async (_event, sessionId: string) => {
    usageRepo.resetSessionUsage(sessionId);
  });

  // Save window bounds on resize/move
  const saveWindowBounds = () => {
    if (!mainWindow) return;
    const isMaximized = mainWindow.isMaximized();
    if (!isMaximized) {
      const bounds = mainWindow.getBounds();
      prefsRepo.setWindowBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized: false,
      });
    } else {
      // Just save the maximized state, keep previous bounds
      const currentBounds = prefsRepo.getWindowBounds();
      if (currentBounds) {
        prefsRepo.setWindowBounds({ ...currentBounds, isMaximized: true });
      }
    }
  };

  mainWindow.on('resize', saveWindowBounds);
  mainWindow.on('move', saveWindowBounds);

  // Handle close-to-tray behavior
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      const closeToTray = prefsRepo.getPreference('closeToTray');
      // Default is true (close to tray)
      if (closeToTray !== 'false') {
        event.preventDefault();
        mainWindow?.hide();
        return;
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Safe IPC wrappers that catch and log errors
function safeHandle(channel: string, handler: (...args: any[]) => any): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      log.error(`[IPC] ${channel} failed:`, err);
      throw err;
    }
  });
}

function safeOn(channel: string, handler: (...args: any[]) => void): void {
  ipcMain.on(channel, (_event, ...args) => {
    try {
      handler(...args);
    } catch (err) {
      log.error(`[IPC] ${channel} failed:`, err);
    }
  });
}

// ============================================================================
// Claude Session IPC Handlers (3.0 — replaces PTY)
// ============================================================================

safeHandle('claude:start', async (sessionId: string, cwd: string, prompt: string, options?: any) => {
  log.info(`[ClaudeSession IPC] claude:start called — session=${sessionId}, cwd=${cwd}, prompt=${prompt.substring(0, 50)}`);
  const sessions = sessionsRepo.getAllSessions();
  const session = sessions.find(s => s.id === sessionId);
  const groupId = session?.groupId || undefined;
  const resolvedConfig = resolveClaudeConfig(sessionId);

  // Check for stored Claude session ID to resume across app restarts
  const storedClaudeSessionId = session?.claudeSessionId || undefined;
  if (storedClaudeSessionId) {
    log.info(`[ClaudeSession IPC] Resuming stored Claude session: ${storedClaudeSessionId}`);
  }

  // Build knowledge context to prepend to prompt
  const knowledgeContext = buildKnowledgeContext(sessionId, session?.groupId);
  const augmentedPrompt = knowledgeContext ? knowledgeContext + prompt : prompt;

  claudeSessionManager.startSession(sessionId, cwd, augmentedPrompt, {
    groupId,
    claudeConfig: resolvedConfig,
    resumeSessionId: storedClaudeSessionId,
  });

  soundManager.playStartSound();
});

safeHandle('claude:send', (sessionId: string, prompt: string) => {
  const resolvedConfig = resolveClaudeConfig(sessionId);
  const sessions = sessionsRepo.getAllSessions();
  const session = sessions.find(s => s.id === sessionId);
  const knowledgeContext = buildKnowledgeContext(sessionId, session?.groupId);
  const augmentedPrompt = knowledgeContext ? knowledgeContext + prompt : prompt;
  claudeSessionManager.sendMessage(sessionId, augmentedPrompt, resolvedConfig);
});

safeHandle('claude:kill', (sessionId: string) => {
  claudeSessionManager.killSession(sessionId);
});

safeHandle('claude:status', (sessionId: string) => {
  return claudeSessionManager.getSessionStatus(sessionId);
});

safeHandle('claude:isRunning', (sessionId: string) => {
  return claudeSessionManager.isSessionRunning(sessionId);
});

safeHandle('claude:hasSession', (sessionId: string) => {
  return claudeSessionManager.hasSession(sessionId);
});

safeHandle('claude:getResolvedConfig', (sessionId: string) => {
  return resolveClaudeConfig(sessionId);
});

// Database IPC Handlers - Groups
safeHandle('db:groups:getAll', () => {
  return groupsRepo.getAllGroups();
});

safeHandle('db:groups:create', (group: Group) => {
  groupsRepo.createGroup(group);
  getApiServer().broadcastGroupsUpdated();
});

safeHandle('db:groups:update', (id: string, updates: Partial<Group>) => {
  groupsRepo.updateGroup(id, updates);
  getApiServer().broadcastGroupsUpdated();
});

safeHandle('db:groups:delete', (id: string) => {
  groupsRepo.deleteGroup(id);
  getApiServer().broadcastGroupsUpdated();
});

// Dialog IPC Handlers
safeHandle('dialog:selectDirectory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'showHiddenFiles'],
    title: 'Select Working Directory',
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// Database IPC Handlers - Sessions
safeHandle('db:sessions:getAll', () => {
  return sessionsRepo.getAllSessions();
});

safeHandle('db:sessions:create', (session: Session) => {
  sessionsRepo.createSession(session);
  getApiServer().broadcastSessionsUpdated();
});

safeHandle('db:sessions:update', (id: string, updates: Partial<Session>) => {
  sessionsRepo.updateSession(id, updates);
  getApiServer().broadcastSessionsUpdated();
});

ipcMain.handle('db:sessions:delete', async (_, id: string) => {
  // Stop sharing if this session was being shared
  try {
    await shareManager.stopSharing(id);
  } catch {
    // Ignore errors - session may not have been shared
  }
  // Kill any running Claude session
  claudeSessionManager.removeSession(id);
  // Delete T1 knowledge nodes scoped to this session (T2/T3 are kept — they've been promoted)
  try {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM knowledge_nodes WHERE scope_session_id = ? AND tier = 1').run(id);
    if (result.changes > 0) {
      log.info(`[Knowledge] Deleted ${result.changes} T1 nodes for deleted session ${id}`);
    }
  } catch (error) {
    log.error('[Knowledge] Failed to clean up session knowledge:', error);
  }
  sessionsRepo.deleteSession(id);
  getApiServer().broadcastSessionsUpdated();
});

// Database IPC Handlers - Memories
safeHandle('db:memories:getBySession', (sessionId: string) => {
  return memoriesRepo.getMemoriesBySession(sessionId);
});

safeHandle('db:memories:getByGroup', (groupId: string) => {
  return memoriesRepo.getMemoriesByGroup(groupId);
});

safeHandle('db:memories:getPinned', (groupId?: string) => {
  return memoriesRepo.getPinnedMemories(groupId);
});

safeHandle('db:memories:search', (query: string, groupId?: string) => {
  return memoriesRepo.searchMemories(query, groupId);
});

safeHandle('db:memories:create', (input: MemoryCreateInput) => {
  return memoriesRepo.createMemory(input);
});

safeHandle('db:memories:update', (id: string, updates: MemoryUpdateInput) => {
  memoriesRepo.updateMemory(id, updates);
});

safeHandle('db:memories:delete', (id: string) => {
  memoriesRepo.deleteMemory(id);
});

safeHandle('db:memories:getForInjection', (sessionId: string, groupId: string) => {
  return memoriesRepo.getMemoriesForInjection(sessionId, groupId);
});

safeHandle('db:memories:getById', (id: string) => {
  return memoriesRepo.getMemoryById(id);
});

safeHandle('db:memories:getGlobal', () => {
  return memoriesRepo.getGlobalContextMemories();
});

// Chat Messages IPC Handlers
safeHandle('chat:getMessages', (sessionId: string, limit?: number) => {
  return chatMessagesRepo.getMessagesBySession(sessionId, limit);
});

safeHandle('chat:getMessagesByBranch', (branchId: string, limit?: number) => {
  return chatMessagesRepo.getMessagesByBranch(branchId, limit);
});

safeHandle('chat:createMessage', (input: any) => {
  return chatMessagesRepo.createChatMessage(input);
});

safeHandle('chat:searchMessages', (query: string, sessionId?: string, limit?: number) => {
  return chatMessagesRepo.searchMessages(query, sessionId, limit);
});

// Session Templates IPC Handlers
safeHandle('templates:getAll', () => {
  return templatesRepo.getAllSessionTemplates();
});

safeHandle('templates:create', (input: any) => {
  return templatesRepo.createSessionTemplate(input);
});

safeHandle('templates:delete', (id: string) => {
  return templatesRepo.deleteSessionTemplate(id);
});

// Conversation Branches IPC Handlers
safeHandle('branches:getBySession', (sessionId: string) => {
  return branchesRepo.getBranchesBySession(sessionId);
});

safeHandle('branches:create', (input: any) => {
  return branchesRepo.createBranch(input);
});

safeHandle('branches:delete', (id: string) => {
  return branchesRepo.deleteBranch(id);
});

// Knowledge Graph IPC Handlers
safeHandle('knowledge:create', (content: string, options?: { tier?: number; domains?: string[]; tags?: string[]; scopeSessionId?: string; scopeGroupId?: string }) => {
  // Auto-detect domains from content if not explicitly provided
  const domains = options?.domains ?? detectDomains(content);
  return knowledgeRepo.createKnowledgeNode({
    id: randomUUID(),
    tier: (options?.tier ?? 1) as KnowledgeTier,
    content,
    source: 'user-created',
    domains,
    tags: options?.tags ?? ['user-saved'],
    scopeSessionId: options?.scopeSessionId,
    scopeGroupId: options?.scopeGroupId,
  });
});

safeHandle('knowledge:search', (query: string, limit?: number) => {
  return knowledgeRepo.searchKnowledgeNodes(query, limit);
});

safeHandle('knowledge:getByTier', (tier: number, limit?: number) => {
  return knowledgeRepo.getKnowledgeNodesByTier(tier as KnowledgeTier, limit);
});

safeHandle('knowledge:getByDomain', (domain: string, limit?: number) => {
  return knowledgeRepo.getKnowledgeNodesByDomain(domain, limit);
});

safeHandle('knowledge:getRelated', (nodeId: string) => {
  return knowledgeRepo.getEdgesForNode(nodeId);
});

safeHandle('knowledge:getNode', (id: string) => {
  return knowledgeRepo.getKnowledgeNode(id);
});

safeHandle('knowledge:promote', (id: string, toTier: number, evidence?: string[]) => {
  const node = knowledgeRepo.getKnowledgeNode(id);
  if (!node) return null;
  knowledgeRepo.updateKnowledgeNode(id, { tier: toTier as KnowledgeTier });
  return knowledgeRepo.logPromotion({
    id: randomUUID(),
    nodeId: id,
    fromTier: node.tier,
    toTier: toTier as KnowledgeTier,
    trigger: 'manual',
    evidence: evidence || [],
  });
});

safeHandle('knowledge:pin', (id: string, pinned: boolean) => {
  knowledgeRepo.updateKnowledgeNode(id, {
    confidence: pinned ? 1.0 : 0.5,
  });
  return true;
});

safeHandle('knowledge:delete', (id: string) => {
  knowledgeRepo.deleteKnowledgeNode(id);
  return true;
});

safeHandle('knowledge:extractFromChat', (userContent: string, assistantContent: string, sessionId: string, groupId?: string) => {
  const candidates = extractKnowledgeCandidates(userContent, assistantContent);
  const created = [];
  for (const candidate of candidates) {
    const node = knowledgeRepo.createKnowledgeNode({
      id: randomUUID(),
      tier: 1 as KnowledgeTier,
      content: candidate.content,
      source: 'auto-extracted',
      confidence: candidate.confidence,
      domains: candidate.domains,
      tags: [candidate.trigger, 'auto-captured'],
      scopeSessionId: sessionId,
      scopeGroupId: groupId || null,
    });
    created.push(node);
  }
  return created;
});

// ============================================================================
// Skill System IPC Handlers
// ============================================================================

safeHandle('skill:listAll', () => {
  return skillRegistry.getRegistry();
});

safeHandle('skill:getContent', (id: string) => {
  return skillRegistry.getSkillContent(id);
});

safeHandle('skill:search', (query: string) => {
  return skillRegistry.searchSkills(query);
});

safeHandle('skill:refresh', () => {
  return skillRegistry.buildRegistry();
});

safeHandle('skill:invoke', async (sessionId: string, skillId: string, userArgs: string) => {
  const skill = skillRegistry.getSkillById(skillId);
  if (!skill) throw new Error(`Unknown skill "${skillId}". Type / to see available skills.`);

  const content = skillRegistry.getSkillContent(skillId);
  if (!content) throw new Error(`Skill file is empty or unreadable: ${skill.path}`);
  log.info(`[Skill] Invoking ${skillId} (${content.length} chars) in session ${sessionId}`);

  // Build the prompt: wrap skill content as instructions for Claude to execute
  let prompt: string;
  if (userArgs.trim()) {
    prompt = `You are now operating in "${skill.name}" mode from the ${skill.plugin} plugin. Follow the instructions below exactly.\n\n${content}\n\n---\n\nUser request: ${userArgs}`;
  } else {
    prompt = `You are now operating in "${skill.name}" mode from the ${skill.plugin} plugin. Follow the instructions below and execute them against the current project.\n\n${content}`;
  }

  // Resolve config, optionally overriding model from skill metadata
  const resolvedConfig = resolveClaudeConfig(sessionId);
  if (skill.model && !resolvedConfig.model) {
    resolvedConfig.model = skill.model;
  }

  const sessions = sessionsRepo.getAllSessions();
  const session = sessions.find(s => s.id === sessionId);

  // Build knowledge context
  const knowledgeContext = buildKnowledgeContext(sessionId, session?.groupId);
  const augmentedPrompt = knowledgeContext ? knowledgeContext + prompt : prompt;

  // Check if session exists in manager — resume or start
  const hasSession = claudeSessionManager.hasSession(sessionId);
  if (hasSession) {
    claudeSessionManager.sendMessage(sessionId, augmentedPrompt, resolvedConfig);
  } else {
    const cwd = session?.workingDir || '.';
    claudeSessionManager.startSession(sessionId, cwd, augmentedPrompt, {
      groupId: session?.groupId,
      claudeConfig: resolvedConfig,
      resumeSessionId: session?.claudeSessionId || undefined,
    });
  }

  // Persist active skill on the session
  sessionsRepo.updateSession(sessionId, { activeSkillId: skillId });

  soundManager.playStartSound();
  return { skillId, name: skill.name };
});

safeHandle('skill:clear', (sessionId: string) => {
  sessionsRepo.updateSession(sessionId, { activeSkillId: null });
});

// Preferences IPC Handlers
safeHandle('prefs:get', (key: string) => {
  return prefsRepo.getPreference(key);
});

safeHandle('prefs:set', (key: string, value: string) => {
  prefsRepo.setPreference(key, value);
});

safeHandle('prefs:getAll', () => {
  // Return all app settings as an object
  const settings = {
    autoLaunchClaude: prefsRepo.getPreference('autoLaunchClaude') ?? 'true',
    customShellPath: prefsRepo.getPreference('customShellPath') ?? '',
    showSplash: prefsRepo.getPreference('showSplash') ?? 'true',
    splashDuration: prefsRepo.getPreference('splashDuration') ?? '2.5',
    enableNotifications: prefsRepo.getPreference('enableNotifications') ?? 'true',
    notificationSound: prefsRepo.getPreference('notificationSound') ?? 'true',
    closeToTray: prefsRepo.getPreference('closeToTray') ?? 'true',
    fontSize: prefsRepo.getPreference('fontSize') ?? '14',
    webglRenderer: prefsRepo.getPreference('webglRenderer') ?? 'true',
    // Sound notification settings
    soundVolume: prefsRepo.getPreference('soundVolume') ?? '70',
    soundWaitingEnabled: prefsRepo.getPreference('soundWaitingEnabled') ?? 'true',
    soundWaitingCustomPath: prefsRepo.getPreference('soundWaitingCustomPath') ?? '',
    soundErrorEnabled: prefsRepo.getPreference('soundErrorEnabled') ?? 'true',
    soundErrorCustomPath: prefsRepo.getPreference('soundErrorCustomPath') ?? '',
    soundStartEnabled: prefsRepo.getPreference('soundStartEnabled') ?? 'true',
    soundStartCustomPath: prefsRepo.getPreference('soundStartCustomPath') ?? '',
    soundCompleteEnabled: prefsRepo.getPreference('soundCompleteEnabled') ?? 'true',
    soundCompleteCustomPath: prefsRepo.getPreference('soundCompleteCustomPath') ?? '',
    // Chat mode settings (3.0)
    sendShortcut: prefsRepo.getPreference('sendShortcut') ?? 'ctrl+enter',
    chatFontSize: prefsRepo.getPreference('chatFontSize') ?? '14',
    showThinking: prefsRepo.getPreference('showThinking') ?? 'true',
    knowledgePanelOpen: prefsRepo.getPreference('knowledgePanelOpen') ?? 'false',
  };
  return settings;
});

// Sound IPC Handlers
safeHandle('sound:test', (event: SoundEvent, volume?: number, customPath?: string) => {
  soundManager.testSound(event, volume, customPath);
});

safeHandle('sound:selectFile', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select Sound File',
    filters: [
      { name: 'Audio Files', extensions: ['wav', 'mp3', 'ogg', 'm4a'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// Auth IPC handlers
safeHandle('auth:login', () => {
  authService.startLogin();
});

safeHandle('auth:logout', () => {
  authService.logout();
  return { success: true };
});

safeHandle('auth:getUser', () => {
  return authService.currentUser;
});

safeHandle('auth:setToken', async (token: string) => {
  return authService.setToken(token);
});

// Teams IPC Handlers
safeHandle('teams:login', () => {
  teamsAuthService.startLogin();
});

safeHandle('teams:logout', () => {
  teamsAuthService.logout();
  teamsNotifier.clearCache();
  return { success: true };
});

safeHandle('teams:getStatus', () => {
  return {
    connected: teamsAuthService.isAuthenticated,
    user: teamsAuthService.currentUser,
  };
});

safeHandle('teams:testNotification', async () => {
  return teamsNotifier.sendTestNotification();
});

// App update check (for About dialog)
safeHandle('app:check-for-update', async () => {
  return checkForUpdatesManual();
});

// App update download (for About dialog)
safeHandle('app:download-update', () => {
  downloadUpdate();
});

// App restart and update (for About dialog)
safeHandle('app:restart-and-update', async () => {
  const { autoUpdater } = await import('electron-updater');
  autoUpdater.quitAndInstall(false, true);
});

// Sharing IPC handlers (host)
safeHandle('share:start', async (localSessionId: string) => {
  return shareManager.startSharing(localSessionId);
});

safeHandle('share:stop', async (localSessionId: string) => {
  return shareManager.stopSharing(localSessionId);
});

safeHandle('share:createCode', async (localSessionId: string, options: any) => {
  return shareManager.createCode(localSessionId, options);
});

safeHandle('share:revokeCode', async (code: string) => {
  return shareManager.revokeCode(code);
});

safeHandle('share:getCodes', async (localSessionId: string) => {
  return shareManager.getCodes(localSessionId);
});

safeHandle('share:isSharing', (localSessionId: string) => {
  return shareManager.isSharing(localSessionId);
});

safeHandle('share:getGuestCount', (localSessionId: string) => {
  return shareManager.getGuestCount(localSessionId);
});

// Sharing IPC handlers (guest)
safeHandle('share:join', async (code: string) => {
  const { permission, hostUsername, sessionName, relayClient } = await shareManager.joinSession(code);

  // Forward relay data to renderer
  relayClient.on('data', (data) => {
    mainWindow?.webContents.send('share:data', { code, data: data.toString() });
  });

  relayClient.on('disconnected', () => {
    mainWindow?.webContents.send('share:ended', { code });
  });

  return { code, permission, hostUsername, sessionName };
});

safeHandle('share:leave', (code: string) => {
  shareManager.leaveSession(code);
});

safeHandle('share:write', (code: string, data: string) => {
  const client = shareManager.getJoinedClient(code);
  if (client && client.canSendInput()) {
    client.send(data);
    return { success: true };
  }
  return { success: false, error: 'Cannot send input' };
});

// Open external URL
ipcMain.handle('shell:openExternal', (_, url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      log.warn('[Main] Blocked shell:openExternal for non-HTTP URL:', url);
      return;
    }
    shell.openExternal(url);
  } catch {
    log.warn('[Main] Invalid URL passed to shell:openExternal:', url);
  }
});

// ============================================================================
// Mobile API Server IPC Handlers
// ============================================================================

ipcMain.handle('api:start', async () => {
  try {
    const apiServer = getApiServer();
    if (apiServer.isRunning) {
      return {
        success: true,
        port: apiServer.port,
        addresses: apiServer.addresses,
        message: 'API server is already running',
      };
    }
    const result = await apiServer.start();
    return { success: true, port: result.port, addresses: result.addresses };
  } catch (error) {
    log.error('[ApiHandlers] Failed to start API server:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('api:stop', async () => {
  try {
    const apiServer = getApiServer();
    await apiServer.stop();
    return { success: true };
  } catch (error) {
    log.error('[ApiHandlers] Failed to stop API server:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

safeHandle('api:getStatus', () => {
  const apiServer = getApiServer();
  return apiServer.getStatus();
});

ipcMain.handle('api:generatePairingCode', async (_, options?: { canControl?: boolean; canModify?: boolean }) => {
  try {
    const apiServer = getApiServer();
    if (!apiServer.isRunning) {
      return { success: false, error: 'API server is not running. Start it first.' };
    }

    const pairingInfo = apiServer.pairingManager.generatePairingCode(options);
    const QRCode = require('qrcode');
    const { hostname, networkInterfaces } = require('os');

    const addresses = getLocalAddresses();
    const primaryAddress = addresses[0] || '127.0.0.1';

    const qrData = {
      type: 'claudelander-pair',
      host: primaryAddress,
      port: apiServer.port,
      code: pairingInfo.code,
      hostname: hostname(),
      expiresAt: pairingInfo.expiresAt,
    };

    const qrCodeDataUrl = await QRCode.toDataURL(JSON.stringify(qrData), {
      errorCorrectionLevel: 'M',
      width: 256,
      margin: 2,
    });

    return {
      success: true,
      code: pairingInfo.code,
      qrCode: qrCodeDataUrl,
      expiresAt: pairingInfo.expiresAt,
      addresses,
      port: apiServer.port,
    };
  } catch (error) {
    log.error('[ApiHandlers] Failed to generate pairing code:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

safeHandle('api:cancelPairing', () => {
  const apiServer = getApiServer();
  apiServer.pairingManager.cancelPairing();
  return { success: true };
});

safeHandle('api:getPairedDevices', () => {
  const apiServer = getApiServer();
  const devices = apiServer.pairingManager.getAllDevices();
  return devices.map(d => ({
    id: d.id,
    name: d.name,
    platform: d.platform,
    canControl: d.canControl,
    canModify: d.canModify,
    createdAt: d.createdAt.toISOString(),
    lastUsedAt: d.lastUsedAt.toISOString(),
  }));
});

ipcMain.handle('api:unpairDevice', (_, deviceId: string) => {
  try {
    const apiServer = getApiServer();
    const success = apiServer.pairingManager.unpairDevice(deviceId);
    return { success };
  } catch (error) {
    log.error('[ApiHandlers] Failed to unpair device:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('api:updateDevicePermissions', (_, deviceId: string, permissions: { canControl?: boolean; canModify?: boolean }) => {
  try {
    const apiServer = getApiServer();
    const success = apiServer.pairingManager.updateDevicePermissions(deviceId, permissions);
    return { success };
  } catch (error) {
    log.error('[ApiHandlers] Failed to update device permissions:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

safeHandle('api:hasPairingCode', () => {
  const apiServer = getApiServer();
  return { active: apiServer.pairingManager.hasActivePairingCode() };
});

// Remote access IPC handlers
ipcMain.handle('api:enableRemoteAccess', async () => {
  try {
    const apiServer = getApiServer();
    await apiServer.enableRemoteAccess();
    return { success: true, status: apiServer.getRemoteAccessStatus() };
  } catch (error) {
    log.error('Failed to enable remote access:', error);
    return { success: false, error: (error as Error).message };
  }
});

ipcMain.handle('api:disableRemoteAccess', () => {
  try {
    const apiServer = getApiServer();
    apiServer.disableRemoteAccess();
    return { success: true };
  } catch (error) {
    log.error('Failed to disable remote access:', error);
    return { success: false, error: (error as Error).message };
  }
});

safeHandle('api:getRemoteAccessStatus', () => {
  const apiServer = getApiServer();
  return apiServer.getRemoteAccessStatus();
});

// ============================================================================
// Vector Search IPC Handlers
// ============================================================================

safeHandle('vector-search:get-index-status', (directoryPath: string) => {
  return getVectorSearchManager().getIndexStatus(directoryPath);
});

safeHandle('vector-search:get-all-indexes', () => {
  return getVectorSearchManager().getAllIndexes();
});

ipcMain.handle('vector-search:start-indexing', async (_, directoryPath: string) => {
  try {
    log.info('[VectorSearch] Starting indexing for:', directoryPath);
    await getVectorSearchManager().startIndexing(directoryPath);
    return { success: true };
  } catch (error) {
    log.error('[VectorSearch] Failed to start indexing:', error);
    return { success: false, error: (error as Error).message };
  }
});

safeHandle('vector-search:search-code', async (directoryPath: string, query: string, limit?: number) => {
  return getVectorSearchManager().searchCode(directoryPath, query, limit);
});

safeHandle('vector-search:search-symbols', (directoryPath: string, name: string, symbolType?: string, limit?: number) => {
  return getVectorSearchManager().searchSymbols(directoryPath, name, symbolType as any, limit);
});

safeHandle('vector-search:cancel-indexing', (indexId: string) => {
  getVectorSearchManager().cancelIndexing(indexId);
  return { success: true };
});

safeHandle('vector-search:delete-index', (directoryPath: string) => {
  getVectorSearchManager().deleteIndex(directoryPath);
  return { success: true };
});

ipcMain.handle('vector-search:retry-indexing', async (_, directoryPath: string) => {
  try {
    await getVectorSearchManager().retryIndexing(directoryPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});

// ============================================================================
// Editor Integration IPC Handlers
// ============================================================================

safeHandle('editor:open', async (filePath: string, line?: number, column?: number) => {
  const preferredEditor = prefsRepo.getPreference('preferredEditor') as EditorType | null;
  return openInEditor(filePath, line ?? 1, column ?? 1, preferredEditor ?? undefined);
});

safeHandle('editor:detectAvailable', async () => {
  return detectAvailableEditors();
});

safeHandle('editor:getOptions', () => {
  return getEditorOptions();
});

function getLocalAddresses(): string[] {
  const { networkInterfaces } = require('os');
  const addresses: string[] = [];
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (!nets) continue;
    for (const net of nets) {
      if (net.internal) continue;
      if (net.family === 'IPv4') {
        addresses.push(net.address);
      }
    }
  }
  // Prioritize 192.168.x.x (typical LAN) over 172.x.x (often Docker/WSL/Hyper-V) and 10.x.x
  return addresses.sort((a, b) => {
    const score = (ip: string) => {
      if (ip.startsWith('192.168.')) return 0;
      if (ip.startsWith('10.')) return 1;
      if (ip.startsWith('172.')) return 2;
      return 3;
    };
    return score(a) - score(b);
  });
}

// Forward share manager events to renderer
shareManager.on('guestJoined', (info) => {
  mainWindow?.webContents.send('share:guestJoined', info);
});

shareManager.on('guestLeft', (info) => {
  mainWindow?.webContents.send('share:guestLeft', info);
});

app.whenReady().then(() => {
  createSplashWindow();
  createWindow();
}).catch((error) => {
  log.error('[Main] Failed to initialize app:', error);
});

// Handle render process crashes (if any child window crashes)
app.on('render-process-gone', (event, webContents, details) => {
  log.error('[Main] Render process gone:', details.reason, details.exitCode);
});

// Handle child process crashes
app.on('child-process-gone', (event, details) => {
  log.error('[Main] Child process gone:', details.type, details.reason, details.exitCode);
});

app.on('window-all-closed', () => {
  // On macOS, apps typically stay open until explicitly quit
  // For other platforms, only quit if not using close-to-tray
  if (process.platform !== 'darwin') {
    const closeToTray = prefsRepo.getPreference('closeToTray');
    if (closeToTray === 'false') {
      app.quit();
    }
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

let cleanupComplete = false;

app.on('before-quit', (event) => {
  if (cleanupComplete) return;

  event.preventDefault();
  isQuitting = true;

  (async () => {
    try {
      await shareManager.stopAllSharing();
    } catch (e) {
      log.error('Error stopping shares on quit:', e);
    }

    try {
      await claudeSessionManager.killAll();
    } catch (e) {
      log.error('Error killing Claude sessions on quit:', e);
    }

    disposeVectorSearchManager();
    trayManager.destroy();
    closeDatabase();

    cleanupComplete = true;
    app.quit();
  })();
});
