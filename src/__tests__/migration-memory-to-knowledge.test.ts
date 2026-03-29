import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initKnowledgeGraphTables } from '../main/database-knowledge';

// We need to mock ../main/database so the migration uses our in-memory DB
let testDb: Database.Database;

vi.mock('../main/database', () => ({
  getDatabase: () => testDb,
}));

// Import AFTER mock is set up
import { migrateMemoriesToKnowledge } from '../main/migration/memory-to-knowledge';
import { getKnowledgeNode } from '../main/repositories/knowledge';

/**
 * Helper: create prerequisite tables (groups, sessions) and the memories table.
 */
function createPrerequisiteTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#888888',
      working_dir TEXT DEFAULT '',
      "order" INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      working_dir TEXT NOT NULL,
      state TEXT DEFAULT 'idle',
      shell_type TEXT DEFAULT 'bash',
      "order" INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('decision', 'error_fix', 'pattern', 'context', 'note')),
      content TEXT NOT NULL,
      source TEXT DEFAULT 'auto' CHECK(source IN ('auto', 'manual', 'claude')),
      tags TEXT,
      pinned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT
    );
  `);

  // Seed groups and sessions for FK references
  db.prepare(`INSERT INTO groups (id, name) VALUES ('g1', 'Test Group')`).run();
  db.prepare(`INSERT INTO groups (id, name) VALUES ('g2', 'Other Group')`).run();
  db.prepare(
    `INSERT INTO sessions (id, group_id, name, working_dir) VALUES ('s1', 'g1', 'Test Session', '/tmp')`
  ).run();
  db.prepare(
    `INSERT INTO sessions (id, group_id, name, working_dir) VALUES ('s2', 'g2', 'Session 2', '/tmp')`
  ).run();
}

describe('migrateMemoriesToKnowledge', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');
    createPrerequisiteTables(testDb);
    initKnowledgeGraphTables(testDb);
  });

  afterEach(() => {
    testDb.close();
  });

  it('should migrate a simple memory to a tier 1 knowledge node with all fields', () => {
    const createdAt = '2025-06-15T10:30:00.000Z';
    testDb.prepare(`
      INSERT INTO memories (id, session_id, group_id, type, content, source, tags, pinned, created_at)
      VALUES ('mem-001', 's1', 'g1', 'error_fix', 'Fix: use path.resolve for Windows paths', 'auto', '["windows","paths"]', 0, ?)
    `).run(createdAt);

    const result = migrateMemoriesToKnowledge();

    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);

    const node = getKnowledgeNode('migrated-mem-001');
    expect(node).not.toBeNull();
    expect(node!.tier).toBe(1);
    expect(node!.content).toBe('Fix: use path.resolve for Windows paths');
    expect(node!.source).toBe('auto-extracted');
    expect(node!.confidence).toBe(0.8); // unpinned
    expect(node!.domains).toEqual(['error_fix']);
    expect(node!.tags).toEqual(['windows', 'paths']);
    expect(node!.scopeSessionId).toBe('s1');
    expect(node!.scopeGroupId).toBe('g1');
    expect(node!.createdAt.toISOString()).toBe(createdAt);
    expect(node!.lastReinforcedAt.toISOString()).toBe(createdAt);
  });

  it('should set confidence 1.0 for pinned memories and 0.8 for unpinned', () => {
    testDb.prepare(`
      INSERT INTO memories (id, session_id, group_id, type, content, source, pinned)
      VALUES ('mem-pinned', 's1', 'g1', 'decision', 'Pinned decision', 'auto', 1)
    `).run();
    testDb.prepare(`
      INSERT INTO memories (id, session_id, group_id, type, content, source, pinned)
      VALUES ('mem-unpinned', 's1', 'g1', 'decision', 'Unpinned decision', 'auto', 0)
    `).run();

    migrateMemoriesToKnowledge();

    const pinned = getKnowledgeNode('migrated-mem-pinned');
    const unpinned = getKnowledgeNode('migrated-mem-unpinned');

    expect(pinned!.confidence).toBe(1.0);
    expect(unpinned!.confidence).toBe(0.8);
  });

  it('should map memory type to domain correctly', () => {
    const types = ['decision', 'error_fix', 'pattern', 'context', 'note'] as const;

    for (const type of types) {
      testDb.prepare(`
        INSERT INTO memories (id, session_id, group_id, type, content, source)
        VALUES (?, 's1', 'g1', ?, ?, 'auto')
      `).run(`mem-${type}`, type, `Memory of type ${type}`);
    }

    migrateMemoriesToKnowledge();

    for (const type of types) {
      const node = getKnowledgeNode(`migrated-mem-${type}`);
      expect(node).not.toBeNull();
      expect(node!.domains).toEqual([type]);
    }
  });

  it('should map source correctly: manual->user-created, claude->auto-extracted, auto->auto-extracted', () => {
    testDb.prepare(`
      INSERT INTO memories (id, session_id, group_id, type, content, source)
      VALUES ('mem-manual', 's1', 'g1', 'note', 'Manual memory', 'manual')
    `).run();
    testDb.prepare(`
      INSERT INTO memories (id, session_id, group_id, type, content, source)
      VALUES ('mem-claude', 's1', 'g1', 'note', 'Claude memory', 'claude')
    `).run();
    testDb.prepare(`
      INSERT INTO memories (id, session_id, group_id, type, content, source)
      VALUES ('mem-auto', 's1', 'g1', 'note', 'Auto memory', 'auto')
    `).run();

    migrateMemoriesToKnowledge();

    expect(getKnowledgeNode('migrated-mem-manual')!.source).toBe('user-created');
    expect(getKnowledgeNode('migrated-mem-claude')!.source).toBe('auto-extracted');
    expect(getKnowledgeNode('migrated-mem-auto')!.source).toBe('auto-extracted');
  });

  it('should be idempotent: running twice skips already-migrated memories', () => {
    testDb.prepare(`
      INSERT INTO memories (id, session_id, group_id, type, content, source)
      VALUES ('mem-idem', 's1', 'g1', 'pattern', 'Idempotent memory', 'auto')
    `).run();

    const firstRun = migrateMemoriesToKnowledge();
    expect(firstRun.migrated).toBe(1);
    expect(firstRun.skipped).toBe(0);

    const secondRun = migrateMemoriesToKnowledge();
    expect(secondRun.migrated).toBe(0);
    expect(secondRun.skipped).toBe(1);
    expect(secondRun.errors).toBe(0);

    // Verify only one node exists
    const node = getKnowledgeNode('migrated-mem-idem');
    expect(node).not.toBeNull();
  });

  it('should preserve session_id and group_id scope', () => {
    testDb.prepare(`
      INSERT INTO memories (id, session_id, group_id, type, content, source)
      VALUES ('mem-scope1', 's1', 'g1', 'context', 'Scoped to s1/g1', 'auto')
    `).run();
    testDb.prepare(`
      INSERT INTO memories (id, session_id, group_id, type, content, source)
      VALUES ('mem-scope2', 's2', 'g2', 'context', 'Scoped to s2/g2', 'auto')
    `).run();
    // Memory with null session_id
    testDb.prepare(`
      INSERT INTO memories (id, session_id, group_id, type, content, source)
      VALUES ('mem-scope3', NULL, 'g1', 'context', 'No session scope', 'auto')
    `).run();

    migrateMemoriesToKnowledge();

    const node1 = getKnowledgeNode('migrated-mem-scope1');
    expect(node1!.scopeSessionId).toBe('s1');
    expect(node1!.scopeGroupId).toBe('g1');

    const node2 = getKnowledgeNode('migrated-mem-scope2');
    expect(node2!.scopeSessionId).toBe('s2');
    expect(node2!.scopeGroupId).toBe('g2');

    const node3 = getKnowledgeNode('migrated-mem-scope3');
    expect(node3!.scopeSessionId).toBeNull();
    expect(node3!.scopeGroupId).toBe('g1');
  });

  it('should return migrated=0 and errors=0 for empty memories table', () => {
    const result = migrateMemoriesToKnowledge();

    expect(result.migrated).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('should handle memories with null tags', () => {
    testDb.prepare(`
      INSERT INTO memories (id, session_id, group_id, type, content, source, tags)
      VALUES ('mem-notags', 's1', 'g1', 'note', 'No tags memory', 'auto', NULL)
    `).run();

    migrateMemoriesToKnowledge();

    const node = getKnowledgeNode('migrated-mem-notags');
    expect(node).not.toBeNull();
    expect(node!.tags).toEqual([]);
  });

  it('should handle memories with empty string tags', () => {
    testDb.prepare(`
      INSERT INTO memories (id, session_id, group_id, type, content, source, tags)
      VALUES ('mem-emptytags', 's1', 'g1', 'note', 'Empty tags memory', 'auto', '')
    `).run();

    migrateMemoriesToKnowledge();

    const node = getKnowledgeNode('migrated-mem-emptytags');
    expect(node).not.toBeNull();
    expect(node!.tags).toEqual([]);
  });
});
