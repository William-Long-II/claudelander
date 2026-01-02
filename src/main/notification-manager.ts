import { Notification, BrowserWindow, app } from 'electron';
import * as path from 'path';
import { getPreference } from './repositories/preferences';

interface NotificationOptions {
  sessionId: string;
  sessionName: string;
  message?: string;
}

class NotificationManager {
  private mainWindow: BrowserWindow | null = null;
  private onSessionSelect: ((sessionId: string) => void) | null = null;

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  setSessionSelectHandler(handler: (sessionId: string) => void): void {
    this.onSessionSelect = handler;
  }

  isEnabled(): boolean {
    const pref = getPreference('enableNotifications');
    return pref !== 'false'; // Default to true
  }

  isSoundEnabled(): boolean {
    const pref = getPreference('notificationSound');
    return pref !== 'false'; // Default to true
  }

  shouldNotify(): boolean {
    // Only notify if enabled and window is not focused
    if (!this.isEnabled()) {
      return false;
    }

    if (!this.mainWindow) {
      return true; // No window means definitely notify
    }

    // Don't notify if window is focused
    return !this.mainWindow.isFocused();
  }

  showWaitingNotification(options: NotificationOptions): void {
    if (!this.shouldNotify()) {
      return;
    }

    if (!Notification.isSupported()) {
      console.warn('Notifications not supported on this platform');
      return;
    }

    const notification = new Notification({
      title: options.sessionName || 'Session',
      body: options.message || 'Waiting for input',
      icon: this.getIconPath(),
      silent: !this.isSoundEnabled(),
    });

    notification.on('click', () => {
      this.handleNotificationClick(options.sessionId);
    });

    notification.show();
  }

  private handleNotificationClick(sessionId: string): void {
    // Show and focus the main window
    if (this.mainWindow) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.show();
      this.mainWindow.focus();

      // Tell renderer to switch to this session
      this.mainWindow.webContents.send('session:select', sessionId);
    }

    // Call the handler if set
    if (this.onSessionSelect) {
      this.onSessionSelect(sessionId);
    }
  }

  private getIconPath(): string | undefined {
    // In production, use the app icon
    if (app.isPackaged) {
      // On macOS, the icon is in Resources
      if (process.platform === 'darwin') {
        return path.join(process.resourcesPath, 'icon.icns');
      }
      // On Windows/Linux
      return path.join(process.resourcesPath, 'icon.png');
    }

    // In development, use the build icon
    return path.join(__dirname, '../../build/icon.png');
  }
}

export const notificationManager = new NotificationManager();
