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
import log from 'electron-log';
import { getApiServer } from './api';
import { orchestrationManager } from './orchestration/orchestration-manager';
import { memoryManager } from './memory/memory-manager';

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

  // Initialize orchestration manager
  orchestrationManager.setMainWindow(mainWindow);
  orchestrationManager.initialize();

  // Initialize memory manager
  memoryManager.initialize();

  // Initialize tray manager
  trayManager.initialize(mainWindow);
  trayManager.setShowSettingsHandler(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('open-settings');
    }
  });

  // Initialize Teams auth service
  teamsAuthService.initialize();

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

  // PTY memory extraction forwarding
  ptyManager.on('memoryExtracted', async ({ sessionId, memory }) => {
    try {
      // Look up session to get groupId
      const sessions = sessionsRepo.getAllSessions();
      const session = sessions.find(s => s.id === sessionId);
      if (!session) return;

      // Create the memory in database
      const savedMemory = memoriesRepo.createMemory({
        id: crypto.randomUUID(),
        sessionId,
        groupId: session.groupId,
        type: memory.type,
        content: memory.content,
        source: 'auto',
        tags: [],
        pinned: false,
      });

      // Notify renderer
      mainWindow?.webContents.send('memory:extracted', savedMemory);
    } catch (error) {
      console.error('Failed to save extracted memory:', error);
    }
  });

  // State monitor memory events (from Claude hooks)
  stateMonitor.on('memoryEvent', async (event: any) => {
    try {
      // Look up session to get groupId
      const sessions = sessionsRepo.getAllSessions();
      const session = sessions.find(s => s.id === event.sessionId);
      if (!session) return;

      // Create the memory in database
      const savedMemory = memoriesRepo.createMemory({
        id: crypto.randomUUID(),
        sessionId: event.sessionId,
        groupId: session.groupId,
        type: event.memory.type,
        content: event.memory.content,
        source: 'claude',
        tags: [],
        pinned: false,
      });

      // Notify renderer
      mainWindow?.webContents.send('memory:extracted', savedMemory);
    } catch (error) {
      console.error('Failed to save memory from Claude hook:', error);
    }
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

// IPC Handlers
ipcMain.handle('pty:create', async (_, id: string, cwd: string, launchClaude: boolean = false) => {
  ptyManager.createSession(id, cwd, launchClaude);
  // Play session start sound
  soundManager.playStartSound();
});

ipcMain.on('pty:write', (_, id: string, data: string) => {
  ptyManager.write(id, data);
});

ipcMain.on('pty:resize', (_, id: string, cols: number, rows: number) => {
  ptyManager.resize(id, cols, rows);
});

ipcMain.on('pty:kill', (_, id: string) => {
  // Stop sharing if this session was being shared
  shareManager.stopSharing(id).catch(() => {
    // Ignore errors - session may not have been shared
  });
  ptyManager.kill(id);
});

// Database IPC Handlers - Groups
ipcMain.handle('db:groups:getAll', async () => {
  return groupsRepo.getAllGroups();
});

ipcMain.handle('db:groups:create', async (_, group: Group) => {
  groupsRepo.createGroup(group);
  getApiServer().broadcastGroupsUpdated();
});

ipcMain.handle('db:groups:update', async (_, id: string, updates: Partial<Group>) => {
  groupsRepo.updateGroup(id, updates);
  getApiServer().broadcastGroupsUpdated();
});

ipcMain.handle('db:groups:delete', async (_, id: string) => {
  groupsRepo.deleteGroup(id);
  getApiServer().broadcastGroupsUpdated();
});

// Dialog IPC Handlers
ipcMain.handle('dialog:selectDirectory', async () => {
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
ipcMain.handle('db:sessions:getAll', async () => {
  return sessionsRepo.getAllSessions();
});

ipcMain.handle('db:sessions:create', async (_, session: Session) => {
  sessionsRepo.createSession(session);
  getApiServer().broadcastSessionsUpdated();
});

ipcMain.handle('db:sessions:update', async (_, id: string, updates: Partial<Session>) => {
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
ipcMain.handle('db:memories:getBySession', async (_, sessionId: string) => {
  return memoriesRepo.getMemoriesBySession(sessionId);
});

ipcMain.handle('db:memories:getByGroup', async (_, groupId: string) => {
  return memoriesRepo.getMemoriesByGroup(groupId);
});

ipcMain.handle('db:memories:getPinned', async (_, groupId?: string) => {
  return memoriesRepo.getPinnedMemories(groupId);
});

ipcMain.handle('db:memories:search', async (_, query: string, groupId?: string) => {
  return memoriesRepo.searchMemories(query, groupId);
});

ipcMain.handle('db:memories:create', async (_, memory: MemoryCreateInput) => {
  // Check for duplicates within time window
  const existing = memoriesRepo.findSimilarMemory(memory.content, memory.groupId);
  if (existing) {
    return existing; // Return existing instead of creating duplicate
  }
  return memoriesRepo.createMemory({
    ...memory,
    tags: memory.tags || [],
    pinned: memory.pinned || false,
  });
});

ipcMain.handle('db:memories:update', async (_, id: string, updates: MemoryUpdateInput) => {
  memoriesRepo.updateMemory(id, updates);
});

ipcMain.handle('db:memories:delete', async (_, id: string) => {
  memoriesRepo.deleteMemory(id);
});

ipcMain.handle('db:memories:getForInjection', async (_, sessionId: string, groupId: string) => {
  return memoriesRepo.getMemoriesForInjection(sessionId, groupId);
});

ipcMain.handle('db:memories:getById', async (_, id: string) => {
  return memoriesRepo.getMemoryById(id);
});

// Preferences IPC Handlers
ipcMain.handle('prefs:get', async (_, key: string) => {
  return prefsRepo.getPreference(key);
});

ipcMain.handle('prefs:set', async (_, key: string, value: string) => {
  prefsRepo.setPreference(key, value);
});

ipcMain.handle('prefs:getAll', async () => {
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
ipcMain.handle('sound:test', (_, event: SoundEvent, volume?: number, customPath?: string) => {
  soundManager.testSound(event, volume, customPath);
});

ipcMain.handle('sound:selectFile', async () => {
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
ipcMain.handle('auth:login', () => {
  authService.startLogin();
});

ipcMain.handle('auth:logout', () => {
  authService.logout();
  return { success: true };
});

ipcMain.handle('auth:getUser', () => {
  return authService.currentUser;
});

ipcMain.handle('auth:setToken', async (_, token: string) => {
  return authService.setToken(token);
});

// Teams IPC Handlers
ipcMain.handle('teams:login', () => {
  teamsAuthService.startLogin();
});

ipcMain.handle('teams:logout', () => {
  teamsAuthService.logout();
  teamsNotifier.clearCache();
  return { success: true };
});

ipcMain.handle('teams:getStatus', () => {
  return {
    connected: teamsAuthService.isAuthenticated,
    user: teamsAuthService.currentUser,
  };
});

ipcMain.handle('teams:testNotification', async () => {
  return teamsNotifier.sendTestNotification();
});

// App update check (for About dialog)
ipcMain.handle('app:check-for-update', async () => {
  return checkForUpdatesManual();
});

// App update download (for About dialog)
ipcMain.handle('app:download-update', async () => {
  downloadUpdate();
});

// Sharing IPC handlers (host)
ipcMain.handle('share:start', async (_, localSessionId: string) => {
  return shareManager.startSharing(localSessionId);
});

ipcMain.handle('share:stop', async (_, localSessionId: string) => {
  return shareManager.stopSharing(localSessionId);
});

ipcMain.handle('share:createCode', async (_, localSessionId: string, options: any) => {
  return shareManager.createCode(localSessionId, options);
});

ipcMain.handle('share:revokeCode', async (_, code: string) => {
  return shareManager.revokeCode(code);
});

ipcMain.handle('share:getCodes', async (_, localSessionId: string) => {
  return shareManager.getCodes(localSessionId);
});

ipcMain.handle('share:isSharing', (_, localSessionId: string) => {
  return shareManager.isSharing(localSessionId);
});

ipcMain.handle('share:getGuestCount', (_, localSessionId: string) => {
  return shareManager.getGuestCount(localSessionId);
});

// Sharing IPC handlers (guest)
ipcMain.handle('share:join', async (_, code: string) => {
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

ipcMain.handle('share:leave', (_, code: string) => {
  shareManager.leaveSession(code);
});

ipcMain.handle('share:write', (_, code: string, data: string) => {
  const client = shareManager.getJoinedClient(code);
  if (client && client.canSendInput()) {
    client.send(data);
    return { success: true };
  }
  return { success: false, error: 'Cannot send input' };
});

// Open external URL
ipcMain.handle('shell:openExternal', (_, url: string) => {
  shell.openExternal(url);
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

ipcMain.handle('api:getStatus', () => {
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

ipcMain.handle('api:cancelPairing', () => {
  const apiServer = getApiServer();
  apiServer.pairingManager.cancelPairing();
  return { success: true };
});

ipcMain.handle('api:getPairedDevices', () => {
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

ipcMain.handle('api:hasPairingCode', () => {
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

ipcMain.handle('api:getRemoteAccessStatus', () => {
  const apiServer = getApiServer();
  return apiServer.getRemoteAccessStatus();
});

// Git Worktree handlers
import { worktreeManager } from './worktree/worktree-manager';

ipcMain.handle('worktree:list', async (_event, repoPath: string) => {
  return worktreeManager.listWorktrees(repoPath);
});

ipcMain.handle('worktree:create', async (_event, options: {
  basePath: string;
  branch: string;
  createBranch: boolean;
  baseBranch?: string;
  worktreePath?: string;
}) => {
  return worktreeManager.createWorktree(options);
});

ipcMain.handle('worktree:remove', async (_event, repoPath: string, worktreePath: string, force: boolean = false) => {
  return worktreeManager.removeWorktree(repoPath, worktreePath, force);
});

ipcMain.handle('worktree:prune', async (_event, repoPath: string) => {
  return worktreeManager.pruneWorktrees(repoPath);
});

ipcMain.handle('worktree:lock', async (_event, repoPath: string, worktreePath: string, reason?: string) => {
  return worktreeManager.lockWorktree(repoPath, worktreePath, reason);
});

ipcMain.handle('worktree:unlock', async (_event, repoPath: string, worktreePath: string) => {
  return worktreeManager.unlockWorktree(repoPath, worktreePath);
});

ipcMain.handle('worktree:branches', async (_event, repoPath: string) => {
  return worktreeManager.listBranches(repoPath);
});

ipcMain.handle('worktree:isGitRepo', async (_event, dirPath: string) => {
  return worktreeManager.isGitRepo(dirPath);
});

ipcMain.handle('worktree:getRepoRoot', async (_event, dirPath: string) => {
  return worktreeManager.getRepoRoot(dirPath);
});

ipcMain.handle('worktree:currentBranch', async (_event, repoPath: string) => {
  return worktreeManager.getCurrentBranch(repoPath);
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

app.on('before-quit', async () => {
  isQuitting = true;

  // Stop all active shares before quitting
  try {
    await shareManager.stopAllSharing();
  } catch (e) {
    log.error('Error stopping shares on quit:', e);
  }

  trayManager.destroy();
  stateMonitor?.stop();
  orchestrationManager.destroy();
  closeDatabase();
});
