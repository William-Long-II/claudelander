import React from 'react';
import './styles/global.css';

const App: React.FC = () => {
  return (
    <div className="app">
      <aside className="sidebar">
        <h2>Groups</h2>
      </aside>
      <main className="main">
        <div className="tabs">Tabs</div>
        <div className="terminal-area">Terminal Area</div>
      </main>
      <footer className="status-bar">
        Status Bar
      </footer>
    </div>
  );
};

export default App;
