import React, { useState } from 'react';
import { Session } from '../../shared/types';

interface TerminalHeaderProps {
  session: Session;
  onRename: (name: string) => void;
  onRestart: () => void;
  onStop: () => void;
  onClose: () => void;
}

const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  session,
  onRename,
  onRestart,
  onStop,
  onClose,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(session.name);

  const handleFinishEdit = () => {
    if (editName.trim() && editName !== session.name) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  const truncatePath = (path: string, maxLen: number = 50) => {
    if (path.length <= maxLen) return path;
    return '...' + path.slice(-(maxLen - 3));
  };

  return (
    <div className="terminal-header">
      <span className={`header-state-dot ${session.state}`} title={session.state} />

      {isEditing ? (
        <input
          className="header-name-input"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleFinishEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleFinishEdit();
            if (e.key === 'Escape') {
              setEditName(session.name);
              setIsEditing(false);
            }
          }}
          autoFocus
        />
      ) : (
        <span
          className="header-name"
          onDoubleClick={() => {
            setEditName(session.name);
            setIsEditing(true);
          }}
          title="Double-click to rename"
        >
          {session.name}
        </span>
      )}

      <span className="header-path" title={session.workingDir}>
        {truncatePath(session.workingDir)}
      </span>

      <div className="header-actions">
        <button className="header-action" onClick={onRestart} title="Restart session">
          ↻
        </button>
        <button className="header-action" onClick={onStop} title="Stop session">
          ■
        </button>
        <button className="header-action danger" onClick={onClose} title="Close session">
          ×
        </button>
      </div>
    </div>
  );
};

export default TerminalHeader;
