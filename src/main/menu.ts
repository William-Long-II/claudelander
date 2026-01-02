import { Menu, shell, app, BrowserWindow } from 'electron';
import * as path from 'path';

let aboutWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

function showSettingsWindow(parentWindow: BrowserWindow): void {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 850,
    height: 700,
    parent: parentWindow,
    modal: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, '../renderer/settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  // Close on Escape key
  settingsWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      settingsWindow?.close();
    }
  });
}

function showAboutWindow(parentWindow: BrowserWindow): void {
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }

  aboutWindow = new BrowserWindow({
    width: 520,
    height: 680,
    parent: parentWindow,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const version = app.getVersion();
  aboutWindow.loadFile(path.join(__dirname, '../renderer/about.html'), {
    query: { version },
  });

  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });

  // Close on Escape key
  aboutWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      aboutWindow?.close();
    }
  });
}

export function createApplicationMenu(mainWindow: BrowserWindow): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => showSettingsWindow(mainWindow),
        },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),

    // Session menu
    {
      label: 'Session',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow.webContents.send('menu:new-session'),
        },
        {
          label: 'Close Session',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow.webContents.send('menu:close-session'),
        },
        { type: 'separator' },
        {
          label: 'Next Session',
          accelerator: 'CmdOrCtrl+Tab',
          click: () => mainWindow.webContents.send('menu:next-session'),
        },
        {
          label: 'Previous Session',
          accelerator: 'CmdOrCtrl+Shift+Tab',
          click: () => mainWindow.webContents.send('menu:prev-session'),
        },
        {
          label: 'Next Waiting',
          accelerator: 'CmdOrCtrl+Shift+W',
          click: () => mainWindow.webContents.send('menu:next-waiting'),
        },
        { type: 'separator' },
        ...(isMac ? [] : [
          {
            label: 'Settings',
            accelerator: 'CmdOrCtrl+,',
            click: () => showSettingsWindow(mainWindow),
          },
          { type: 'separator' as const },
          { role: 'quit' as const },
        ]),
      ],
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },

    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'About ClaudeLander',
          click: () => showAboutWindow(mainWindow),
        },
        { type: 'separator' },
        {
          label: 'Documentation',
          click: async () => {
            await shell.openExternal('https://github.com/William-Long-II/claudelander');
          },
        },
        {
          label: 'Report Issue',
          click: async () => {
            await shell.openExternal('https://github.com/William-Long-II/claudelander/issues');
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
