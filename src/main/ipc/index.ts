/**
 * IPC Handler Registration
 *
 * This module organizes all IPC handlers into domain-specific modules
 * for better maintainability and separation of concerns.
 */
import { BrowserWindow } from 'electron';
import { registerPtyHandlers } from './pty-handlers';
import { registerDbHandlers } from './db-handlers';
import { registerPrefsHandlers } from './prefs-handlers';
import { registerDialogHandlers } from './dialog-handlers';
import { registerSharingHandlers } from './sharing-handlers';
import { registerShellHandlers } from './shell-handlers';
import { registerSoundHandlers } from './sound-handlers';
import { registerAppHandlers } from './app-handlers';

/**
 * Register all IPC handlers
 * @param getMainWindow - Function to get the main window reference
 */
export function registerAllHandlers(getMainWindow: () => BrowserWindow | null): void {
  registerPtyHandlers();
  registerDbHandlers();
  registerPrefsHandlers();
  registerDialogHandlers(getMainWindow);
  registerSharingHandlers(getMainWindow);
  registerShellHandlers();
  registerSoundHandlers(getMainWindow);
  registerAppHandlers();
}

// Re-export individual handler registrations for flexibility
export { registerPtyHandlers } from './pty-handlers';
export { registerDbHandlers } from './db-handlers';
export { registerPrefsHandlers } from './prefs-handlers';
export { registerDialogHandlers } from './dialog-handlers';
export { registerSharingHandlers } from './sharing-handlers';
export { registerShellHandlers } from './shell-handlers';
export { registerSoundHandlers } from './sound-handlers';
export { registerAppHandlers } from './app-handlers';
