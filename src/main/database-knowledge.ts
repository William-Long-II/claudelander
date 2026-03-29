import Database from 'better-sqlite3';

/**
 * Creates the knowledge graph, chat message, template, and branch tables
 * alongside the existing ClaudeLander schema.
 *
 * Designed to be called once during database initialisation (idempotent
 * thanks to IF NOT EXISTS guards on every DDL statement).
 */
export function initKnowledgeGraphTables(database: Database.Database): void {
  // ── Core knowledge graph tables ──────────────────────────────────────

  database.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_nodes (
      id TEXT PRIMARY KEY,
      tier INTEGER NOT NULL CHECK(tier IN (1, 2, 3)),
      content TEXT NOT NULL,
      confidence REAL DEFAULT 1.0 CHECK(confidence >= 0.0 AND confidence <= 1.0),
      source TEXT NOT NULL CHECK(source IN ('auto-extracted', 'user-created', 'promoted')),
      scope_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      scope_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
      domains TEXT NOT NULL DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_reinforced_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL CHECK(relationship IN (
        'derived_from', 'supports', 'contradicts', 'relates_to', 'applied_in', 'same_domain'
      )),
      weight REAL DEFAULT 1.0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_id, target_id, relationship)
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_promotions (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
      from_tier INTEGER NOT NULL,
      to_tier INTEGER NOT NULL,
      trigger TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '[]',
      promoted_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Chat / conversation tables ───────────────────────────────────────

  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'error')),
      content TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text' CHECK(message_type IN ('text', 'tool_use', 'tool_result', 'thinking', 'system')),
      tool_calls TEXT,
      tool_results TEXT,
      thinking TEXT,
      branch_id TEXT,
      parent_message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
      claude_session_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS session_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      working_dir TEXT,
      initial_prompt TEXT,
      knowledge_context TEXT DEFAULT '[]',
      group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS conversation_branches (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      parent_branch_id TEXT REFERENCES conversation_branches(id) ON DELETE SET NULL,
      fork_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ── Indexes ──────────────────────────────────────────────────────────

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_kn_tier ON knowledge_nodes(tier);
    CREATE INDEX IF NOT EXISTS idx_kn_confidence ON knowledge_nodes(confidence);
    CREATE INDEX IF NOT EXISTS idx_kn_scope_group ON knowledge_nodes(scope_group_id);
    CREATE INDEX IF NOT EXISTS idx_kn_scope_session ON knowledge_nodes(scope_session_id);
    CREATE INDEX IF NOT EXISTS idx_kn_source ON knowledge_nodes(source);
    CREATE INDEX IF NOT EXISTS idx_kn_last_reinforced ON knowledge_nodes(last_reinforced_at);

    CREATE INDEX IF NOT EXISTS idx_ke_source ON knowledge_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_ke_target ON knowledge_edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_ke_relationship ON knowledge_edges(relationship);

    CREATE INDEX IF NOT EXISTS idx_kp_node ON knowledge_promotions(node_id);

    CREATE INDEX IF NOT EXISTS idx_cm_session ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_cm_branch ON chat_messages(branch_id);
    CREATE INDEX IF NOT EXISTS idx_cm_created ON chat_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_cm_claude_session ON chat_messages(claude_session_id);

    CREATE INDEX IF NOT EXISTS idx_cb_session ON conversation_branches(session_id);
  `);

  // ── FTS5 virtual tables + sync triggers ──────────────────────────────

  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_nodes_fts USING fts5(
        content,
        content=knowledge_nodes,
        content_rowid=rowid
      );
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS knowledge_nodes_ai AFTER INSERT ON knowledge_nodes BEGIN
        INSERT INTO knowledge_nodes_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END;

      CREATE TRIGGER IF NOT EXISTS knowledge_nodes_ad AFTER DELETE ON knowledge_nodes BEGIN
        INSERT INTO knowledge_nodes_fts(knowledge_nodes_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
      END;

      CREATE TRIGGER IF NOT EXISTS knowledge_nodes_au AFTER UPDATE ON knowledge_nodes BEGIN
        INSERT INTO knowledge_nodes_fts(knowledge_nodes_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
        INSERT INTO knowledge_nodes_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END;
    `);
  } catch (e) {
    // Triggers may already exist from a prior run; safe to ignore.
    console.log('knowledge_nodes FTS5 setup (may already exist):', e);
  }

  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts USING fts5(
        content,
        content=chat_messages,
        content_rowid=rowid
      );
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS chat_messages_ai AFTER INSERT ON chat_messages BEGIN
        INSERT INTO chat_messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END;

      CREATE TRIGGER IF NOT EXISTS chat_messages_ad AFTER DELETE ON chat_messages BEGIN
        INSERT INTO chat_messages_fts(chat_messages_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
      END;

      CREATE TRIGGER IF NOT EXISTS chat_messages_au AFTER UPDATE ON chat_messages BEGIN
        INSERT INTO chat_messages_fts(chat_messages_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
        INSERT INTO chat_messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END;
    `);
  } catch (e) {
    // Triggers may already exist from a prior run; safe to ignore.
    console.log('chat_messages FTS5 setup (may already exist):', e);
  }
}
