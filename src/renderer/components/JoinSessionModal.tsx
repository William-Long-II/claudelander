import React, { useState, useCallback } from 'react';
import './ShareModal.css'; // Reuse styles

interface JoinSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJoined: (result: { code: string; hostUsername: string; sessionName: string; permission: 'read' | 'control' }) => void;
}

export const JoinSessionModal: React.FC<JoinSessionModalProps> = ({
  isOpen,
  onClose,
  onJoined,
}) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async () => {
    if (!code.trim()) {
      setError('Please enter a share code');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI.joinSession(code.toUpperCase());
      onJoined({
        code: code.toUpperCase(),
        hostUsername: result.hostUsername,
        sessionName: result.sessionName,
        permission: result.permission,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }

    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (loading) return;
    if (e.key === 'Enter') {
      handleJoin();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleModalKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
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
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content share-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="join-modal-title"
        onKeyDown={handleModalKeyDown}
      >
        <div className="modal-header">
          <h2 id="join-modal-title">Join Shared Session</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close join dialog">&times;</button>
        </div>

        <div className="modal-body">
          <p>Enter the share code to join a session:</p>

          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <label htmlFor="join-code" className="sr-only">Session Code</label>
            <input
              id="join-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              placeholder="SYCLX-XXXXXX"
              className="code-input"
              autoFocus
            />
          </div>

          <button
            className="btn primary"
            onClick={handleJoin}
            disabled={loading || !code.trim()}
            style={{ width: '100%' }}
          >
            {loading ? 'Joining...' : 'Join Session'}
          </button>
        </div>
      </div>
    </div>
  );
};
