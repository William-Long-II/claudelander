# Claudelander

![Highlander](docs/assets/highlander-hero.png)

*There can be only one.*

---

A cross-platform desktop application for managing multiple Claude Code sessions.

## Features

- **Unified session management** - All Claude sessions in one app with clear status indicators
- **At-a-glance status** - See which sessions are waiting, working, idle, or errored
- **Visual organization** - Group sessions by project, client, or any label you choose
- **Centralized configuration** - Hooks configured once, work everywhere
- **Cross-platform** - Windows (including WSL), macOS, and Linux

## Status

🚧 **In Development** - See [design document](docs/plans/2026-01-01-claudelander-design.md) for full details.

## Tech Stack

- Electron
- TypeScript
- xterm.js + node-pty
- SQLite

## Roadmap

| Phase | Features |
|-------|----------|
| 1 (MVP) | Multi-session management, state detection, groups, persistence |
| 2 | E2E encrypted session sharing (`SYCLX-` codes) |
| 3 | Teams, mobile companion app, AI session summaries |

## License

TBD
