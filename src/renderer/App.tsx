import React, { useCallback } from 'react';
import Terminal from './components/Terminal';
import { useSessions } from './store/sessions';
import { useGroups } from './store/groups';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import './styles/global.css';

const App: React.FC = () => {
  const { groups, loading: groupsLoading, createGroup } = useGroups();
  const {
    sessions,
    loading: sessionsLoading,
    activeSessionId,
    setActiveSessionId,
    createSession,
    removeSession,
    getSessionsByGroup,
    getStateCounts,
  } = useSessions();

  const homedir = window.electronAPI.homedir;
  const counts = getStateCounts();
  const activeSession = sessions.find(s => s.id === activeSessionId);
  const isLoading = groupsLoading || sessionsLoading;

  const handleNewSession = async (groupId: string) => {
    if (!groupId) {
      console.error('Cannot create session: no group available');
      return;
    }
    const count = getSessionsByGroup(groupId).length + 1;
    await createSession(groupId, `Session ${count}`, homedir, true); // launchClaude = true
  };

  const handleCreateGroup = async () => {
    await createGroup(`Group ${groups.length + 1}`);
  };

  const handleRemoveSession = async (id: string) => {
    await removeSession(id);
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

  useKeyboardShortcuts({
    onNewSession: () => groups[0] && handleNewSession(groups[0].id),
    onNextSession: handleNextSession,
    onPrevSession: handlePrevSession,
    onNextWaiting: handleNextWaiting,
    onCloseSession: handleCloseSession,
  });

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
          <div key={group.id} className="group">
            <div className="group-header">
              <span className="group-color" style={{ background: group.color }} />
              <span className="group-name">{group.name}</span>
              <button
                className="icon-button small"
                onClick={() => handleNewSession(group.id)}
                title="New Session"
              >
                +
              </button>
            </div>
            <div className="group-sessions">
              {getSessionsByGroup(group.id).map(session => (
                <div
                  key={session.id}
                  className={`session ${session.id === activeSessionId ? 'active' : ''}`}
                  onClick={() => setActiveSessionId(session.id)}
                >
                  <span className={`state-indicator ${session.state}`} />
                  <span className="session-name">{session.name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <main className="main">
        <div className="tabs">
          {sessions.map(session => (
            <span
              key={session.id}
              className={`tab ${session.id === activeSessionId ? 'active' : ''}`}
              onClick={() => setActiveSessionId(session.id)}
            >
              {session.name}
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveSession(session.id);
                }}
              >
                x
              </button>
            </span>
          ))}
          <button
            className="tab new-tab"
            onClick={() => groups[0] && handleNewSession(groups[0].id)}
            disabled={!groups.length}
          >
            +
          </button>
        </div>
        <div className="terminal-area">
          {activeSession ? (
            <Terminal
              key={activeSession.id}
              sessionId={activeSession.id}
              cwd={activeSession.workingDir}
              launchClaude={activeSession.shellType === 'claude'}
            />
          ) : (
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
        <span className="status-item error">! {counts.error} errors</span>
      </footer>
    </div>
  );
};

export default App;
