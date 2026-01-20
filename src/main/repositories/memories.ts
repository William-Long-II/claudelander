import { getDatabase } from '../database';
import { Memory, MemoryType, MemorySource } from '../../shared/types';

interface MemoryRow {
  id: string;
  session_id: string | null;
  group_id: string;
  type: string;
  content: string;
  source: string;
  tags: string | null;
  pinned: number;
  created_at: string;
  updated_at: string | null;
  rowid?: number;
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    sessionId: row.session_id,
    groupId: row.group_id,
    type: row.type as MemoryType,
    content: row.content,
    source: row.source as MemorySource,
    tags: row.tags ? JSON.parse(row.tags) : [],
    pinned: row.pinned === 1,
    createdAt: new Date(row.created_at),
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  };
}

export function createMemory(memory: Omit<Memory, 'createdAt' | 'updatedAt'>): Memory {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO memories (id, session_id, group_id, type, content, source, tags, pinned, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    memory.id,
    memory.sessionId,
    memory.groupId,
    memory.type,
    memory.content,
    memory.source,
    memory.tags && memory.tags.length > 0 ? JSON.stringify(memory.tags) : null,
    memory.pinned ? 1 : 0,
    now,
    now
  );

  return {
    ...memory,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  };
}

export function updateMemory(id: string, updates: Partial<Pick<Memory, 'content' | 'type' | 'tags' | 'pinned'>>): void {
  const db = getDatabase();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.type !== undefined) {
    fields.push('type = ?');
    values.push(updates.type);
  }
  if (updates.tags !== undefined) {
    fields.push('tags = ?');
    values.push(updates.tags.length > 0 ? JSON.stringify(updates.tags) : null);
  }
  if (updates.pinned !== undefined) {
    fields.push('pinned = ?');
    values.push(updates.pinned ? 1 : 0);
  }

  if (fields.length > 0) {
    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    db.prepare(`UPDATE memories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
}

export function deleteMemory(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM memories WHERE id = ?').run(id);
}

export function getMemoryById(id: string): Memory | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined;
  return row ? rowToMemory(row) : null;
}

export function getMemoriesBySession(sessionId: string): Memory[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM memories WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as MemoryRow[];
  return rows.map(rowToMemory);
}

export function getMemoriesByGroup(groupId: string): Memory[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM memories WHERE group_id = ? ORDER BY created_at DESC').all(groupId) as MemoryRow[];
  return rows.map(rowToMemory);
}

export function getPinnedMemories(groupId?: string): Memory[] {
  const db = getDatabase();
  let rows: MemoryRow[];

  if (groupId) {
    rows = db.prepare('SELECT * FROM memories WHERE pinned = 1 AND group_id = ? ORDER BY created_at DESC').all(groupId) as MemoryRow[];
  } else {
    rows = db.prepare('SELECT * FROM memories WHERE pinned = 1 ORDER BY created_at DESC').all() as MemoryRow[];
  }

  return rows.map(rowToMemory);
}

export function searchMemories(query: string, groupId?: string): Memory[] {
  const db = getDatabase();

  // Use FTS5 for full-text search
  let sql = `
    SELECT m.* FROM memories m
    JOIN memories_fts fts ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ?
  `;
  const params: any[] = [query];

  if (groupId) {
    sql += ' AND m.group_id = ?';
    params.push(groupId);
  }

  sql += ' ORDER BY rank';

  try {
    const rows = db.prepare(sql).all(...params) as MemoryRow[];
    return rows.map(rowToMemory);
  } catch {
    // Fallback to LIKE search if FTS fails
    let fallbackSql = 'SELECT * FROM memories WHERE content LIKE ?';
    const fallbackParams: any[] = [`%${query}%`];

    if (groupId) {
      fallbackSql += ' AND group_id = ?';
      fallbackParams.push(groupId);
    }

    fallbackSql += ' ORDER BY created_at DESC';

    const rows = db.prepare(fallbackSql).all(...fallbackParams) as MemoryRow[];
    return rows.map(rowToMemory);
  }
}

export function getMemoriesForInjection(sessionId: string, groupId: string, maxSize: number = 8192): Memory[] {
  const db = getDatabase();

  // Get memories in priority order:
  // 1. Pinned memories (global/group level)
  // 2. Session-specific memories
  // 3. Recent group memories
  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE group_id = ?
    AND (pinned = 1 OR session_id = ? OR session_id IS NULL)
    ORDER BY
      pinned DESC,
      CASE WHEN session_id = ? THEN 0 ELSE 1 END,
      created_at DESC
  `).all(groupId, sessionId, sessionId) as MemoryRow[];

  const memories: Memory[] = [];
  let currentSize = 0;

  for (const row of rows) {
    const memory = rowToMemory(row);
    const memorySize = memory.content.length + (memory.tags?.join(',').length || 0) + 50; // Rough estimate with formatting

    if (currentSize + memorySize > maxSize) {
      break;
    }

    memories.push(memory);
    currentSize += memorySize;
  }

  return memories;
}

// Deduplication helper - checks if similar content exists within a time window
export function findSimilarMemory(content: string, groupId: string, windowMinutes: number = 5): Memory | null {
  const db = getDatabase();
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

  // Simple content hash comparison - normalize whitespace and compare
  const normalizedContent = content.toLowerCase().replace(/\s+/g, ' ').trim();

  const rows = db.prepare(`
    SELECT * FROM memories
    WHERE group_id = ? AND created_at > ?
    ORDER BY created_at DESC
  `).all(groupId, windowStart) as MemoryRow[];

  for (const row of rows) {
    const existingNormalized = row.content.toLowerCase().replace(/\s+/g, ' ').trim();

    // Check for exact match or high similarity (> 80% overlap)
    if (existingNormalized === normalizedContent) {
      return rowToMemory(row);
    }

    // Simple similarity check - if one contains the other
    if (existingNormalized.includes(normalizedContent) || normalizedContent.includes(existingNormalized)) {
      return rowToMemory(row);
    }
  }

  return null;
}

export function deleteMemoriesBySession(sessionId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM memories WHERE session_id = ? AND pinned = 0').run(sessionId);
}

export function deleteMemoriesByGroup(groupId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM memories WHERE group_id = ?').run(groupId);
}
