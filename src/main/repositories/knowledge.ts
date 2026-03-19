import { getDatabase } from '../database';
import {
  KnowledgeNode,
  KnowledgeEdge,
  KnowledgePromotion,
  KnowledgeNodeCreateInput,
  KnowledgeNodeUpdateInput,
  KnowledgeEdgeCreateInput,
  KnowledgeTier,
  KnowledgeSource,
  KnowledgeRelationship,
} from '../../shared/types';

// ── Row types (snake_case from SQLite) ───────────────────────────────────────

interface KnowledgeNodeRow {
  id: string;
  tier: number;
  content: string;
  confidence: number;
  source: string;
  scope_session_id: string | null;
  scope_group_id: string | null;
  domains: string;
  tags: string;
  created_at: string;
  last_reinforced_at: string;
}

interface KnowledgeEdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  relationship: string;
  weight: number;
  created_at: string;
}

interface KnowledgePromotionRow {
  id: string;
  node_id: string;
  from_tier: number;
  to_tier: number;
  trigger: string;
  evidence: string;
  promoted_at: string;
}

// ── Row mappers ──────────────────────────────────────────────────────────────

function rowToNode(row: KnowledgeNodeRow): KnowledgeNode {
  return {
    id: row.id,
    tier: row.tier as KnowledgeTier,
    content: row.content,
    confidence: row.confidence,
    source: row.source as KnowledgeSource,
    scopeSessionId: row.scope_session_id,
    scopeGroupId: row.scope_group_id,
    domains: row.domains ? JSON.parse(row.domains) : [],
    tags: row.tags ? JSON.parse(row.tags) : [],
    createdAt: new Date(row.created_at),
    lastReinforcedAt: new Date(row.last_reinforced_at),
  };
}

function rowToEdge(row: KnowledgeEdgeRow): KnowledgeEdge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    relationship: row.relationship as KnowledgeRelationship,
    weight: row.weight,
    createdAt: new Date(row.created_at),
  };
}

function rowToPromotion(row: KnowledgePromotionRow): KnowledgePromotion {
  return {
    id: row.id,
    nodeId: row.node_id,
    fromTier: row.from_tier as KnowledgeTier,
    toTier: row.to_tier as KnowledgeTier,
    trigger: row.trigger,
    evidence: row.evidence ? JSON.parse(row.evidence) : [],
    promotedAt: new Date(row.promoted_at),
  };
}

// ── Node CRUD ────────────────────────────────────────────────────────────────

export function createKnowledgeNode(input: KnowledgeNodeCreateInput): KnowledgeNode {
  const db = getDatabase();
  const now = new Date().toISOString();
  const confidence = input.confidence ?? 1.0;
  const domains = JSON.stringify(input.domains ?? []);
  const tags = JSON.stringify(input.tags ?? []);
  const scopeSessionId = input.scopeSessionId ?? null;
  const scopeGroupId = input.scopeGroupId ?? null;

  db.prepare(`
    INSERT INTO knowledge_nodes (id, tier, content, confidence, source, scope_session_id, scope_group_id, domains, tags, created_at, last_reinforced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(input.id, input.tier, input.content, confidence, input.source, scopeSessionId, scopeGroupId, domains, tags, now, now);

  return getKnowledgeNode(input.id)!;
}

export function getKnowledgeNode(id: string): KnowledgeNode | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM knowledge_nodes WHERE id = ?').get(id) as KnowledgeNodeRow | undefined;
  return row ? rowToNode(row) : null;
}

export function updateKnowledgeNode(id: string, updates: KnowledgeNodeUpdateInput): void {
  const db = getDatabase();
  const sets: string[] = [];
  const values: (string | number)[] = [];

  if (updates.content !== undefined) {
    sets.push('content = ?');
    values.push(updates.content);
  }
  if (updates.tier !== undefined) {
    sets.push('tier = ?');
    values.push(updates.tier);
  }
  if (updates.confidence !== undefined) {
    sets.push('confidence = ?');
    values.push(updates.confidence);
  }
  if (updates.domains !== undefined) {
    sets.push('domains = ?');
    values.push(JSON.stringify(updates.domains));
  }
  if (updates.tags !== undefined) {
    sets.push('tags = ?');
    values.push(JSON.stringify(updates.tags));
  }

  if (sets.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE knowledge_nodes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteKnowledgeNode(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM knowledge_nodes WHERE id = ?').run(id);
}

// ── Node Queries ─────────────────────────────────────────────────────────────

export function getKnowledgeNodesByTier(tier: KnowledgeTier, limit: number = 100): KnowledgeNode[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT * FROM knowledge_nodes WHERE tier = ? ORDER BY last_reinforced_at DESC LIMIT ?'
  ).all(tier, limit) as KnowledgeNodeRow[];
  return rows.map(rowToNode);
}

export function getKnowledgeNodesByDomain(domain: string, limit: number = 100): KnowledgeNode[] {
  const db = getDatabase();
  const pattern = `%"${domain}"%`;
  const rows = db.prepare(
    'SELECT * FROM knowledge_nodes WHERE domains LIKE ? ORDER BY confidence DESC LIMIT ?'
  ).all(pattern, limit) as KnowledgeNodeRow[];
  return rows.map(rowToNode);
}

export function getKnowledgeNodesByGroup(groupId: string, limit: number = 100): KnowledgeNode[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT * FROM knowledge_nodes WHERE scope_group_id = ? OR scope_group_id IS NULL LIMIT ?'
  ).all(groupId, limit) as KnowledgeNodeRow[];
  return rows.map(rowToNode);
}

export function searchKnowledgeNodes(query: string, limit: number = 20): KnowledgeNode[] {
  const db = getDatabase();
  // Wrap in double quotes to treat as phrase search and prevent FTS5 operator injection
  const safeQuery = '"' + query.replace(/"/g, '""') + '"';
  const rows = db.prepare(`
    SELECT kn.* FROM knowledge_nodes kn
    JOIN knowledge_nodes_fts fts ON kn.rowid = fts.rowid
    WHERE knowledge_nodes_fts MATCH ?
    ORDER BY kn.confidence DESC
    LIMIT ?
  `).all(safeQuery, limit) as KnowledgeNodeRow[];
  return rows.map(rowToNode);
}

export function reinforceKnowledgeNode(id: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE knowledge_nodes
    SET last_reinforced_at = ?,
        confidence = MIN(confidence + 0.1, 1.0)
    WHERE id = ?
  `).run(now, id);
}

// ── Edge CRUD ────────────────────────────────────────────────────────────────

export function createKnowledgeEdge(input: KnowledgeEdgeCreateInput): KnowledgeEdge {
  const db = getDatabase();
  const now = new Date().toISOString();
  const weight = input.weight ?? 1.0;

  db.prepare(`
    INSERT INTO knowledge_edges (id, source_id, target_id, relationship, weight, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.id, input.sourceId, input.targetId, input.relationship, weight, now);

  const row = db.prepare('SELECT * FROM knowledge_edges WHERE id = ?').get(input.id) as KnowledgeEdgeRow;
  return rowToEdge(row);
}

export function getEdgesForNode(nodeId: string, direction: 'outgoing' | 'incoming' | 'both' = 'both'): KnowledgeEdge[] {
  const db = getDatabase();
  let rows: KnowledgeEdgeRow[];

  if (direction === 'outgoing') {
    rows = db.prepare('SELECT * FROM knowledge_edges WHERE source_id = ?').all(nodeId) as KnowledgeEdgeRow[];
  } else if (direction === 'incoming') {
    rows = db.prepare('SELECT * FROM knowledge_edges WHERE target_id = ?').all(nodeId) as KnowledgeEdgeRow[];
  } else {
    rows = db.prepare('SELECT * FROM knowledge_edges WHERE source_id = ? OR target_id = ?').all(nodeId, nodeId) as KnowledgeEdgeRow[];
  }

  return rows.map(rowToEdge);
}

export function deleteKnowledgeEdge(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM knowledge_edges WHERE id = ?').run(id);
}

// ── Promotion ────────────────────────────────────────────────────────────────

export function logPromotion(input: {
  id: string;
  nodeId: string;
  fromTier: KnowledgeTier;
  toTier: KnowledgeTier;
  trigger: string;
  evidence: string[];
}): KnowledgePromotion {
  const db = getDatabase();
  const now = new Date().toISOString();
  const evidence = JSON.stringify(input.evidence);

  db.prepare(`
    INSERT INTO knowledge_promotions (id, node_id, from_tier, to_tier, trigger, evidence, promoted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(input.id, input.nodeId, input.fromTier, input.toTier, input.trigger, evidence, now);

  const row = db.prepare('SELECT * FROM knowledge_promotions WHERE id = ?').get(input.id) as KnowledgePromotionRow;
  return rowToPromotion(row);
}

export function getPromotionHistory(nodeId: string): KnowledgePromotion[] {
  const db = getDatabase();
  const rows = db.prepare(
    'SELECT * FROM knowledge_promotions WHERE node_id = ? ORDER BY promoted_at DESC'
  ).all(nodeId) as KnowledgePromotionRow[];
  return rows.map(rowToPromotion);
}

// ── Knowledge Injection ──────────────────────────────────────────────────

export function getKnowledgeForInjection(options?: {
  scopeGroupId?: string;
  scopeSessionId?: string;
  limit?: number;
}): KnowledgeNode[] {
  const db = getDatabase();
  const limit = options?.limit ?? 20;
  // T2/T3 nodes (patterns/principles) are always globally visible.
  // T1 facts respect session/group scoping.
  const rows = db.prepare(`
    SELECT * FROM knowledge_nodes
    WHERE confidence >= 0.3
      AND (
        tier >= 2
        OR (scope_group_id IS NULL OR scope_group_id = ?)
           AND (scope_session_id IS NULL OR scope_session_id = ?)
      )
    ORDER BY tier DESC, confidence DESC, last_reinforced_at DESC
    LIMIT ?
  `).all(
    options?.scopeGroupId ?? null,
    options?.scopeSessionId ?? null,
    limit
  ) as KnowledgeNodeRow[];
  return rows.map(rowToNode);
}

// ── Confidence Decay ─────────────────────────────────────────────────────────

export function getNodesWithDecayedConfidence(daysSinceReinforcement: number): KnowledgeNode[] {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - daysSinceReinforcement * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT * FROM knowledge_nodes
    WHERE last_reinforced_at < ? AND confidence > 0.1
  `).all(cutoff) as KnowledgeNodeRow[];
  return rows.map(rowToNode);
}

export function applyConfidenceDecay(decayRate: number, daysSinceReinforcement: number): number {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - daysSinceReinforcement * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(`
    UPDATE knowledge_nodes
    SET confidence = MAX(confidence - ?, 0.0)
    WHERE last_reinforced_at < ? AND confidence > 0.1
  `).run(decayRate, cutoff);
  return result.changes;
}
