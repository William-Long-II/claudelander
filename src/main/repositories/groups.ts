import { getDatabase } from '../database';
import { Group } from '../../shared/types';

export function getAllGroups(): Group[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM groups ORDER BY "order"').all() as any[];

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    color: row.color,
    workingDir: row.working_dir || '',
    order: row.order,
    createdAt: new Date(row.created_at),
    parentId: row.parent_id || null,
    collapsed: Boolean(row.collapsed),
  }));
}

export function createGroup(group: Group): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO groups (id, name, color, working_dir, "order", created_at, parent_id, collapsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    group.id,
    group.name,
    group.color,
    group.workingDir || '',
    group.order,
    group.createdAt.toISOString(),
    group.parentId || null,
    group.collapsed ? 1 : 0
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
  if (updates.workingDir !== undefined) {
    fields.push('working_dir = ?');
    values.push(updates.workingDir);
  }
  if (updates.parentId !== undefined) {
    fields.push('parent_id = ?');
    values.push(updates.parentId);
  }
  if (updates.collapsed !== undefined) {
    fields.push('collapsed = ?');
    values.push(updates.collapsed ? 1 : 0);
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
