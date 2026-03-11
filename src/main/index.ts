import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import { ptyManager } from './pty-manager';
import { getDatabase, closeDatabase } from './database';
import * as groupsRepo from './repositories/groups';
import * as sessionsRepo from './repositories/sessions';
import * as prefsRepo from './repositories/preferences';
import * as memoriesRepo from './repositories/memories';
import { StateMonitor } from './state-monitor';
import { createApplicationMenu } from './menu';
import { initAutoUpdater, checkForUpdatesManual, downloadUpdate } from './auto-updater';
import { notificationManager } from './notification-manager';
import { trayManager } from './tray-manager';
import { soundManager, SoundEvent } from './sound-manager';
import { Group, Session, MemoryCreateInput, MemoryUpdateInput } from '../shared/types';
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
let stateMonitor: StateMonitor | null = null;
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

function updateTrayWithWaitingSessions(): void {
  const waitingSessions = Array.from(sessionStates.entries())
    .filter(([_, info]) => info.state === 'waiting')
    .map(([id, info]) => ({ id, name: info.name }));

  trayManager.updateWaitingSessions(waitingSessions);
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

  if (state === 'waiting') {
    sessionStates.set(sessionId, { name, state });

    // Show notification
    notificationManager.showWaitingNotification({
      sessionId,
      sessionName: name,
      message: 'Waiting for input',
    });
  } else {
    // Update state but keep name
    const existing = sessionStates.get(sessionId);
    if (existing) {
      sessionStates.set(sessionId, { ...existing, state });
    } else {
      sessionStates.set(sessionId, { name, state });
    }
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

  if (state === 'waiting') {
    notificationManager.sendTeamsNotification(sessionId, name, projectPath, 'waiting');
  } else if (state === 'error') {
    notificationManager.sendTeamsNotification(sessionId, name, projectPath, 'error');
  } else if (state === 'idle' && previousState === 'working') {
    notificationManager.sendTeamsNotification(sessionId, name, projectPath, 'complete');
  }

  // Update tray
  updateTrayWithWaitingSessions();
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

  // Start state monitor
  stateMonitor = new StateMonitor(ptyManager.getSocketPath());
  stateMonitor.start();

  stateMonitor.on('stateChange', (event) => {
    mainWindow?.webContents.send('state:change', event);
    // Update database with error handling
    try {
      sessionsRepo.updateSession(event.sessionId, {
        state: event.state,
        lastActivityAt: new Date(),
      });
    } catch (error) {
      console.error('Failed to update session state in database:', error);
    }
    // Handle notifications and tray updates
    handleStateChange(event.sessionId, event.state);
  });

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

  // PTY data forwarding
  ptyManager.on('data', ({ id, data }) => {
    mainWindow?.webContents.send('pty:data', id, data);
    // Broadcast to mobile clients
    getApiServer().broadcastTerminalData(id, data);
  });

  ptyManager.on('exit', ({ id, exitCode }) => {
    mainWindow?.webContents.send('pty:exit', id, exitCode);
  });

  // PTY state detection forwarding
  ptyManager.on('stateChange', (event) => {
    mainWindow?.webContents.send('state:change', event);
    // Update database
    try {
      sessionsRepo.updateSession(event.sessionId, {
        state: event.state,
        lastActivityAt: new Date(),
      });
    } catch (error) {
      console.error('Failed to update session state in database:', error);
    }
    // Handle notifications and tray updates
    handleStateChange(event.sessionId, event.state);
    // Broadcast to mobile clients
    getApiServer().broadcastSessionState(event.sessionId, event.state, event.event);
  });

  // Claude session event forwarding (3.0)
  claudeSessionManager.on('event', ({ sessionId, event }: { sessionId: string; event: any }) => {
    mainWindow?.webContents.send('claude:event', sessionId, event);
  });

  claudeSessionManager.on('state-change', ({ sessionId, status }: { sessionId: string; status: any }) => {
    mainWindow?.webContents.send('claude:stateChange', sessionId, status);
    try {
      sessionsRepo.updateSession(sessionId, {
        state: status.state === 'idle' ? 'idle' : status.state === 'error' ? 'error' : 'working',
        lastActivityAt: new Date(),
      });
    } catch (error) {
      log.error('Failed to update session state:', error);
    }
    handleStateChange(sessionId, status.state === 'idle' ? 'idle' : status.state === 'error' ? 'error' : 'working');
  });

  claudeSessionManager.on('session-ended', ({ sessionId }: { sessionId: string }) => {
    mainWindow?.webContents.send('claude:ended', sessionId);
  });

  claudeSessionManager.on('error', ({ sessionId, error }: { sessionId: string; error: string }) => {
    mainWindow?.webContents.send('claude:error', sessionId, error);
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

// IPC Handlers
ipcMain.handle('pty:create', async (_, id: string, cwd: string, launchClaude: boolean = false) => {
  try {
    // Look up the session to get its groupId for memory injection
    const sessions = sessionsRepo.getAllSessions();
    const session = sessions.find(s => s.id === id);
    const groupId = session?.groupId || null;

    ptyManager.createSession(id, cwd, launchClaude, groupId);
    // Play session start sound
    soundManager.playStartSound();
  } catch (error) {
    log.error('[Main] Failed to create PTY session:', error);
    throw error; // Re-throw so renderer knows it failed
  }
});

safeOn('pty:write', (id: string, data: string) => {
  ptyManager.write(id, data);
});

safeOn('pty:resize', (id: string, cols: number, rows: number) => {
  ptyManager.resize(id, cols, rows);
});

safeOn('pty:kill', (id: string) => {
  // Stop sharing if this session was being shared
  shareManager.stopSharing(id).catch(() => {
    // Ignore errors - session may not have been shared
  });
  ptyManager.kill(id);
});

// ============================================================================
// Claude Session IPC Handlers (3.0 — replaces PTY)
// ============================================================================

safeHandle('claude:start', async (sessionId: string, cwd: string, prompt: string, options?: any) => {
  const sessions = sessionsRepo.getAllSessions();
  const session = sessions.find(s => s.id === sessionId);
  const groupId = session?.groupId || null;

  claudeSessionManager.startSession(sessionId, cwd, prompt, {
    groupId,
    ...options,
  });

  soundManager.playStartSound();
});

safeHandle('claude:send', (sessionId: string, prompt: string) => {
  claudeSessionManager.sendMessage(sessionId, prompt);
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
      await ptyManager.killAll();
    } catch (e) {
      log.error('Error killing PTYs on quit:', e);
    }

    try {
      await claudeSessionManager.killAll();
    } catch (e) {
      log.error('Error killing Claude sessions on quit:', e);
    }

    disposeVectorSearchManager();
    trayManager.destroy();
    stateMonitor?.stop();
    closeDatabase();

    cleanupComplete = true;
    app.quit();
  })();
});
