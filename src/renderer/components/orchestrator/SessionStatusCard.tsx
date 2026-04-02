import React from 'react';
import type { SessionLiveStatus } from '../../hooks/useMultiSessionStatus';

interface Props {
  sessionName: string;
  status: SessionLiveStatus;
  onFocus: () => void;
}

export const SessionStatusCard: React.FC<Props> = ({ sessionName, status, onFocus }) => {
  const stateClass = status.state === 'thinking' || status.state === 'streaming' || status.state === 'tool_executing'
    ? 'working'
    : status.state === 'waiting_permission'
    ? 'waiting'
    : status.state;

  return (
    <div className={`status-card ${status.isStreaming ? 'streaming' : ''}`}>
      <div className="status-card-header">
        <span className="status-card-name">{sessionName}</span>
        <span className={`status-pill ${stateClass}`}>
          {status.description}
        </span>
      </div>
      <div className="status-card-snippet">
        {status.latestSnippet ? (
          <p>{status.latestSnippet}</p>
        ) : (
          <p className="status-card-empty">No response yet</p>
        )}
        {status.isStreaming && <span className="streaming-dot" />}
      </div>
      <div className="status-card-footer">
        <button className="status-card-focus" onClick={onFocus}>
          Focus
        </button>
        {status.completedAt && (
          <span className="status-card-completed">Done</span>
        )}
      </div>
    </div>
  );
};
