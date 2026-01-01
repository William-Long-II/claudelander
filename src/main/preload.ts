import { contextBridge, ipcRenderer } from 'electron';
import * as os from 'os';
import { Group, Session } from '../shared/types';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  homedir: os.homedir(),

  // PTY operations
  createSession: (id: string, cwd: string, launchClaude: boolean = false) =>
    ipcRenderer.invoke('pty:create', id, cwd, launchClaude),
  writeToSession: (id: string, data: string) =>
    ipcRenderer.send('pty:write', id, data),
  resizeSession: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('pty:resize', id, cols, rows),
  killSession: (id: string) =>
    ipcRenderer.send('pty:kill', id),

  // PTY events
  onPtyData: (callback: (id: string, data: string) => void) => {
    const listener = (_: Electron.IpcRendererEvent, id: string, data: string) => callback(id, data);
    ipcRenderer.on('pty:data', listener);
    return () => {
      ipcRenderer.removeListener('pty:data', listener);
    };
  },
  onPtyExit: (callback: (id: string, exitCode: number) => void) => {
    const listener = (_: Electron.IpcRendererEvent, id: string, exitCode: number) => callback(id, exitCode);
    ipcRenderer.on('pty:exit', listener);
    return () => {
      ipcRenderer.removeListener('pty:exit', listener);
    };
  },
  onStateChange: (callback: (event: { sessionId: string; state: string; event: string; timestamp: number }) => void) => {
    const listener = (_: Electron.IpcRendererEvent, event: any) => callback(event);
    ipcRenderer.on('state:change', listener);
    return () => {
      ipcRenderer.removeListener('state:change', listener);
    };
  },

  // Database - Groups
  getAllGroups: (): Promise<Group[]> =>
    ipcRenderer.invoke('db:groups:getAll'),
  createGroup: (group: Group): Promise<void> =>
    ipcRenderer.invoke('db:groups:create', group),
  updateGroup: (id: string, updates: Partial<Group>): Promise<void> =>
    ipcRenderer.invoke('db:groups:update', id, updates),
  deleteGroup: (id: string): Promise<void> =>
    ipcRenderer.invoke('db:groups:delete', id),

  // Database - Sessions
  getAllSessions: (): Promise<Session[]> =>
    ipcRenderer.invoke('db:sessions:getAll'),
  createDbSession: (session: Session): Promise<void> =>
    ipcRenderer.invoke('db:sessions:create', session),
  updateDbSession: (id: string, updates: Partial<Session>): Promise<void> =>
    ipcRenderer.invoke('db:sessions:update', id, updates),
  deleteDbSession: (id: string): Promise<void> =>
    ipcRenderer.invoke('db:sessions:delete', id),
});
