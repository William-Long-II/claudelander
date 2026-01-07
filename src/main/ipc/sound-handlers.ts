/**
 * Sound IPC Handlers
 */
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { soundManager, SoundEvent } from '../sound-manager';
import { isValidSoundEvent, isValidFilePath } from '../validation';

export function registerSoundHandlers(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle('sound:test', (_, event: SoundEvent, volume?: number, customPath?: string) => {
    if (!isValidSoundEvent(event)) {
      throw new Error('Invalid sound event');
    }
    if (volume !== undefined && (typeof volume !== 'number' || volume < 0 || volume > 100)) {
      throw new Error('Invalid volume');
    }
    if (customPath !== undefined && !isValidFilePath(customPath)) {
      throw new Error('Invalid custom path');
    }
    soundManager.testSound(event, volume, customPath);
  });

  ipcMain.handle('sound:selectFile', async () => {
    const mainWindow = getMainWindow();
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
}
