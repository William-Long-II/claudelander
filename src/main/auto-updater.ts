import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow, dialog, app } from 'electron';
import * as log from 'electron-log';

// Configure logging
autoUpdater.logger = log;
(autoUpdater.logger as typeof log).transports.file.level = 'info';

// Disable auto-download - we'll prompt the user first
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow: BrowserWindow | null = null;

export function initAutoUpdater(window: BrowserWindow): void {
  mainWindow = window;

  // Check for updates on startup (with delay to not block app launch)
  setTimeout(() => {
    checkForUpdates();
  }, 10000); // Check 10 seconds after launch

  // Check for updates every 4 hours
  setInterval(() => {
    checkForUpdates();
  }, 4 * 60 * 60 * 1000);
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch((err) => {
    log.error('Error checking for updates:', err);
  });
}

// Update available
autoUpdater.on('update-available', (info: UpdateInfo) => {
  log.info('Update available:', info.version);

  if (!mainWindow) return;

  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Available',
    message: `A new version of ClaudeLander is available!`,
    detail: `Version ${info.version} is ready to download.\n\nWould you like to download it now?`,
    buttons: ['Download', 'Later'],
    defaultId: 0,
  }).then((result) => {
    if (result.response === 0) {
      // User clicked Download
      autoUpdater.downloadUpdate();
      mainWindow?.webContents.send('update:downloading');
    }
  });
});

// No update available
autoUpdater.on('update-not-available', () => {
  log.info('No updates available');
});

// Download progress
autoUpdater.on('download-progress', (progress) => {
  log.info(`Download progress: ${progress.percent.toFixed(1)}%`);
  mainWindow?.webContents.send('update:progress', progress.percent);
});

// Update downloaded
autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
  log.info('Update downloaded:', info.version);

  if (!mainWindow) return;

  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Ready',
    message: 'Update downloaded!',
    detail: `Version ${info.version} has been downloaded and will be installed when you quit the app.\n\nWould you like to restart now?`,
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
  }).then((result) => {
    if (result.response === 0) {
      // User clicked Restart Now
      autoUpdater.quitAndInstall(false, true);
    }
  });
});

// Error handling
autoUpdater.on('error', (err) => {
  log.error('Auto-updater error:', err);
  // Don't show error dialogs to user - updates failing silently is better UX
});
