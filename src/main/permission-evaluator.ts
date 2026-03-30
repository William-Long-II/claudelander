/**
 * Permission Evaluator
 *
 * Matches incoming tool-use requests against saved permission rules.
 * Uses Claude Code's permission rule syntax for pattern matching:
 *   - "Read" — matches tool name exactly
 *   - "Bash(npm run *)" — matches tool name with glob on input
 *   - "Edit(src/**)" — matches tool with file path glob
 */

import log from 'electron-log';
import { PermissionRule, PermissionDecision } from '../shared/types';
import * as permissionRulesRepo from './repositories/permission-rules';

/**
 * Match a tool pattern against a tool name and input.
 *
 * Pattern formats:
 *   "ToolName" — matches any use of ToolName
 *   "ToolName(glob)" — matches ToolName where the primary input matches the glob
 *
 * For Bash, the primary input is the `command` field.
 * For Read/Edit/Write, the primary input is the `file_path` field.
 * For Grep/Glob, the primary input is the `pattern` or `path` field.
 */
export function matchesToolPattern(
  pattern: string,
  toolName: string,
  toolInput: Record<string, unknown>
): boolean {
  // Parse pattern: "ToolName" or "ToolName(glob)"
  const parenIdx = pattern.indexOf('(');
  let patternTool: string;
  let patternGlob: string | null = null;

  if (parenIdx !== -1 && pattern.endsWith(')')) {
    patternTool = pattern.substring(0, parenIdx);
    patternGlob = pattern.substring(parenIdx + 1, pattern.length - 1);
  } else {
    patternTool = pattern;
  }

  // Tool name must match
  if (patternTool !== toolName) return false;

  // If no glob, tool name match is sufficient
  if (!patternGlob) return true;

  // Get the primary input value to match against the glob
  const primaryInput = getPrimaryInput(toolName, toolInput);
  if (!primaryInput) return false;

  return globMatch(patternGlob, primaryInput);
}

/**
 * Extract the primary input string for a tool (the value to match against globs).
 */
function getPrimaryInput(toolName: string, toolInput: Record<string, unknown>): string | null {
  switch (toolName) {
    case 'Bash':
      return typeof toolInput.command === 'string' ? toolInput.command : null;
    case 'Read':
    case 'Edit':
    case 'Write':
      return typeof toolInput.file_path === 'string' ? toolInput.file_path : null;
    case 'Grep':
      return typeof toolInput.pattern === 'string' ? toolInput.pattern : null;
    case 'Glob':
      return typeof toolInput.pattern === 'string' ? toolInput.pattern : null;
    case 'Agent':
      return typeof toolInput.prompt === 'string' ? toolInput.prompt : null;
    default:
      // For unknown tools, try common field names
      if (typeof toolInput.command === 'string') return toolInput.command;
      if (typeof toolInput.file_path === 'string') return toolInput.file_path;
      return null;
  }
}

/**
 * Simple glob matching supporting * and **.
 *   * — matches any characters except path separators
 *   ** — matches any characters including path separators
 */
function globMatch(pattern: string, value: string): boolean {
  // Escape regex special chars except * and **
  let regex = '';
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      regex += '.*';
      i += 2;
      // Skip trailing slash after **
      if (pattern[i] === '/' || pattern[i] === '\\') i++;
    } else if (pattern[i] === '*') {
      regex += '[^/\\\\]*';
      i++;
    } else if (pattern[i] === '?') {
      regex += '[^/\\\\]';
      i++;
    } else {
      regex += escapeRegex(pattern[i]);
      i++;
    }
  }

  try {
    return new RegExp(`^${regex}$`, 'i').test(value);
  } catch {
    return false;
  }
}

function escapeRegex(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Infer a reasonable permission pattern from a tool name and its input.
 * This is used when the user clicks "Always allow" to create a pattern
 * that's more general than the exact invocation but still scoped.
 */
export function inferToolPattern(toolName: string, toolInput: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash': {
      const cmd = typeof toolInput.command === 'string' ? toolInput.command : '';
      // Extract the base command (first word or first two words for common patterns)
      const parts = cmd.trim().split(/\s+/);
      if (parts.length >= 2) {
        // Common multi-word commands: git status, npm run, docker build, etc.
        const twoWord = `${parts[0]} ${parts[1]}`;
        if (/^(git|npm|npx|yarn|pnpm|docker|cargo|make|pip|python|node)\s/.test(twoWord)) {
          return `Bash(${twoWord} *)`;
        }
      }
      if (parts[0]) {
        return `Bash(${parts[0]} *)`;
      }
      return 'Bash';
    }
    case 'Read':
    case 'Edit':
    case 'Write': {
      const filePath = typeof toolInput.file_path === 'string' ? toolInput.file_path : '';
      // Extract the directory and use ** glob
      const normalized = filePath.replace(/\\/g, '/');
      const parts = normalized.split('/');
      if (parts.length >= 2) {
        // Use the parent directory as the scope: Edit(src/**)
        const dir = parts.slice(0, -1).join('/');
        return `${toolName}(${dir}/**)`;
      }
      return toolName;
    }
    case 'Grep':
    case 'Glob':
    case 'Agent':
      // These are generally safe, just allow the tool entirely
      return toolName;
    default:
      return toolName;
  }
}

export type EvalResult =
  | { matched: true; decision: PermissionDecision; rule: PermissionRule }
  | { matched: false };

/**
 * Evaluate a tool-use request against all applicable permission rules.
 *
 * Checks in order: session → group → global.
 * Deny rules take precedence over allow rules at the same scope.
 * Returns the first matching rule, or { matched: false } if none match.
 */
export function evaluatePermission(
  toolName: string,
  toolInput: Record<string, unknown>,
  sessionId: string,
  groupId?: string | null
): EvalResult {
  const rules = permissionRulesRepo.getRulesForEvaluation(sessionId, groupId);

  // Check deny rules first (they take precedence)
  for (const rule of rules) {
    if (rule.decision === 'deny' && matchesToolPattern(rule.toolPattern, toolName, toolInput)) {
      log.info(`[PermissionEval] Denied ${toolName} by rule ${rule.id} (${rule.scope}): ${rule.toolPattern}`);
      return { matched: true, decision: 'deny', rule };
    }
  }

  // Then check allow rules
  for (const rule of rules) {
    if (rule.decision === 'allow' && matchesToolPattern(rule.toolPattern, toolName, toolInput)) {
      log.info(`[PermissionEval] Allowed ${toolName} by rule ${rule.id} (${rule.scope}): ${rule.toolPattern}`);
      return { matched: true, decision: 'allow', rule };
    }
  }

  return { matched: false };
}
