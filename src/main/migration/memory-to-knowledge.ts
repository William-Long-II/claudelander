import { getDatabase } from '../database';
import type { KnowledgeSource } from '../../shared/types';

export interface MigrationResult {
  migrated: number;
  skipped: number;
  errors: number;
}

interface MemoryRow {
  id: string;
  session_id: string | null;
  group_id: string;
  type: string;
  content: string;
  source: string | null;
  tags: string | null;
  pinned: number;
  created_at: string;
}

/**
 * Map legacy 2.x memory source values to 3.0 knowledge node sources.
 */
function mapSource(memorySource: string | null): KnowledgeSource {
  switch (memorySource) {
    case 'manual':
      return 'user-created';
    case 'auto':
    case 'claude':
    default:
      return 'auto-extracted';
  }
}

/**
 * Parse tags from a memory row.  The tags column may be:
 *   - null / undefined  -> []
 *   - empty string      -> []
 *   - a JSON array      -> parsed array
 */
function parseTags(raw: string | null): string[] {
  if (!raw || raw.trim() === '') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Migrates existing 2.x `memories` table rows into 3.0 `knowledge_nodes`
 * (Tier 1 facts).
 *
 * This function is **idempotent**: it checks whether a node with
 * `id = "migrated-{memory.id}"` already exists before inserting, and
 * skips any that do.
 */
export function migrateMemoriesToKnowledge(): MigrationResult {
  const db = getDatabase();

  const result: MigrationResult = {
    migrated: 0,
    skipped: 0,
    errors: 0,
  };

  // Fetch all memories
  const memories = db.prepare('SELECT * FROM memories').all() as MemoryRow[];

  // Prepared statements for checking existence and inserting
  const checkStmt = db.prepare('SELECT 1 FROM knowledge_nodes WHERE id = ?');
  const insertStmt = db.prepare(`
    INSERT INTO knowledge_nodes
      (id, tier, content, confidence, source, scope_session_id, scope_group_id, domains, tags, created_at, last_reinforced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const migrateAll = db.transaction(() => {
    for (const memory of memories) {
      const nodeId = `migrated-${memory.id}`;

      // Idempotency: skip if already migrated
      const existing = checkStmt.get(nodeId);
      if (existing) {
        result.skipped++;
        continue;
      }

      try {
        const source = mapSource(memory.source);
        const confidence = memory.pinned === 1 ? 1.0 : 0.8;
        const domains = JSON.stringify([memory.type]);
        const tags = JSON.stringify(parseTags(memory.tags));
        const createdAt = memory.created_at;

        insertStmt.run(
          nodeId,
          1, // tier 1 (fact)
          memory.content,
          confidence,
          source,
          memory.session_id,
          memory.group_id,
          domains,
          tags,
          createdAt,
          createdAt, // last_reinforced_at = created_at
        );

        result.migrated++;
      } catch {
        result.errors++;
      }
    }
  });

  migrateAll();

  return result;
}
