import React, { useMemo } from 'react';
import { Session, Group } from '../../shared/types';
import './KanbanBoard.css';

interface KanbanBoardProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSessionClick: (sessionId: string) => void;
  onSessionRemove: (sessionId: string) => void;
  sharingSessions: Set<string>;
  groups: Group[];
  selectedGroupId: string | null;
}

type KanbanColumn = 'backlog' | 'inProgress' | 'waiting' | 'completed';

interface SessionCard {
  session: Session;
  groupColor: string;
  groupName: string;
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({
  sessions,
  activeSessionId,
  onSessionClick,
  onSessionRemove,
  sharingSessions,
  groups,
  selectedGroupId,
}) => {
  // Filter sessions by selected group
  const filteredSessions = useMemo(() => {
    if (!selectedGroupId) return sessions;
    return sessions.filter(s => s.groupId === selectedGroupId);
  }, [sessions, selectedGroupId]);

  // Categorize sessions into columns
  const columns = useMemo(() => {
    const cols: Record<KanbanColumn, SessionCard[]> = {
      backlog: [],
      inProgress: [],
      waiting: [],
      completed: [],
    };

    filteredSessions.forEach(session => {
      const group = groups.find(g => g.id === session.groupId);
      const card: SessionCard = {
        session,
        groupColor: group?.color || '#888',
        groupName: group?.name || 'Unknown',
      };

      // Map session states to kanban columns
      if (session.state === 'working') {
        cols.inProgress.push(card);
      } else if (session.state === 'waiting') {
        cols.waiting.push(card);
      } else if (session.state === 'idle') {
        // Check if session has had recent activity (completed work)
        const timeSinceActivity = Date.now() - new Date(session.lastActivityAt).getTime();
        // If activity was recent (within 5 minutes), consider it completed work
        if (timeSinceActivity < 5 * 60 * 1000 && session.lastActivityAt > session.createdAt) {
          cols.completed.push(card);
        } else {
          cols.backlog.push(card);
        }
      } else if (session.state === 'stopped' || session.state === 'error') {
        cols.backlog.push(card);
      } else {
        cols.backlog.push(card);
      }
    });

    return cols;
  }, [filteredSessions, groups]);

  const getColumnTitle = (column: KanbanColumn): string => {
    const counts = {
      backlog: columns.backlog.length,
      inProgress: columns.inProgress.length,
      waiting: columns.waiting.length,
      completed: columns.completed.length,
    };

    const titles: Record<KanbanColumn, string> = {
      backlog: `Backlog (${counts.backlog})`,
      inProgress: `In Progress (${counts.inProgress})`,
      waiting: `Waiting (${counts.waiting})`,
      completed: `Completed (${counts.completed})`,
    };

    return titles[column];
  };

  const getColumnIcon = (column: KanbanColumn): string => {
    const icons: Record<KanbanColumn, string> = {
      backlog: '📋',
      inProgress: '⚡',
      waiting: '⏳',
      completed: '✅',
    };
    return icons[column];
  };

  const renderCard = (card: SessionCard) => {
    const { session, groupColor, groupName } = card;
    const isActive = session.id === activeSessionId;
    const isSharing = sharingSessions.has(session.id);

    return (
      <div
        key={session.id}
        className={`kanban-card ${isActive ? 'active' : ''}`}
        onClick={() => onSessionClick(session.id)}
      >
        <div className="kanban-card-header">
          <div className="kanban-card-group" style={{ borderLeftColor: groupColor }}>
            <span className="kanban-group-name">{groupName}</span>
          </div>
          <button
            className="kanban-card-close"
            onClick={(e) => {
              e.stopPropagation();
              onSessionRemove(session.id);
            }}
            title="Close session"
          >
            ×
          </button>
        </div>
        <div className="kanban-card-body">
          <h4 className="kanban-card-title">{session.name}</h4>
          <div className="kanban-card-meta">
            <span className={`kanban-status-badge ${session.state}`}>
              {session.state}
            </span>
            {isSharing && (
              <span className="kanban-share-badge" title="Sharing">
                ⇄
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderColumn = (column: KanbanColumn) => {
    return (
      <div key={column} className={`kanban-column kanban-column-${column}`}>
        <div className="kanban-column-header">
          <span className="kanban-column-icon">{getColumnIcon(column)}</span>
          <h3 className="kanban-column-title">{getColumnTitle(column)}</h3>
        </div>
        <div className="kanban-column-body">
          {columns[column].length === 0 ? (
            <div className="kanban-empty">No sessions</div>
          ) : (
            columns[column].map(renderCard)
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="kanban-board">
      {renderColumn('backlog')}
      {renderColumn('inProgress')}
      {renderColumn('waiting')}
      {renderColumn('completed')}
    </div>
  );
};

export default KanbanBoard;
