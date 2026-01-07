/**
 * PTY IPC Handlers
 */
import { ipcMain } from 'electron';
import { ptyManager } from '../pty-manager';
import { shareManager } from '../sharing/share-manager';
import { soundManager } from '../sound-manager';
import {
  isValidUUID,
  isValidString,
  isValidFilePath,
  isPositiveInteger,
} from '../validation';

export function registerPtyHandlers(): void {
  ipcMain.handle('pty:create', async (_, id: string, cwd: string, launchClaude: boolean = false) => {
    if (!isValidUUID(id)) {
      throw new Error('Invalid session ID');
    }
    if (!isValidFilePath(cwd)) {
      throw new Error('Invalid working directory path');
    }
    ptyManager.createSession(id, cwd, launchClaude);
    soundManager.playStartSound();
  });

  ipcMain.on('pty:write', (_, id: string, data: string) => {
    if (!isValidUUID(id) || !isValidString(data, 1000000)) return;
    ptyManager.write(id, data);
  });

  ipcMain.on('pty:resize', (_, id: string, cols: number, rows: number) => {
    if (!isValidUUID(id)) return;
    if (!isPositiveInteger(cols) || !isPositiveInteger(rows)) return;
    if (cols > 1000 || rows > 1000) return;
    ptyManager.resize(id, cols, rows);
  });

  ipcMain.on('pty:kill', (_, id: string) => {
    if (!isValidUUID(id)) return;
    shareManager.stopSharing(id).catch(() => {});
    ptyManager.kill(id);
  });
}
