import { ClaudeConfig } from '../shared/types';
import * as sessionsRepo from './repositories/sessions';
import * as groupsRepo from './repositories/groups';
import * as prefsRepo from './repositories/preferences';
import * as knowledgeRepo from './repositories/knowledge';
import log from 'electron-log';

// cross-spawn handles shell quoting, so we only guard against control characters
// and flag injection for enum-like values (model, effort, permissionMode)
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
const ENUM_UNSAFE = /[^a-zA-Z0-9._-]/;

/** Reject enum-like values containing anything outside alphanumeric/dot/dash */
function sanitizeEnumArg(value: string, fieldName: string): string | null {
  if (ENUM_UNSAFE.test(value)) {
    log.warn(`[ClaudeConfig] Rejecting unsafe ${fieldName} value: ${value.substring(0, 50)}`);
    return null;
  }
  return value;
}

/** Reject freeform text values containing control characters */
function sanitizeTextArg(value: string, fieldName: string): string | null {
  if (CONTROL_CHARS.test(value)) {
    log.warn(`[ClaudeConfig] Rejecting ${fieldName} value with control characters`);
    return null;
  }
  return value;
}

function getGlobalDefaults(): ClaudeConfig {
  const raw = prefsRepo.getPreference('claude.defaultConfig');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function getGroupConfig(groupId: string): ClaudeConfig {
  const groups = groupsRepo.getAllGroups();
  const group = groups.find(g => g.id === groupId);
  return group?.claudeConfig || {};
}

export function resolveClaudeConfig(sessionId: string): ClaudeConfig {
  const sessions = sessionsRepo.getAllSessions();
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return getGlobalDefaults();

  const global = getGlobalDefaults();
  const group = session.groupId ? getGroupConfig(session.groupId) : {};
  const sessionConfig = session.claudeConfig || {};

  const merged: ClaudeConfig = { ...global };
  for (const src of [group, sessionConfig]) {
    if (src.model !== undefined) merged.model = src.model;
    if (src.effort !== undefined) merged.effort = src.effort;
    if (src.permissionMode !== undefined) merged.permissionMode = src.permissionMode;
    if (src.maxBudgetUsd !== undefined) merged.maxBudgetUsd = src.maxBudgetUsd;
    if (src.systemPrompt !== undefined) merged.systemPrompt = src.systemPrompt;
    if (src.allowedTools !== undefined) merged.allowedTools = src.allowedTools;
    if (src.disallowedTools !== undefined) merged.disallowedTools = src.disallowedTools;
  }

  log.info(`[ClaudeConfig] Resolved for session ${sessionId}:`, JSON.stringify(merged));
  return merged;
}

export function configToCliArgs(config: ClaudeConfig): string[] {
  const args: string[] = [];

  const model = config.model && sanitizeEnumArg(config.model, 'model');
  if (model) args.push('--model', model);

  const effort = config.effort && sanitizeEnumArg(config.effort, 'effort');
  if (effort) args.push('--effort', effort);

  const perm = config.permissionMode && sanitizeEnumArg(config.permissionMode, 'permissionMode');
  // 'fullAuto' is handled by ClaudeSessionManager (worktree + --dangerously-skip-permissions)
  if (perm && perm !== 'fullAuto') args.push('--permission-mode', perm);

  if (config.maxBudgetUsd != null && Number.isFinite(config.maxBudgetUsd) && config.maxBudgetUsd >= 0) {
    args.push('--max-budget-usd', String(config.maxBudgetUsd));
  }

  const sysPrompt = config.systemPrompt && sanitizeTextArg(config.systemPrompt, 'systemPrompt');
  if (sysPrompt) args.push('--append-system-prompt', sysPrompt);

  if (config.allowedTools && config.allowedTools.length > 0) {
    const safe = config.allowedTools.filter(t => sanitizeEnumArg(t, 'allowedTool') !== null);
    if (safe.length > 0) args.push('--allowedTools', safe.join(','));
  }
  if (config.disallowedTools && config.disallowedTools.length > 0) {
    const safe = config.disallowedTools.filter(t => sanitizeEnumArg(t, 'disallowedTool') !== null);
    if (safe.length > 0) args.push('--disallowedTools', safe.join(','));
  }

  return args;
}

export function buildKnowledgeContext(sessionId: string, groupId?: string): string {
  const nodes = knowledgeRepo.getKnowledgeForInjection({
    scopeGroupId: groupId,
    scopeSessionId: sessionId,
    limit: 20,
  });
  log.info(`[Knowledge] buildKnowledgeContext: session=${sessionId}, group=${groupId}, found ${nodes.length} nodes`);
  if (nodes.length === 0) return '';

  // Reinforce nodes that are being actively used
  for (const node of nodes) {
    knowledgeRepo.reinforceKnowledgeNode(node.id);
  }

  const lines = nodes.map(n => {
    const tierLabel = n.tier === 3 ? 'Principle' : n.tier === 2 ? 'Pattern' : 'Fact';
    const domains = n.domains.length > 0 ? ` [${n.domains.join(', ')}]` : '';
    return `- [${tierLabel}${domains}] ${n.content}`;
  });
  return `The following knowledge has been accumulated from previous sessions. Use it to inform your responses:\n${lines.join('\n')}\n\n`;
}
