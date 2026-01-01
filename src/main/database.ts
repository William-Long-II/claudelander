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
  `);

  // Insert default group if none exists
  const groupCount = database.prepare('SELECT COUNT(*) as count FROM groups').get() as { count: number };
  if (groupCount.count === 0) {
    database.prepare(`
      INSERT INTO groups (id, name, color, "order")
      VALUES ('default', 'Default', '#e06c75', 0)
    `).run();
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
