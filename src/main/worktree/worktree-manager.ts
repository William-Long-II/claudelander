import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import log from 'electron-log';

const execAsync = promisify(exec);

export interface GitWorktree {
  path: string;
  branch: string;
  commit: string;
  isBare: boolean;
  isMain: boolean;
  isLocked: boolean;
}

export interface WorktreeCreateOptions {
  basePath: string;      // Main repo path
  branch: string;        // Branch name (new or existing)
  createBranch: boolean; // Whether to create a new branch
  baseBranch?: string;   // Base branch if creating new
  worktreePath?: string; // Custom worktree path (optional)
}

class WorktreeManager {
  /**
   * List all worktrees for a repository
   */
  async listWorktrees(repoPath: string): Promise<GitWorktree[]> {
    try {
      const { stdout } = await execAsync('git worktree list --porcelain', {
        cwd: repoPath,
      });

      const worktrees: GitWorktree[] = [];
      const blocks = stdout.trim().split('\n\n');

      for (const block of blocks) {
        if (!block.trim()) continue;

        const lines = block.split('\n');
        const worktree: GitWorktree = {
          path: '',
          branch: '',
          commit: '',
          isBare: false,
          isMain: false,
          isLocked: false,
        };

        for (const line of lines) {
          if (line.startsWith('worktree ')) {
            worktree.path = line.substring(9).trim();
          } else if (line.startsWith('HEAD ')) {
            worktree.commit = line.substring(5).trim();
          } else if (line.startsWith('branch ')) {
            worktree.branch = line.substring(7).replace('refs/heads/', '').trim();
          } else if (line === 'bare') {
            worktree.isBare = true;
          } else if (line === 'locked') {
            worktree.isLocked = true;
          } else if (line === 'detached') {
            worktree.branch = 'HEAD (detached)';
          }
        }

        // First worktree is typically the main one
        if (worktrees.length === 0) {
          worktree.isMain = true;
        }

        if (worktree.path) {
          worktrees.push(worktree);
        }
      }

      return worktrees;
    } catch (error) {
      log.error('Failed to list worktrees:', error);
      throw error;
    }
  }

  /**
   * Create a new worktree
   */
  async createWorktree(options: WorktreeCreateOptions): Promise<GitWorktree> {
    const { basePath, branch, createBranch, baseBranch, worktreePath } = options;

    // Generate worktree path if not provided
    const targetPath = worktreePath || path.join(
      path.dirname(basePath),
      `${path.basename(basePath)}-${branch.replace(/\//g, '-')}`
    );

    // Ensure the parent directory exists
    const parentDir = path.dirname(targetPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    try {
      let cmd: string;
      if (createBranch) {
        // Create new branch and worktree
        const base = baseBranch || 'HEAD';
        cmd = `git worktree add -b "${branch}" "${targetPath}" ${base}`;
      } else {
        // Use existing branch
        cmd = `git worktree add "${targetPath}" "${branch}"`;
      }

      await execAsync(cmd, { cwd: basePath });

      // Get the created worktree info
      const worktrees = await this.listWorktrees(basePath);
      const created = worktrees.find(w => w.path === targetPath);

      if (!created) {
        throw new Error('Worktree was created but could not be found');
      }

      return created;
    } catch (error) {
      log.error('Failed to create worktree:', error);
      throw error;
    }
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(repoPath: string, worktreePath: string, force: boolean = false): Promise<void> {
    try {
      const forceFlag = force ? '--force' : '';
      await execAsync(`git worktree remove ${forceFlag} "${worktreePath}"`, {
        cwd: repoPath,
      });
    } catch (error) {
      log.error('Failed to remove worktree:', error);
      throw error;
    }
  }

  /**
   * Prune stale worktree references
   */
  async pruneWorktrees(repoPath: string): Promise<void> {
    try {
      await execAsync('git worktree prune', { cwd: repoPath });
    } catch (error) {
      log.error('Failed to prune worktrees:', error);
      throw error;
    }
  }

  /**
   * Lock a worktree to prevent removal
   */
  async lockWorktree(repoPath: string, worktreePath: string, reason?: string): Promise<void> {
    try {
      const reasonArg = reason ? `--reason "${reason}"` : '';
      await execAsync(`git worktree lock ${reasonArg} "${worktreePath}"`, {
        cwd: repoPath,
      });
    } catch (error) {
      log.error('Failed to lock worktree:', error);
      throw error;
    }
  }

  /**
   * Unlock a worktree
   */
  async unlockWorktree(repoPath: string, worktreePath: string): Promise<void> {
    try {
      await execAsync(`git worktree unlock "${worktreePath}"`, {
        cwd: repoPath,
      });
    } catch (error) {
      log.error('Failed to unlock worktree:', error);
      throw error;
    }
  }

  /**
   * Get list of branches for a repository
   */
  async listBranches(repoPath: string): Promise<{ local: string[]; remote: string[] }> {
    try {
      // Local branches
      const { stdout: localOutput } = await execAsync('git branch --format="%(refname:short)"', {
        cwd: repoPath,
      });
      const local = localOutput.trim().split('\n').filter(b => b);

      // Remote branches
      const { stdout: remoteOutput } = await execAsync('git branch -r --format="%(refname:short)"', {
        cwd: repoPath,
      });
      const remote = remoteOutput.trim().split('\n').filter(b => b);

      return { local, remote };
    } catch (error) {
      log.error('Failed to list branches:', error);
      throw error;
    }
  }

  /**
   * Check if a path is a git repository
   */
  async isGitRepo(dirPath: string): Promise<boolean> {
    try {
      await execAsync('git rev-parse --is-inside-work-tree', { cwd: dirPath });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the root of a git repository
   */
  async getRepoRoot(dirPath: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git rev-parse --show-toplevel', {
        cwd: dirPath,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(repoPath: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: repoPath,
      });
      return stdout.trim();
    } catch {
      return '';
    }
  }
}

export const worktreeManager = new WorktreeManager();
