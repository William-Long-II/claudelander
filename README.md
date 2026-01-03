# ClaudeLander

<div align="center">

[![Release](https://img.shields.io/github/v/release/William-Long-II/claudelander?style=for-the-badge&color=gold)](https://github.com/William-Long-II/claudelander/releases)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=for-the-badge)]()

---

## Unified Session Management

*A cross-platform Claude Code session manager*

</div>

---

## Overview

Managing multiple Claude Code terminal sessions across different projects can be challenging. **ClaudeLander** provides a unified interface to organize, monitor, and manage all your Claude Code sessions in one place.

## Features

### **Session Management**
All your Claude Code sessions in one application. No more hunting through terminal windows.

### **Real-Time Status Detection**
See at a glance which sessions are:
- **Waiting** - Claude awaits your command
- **Working** - Processing your request
- **Idle** - Shell ready
- **Error** - Something went wrong
- **Stopped** - Session ended

### **Session Groups**
Organize sessions into groups by project, client, or workflow. Color-code for quick identification.

### **Persistent Sessions**
Sessions survive app restarts. Your context is preserved.

### **Auto-Update**
New versions download automatically.

### **Cross-Platform Support**
- Windows (native + WSL)
- macOS (Intel + Apple Silicon)
- Linux (AppImage + .deb)

---

## Installation

### macOS (Recommended)
```bash
brew tap William-Long-II/claudelander
brew install --cask claudelander
```

### Download
Grab the latest release for your platform from [Releases](https://github.com/William-Long-II/claudelander/releases).

| Platform | File |
|----------|------|
| Windows | `ClaudeLander-Setup-x.x.x.exe` |
| macOS | `ClaudeLander-x.x.x.dmg` |
| Linux | `ClaudeLander-x.x.x.AppImage` or `.deb` |

> **macOS Note:** If downloading directly (not via Homebrew), the app is unsigned. Run this before opening:
> ```bash
> xattr -cr /Applications/ClaudeLander.app
> ```

### Build from Source

```bash
# Clone the repository
git clone https://github.com/William-Long-II/claudelander.git
cd claudelander

# Install dependencies
npm install

# Run in development
npm run start

# Build for your platform
npm run dist:linux   # Linux
npm run dist:mac     # macOS
npm run dist:win     # Windows
```

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New Session | `Ctrl/Cmd + N` |
| Close Session | `Ctrl/Cmd + W` |
| Next Session | `Ctrl/Cmd + Tab` |
| Previous Session | `Ctrl/Cmd + Shift + Tab` |
| Next Waiting | `Ctrl/Cmd + Shift + W` |
| Settings | `Ctrl/Cmd + ,` |

---

## Tech Stack

- **Electron** - Cross-platform desktop framework
- **TypeScript** - Type-safe development
- **React** - UI rendering
- **xterm.js** - Terminal emulation
- **node-pty** - Pseudo-terminal management
- **better-sqlite3** - Persistent storage
- **electron-updater** - Auto-updates

---

## Roadmap

| Phase | Status | Features |
|-------|--------|----------|
| **1 (MVP)** | Complete | Multi-session management, state detection, groups, persistence, auto-update |
| **2** | Future | E2E encrypted session sharing (`SYCLX-` codes) |
| **3** | Future | Teams, mobile companion, AI session summaries |

---

## Contributing

Contributions are welcome! Feel free to open issues or submit PRs.

---

## Credits

Created by **Will Long II** and **Claude** (Anthropic)

---

<div align="center">

**[Download Now](https://github.com/William-Long-II/claudelander/releases)**

</div>

---

## License

MIT License - See [LICENSE](LICENSE) for details.
