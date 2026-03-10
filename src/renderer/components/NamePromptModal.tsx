import React, { useState, useRef, useEffect, useCallback } from 'react';
import './NamePromptModal.css';

interface NamePromptModalProps {
  isOpen: boolean;
  title: string;
  placeholder: string;
  defaultValue: string;
  onConfirm: (name: string, path?: string) => void;
  onCancel: () => void;
  /** Show an optional path selector for group creation */
  showPathSelector?: boolean;
  pathLabel?: string;
}

export const NamePromptModal: React.FC<NamePromptModalProps> = ({
  isOpen,
  title,
  placeholder,
  defaultValue,
  onConfirm,
  onCancel,
  showPathSelector = false,
  pathLabel = 'Working Directory (optional)',
}) => {
  const [value, setValue] = useState(defaultValue);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      setSelectedPath(null);
      // Focus and select input after modal opens
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, defaultValue]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      onConfirm(trimmed, selectedPath || undefined);
    } else {
      onConfirm(defaultValue, selectedPath || undefined);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  const handleSelectPath = async () => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) {
      setSelectedPath(dir);
    }
  };

  const handleModalKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
      return;
    }
    if (e.key === 'Tab') {
      const modal = e.currentTarget as HTMLElement;
      const focusable = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [onCancel]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="name-prompt-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-prompt-title"
        onKeyDown={handleModalKeyDown}
      >
        <h3 id="name-prompt-title">{title}</h3>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoFocus
          />
          {showPathSelector && (
            <div className="path-selector">
              <label>{pathLabel}</label>
              <div className="path-selector-row">
                <input
                  type="text"
                  value={selectedPath || ''}
                  placeholder="No path selected"
                  readOnly
                  className="path-input"
                />
                <button
                  type="button"
                  onClick={handleSelectPath}
                  className="browse-btn"
                >
                  Browse...
                </button>
              </div>
            </div>
          )}
          <div className="modal-buttons">
            <button type="button" className="cancel-btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="confirm-btn">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
