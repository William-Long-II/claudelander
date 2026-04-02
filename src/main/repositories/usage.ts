import { getDatabase } from '../database';
import { SessionUsage, MessageUsage } from '../../shared/types';

function rowToUsage(row: any): SessionUsage {
  return {
    sessionId: row.session_id,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    totalCacheReadTokens: row.total_cache_read_tokens,
    totalCacheCreationTokens: row.total_cache_creation_tokens,
    totalCostUsd: row.total_cost_usd,
    messageCount: row.message_count,
    lastUpdatedAt: new Date(row.last_updated_at),
  };
}

export function getSessionUsage(sessionId: string): SessionUsage | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM session_usage WHERE session_id = ?').get(sessionId) as any;
  return row ? rowToUsage(row) : null;
}

export function getAllSessionUsage(): SessionUsage[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM session_usage').all() as any[];
  return rows.map(rowToUsage);
}

/**
 * Add a message's token usage to the session's running total.
 * Uses upsert so the first call creates the row.
 */
export function addMessageUsage(sessionId: string, usage: MessageUsage, costUsd: number): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO session_usage (session_id, total_input_tokens, total_output_tokens, total_cache_read_tokens, total_cache_creation_tokens, total_cost_usd, message_count, last_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(session_id) DO UPDATE SET
      total_input_tokens = total_input_tokens + excluded.total_input_tokens,
      total_output_tokens = total_output_tokens + excluded.total_output_tokens,
      total_cache_read_tokens = total_cache_read_tokens + excluded.total_cache_read_tokens,
      total_cache_creation_tokens = total_cache_creation_tokens + excluded.total_cache_creation_tokens,
      total_cost_usd = total_cost_usd + excluded.total_cost_usd,
      message_count = message_count + 1,
      last_updated_at = datetime('now')
  `).run(
    sessionId,
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadInputTokens,
    usage.cacheCreationInputTokens,
    costUsd,
  );
}

export function resetSessionUsage(sessionId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM session_usage WHERE session_id = ?').run(sessionId);
}

/** Get total cost across all sessions */
export function getTotalCost(): number {
  const db = getDatabase();
  const row = db.prepare('SELECT COALESCE(SUM(total_cost_usd), 0) as total FROM session_usage').get() as any;
  return row.total;
}
