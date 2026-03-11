import { getDatabase } from '../database';
import { ChatMessage, ChatMessageCreateInput, ChatMessageRole, ChatMessageType } from '../../shared/types';

interface ChatMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  message_type: string;
  tool_calls: string | null;
  tool_results: string | null;
  thinking: string | null;
  branch_id: string | null;
  parent_message_id: string | null;
  claude_session_id: string | null;
  created_at: string;
}

function rowToMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as ChatMessageRole,
    content: row.content,
    messageType: row.message_type as ChatMessageType,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : null,
    toolResults: row.tool_results ? JSON.parse(row.tool_results) : null,
    thinking: row.thinking,
    branchId: row.branch_id,
    parentMessageId: row.parent_message_id,
    claudeSessionId: row.claude_session_id,
    createdAt: new Date(row.created_at),
  };
}

export function createChatMessage(input: ChatMessageCreateInput): ChatMessage {
  const db = getDatabase();
  const now = new Date().toISOString();
  const messageType = input.messageType ?? 'text';
  const toolCalls = input.toolCalls ? JSON.stringify(input.toolCalls) : null;
  const toolResults = input.toolResults ? JSON.stringify(input.toolResults) : null;
  const thinking = input.thinking ?? null;
  const branchId = input.branchId ?? null;
  const parentMessageId = input.parentMessageId ?? null;
  const claudeSessionId = input.claudeSessionId ?? null;

  db.prepare(`
    INSERT INTO chat_messages (id, session_id, role, content, message_type, tool_calls, tool_results, thinking, branch_id, parent_message_id, claude_session_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.sessionId,
    input.role,
    input.content,
    messageType,
    toolCalls,
    toolResults,
    thinking,
    branchId,
    parentMessageId,
    claudeSessionId,
    now,
  );

  return getChatMessage(input.id)!;
}

export function getChatMessage(id: string): ChatMessage | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id) as ChatMessageRow | undefined;
  return row ? rowToMessage(row) : null;
}

export function deleteChatMessage(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM chat_messages WHERE id = ?').run(id);
}

export function getMessagesBySession(
  sessionId: string,
  limit: number = 100,
  offset: number = 0,
): ChatMessage[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM chat_messages
    WHERE session_id = ? AND branch_id IS NULL
    ORDER BY created_at ASC
    LIMIT ? OFFSET ?
  `).all(sessionId, limit, offset) as ChatMessageRow[];
  return rows.map(rowToMessage);
}

export function getMessagesByBranch(
  branchId: string,
  limit: number = 100,
): ChatMessage[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM chat_messages
    WHERE branch_id = ?
    ORDER BY created_at ASC
    LIMIT ?
  `).all(branchId, limit) as ChatMessageRow[];
  return rows.map(rowToMessage);
}

export function searchMessages(
  query: string,
  sessionId?: string,
  limit: number = 20,
): ChatMessage[] {
  const db = getDatabase();

  let sql = `
    SELECT cm.* FROM chat_messages cm
    JOIN chat_messages_fts fts ON cm.rowid = fts.rowid
    WHERE chat_messages_fts MATCH ?
  `;
  const params: (string | number)[] = [query];

  if (sessionId) {
    sql += ' AND cm.session_id = ?';
    params.push(sessionId);
  }

  sql += ' ORDER BY cm.created_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as ChatMessageRow[];
  return rows.map(rowToMessage);
}

export function getLastMessageForSession(sessionId: string): ChatMessage | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM chat_messages
    WHERE session_id = ? AND branch_id IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId) as ChatMessageRow | undefined;
  return row ? rowToMessage(row) : null;
}

export function getMessageCountForSession(sessionId: string): number {
  const db = getDatabase();
  const result = db.prepare(
    'SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ?'
  ).get(sessionId) as { count: number };
  return result.count;
}
