import { Tray, Menu, nativeImage, app, BrowserWindow, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

interface WaitingSession {
  id: string;
  name: string;
}

// Simple 16x16 icon as base64 PNG (golden "C" on dark background)
const FALLBACK_ICON_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA3klEQVR4nGNgGAUDARjhEpJSMv8ZGBj+Q2k4H8xmZGT8L6+o/P/P79//v//4/f/Xr1//f/z89f/nr9//f/789f/Hj5//v3///f/b1x//v375/v/Ll+//P3/+9v/jp6//P3789v/D+8//v/z/8/8Lw38Ghv9ggwQFBP7LDQD5gB+o1B4Jz//Zs2b/H/6MifBg+P8F6oL/YNNArvgC9Mp/YAAE9v//A3bB8ACQqyBeBxqOcAGCjwnqAxgsNvz/AzbuPdgVnyG+gZn+B2IC3AD8oQB2AcIAJEWoPhqF9AEAuPJUfHsVtjgAAAAASUVORK5CYII=';

class TrayManager {
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private waitingSessions: WaitingSession[] = [];
  private onSessionSelect: ((sessionId: string) => void) | null = null;
  private onShowSettings: (() => void) | null = null;
  private baseIcon: Electron.NativeImage | null = null;

  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;

    // Create the tray icon
    this.baseIcon = this.loadIcon();
    const trayIcon = this.baseIcon.resize({ width: 16, height: 16 });

    this.tray = new Tray(trayIcon);
    this.tray.setToolTip('ClaudeLander');

    // Single click shows/hides window
    this.tray.on('click', () => {
      this.toggleWindow();
    });

    // Build initial menu
    this.updateMenu();
  }

  private loadIcon(): Electron.NativeImage {
    // Try to load icon from various paths
    const iconPaths = this.getIconPaths();

    for (const iconPath of iconPaths) {
      if (fs.existsSync(iconPath)) {
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) {
          console.log('Loaded tray icon from:', iconPath);
          return icon;
        }
      }
    }

    // Fallback to embedded icon
    console.log('Using fallback tray icon');
    return nativeImage.createFromDataURL(FALLBACK_ICON_DATA);
  }

  private getIconPaths(): string[] {
    const paths: string[] = [];

    if (app.isPackaged) {
      // Production paths
      if (process.platform === 'win32') {
        paths.push(path.join(process.resourcesPath, 'icon.ico'));
      } else if (process.platform === 'darwin') {
        paths.push(path.join(process.resourcesPath, 'icon.icns'));
      }
      paths.push(path.join(process.resourcesPath, 'icon.png'));
    } else {
      // Development paths - try to find a smaller icon first
      const buildDir = path.join(__dirname, '../../build');
      if (process.platform === 'win32') {
        paths.push(path.join(buildDir, 'icon.ico'));
      }
      paths.push(path.join(buildDir, 'icon.png'));
    }

    return paths;
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
    if (!this.tray || !this.baseIcon) return;

    const count = this.waitingSessions.length;

    if (count === 0) {
      // No badge - use base icon
      this.tray.setImage(this.baseIcon.resize({ width: 16, height: 16 }));
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
    if (!this.baseIcon) {
      return nativeImage.createFromDataURL(FALLBACK_ICON_DATA).resize({ width: 16, height: 16 });
    }
    return this.baseIcon.resize({ width: 16, height: 16 });
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

  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

export const trayManager = new TrayManager();
