# System Notifications & Tray Icon Design

**Date:** 2026-01-02
**Status:** Approved
**Version:** 1.0.11+

## Overview

Add system notifications when sessions need attention and a system tray icon for background operation. These features work together to let users multitask while staying aware of session states.

## System Notifications

### Trigger Conditions

- Session state transitions to "waiting"
- App window is NOT focused (minimized, hidden, or another app has focus)

### Notification Content

- **Title:** Session name (e.g., "Session 1")
- **Body:** "Waiting for input" or detected prompt type
- **Icon:** ClaudeLander app icon
- **Sound:** System default (configurable)

### Click Behavior

1. Bring ClaudeLander window to front
2. Switch to the session that triggered the notification
3. Focus the terminal for immediate response

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Enable notifications | `true` | Show system notifications for waiting sessions |
| Notification sound | `true` | Play sound with notifications (uses system default) |

## System Tray Icon

### Icon Behavior

- Always visible when app is running
- Shows badge count overlay when sessions are waiting (e.g., "3")
- No badge when all sessions are idle/working

### Window Close (X Button)

- **Default behavior:** Minimize to tray (app keeps running)
- **Configurable:** Can be changed to actually quit
- Sessions continue running when minimized to tray

### Restoring Window

- Single-click tray icon to show/hide window
- Right-click menu → "Show ClaudeLander"

### Quitting

- Right-click tray → "Quit ClaudeLander"
- File menu → Quit (when window visible)
- macOS: Cmd+Q quits fully

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Close to tray | `true` | Minimize to tray instead of quitting on close |

## Tray Context Menu

```
┌─────────────────────────────┐
│ ClaudeLander                │  (header)
├─────────────────────────────┤
│ ● Session 2 - waiting       │  (click → opens to session)
│ ● Session 5 - waiting       │
├─────────────────────────────┤
│ Show ClaudeLander           │
│ Settings...                 │
├─────────────────────────────┤
│ Quit ClaudeLander           │
└─────────────────────────────┘
```

- Waiting sessions section only appears when sessions are waiting
- Limited to ~5 most recent waiting sessions
- Clicking a session opens app and switches to it

## Implementation

### Files to Modify

- `src/main/index.ts` - Wire up tray and notification managers
- `src/renderer/settings.html` - Add new preference toggles
- `src/main/repositories/preferences.ts` - New preference keys

### New Files

- `src/main/tray-manager.ts` - Tray icon, badge, and menu logic
- `src/main/notification-manager.ts` - Notification creation and click handling

### Technical Approach

1. **Notifications:** Electron `Notification` API
2. **Tray:** Electron `Tray` and `Menu` APIs
3. **Badge overlay:** `nativeImage` to draw count dynamically
4. **Focus detection:** `BrowserWindow.isFocused()` to gate notifications

### Platform Notes

- **Windows:** Tray icon in system tray, notifications via Windows notification center
- **macOS:** Menu bar icon, notifications via Notification Center
- **Linux:** System tray (AppIndicator), native notifications

## Testing Checklist

- [ ] Notification appears when session enters waiting state (window unfocused)
- [ ] No notification when window is focused
- [ ] Clicking notification focuses app and switches to session
- [ ] Tray icon visible when app running
- [ ] Badge count updates correctly
- [ ] Close button minimizes to tray (default)
- [ ] Right-click menu shows waiting sessions
- [ ] Clicking waiting session in menu switches to it
- [ ] Settings toggles work correctly
- [ ] "Quit" actually quits the app
