/**
 * Database IPC Handlers (Groups and Sessions)
 */
import { ipcMain } from 'electron';
import * as groupsRepo from '../repositories/groups';
import * as sessionsRepo from '../repositories/sessions';
import { shareManager } from '../sharing/share-manager';
import { Group, Session } from '../../shared/types';
import {
  isValidUUID,
  isNonEmptyString,
  isValidFilePath,
} from '../validation';

export function registerDbHandlers(): void {
  // Groups
  ipcMain.handle('db:groups:getAll', async () => {
    return groupsRepo.getAllGroups();
  });

  ipcMain.handle('db:groups:create', async (_, group: Group) => {
    if (!isValidUUID(group.id)) {
      throw new Error('Invalid group ID');
    }
    if (!isNonEmptyString(group.name, 255)) {
      throw new Error('Invalid group name');
    }
    groupsRepo.createGroup(group);
  });

  ipcMain.handle('db:groups:update', async (_, id: string, updates: Partial<Group>) => {
    if (!isValidUUID(id)) {
      throw new Error('Invalid group ID');
    }
    if (updates.name !== undefined && !isNonEmptyString(updates.name, 255)) {
      throw new Error('Invalid group name');
    }
    groupsRepo.updateGroup(id, updates);
  });

  ipcMain.handle('db:groups:delete', async (_, id: string) => {
    if (!isValidUUID(id)) {
      throw new Error('Invalid group ID');
    }
    groupsRepo.deleteGroup(id);
  });

  // Sessions
  ipcMain.handle('db:sessions:getAll', async () => {
    return sessionsRepo.getAllSessions();
  });

  ipcMain.handle('db:sessions:create', async (_, session: Session) => {
    if (!isValidUUID(session.id)) {
      throw new Error('Invalid session ID');
    }
    if (!isValidUUID(session.groupId)) {
      throw new Error('Invalid group ID');
    }
    if (!isNonEmptyString(session.name, 255)) {
      throw new Error('Invalid session name');
    }
    if (!isValidFilePath(session.workingDir)) {
      throw new Error('Invalid working directory');
    }
    sessionsRepo.createSession(session);
  });

  ipcMain.handle('db:sessions:update', async (_, id: string, updates: Partial<Session>) => {
    if (!isValidUUID(id)) {
      throw new Error('Invalid session ID');
    }
    if (updates.groupId !== undefined && !isValidUUID(updates.groupId)) {
      throw new Error('Invalid group ID');
    }
    if (updates.name !== undefined && !isNonEmptyString(updates.name, 255)) {
      throw new Error('Invalid session name');
    }
    sessionsRepo.updateSession(id, updates);
  });

  ipcMain.handle('db:sessions:delete', async (_, id: string) => {
    if (!isValidUUID(id)) {
      throw new Error('Invalid session ID');
    }
    try {
      await shareManager.stopSharing(id);
    } catch {
      // Ignore - session may not have been shared
    }
    sessionsRepo.deleteSession(id);
  });
}
