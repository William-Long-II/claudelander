import React from 'react';
import Terminal from './components/Terminal';
import { useSessions } from './store/sessions';
import { useGroups } from './store/groups';
import './styles/global.css';

const App: React.FC = () => {
  const { groups, createGroup } = useGroups();
  const {
    sessions,
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

  const handleNewSession = (groupId: string) => {
    const count = getSessionsByGroup(groupId).length + 1;
    createSession(groupId, `Session ${count}`, homedir);
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Groups</h2>
          <button
            className="icon-button"
            onClick={() => createGroup(`Group ${groups.length + 1}`)}
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
                  removeSession(session.id);
                }}
              >
                ×
              </button>
            </span>
          ))}
          <button
            className="tab new-tab"
            onClick={() => handleNewSession(groups[0]?.id || 'default')}
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
            />
          ) : (
            <div className="no-session">
              <p>No active session</p>
              <button onClick={() => handleNewSession(groups[0]?.id || 'default')}>
                Create Session
              </button>
            </div>
          )}
        </div>
      </main>

      <footer className="status-bar">
        <span className="status-item waiting">● {counts.waiting} waiting</span>
        <span className="status-item working">◐ {counts.working} working</span>
        <span className="status-item idle">○ {counts.idle} idle</span>
        <span className="status-item error">⚠ {counts.error} errors</span>
      </footer>
    </div>
  );
};

export default App;
