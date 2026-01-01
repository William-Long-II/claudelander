import { getDatabase } from '../database';
import { Group } from '../../shared/types';

export function getAllGroups(): Group[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM groups ORDER BY "order"').all() as any[];

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    color: row.color,
    order: row.order,
    createdAt: new Date(row.created_at),
  }));
}

export function createGroup(group: Group): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO groups (id, name, color, "order", created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    group.id,
    group.name,
    group.color,
    group.order,
    group.createdAt.toISOString()
  );
}

export function updateGroup(id: string, updates: Partial<Group>): void {
  const db = getDatabase();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.color !== undefined) {
    fields.push('color = ?');
    values.push(updates.color);
  }
  if (updates.order !== undefined) {
    fields.push('"order" = ?');
    values.push(updates.order);
  }

  if (fields.length > 0) {
    values.push(id);
    db.prepare(`UPDATE groups SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
}

export function deleteGroup(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
}
