# Batch Features & Bug Fix Design

**Date:** 2026-01-02
**Status:** Approved

## Overview

This document covers 10 feature requests and 1 bug fix to be implemented as a batch release.

## Features

### 1. Sub-Groups (One Level Deep)

**Database Changes:**
```sql
ALTER TABLE groups ADD COLUMN parent_id TEXT DEFAULT NULL;
ALTER TABLE groups ADD COLUMN collapsed INTEGER DEFAULT 0;
```

**Type Updates:**
```typescript
interface Group {
  id: string
  name: string
  color: string
  workingDir: string
  order: number
  createdAt: Date
  parentId: string | null  // NEW
  collapsed: boolean       // NEW
}
```

**Behavior:**
- Sub-groups can only exist one level deep (no nesting sub-groups)
- Sub-groups inherit parent color by default (changeable)
- Sub-groups have own `workingDir` defaulting to parent's path
- Creating session in sub-group uses: `subGroup.workingDir || parentGroup.workingDir`
- Deleting group with sub-groups prompts: delete all or move up

**Visual:**
- Top-level groups: Filled dot (●), `[dir]` label
- Sub-groups: Outline dot (○), `[sub]` label, indented 16px
- Sessions in sub-groups further indented

### 2. Collapsible Groups

**UI:**
- Collapse chevron: `▶` (collapsed) / `▼` (expanded)
- Collapsed state persisted to database
- Collapsed groups hide all sessions and sub-groups

**Interaction:**
- Click chevron to toggle
- Left arrow key collapses, Right arrow expands
- Enter key toggles when group focused

### 3. Keyboard Navigation in Sidebar

**Focus Tracking State:**
```typescript
const [sidebarFocused, setSidebarFocused] = useState(false)
const [focusedItemId, setFocusedItemId] = useState<string | null>(null)
const [focusedItemType, setFocusedItemType] = useState<'group' | 'session' | null>(null)
```

**Navigation (when sidebar focused):**
| Key | Action |
|-----|--------|
| `↑` / `↓` | Move focus to prev/next visible item |
| `←` | Collapse focused group (or parent if on session) |
| `→` | Expand focused group |
| `Enter` | Toggle collapse (group) OR select + focus terminal (session) |

**Focus Visual:** Dotted outline distinct from active session highlight

### 4. Enter Key Focuses Terminal

When pressing Enter on a session in sidebar:
1. Select the session (make it active)
2. Transfer focus to the terminal area
3. Terminal receives keyboard input

### 5. Ctrl+Q Focuses Sidebar

**Global shortcut:** `Ctrl+Q`
- Focuses sidebar region
- If no item was focused, focuses first visible item
- Sets `sidebarFocused = true`

### 6. Ctrl+G Creates New Group (with Optional Folder Prompt)

**Shortcut:** `Ctrl+G` - Create new top-level group
**Shortcut:** `Ctrl+Shift+G` - Create sub-group under focused group

**Flow:**
1. Prompt for group name (inline or dialog)
2. Show folder picker dialog (optional - can cancel/skip)
3. Create group with or without working directory

### 7. Remove Highlander Movie References

**Cleanup targets:**
- Splash screen text
- About dialog
- Tray tooltips
- Notification wording
- Code comments

**Search terms:** "Highlander", "only one", "immortal", "quickening", movie quotes

**Keep:** App name "Claudelander", professional epic aesthetic

### 8. Context-Aware Shortcuts in Status Bar

**Layout:**
```
│ * 0 waiting  o 2 working  o 1 idle │  ↑↓ Navigate  Enter Select  Ctrl+G Group │
         LEFT (existing)                        RIGHT (new - context shortcuts)
```

**Sidebar focused:**
`↑↓ Navigate | Enter Select | ←→ Collapse | Ctrl+G New Group`

**Terminal focused:**
`Ctrl+Q Sidebar | Ctrl+Tab Next | Ctrl+W Close`

### 9. Remove Path Label Under Session

Remove the working directory path shown below session name in sidebar.
Path will now only appear in the new terminal header bar.

### 10. Terminal Header Bar

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ ● Session 1    D:\Projects\claudelander    [↻] [■] [×]     │
├─────────────────────────────────────────────────────────────┤
│                     TERMINAL AREA                           │
└─────────────────────────────────────────────────────────────┘
```

**Components:**
- State dot: Colored by session state
- Session name: Editable on double-click
- Full path: Working directory (truncate from left if needed)
- Actions: Restart (↻), Stop (■), Close (×)

## Bug Fix

### Terminal "Squished" on Focus

**Symptom:** Terminal shows ~10 character width, text wraps incorrectly until window resize.

**Root Cause:** `fitAddon.fit()` called before container has correct dimensions (display:none or zero size).

**Fix:**
```typescript
// In Terminal.tsx
useEffect(() => {
  if (!terminalRef.current || !fitAddon) return

  const observer = new ResizeObserver((entries) => {
    const { width, height } = entries[0].contentRect
    if (width > 0 && height > 0) {
      fitAddon.fit()
    }
  })

  observer.observe(terminalRef.current)
  const timeout = setTimeout(() => fitAddon.fit(), 50)

  return () => {
    observer.disconnect()
    clearTimeout(timeout)
  }
}, [activeSessionId])
```

Also call `fit()` after `requestAnimationFrame` when `activeSessionId` changes.

## Implementation Order

1. **Bug fix** - Terminal squished (quick win, high impact)
2. **Database migration** - Add parent_id, collapsed columns
3. **Sub-groups & collapse** - Core hierarchy feature
4. **Keyboard navigation** - Focus system + arrow keys
5. **Shortcuts** - Ctrl+Q, Ctrl+G, Enter→terminal
6. **Terminal header bar** - New component
7. **Status bar shortcuts** - Context-aware display
8. **Remove session path label** - Simple CSS/JSX removal
9. **Highlander cleanup** - Grep and update references

## Files to Modify

- `src/main/database.ts` - Schema migration
- `src/main/repositories/groups.ts` - parent_id, collapsed fields
- `src/shared/types.ts` - Group type update
- `src/renderer/App.tsx` - Focus state, keyboard handlers, layout
- `src/renderer/components/Terminal.tsx` - Fix sizing bug
- `src/renderer/components/TerminalHeader.tsx` - NEW
- `src/renderer/hooks/useKeyboardShortcuts.ts` - New shortcuts
- `src/renderer/store/groups.ts` - Sub-group operations
- `src/renderer/styles/global.css` - Focus styles, header styles
- Various files - Highlander reference cleanup
