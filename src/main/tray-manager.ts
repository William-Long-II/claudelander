import { Tray, Menu, nativeImage, app, BrowserWindow, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

interface WaitingSession {
  id: string;
  name: string;
}

// 32x32 icon as base64 PNG - golden "C" on dark circle, optimized for Windows tray
// This is a simple, clean icon that renders well at small sizes
const FALLBACK_ICON_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAA7AAAAOwBeShxvQAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAMHSURBVFiFtZdNaBNBFMd/s5tNUtummBQtRdGDB6GKFkEQwYMHEbyIeBDBk168eFJEPIgHwYMXLx70IogH8eTBgwgePHgQxEO9iF8IQqvRim3TNJvZ8bBJzWY32d2NfTA7s+/N/N/s7JuZFVJKfuTLXVehzQETpJTI4bExHnz8yoOPX3k5Z+DSBtI0yWYNpJTk8oXGAHKuAMDMz18YhkGhUGRqZpZsNsvfbJZZLyBtm5cTbS7gJeDnqS1rUBSVn1N/KJVKvJmcJZcvNAawAYDpWTJZg2y2wO9sNjCABQcA4NcfKBSLTExnG0/BogFYCMDfbJZ8oYjjOpQLBUqlMqVSiVKpTKlUZjFYLEZDw8SRIzhy+K9vk8MqiiJZW/CUylKuVCqUSiWKRR/XdWsVCgWKxRLFYomJhCAhAaSSEiklUko8rwwga/iYpklXV3+9SIlhUzwcx8XznJZmoCGA4bTrep4XFJRNuq5LfJRu16VTAPaKB2zEYg3U1dWhqip+Y1tLaRMAz/MwTVOKtgAcx2kkBMdxGgLM02ZfOCBh2wG0bYe27QMAC4iqgOu6FIslKhVRCwAEACT4rIFpmjWBWu2oe0+AtN1i6xY8/dGCBW+/ALRt+1eaQCgtOQC0bhcmQ8B1Q+1YCADK5Qp5v5BhGKiq0rS9bdu0bbsWwDQlKIoaG0BSu0ADbvMAwcxcrhB76wl82E0DKKqGbTdl9gBxSikaRnuZZjQKECbr9oi6oe8JdJrF5KaDkFJi23ZQFRs3HQitBi5T0aIBuOx0BLBTAIIIAJ2CxCaVtdVJiJvWwPM85udN5uct5uctz2ZnLdp1Pc9mYsIg/C7I8HwfwHRAqNfbdhpGdAmMwwnMGQB6hwBmqUKpXALgj2FSLJaYnMxhmCbFYomJiQLAL1BUKBl1GKYJJDBthvLVwJRj2xTNAvP5AvP5fMMAjgPm//3PYdaEqnQK4AJe3MJYu0Xf7KdpGqqmYtSNdRxU1SSfzzA6uh3gZFNJiSNr1O5nmoYZfMIoK/V+4n0AAAAASUVORK5CYII=';

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
        try {
          const icon = nativeImage.createFromPath(iconPath);
          if (!icon.isEmpty()) {
            console.log('Loaded tray icon from:', iconPath);
            // Resize to appropriate tray icon size
            return icon.resize({ width: 32, height: 32 });
          }
        } catch (err) {
          console.error('Failed to load icon from:', iconPath, err);
        }
      }
    }

    // Fallback to embedded icon
    console.log('Using fallback tray icon');
    const fallbackIcon = nativeImage.createFromDataURL(FALLBACK_ICON_DATA);
    if (fallbackIcon.isEmpty()) {
      console.error('Fallback icon is empty, creating simple colored icon');
      // Create a simple colored square as last resort
      return this.createSimpleIcon();
    }
    return fallbackIcon;
  }

  private createSimpleIcon(): Electron.NativeImage {
    // Create a simple 16x16 colored icon as absolute last resort
    // This creates a solid colored square
    const size = 16;
    const buffer = Buffer.alloc(size * size * 4);

    // Fill with golden color (RGBA)
    for (let i = 0; i < size * size; i++) {
      buffer[i * 4] = 212;     // R
      buffer[i * 4 + 1] = 175; // G
      buffer[i * 4 + 2] = 55;  // B
      buffer[i * 4 + 3] = 255; // A
    }

    return nativeImage.createFromBuffer(buffer, {
      width: size,
      height: size,
    });
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
