import React, { useCallback, useMemo, useState, useEffect } from 'react';
import Terminal from './components/Terminal';
import ContextMenu, { MenuItem } from './components/ContextMenu';
import { useSessions } from './store/sessions';
import { useGroups } from './store/groups';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import './styles/global.css';
import './styles/context-menu.css';

const App: React.FC = () => {
  const { groups, loading: groupsLoading, createGroup, updateGroup, removeGroup, reorderGroup } = useGroups();
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [colorPickerGroupId, setColorPickerGroupId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);
  const [draggedItem, setDraggedItem] = useState<{
    type: 'group' | 'session';
    id: string;
    groupId?: string;
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    type: 'group' | 'session';
    id: string;
    position: 'before' | 'after';
  } | null>(null);

  const GROUP_COLORS = [
    '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2',
    '#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#f38181', '#aa96da',
  ];
  const {
    sessions,
    loading: sessionsLoading,
    activeSessionId,
    setActiveSessionId,
    createSession,
    updateSession,
    removeSession,
    getSessionsByGroup,
    getStateCounts,
    reorderSession,
  } = useSessions();

  const homedir = window.electronAPI.homedir;
  const counts = getStateCounts();
  const isLoading = groupsLoading || sessionsLoading;

  const handleNewSession = useCallback(async (groupId: string) => {
    if (!groupId) {
      console.error('Cannot create session: no group available');
      return;
    }
    const group = groups.find(g => g.id === groupId);
    const cwd = group?.workingDir || homedir;
    const count = getSessionsByGroup(groupId).length + 1;
    await createSession(groupId, `Session ${count}`, cwd, true); // launchClaude = true
  }, [groups, getSessionsByGroup, createSession, homedir]);

  const handleCreateGroup = async () => {
    await createGroup(`Group ${groups.length + 1}`);
  };

  const handleStartEditGroup = (groupId: string, currentName: string) => {
    setEditingGroupId(groupId);
    setEditingGroupName(currentName);
  };

  const handleFinishEditGroup = async () => {
    if (editingGroupId && editingGroupName.trim()) {
      await updateGroup(editingGroupId, { name: editingGroupName.trim() });
    }
    setEditingGroupId(null);
    setEditingGroupName('');
  };

  const handleDeleteGroup = async (groupId: string) => {
    const sessionsInGroup = getSessionsByGroup(groupId);
    if (sessionsInGroup.length > 0) {
      // Don't delete groups with active sessions
      return;
    }
    await removeGroup(groupId);
  };

  const handleSetGroupDirectory = async (groupId: string) => {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) {
      await updateGroup(groupId, { workingDir: dir });
    }
  };

  const handleColorSelect = async (groupId: string, color: string) => {
    await updateGroup(groupId, { color });
    setColorPickerGroupId(null);
  };

  const handleSessionContextMenu = (e: React.MouseEvent, sessionId: string, sessionName: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Rename', onClick: () => handleStartEditSession(sessionId, sessionName) },
        { label: 'separator', onClick: () => {}, separator: true },
        { label: 'Close Session', onClick: () => handleRemoveSession(sessionId), danger: true },
      ],
    });
  };

  const handleGroupContextMenu = (e: React.MouseEvent, groupId: string, groupName: string) => {
    e.preventDefault();
    const sessionsInGroup = getSessionsByGroup(groupId);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'New Session', onClick: () => handleNewSession(groupId) },
        { label: 'Rename', onClick: () => handleStartEditGroup(groupId, groupName) },
        { label: 'Set Working Directory', onClick: () => handleSetGroupDirectory(groupId) },
        { label: 'separator', onClick: () => {}, separator: true },
        {
          label: 'Delete Group',
          onClick: () => handleDeleteGroup(groupId),
          danger: true,
          disabled: sessionsInGroup.length > 0,
        },
      ],
    });
  };

  const handleStartEditSession = (sessionId: string, currentName: string) => {
    setEditingSessionId(sessionId);
    setEditingSessionName(currentName);
  };

  const handleFinishEditSession = async () => {
    if (editingSessionId && editingSessionName.trim()) {
      await updateSession(editingSessionId, { name: editingSessionName.trim() });
    }
    setEditingSessionId(null);
    setEditingSessionName('');
  };

  const handleRemoveSession = useCallback(async (id: string) => {
    await removeSession(id);
  }, [removeSession]);

  // Drag and drop handlers
  const handleGroupDragStart = (e: React.DragEvent, groupId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', groupId);
    setDraggedItem({ type: 'group', id: groupId });
  };

  const handleSessionDragStart = (e: React.DragEvent, sessionId: string, groupId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sessionId);
    setDraggedItem({ type: 'session', id: sessionId, groupId });
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDropTarget(null);
  };

  const handleGroupDragOver = (e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.type !== 'group') return;
    if (draggedItem.id === groupId) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? 'before' : 'after';

    setDropTarget({ type: 'group', id: groupId, position });
  };

  const handleSessionDragOver = (e: React.DragEvent, sessionId: string, groupId: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.type !== 'session') return;
    if (draggedItem.id === sessionId) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? 'before' : 'after';

    setDropTarget({ type: 'session', id: sessionId, position });
  };

  const handleGroupAreaDragOver = (e: React.DragEvent, groupId: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.type !== 'session') return;

    // Allow dropping session into empty group or at end of group
    const sessionsInGroup = getSessionsByGroup(groupId);
    if (sessionsInGroup.length === 0 || draggedItem.groupId !== groupId) {
      setDropTarget({ type: 'session', id: `group:${groupId}`, position: 'after' });
    }
  };

  const handleGroupDrop = (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.type !== 'group' || !dropTarget) return;

    const targetIndex = groups.findIndex(g => g.id === targetGroupId);
    let newOrder = dropTarget.position === 'before' ? targetIndex : targetIndex + 1;

    // Adjust if moving down
    const currentIndex = groups.findIndex(g => g.id === draggedItem.id);
    if (currentIndex < newOrder) newOrder--;

    reorderGroup(draggedItem.id, newOrder);
    handleDragEnd();
  };

  const handleSessionDrop = (e: React.DragEvent, targetSessionId: string, targetGroupId: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.type !== 'session' || !dropTarget) return;

    const targetGroupSessions = getSessionsByGroup(targetGroupId).sort((a, b) => a.order - b.order);
    const targetIndex = targetGroupSessions.findIndex(s => s.id === targetSessionId);
    let newOrder = dropTarget.position === 'before' ? targetIndex : targetIndex + 1;

    // Adjust if moving within same group and moving down
    if (draggedItem.groupId === targetGroupId) {
      const currentIndex = targetGroupSessions.findIndex(s => s.id === draggedItem.id);
      if (currentIndex < newOrder) newOrder--;
    }

    reorderSession(draggedItem.id, targetGroupId, newOrder);
    handleDragEnd();
  };

  const handleGroupAreaDrop = (e: React.DragEvent, targetGroupId: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.type !== 'session') return;

    const targetGroupSessions = getSessionsByGroup(targetGroupId);
    reorderSession(draggedItem.id, targetGroupId, targetGroupSessions.length);
    handleDragEnd();
  };

  const handleNextSession = useCallback(() => {
    const currentIndex = sessions.findIndex(s => s.id === activeSessionId);
    const nextIndex = (currentIndex + 1) % sessions.length;
    if (sessions[nextIndex]) {
      setActiveSessionId(sessions[nextIndex].id);
    }
  }, [sessions, activeSessionId, setActiveSessionId]);

  const handlePrevSession = useCallback(() => {
    const currentIndex = sessions.findIndex(s => s.id === activeSessionId);
    const prevIndex = currentIndex <= 0 ? sessions.length - 1 : currentIndex - 1;
    if (sessions[prevIndex]) {
      setActiveSessionId(sessions[prevIndex].id);
    }
  }, [sessions, activeSessionId, setActiveSessionId]);

  const handleNextWaiting = useCallback(() => {
    const waitingSessions = sessions.filter(s => s.state === 'waiting');
    if (waitingSessions.length > 0) {
      const currentIndex = waitingSessions.findIndex(s => s.id === activeSessionId);
      const nextIndex = (currentIndex + 1) % waitingSessions.length;
      setActiveSessionId(waitingSessions[nextIndex].id);
    }
  }, [sessions, activeSessionId, setActiveSessionId]);

  const handleCloseSession = useCallback(async () => {
    if (activeSessionId) {
      await handleRemoveSession(activeSessionId);
    }
  }, [activeSessionId, handleRemoveSession]);

  const handleKeyboardNewSession = useCallback(() => {
    if (groups[0]) {
      handleNewSession(groups[0].id);
    }
  }, [groups, handleNewSession]);

  const shortcutHandlers = useMemo(() => ({
    onNewSession: handleKeyboardNewSession,
    onNextSession: handleNextSession,
    onPrevSession: handlePrevSession,
    onNextWaiting: handleNextWaiting,
    onCloseSession: handleCloseSession,
  }), [handleKeyboardNewSession, handleNextSession, handlePrevSession, handleNextWaiting, handleCloseSession]);

  useKeyboardShortcuts(shortcutHandlers);

  // Listen for menu events
  useEffect(() => {
    const cleanups = [
      window.electronAPI.onMenuNewSession(handleKeyboardNewSession),
      window.electronAPI.onMenuCloseSession(handleCloseSession),
      window.electronAPI.onMenuNextSession(handleNextSession),
      window.electronAPI.onMenuPrevSession(handlePrevSession),
      window.electronAPI.onMenuNextWaiting(handleNextWaiting),
    ];
    return () => cleanups.forEach(cleanup => cleanup());
  }, [handleKeyboardNewSession, handleCloseSession, handleNextSession, handlePrevSession, handleNextWaiting]);

  if (isLoading) {
    return (
      <div className="app loading">
        <div className="loading-content">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Groups</h2>
          <button
            className="icon-button"
            onClick={handleCreateGroup}
            title="New Group"
          >
            +
          </button>
        </div>

        {groups.map(group => (
          <div
            key={group.id}
            className={`group ${draggedItem?.type === 'group' && draggedItem.id === group.id ? 'dragging' : ''} ${dropTarget?.type === 'group' && dropTarget.id === group.id ? `drop-${dropTarget.position}` : ''}`}
            draggable
            onDragStart={(e) => handleGroupDragStart(e, group.id)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleGroupDragOver(e, group.id)}
            onDrop={(e) => handleGroupDrop(e, group.id)}
          >
            <div
              className="group-header"
              onContextMenu={(e) => handleGroupContextMenu(e, group.id, group.name)}
            >
              <button
                className="group-color"
                style={{ background: group.color }}
                onClick={() => setColorPickerGroupId(colorPickerGroupId === group.id ? null : group.id)}
                title="Change color"
              />
              {colorPickerGroupId === group.id && (
                <div className="color-picker">
                  {GROUP_COLORS.map(color => (
                    <button
                      key={color}
                      className={`color-option ${color === group.color ? 'selected' : ''}`}
                      style={{ background: color }}
                      onClick={() => handleColorSelect(group.id, color)}
                    />
                  ))}
                </div>
              )}
              {editingGroupId === group.id ? (
                <input
                  className="group-name-input"
                  value={editingGroupName}
                  onChange={(e) => setEditingGroupName(e.target.value)}
                  onBlur={handleFinishEditGroup}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleFinishEditGroup();
                    if (e.key === 'Escape') {
                      setEditingGroupId(null);
                      setEditingGroupName('');
                    }
                  }}
                  autoFocus
                />
              ) : (
                <span
                  className="group-name"
                  onClick={() => handleStartEditGroup(group.id, group.name)}
                  title={group.workingDir ? `Click to rename\nDir: ${group.workingDir}` : 'Click to rename'}
                >
                  {group.name}
                  {group.workingDir && <span className="group-dir-indicator" title={group.workingDir}>[dir]</span>}
                </span>
              )}
              <div className="group-actions">
                <button
                  className="group-folder"
                  onClick={() => handleSetGroupDirectory(group.id)}
                  title={group.workingDir || 'Set working directory'}
                >
                  ⌂
                </button>
                <button
                  className="group-delete"
                  onClick={() => handleDeleteGroup(group.id)}
                  title={getSessionsByGroup(group.id).length > 0 ? "Close all sessions first" : "Delete group"}
                  disabled={getSessionsByGroup(group.id).length > 0}
                >
                  ×
                </button>
              </div>
              <button
                className="icon-button small"
                onClick={() => handleNewSession(group.id)}
                title="New Session"
              >
                +
              </button>
            </div>
            <div
              className={`group-sessions ${dropTarget?.id === `group:${group.id}` ? 'drop-target' : ''}`}
              onDragOver={(e) => handleGroupAreaDragOver(e, group.id)}
              onDrop={(e) => handleGroupAreaDrop(e, group.id)}
            >
              {getSessionsByGroup(group.id).sort((a, b) => a.order - b.order).map(session => (
                <div
                  key={session.id}
                  className={`session ${session.id === activeSessionId ? 'active' : ''} ${draggedItem?.type === 'session' && draggedItem.id === session.id ? 'dragging' : ''} ${dropTarget?.type === 'session' && dropTarget.id === session.id ? `drop-${dropTarget.position}` : ''}`}
                  onClick={() => setActiveSessionId(session.id)}
                  onContextMenu={(e) => handleSessionContextMenu(e, session.id, session.name)}
                  draggable
                  onDragStart={(e) => handleSessionDragStart(e, session.id, group.id)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleSessionDragOver(e, session.id, group.id)}
                  onDrop={(e) => handleSessionDrop(e, session.id, group.id)}
                >
                  <div className="session-info">
                    {editingSessionId === session.id ? (
                      <input
                        className="session-name-input"
                        value={editingSessionName}
                        onChange={(e) => setEditingSessionName(e.target.value)}
                        onBlur={handleFinishEditSession}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') handleFinishEditSession();
                          if (e.key === 'Escape') {
                            setEditingSessionId(null);
                            setEditingSessionName('');
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span
                        className="session-name"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          handleStartEditSession(session.id, session.name);
                        }}
                        title="Double-click to rename"
                      >
                        {session.name}
                      </span>
                    )}
                    <span className="session-dir" title={session.workingDir}>
                      {session.workingDir.split('/').pop() || session.workingDir}
                    </span>
                  </div>
                  <span className={`status-pill ${session.state}`}>{session.state}</span>
                  <button
                    className="session-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveSession(session.id);
                    }}
                    title="Close session"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <main className="main">
        <div className="terminal-area">
          {sessions.map(session => (
            <div
              key={session.id}
              className="terminal-wrapper"
              style={{ display: session.id === activeSessionId ? 'block' : 'none' }}
            >
              <Terminal
                sessionId={session.id}
                cwd={session.workingDir}
                launchClaude={session.shellType === 'claude'}
                isStopped={session.state === 'stopped'}
                onStart={() => updateSession(session.id, { state: 'idle' })}
                onError={() => updateSession(session.id, { state: 'error' })}
              />
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="no-session">
              <p>No active session</p>
              <button
                onClick={() => groups[0] && handleNewSession(groups[0].id)}
                disabled={!groups.length}
              >
                Create Session
              </button>
            </div>
          )}
        </div>
      </main>

      <footer className="status-bar">
        <span className="status-item waiting">* {counts.waiting} waiting</span>
        <span className="status-item working">o {counts.working} working</span>
        <span className="status-item idle">o {counts.idle} idle</span>
        <span className="status-item stopped">- {counts.stopped} stopped</span>
        <span className="status-item error">! {counts.error} errors</span>
      </footer>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};

export default App;
