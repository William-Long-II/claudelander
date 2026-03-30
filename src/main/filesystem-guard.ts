/**
 * FilesystemGuard
 *
 * Boundary checker for sandboxed "Full Auto" sessions.
 * Intercepts tool operations and checks whether they stay within
 * the worktree boundary. Operations outside the boundary are surfaced
 * as permission prompts to the user.
 *
 * The guard runs as part of the permission evaluator path.
 * When permissionMode === 'fullAuto', instead of the normal rule
 * evaluation, this guard logic kicks in.
 */

import * as path from 'path';
import log from 'electron-log';

const IS_WINDOWS = process.platform === 'win32';

export type GuardDecision = 'allow' | 'prompt';

export interface GuardResult {
  decision: GuardDecision;
  reason?: string;
}

/**
 * Dangerous Bash patterns that ALWAYS require user approval,
 * regardless of whether they target the worktree.
 */
const DANGEROUS_BASH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bsudo\b/, reason: 'Uses sudo (elevated privileges)' },
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|.*\s+)\/\s*$/, reason: 'Recursive delete on root' },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\//, reason: 'rm -rf on root path' },
  { pattern: /\bchmod\s+777\b/, reason: 'chmod 777 (world-writable)' },
  { pattern: />\s*\/dev\//, reason: 'Writing to /dev/' },
  { pattern: /\bmkfs\b/, reason: 'Filesystem format command' },
  { pattern: /\bdd\s+if=/, reason: 'dd (raw disk write)' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'Fork bomb' },
  { pattern: /\bformat\s+[a-zA-Z]:/i, reason: 'Windows format command' },
];

/**
 * Bash patterns that require prompting when they target paths
 * outside the worktree boundary.
 */
const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /~\/\.ssh/,
  /~\/\.claude/,
  /~\/\.config/,
  /~\/\.gnupg/,
  /~\/\.aws/,
  /~\/\.kube/,
  /\/etc\//,
  /\/usr\//,
  /\/var\//,
  /%APPDATA%/i,
  /%USERPROFILE%/i,
  /\bC:\\Windows\b/i,
  /\bC:\\Program Files\b/i,
];

/**
 * Commands that modify the global environment and should always prompt.
 */
const GLOBAL_SIDE_EFFECT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bnpm\s+install\s+-g\b/, reason: 'Global npm install' },
  { pattern: /\bnpm\s+i\s+-g\b/, reason: 'Global npm install' },
  { pattern: /\bpip\s+install\b(?!.*--target)/, reason: 'pip install (may be global)' },
  { pattern: /\bapt\s+(install|remove|purge)\b/, reason: 'System package management (apt)' },
  { pattern: /\bbrew\s+(install|uninstall|remove)\b/, reason: 'Homebrew install/uninstall' },
  { pattern: /\bchoco\s+(install|uninstall)\b/i, reason: 'Chocolatey install/uninstall' },
  { pattern: /\bgit\s+push\b/, reason: 'git push (affects remote)' },
  { pattern: /\bgit\s+push\s+--force\b/, reason: 'git force push (destructive remote operation)' },
  { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/, reason: 'Piping curl to shell' },
  { pattern: /\bwget\b.*\|\s*(ba)?sh\b/, reason: 'Piping wget to shell' },
];

/**
 * Evaluate whether a tool operation is within the sandbox boundary.
 */
export function evaluateGuard(
  toolName: string,
  toolInput: Record<string, unknown>,
  worktreePath: string
): GuardResult {
  switch (toolName) {
    case 'Read':
    case 'Edit':
    case 'Write':
      return checkFilePath(toolInput.file_path, worktreePath, toolName);

    case 'Glob':
    case 'Grep':
      return checkSearchPath(toolInput.path, worktreePath, toolName);

    case 'Bash':
      return checkBashCommand(toolInput.command, worktreePath);

    case 'Agent':
      // Agent tool spawns subagents — they'll be checked individually
      return { decision: 'allow' };

    default:
      // Unknown tools — prompt to be safe
      return { decision: 'prompt', reason: `Unknown tool: ${toolName}` };
  }
}

/**
 * Check if a file_path is within the worktree boundary.
 */
function checkFilePath(
  filePath: unknown,
  worktreePath: string,
  toolName: string
): GuardResult {
  if (typeof filePath !== 'string' || !filePath) {
    return { decision: 'prompt', reason: `${toolName}: no file_path provided` };
  }

  if (isWithinBoundary(filePath, worktreePath)) {
    return { decision: 'allow' };
  }

  return {
    decision: 'prompt',
    reason: `${toolName} targets path outside sandbox: ${filePath}`,
  };
}

/**
 * Check if a search path is within the worktree boundary.
 * Glob/Grep without a path default to cwd (the worktree), which is fine.
 */
function checkSearchPath(
  searchPath: unknown,
  worktreePath: string,
  toolName: string
): GuardResult {
  // No path specified = uses cwd = worktree = fine
  if (!searchPath || typeof searchPath !== 'string') {
    return { decision: 'allow' };
  }

  if (isWithinBoundary(searchPath, worktreePath)) {
    return { decision: 'allow' };
  }

  return {
    decision: 'prompt',
    reason: `${toolName} searches outside sandbox: ${searchPath}`,
  };
}

/**
 * Check a Bash command for dangerous patterns and out-of-boundary access.
 */
function checkBashCommand(
  command: unknown,
  worktreePath: string
): GuardResult {
  if (typeof command !== 'string' || !command) {
    return { decision: 'prompt', reason: 'Bash: no command provided' };
  }

  // Check for inherently dangerous patterns (always prompt)
  for (const { pattern, reason } of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return { decision: 'prompt', reason: `Bash: ${reason}` };
    }
  }

  // Check for global side effects (always prompt)
  for (const { pattern, reason } of GLOBAL_SIDE_EFFECT_PATTERNS) {
    if (pattern.test(command)) {
      return { decision: 'prompt', reason: `Bash: ${reason}` };
    }
  }

  // Check for sensitive path access
  for (const pattern of SENSITIVE_PATH_PATTERNS) {
    if (pattern.test(command)) {
      return { decision: 'prompt', reason: `Bash: accesses sensitive path` };
    }
  }

  // Check if command references absolute paths outside the worktree
  const absolutePathRefs = extractAbsolutePaths(command);
  for (const absPath of absolutePathRefs) {
    if (!isWithinBoundary(absPath, worktreePath)) {
      return {
        decision: 'prompt',
        reason: `Bash: references path outside sandbox: ${absPath}`,
      };
    }
  }

  // Everything looks fine — allow silently
  return { decision: 'allow' };
}

/**
 * Check if a path is within the worktree boundary.
 * Handles both forward and backslash separators (Windows).
 */
function isWithinBoundary(targetPath: string, boundaryPath: string): boolean {
  const normalize = (p: string) => {
    let resolved = path.resolve(p);
    if (IS_WINDOWS) {
      resolved = resolved.toLowerCase();
    }
    // Ensure trailing separator for prefix matching
    if (!resolved.endsWith(path.sep)) {
      resolved += path.sep;
    }
    return resolved;
  };

  const normalizedTarget = normalize(targetPath);
  const normalizedBoundary = normalize(boundaryPath);

  // Target is within boundary if it starts with the boundary path,
  // or if target IS the boundary path (exact match)
  return normalizedTarget.startsWith(normalizedBoundary) ||
    normalizedTarget.slice(0, -1) === normalizedBoundary.slice(0, -1);
}

/**
 * Extract absolute paths from a command string.
 * This is a best-effort heuristic — Bash command parsing is inherently complex.
 */
function extractAbsolutePaths(command: string): string[] {
  const paths: string[] = [];

  if (IS_WINDOWS) {
    // Windows: match drive letter paths like C:\foo or D:/bar
    const winMatches = command.match(/[A-Za-z]:[\\\/][^\s"';&|>]+/g);
    if (winMatches) paths.push(...winMatches);
  }

  // Unix: match absolute paths like /foo/bar
  const unixMatches = command.match(/(?:^|\s)(\/[^\s"';&|>]+)/g);
  if (unixMatches) {
    paths.push(...unixMatches.map(m => m.trim()));
  }

  return paths;
}
