import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { ptyManager } from './pty-manager';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
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
