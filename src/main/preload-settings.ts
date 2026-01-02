import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('settingsAPI', {
  getPreference: (key: string): Promise<string | null> =>
    ipcRenderer.invoke('prefs:get', key),

  setPreference: (key: string, value: string): Promise<void> =>
    ipcRenderer.invoke('prefs:set', key, value),

  getAllSettings: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke('prefs:getAll'),

  // Expose platform for shell path suggestions
  platform: process.platform,
});
