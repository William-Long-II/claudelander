import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initKnowledgeGraphTables } from '../main/database-knowledge';

// We need to mock ../main/database so the repository uses our in-memory DB
let testDb: Database.Database;

vi.mock('../main/database', () => ({
  getDatabase: () => testDb,
}));

// Import repository functions AFTER the mock is set up
import {
  createKnowledgeNode,
  getKnowledgeNode,
  updateKnowledgeNode,
  deleteKnowledgeNode,
  getKnowledgeNodesByTier,
  getKnowledgeNodesByDomain,
  getKnowledgeNodesByGroup,
  searchKnowledgeNodes,
  reinforceKnowledgeNode,
  createKnowledgeEdge,
  getEdgesForNode,
  deleteKnowledgeEdge,
  logPromotion,
  getPromotionHistory,
  getNodesWithDecayedConfidence,
  applyConfidenceDecay,
} from '../main/repositories/knowledge';

/**
 * Helper: create prerequisite tables (groups, sessions) that the knowledge
 * graph tables reference via foreign keys.
 */
function createPrerequisiteTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#888888',
      working_dir TEXT DEFAULT '',
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
  `);

  // Seed a group and session so FK references succeed
  db.prepare(`INSERT INTO groups (id, name) VALUES ('g1', 'Test Group')`).run();
  db.prepare(`INSERT INTO groups (id, name) VALUES ('g2', 'Other Group')`).run();
  db.prepare(
    `INSERT INTO sessions (id, group_id, name, working_dir) VALUES ('s1', 'g1', 'Test Session', '/tmp')`
  ).run();
}

describe('Knowledge Node Repository', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');
    createPrerequisiteTables(testDb);
    initKnowledgeGraphTables(testDb);
  });

  afterEach(() => {
    testDb.close();
  });

  // ---------- Node CRUD ----------
  describe('createKnowledgeNode', () => {
    it('should create a tier 1 fact with domains', () => {
      const node = createKnowledgeNode({
        id: 'kn-001',
        tier: 1,
        content: 'TypeScript uses .ts extension',
        source: 'auto-extracted',
        domains: ['typescript', 'files'],
        tags: ['basics'],
      });

      expect(node.id).toBe('kn-001');
      expect(node.tier).toBe(1);
      expect(node.content).toBe('TypeScript uses .ts extension');
      expect(node.source).toBe('auto-extracted');
      expect(node.confidence).toBe(1.0);
      expect(node.domains).toEqual(['typescript', 'files']);
      expect(node.tags).toEqual(['basics']);
      expect(node.createdAt).toBeInstanceOf(Date);
      expect(node.lastReinforcedAt).toBeInstanceOf(Date);
    });

    it('should default domains to empty array', () => {
      const node = createKnowledgeNode({
        id: 'kn-002',
        tier: 2,
        content: 'No domains specified',
        source: 'user-created',
      });

      expect(node.domains).toEqual([]);
      expect(node.tags).toEqual([]);
      expect(node.confidence).toBe(1.0);
    });
  });

  describe('getKnowledgeNode', () => {
    it('should return null for nonexistent node', () => {
      const result = getKnowledgeNode('nonexistent');
      expect(result).toBeNull();
    });

    it('should return parsed domains/tags', () => {
      createKnowledgeNode({
        id: 'kn-003',
        tier: 1,
        content: 'Test node',
        source: 'auto-extracted',
        domains: ['domain1', 'domain2'],
        tags: ['tag1', 'tag2'],
      });

      const node = getKnowledgeNode('kn-003');
      expect(node).not.toBeNull();
      expect(node!.domains).toEqual(['domain1', 'domain2']);
      expect(node!.tags).toEqual(['tag1', 'tag2']);
      expect(node!.scopeSessionId).toBeNull();
      expect(node!.scopeGroupId).toBeNull();
    });
  });

  describe('updateKnowledgeNode', () => {
    it('should update content and confidence', () => {
      createKnowledgeNode({
        id: 'kn-upd',
        tier: 1,
        content: 'Original',
        source: 'auto-extracted',
      });

      updateKnowledgeNode('kn-upd', {
        content: 'Updated content',
        confidence: 0.8,
      });

      const node = getKnowledgeNode('kn-upd');
      expect(node!.content).toBe('Updated content');
      expect(node!.confidence).toBe(0.8);
    });

    it('should update domains and tags', () => {
      createKnowledgeNode({
        id: 'kn-upd2',
        tier: 1,
        content: 'Original',
        source: 'auto-extracted',
      });

      updateKnowledgeNode('kn-upd2', {
        domains: ['new-domain'],
        tags: ['new-tag'],
      });

      const node = getKnowledgeNode('kn-upd2');
      expect(node!.domains).toEqual(['new-domain']);
      expect(node!.tags).toEqual(['new-tag']);
    });
  });

  describe('deleteKnowledgeNode', () => {
    it('should delete a node', () => {
      createKnowledgeNode({
        id: 'kn-del',
        tier: 1,
        content: 'To be deleted',
        source: 'auto-extracted',
      });

      deleteKnowledgeNode('kn-del');
      expect(getKnowledgeNode('kn-del')).toBeNull();
    });
  });

  // ---------- Node Queries ----------
  describe('getKnowledgeNodesByTier', () => {
    it('should filter by tier correctly', () => {
      createKnowledgeNode({ id: 'kn-t1a', tier: 1, content: 'Tier 1 A', source: 'auto-extracted' });
      createKnowledgeNode({ id: 'kn-t1b', tier: 1, content: 'Tier 1 B', source: 'auto-extracted' });
      createKnowledgeNode({ id: 'kn-t2a', tier: 2, content: 'Tier 2 A', source: 'user-created' });
      createKnowledgeNode({ id: 'kn-t3a', tier: 3, content: 'Tier 3 A', source: 'promoted' });

      const tier1 = getKnowledgeNodesByTier(1);
      expect(tier1).toHaveLength(2);
      expect(tier1.every((n) => n.tier === 1)).toBe(true);

      const tier2 = getKnowledgeNodesByTier(2);
      expect(tier2).toHaveLength(1);
      expect(tier2[0].id).toBe('kn-t2a');

      const tier3 = getKnowledgeNodesByTier(3);
      expect(tier3).toHaveLength(1);
    });
  });

  describe('getKnowledgeNodesByDomain', () => {
    it('should find nodes containing domain', () => {
      createKnowledgeNode({
        id: 'kn-d1',
        tier: 1,
        content: 'Node with typescript domain',
        source: 'auto-extracted',
        domains: ['typescript', 'nodejs'],
      });
      createKnowledgeNode({
        id: 'kn-d2',
        tier: 1,
        content: 'Node with python domain',
        source: 'auto-extracted',
        domains: ['python'],
      });
      createKnowledgeNode({
        id: 'kn-d3',
        tier: 2,
        content: 'Another typescript node',
        source: 'user-created',
        domains: ['typescript'],
        confidence: 0.8,
      });

      const tsNodes = getKnowledgeNodesByDomain('typescript');
      expect(tsNodes).toHaveLength(2);
      // Should be ordered by confidence DESC
      expect(tsNodes[0].confidence).toBeGreaterThanOrEqual(tsNodes[1].confidence);

      const pyNodes = getKnowledgeNodesByDomain('python');
      expect(pyNodes).toHaveLength(1);
      expect(pyNodes[0].id).toBe('kn-d2');
    });
  });

  describe('getKnowledgeNodesByGroup', () => {
    it('should include nodes with matching group OR null scope', () => {
      createKnowledgeNode({
        id: 'kn-g1',
        tier: 1,
        content: 'Group scoped node',
        source: 'auto-extracted',
        scopeGroupId: 'g1',
      });
      createKnowledgeNode({
        id: 'kn-g2',
        tier: 1,
        content: 'Other group node',
        source: 'auto-extracted',
        scopeGroupId: 'g2',
      });
      createKnowledgeNode({
        id: 'kn-gn',
        tier: 1,
        content: 'Global node (no scope)',
        source: 'auto-extracted',
      });

      const g1Nodes = getKnowledgeNodesByGroup('g1');
      expect(g1Nodes).toHaveLength(2); // g1 + null scope
      const ids = g1Nodes.map((n) => n.id);
      expect(ids).toContain('kn-g1');
      expect(ids).toContain('kn-gn');
      expect(ids).not.toContain('kn-g2');
    });
  });

  describe('searchKnowledgeNodes', () => {
    it('should find nodes via FTS search', () => {
      createKnowledgeNode({
        id: 'kn-fts1',
        tier: 1,
        content: 'TypeScript interfaces extend other interfaces',
        source: 'auto-extracted',
      });
      createKnowledgeNode({
        id: 'kn-fts2',
        tier: 1,
        content: 'Python uses duck typing',
        source: 'auto-extracted',
      });

      const results = searchKnowledgeNodes('TypeScript');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('kn-fts1');
    });
  });

  describe('reinforceKnowledgeNode', () => {
    it('should boost confidence and update timestamp', () => {
      // Create node with low confidence
      createKnowledgeNode({
        id: 'kn-reinforce',
        tier: 1,
        content: 'Reinforceable fact',
        source: 'auto-extracted',
        confidence: 0.5,
      });

      const before = getKnowledgeNode('kn-reinforce')!;
      const beforeTimestamp = before.lastReinforcedAt;

      // Small delay to ensure timestamp changes
      reinforceKnowledgeNode('kn-reinforce');

      const after = getKnowledgeNode('kn-reinforce')!;
      expect(after.confidence).toBe(0.6); // 0.5 + 0.1
      expect(after.lastReinforcedAt.getTime()).toBeGreaterThanOrEqual(beforeTimestamp.getTime());
    });

    it('should cap confidence at 1.0', () => {
      createKnowledgeNode({
        id: 'kn-cap',
        tier: 1,
        content: 'Already confident',
        source: 'auto-extracted',
        confidence: 0.95,
      });

      reinforceKnowledgeNode('kn-cap');

      const node = getKnowledgeNode('kn-cap')!;
      expect(node.confidence).toBe(1.0);
    });
  });

  // ---------- Edge CRUD ----------
  describe('createKnowledgeEdge + getEdgesForNode', () => {
    it('should create an edge and retrieve it', () => {
      createKnowledgeNode({ id: 'kn-ea', tier: 1, content: 'Node A', source: 'auto-extracted' });
      createKnowledgeNode({ id: 'kn-eb', tier: 1, content: 'Node B', source: 'auto-extracted' });

      const edge = createKnowledgeEdge({
        id: 'ke-001',
        sourceId: 'kn-ea',
        targetId: 'kn-eb',
        relationship: 'supports',
        weight: 0.8,
      });

      expect(edge.id).toBe('ke-001');
      expect(edge.sourceId).toBe('kn-ea');
      expect(edge.targetId).toBe('kn-eb');
      expect(edge.relationship).toBe('supports');
      expect(edge.weight).toBe(0.8);
      expect(edge.createdAt).toBeInstanceOf(Date);

      const edges = getEdgesForNode('kn-ea');
      expect(edges).toHaveLength(1);
      expect(edges[0].id).toBe('ke-001');
    });
  });

  describe('getEdgesForNode with direction filter', () => {
    beforeEach(() => {
      createKnowledgeNode({ id: 'kn-c', tier: 1, content: 'Node C', source: 'auto-extracted' });
      createKnowledgeNode({ id: 'kn-d', tier: 1, content: 'Node D', source: 'auto-extracted' });
      createKnowledgeNode({ id: 'kn-e', tier: 1, content: 'Node E', source: 'auto-extracted' });

      // C -> D (outgoing from C)
      createKnowledgeEdge({ id: 'ke-cd', sourceId: 'kn-c', targetId: 'kn-d', relationship: 'supports' });
      // E -> C (incoming to C)
      createKnowledgeEdge({ id: 'ke-ec', sourceId: 'kn-e', targetId: 'kn-c', relationship: 'derived_from' });
    });

    it('should return only outgoing edges', () => {
      const outgoing = getEdgesForNode('kn-c', 'outgoing');
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].id).toBe('ke-cd');
    });

    it('should return only incoming edges', () => {
      const incoming = getEdgesForNode('kn-c', 'incoming');
      expect(incoming).toHaveLength(1);
      expect(incoming[0].id).toBe('ke-ec');
    });

    it('should return both directions by default', () => {
      const both = getEdgesForNode('kn-c');
      expect(both).toHaveLength(2);
    });
  });

  describe('deleteKnowledgeEdge', () => {
    it('should delete an edge', () => {
      createKnowledgeNode({ id: 'kn-f', tier: 1, content: 'Node F', source: 'auto-extracted' });
      createKnowledgeNode({ id: 'kn-g', tier: 1, content: 'Node G', source: 'auto-extracted' });
      createKnowledgeEdge({ id: 'ke-fg', sourceId: 'kn-f', targetId: 'kn-g', relationship: 'relates_to' });

      deleteKnowledgeEdge('ke-fg');

      const edges = getEdgesForNode('kn-f');
      expect(edges).toHaveLength(0);
    });
  });

  // ---------- Promotions ----------
  describe('logPromotion + getPromotionHistory', () => {
    it('should log and retrieve promotion history', () => {
      createKnowledgeNode({ id: 'kn-promo', tier: 1, content: 'Promotable', source: 'auto-extracted' });

      const promotion = logPromotion({
        id: 'kp-001',
        nodeId: 'kn-promo',
        fromTier: 1,
        toTier: 2,
        trigger: 'reinforcement',
        evidence: ['seen 3 times', 'referenced in 2 sessions'],
      });

      expect(promotion.id).toBe('kp-001');
      expect(promotion.nodeId).toBe('kn-promo');
      expect(promotion.fromTier).toBe(1);
      expect(promotion.toTier).toBe(2);
      expect(promotion.trigger).toBe('reinforcement');
      expect(promotion.evidence).toEqual(['seen 3 times', 'referenced in 2 sessions']);
      expect(promotion.promotedAt).toBeInstanceOf(Date);

      const history = getPromotionHistory('kn-promo');
      expect(history).toHaveLength(1);
      expect(history[0].id).toBe('kp-001');
    });
  });

  // ---------- Confidence Decay ----------
  describe('getNodesWithDecayedConfidence', () => {
    it('should find old nodes with confidence > 0.1', () => {
      // Create a node and manually set last_reinforced_at to 30 days ago
      createKnowledgeNode({
        id: 'kn-old',
        tier: 1,
        content: 'Old node',
        source: 'auto-extracted',
        confidence: 0.8,
      });
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      testDb.prepare('UPDATE knowledge_nodes SET last_reinforced_at = ? WHERE id = ?').run(thirtyDaysAgo, 'kn-old');

      // Create a fresh node that should NOT be returned
      createKnowledgeNode({
        id: 'kn-fresh',
        tier: 1,
        content: 'Fresh node',
        source: 'auto-extracted',
        confidence: 0.9,
      });

      const decayed = getNodesWithDecayedConfidence(7);
      expect(decayed).toHaveLength(1);
      expect(decayed[0].id).toBe('kn-old');
    });

    it('should not return nodes with confidence <= 0.1', () => {
      createKnowledgeNode({
        id: 'kn-low',
        tier: 1,
        content: 'Low confidence node',
        source: 'auto-extracted',
        confidence: 0.1,
      });
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      testDb.prepare('UPDATE knowledge_nodes SET last_reinforced_at = ? WHERE id = ?').run(thirtyDaysAgo, 'kn-low');

      const decayed = getNodesWithDecayedConfidence(7);
      expect(decayed).toHaveLength(0);
    });
  });

  describe('applyConfidenceDecay', () => {
    it('should reduce confidence for old nodes', () => {
      createKnowledgeNode({
        id: 'kn-decay1',
        tier: 1,
        content: 'Decaying node 1',
        source: 'auto-extracted',
        confidence: 0.8,
      });
      createKnowledgeNode({
        id: 'kn-decay2',
        tier: 1,
        content: 'Decaying node 2',
        source: 'auto-extracted',
        confidence: 0.5,
      });

      // Set both to 30 days old
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      testDb.prepare('UPDATE knowledge_nodes SET last_reinforced_at = ? WHERE id IN (?, ?)').run(
        thirtyDaysAgo,
        'kn-decay1',
        'kn-decay2'
      );

      // Create a fresh node that should NOT be affected
      createKnowledgeNode({
        id: 'kn-fresh2',
        tier: 1,
        content: 'Fresh node 2',
        source: 'auto-extracted',
        confidence: 0.9,
      });

      const affected = applyConfidenceDecay(0.1, 7);
      expect(affected).toBe(2);

      const node1 = getKnowledgeNode('kn-decay1')!;
      expect(node1.confidence).toBeCloseTo(0.7, 5); // 0.8 - 0.1

      const node2 = getKnowledgeNode('kn-decay2')!;
      expect(node2.confidence).toBeCloseTo(0.4, 5); // 0.5 - 0.1

      // Fresh node should be unchanged
      const fresh = getKnowledgeNode('kn-fresh2')!;
      expect(fresh.confidence).toBe(0.9);
    });
  });
});
