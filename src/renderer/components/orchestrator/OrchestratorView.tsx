import React, { useCallback, useMemo } from 'react';
import { SessionStatusCard } from './SessionStatusCard';
import { BroadcastInput } from './BroadcastInput';
import { useMultiSessionStatus } from '../../hooks/useMultiSessionStatus';
import type { Session } from '../../../shared/types';
import '../../../renderer/styles/orchestrator.css';

interface Props {
  selectedSessionIds: Set<string>;
  sessions: Session[];
  onClearSelection: () => void;
  onFocusSession: (sessionId: string) => void;
}

export const OrchestratorView: React.FC<Props> = ({
  selectedSessionIds,
  sessions,
  onClearSelection,
  onFocusSession,
}) => {
  const sessionIds = useMemo(() => Array.from(selectedSessionIds), [selectedSessionIds]);
  const { statuses, stats } = useMultiSessionStatus(sessionIds);

  const selectedSessions = useMemo(
    () => sessions.filter(s => selectedSessionIds.has(s.id)),
    [sessions, selectedSessionIds]
  );

  const isAnyWorking = stats.working > 0;

  const handleBroadcast = useCallback(async (message: string) => {
    await Promise.all(
      sessionIds.map(async (sid) => {
        const hasSession = await window.electronAPI.claudeHasSession(sid);
        if (hasSession) {
          await window.electronAPI.claudeSend(sid, message);
        } else {
          const sess = sessions.find(s => s.id === sid);
          await window.electronAPI.claudeStart(sid, sess?.workingDir || '.', message);
        }
      })
    );
  }, [sessionIds, sessions]);

  const progressPercent = stats.total > 0
    ? Math.round(((stats.completed + stats.error) / stats.total) * 100)
    : 0;

  return (
    <div className="orchestrator-view">
      <div className="orchestrator-header">
        <div className="orchestrator-header-info">
          <h3>Multi-Agent Orchestrator</h3>
          <span className="orchestrator-count">
            {stats.completed} of {stats.total} completed
            {stats.working > 0 && <> &middot; {stats.working} working</>}
            {stats.error > 0 && <> &middot; {stats.error} errors</>}
          </span>
        </div>
        <div className="orchestrator-progress">
          <div
            className="orchestrator-progress-bar"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <button className="orchestrator-clear" onClick={onClearSelection}>
          Clear Selection
        </button>
      </div>

      <div className="orchestrator-grid">
        {selectedSessions.map(session => {
          const status = statuses.get(session.id);
          if (!status) return null;
          return (
            <SessionStatusCard
              key={session.id}
              sessionName={session.name}
              status={status}
              onFocus={() => onFocusSession(session.id)}
            />
          );
        })}
      </div>

      <BroadcastInput
        sessionCount={stats.total}
        onBroadcast={handleBroadcast}
        disabled={false}
      />
    </div>
  );
};
