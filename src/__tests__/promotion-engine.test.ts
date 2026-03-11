import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initKnowledgeGraphTables } from '../main/database-knowledge';

let db: Database.Database;

vi.mock('../main/database', () => ({
  getDatabase: () => db,
}));

import { createKnowledgeNode, createKnowledgeEdge } from '../main/repositories/knowledge';
import { findPromotionCandidates, applyDecayPass } from '../main/knowledge/promotion-engine';

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#888', working_dir TEXT DEFAULT '', "order" INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, group_id TEXT REFERENCES groups(id) ON DELETE CASCADE, name TEXT NOT NULL, working_dir TEXT NOT NULL, state TEXT DEFAULT 'idle', "order" INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  initKnowledgeGraphTables(db);
  db.prepare(`INSERT INTO groups (id, name) VALUES ('grp-1', 'Test')`).run();
});

afterEach(() => {
  db.close();
});

describe('findPromotionCandidates (Tier 1 -> Tier 2)', () => {
  it('should propose promotion when 3+ similar facts exist in same domain', () => {
    createKnowledgeNode({ id: 'n1', tier: 1, content: 'Always null-check auth responses', source: 'auto-extracted', domains: ['auth'] });
    createKnowledgeNode({ id: 'n2', tier: 1, content: 'Add null check for auth token validation', source: 'auto-extracted', domains: ['auth'] });
    createKnowledgeNode({ id: 'n3', tier: 1, content: 'Null check needed on auth middleware response', source: 'auto-extracted', domains: ['auth'] });

    const candidates = findPromotionCandidates();
    // Should find at least one promotion candidate from auth domain
    const authCandidates = candidates.filter(c => c.domains.includes('auth'));
    expect(authCandidates.length).toBeGreaterThanOrEqual(1);
    expect(authCandidates[0].fromTier).toBe(1);
    expect(authCandidates[0].toTier).toBe(2);
    expect(authCandidates[0].evidence.length).toBeGreaterThanOrEqual(3);
  });

  it('should not propose promotion with fewer than 3 facts', () => {
    createKnowledgeNode({ id: 'n1', tier: 1, content: 'Some auth fact', source: 'auto-extracted', domains: ['auth'] });
    createKnowledgeNode({ id: 'n2', tier: 1, content: 'Another auth fact', source: 'auto-extracted', domains: ['auth'] });

    const candidates = findPromotionCandidates();
    expect(candidates).toHaveLength(0);
  });
});

describe('applyDecayPass', () => {
  it('should decay old nodes', () => {
    createKnowledgeNode({ id: 'n1', tier: 1, content: 'Old fact', source: 'auto-extracted' });
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE knowledge_nodes SET last_reinforced_at = ? WHERE id = ?').run(twoWeeksAgo, 'n1');

    const decayed = applyDecayPass();
    expect(decayed).toBeGreaterThanOrEqual(1);
  });
});
