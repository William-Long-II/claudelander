import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { ptyManager } from './pty-manager';
import { getDatabase, closeDatabase } from './database';
import * as groupsRepo from './repositories/groups';
import * as sessionsRepo from './repositories/sessions';
import * as prefsRepo from './repositories/preferences';
import { StateMonitor } from './state-monitor';
import { createApplicationMenu, showSettingsWindow } from './menu';
import { initAutoUpdater } from './auto-updater';
import { notificationManager } from './notification-manager';
import { trayManager } from './tray-manager';
import { Group, Session } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let stateMonitor: StateMonitor | null = null;
let isQuitting = false;

// Track sessions by state for tray updates
const sessionStates: Map<string, { name: string; state: string }> = new Map();

const SPLASH_DURATION = 2500; // 2.5 seconds

function updateTrayWithWaitingSessions(): void {
  const waitingSessions = Array.from(sessionStates.entries())
    .filter(([_, info]) => info.state === 'waiting')
    .map(([id, info]) => ({ id, name: info.name }));

  trayManager.updateWaitingSessions(waitingSessions);
}

function handleStateChange(sessionId: string, state: string, sessionName?: string): void {
  // Update our tracking map
  const existing = sessionStates.get(sessionId);
  const name = sessionName || existing?.name || sessionId;

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
    if (existing) {
      sessionStates.set(sessionId, { ...existing, state });
    } else {
      sessionStates.set(sessionId, { name, state });
    }
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

  // Initialize tray manager
  trayManager.initialize(mainWindow);
  trayManager.setShowSettingsHandler(() => {
    if (mainWindow) {
      showSettingsWindow(mainWindow);
    }
  });

  // PTY data forwarding
  ptyManager.on('data', ({ id, data }) => {
    mainWindow?.webContents.send('pty:data', id, data);
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
});

ipcMain.on('pty:write', (_, id: string, data: string) => {
  ptyManager.write(id, data);
});

ipcMain.on('pty:resize', (_, id: string, cols: number, rows: number) => {
  ptyManager.resize(id, cols, rows);
});

ipcMain.on('pty:kill', (_, id: string) => {
  ptyManager.kill(id);
});

// Database IPC Handlers - Groups
ipcMain.handle('db:groups:getAll', async () => {
  return groupsRepo.getAllGroups();
});

ipcMain.handle('db:groups:create', async (_, group: Group) => {
  groupsRepo.createGroup(group);
});

ipcMain.handle('db:groups:update', async (_, id: string, updates: Partial<Group>) => {
  groupsRepo.updateGroup(id, updates);
});

ipcMain.handle('db:groups:delete', async (_, id: string) => {
  groupsRepo.deleteGroup(id);
});

// Dialog IPC Handlers
ipcMain.handle('dialog:selectDirectory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
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
});

ipcMain.handle('db:sessions:update', async (_, id: string, updates: Partial<Session>) => {
  sessionsRepo.updateSession(id, updates);
});

ipcMain.handle('db:sessions:delete', async (_, id: string) => {
  sessionsRepo.deleteSession(id);
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
  };
  return settings;
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

app.on('before-quit', () => {
  isQuitting = true;
  trayManager.destroy();
  stateMonitor?.stop();
  closeDatabase();
});
