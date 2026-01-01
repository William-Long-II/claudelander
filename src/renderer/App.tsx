import React from 'react';
import Terminal from './components/Terminal';
import './styles/global.css';

const App: React.FC = () => {
  // Use home directory from preload (main process)
  const homedir = window.electronAPI?.homedir || '/';

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>Groups</h2>
      </aside>
      <main className="main">
        <div className="tabs">
          <span className="tab active">Session 1</span>
        </div>
        <div className="terminal-area">
          <Terminal sessionId="session-1" cwd={homedir} />
        </div>
      </main>
      <footer className="status-bar">
        ● 0 waiting │ ◐ 0 working │ ○ 1 idle │ ⚠ 0 errors
      </footer>
    </div>
  );
};

export default App;
