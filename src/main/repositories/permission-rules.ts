import { getDatabase } from '../database';
import { PermissionRule, PermissionRuleCreateInput } from '../../shared/types';

function mapRow(row: any): PermissionRule {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scope_id,
    toolPattern: row.tool_pattern,
    decision: row.decision,
    createdAt: new Date(row.created_at),
    createdBy: row.created_by || 'user',
  };
}

export function createRule(input: PermissionRuleCreateInput): PermissionRule {
  const db = getDatabase();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO permission_rules (id, scope, scope_id, tool_pattern, decision, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.scope,
    input.scopeId ?? null,
    input.toolPattern,
    input.decision,
    createdAt,
    input.createdBy || 'user',
  );
  return {
    id: input.id,
    scope: input.scope,
    scopeId: input.scopeId ?? null,
    toolPattern: input.toolPattern,
    decision: input.decision,
    createdAt: new Date(createdAt),
    createdBy: input.createdBy || 'user',
  };
}

export function deleteRule(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM permission_rules WHERE id = ?').run(id);
}

export function deleteRulesByScope(scope: string, scopeId?: string | null): void {
  const db = getDatabase();
  if (scopeId) {
    db.prepare('DELETE FROM permission_rules WHERE scope = ? AND scope_id = ?').run(scope, scopeId);
  } else {
    db.prepare('DELETE FROM permission_rules WHERE scope = ? AND scope_id IS NULL').run(scope);
  }
}

export function getRulesByScope(scope: string, scopeId?: string | null): PermissionRule[] {
  const db = getDatabase();
  let rows: any[];
  if (scopeId) {
    rows = db.prepare('SELECT * FROM permission_rules WHERE scope = ? AND scope_id = ? ORDER BY created_at DESC').all(scope, scopeId) as any[];
  } else {
    rows = db.prepare('SELECT * FROM permission_rules WHERE scope = ? AND scope_id IS NULL ORDER BY created_at DESC').all(scope) as any[];
  }
  return rows.map(mapRow);
}

export function getAllRules(): PermissionRule[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM permission_rules ORDER BY scope, created_at DESC').all() as any[];
  return rows.map(mapRow);
}

export function getRulesForEvaluation(sessionId: string, groupId?: string | null): PermissionRule[] {
  const db = getDatabase();
  const params: string[] = [];
  const conditions: string[] = [];

  // Global rules
  conditions.push("(scope = 'global')");

  // Group rules
  if (groupId) {
    conditions.push("(scope = 'group' AND scope_id = ?)");
    params.push(groupId);
  }

  // Session rules
  conditions.push("(scope = 'session' AND scope_id = ?)");
  params.push(sessionId);

  const sql = `SELECT * FROM permission_rules WHERE ${conditions.join(' OR ')} ORDER BY scope DESC`;
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(mapRow);
}

export function clearAllRules(): void {
  const db = getDatabase();
  db.prepare('DELETE FROM permission_rules').run();
}
