/**
 * App-level IPC Handlers (updates, etc.)
 */
import { ipcMain } from 'electron';
import { checkForUpdatesManual, downloadUpdate } from '../auto-updater';

export function registerAppHandlers(): void {
  ipcMain.handle('app:check-for-update', async () => {
    return checkForUpdatesManual();
  });

  ipcMain.handle('app:download-update', async () => {
    downloadUpdate();
  });
}
