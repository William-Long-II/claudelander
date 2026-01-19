import React, { useState, useEffect, useCallback } from 'react';
import './WorktreePanel.css';

interface GitWorktree {
  path: string;
  branch: string;
  commit: string;
  isBare: boolean;
  isMain: boolean;
  isLocked: boolean;
}

interface WorktreePanelProps {
  isOpen: boolean;
  onClose: () => void;
  repoPath: string;
  onWorktreeSelect?: (worktreePath: string) => void;
}

const WorktreePanel: React.FC<WorktreePanelProps> = ({
  isOpen,
  onClose,
  repoPath,
  onWorktreeSelect,
}) => {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [branches, setBranches] = useState<{ local: string[]; remote: string[] }>({ local: [], remote: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create worktree form state
  const [newBranch, setNewBranch] = useState('');
  const [createNew, setCreateNew] = useState(true);
  const [baseBranch, setBaseBranch] = useState('');
  const [selectedExisting, setSelectedExisting] = useState('');

  const loadWorktrees = useCallback(async () => {
    if (!repoPath) return;

    setLoading(true);
    setError(null);
    try {
      const [wts, brs] = await Promise.all([
        window.electronAPI.worktreeList(repoPath),
        window.electronAPI.worktreeBranches(repoPath),
      ]);
      setWorktrees(wts);
      setBranches(brs);

      // Set default base branch
      if (brs.local.includes('main')) {
        setBaseBranch('main');
      } else if (brs.local.includes('master')) {
        setBaseBranch('master');
      } else if (brs.local.length > 0) {
        setBaseBranch(brs.local[0]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  useEffect(() => {
    if (isOpen && repoPath) {
      loadWorktrees();
    }
  }, [isOpen, repoPath, loadWorktrees]);

  const handleCreateWorktree = async () => {
    if (createNew && !newBranch.trim()) return;
    if (!createNew && !selectedExisting) return;

    try {
      setLoading(true);
      await window.electronAPI.worktreeCreate({
        basePath: repoPath,
        branch: createNew ? newBranch.trim() : selectedExisting,
        createBranch: createNew,
        baseBranch: createNew ? baseBranch : undefined,
      });

      // Reset form and reload
      setNewBranch('');
      setSelectedExisting('');
      setShowCreateForm(false);
      await loadWorktrees();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveWorktree = async (worktreePath: string, force: boolean = false) => {
    if (!confirm(`Are you sure you want to remove the worktree at ${worktreePath}?`)) {
      return;
    }

    try {
      setLoading(true);
      await window.electronAPI.worktreeRemove(repoPath, worktreePath, force);
      await loadWorktrees();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleLockToggle = async (worktree: GitWorktree) => {
    try {
      setLoading(true);
      if (worktree.isLocked) {
        await window.electronAPI.worktreeUnlock(repoPath, worktree.path);
      } else {
        await window.electronAPI.worktreeLock(repoPath, worktree.path);
      }
      await loadWorktrees();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handlePrune = async () => {
    try {
      setLoading(true);
      await window.electronAPI.worktreePrune(repoPath);
      await loadWorktrees();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // Get branches not already in use by worktrees
  const availableBranches = branches.local.filter(
    b => !worktrees.some(w => w.branch === b)
  );

  if (!isOpen) return null;

  return (
    <div className="worktree-overlay" onClick={onClose}>
      <div className="worktree-panel" onClick={e => e.stopPropagation()}>
        <div className="worktree-header">
          <h2>Git Worktrees</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="worktree-repo-info">
          <span className="repo-path">{repoPath}</span>
        </div>

        {error && (
          <div className="worktree-error">
            {error}
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}

        <div className="worktree-actions">
          <button
            className="btn primary"
            onClick={() => setShowCreateForm(true)}
            disabled={loading}
          >
            + New Worktree
          </button>
          <button
            className="btn secondary"
            onClick={handlePrune}
            disabled={loading}
            title="Clean up stale worktree references"
          >
            Prune
          </button>
          <button
            className="btn secondary"
            onClick={loadWorktrees}
            disabled={loading}
          >
            Refresh
          </button>
        </div>

        {showCreateForm && (
          <div className="worktree-create-form">
            <h3>Create New Worktree</h3>

            <div className="form-tabs">
              <button
                className={`tab ${createNew ? 'active' : ''}`}
                onClick={() => setCreateNew(true)}
              >
                New Branch
              </button>
              <button
                className={`tab ${!createNew ? 'active' : ''}`}
                onClick={() => setCreateNew(false)}
              >
                Existing Branch
              </button>
            </div>

            {createNew ? (
              <>
                <div className="form-group">
                  <label>Branch Name</label>
                  <input
                    type="text"
                    value={newBranch}
                    onChange={e => setNewBranch(e.target.value)}
                    placeholder="feature/my-feature"
                  />
                </div>
                <div className="form-group">
                  <label>Base Branch</label>
                  <select
                    value={baseBranch}
                    onChange={e => setBaseBranch(e.target.value)}
                  >
                    {branches.local.map(b => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <div className="form-group">
                <label>Select Branch</label>
                <select
                  value={selectedExisting}
                  onChange={e => setSelectedExisting(e.target.value)}
                >
                  <option value="">Select a branch...</option>
                  {availableBranches.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-actions">
              <button
                className="btn secondary"
                onClick={() => setShowCreateForm(false)}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={handleCreateWorktree}
                disabled={loading || (createNew ? !newBranch.trim() : !selectedExisting)}
              >
                Create
              </button>
            </div>
          </div>
        )}

        <div className="worktree-list">
          {loading && worktrees.length === 0 ? (
            <div className="loading">Loading worktrees...</div>
          ) : worktrees.length === 0 ? (
            <div className="empty">No worktrees found</div>
          ) : (
            worktrees.map(wt => (
              <div
                key={wt.path}
                className={`worktree-item ${wt.isMain ? 'main' : ''} ${wt.isLocked ? 'locked' : ''}`}
              >
                <div className="worktree-info">
                  <div className="worktree-branch">
                    {wt.isMain && <span className="badge main">main</span>}
                    {wt.isLocked && <span className="badge locked">locked</span>}
                    <span className="branch-name">{wt.branch}</span>
                  </div>
                  <div className="worktree-path">{wt.path}</div>
                  <div className="worktree-commit">{wt.commit.substring(0, 7)}</div>
                </div>
                <div className="worktree-item-actions">
                  {onWorktreeSelect && (
                    <button
                      className="btn small"
                      onClick={() => onWorktreeSelect(wt.path)}
                      title="Use this worktree"
                    >
                      Select
                    </button>
                  )}
                  {!wt.isMain && (
                    <>
                      <button
                        className="btn small"
                        onClick={() => handleLockToggle(wt)}
                        title={wt.isLocked ? 'Unlock' : 'Lock'}
                      >
                        {wt.isLocked ? '🔓' : '🔒'}
                      </button>
                      <button
                        className="btn small danger"
                        onClick={() => handleRemoveWorktree(wt.path, false)}
                        title="Remove worktree"
                        disabled={wt.isLocked}
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default WorktreePanel;
