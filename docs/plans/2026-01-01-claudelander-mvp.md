# Claudelander MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a cross-platform Electron app for managing multiple Claude Code sessions with visual status indicators.

**Architecture:** Electron main process manages PTY sessions via node-pty, renderer displays terminals via xterm.js. Hook wrapper reports Claude state to main process via IPC. SQLite persists groups/sessions/preferences.

**Tech Stack:** Electron, TypeScript, xterm.js, node-pty, better-sqlite3, React (renderer)

---

## Phase 1: Project Scaffold

### Task 1.1: Initialize Electron Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/main/index.ts`
- Create: `src/renderer/index.html`

**Step 1: Initialize npm and install dependencies**

```bash
cd /home/will/projects/claudelander/.worktrees/mvp
npm init -y
npm install electron electron-builder
npm install -D typescript @types/node
```

**Step 2: Create package.json scripts**

Update `package.json`:
```json
{
  "name": "claudelander",
  "version": "0.1.0",
  "description": "Cross-platform Claude Code session manager",
  "main": "dist/main/index.js",
  "scripts": {
    "build": "tsc",
    "start": "npm run build && electron .",
    "dev": "tsc && electron ."
  },
  "devDependencies": {
    "@types/node": "^20.x",
    "electron": "^28.x",
    "electron-builder": "^24.x",
    "typescript": "^5.x"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create main process entry**

Create `src/main/index.ts`:
```typescript
import { app, BrowserWindow } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
```

**Step 5: Create preload script**

Create `src/main/preload.ts`:
```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Will be populated as we add features
  platform: process.platform,
});
```

**Step 6: Create renderer HTML**

Create `src/renderer/index.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'">
  <title>Claudelander</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1e1e1e;
      color: #fff;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    h1 { font-size: 2rem; opacity: 0.8; }
  </style>
</head>
<body>
  <h1>Claudelander</h1>
</body>
</html>
```

**Step 7: Build and verify app launches**

```bash
npm run dev
```
Expected: Electron window opens showing "Claudelander"

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: initialize Electron project scaffold"
```

---

### Task 1.2: Add React to Renderer

**Files:**
- Modify: `package.json`
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/index.tsx`
- Modify: `src/renderer/index.html`
- Create: `webpack.config.js`

**Step 1: Install React and webpack dependencies**

```bash
npm install react react-dom
npm install -D @types/react @types/react-dom webpack webpack-cli ts-loader html-webpack-plugin
```

**Step 2: Create webpack config**

Create `webpack.config.js`:
```javascript
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'development',
  entry: './src/renderer/index.tsx',
  target: 'electron-renderer',
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  output: {
    filename: 'renderer.js',
    path: path.resolve(__dirname, 'dist/renderer'),
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/renderer/index.html',
    }),
  ],
};
```

**Step 3: Install style loaders**

```bash
npm install -D style-loader css-loader
```

**Step 4: Update tsconfig for React**

Add to `tsconfig.json` compilerOptions:
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "moduleResolution": "node"
  }
}
```

**Step 5: Create React entry point**

Create `src/renderer/index.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
```

**Step 6: Create App component**

Create `src/renderer/App.tsx`:
```tsx
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
```

**Step 7: Create global styles**

Create `src/renderer/styles/global.css`:
```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #1e1e1e;
  color: #d4d4d4;
  height: 100vh;
  overflow: hidden;
}

.app {
  display: grid;
  grid-template-columns: 220px 1fr;
  grid-template-rows: 1fr 28px;
  height: 100vh;
}

.sidebar {
  grid-row: 1 / 2;
  background: #252526;
  border-right: 1px solid #3c3c3c;
  padding: 12px;
}

.sidebar h2 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #888;
  margin-bottom: 12px;
}

.main {
  display: flex;
  flex-direction: column;
}

.tabs {
  height: 35px;
  background: #2d2d2d;
  border-bottom: 1px solid #3c3c3c;
  display: flex;
  align-items: center;
  padding: 0 8px;
}

.terminal-area {
  flex: 1;
  background: #1e1e1e;
}

.status-bar {
  grid-column: 1 / 3;
  background: #007acc;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 12px;
}
```

**Step 8: Update HTML template**

Update `src/renderer/index.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'">
  <title>Claudelander</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>
```

**Step 9: Update package.json scripts**

```json
{
  "scripts": {
    "build:main": "tsc -p tsconfig.main.json",
    "build:renderer": "webpack",
    "build": "npm run build:main && npm run build:renderer",
    "start": "npm run build && electron .",
    "dev": "npm run build && electron ."
  }
}
```

**Step 10: Create separate tsconfig for main process**

Create `tsconfig.main.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist/main"
  },
  "include": ["src/main/**/*"]
}
```

**Step 11: Build and verify**

```bash
npm run dev
```
Expected: Window shows layout with sidebar, main area, and blue status bar

**Step 12: Commit**

```bash
git add -A
git commit -m "feat: add React renderer with basic layout"
```

---

## Phase 2: Terminal Integration

### Task 2.1: Integrate xterm.js

**Files:**
- Modify: `package.json`
- Create: `src/renderer/components/Terminal.tsx`
- Create: `src/renderer/styles/terminal.css`
- Modify: `src/renderer/App.tsx`

**Step 1: Install xterm.js**

```bash
npm install xterm xterm-addon-fit xterm-addon-webgl
```

**Step 2: Create Terminal component**

Create `src/renderer/components/Terminal.tsx`:
```tsx
import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import '../styles/terminal.css';

interface TerminalProps {
  sessionId: string;
}

const Terminal: React.FC<TerminalProps> = ({ sessionId }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
      },
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Demo text
    term.writeln('Claudelander Terminal');
    term.writeln('Session: ' + sessionId);
    term.writeln('');

    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={terminalRef} className="terminal-container" />;
};

export default Terminal;
```

**Step 3: Create terminal styles**

Create `src/renderer/styles/terminal.css`:
```css
.terminal-container {
  width: 100%;
  height: 100%;
  padding: 8px;
}

.terminal-container .xterm {
  height: 100%;
}

.terminal-container .xterm-viewport {
  overflow-y: auto;
}
```

**Step 4: Update App to use Terminal**

Update `src/renderer/App.tsx`:
```tsx
import React from 'react';
import Terminal from './components/Terminal';
import './styles/global.css';

const App: React.FC = () => {
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
          <Terminal sessionId="demo-session-1" />
        </div>
      </main>
      <footer className="status-bar">
        ● 0 waiting │ ◐ 0 working │ ○ 1 idle │ ⚠ 0 errors
      </footer>
    </div>
  );
};

export default App;
```

**Step 5: Add tab styles to global.css**

Append to `src/renderer/styles/global.css`:
```css
.tab {
  padding: 6px 16px;
  background: #2d2d2d;
  border: 1px solid #3c3c3c;
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  margin-right: 4px;
  font-size: 13px;
  cursor: pointer;
}

.tab.active {
  background: #1e1e1e;
  border-bottom: 1px solid #1e1e1e;
  margin-bottom: -1px;
}
```

**Step 6: Build and verify**

```bash
npm run dev
```
Expected: Terminal renders with demo text, resizes with window

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: integrate xterm.js terminal rendering"
```

---

### Task 2.2: Integrate node-pty

**Files:**
- Modify: `package.json`
- Create: `src/main/pty-manager.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/components/Terminal.tsx`

**Step 1: Install node-pty**

```bash
npm install node-pty
npm install -D @types/node-pty electron-rebuild
```

**Step 2: Add rebuild script and run it**

Add to package.json scripts:
```json
{
  "scripts": {
    "postinstall": "electron-rebuild"
  }
}
```

Then run:
```bash
npm run postinstall
```

**Step 3: Create PTY manager**

Create `src/main/pty-manager.ts`:
```typescript
import * as pty from 'node-pty';
import { EventEmitter } from 'events';

interface PtySession {
  id: string;
  pty: pty.IPty;
  cwd: string;
}

class PtyManager extends EventEmitter {
  private sessions: Map<string, PtySession> = new Map();

  getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  createSession(id: string, cwd: string): void {
    const shell = this.getDefaultShell();

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd,
      env: process.env as { [key: string]: string },
    });

    ptyProcess.onData((data) => {
      this.emit('data', { id, data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', { id, exitCode });
      this.sessions.delete(id);
    });

    this.sessions.set(id, { id, pty: ptyProcess, cwd });
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.write(data);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.resize(cols, rows);
    }
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.kill();
      this.sessions.delete(id);
    }
  }

  getSession(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }
}

export const ptyManager = new PtyManager();
```

**Step 4: Update preload with IPC**

Update `src/main/preload.ts`:
```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // PTY operations
  createSession: (id: string, cwd: string) =>
    ipcRenderer.invoke('pty:create', id, cwd),
  writeToSession: (id: string, data: string) =>
    ipcRenderer.send('pty:write', id, data),
  resizeSession: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('pty:resize', id, cols, rows),
  killSession: (id: string) =>
    ipcRenderer.send('pty:kill', id),

  // PTY events
  onPtyData: (callback: (id: string, data: string) => void) => {
    ipcRenderer.on('pty:data', (_, id, data) => callback(id, data));
  },
  onPtyExit: (callback: (id: string, exitCode: number) => void) => {
    ipcRenderer.on('pty:exit', (_, id, exitCode) => callback(id, exitCode));
  },
});
```

**Step 5: Add type declarations for window.electronAPI**

Create `src/renderer/types/electron.d.ts`:
```typescript
export interface ElectronAPI {
  platform: string;
  createSession: (id: string, cwd: string) => Promise<void>;
  writeToSession: (id: string, data: string) => void;
  resizeSession: (id: string, cols: number, rows: number) => void;
  killSession: (id: string) => void;
  onPtyData: (callback: (id: string, data: string) => void) => void;
  onPtyExit: (callback: (id: string, exitCode: number) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
```

**Step 6: Update main process with IPC handlers**

Update `src/main/index.ts`:
```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { ptyManager } from './pty-manager';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // PTY data forwarding
  ptyManager.on('data', ({ id, data }) => {
    mainWindow?.webContents.send('pty:data', id, data);
  });

  ptyManager.on('exit', ({ id, exitCode }) => {
    mainWindow?.webContents.send('pty:exit', id, exitCode);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('pty:create', async (_, id: string, cwd: string) => {
  ptyManager.createSession(id, cwd);
});

ipcMain.on('pty:write', (_, id: string, data: string) => {
  ptyManager.write(id, data);
});

ipcMain.on('pty:resize', (_, id: string, cols: number, rows: number) => {
  ptyManager.resize(id, cols, rows);
});

ipcMain.on('pty:kill', (_, id: string) => {
  ptyManager.kill(id);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
```

**Step 7: Update Terminal component to use PTY**

Update `src/renderer/components/Terminal.tsx`:
```tsx
import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import '../styles/terminal.css';

interface TerminalProps {
  sessionId: string;
  cwd: string;
}

const Terminal: React.FC<TerminalProps> = ({ sessionId, cwd }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
      },
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Create PTY session
    window.electronAPI.createSession(sessionId, cwd);

    // Handle PTY data
    window.electronAPI.onPtyData((id, data) => {
      if (id === sessionId) {
        term.write(data);
      }
    });

    // Handle user input
    term.onData((data) => {
      window.electronAPI.writeToSession(sessionId, data);
    });

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
      const { cols, rows } = term;
      window.electronAPI.resizeSession(sessionId, cols, rows);
    };

    window.addEventListener('resize', handleResize);

    // Initial resize
    setTimeout(() => {
      fitAddon.fit();
      const { cols, rows } = term;
      window.electronAPI.resizeSession(sessionId, cols, rows);
    }, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.electronAPI.killSession(sessionId);
      term.dispose();
    };
  }, [sessionId, cwd]);

  return <div ref={terminalRef} className="terminal-container" />;
};

export default Terminal;
```

**Step 8: Update App to pass cwd**

Update `src/renderer/App.tsx`:
```tsx
import React from 'react';
import Terminal from './components/Terminal';
import './styles/global.css';

const App: React.FC = () => {
  // Use home directory as default
  const homedir = process.env.HOME || process.env.USERPROFILE || '/';

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
```

**Step 9: Build and verify**

```bash
npm run dev
```
Expected: Terminal opens with actual shell, can type commands, output displays

**Step 10: Commit**

```bash
git add -A
git commit -m "feat: integrate node-pty for real terminal sessions"
```

---

## Phase 3: Session Management

### Task 3.1: Session State Management

**Files:**
- Create: `src/renderer/store/sessions.ts`
- Create: `src/renderer/store/groups.ts`
- Create: `src/shared/types.ts`
- Modify: `src/renderer/App.tsx`

**Step 1: Create shared types**

Create `src/shared/types.ts`:
```typescript
export type SessionState = 'idle' | 'working' | 'waiting' | 'error';

export interface Session {
  id: string;
  groupId: string;
  name: string;
  workingDir: string;
  state: SessionState;
  shellType: string;
  order: number;
  createdAt: Date;
  lastActivityAt: Date;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: Date;
}

export interface AppState {
  groups: Group[];
  sessions: Session[];
  activeSessionId: string | null;
}
```

**Step 2: Install uuid for ID generation**

```bash
npm install uuid
npm install -D @types/uuid
```

**Step 3: Create session store**

Create `src/renderer/store/sessions.ts`:
```typescript
import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Session, SessionState } from '../../shared/types';

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const createSession = useCallback((groupId: string, name: string, workingDir: string): Session => {
    const session: Session = {
      id: uuidv4(),
      groupId,
      name,
      workingDir,
      state: 'idle',
      shellType: 'bash',
      order: sessions.filter(s => s.groupId === groupId).length,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    setSessions(prev => [...prev, session]);
    setActiveSessionId(session.id);
    return session;
  }, [sessions]);

  const updateSessionState = useCallback((id: string, state: SessionState) => {
    setSessions(prev => prev.map(s =>
      s.id === id
        ? { ...s, state, lastActivityAt: new Date() }
        : s
    ));
  }, []);

  const removeSession = useCallback((id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
    }
  }, [activeSessionId]);

  const getSessionsByGroup = useCallback((groupId: string) => {
    return sessions.filter(s => s.groupId === groupId);
  }, [sessions]);

  const getStateCounts = useCallback(() => {
    return {
      waiting: sessions.filter(s => s.state === 'waiting').length,
      working: sessions.filter(s => s.state === 'working').length,
      idle: sessions.filter(s => s.state === 'idle').length,
      error: sessions.filter(s => s.state === 'error').length,
    };
  }, [sessions]);

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createSession,
    updateSessionState,
    removeSession,
    getSessionsByGroup,
    getStateCounts,
  };
}
```

**Step 4: Create groups store**

Create `src/renderer/store/groups.ts`:
```typescript
import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Group } from '../../shared/types';

const DEFAULT_COLORS = ['#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2'];

export function useGroups() {
  const [groups, setGroups] = useState<Group[]>([
    {
      id: 'default',
      name: 'Default',
      color: DEFAULT_COLORS[0],
      order: 0,
      createdAt: new Date(),
    },
  ]);

  const createGroup = useCallback((name: string): Group => {
    const group: Group = {
      id: uuidv4(),
      name,
      color: DEFAULT_COLORS[groups.length % DEFAULT_COLORS.length],
      order: groups.length,
      createdAt: new Date(),
    };

    setGroups(prev => [...prev, group]);
    return group;
  }, [groups]);

  const updateGroup = useCallback((id: string, updates: Partial<Group>) => {
    setGroups(prev => prev.map(g =>
      g.id === id ? { ...g, ...updates } : g
    ));
  }, []);

  const removeGroup = useCallback((id: string) => {
    setGroups(prev => prev.filter(g => g.id !== id));
  }, []);

  return {
    groups,
    createGroup,
    updateGroup,
    removeGroup,
  };
}
```

**Step 5: Update App with state management**

Update `src/renderer/App.tsx`:
```tsx
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

  const homedir = process.env.HOME || process.env.USERPROFILE || '/';
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
```

**Step 6: Update styles for new components**

Append to `src/renderer/styles/global.css`:
```css
/* Sidebar */
.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.icon-button {
  background: none;
  border: 1px solid #555;
  color: #888;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-button:hover {
  background: #3c3c3c;
  color: #fff;
}

.icon-button.small {
  width: 18px;
  height: 18px;
  font-size: 12px;
}

/* Groups */
.group {
  margin-bottom: 16px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}

.group-color {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.group-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
}

.group-sessions {
  margin-left: 16px;
}

/* Sessions */
.session {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.session:hover {
  background: #37373d;
}

.session.active {
  background: #094771;
}

.state-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #888;
}

.state-indicator.waiting { background: #e5c07b; }
.state-indicator.working { background: #61afef; }
.state-indicator.idle { background: #5a5a5a; }
.state-indicator.error { background: #e06c75; }

/* Tabs */
.tab {
  position: relative;
  padding: 6px 32px 6px 16px;
}

.tab-close {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 16px;
  padding: 0 4px;
}

.tab-close:hover {
  color: #fff;
}

.new-tab {
  background: transparent;
  border: none;
  color: #888;
  font-size: 18px;
  cursor: pointer;
  padding: 6px 12px;
}

.new-tab:hover {
  color: #fff;
}

/* No session */
.no-session {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: #888;
}

.no-session button {
  padding: 8px 16px;
  background: #007acc;
  border: none;
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
}

/* Status bar */
.status-item {
  margin-right: 16px;
}

.status-item.waiting { color: #e5c07b; }
.status-item.working { color: #61afef; }
.status-item.idle { opacity: 0.7; }
.status-item.error { color: #e06c75; }
```

**Step 7: Build and verify**

```bash
npm run dev
```
Expected: Can create groups, create sessions, switch between tabs, close sessions

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add session and group state management"
```

---

## Phase 4: SQLite Persistence

### Task 4.1: Set Up SQLite

**Files:**
- Modify: `package.json`
- Create: `src/main/database.ts`
- Create: `src/main/repositories/groups.ts`
- Create: `src/main/repositories/sessions.ts`

**Step 1: Install better-sqlite3**

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
npm run postinstall
```

**Step 2: Create database manager**

Create `src/main/database.ts`:
```typescript
import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'claudelander.db');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  initializeTables(db);

  return db;
}

function initializeTables(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#888888',
      "order" INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      working_dir TEXT NOT NULL,
      state TEXT DEFAULT 'idle',
      shell_type TEXT DEFAULT 'bash',
      "order" INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // Insert default group if none exists
  const groupCount = database.prepare('SELECT COUNT(*) as count FROM groups').get() as { count: number };
  if (groupCount.count === 0) {
    database.prepare(`
      INSERT INTO groups (id, name, color, "order")
      VALUES ('default', 'Default', '#e06c75', 0)
    `).run();
  }
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

**Step 3: Create groups repository**

Create `src/main/repositories/groups.ts`:
```typescript
import { getDatabase } from '../database';
import { Group } from '../../shared/types';

export function getAllGroups(): Group[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM groups ORDER BY "order"').all() as any[];

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    color: row.color,
    order: row.order,
    createdAt: new Date(row.created_at),
  }));
}

export function createGroup(group: Group): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO groups (id, name, color, "order", created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    group.id,
    group.name,
    group.color,
    group.order,
    group.createdAt.toISOString()
  );
}

export function updateGroup(id: string, updates: Partial<Group>): void {
  const db = getDatabase();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.color !== undefined) {
    fields.push('color = ?');
    values.push(updates.color);
  }
  if (updates.order !== undefined) {
    fields.push('"order" = ?');
    values.push(updates.order);
  }

  if (fields.length > 0) {
    values.push(id);
    db.prepare(`UPDATE groups SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
}

export function deleteGroup(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM groups WHERE id = ?').run(id);
}
```

**Step 4: Create sessions repository**

Create `src/main/repositories/sessions.ts`:
```typescript
import { getDatabase } from '../database';
import { Session, SessionState } from '../../shared/types';

export function getAllSessions(): Session[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM sessions ORDER BY "order"').all() as any[];

  return rows.map(row => ({
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    workingDir: row.working_dir,
    state: row.state as SessionState,
    shellType: row.shell_type,
    order: row.order,
    createdAt: new Date(row.created_at),
    lastActivityAt: new Date(row.last_activity_at),
  }));
}

export function createSession(session: Session): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO sessions (id, group_id, name, working_dir, state, shell_type, "order", created_at, last_activity_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.groupId,
    session.name,
    session.workingDir,
    session.state,
    session.shellType,
    session.order,
    session.createdAt.toISOString(),
    session.lastActivityAt.toISOString()
  );
}

export function updateSession(id: string, updates: Partial<Session>): void {
  const db = getDatabase();
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.groupId !== undefined) {
    fields.push('group_id = ?');
    values.push(updates.groupId);
  }
  if (updates.state !== undefined) {
    fields.push('state = ?');
    values.push(updates.state);
  }
  if (updates.order !== undefined) {
    fields.push('"order" = ?');
    values.push(updates.order);
  }
  if (updates.lastActivityAt !== undefined) {
    fields.push('last_activity_at = ?');
    values.push(updates.lastActivityAt.toISOString());
  }

  if (fields.length > 0) {
    values.push(id);
    db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }
}

export function deleteSession(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}
```

**Step 5: Add IPC handlers for persistence**

Update `src/main/index.ts` to add persistence handlers:
```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { ptyManager } from './pty-manager';
import { getDatabase, closeDatabase } from './database';
import * as groupsRepo from './repositories/groups';
import * as sessionsRepo from './repositories/sessions';
import { Group, Session } from '../shared/types';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // Initialize database
  getDatabase();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  ptyManager.on('data', ({ id, data }) => {
    mainWindow?.webContents.send('pty:data', id, data);
  });

  ptyManager.on('exit', ({ id, exitCode }) => {
    mainWindow?.webContents.send('pty:exit', id, exitCode);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// PTY IPC Handlers
ipcMain.handle('pty:create', async (_, id: string, cwd: string) => {
  ptyManager.createSession(id, cwd);
});

ipcMain.on('pty:write', (_, id: string, data: string) => {
  ptyManager.write(id, data);
});

ipcMain.on('pty:resize', (_, id: string, cols: number, rows: number) => {
  ptyManager.resize(id, cols, rows);
});

ipcMain.on('pty:kill', (_, id: string) => {
  ptyManager.kill(id);
});

// Database IPC Handlers - Groups
ipcMain.handle('db:groups:getAll', async () => {
  return groupsRepo.getAllGroups();
});

ipcMain.handle('db:groups:create', async (_, group: Group) => {
  groupsRepo.createGroup(group);
});

ipcMain.handle('db:groups:update', async (_, id: string, updates: Partial<Group>) => {
  groupsRepo.updateGroup(id, updates);
});

ipcMain.handle('db:groups:delete', async (_, id: string) => {
  groupsRepo.deleteGroup(id);
});

// Database IPC Handlers - Sessions
ipcMain.handle('db:sessions:getAll', async () => {
  return sessionsRepo.getAllSessions();
});

ipcMain.handle('db:sessions:create', async (_, session: Session) => {
  sessionsRepo.createSession(session);
});

ipcMain.handle('db:sessions:update', async (_, id: string, updates: Partial<Session>) => {
  sessionsRepo.updateSession(id, updates);
});

ipcMain.handle('db:sessions:delete', async (_, id: string) => {
  sessionsRepo.deleteSession(id);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  closeDatabase();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
```

**Step 6: Update preload with database IPC**

Update `src/main/preload.ts`:
```typescript
import { contextBridge, ipcRenderer } from 'electron';
import { Group, Session } from '../shared/types';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // PTY operations
  createSession: (id: string, cwd: string) =>
    ipcRenderer.invoke('pty:create', id, cwd),
  writeToSession: (id: string, data: string) =>
    ipcRenderer.send('pty:write', id, data),
  resizeSession: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('pty:resize', id, cols, rows),
  killSession: (id: string) =>
    ipcRenderer.send('pty:kill', id),

  // PTY events
  onPtyData: (callback: (id: string, data: string) => void) => {
    ipcRenderer.on('pty:data', (_, id, data) => callback(id, data));
  },
  onPtyExit: (callback: (id: string, exitCode: number) => void) => {
    ipcRenderer.on('pty:exit', (_, id, exitCode) => callback(id, exitCode));
  },

  // Database - Groups
  getAllGroups: (): Promise<Group[]> =>
    ipcRenderer.invoke('db:groups:getAll'),
  createGroup: (group: Group): Promise<void> =>
    ipcRenderer.invoke('db:groups:create', group),
  updateGroup: (id: string, updates: Partial<Group>): Promise<void> =>
    ipcRenderer.invoke('db:groups:update', id, updates),
  deleteGroup: (id: string): Promise<void> =>
    ipcRenderer.invoke('db:groups:delete', id),

  // Database - Sessions
  getAllSessions: (): Promise<Session[]> =>
    ipcRenderer.invoke('db:sessions:getAll'),
  createDbSession: (session: Session): Promise<void> =>
    ipcRenderer.invoke('db:sessions:create', session),
  updateDbSession: (id: string, updates: Partial<Session>): Promise<void> =>
    ipcRenderer.invoke('db:sessions:update', id, updates),
  deleteDbSession: (id: string): Promise<void> =>
    ipcRenderer.invoke('db:sessions:delete', id),
});
```

**Step 7: Update type declarations**

Update `src/renderer/types/electron.d.ts`:
```typescript
import { Group, Session } from '../../shared/types';

export interface ElectronAPI {
  platform: string;

  // PTY
  createSession: (id: string, cwd: string) => Promise<void>;
  writeToSession: (id: string, data: string) => void;
  resizeSession: (id: string, cols: number, rows: number) => void;
  killSession: (id: string) => void;
  onPtyData: (callback: (id: string, data: string) => void) => void;
  onPtyExit: (callback: (id: string, exitCode: number) => void) => void;

  // Database - Groups
  getAllGroups: () => Promise<Group[]>;
  createGroup: (group: Group) => Promise<void>;
  updateGroup: (id: string, updates: Partial<Group>) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;

  // Database - Sessions
  getAllSessions: () => Promise<Session[]>;
  createDbSession: (session: Session) => Promise<void>;
  updateDbSession: (id: string, updates: Partial<Session>) => Promise<void>;
  deleteDbSession: (id: string) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
```

**Step 8: Build and verify**

```bash
npm run dev
```
Expected: App launches, database created in user data directory

**Step 9: Commit**

```bash
git add -A
git commit -m "feat: add SQLite persistence layer"
```

---

### Task 4.2: Connect UI to Persistence

**Files:**
- Modify: `src/renderer/store/sessions.ts`
- Modify: `src/renderer/store/groups.ts`
- Modify: `src/renderer/App.tsx`

**Step 1: Update groups store with persistence**

Update `src/renderer/store/groups.ts`:
```typescript
import { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Group } from '../../shared/types';

const DEFAULT_COLORS = ['#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2'];

export function useGroups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  // Load groups from database on mount
  useEffect(() => {
    window.electronAPI.getAllGroups().then((dbGroups) => {
      setGroups(dbGroups);
      setLoading(false);
    });
  }, []);

  const createGroup = useCallback(async (name: string): Promise<Group> => {
    const group: Group = {
      id: uuidv4(),
      name,
      color: DEFAULT_COLORS[groups.length % DEFAULT_COLORS.length],
      order: groups.length,
      createdAt: new Date(),
    };

    await window.electronAPI.createGroup(group);
    setGroups(prev => [...prev, group]);
    return group;
  }, [groups]);

  const updateGroup = useCallback(async (id: string, updates: Partial<Group>) => {
    await window.electronAPI.updateGroup(id, updates);
    setGroups(prev => prev.map(g =>
      g.id === id ? { ...g, ...updates } : g
    ));
  }, []);

  const removeGroup = useCallback(async (id: string) => {
    await window.electronAPI.deleteGroup(id);
    setGroups(prev => prev.filter(g => g.id !== id));
  }, []);

  return {
    groups,
    loading,
    createGroup,
    updateGroup,
    removeGroup,
  };
}
```

**Step 2: Update sessions store with persistence**

Update `src/renderer/store/sessions.ts`:
```typescript
import { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Session, SessionState } from '../../shared/types';

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load sessions from database on mount
  useEffect(() => {
    window.electronAPI.getAllSessions().then((dbSessions) => {
      setSessions(dbSessions);
      setLoading(false);
    });
  }, []);

  const createSession = useCallback(async (groupId: string, name: string, workingDir: string): Promise<Session> => {
    const session: Session = {
      id: uuidv4(),
      groupId,
      name,
      workingDir,
      state: 'idle',
      shellType: 'bash',
      order: sessions.filter(s => s.groupId === groupId).length,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    await window.electronAPI.createDbSession(session);
    setSessions(prev => [...prev, session]);
    setActiveSessionId(session.id);
    return session;
  }, [sessions]);

  const updateSessionState = useCallback(async (id: string, state: SessionState) => {
    const updates = { state, lastActivityAt: new Date() };
    await window.electronAPI.updateDbSession(id, updates);
    setSessions(prev => prev.map(s =>
      s.id === id ? { ...s, ...updates } : s
    ));
  }, []);

  const removeSession = useCallback(async (id: string) => {
    await window.electronAPI.deleteDbSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
    }
  }, [activeSessionId]);

  const getSessionsByGroup = useCallback((groupId: string) => {
    return sessions.filter(s => s.groupId === groupId);
  }, [sessions]);

  const getStateCounts = useCallback(() => {
    return {
      waiting: sessions.filter(s => s.state === 'waiting').length,
      working: sessions.filter(s => s.state === 'working').length,
      idle: sessions.filter(s => s.state === 'idle').length,
      error: sessions.filter(s => s.state === 'error').length,
    };
  }, [sessions]);

  return {
    sessions,
    loading,
    activeSessionId,
    setActiveSessionId,
    createSession,
    updateSessionState,
    removeSession,
    getSessionsByGroup,
    getStateCounts,
  };
}
```

**Step 3: Update App with loading state**

Update the relevant parts of `src/renderer/App.tsx`:
```tsx
import React from 'react';
import Terminal from './components/Terminal';
import { useSessions } from './store/sessions';
import { useGroups } from './store/groups';
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

  const homedir = process.env.HOME || process.env.USERPROFILE || '/';
  const counts = getStateCounts();
  const activeSession = sessions.find(s => s.id === activeSessionId);

  const handleNewSession = async (groupId: string) => {
    const count = getSessionsByGroup(groupId).length + 1;
    await createSession(groupId, `Session ${count}`, homedir);
  };

  if (groupsLoading || sessionsLoading) {
    return (
      <div className="app loading">
        <div className="loading-message">Loading...</div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Rest of the component remains the same */}
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
```

**Step 4: Add loading styles**

Append to `src/renderer/styles/global.css`:
```css
.app.loading {
  display: flex;
  align-items: center;
  justify-content: center;
}

.loading-message {
  color: #888;
  font-size: 16px;
}
```

**Step 5: Build and verify**

```bash
npm run dev
```
Expected: Create sessions/groups, close app, reopen - data persists

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: connect UI to SQLite persistence"
```

---

## Phase 5: Hook-Based State Detection

### Task 5.1: Create Claude Launcher Wrapper

**Files:**
- Create: `src/main/claude-launcher.ts`
- Create: `scripts/claudelander-hook.sh`
- Modify: `src/main/pty-manager.ts`

**Step 1: Create hook script**

Create `scripts/claudelander-hook.sh`:
```bash
#!/bin/bash
# Claudelander hook script - reports Claude state to main process

SESSION_ID="${CLAUDELANDER_SESSION_ID}"
SOCKET_PATH="${CLAUDELANDER_SOCKET}"

report_state() {
    local state="$1"
    local event="$2"
    if [ -n "$SOCKET_PATH" ] && [ -S "$SOCKET_PATH" ]; then
        echo "{\"sessionId\":\"$SESSION_ID\",\"state\":\"$state\",\"event\":\"$event\",\"timestamp\":$(date +%s)}" | nc -U "$SOCKET_PATH" 2>/dev/null
    fi
}

# Hook handlers based on Claude Code hook events
case "$CLAUDE_HOOK_EVENT" in
    "pre_tool_use")
        report_state "waiting" "tool_approval"
        ;;
    "post_tool_use")
        report_state "working" "tool_complete"
        ;;
    "notification")
        # Check notification type
        if echo "$CLAUDE_NOTIFICATION" | grep -qi "waiting\|input\|approve"; then
            report_state "waiting" "notification"
        fi
        ;;
esac
```

**Step 2: Create Claude launcher module**

Create `src/main/claude-launcher.ts`:
```typescript
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { app } from 'electron';

export interface ClaudeLaunchConfig {
  sessionId: string;
  projectDir: string;
  socketPath: string;
}

export function getClaudeCommand(config: ClaudeLaunchConfig): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const hookScriptPath = getHookScriptPath();

  // Ensure hook script exists and is executable
  ensureHookScript(hookScriptPath);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDELANDER_SESSION_ID: config.sessionId,
    CLAUDELANDER_SOCKET: config.socketPath,
    // Point Claude to use our hook
    CLAUDE_HOOKS_DIR: path.dirname(hookScriptPath),
  };

  return {
    command: 'claude',
    args: [],
    env,
  };
}

function getHookScriptPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'hooks', 'claudelander-hook.sh');
}

function ensureHookScript(hookPath: string): void {
  const hookDir = path.dirname(hookPath);

  if (!fs.existsSync(hookDir)) {
    fs.mkdirSync(hookDir, { recursive: true });
  }

  // Copy hook script from resources or create it
  const hookContent = `#!/bin/bash
# Claudelander hook script - reports Claude state to main process

SESSION_ID="\${CLAUDELANDER_SESSION_ID}"
SOCKET_PATH="\${CLAUDELANDER_SOCKET}"

report_state() {
    local state="$1"
    local event="$2"
    if [ -n "$SOCKET_PATH" ] && [ -S "$SOCKET_PATH" ]; then
        echo "{\\"sessionId\\":\\"$SESSION_ID\\",\\"state\\":\\"$state\\",\\"event\\":\\"$event\\",\\"timestamp\\":$(date +%s)}" | nc -U "$SOCKET_PATH" 2>/dev/null || true
    fi
}

# Hook handlers based on Claude Code hook events
case "$1" in
    "PreToolUse")
        report_state "waiting" "tool_approval"
        ;;
    "PostToolUse")
        report_state "working" "tool_complete"
        ;;
    "Notification")
        report_state "working" "notification"
        ;;
    "Stop")
        report_state "idle" "stopped"
        ;;
esac

# Always exit 0 to not block Claude
exit 0
`;

  fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
}

export function getSocketPath(): string {
  const tmpDir = os.tmpdir();
  return path.join(tmpDir, `claudelander-${process.pid}.sock`);
}
```

**Step 3: Update PTY manager to support Claude launching**

Update `src/main/pty-manager.ts`:
```typescript
import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { getClaudeCommand, getSocketPath } from './claude-launcher';

interface PtySession {
  id: string;
  pty: pty.IPty;
  cwd: string;
  isClaudeSession: boolean;
}

class PtyManager extends EventEmitter {
  private sessions: Map<string, PtySession> = new Map();
  private socketPath: string;

  constructor() {
    super();
    this.socketPath = getSocketPath();
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  createSession(id: string, cwd: string, launchClaude: boolean = false): void {
    let shell: string;
    let args: string[] = [];
    let env = process.env as { [key: string]: string };

    if (launchClaude) {
      const claudeConfig = getClaudeCommand({
        sessionId: id,
        projectDir: cwd,
        socketPath: this.socketPath,
      });
      shell = claudeConfig.command;
      args = claudeConfig.args;
      env = claudeConfig.env as { [key: string]: string };
    } else {
      shell = this.getDefaultShell();
    }

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd,
      env: env,
    });

    ptyProcess.onData((data) => {
      this.emit('data', { id, data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', { id, exitCode });
      this.sessions.delete(id);
    });

    this.sessions.set(id, { id, pty: ptyProcess, cwd, isClaudeSession: launchClaude });
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.write(data);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.resize(cols, rows);
    }
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.kill();
      this.sessions.delete(id);
    }
  }

  getSession(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }
}

export const ptyManager = new PtyManager();
```

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add Claude launcher wrapper with hook configuration"
```

---

### Task 5.2: State Monitor IPC

**Files:**
- Create: `src/main/state-monitor.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/App.tsx`

**Step 1: Create state monitor**

Create `src/main/state-monitor.ts`:
```typescript
import * as net from 'net';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { SessionState } from '../shared/types';

interface StateEvent {
  sessionId: string;
  state: SessionState;
  event: string;
  timestamp: number;
}

class StateMonitor extends EventEmitter {
  private server: net.Server | null = null;
  private socketPath: string;

  constructor(socketPath: string) {
    super();
    this.socketPath = socketPath;
  }

  start(): void {
    // Clean up old socket if it exists
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }

    this.server = net.createServer((socket) => {
      socket.on('data', (data) => {
        try {
          const event: StateEvent = JSON.parse(data.toString().trim());
          this.emit('stateChange', event);
        } catch (e) {
          console.error('Failed to parse state event:', e);
        }
      });
    });

    this.server.listen(this.socketPath);
    console.log('State monitor listening on:', this.socketPath);
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }
  }
}

export { StateMonitor, StateEvent };
```

**Step 2: Update main process to use state monitor**

Update `src/main/index.ts`:
```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { ptyManager } from './pty-manager';
import { StateMonitor } from './state-monitor';
import { getDatabase, closeDatabase } from './database';
import * as groupsRepo from './repositories/groups';
import * as sessionsRepo from './repositories/sessions';
import { Group, Session } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let stateMonitor: StateMonitor | null = null;

function createWindow(): void {
  getDatabase();

  // Start state monitor
  stateMonitor = new StateMonitor(ptyManager.getSocketPath());
  stateMonitor.start();

  stateMonitor.on('stateChange', (event) => {
    mainWindow?.webContents.send('state:change', event);
    // Also update database
    sessionsRepo.updateSession(event.sessionId, {
      state: event.state,
      lastActivityAt: new Date(),
    });
  });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  ptyManager.on('data', ({ id, data }) => {
    mainWindow?.webContents.send('pty:data', id, data);
  });

  ptyManager.on('exit', ({ id, exitCode }) => {
    mainWindow?.webContents.send('pty:exit', id, exitCode);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// PTY IPC Handlers
ipcMain.handle('pty:create', async (_, id: string, cwd: string, launchClaude: boolean = false) => {
  ptyManager.createSession(id, cwd, launchClaude);
});

ipcMain.on('pty:write', (_, id: string, data: string) => {
  ptyManager.write(id, data);
});

ipcMain.on('pty:resize', (_, id: string, cols: number, rows: number) => {
  ptyManager.resize(id, cols, rows);
});

ipcMain.on('pty:kill', (_, id: string) => {
  ptyManager.kill(id);
});

// Database IPC Handlers - Groups
ipcMain.handle('db:groups:getAll', async () => {
  return groupsRepo.getAllGroups();
});

ipcMain.handle('db:groups:create', async (_, group: Group) => {
  groupsRepo.createGroup(group);
});

ipcMain.handle('db:groups:update', async (_, id: string, updates: Partial<Group>) => {
  groupsRepo.updateGroup(id, updates);
});

ipcMain.handle('db:groups:delete', async (_, id: string) => {
  groupsRepo.deleteGroup(id);
});

// Database IPC Handlers - Sessions
ipcMain.handle('db:sessions:getAll', async () => {
  return sessionsRepo.getAllSessions();
});

ipcMain.handle('db:sessions:create', async (_, session: Session) => {
  sessionsRepo.createSession(session);
});

ipcMain.handle('db:sessions:update', async (_, id: string, updates: Partial<Session>) => {
  sessionsRepo.updateSession(id, updates);
});

ipcMain.handle('db:sessions:delete', async (_, id: string) => {
  sessionsRepo.deleteSession(id);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stateMonitor?.stop();
  closeDatabase();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
```

**Step 3: Update preload with state change listener**

Add to `src/main/preload.ts`:
```typescript
import { contextBridge, ipcRenderer } from 'electron';
import { Group, Session, SessionState } from '../shared/types';

interface StateChangeEvent {
  sessionId: string;
  state: SessionState;
  event: string;
  timestamp: number;
}

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,

  // PTY operations
  createSession: (id: string, cwd: string, launchClaude: boolean = false) =>
    ipcRenderer.invoke('pty:create', id, cwd, launchClaude),
  writeToSession: (id: string, data: string) =>
    ipcRenderer.send('pty:write', id, data),
  resizeSession: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('pty:resize', id, cols, rows),
  killSession: (id: string) =>
    ipcRenderer.send('pty:kill', id),

  // PTY events
  onPtyData: (callback: (id: string, data: string) => void) => {
    ipcRenderer.on('pty:data', (_, id, data) => callback(id, data));
  },
  onPtyExit: (callback: (id: string, exitCode: number) => void) => {
    ipcRenderer.on('pty:exit', (_, id, exitCode) => callback(id, exitCode));
  },

  // State change events
  onStateChange: (callback: (event: StateChangeEvent) => void) => {
    ipcRenderer.on('state:change', (_, event) => callback(event));
  },

  // Database - Groups
  getAllGroups: (): Promise<Group[]> =>
    ipcRenderer.invoke('db:groups:getAll'),
  createGroup: (group: Group): Promise<void> =>
    ipcRenderer.invoke('db:groups:create', group),
  updateGroup: (id: string, updates: Partial<Group>): Promise<void> =>
    ipcRenderer.invoke('db:groups:update', id, updates),
  deleteGroup: (id: string): Promise<void> =>
    ipcRenderer.invoke('db:groups:delete', id),

  // Database - Sessions
  getAllSessions: (): Promise<Session[]> =>
    ipcRenderer.invoke('db:sessions:getAll'),
  createDbSession: (session: Session): Promise<void> =>
    ipcRenderer.invoke('db:sessions:create', session),
  updateDbSession: (id: string, updates: Partial<Session>): Promise<void> =>
    ipcRenderer.invoke('db:sessions:update', id, updates),
  deleteDbSession: (id: string): Promise<void> =>
    ipcRenderer.invoke('db:sessions:delete', id),
});
```

**Step 4: Update sessions store to listen for state changes**

Update `src/renderer/store/sessions.ts`:
```typescript
import { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Session, SessionState } from '../../shared/types';

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load sessions from database on mount
  useEffect(() => {
    window.electronAPI.getAllSessions().then((dbSessions) => {
      setSessions(dbSessions);
      setLoading(false);
    });

    // Listen for state changes from hooks
    window.electronAPI.onStateChange((event) => {
      setSessions(prev => prev.map(s =>
        s.id === event.sessionId
          ? { ...s, state: event.state, lastActivityAt: new Date(event.timestamp * 1000) }
          : s
      ));
    });
  }, []);

  const createSession = useCallback(async (
    groupId: string,
    name: string,
    workingDir: string,
    launchClaude: boolean = true
  ): Promise<Session> => {
    const session: Session = {
      id: uuidv4(),
      groupId,
      name,
      workingDir,
      state: 'idle',
      shellType: launchClaude ? 'claude' : 'bash',
      order: sessions.filter(s => s.groupId === groupId).length,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    await window.electronAPI.createDbSession(session);
    setSessions(prev => [...prev, session]);
    setActiveSessionId(session.id);
    return session;
  }, [sessions]);

  const updateSessionState = useCallback(async (id: string, state: SessionState) => {
    const updates = { state, lastActivityAt: new Date() };
    await window.electronAPI.updateDbSession(id, updates);
    setSessions(prev => prev.map(s =>
      s.id === id ? { ...s, ...updates } : s
    ));
  }, []);

  const removeSession = useCallback(async (id: string) => {
    await window.electronAPI.deleteDbSession(id);
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
    }
  }, [activeSessionId]);

  const getSessionsByGroup = useCallback((groupId: string) => {
    return sessions.filter(s => s.groupId === groupId);
  }, [sessions]);

  const getStateCounts = useCallback(() => {
    return {
      waiting: sessions.filter(s => s.state === 'waiting').length,
      working: sessions.filter(s => s.state === 'working').length,
      idle: sessions.filter(s => s.state === 'idle').length,
      error: sessions.filter(s => s.state === 'error').length,
    };
  }, [sessions]);

  return {
    sessions,
    loading,
    activeSessionId,
    setActiveSessionId,
    createSession,
    updateSessionState,
    removeSession,
    getSessionsByGroup,
    getStateCounts,
  };
}
```

**Step 5: Update Terminal component to support Claude launch**

Update `src/renderer/components/Terminal.tsx`:
```tsx
import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import '../styles/terminal.css';

interface TerminalProps {
  sessionId: string;
  cwd: string;
  launchClaude?: boolean;
}

const Terminal: React.FC<TerminalProps> = ({ sessionId, cwd, launchClaude = true }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
      },
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Create PTY session with Claude launch option
    window.electronAPI.createSession(sessionId, cwd, launchClaude);

    window.electronAPI.onPtyData((id, data) => {
      if (id === sessionId) {
        term.write(data);
      }
    });

    term.onData((data) => {
      window.electronAPI.writeToSession(sessionId, data);
    });

    const handleResize = () => {
      fitAddon.fit();
      const { cols, rows } = term;
      window.electronAPI.resizeSession(sessionId, cols, rows);
    };

    window.addEventListener('resize', handleResize);

    setTimeout(() => {
      fitAddon.fit();
      const { cols, rows } = term;
      window.electronAPI.resizeSession(sessionId, cols, rows);
    }, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.electronAPI.killSession(sessionId);
      term.dispose();
    };
  }, [sessionId, cwd, launchClaude]);

  return <div ref={terminalRef} className="terminal-container" />;
};

export default Terminal;
```

**Step 6: Update App to pass launchClaude**

Update the Terminal usage in `src/renderer/App.tsx`:
```tsx
{activeSession ? (
  <Terminal
    key={activeSession.id}
    sessionId={activeSession.id}
    cwd={activeSession.workingDir}
    launchClaude={activeSession.shellType === 'claude'}
  />
) : (
  // ...
)}
```

**Step 7: Build and verify**

```bash
npm run dev
```
Expected: Sessions launch with Claude, state changes reflect in UI

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: add state monitor for hook-based state detection"
```

---

## Phase 6: Final Polish

### Task 6.1: Keyboard Shortcuts

**Files:**
- Create: `src/renderer/hooks/useKeyboardShortcuts.ts`
- Modify: `src/renderer/App.tsx`

**Step 1: Create keyboard shortcuts hook**

Create `src/renderer/hooks/useKeyboardShortcuts.ts`:
```typescript
import { useEffect, useCallback } from 'react';

interface ShortcutHandlers {
  onNewSession: () => void;
  onNextSession: () => void;
  onPrevSession: () => void;
  onNextWaiting: () => void;
  onCloseSession: () => void;
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isMod = e.ctrlKey || e.metaKey;

    if (isMod && e.key === 'n') {
      e.preventDefault();
      handlers.onNewSession();
    }

    if (isMod && e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        handlers.onPrevSession();
      } else {
        handlers.onNextSession();
      }
    }

    if (isMod && e.shiftKey && e.key === 'W') {
      e.preventDefault();
      handlers.onNextWaiting();
    }

    if (isMod && e.key === 'w') {
      e.preventDefault();
      handlers.onCloseSession();
    }
  }, [handlers]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
```

**Step 2: Integrate shortcuts into App**

Update `src/renderer/App.tsx` to add:
```tsx
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

// Inside App component, after hooks:
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

const handleCloseSession = useCallback(() => {
  if (activeSessionId) {
    removeSession(activeSessionId);
  }
}, [activeSessionId, removeSession]);

useKeyboardShortcuts({
  onNewSession: () => handleNewSession(groups[0]?.id || 'default'),
  onNextSession: handleNextSession,
  onPrevSession: handlePrevSession,
  onNextWaiting: handleNextWaiting,
  onCloseSession: handleCloseSession,
});
```

**Step 3: Build and verify**

```bash
npm run dev
```
Expected: Ctrl+N creates session, Ctrl+Tab cycles, Ctrl+Shift+W jumps to waiting

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add keyboard shortcuts for session navigation"
```

---

### Task 6.2: Cross-Platform Shell Detection

**Files:**
- Modify: `src/main/pty-manager.ts`
- Create: `src/main/shell-detector.ts`

**Step 1: Create shell detector**

Create `src/main/shell-detector.ts`:
```typescript
import { execSync } from 'child_process';
import * as fs from 'fs';

export interface ShellInfo {
  shell: string;
  args: string[];
  isWSL: boolean;
}

export function detectShell(): ShellInfo {
  if (process.platform === 'win32') {
    return detectWindowsShell();
  }
  return detectUnixShell();
}

function detectWindowsShell(): ShellInfo {
  // Check for WSL
  if (isWSLAvailable()) {
    return {
      shell: 'wsl.exe',
      args: ['-d', 'Ubuntu'],
      isWSL: true,
    };
  }

  // Fallback to PowerShell or CMD
  const powershell = process.env.COMSPEC?.includes('powershell')
    || fs.existsSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');

  if (powershell) {
    return {
      shell: 'powershell.exe',
      args: ['-NoLogo'],
      isWSL: false,
    };
  }

  return {
    shell: process.env.COMSPEC || 'cmd.exe',
    args: [],
    isWSL: false,
  };
}

function detectUnixShell(): ShellInfo {
  const shell = process.env.SHELL || '/bin/bash';
  return {
    shell,
    args: [],
    isWSL: false,
  };
}

function isWSLAvailable(): boolean {
  try {
    execSync('wsl.exe --list --quiet', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function getWSLDistros(): string[] {
  try {
    const output = execSync('wsl.exe --list --quiet', { encoding: 'utf-8' });
    return output.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
```

**Step 2: Update PTY manager to use shell detector**

Update `src/main/pty-manager.ts`:
```typescript
import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { getClaudeCommand, getSocketPath } from './claude-launcher';
import { detectShell, ShellInfo } from './shell-detector';

interface PtySession {
  id: string;
  pty: pty.IPty;
  cwd: string;
  isClaudeSession: boolean;
  shellInfo: ShellInfo;
}

class PtyManager extends EventEmitter {
  private sessions: Map<string, PtySession> = new Map();
  private socketPath: string;
  private defaultShellInfo: ShellInfo;

  constructor() {
    super();
    this.socketPath = getSocketPath();
    this.defaultShellInfo = detectShell();
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  getDefaultShellInfo(): ShellInfo {
    return this.defaultShellInfo;
  }

  createSession(id: string, cwd: string, launchClaude: boolean = false): void {
    let shell: string;
    let args: string[] = [];
    let env = process.env as { [key: string]: string };
    const shellInfo = this.defaultShellInfo;

    if (launchClaude) {
      const claudeConfig = getClaudeCommand({
        sessionId: id,
        projectDir: cwd,
        socketPath: this.socketPath,
      });

      if (shellInfo.isWSL) {
        // Launch Claude inside WSL
        shell = 'wsl.exe';
        args = [...shellInfo.args, '--', 'claude'];
        env = { ...env, ...claudeConfig.env };
      } else {
        shell = claudeConfig.command;
        args = claudeConfig.args;
        env = claudeConfig.env as { [key: string]: string };
      }
    } else {
      shell = shellInfo.shell;
      args = shellInfo.args;
    }

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: shellInfo.isWSL && !launchClaude ? undefined : cwd,
      env: env,
    });

    ptyProcess.onData((data) => {
      this.emit('data', { id, data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', { id, exitCode });
      this.sessions.delete(id);
    });

    this.sessions.set(id, { id, pty: ptyProcess, cwd, isClaudeSession: launchClaude, shellInfo });
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.write(data);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.resize(cols, rows);
    }
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.kill();
      this.sessions.delete(id);
    }
  }

  getSession(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }
}

export const ptyManager = new PtyManager();
```

**Step 3: Build and verify**

```bash
npm run dev
```
Expected: App detects platform, uses WSL on Windows if available

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add cross-platform shell detection with WSL support"
```

---

### Task 6.3: Build Configuration

**Files:**
- Modify: `package.json`
- Create: `electron-builder.yml`

**Step 1: Create electron-builder config**

Create `electron-builder.yml`:
```yaml
appId: com.claudelander.app
productName: Claudelander
directories:
  output: release

files:
  - dist/**/*
  - package.json

mac:
  category: public.app-category.developer-tools
  target:
    - dmg
    - zip

win:
  target:
    - nsis
    - portable

linux:
  category: Development
  target:
    - AppImage
    - deb

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

**Step 2: Update package.json with build scripts**

Add to `package.json`:
```json
{
  "scripts": {
    "build:main": "tsc -p tsconfig.main.json",
    "build:renderer": "webpack --mode production",
    "build": "npm run build:main && npm run build:renderer",
    "start": "npm run build && electron .",
    "dev": "npm run build && electron .",
    "pack": "npm run build && electron-builder --dir",
    "dist": "npm run build && electron-builder",
    "dist:mac": "npm run build && electron-builder --mac",
    "dist:win": "npm run build && electron-builder --win",
    "dist:linux": "npm run build && electron-builder --linux",
    "postinstall": "electron-rebuild"
  },
  "build": {
    "extends": "electron-builder.yml"
  }
}
```

**Step 3: Build and verify packaging works**

```bash
npm run pack
```
Expected: Creates unpacked app in `release/` directory

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add electron-builder configuration for distribution"
```

---

## Summary

This plan covers the complete MVP implementation:

1. **Phase 1:** Project scaffold with Electron + React + TypeScript
2. **Phase 2:** Terminal integration with xterm.js + node-pty
3. **Phase 3:** Session and group state management
4. **Phase 4:** SQLite persistence layer
5. **Phase 5:** Hook-based state detection
6. **Phase 6:** Keyboard shortcuts, cross-platform shell detection, build config

**Not included (Phase 2 & 3 features):**
- E2E encrypted session sharing
- Teams functionality
- Mobile companion app
- AI session summaries

**Next steps after MVP:**
- Manual testing on all platforms (Windows/WSL, macOS, Linux)
- User feedback collection
- Bug fixes and polish
- Begin Phase 2 design for sharing feature
