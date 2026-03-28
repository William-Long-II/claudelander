import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initKnowledgeGraphTables } from '../main/database-knowledge';

/**
 * Helper: create prerequisite tables (groups, sessions) that the knowledge
 * graph tables reference via foreign keys. In production these are created by
 * initializeTables() in database.ts, but that pulls in Electron, so we
 * replicate the minimal schema here.
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

  // Seed a group and session so FK references succeed
  db.prepare(`INSERT INTO groups (id, name) VALUES ('g1', 'Test Group')`).run();
  db.prepare(
    `INSERT INTO sessions (id, group_id, name, working_dir) VALUES ('s1', 'g1', 'Test Session', '/tmp')`
  ).run();
}

describe('Knowledge Graph Database Tables', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createPrerequisiteTables(db);
    initKnowledgeGraphTables(db);
  });

  afterEach(() => {
    db.close();
  });

  // ---------- knowledge_nodes ----------
  describe('knowledge_nodes', () => {
    it('should create a tier 1 fact with default confidence', () => {
      db.prepare(
        `INSERT INTO knowledge_nodes (id, tier, content, source)
         VALUES ('n1', 1, 'TypeScript uses .ts extension', 'auto-extracted')`
      ).run();

      const row = db.prepare('SELECT * FROM knowledge_nodes WHERE id = ?').get('n1') as any;
      expect(row).toBeDefined();
      expect(row.tier).toBe(1);
      expect(row.content).toBe('TypeScript uses .ts extension');
      expect(row.confidence).toBe(1.0);
      expect(row.source).toBe('auto-extracted');
      expect(row.domains).toBe('[]');
      expect(row.tags).toBe('[]');
    });

    it('should reject invalid tier values', () => {
      expect(() =>
        db.prepare(
          `INSERT INTO knowledge_nodes (id, tier, content, source)
           VALUES ('n2', 4, 'bad tier', 'auto-extracted')`
        ).run()
      ).toThrow();
    });

    it('should reject invalid source values', () => {
      expect(() =>
        db.prepare(
          `INSERT INTO knowledge_nodes (id, tier, content, source)
           VALUES ('n3', 1, 'bad source', 'invalid-source')`
        ).run()
      ).toThrow();
    });

    it('should allow session scoping', () => {
      db.prepare(
        `INSERT INTO knowledge_nodes (id, tier, content, source, scope_session_id)
         VALUES ('n4', 2, 'session scoped fact', 'user-created', 's1')`
      ).run();

      const row = db.prepare('SELECT scope_session_id FROM knowledge_nodes WHERE id = ?').get('n4') as any;
      expect(row.scope_session_id).toBe('s1');
    });

    it('should allow group scoping', () => {
      db.prepare(
        `INSERT INTO knowledge_nodes (id, tier, content, source, scope_group_id)
         VALUES ('n5', 3, 'group scoped fact', 'promoted', 'g1')`
      ).run();

      const row = db.prepare('SELECT scope_group_id FROM knowledge_nodes WHERE id = ?').get('n5') as any;
      expect(row.scope_group_id).toBe('g1');
    });

    it('should reject confidence outside 0..1', () => {
      expect(() =>
        db.prepare(
          `INSERT INTO knowledge_nodes (id, tier, content, source, confidence)
           VALUES ('n6', 1, 'too confident', 'auto-extracted', 1.5)`
        ).run()
      ).toThrow();

      expect(() =>
        db.prepare(
          `INSERT INTO knowledge_nodes (id, tier, content, source, confidence)
           VALUES ('n7', 1, 'negative confidence', 'auto-extracted', -0.1)`
        ).run()
      ).toThrow();
    });
  });

  // ---------- knowledge_edges ----------
  describe('knowledge_edges', () => {
    beforeEach(() => {
      db.prepare(
        `INSERT INTO knowledge_nodes (id, tier, content, source) VALUES ('na', 1, 'Node A', 'auto-extracted')`
      ).run();
      db.prepare(
        `INSERT INTO knowledge_nodes (id, tier, content, source) VALUES ('nb', 1, 'Node B', 'auto-extracted')`
      ).run();
    });

    it('should create an edge between two nodes', () => {
      db.prepare(
        `INSERT INTO knowledge_edges (id, source_id, target_id, relationship)
         VALUES ('e1', 'na', 'nb', 'supports')`
      ).run();

      const row = db.prepare('SELECT * FROM knowledge_edges WHERE id = ?').get('e1') as any;
      expect(row).toBeDefined();
      expect(row.source_id).toBe('na');
      expect(row.target_id).toBe('nb');
      expect(row.relationship).toBe('supports');
      expect(row.weight).toBe(1.0);
    });

    it('should enforce unique constraint on (source_id, target_id, relationship)', () => {
      db.prepare(
        `INSERT INTO knowledge_edges (id, source_id, target_id, relationship)
         VALUES ('e2', 'na', 'nb', 'relates_to')`
      ).run();

      expect(() =>
        db.prepare(
          `INSERT INTO knowledge_edges (id, source_id, target_id, relationship)
           VALUES ('e3', 'na', 'nb', 'relates_to')`
        ).run()
      ).toThrow();
    });

    it('should reject invalid relationship values', () => {
      expect(() =>
        db.prepare(
          `INSERT INTO knowledge_edges (id, source_id, target_id, relationship)
           VALUES ('e4', 'na', 'nb', 'invalid_rel')`
        ).run()
      ).toThrow();
    });

    it('should cascade delete when source node is deleted', () => {
      db.prepare(
        `INSERT INTO knowledge_edges (id, source_id, target_id, relationship)
         VALUES ('e5', 'na', 'nb', 'derived_from')`
      ).run();

      db.prepare('DELETE FROM knowledge_nodes WHERE id = ?').run('na');

      const row = db.prepare('SELECT * FROM knowledge_edges WHERE id = ?').get('e5');
      expect(row).toBeUndefined();
    });

    it('should cascade delete when target node is deleted', () => {
      db.prepare(
        `INSERT INTO knowledge_edges (id, source_id, target_id, relationship)
         VALUES ('e6', 'na', 'nb', 'contradicts')`
      ).run();

      db.prepare('DELETE FROM knowledge_nodes WHERE id = ?').run('nb');

      const row = db.prepare('SELECT * FROM knowledge_edges WHERE id = ?').get('e6');
      expect(row).toBeUndefined();
    });
  });

  // ---------- knowledge_promotions ----------
  describe('knowledge_promotions', () => {
    it('should log a promotion event', () => {
      db.prepare(
        `INSERT INTO knowledge_nodes (id, tier, content, source)
         VALUES ('np', 1, 'Promotable fact', 'auto-extracted')`
      ).run();

      db.prepare(
        `INSERT INTO knowledge_promotions (id, node_id, from_tier, to_tier, trigger, evidence)
         VALUES ('p1', 'np', 1, 2, 'reinforcement', '["seen 3 times"]')`
      ).run();

      const row = db.prepare('SELECT * FROM knowledge_promotions WHERE id = ?').get('p1') as any;
      expect(row).toBeDefined();
      expect(row.node_id).toBe('np');
      expect(row.from_tier).toBe(1);
      expect(row.to_tier).toBe(2);
      expect(row.trigger).toBe('reinforcement');
      expect(row.evidence).toBe('["seen 3 times"]');
    });

    it('should cascade delete when node is deleted', () => {
      db.prepare(
        `INSERT INTO knowledge_nodes (id, tier, content, source)
         VALUES ('np2', 2, 'Another fact', 'user-created')`
      ).run();
      db.prepare(
        `INSERT INTO knowledge_promotions (id, node_id, from_tier, to_tier, trigger)
         VALUES ('p2', 'np2', 2, 3, 'user-promoted')`
      ).run();

      db.prepare('DELETE FROM knowledge_nodes WHERE id = ?').run('np2');

      const row = db.prepare('SELECT * FROM knowledge_promotions WHERE id = ?').get('p2');
      expect(row).toBeUndefined();
    });
  });

  // ---------- chat_messages ----------
  describe('chat_messages', () => {
    it('should store a user message', () => {
      db.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content)
         VALUES ('m1', 's1', 'user', 'Hello, Claude!')`
      ).run();

      const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get('m1') as any;
      expect(row).toBeDefined();
      expect(row.role).toBe('user');
      expect(row.content).toBe('Hello, Claude!');
      expect(row.message_type).toBe('text');
    });

    it('should store an assistant message with tool_calls', () => {
      db.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content, message_type, tool_calls)
         VALUES ('m2', 's1', 'assistant', 'Let me help', 'tool_use', '[{"name":"read_file","input":{}}]')`
      ).run();

      const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get('m2') as any;
      expect(row).toBeDefined();
      expect(row.role).toBe('assistant');
      expect(row.message_type).toBe('tool_use');
      expect(row.tool_calls).toBe('[{"name":"read_file","input":{}}]');
    });

    it('should reject invalid role', () => {
      expect(() =>
        db.prepare(
          `INSERT INTO chat_messages (id, session_id, role, content)
           VALUES ('m3', 's1', 'invalid_role', 'bad role')`
        ).run()
      ).toThrow();
    });

    it('should reject invalid message_type', () => {
      expect(() =>
        db.prepare(
          `INSERT INTO chat_messages (id, session_id, role, content, message_type)
           VALUES ('m4', 's1', 'user', 'bad type', 'invalid_type')`
        ).run()
      ).toThrow();
    });

    it('should cascade delete when session is deleted', () => {
      db.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content)
         VALUES ('m5', 's1', 'user', 'Cascade test')`
      ).run();

      db.prepare('DELETE FROM sessions WHERE id = ?').run('s1');

      const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get('m5');
      expect(row).toBeUndefined();
    });

    it('should support parent_message_id self-reference', () => {
      db.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content)
         VALUES ('m6', 's1', 'user', 'Parent message')`
      ).run();
      db.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content, parent_message_id)
         VALUES ('m7', 's1', 'assistant', 'Reply', 'm6')`
      ).run();

      const row = db.prepare('SELECT parent_message_id FROM chat_messages WHERE id = ?').get('m7') as any;
      expect(row.parent_message_id).toBe('m6');
    });
  });

  // ---------- session_templates ----------
  describe('session_templates', () => {
    it('should create a session template', () => {
      db.prepare(
        `INSERT INTO session_templates (id, name, working_dir, initial_prompt, group_id)
         VALUES ('t1', 'Debug Template', '/projects/app', 'Help me debug', 'g1')`
      ).run();

      const row = db.prepare('SELECT * FROM session_templates WHERE id = ?').get('t1') as any;
      expect(row).toBeDefined();
      expect(row.name).toBe('Debug Template');
      expect(row.working_dir).toBe('/projects/app');
      expect(row.knowledge_context).toBe('[]');
    });
  });

  // ---------- conversation_branches ----------
  describe('conversation_branches', () => {
    it('should create a conversation branch', () => {
      // Need a chat message to fork from
      db.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content)
         VALUES ('fork_msg', 's1', 'user', 'Fork point')`
      ).run();

      db.prepare(
        `INSERT INTO conversation_branches (id, session_id, fork_message_id, name)
         VALUES ('b1', 's1', 'fork_msg', 'Alternative approach')`
      ).run();

      const row = db.prepare('SELECT * FROM conversation_branches WHERE id = ?').get('b1') as any;
      expect(row).toBeDefined();
      expect(row.session_id).toBe('s1');
      expect(row.fork_message_id).toBe('fork_msg');
      expect(row.name).toBe('Alternative approach');
    });

    it('should cascade delete when session is deleted', () => {
      db.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content)
         VALUES ('fork_msg2', 's1', 'user', 'Fork point 2')`
      ).run();
      db.prepare(
        `INSERT INTO conversation_branches (id, session_id, fork_message_id)
         VALUES ('b2', 's1', 'fork_msg2')`
      ).run();

      db.prepare('DELETE FROM sessions WHERE id = ?').run('s1');

      const row = db.prepare('SELECT * FROM conversation_branches WHERE id = ?').get('b2');
      expect(row).toBeUndefined();
    });
  });

  // ---------- FTS5 ----------
  describe('FTS5 search', () => {
    it('should search knowledge_nodes by content', () => {
      db.prepare(
        `INSERT INTO knowledge_nodes (id, tier, content, source)
         VALUES ('fts1', 1, 'TypeScript interfaces extend other interfaces', 'auto-extracted')`
      ).run();
      db.prepare(
        `INSERT INTO knowledge_nodes (id, tier, content, source)
         VALUES ('fts2', 1, 'Python uses duck typing', 'auto-extracted')`
      ).run();

      const results = db
        .prepare(
          `SELECT kn.* FROM knowledge_nodes kn
           JOIN knowledge_nodes_fts fts ON kn.rowid = fts.rowid
           WHERE knowledge_nodes_fts MATCH 'TypeScript'`
        )
        .all() as any[];

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('fts1');
    });

    it('should search chat_messages by content', () => {
      db.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content)
         VALUES ('fts_m1', 's1', 'user', 'How do I implement a binary search tree?')`
      ).run();
      db.prepare(
        `INSERT INTO chat_messages (id, session_id, role, content)
         VALUES ('fts_m2', 's1', 'assistant', 'Here is a sorting algorithm example')`
      ).run();

      const results = db
        .prepare(
          `SELECT cm.* FROM chat_messages cm
           JOIN chat_messages_fts fts ON cm.rowid = fts.rowid
           WHERE chat_messages_fts MATCH 'binary search'`
        )
        .all() as any[];

      expect(results.length).toBe(1);
      expect(results[0].id).toBe('fts_m1');
    });

    it('should keep FTS in sync after updates to knowledge_nodes', () => {
      db.prepare(
        `INSERT INTO knowledge_nodes (id, tier, content, source)
         VALUES ('fts3', 1, 'Original content about React hooks', 'auto-extracted')`
      ).run();

      // Verify original content is searchable
      let results = db
        .prepare(
          `SELECT kn.* FROM knowledge_nodes kn
           JOIN knowledge_nodes_fts fts ON kn.rowid = fts.rowid
           WHERE knowledge_nodes_fts MATCH 'React'`
        )
        .all() as any[];
      expect(results.length).toBe(1);

      // Update content
      db.prepare(
        `UPDATE knowledge_nodes SET content = 'Updated content about Vue composables' WHERE id = 'fts3'`
      ).run();

      // Old content should no longer match
      results = db
        .prepare(
          `SELECT kn.* FROM knowledge_nodes kn
           JOIN knowledge_nodes_fts fts ON kn.rowid = fts.rowid
           WHERE knowledge_nodes_fts MATCH 'React'`
        )
        .all() as any[];
      expect(results.length).toBe(0);

      // New content should match
      results = db
        .prepare(
          `SELECT kn.* FROM knowledge_nodes kn
           JOIN knowledge_nodes_fts fts ON kn.rowid = fts.rowid
           WHERE knowledge_nodes_fts MATCH 'Vue'`
        )
        .all() as any[];
      expect(results.length).toBe(1);
    });

    it('should keep FTS in sync after deletes from knowledge_nodes', () => {
      db.prepare(
        `INSERT INTO knowledge_nodes (id, tier, content, source)
         VALUES ('fts4', 1, 'Deletable content about Angular', 'auto-extracted')`
      ).run();

      db.prepare('DELETE FROM knowledge_nodes WHERE id = ?').run('fts4');

      const results = db
        .prepare(
          `SELECT * FROM knowledge_nodes_fts WHERE knowledge_nodes_fts MATCH 'Angular'`
        )
        .all() as any[];
      expect(results.length).toBe(0);
    });
  });

  // ---------- Indexes ----------
  describe('indexes', () => {
    it('should have all expected indexes', () => {
      const indexes = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name`
        )
        .all() as { name: string }[];

      const indexNames = indexes.map((i) => i.name);

      // knowledge_nodes indexes
      expect(indexNames).toContain('idx_kn_tier');
      expect(indexNames).toContain('idx_kn_confidence');
      expect(indexNames).toContain('idx_kn_scope_group');
      expect(indexNames).toContain('idx_kn_scope_session');
      expect(indexNames).toContain('idx_kn_source');
      expect(indexNames).toContain('idx_kn_last_reinforced');

      // knowledge_edges indexes
      expect(indexNames).toContain('idx_ke_source');
      expect(indexNames).toContain('idx_ke_target');
      expect(indexNames).toContain('idx_ke_relationship');

      // knowledge_promotions indexes
      expect(indexNames).toContain('idx_kp_node');

      // chat_messages indexes
      expect(indexNames).toContain('idx_cm_session');
      expect(indexNames).toContain('idx_cm_branch');
      expect(indexNames).toContain('idx_cm_created');
      expect(indexNames).toContain('idx_cm_claude_session');

      // conversation_branches indexes
      expect(indexNames).toContain('idx_cb_session');
    });
  });
});
