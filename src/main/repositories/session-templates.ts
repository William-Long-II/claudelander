import { getDatabase } from '../database';
import { SessionTemplate, SessionTemplateCreateInput } from '../../shared/types';

interface SessionTemplateRow {
  id: string;
  name: string;
  working_dir: string | null;
  initial_prompt: string | null;
  knowledge_context: string | null;
  group_id: string | null;
  created_at: string;
  updated_at: string | null;
}

function rowToSessionTemplate(row: SessionTemplateRow): SessionTemplate {
  return {
    id: row.id,
    name: row.name,
    workingDir: row.working_dir,
    initialPrompt: row.initial_prompt,
    knowledgeContext: row.knowledge_context ? JSON.parse(row.knowledge_context) : [],
    groupId: row.group_id,
    createdAt: new Date(row.created_at),
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  };
}

export function createSessionTemplate(input: SessionTemplateCreateInput): SessionTemplate {
  const db = getDatabase();
  const now = new Date().toISOString();
  const knowledgeContext = input.knowledgeContext ? JSON.stringify(input.knowledgeContext) : '[]';

  db.prepare(`
    INSERT INTO session_templates (id, name, working_dir, initial_prompt, knowledge_context, group_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.name,
    input.workingDir ?? null,
    input.initialPrompt ?? null,
    knowledgeContext,
    input.groupId ?? null,
    now,
  );

  return getSessionTemplate(input.id)!;
}

export function getSessionTemplate(id: string): SessionTemplate | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM session_templates WHERE id = ?').get(id) as SessionTemplateRow | undefined;
  return row ? rowToSessionTemplate(row) : null;
}

export function getAllSessionTemplates(): SessionTemplate[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM session_templates ORDER BY created_at DESC').all() as SessionTemplateRow[];
  return rows.map(rowToSessionTemplate);
}

export function getSessionTemplatesByGroup(groupId: string): SessionTemplate[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM session_templates WHERE group_id = ? ORDER BY created_at DESC').all(groupId) as SessionTemplateRow[];
  return rows.map(rowToSessionTemplate);
}

export function updateSessionTemplate(id: string, updates: Partial<SessionTemplateCreateInput>): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  const sets: string[] = ['updated_at = ?'];
  const values: (string | null)[] = [now];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    values.push(updates.name);
  }
  if (updates.workingDir !== undefined) {
    sets.push('working_dir = ?');
    values.push(updates.workingDir ?? null);
  }
  if (updates.initialPrompt !== undefined) {
    sets.push('initial_prompt = ?');
    values.push(updates.initialPrompt ?? null);
  }
  if (updates.knowledgeContext !== undefined) {
    sets.push('knowledge_context = ?');
    values.push(JSON.stringify(updates.knowledgeContext));
  }
  if (updates.groupId !== undefined) {
    sets.push('group_id = ?');
    values.push(updates.groupId ?? null);
  }

  values.push(id);
  db.prepare(`UPDATE session_templates SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteSessionTemplate(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM session_templates WHERE id = ?').run(id);
  return result.changes > 0;
}
