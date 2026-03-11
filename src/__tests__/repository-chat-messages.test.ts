import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initKnowledgeGraphTables } from '../main/database-knowledge';

let testDb: Database.Database;

// Mock ../database to return our in-memory test db
vi.mock('../main/database', () => ({
  getDatabase: () => testDb,
}));

// Prerequisites: create the base tables that chat_messages depends on
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

  // Seed test data
  db.prepare(`INSERT INTO groups (id, name) VALUES ('g1', 'Test Group')`).run();
  db.prepare(
    `INSERT INTO sessions (id, group_id, name, working_dir) VALUES ('s1', 'g1', 'Test Session', '/tmp')`
  ).run();
  db.prepare(
    `INSERT INTO sessions (id, group_id, name, working_dir) VALUES ('s2', 'g1', 'Test Session 2', '/tmp2')`
  ).run();
}

import {
  createChatMessage,
  getChatMessage,
  deleteChatMessage,
  getMessagesBySession,
  getMessagesByBranch,
  searchMessages,
  getLastMessageForSession,
  getMessageCountForSession,
} from '../main/repositories/chat-messages';

describe('Chat Messages Repository', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');
    createPrerequisiteTables(testDb);
    initKnowledgeGraphTables(testDb);
  });

  afterEach(() => {
    testDb.close();
  });

  // ── 1. createChatMessage — user message with defaults ────────────
  it('should create a user message with defaults', () => {
    const msg = createChatMessage({
      id: 'msg-1',
      sessionId: 's1',
      role: 'user',
      content: 'Hello, Claude!',
    });

    expect(msg.id).toBe('msg-1');
    expect(msg.sessionId).toBe('s1');
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello, Claude!');
    expect(msg.messageType).toBe('text');
    expect(msg.toolCalls).toBeNull();
    expect(msg.toolResults).toBeNull();
    expect(msg.thinking).toBeNull();
    expect(msg.branchId).toBeNull();
    expect(msg.parentMessageId).toBeNull();
    expect(msg.claudeSessionId).toBeNull();
    expect(msg.createdAt).toBeInstanceOf(Date);
  });

  // ── 2. createChatMessage — assistant with tool_calls and claudeSessionId ──
  it('should create an assistant message with tool_calls and claudeSessionId', () => {
    const toolCalls = [{ id: 'tc-1', name: 'Read', input: { file_path: '/tmp/test.ts' } }];
    const toolResults = [{ toolUseId: 'tc-1', content: 'file contents here' }];

    const msg = createChatMessage({
      id: 'msg-2',
      sessionId: 's1',
      role: 'assistant',
      content: 'Let me read that file.',
      messageType: 'tool_use',
      toolCalls,
      toolResults,
      thinking: 'I should read the file first.',
      claudeSessionId: 'claude-sess-abc',
    });

    expect(msg.id).toBe('msg-2');
    expect(msg.role).toBe('assistant');
    expect(msg.messageType).toBe('tool_use');
    expect(msg.toolCalls).toEqual(toolCalls);
    expect(msg.toolResults).toEqual(toolResults);
    expect(msg.thinking).toBe('I should read the file first.');
    expect(msg.claudeSessionId).toBe('claude-sess-abc');
  });

  // ── 3. getMessagesBySession — chronological order ────────────────
  it('should return messages in chronological order', () => {
    // Insert with explicit timestamps to guarantee ordering
    testDb.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, message_type, created_at)
      VALUES ('msg-a', 's1', 'user', 'First message', 'text', '2026-03-10T10:00:00Z')
    `).run();

    testDb.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, message_type, created_at)
      VALUES ('msg-b', 's1', 'assistant', 'Second message', 'text', '2026-03-10T10:01:00Z')
    `).run();

    testDb.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, message_type, created_at)
      VALUES ('msg-c', 's1', 'user', 'Third message', 'text', '2026-03-10T10:02:00Z')
    `).run();

    const messages = getMessagesBySession('s1');
    expect(messages).toHaveLength(3);
    expect(messages[0].id).toBe('msg-a');
    expect(messages[1].id).toBe('msg-b');
    expect(messages[2].id).toBe('msg-c');
  });

  // ── 4. getMessagesBySession — pagination (limit + offset) ────────
  it('should support pagination with limit and offset', () => {
    // Insert 5 messages
    for (let i = 1; i <= 5; i++) {
      testDb.prepare(`
        INSERT INTO chat_messages (id, session_id, role, content, message_type, created_at)
        VALUES (?, 's1', 'user', ?, 'text', datetime('now', '+' || ? || ' seconds'))
      `).run(`msg-${i}`, `Message ${i}`, i);
    }

    // Get page 1 (first 2)
    const page1 = getMessagesBySession('s1', 2, 0);
    expect(page1).toHaveLength(2);
    expect(page1[0].id).toBe('msg-1');
    expect(page1[1].id).toBe('msg-2');

    // Get page 2 (next 2)
    const page2 = getMessagesBySession('s1', 2, 2);
    expect(page2).toHaveLength(2);
    expect(page2[0].id).toBe('msg-3');
    expect(page2[1].id).toBe('msg-4');

    // Get page 3 (last 1)
    const page3 = getMessagesBySession('s1', 2, 4);
    expect(page3).toHaveLength(1);
    expect(page3[0].id).toBe('msg-5');
  });

  // ── 5. searchMessages — FTS search finds correct messages ────────
  it('should find messages via FTS search', () => {
    createChatMessage({
      id: 'msg-search-1',
      sessionId: 's1',
      role: 'user',
      content: 'How do I implement a binary search tree?',
    });

    createChatMessage({
      id: 'msg-search-2',
      sessionId: 's1',
      role: 'assistant',
      content: 'Here is a sorting algorithm example.',
    });

    createChatMessage({
      id: 'msg-search-3',
      sessionId: 's1',
      role: 'user',
      content: 'What about a balanced binary tree?',
    });

    const results = searchMessages('binary');
    expect(results.length).toBe(2);
    // ORDER BY created_at DESC means newest first
    const ids = results.map((m) => m.id);
    expect(ids).toContain('msg-search-1');
    expect(ids).toContain('msg-search-3');
  });

  // ── 6. searchMessages — with sessionId filter ────────────────────
  it('should filter FTS search by sessionId', () => {
    createChatMessage({
      id: 'msg-s1-1',
      sessionId: 's1',
      role: 'user',
      content: 'TypeScript generics are powerful',
    });

    createChatMessage({
      id: 'msg-s2-1',
      sessionId: 's2',
      role: 'user',
      content: 'TypeScript interfaces extend other interfaces',
    });

    // Search for TypeScript in session s1 only
    const results = searchMessages('TypeScript', 's1');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('msg-s1-1');
  });

  // ── 7. getLastMessageForSession — returns most recent ────────────
  it('should return the most recent message for a session', () => {
    testDb.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, message_type, created_at)
      VALUES ('msg-old', 's1', 'user', 'Old message', 'text', '2026-03-01T00:00:00Z')
    `).run();

    testDb.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, message_type, created_at)
      VALUES ('msg-new', 's1', 'assistant', 'New message', 'text', '2026-03-10T00:00:00Z')
    `).run();

    const last = getLastMessageForSession('s1');
    expect(last).not.toBeNull();
    expect(last!.id).toBe('msg-new');
    expect(last!.content).toBe('New message');
  });

  // ── 8. getMessageCountForSession — correct count ─────────────────
  it('should return the correct message count for a session', () => {
    createChatMessage({ id: 'msg-c1', sessionId: 's1', role: 'user', content: 'One' });
    createChatMessage({ id: 'msg-c2', sessionId: 's1', role: 'assistant', content: 'Two' });
    createChatMessage({ id: 'msg-c3', sessionId: 's1', role: 'user', content: 'Three' });
    // Different session
    createChatMessage({ id: 'msg-c4', sessionId: 's2', role: 'user', content: 'Other session' });

    expect(getMessageCountForSession('s1')).toBe(3);
    expect(getMessageCountForSession('s2')).toBe(1);
    expect(getMessageCountForSession('nonexistent')).toBe(0);
  });

  // ── 9. deleteChatMessage — removes message ──────────────────────
  it('should delete a message', () => {
    createChatMessage({ id: 'msg-del', sessionId: 's1', role: 'user', content: 'To be deleted' });
    expect(getChatMessage('msg-del')).not.toBeNull();

    deleteChatMessage('msg-del');
    expect(getChatMessage('msg-del')).toBeNull();
  });

  // ── Additional edge cases ────────────────────────────────────────

  it('should return null for non-existent message', () => {
    expect(getChatMessage('nonexistent')).toBeNull();
  });

  it('should return null for getLastMessageForSession on empty session', () => {
    expect(getLastMessageForSession('s1')).toBeNull();
  });

  it('should exclude branched messages from getMessagesBySession', () => {
    createChatMessage({ id: 'msg-main', sessionId: 's1', role: 'user', content: 'Main thread' });

    // Insert a branched message directly
    testDb.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, message_type, branch_id)
      VALUES ('msg-branch', 's1', 'user', 'Branch message', 'text', 'branch-1')
    `).run();

    const messages = getMessagesBySession('s1');
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-main');
  });

  it('should get messages by branch', () => {
    // Insert messages on a specific branch
    testDb.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, message_type, branch_id, created_at)
      VALUES ('msg-b1', 's1', 'user', 'Branch msg 1', 'text', 'branch-1', '2026-03-01T00:00:00Z')
    `).run();
    testDb.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, message_type, branch_id, created_at)
      VALUES ('msg-b2', 's1', 'assistant', 'Branch msg 2', 'text', 'branch-1', '2026-03-02T00:00:00Z')
    `).run();
    // Different branch
    testDb.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, message_type, branch_id)
      VALUES ('msg-b3', 's1', 'user', 'Other branch', 'text', 'branch-2')
    `).run();

    const messages = getMessagesByBranch('branch-1');
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe('msg-b1');
    expect(messages[1].id).toBe('msg-b2');
  });
});
