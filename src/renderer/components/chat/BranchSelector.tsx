import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ConversationBranch } from '../../../shared/types';

export interface BranchSelectorProps {
  sessionId: string;
  currentBranchId: string | null;
  onBranchSwitch: (branchId: string | null) => void;
  onFork: (fromMessageId: string) => void;
}

export const BranchSelector: React.FC<BranchSelectorProps> = ({
  sessionId,
  currentBranchId,
  onBranchSwitch,
  onFork,
}) => {
  const [branches, setBranches] = useState<ConversationBranch[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load branches for this session
  const loadBranches = useCallback(async () => {
    try {
      const result = await window.electronAPI.branchesGetBySession(sessionId);
      setBranches(result);
    } catch (err) {
      console.error('Failed to load branches:', err);
    }
  }, [sessionId]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const activeBranch = branches.find((b) => b.id === currentBranchId);
  const label = activeBranch ? activeBranch.name || `Branch ${activeBranch.id.slice(0, 6)}` : 'main';

  const handleBranchSwitch = (branchId: string | null) => {
    onBranchSwitch(branchId);
    setIsOpen(false);
  };

  const handleDelete = async (e: React.MouseEvent, branchId: string) => {
    e.stopPropagation();
    try {
      await window.electronAPI.branchesDelete(branchId);
      // If we deleted the active branch, switch back to main
      if (branchId === currentBranchId) {
        onBranchSwitch(null);
      }
      loadBranches();
    } catch (err) {
      console.error('Failed to delete branch:', err);
    }
  };

  // Don't render if there are no branches
  if (branches.length === 0) {
    return null;
  }

  return (
    <div className="branch-selector" ref={dropdownRef}>
      <button
        className="branch-selector-toggle"
        onClick={() => setIsOpen(!isOpen)}
        title="Switch conversation branch"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-4 8a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
        </svg>
        <span className="branch-selector-label">{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="branch-selector-chevron">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {isOpen && (
        <div className="branch-selector-dropdown">
          <div
            className={`branch-selector-item ${currentBranchId === null ? 'active' : ''}`}
            onClick={() => handleBranchSwitch(null)}
          >
            <span className="branch-item-name">main</span>
            {currentBranchId === null && <span className="branch-item-active-indicator" />}
          </div>

          {branches.map((branch) => (
            <div
              key={branch.id}
              className={`branch-selector-item ${branch.id === currentBranchId ? 'active' : ''}`}
              onClick={() => handleBranchSwitch(branch.id)}
            >
              <span className="branch-item-name">
                {branch.name || `Branch ${branch.id.slice(0, 6)}`}
              </span>
              {branch.id === currentBranchId && <span className="branch-item-active-indicator" />}
              <button
                className="branch-item-delete"
                onClick={(e) => handleDelete(e, branch.id)}
                title="Delete branch"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
