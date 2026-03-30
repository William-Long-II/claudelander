/**
 * WorktreeManager
 *
 * Manages git worktree lifecycle for sandboxed "Full Auto" sessions.
 * Each sandboxed session gets its own worktree on a throwaway branch,
 * allowing Claude to make changes freely without affecting the user's
 * working directory until the user explicitly accepts the diff.
 */

import { execSync, execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import log from 'electron-log';

export interface WorktreeInfo {
  sessionId: string;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  projectDir: string;
  createdAt: Date;
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  diff: string;
}

export interface DiffResult {
  baseBranch: string;
  worktreeBranch: string;
  files: DiffFile[];
  summary: {
    added: number;
    modified: number;
    deleted: number;
  };
}

class WorktreeManager {
  private worktrees: Map<string, WorktreeInfo> = new Map();

  /**
   * Create a new git worktree for a sandboxed session.
   * Returns the worktree path to use as cwd for Claude.
   */
  create(projectDir: string, sessionId: string): WorktreeInfo {
    // Verify we're in a git repo
    try {
      execFileSync('git', ['rev-parse', '--git-dir'], { cwd: projectDir, stdio: 'pipe' });
    } catch {
      throw new Error(`Not a git repository: ${projectDir}`);
    }

    // Get the current branch name as the base
    let baseBranch: string;
    try {
      baseBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
    } catch {
      baseBranch = 'HEAD';
    }

    const branchName = `claudelander/sandbox/${sessionId}`;
    const worktreeDirName = `claudelander-sandbox-${sessionId.substring(0, 8)}`;
    const worktreePath = path.join(os.tmpdir(), worktreeDirName);

    // Clean up any stale worktree at this path
    if (fs.existsSync(worktreePath)) {
      log.warn(`[WorktreeManager] Cleaning stale worktree at ${worktreePath}`);
      this.forceRemoveWorktree(projectDir, worktreePath, branchName);
    }

    // Delete stale branch if it exists
    try {
      execFileSync('git', ['branch', '-D', branchName], { cwd: projectDir, stdio: 'pipe' });
      log.info(`[WorktreeManager] Deleted stale branch ${branchName}`);
    } catch {
      // Branch doesn't exist, fine
    }

    // Create the worktree on a new branch
    log.info(`[WorktreeManager] Creating worktree: ${worktreePath} (branch: ${branchName})`);
    try {
      execFileSync('git', ['worktree', 'add', worktreePath, '-b', branchName], {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to create worktree: ${msg}`);
    }

    const info: WorktreeInfo = {
      sessionId,
      worktreePath,
      branchName,
      baseBranch,
      projectDir,
      createdAt: new Date(),
    };

    this.worktrees.set(sessionId, info);
    log.info(`[WorktreeManager] Worktree created for session ${sessionId}: ${worktreePath}`);
    return info;
  }

  /**
   * Get the diff between the worktree's changes and the base branch.
   */
  getDiff(sessionId: string): DiffResult {
    const info = this.worktrees.get(sessionId);
    if (!info) {
      throw new Error(`No worktree found for session ${sessionId}`);
    }

    // Get the list of changed files with status
    let nameStatus: string;
    try {
      nameStatus = execFileSync(
        'git',
        ['diff', '--name-status', info.baseBranch + '...HEAD'],
        { cwd: info.worktreePath, encoding: 'utf-8', stdio: 'pipe' }
      ).trim();
    } catch {
      // If baseBranch comparison fails, try against the initial commit
      nameStatus = execFileSync(
        'git',
        ['diff', '--name-status', 'HEAD~1..HEAD'],
        { cwd: info.worktreePath, encoding: 'utf-8', stdio: 'pipe' }
      ).trim();
    }

    const files: DiffFile[] = [];
    const summary = { added: 0, modified: 0, deleted: 0 };

    if (!nameStatus) {
      return { baseBranch: info.baseBranch, worktreeBranch: info.branchName, files, summary };
    }

    for (const line of nameStatus.split('\n')) {
      if (!line.trim()) continue;
      const [statusCode, ...pathParts] = line.split('\t');
      const filePath = pathParts.join('\t'); // Handle paths with tabs (unlikely but safe)

      let status: DiffFile['status'];
      switch (statusCode.charAt(0)) {
        case 'A': status = 'added'; summary.added++; break;
        case 'M': status = 'modified'; summary.modified++; break;
        case 'D': status = 'deleted'; summary.deleted++; break;
        case 'R': status = 'renamed'; summary.modified++; break;
        default: status = 'modified'; summary.modified++; break;
      }

      // Get the unified diff for this file
      let diff = '';
      try {
        diff = execFileSync(
          'git',
          ['diff', info.baseBranch + '...HEAD', '--', filePath],
          { cwd: info.worktreePath, encoding: 'utf-8', stdio: 'pipe', maxBuffer: 1024 * 1024 }
        );
      } catch {
        diff = `(diff unavailable for ${filePath})`;
      }

      files.push({ path: filePath, status, diff });
    }

    return { baseBranch: info.baseBranch, worktreeBranch: info.branchName, files, summary };
  }

  /**
   * Apply selected file changes from the worktree back to the original working directory.
   * Does NOT auto-commit — the user decides when to commit.
   */
  applyChanges(sessionId: string, selectedFiles?: string[]): { applied: string[]; errors: string[] } {
    const info = this.worktrees.get(sessionId);
    if (!info) {
      throw new Error(`No worktree found for session ${sessionId}`);
    }

    const diff = this.getDiff(sessionId);
    const filesToApply = selectedFiles
      ? diff.files.filter(f => selectedFiles.includes(f.path))
      : diff.files;

    const applied: string[] = [];
    const errors: string[] = [];

    for (const file of filesToApply) {
      try {
        const srcPath = path.join(info.worktreePath, file.path);
        const destPath = path.join(info.projectDir, file.path);

        if (file.status === 'deleted') {
          if (fs.existsSync(destPath)) {
            fs.unlinkSync(destPath);
            applied.push(file.path);
          }
        } else {
          // added or modified — copy file from worktree to project dir
          const destDir = path.dirname(destPath);
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          fs.copyFileSync(srcPath, destPath);
          applied.push(file.path);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${file.path}: ${msg}`);
        log.error(`[WorktreeManager] Failed to apply ${file.path}:`, err);
      }
    }

    log.info(`[WorktreeManager] Applied ${applied.length} files, ${errors.length} errors for session ${sessionId}`);
    return { applied, errors };
  }

  /**
   * Clean up a worktree and its throwaway branch.
   */
  cleanup(sessionId: string): void {
    const info = this.worktrees.get(sessionId);
    if (!info) {
      log.warn(`[WorktreeManager] No worktree to clean up for session ${sessionId}`);
      return;
    }

    this.forceRemoveWorktree(info.projectDir, info.worktreePath, info.branchName);
    this.worktrees.delete(sessionId);
    log.info(`[WorktreeManager] Cleaned up worktree for session ${sessionId}`);
  }

  /**
   * Get worktree info for a session.
   */
  getWorktreeInfo(sessionId: string): WorktreeInfo | null {
    return this.worktrees.get(sessionId) || null;
  }

  /**
   * Check if a session has an active worktree.
   */
  hasWorktree(sessionId: string): boolean {
    return this.worktrees.has(sessionId);
  }

  /**
   * Get the worktree path for boundary checking in the filesystem guard.
   */
  getWorktreePath(sessionId: string): string | null {
    return this.worktrees.get(sessionId)?.worktreePath || null;
  }

  /**
   * Clean up orphaned worktrees from a previous crash.
   * Should be called on app startup.
   */
  cleanupOrphaned(projectDirs: string[]): void {
    for (const projectDir of projectDirs) {
      try {
        const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
          cwd: projectDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });

        // Parse worktree list for our sandbox branches
        const lines = output.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('branch refs/heads/claudelander/sandbox/')) {
            // Find the worktree path (it's a few lines before the branch line)
            let wtPath = '';
            for (let j = i - 1; j >= 0; j--) {
              if (lines[j].startsWith('worktree ')) {
                wtPath = lines[j].substring('worktree '.length);
                break;
              }
            }
            const branchName = line.substring('branch refs/heads/'.length);

            if (wtPath && !this.worktrees.has(branchName.replace('claudelander/sandbox/', ''))) {
              log.info(`[WorktreeManager] Cleaning orphaned worktree: ${wtPath} (${branchName})`);
              this.forceRemoveWorktree(projectDir, wtPath, branchName);
            }
          }
        }
      } catch {
        // Not a git repo or git not available, skip
      }
    }
  }

  /**
   * Force remove a worktree and its branch.
   */
  private forceRemoveWorktree(projectDir: string, worktreePath: string, branchName: string): void {
    // Remove the worktree
    try {
      execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: projectDir,
        stdio: 'pipe',
      });
    } catch {
      // Try manual removal if git command fails
      try {
        if (fs.existsSync(worktreePath)) {
          fs.rmSync(worktreePath, { recursive: true, force: true });
        }
        // Prune stale worktree entries
        execFileSync('git', ['worktree', 'prune'], { cwd: projectDir, stdio: 'pipe' });
      } catch (err) {
        log.error(`[WorktreeManager] Failed to remove worktree directory:`, err);
      }
    }

    // Delete the branch
    try {
      execFileSync('git', ['branch', '-D', branchName], { cwd: projectDir, stdio: 'pipe' });
    } catch {
      // Branch may already be deleted
    }
  }
}

export const worktreeManager = new WorktreeManager();
