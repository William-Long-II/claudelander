import { getDatabase } from '../database';
import { Session, SessionState } from '../../shared/types';

export function getAllSessions(): Session[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM sessions ORDER BY "order"').all() as any[];

  return rows.map(row => ({
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    workingDir: row.working_dir,
    state: row.state as SessionState,
    shellType: row.shell_type,
    order: row.order,
    createdAt: new Date(row.created_at),
    lastActivityAt: new Date(row.last_activity_at),
  }));
}

export function createSession(session: Session): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO sessions (id, group_id, name, working_dir, state, shell_type, "order", created_at, last_activity_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.groupId,
    session.name,
    session.workingDir,
    session.state,
    session.shellType,
    session.order,
    session.createdAt.toISOString(),
    session.lastActivityAt.toISOString()
  );
}

export function updateSession(id: string, updates: Partial<Session>): void {
  const db = getDatabase();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.groupId !== undefined) {
    fields.push('group_id = ?');
    values.push(updates.groupId);
  }
  if (updates.state !== undefined) {
    fields.push('state = ?');
    values.push(updates.state);
  }
  if (updates.order !== undefined) {
    fields.push('"order" = ?');
    values.push(updates.order);
  }
  if (updates.lastActivityAt !== undefined) {
    fields.push('last_activity_at = ?');
    values.push(updates.lastActivityAt.toISOString());
  }

  if (fields.length > 0) {
    values.push(id);
    db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
}

export function deleteSession(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}
