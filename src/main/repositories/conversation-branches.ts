import { getDatabase } from '../database';
import { ConversationBranch } from '../../shared/types';

interface ConversationBranchRow {
  id: string;
  session_id: string;
  parent_branch_id: string | null;
  fork_message_id: string;
  name: string | null;
  created_at: string;
}

function rowToBranch(row: ConversationBranchRow): ConversationBranch {
  return {
    id: row.id,
    sessionId: row.session_id,
    parentBranchId: row.parent_branch_id,
    forkMessageId: row.fork_message_id,
    name: row.name,
    createdAt: new Date(row.created_at),
  };
}

export function createBranch(input: {
  id: string;
  sessionId: string;
  parentBranchId?: string;
  forkMessageId: string;
  name?: string;
}): ConversationBranch {
  const db = getDatabase();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO conversation_branches (id, session_id, parent_branch_id, fork_message_id, name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.sessionId,
    input.parentBranchId ?? null,
    input.forkMessageId,
    input.name ?? null,
    now,
  );

  return getBranch(input.id)!;
}

export function getBranch(id: string): ConversationBranch | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM conversation_branches WHERE id = ?').get(id) as ConversationBranchRow | undefined;
  return row ? rowToBranch(row) : null;
}

export function getBranchesBySession(sessionId: string): ConversationBranch[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT * FROM conversation_branches WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as ConversationBranchRow[];
  return rows.map(rowToBranch);
}

export function deleteBranch(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM conversation_branches WHERE id = ?').run(id);
  return result.changes > 0;
}
