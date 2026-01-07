/**
 * Dialog IPC Handlers
 */
import { ipcMain, dialog, BrowserWindow } from 'electron';

export function registerDialogHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('dialog:selectDirectory', async () => {
    const mainWindow = getMainWindow();
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
}
