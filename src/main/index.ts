import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { ptyManager } from './pty-manager';
import { getDatabase, closeDatabase } from './database';
import * as groupsRepo from './repositories/groups';
import * as sessionsRepo from './repositories/sessions';
import { Group, Session } from '../shared/types';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // Initialize database
  getDatabase();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // PTY data forwarding
  ptyManager.on('data', ({ id, data }) => {
    mainWindow?.webContents.send('pty:data', id, data);
  });

  ptyManager.on('exit', ({ id, exitCode }) => {
    mainWindow?.webContents.send('pty:exit', id, exitCode);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('pty:create', async (_, id: string, cwd: string) => {
  ptyManager.createSession(id, cwd);
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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', () => {
  closeDatabase();
});
