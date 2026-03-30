import React, { useState, useCallback } from 'react';
import type { DiffReviewData, DiffFile } from '../../../shared/types';

interface Props {
  diffData: DiffReviewData;
  onApply: (selectedFiles?: string[]) => void;
  onReject: () => void;
}

const STATUS_LABELS: Record<DiffFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

const STATUS_COLORS: Record<DiffFile['status'], string> = {
  added: '#a6e3a1',
  modified: '#89b4fa',
  deleted: '#f38ba8',
  renamed: '#fab387',
};

export const DiffReviewPanel: React.FC<Props> = ({ diffData, onApply, onReject }) => {
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(
    new Set(diffData.files.map(f => f.path))
  );
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const toggleFile = useCallback((filePath: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const toggleExpand = useCallback((filePath: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedFiles(new Set(diffData.files.map(f => f.path)));
  }, [diffData.files]);

  const selectNone = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const handleApply = useCallback(async () => {
    setApplying(true);
    const files = selectedFiles.size === diffData.files.length
      ? undefined  // All files selected — apply all
      : Array.from(selectedFiles);
    onApply(files);
  }, [selectedFiles, diffData.files.length, onApply]);

  const { summary } = diffData;

  return (
    <div className="diff-review-panel">
      <div className="diff-review-header">
        <div className="diff-review-title">
          <span className="diff-review-icon">&#x1f4cb;</span>
          Sandbox Changes Review
        </div>
        <div className="diff-review-summary">
          {summary.added > 0 && <span className="diff-stat added">+{summary.added} added</span>}
          {summary.modified > 0 && <span className="diff-stat modified">~{summary.modified} modified</span>}
          {summary.deleted > 0 && <span className="diff-stat deleted">-{summary.deleted} deleted</span>}
          <span className="diff-stat total">{diffData.files.length} files</span>
        </div>
      </div>

      <div className="diff-review-select-bar">
        <button className="diff-select-btn" onClick={selectAll} type="button">Select All</button>
        <button className="diff-select-btn" onClick={selectNone} type="button">Select None</button>
        <span className="diff-select-count">{selectedFiles.size} / {diffData.files.length} selected</span>
      </div>

      <div className="diff-review-files">
        {diffData.files.map(file => (
          <div key={file.path} className="diff-file-entry">
            <div className="diff-file-header" onClick={() => toggleExpand(file.path)}>
              <label className="diff-file-checkbox" onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedFiles.has(file.path)}
                  onChange={() => toggleFile(file.path)}
                />
              </label>
              <span
                className="diff-file-status"
                style={{ color: STATUS_COLORS[file.status] }}
              >
                {STATUS_LABELS[file.status]}
              </span>
              <span className="diff-file-path">{file.path}</span>
              <span className="diff-file-expand">
                {expandedFiles.has(file.path) ? '\u25BC' : '\u25B6'}
              </span>
            </div>

            {expandedFiles.has(file.path) && (
              <div className="diff-file-content">
                <pre className="diff-unified">{formatDiff(file.diff)}</pre>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="diff-review-actions">
        <button
          className="diff-action-btn reject"
          onClick={onReject}
          disabled={applying}
          type="button"
        >
          Reject All
        </button>
        <button
          className="diff-action-btn apply"
          onClick={handleApply}
          disabled={applying || selectedFiles.size === 0}
          type="button"
        >
          {applying ? 'Applying...' : `Apply ${selectedFiles.size} File${selectedFiles.size !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  );
};

/**
 * Simple diff colorization — returns the diff as-is (CSS handles coloring via line prefixes)
 */
function formatDiff(diff: string): string {
  if (!diff) return '(no diff available)';
  // Trim excessively long diffs
  const MAX_LINES = 500;
  const lines = diff.split('\n');
  if (lines.length > MAX_LINES) {
    return lines.slice(0, MAX_LINES).join('\n') + `\n\n... (${lines.length - MAX_LINES} more lines)`;
  }
  return diff;
}
