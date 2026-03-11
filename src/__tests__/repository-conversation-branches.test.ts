import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initKnowledgeGraphTables } from '../main/database-knowledge';

// We need to mock ../main/database so the repository uses our in-memory DB
let testDb: Database.Database;

vi.mock('../main/database', () => ({
  getDatabase: () => testDb,
}));

// Import repository functions AFTER the mock is set up
import {
  createBranch,
  getBranch,
  getBranchesBySession,
  deleteBranch,
} from '../main/repositories/conversation-branches';

/**
 * Helper: create prerequisite tables (groups, sessions, chat_messages) that the
 * conversation_branches table references via foreign keys.
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
  `);

  // Seed groups and sessions so FK references succeed
  db.prepare(`INSERT INTO groups (id, name) VALUES ('g1', 'Test Group')`).run();
  db.prepare(`INSERT INTO sessions (id, group_id, name, working_dir) VALUES ('s1', 'g1', 'Session 1', '/tmp')`).run();
  db.prepare(`INSERT INTO sessions (id, group_id, name, working_dir) VALUES ('s2', 'g1', 'Session 2', '/tmp')`).run();
}

/**
 * Helper: insert a chat message so that fork_message_id FK references succeed.
 */
function insertChatMessage(db: Database.Database, id: string, sessionId: string): void {
  db.prepare(`
    INSERT INTO chat_messages (id, session_id, role, content, message_type)
    VALUES (?, ?, 'user', 'test message', 'text')
  `).run(id, sessionId);
}

describe('Conversation Branches Repository', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');
    createPrerequisiteTables(testDb);
    initKnowledgeGraphTables(testDb);

    // Insert chat messages for FK references
    insertChatMessage(testDb, 'msg-1', 's1');
    insertChatMessage(testDb, 'msg-2', 's1');
    insertChatMessage(testDb, 'msg-3', 's1');
    insertChatMessage(testDb, 'msg-4', 's2');
  });

  afterEach(() => {
    testDb.close();
  });

  // ---------- createBranch ----------

  describe('createBranch', () => {
    it('should create a branch with all fields', () => {
      const branch = createBranch({
        id: 'br-001',
        sessionId: 's1',
        parentBranchId: undefined,
        forkMessageId: 'msg-1',
        name: 'Experiment A',
      });

      expect(branch.id).toBe('br-001');
      expect(branch.sessionId).toBe('s1');
      expect(branch.parentBranchId).toBeNull();
      expect(branch.forkMessageId).toBe('msg-1');
      expect(branch.name).toBe('Experiment A');
      expect(branch.createdAt).toBeInstanceOf(Date);
    });

    it('should create a branch with minimal fields', () => {
      const branch = createBranch({
        id: 'br-002',
        sessionId: 's1',
        forkMessageId: 'msg-1',
      });

      expect(branch.id).toBe('br-002');
      expect(branch.sessionId).toBe('s1');
      expect(branch.parentBranchId).toBeNull();
      expect(branch.forkMessageId).toBe('msg-1');
      expect(branch.name).toBeNull();
    });

    it('should create a child branch with parent_branch_id', () => {
      const parent = createBranch({
        id: 'br-parent',
        sessionId: 's1',
        forkMessageId: 'msg-1',
        name: 'Parent Branch',
      });

      const child = createBranch({
        id: 'br-child',
        sessionId: 's1',
        parentBranchId: parent.id,
        forkMessageId: 'msg-2',
        name: 'Child Branch',
      });

      expect(child.parentBranchId).toBe('br-parent');
      expect(child.forkMessageId).toBe('msg-2');
    });
  });

  // ---------- getBranch ----------

  describe('getBranch', () => {
    it('should return null for nonexistent branch', () => {
      const result = getBranch('nonexistent');
      expect(result).toBeNull();
    });

    it('should return a branch by id', () => {
      createBranch({
        id: 'br-003',
        sessionId: 's1',
        forkMessageId: 'msg-1',
        name: 'Lookup Test',
      });

      const branch = getBranch('br-003');
      expect(branch).not.toBeNull();
      expect(branch!.id).toBe('br-003');
      expect(branch!.name).toBe('Lookup Test');
    });
  });

  // ---------- getBranchesBySession ----------

  describe('getBranchesBySession', () => {
    it('should return all branches for a session', () => {
      createBranch({ id: 'br-s1a', sessionId: 's1', forkMessageId: 'msg-1', name: 'Branch A' });
      createBranch({ id: 'br-s1b', sessionId: 's1', forkMessageId: 'msg-2', name: 'Branch B' });
      createBranch({ id: 'br-s2a', sessionId: 's2', forkMessageId: 'msg-4', name: 'Other Session' });

      const branches = getBranchesBySession('s1');
      expect(branches).toHaveLength(2);
      expect(branches.every(b => b.sessionId === 's1')).toBe(true);
    });

    it('should return empty array when session has no branches', () => {
      const branches = getBranchesBySession('s1');
      expect(branches).toEqual([]);
    });

    it('should return branches ordered by created_at ascending', () => {
      createBranch({ id: 'br-first', sessionId: 's1', forkMessageId: 'msg-1', name: 'First' });
      createBranch({ id: 'br-second', sessionId: 's1', forkMessageId: 'msg-2', name: 'Second' });
      createBranch({ id: 'br-third', sessionId: 's1', forkMessageId: 'msg-3', name: 'Third' });

      const branches = getBranchesBySession('s1');
      expect(branches[0].id).toBe('br-first');
      expect(branches[1].id).toBe('br-second');
      expect(branches[2].id).toBe('br-third');
    });
  });

  // ---------- deleteBranch ----------

  describe('deleteBranch', () => {
    it('should delete an existing branch and return true', () => {
      createBranch({ id: 'br-del', sessionId: 's1', forkMessageId: 'msg-1' });

      const result = deleteBranch('br-del');
      expect(result).toBe(true);
      expect(getBranch('br-del')).toBeNull();
    });

    it('should return false when deleting nonexistent branch', () => {
      const result = deleteBranch('nonexistent');
      expect(result).toBe(false);
    });

    it('should not affect other branches', () => {
      createBranch({ id: 'br-keep', sessionId: 's1', forkMessageId: 'msg-1', name: 'Keep' });
      createBranch({ id: 'br-remove', sessionId: 's1', forkMessageId: 'msg-2', name: 'Remove' });

      deleteBranch('br-remove');

      expect(getBranch('br-keep')).not.toBeNull();
      expect(getBranchesBySession('s1')).toHaveLength(1);
    });

    it('should set child branch parent_branch_id to null when parent is deleted (ON DELETE SET NULL)', () => {
      createBranch({ id: 'br-parent-del', sessionId: 's1', forkMessageId: 'msg-1' });
      createBranch({ id: 'br-child-del', sessionId: 's1', parentBranchId: 'br-parent-del', forkMessageId: 'msg-2' });

      deleteBranch('br-parent-del');

      const child = getBranch('br-child-del');
      expect(child).not.toBeNull();
      expect(child!.parentBranchId).toBeNull();
    });
  });
});
