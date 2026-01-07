/**
 * Sharing IPC Handlers
 */
import { ipcMain, BrowserWindow } from 'electron';
import { shareManager } from '../sharing/share-manager';
import { authService } from '../sharing/auth';
import { isValidUUID, isValidShareCode, isValidString } from '../validation';

export function registerSharingHandlers(getMainWindow: () => BrowserWindow | null): void {
  // Auth handlers
  ipcMain.handle('auth:login', () => {
    authService.startLogin();
  });

  ipcMain.handle('auth:logout', () => {
    authService.logout();
    return { success: true };
  });

  ipcMain.handle('auth:getUser', () => {
    return authService.currentUser;
  });

  ipcMain.handle('auth:setToken', async (_, token: string) => {
    return authService.setToken(token);
  });

  // Sharing (host)
  ipcMain.handle('share:start', async (_, localSessionId: string) => {
    if (!isValidUUID(localSessionId)) {
      throw new Error('Invalid session ID');
    }
    return shareManager.startSharing(localSessionId);
  });

  ipcMain.handle('share:stop', async (_, localSessionId: string) => {
    if (!isValidUUID(localSessionId)) {
      throw new Error('Invalid session ID');
    }
    return shareManager.stopSharing(localSessionId);
  });

  ipcMain.handle('share:createCode', async (_, localSessionId: string, options: any) => {
    if (!isValidUUID(localSessionId)) {
      throw new Error('Invalid session ID');
    }
    return shareManager.createCode(localSessionId, options);
  });

  ipcMain.handle('share:revokeCode', async (_, code: string) => {
    if (!isValidShareCode(code)) {
      throw new Error('Invalid share code');
    }
    return shareManager.revokeCode(code);
  });

  ipcMain.handle('share:getCodes', async (_, localSessionId: string) => {
    if (!isValidUUID(localSessionId)) {
      throw new Error('Invalid session ID');
    }
    return shareManager.getCodes(localSessionId);
  });

  ipcMain.handle('share:isSharing', (_, localSessionId: string) => {
    if (!isValidUUID(localSessionId)) return false;
    return shareManager.isSharing(localSessionId);
  });

  ipcMain.handle('share:getGuestCount', (_, localSessionId: string) => {
    if (!isValidUUID(localSessionId)) return 0;
    return shareManager.getGuestCount(localSessionId);
  });

  // Sharing (guest)
  ipcMain.handle('share:join', async (_, code: string) => {
    if (!isValidShareCode(code)) {
      throw new Error('Invalid share code');
    }
    const { permission, hostUsername, sessionName, relayClient } = await shareManager.joinSession(code);

    const mainWindow = getMainWindow();
    relayClient.on('data', (data) => {
      mainWindow?.webContents.send('share:data', { code, data: data.toString() });
    });

    relayClient.on('disconnected', () => {
      mainWindow?.webContents.send('share:ended', { code });
    });

    return { code, permission, hostUsername, sessionName };
  });

  ipcMain.handle('share:leave', (_, code: string) => {
    if (!isValidShareCode(code)) return;
    shareManager.leaveSession(code);
  });

  ipcMain.handle('share:write', (_, code: string, data: string) => {
    if (!isValidShareCode(code) || !isValidString(data, 1000000)) {
      return { success: false, error: 'Invalid input' };
    }
    const client = shareManager.getJoinedClient(code);
    if (client && client.canSendInput()) {
      client.send(data);
      return { success: true };
    }
    return { success: false, error: 'Cannot send input' };
  });

  // Forward share manager events to renderer
  shareManager.on('guestJoined', (info) => {
    getMainWindow()?.webContents.send('share:guestJoined', info);
  });

  shareManager.on('guestLeft', (info) => {
    getMainWindow()?.webContents.send('share:guestLeft', info);
  });
}
