/**
 * Preferences IPC Handlers
 */
import { ipcMain } from 'electron';
import * as prefsRepo from '../repositories/preferences';
import { isValidPreferenceKey, isValidString } from '../validation';

export function registerPrefsHandlers(): void {
  ipcMain.handle('prefs:get', async (_, key: string) => {
    if (!isValidPreferenceKey(key)) {
      throw new Error('Invalid preference key');
    }
    return prefsRepo.getPreference(key);
  });

  ipcMain.handle('prefs:set', async (_, key: string, value: string) => {
    if (!isValidPreferenceKey(key)) {
      throw new Error('Invalid preference key');
    }
    if (!isValidString(value, 10000)) {
      throw new Error('Invalid preference value');
    }
    prefsRepo.setPreference(key, value);
  });

  ipcMain.handle('prefs:getAll', async () => {
    return {
      autoLaunchClaude: prefsRepo.getPreference('autoLaunchClaude') ?? 'true',
      customShellPath: prefsRepo.getPreference('customShellPath') ?? '',
      showSplash: prefsRepo.getPreference('showSplash') ?? 'true',
      splashDuration: prefsRepo.getPreference('splashDuration') ?? '2.5',
      enableNotifications: prefsRepo.getPreference('enableNotifications') ?? 'true',
      notificationSound: prefsRepo.getPreference('notificationSound') ?? 'true',
      closeToTray: prefsRepo.getPreference('closeToTray') ?? 'true',
      fontSize: prefsRepo.getPreference('fontSize') ?? '14',
      webglRenderer: prefsRepo.getPreference('webglRenderer') ?? 'true',
      soundVolume: prefsRepo.getPreference('soundVolume') ?? '70',
      soundWaitingEnabled: prefsRepo.getPreference('soundWaitingEnabled') ?? 'true',
      soundWaitingCustomPath: prefsRepo.getPreference('soundWaitingCustomPath') ?? '',
      soundErrorEnabled: prefsRepo.getPreference('soundErrorEnabled') ?? 'true',
      soundErrorCustomPath: prefsRepo.getPreference('soundErrorCustomPath') ?? '',
      soundStartEnabled: prefsRepo.getPreference('soundStartEnabled') ?? 'true',
      soundStartCustomPath: prefsRepo.getPreference('soundStartCustomPath') ?? '',
      soundCompleteEnabled: prefsRepo.getPreference('soundCompleteEnabled') ?? 'true',
      soundCompleteCustomPath: prefsRepo.getPreference('soundCompleteCustomPath') ?? '',
    };
  });
}
