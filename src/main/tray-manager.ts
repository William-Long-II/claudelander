import { Tray, Menu, nativeImage, app, BrowserWindow, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';

interface WaitingSession {
  id: string;
  name: string;
}

class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private waitingSessions: WaitingSession[] = [];
  private onSessionSelect: ((sessionId: string) => void) | null = null;
  private onShowSettings: (() => void) | null = null;
  private baseIconPath: string = '';

  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    this.baseIconPath = this.getIconPath();

    // Create the tray icon
    const icon = nativeImage.createFromPath(this.baseIconPath);
    // Resize for tray (16x16 on most platforms, 22x22 on some Linux)
    const trayIcon = icon.resize({ width: 16, height: 16 });

    this.tray = new Tray(trayIcon);
    this.tray.setToolTip('ClaudeLander');

    // Single click shows/hides window
    this.tray.on('click', () => {
      this.toggleWindow();
    });

    // Build initial menu
    this.updateMenu();
  }

  setSessionSelectHandler(handler: (sessionId: string) => void): void {
    this.onSessionSelect = handler;
  }

  setShowSettingsHandler(handler: () => void): void {
    this.onShowSettings = handler;
  }

  updateWaitingSessions(sessions: WaitingSession[]): void {
    this.waitingSessions = sessions.slice(0, 5); // Limit to 5
    this.updateMenu();
    this.updateBadge();
  }

  private updateMenu(): void {
    if (!this.tray) return;

    const menuItems: MenuItemConstructorOptions[] = [
      {
        label: 'ClaudeLander',
        enabled: false, // Header, non-clickable
      },
      { type: 'separator' },
    ];

    // Add waiting sessions if any
    if (this.waitingSessions.length > 0) {
      for (const session of this.waitingSessions) {
        menuItems.push({
          label: `● ${session.name} - waiting`,
          click: () => {
            this.showWindowAndSelectSession(session.id);
          },
        });
      }
      menuItems.push({ type: 'separator' });
    }

    // Standard menu items
    menuItems.push(
      {
        label: 'Show ClaudeLander',
        click: () => {
          this.showWindow();
        },
      },
      {
        label: 'Settings...',
        click: () => {
          if (this.onShowSettings) {
            this.showWindow();
            this.onShowSettings();
          }
        },
      },
      { type: 'separator' },
      {
        label: 'Quit ClaudeLander',
        click: () => {
          // Set flag to actually quit (bypass close-to-tray)
          app.quit();
        },
      }
    );

    const contextMenu = Menu.buildFromTemplate(menuItems);
    this.tray.setContextMenu(contextMenu);
  }

  private updateBadge(): void {
    if (!this.tray) return;

    const count = this.waitingSessions.length;

    if (count === 0) {
      // No badge - use base icon
      const icon = nativeImage.createFromPath(this.baseIconPath);
      this.tray.setImage(icon.resize({ width: 16, height: 16 }));
      this.tray.setToolTip('ClaudeLander');
    } else {
      // Draw badge on icon
      const badgeIcon = this.createBadgeIcon(count);
      this.tray.setImage(badgeIcon);
      this.tray.setToolTip(`ClaudeLander - ${count} waiting`);
    }
  }

  private createBadgeIcon(count: number): Electron.NativeImage {
    // For now, just update tooltip since drawing on icon is complex
    // TODO: Implement actual badge drawing with canvas
    // This requires more setup with native image manipulation
    const icon = nativeImage.createFromPath(this.baseIconPath);
    return icon.resize({ width: 16, height: 16 });
  }

  private toggleWindow(): void {
    if (!this.mainWindow) return;

    if (this.mainWindow.isVisible() && this.mainWindow.isFocused()) {
      this.mainWindow.hide();
    } else {
      this.showWindow();
    }
  }

  private showWindow(): void {
    if (!this.mainWindow) return;

    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }
    this.mainWindow.show();
    this.mainWindow.focus();
  }

  private showWindowAndSelectSession(sessionId: string): void {
    this.showWindow();

    if (this.mainWindow) {
      this.mainWindow.webContents.send('session:select', sessionId);
    }

    if (this.onSessionSelect) {
      this.onSessionSelect(sessionId);
    }
  }

  private getIconPath(): string {
    if (app.isPackaged) {
      // In production
      if (process.platform === 'darwin') {
        return path.join(process.resourcesPath, 'icon.icns');
      }
      return path.join(process.resourcesPath, 'icon.png');
    }

    // In development
    return path.join(__dirname, '../../build/icon.png');
  }

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

export const trayManager = new TrayManager();
