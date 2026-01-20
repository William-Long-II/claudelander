import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'claudelander.db');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  initializeTables(db);

  return db;
}

function initializeTables(database: Database.Database): void {
  database.exec(`
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

    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT
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

    CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
    CREATE INDEX IF NOT EXISTS idx_memories_group ON memories(group_id);
    CREATE INDEX IF NOT EXISTS idx_memories_pinned ON memories(pinned) WHERE pinned = 1;
  `);

  // Migration: Add working_dir column to groups if it doesn't exist
  const columns = database.prepare("PRAGMA table_info(groups)").all() as { name: string }[];
  if (!columns.some(col => col.name === 'working_dir')) {
    database.exec("ALTER TABLE groups ADD COLUMN working_dir TEXT DEFAULT ''");
  }

  // Migration: Add parent_id column to groups if it doesn't exist
  if (!columns.some(col => col.name === 'parent_id')) {
    database.exec("ALTER TABLE groups ADD COLUMN parent_id TEXT DEFAULT NULL");
  }

  // Migration: Add collapsed column to groups if it doesn't exist
  if (!columns.some(col => col.name === 'collapsed')) {
    database.exec("ALTER TABLE groups ADD COLUMN collapsed INTEGER DEFAULT 0");
  }

  // FTS5 for memory search - create if not exists
  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        content=memories,
        content_rowid=rowid
      );

      -- Sync triggers for FTS
      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
        INSERT INTO memories_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END;
    `);
  } catch {
    // FTS5 tables/triggers may already exist, ignore errors
  }

  // Insert default group if none exists
  const groupCount = database.prepare('SELECT COUNT(*) as count FROM groups').get() as { count: number };
  if (groupCount.count === 0) {
    database.prepare(`
      INSERT INTO groups (id, name, color, working_dir, "order")
      VALUES ('default', 'Default', '#e06c75', '', 0)
    `).run();
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
