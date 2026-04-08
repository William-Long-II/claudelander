/**
 * Group & Session Import/Export
 *
 * Portable JSON format for transferring groups and sessions between
 * ClaudeLander and Bodhilander (or any compatible app). Sessions carry their
 * claudeSessionId so Claude Code conversations can be resumed after import.
 */

import { dialog, app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import * as groupsRepo from './repositories/groups';
import * as sessionsRepo from './repositories/sessions';
import log from 'electron-log';

// ---------------------------------------------------------------------------
// Portable format types
// ---------------------------------------------------------------------------

interface PortableGroup {
  id: string;
  name: string;
  color: string;
  workingDir: string;
  parentId: string | null;
  collapsed: boolean;
  order: number;
  createdAt: string; // ISO 8601
}

interface PortableSession {
  id: string;
  groupId: string;
  name: string;
  workingDir: string;
  shellType: string;
  claudeSessionId: string | null;
  order: number;
  createdAt: string;
  lastActivityAt: string;
}

interface PortableData {
  version: 1;
  sourceApp: string;
  exportedAt: string;
  groups: PortableGroup[];
  sessions: PortableSession[];
}

interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
  groupCount?: number;
  sessionCount?: number;
}

interface ImportResult {
  success: boolean;
  error?: string;
  groupCount?: number;
  sessionCount?: number;
  skippedGroups?: number;
  skippedSessions?: number;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportGroupsAndSessions(): Promise<ExportResult> {
  try {
    const groups = groupsRepo.getAllGroups();
    const sessions = sessionsRepo.getAllSessions();

    const data: PortableData = {
      version: 1,
      sourceApp: 'claudelander',
      exportedAt: new Date().toISOString(),
      groups: groups.map(g => ({
        id: g.id,
        name: g.name,
        color: g.color,
        workingDir: g.workingDir,
        parentId: g.parentId,
        collapsed: g.collapsed,
        order: g.order,
        createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : String(g.createdAt),
      })),
      sessions: sessions.map(s => ({
        id: s.id,
        groupId: s.groupId,
        name: s.name,
        workingDir: s.workingDir,
        shellType: s.shellType,
        claudeSessionId: s.claudeSessionId ?? null,
        order: s.order,
        createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
        lastActivityAt: s.lastActivityAt instanceof Date ? s.lastActivityAt.toISOString() : String(s.lastActivityAt),
      })),
    };

    const defaultName = `claudelander-export-${new Date().toISOString().slice(0, 10)}`;
    const result = await dialog.showSaveDialog({
      title: 'Export Groups & Sessions',
      defaultPath: path.join(app.getPath('documents'), `${defaultName}.json`),
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Export cancelled' };
    }

    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    log.info(`[Import/Export] Exported ${groups.length} groups, ${sessions.length} sessions to ${result.filePath}`);

    return {
      success: true,
      filePath: result.filePath,
      groupCount: groups.length,
      sessionCount: sessions.length,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error('[Import/Export] Export failed:', msg);
    return { success: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export async function importGroupsAndSessions(): Promise<ImportResult> {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Import Groups & Sessions',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, error: 'Import cancelled' };
    }

    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const data: PortableData = JSON.parse(raw);

    if (data.version !== 1 || !Array.isArray(data.groups) || !Array.isArray(data.sessions)) {
      return { success: false, error: 'Invalid export file format' };
    }

    // Build a map from old group IDs → new group IDs
    const existingGroups = new Set(groupsRepo.getAllGroups().map(g => g.id));
    const existingSessions = new Set(sessionsRepo.getAllSessions().map(s => s.id));
    const groupIdMap = new Map<string, string>();

    let groupCount = 0;
    let skippedGroups = 0;

    // Sort so that top-level groups (parentId == null) come first
    const sorted = [...data.groups].sort((a, b) => {
      if (a.parentId === null && b.parentId !== null) return -1;
      if (a.parentId !== null && b.parentId === null) return 1;
      return 0;
    });

    for (const g of sorted) {
      if (existingGroups.has(g.id)) {
        groupIdMap.set(g.id, g.id);
        skippedGroups++;
        continue;
      }

      const newId = randomUUID();
      groupIdMap.set(g.id, newId);

      const resolvedParentId = g.parentId ? (groupIdMap.get(g.parentId) ?? null) : null;

      groupsRepo.createGroup({
        id: newId,
        name: g.name,
        color: g.color,
        workingDir: g.workingDir,
        parentId: resolvedParentId,
        collapsed: g.collapsed,
        order: g.order,
        createdAt: new Date(g.createdAt),
      });
      groupCount++;
    }

    let sessionCount = 0;
    let skippedSessions = 0;

    for (const s of data.sessions) {
      const mappedGroupId = groupIdMap.get(s.groupId);
      if (!mappedGroupId) {
        skippedSessions++;
        continue;
      }

      if (existingSessions.has(s.id)) {
        skippedSessions++;
        continue;
      }

      sessionsRepo.createSession({
        id: randomUUID(),
        groupId: mappedGroupId,
        name: s.name,
        workingDir: s.workingDir,
        state: 'idle',
        shellType: s.shellType || 'bash',
        claudeSessionId: s.claudeSessionId ?? null,
        order: s.order,
        createdAt: new Date(s.createdAt),
        lastActivityAt: new Date(s.lastActivityAt),
      } as any);
      sessionCount++;
    }

    log.info(`[Import/Export] Imported ${groupCount} groups, ${sessionCount} sessions (skipped ${skippedGroups} groups, ${skippedSessions} sessions)`);

    return {
      success: true,
      groupCount,
      sessionCount,
      skippedGroups,
      skippedSessions,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error('[Import/Export] Import failed:', msg);
    return { success: false, error: msg };
  }
}
