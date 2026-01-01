# Claudelander Design Document

**Date:** 2026-01-01
**Status:** Approved
**Author:** Collaborative design session

## Problem Statement

Managing multiple Claude Code sessions across terminals is exhausting. With 30+ projects, there's no way to tell at a glance:
- Which sessions are waiting for input
- Which are actively working
- What each session is even doing

Additionally, Claude's hook configuration is scattered across project directories, making consistent behavior tedious to maintain.

## Solution Overview

Claudelander is a cross-platform desktop application for managing multiple Claude Code sessions. It provides:

1. **Unified session management** - All Claude sessions in one app with clear status indicators
2. **Centralized hook configuration** - App controls how Claude launches, eliminating per-project config sprawl
3. **Visual organization** - Group sessions by manual labels with at-a-glance status
4. **Cross-platform support** - Windows (including WSL), macOS, and Linux

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                         │
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│   Sidebar    │         Terminal Panes                   │
│   ─────────  │         ────────────────                 │
│   [Group 1]  │    ┌─────────────────────────┐          │
│    • Sess A  │    │  xterm.js + node-pty    │          │
│    • Sess B  │    │  (Claude session)        │          │
│              │    └─────────────────────────┘          │
│   [Group 2]  │                                          │
│    • Sess C  │                                          │
│              │                                          │
├──────────────┴──────────────────────────────────────────┤
│  Status Bar: 2 waiting │ 3 working │ 5 idle │ 0 errors  │
└─────────────────────────────────────────────────────────┘
```

### How It Works

1. User creates a session → App spawns a terminal with Claude
2. App injects a wrapper that configures hooks before launching Claude
3. Hooks report state changes to a local IPC channel
4. App receives state updates, reflects in UI (sidebar badges, status bar counts)
5. User interacts with Claude through the embedded terminal

## Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Framework | Electron | Mature ecosystem, team knows TypeScript, proven for terminal apps |
| Terminal rendering | xterm.js | Battle-tested (VS Code uses it), excellent performance |
| PTY management | node-pty | Handles Windows/WSL bridging, well-documented |
| Persistence | SQLite (better-sqlite3) | Reliable, future-proofs for complex queries |
| IPC for hooks | Unix socket / Named pipe (Windows) | Low latency local communication |

### Cross-Platform Terminal Spawning

- **macOS/Linux:** Spawn terminals directly with bash/zsh
- **Windows native:** Spawn via PowerShell or CMD
- **Windows + WSL:** App runs natively on Windows, spawns terminals inside WSL via `wsl.exe -d <distro> -- <command>`

This mirrors how VS Code and Windows Terminal handle WSL.

## Core Components

### 1. Session Manager (Main Process)

Responsibilities:
- Spawns and tracks terminal sessions (node-pty)
- Maintains session metadata (group, working directory, state)
- Handles session lifecycle (create, terminate, restart)
- Persists session data across app restarts

### 2. Hook Coordinator

The app ships with a launcher script that wraps Claude:

```bash
claudelander-launch --session-id abc123 --project /path/to/project
```

This script:
- Sets `CLAUDE_HOOKS_DIR` to app-controlled location
- Configures hooks that emit state to a local socket/IPC
- Execs into `claude` with the project context

Every session has identical hook behavior, regardless of project.

### 3. State Monitor

Listens for hook events via IPC. Translates raw events into four states:

| State | Meaning | Visual |
|-------|---------|--------|
| Waiting for input | Claude asked a question or needs approval | Yellow/amber |
| Working | Claude is actively generating/thinking | Blue/animated |
| Idle | Finished last task, waiting for next prompt | Gray/dim |
| Error | Something went wrong | Red |

**State machine:**

```
                    ┌──────────────┐
     session start  │              │
         │          │    IDLE      │◄─────── generation complete
         ▼          │              │
    ┌────────────►  └──────┬───────┘
    │                      │
    │               user sends prompt
    │                      │
    │                      ▼
    │              ┌──────────────┐
    │              │              │
    │              │   WORKING    │
    │              │              │
    │              └──────┬───────┘
    │                     │
    │          Claude needs input (question/approval)
    │                     │
    │                     ▼
    │              ┌──────────────┐
    │              │   WAITING    │
    │              │  FOR INPUT   │
    │              └──────┬───────┘
    │                     │
    │              user provides input
    │                     │
    └─────────────────────┘
              (back to WORKING)
```

**Fallback:** If hooks miss edge cases, supplement with terminal output parsing for known patterns (approval prompts, error messages). Hooks remain primary.

### 4. UI Layer (Renderer)

- **Sidebar:** Groups with collapsible session lists, status badges
- **Terminal Area:** xterm.js instances, tabs or split-pane layout
- **Status Bar:** Aggregate counts, clickable filters

### 5. Data Persistence

SQLite database storing groups, sessions, and preferences.

## Data Model

### Entities

```typescript
interface Group {
  id: string;           // uuid
  name: string;         // "Work", "Personal", etc.
  color: string;        // hex color for visual distinction
  order: number;        // position in sidebar
  createdAt: Date;
}

interface Session {
  id: string;           // uuid
  groupId: string;      // foreign key to Group
  name: string;         // display name
  workingDir: string;   // absolute path to project
  state: 'idle' | 'working' | 'waiting' | 'error';
  shellType: 'bash' | 'zsh' | 'wsl' | 'powershell';
  order: number;        // position within group
  createdAt: Date;
  lastActivityAt: Date;
}

interface Preferences {
  theme: 'light' | 'dark' | 'system';
  terminalFontSize: number;
  terminalFontFamily: string;
  defaultShell: string;
  defaultGroup: string | null;
  showStatusBar: boolean;
  keyBindings: Record<string, string>;
}
```

### SQLite Schema

```sql
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#888888',
  "order" INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  group_id TEXT REFERENCES groups(id),
  name TEXT NOT NULL,
  working_dir TEXT NOT NULL,
  state TEXT DEFAULT 'idle',
  shell_type TEXT DEFAULT 'bash',
  "order" INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_activity_at DATETIME
);

CREATE TABLE preferences (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

## UI/UX Design

### Main Window Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ≡  Claudelander                              ─  □  ×          │
├────────────┬────────────────────────────────────────────────────┤
│            │  [Tab: Session A] [Tab: Session B] [+]             │
│  + Group   ├────────────────────────────────────────────────────┤
│            │                                                    │
│ ▼ Work     │  $ claude                                          │
│   ● Proj A │  > What would you like to work on?                 │
│   ○ Proj B │  █                                                 │
│   ◐ Proj C │                                                    │
│            │                                                    │
│ ▼ Personal │                                                    │
│   ○ Notes  │                                                    │
│            │                                                    │
│ ▼ Lab      │                                                    │
│   ● Build1 │                                                    │
│            │                                                    │
├────────────┴────────────────────────────────────────────────────┤
│  ● 2 waiting  │  ◐ 1 working  │  ○ 5 idle  │  ⚠ 0 errors       │
└─────────────────────────────────────────────────────────────────┘
```

### Status Indicators

- ● Yellow/amber = waiting for input
- ◐ Blue = working
- ○ Gray = idle
- ⚠ Red = error

### Interactions

**Sidebar:**
- Click session → switches terminal pane to that session
- Right-click session → context menu (rename, move to group, terminate, restart)
- Drag session → reorder or move between groups
- Click group header → collapse/expand

**Terminal area:**
- Single pane with tabs (default)
- Split view (2-4 panes) for power users

**Status bar:**
- Click "2 waiting" → filters/cycles through waiting sessions

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+N` | New session |
| `Ctrl+Tab` | Next session |
| `Ctrl+Shift+W` | Next "waiting for input" session |
| `Ctrl+Shift+N` | New group |

## Phased Delivery

### Phase 1: MVP

Core functionality for local multi-session management.

| Feature | Description |
|---------|-------------|
| Electron app | Cross-platform desktop application |
| Embedded terminals | xterm.js + node-pty |
| Session management | Create, terminate, restart sessions |
| State detection | Hook-based with 4 states |
| Groups | Manual organization, one session per group |
| Persistence | SQLite for groups, sessions, preferences |
| Platform support | Windows (+ WSL), macOS, Linux |

### Phase 2: Session Sharing

E2E encrypted session sharing for distributed team response.

| Feature | Description |
|---------|-------------|
| Self-hosted relay server | Your infrastructure, your control |
| Share codes | Format: `SYCLX-XXXXXX`, expire in 10 minutes if unused |
| E2E encryption | Relay sees only encrypted blobs |
| Access levels | View-only or interactive, revocable by host |
| Audit logging | Who accessed what, when, what actions taken |

**Architecture:**

```
┌──────────────┐         ┌──────────────────┐         ┌──────────────┐
│   Host PC    │◄───────►│   Relay Server   │◄───────►│  Remote User │
│ (Lab machine)│  E2E    │ (sees nothing,   │  E2E    │ (your laptop)│
│              │encrypted│  just routes)    │encrypted│              │
└──────────────┘         └──────────────────┘         └──────────────┘
```

### Phase 3: Teams & Mobile

| Feature | Description |
|---------|-------------|
| Teams | Create/join teams, share sessions with team instead of individual codes |
| Mobile companion app | View session status, respond to approvals on the go |
| Session summaries | AI-generated summaries of what each session accomplished |

## Out of Scope

The following are explicitly not planned:
- VS Code extension integration
- Cloud sync of sessions/preferences (beyond sharing)
- Web-based version (desktop only)

## Open Questions

Resolved during design:
- ~~SQLite vs JSON~~ → SQLite
- ~~Electron vs Tauri~~ → Electron
- ~~Hook-based vs output parsing~~ → Hooks primary, output parsing fallback

For later phases:
- Relay server hosting requirements (Phase 2)
- Mobile app technology (React Native? Flutter?) (Phase 3)
- Session summary model/approach (Phase 3)

## Next Steps

1. Initialize project with Electron + TypeScript boilerplate
2. Implement basic terminal rendering with xterm.js
3. Build session spawning with node-pty
4. Create hook wrapper and state detection
5. Build UI shell (sidebar, terminal area, status bar)
6. Add persistence layer
7. Polish and test cross-platform
