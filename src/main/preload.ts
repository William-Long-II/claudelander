import { contextBridge, ipcRenderer } from 'electron';
import * as os from 'os';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  homedir: os.homedir(),

  // PTY operations
  createSession: (id: string, cwd: string) =>
    ipcRenderer.invoke('pty:create', id, cwd),
  writeToSession: (id: string, data: string) =>
    ipcRenderer.send('pty:write', id, data),
  resizeSession: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('pty:resize', id, cols, rows),
  killSession: (id: string) =>
    ipcRenderer.send('pty:kill', id),

  // PTY events
  onPtyData: (callback: (id: string, data: string) => void) => {
    ipcRenderer.on('pty:data', (_, id, data) => callback(id, data));
  },
  onPtyExit: (callback: (id: string, exitCode: number) => void) => {
    ipcRenderer.on('pty:exit', (_, id, exitCode) => callback(id, exitCode));
  },
});
