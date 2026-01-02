# Batch Features v1.2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 10 features and 1 bug fix for Claudelander v1.2 release

**Architecture:** Database schema changes for sub-groups, new React state for focus tracking and collapse, new TerminalHeader component, enhanced keyboard shortcuts hook, CSS updates for visual changes.

**Tech Stack:** Electron, React, TypeScript, better-sqlite3, xterm.js

---

## Task 1: Fix Terminal Squished Bug

**Files:**
- Modify: `src/renderer/components/Terminal.tsx:78-168`
- Modify: `src/renderer/App.tsx:494-510`

**Step 1: Update Terminal.tsx with ResizeObserver**

In `src/renderer/components/Terminal.tsx`, replace the resize handling in the useEffect (around line 146-160):

```typescript
// Replace lines 146-160 with:

    // Handle resize with ResizeObserver for reliable sizing
    const handleResize = () => {
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit();
        const { cols, rows } = xtermRef.current;
        window.electronAPI.resizeSession(sessionId, cols, rows);
      }
    };

    // Use ResizeObserver to detect when container actually has dimensions
    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        requestAnimationFrame(() => {
          handleResize();
        });
      }
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    window.addEventListener('resize', handleResize);

    // Initial fit after layout settles
    requestAnimationFrame(() => {
      setTimeout(() => handleResize(), 50);
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      cleanupPtyData();
      window.electronAPI.killSession(sessionId);
      term.dispose();
    };
```

**Step 2: Add visibility-based re-fit in App.tsx**

In `src/renderer/App.tsx`, add a ref to track terminal containers and trigger refit. After line 31, add:

```typescript
const terminalRefs = useRef<Map<string, HTMLDivElement>>(new Map());
```

Update the terminal-wrapper div (around line 497-509) to:

```typescript
<div
  key={session.id}
  className="terminal-wrapper"
  style={{ display: session.id === activeSessionId ? 'flex' : 'none' }}
  ref={(el) => {
    if (el) terminalRefs.current.set(session.id, el);
    else terminalRefs.current.delete(session.id);
  }}
>
```

**Step 3: Test the fix**

1. Launch the app with `npm start`
2. Create multiple sessions in different groups
3. Switch between sessions rapidly
4. Verify terminal fills the available space immediately
5. Resize window and verify terminal adapts

**Step 4: Commit**

```bash
git add src/renderer/components/Terminal.tsx src/renderer/App.tsx
git commit -m "fix: terminal squished on session switch

Use ResizeObserver to detect when terminal container has proper dimensions
before calling fitAddon.fit(). Also use requestAnimationFrame to ensure
layout is complete before fitting."
```

---

## Task 2: Database Schema Migration for Sub-Groups

**Files:**
- Modify: `src/main/database.ts:21-64`
- Modify: `src/shared/types.ts:15-22`
- Modify: `src/main/repositories/groups.ts:1-65`

**Step 1: Update Group type in shared/types.ts**

Replace the Group interface (lines 15-22):

```typescript
export interface Group {
  id: string;
  name: string;
  color: string;
  workingDir: string;
  order: number;
  createdAt: Date;
  parentId: string | null;
  collapsed: boolean;
}
```

**Step 2: Add migration in database.ts**

After the existing migration (line 54), add:

```typescript
  // Migration: Add parent_id column to groups if it doesn't exist
  if (!columns.some(col => col.name === 'parent_id')) {
    database.exec("ALTER TABLE groups ADD COLUMN parent_id TEXT DEFAULT NULL");
  }

  // Migration: Add collapsed column to groups if it doesn't exist
  if (!columns.some(col => col.name === 'collapsed')) {
    database.exec("ALTER TABLE groups ADD COLUMN collapsed INTEGER DEFAULT 0");
  }
```

**Step 3: Update groups repository**

In `src/main/repositories/groups.ts`, update getAllGroups (lines 4-16):

```typescript
export function getAllGroups(): Group[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM groups ORDER BY "order"').all() as any[];

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    color: row.color,
    workingDir: row.working_dir || '',
    order: row.order,
    createdAt: new Date(row.created_at),
    parentId: row.parent_id || null,
    collapsed: Boolean(row.collapsed),
  }));
}
```

Update createGroup (lines 18-31):

```typescript
export function createGroup(group: Group): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO groups (id, name, color, working_dir, "order", created_at, parent_id, collapsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    group.id,
    group.name,
    group.color,
    group.workingDir || '',
    group.order,
    group.createdAt.toISOString(),
    group.parentId || null,
    group.collapsed ? 1 : 0
  );
}
```

Update updateGroup to handle new fields (add after line 53):

```typescript
  if (updates.parentId !== undefined) {
    fields.push('parent_id = ?');
    values.push(updates.parentId);
  }
  if (updates.collapsed !== undefined) {
    fields.push('collapsed = ?');
    values.push(updates.collapsed ? 1 : 0);
  }
```

**Step 4: Test the migration**

1. Run `npm run build:main`
2. Launch the app
3. Check that existing groups still load
4. Create a new group and verify it has parentId: null, collapsed: false

**Step 5: Commit**

```bash
git add src/shared/types.ts src/main/database.ts src/main/repositories/groups.ts
git commit -m "feat: add database schema for sub-groups

- Add parentId and collapsed fields to Group type
- Add migrations for parent_id and collapsed columns
- Update repository to read/write new fields"
```

---

## Task 3: Update Groups Store for Sub-Groups

**Files:**
- Modify: `src/renderer/store/groups.ts`

**Step 1: Read current store**

First, read the file to understand current implementation.

**Step 2: Update createGroup to accept parentId**

Update the createGroup function to accept optional parentId and inherit parent's workingDir:

```typescript
const createGroup = async (name: string, parentId?: string) => {
  const id = crypto.randomUUID();
  const parentGroup = parentId ? groups.find(g => g.id === parentId) : null;
  const order = parentId
    ? groups.filter(g => g.parentId === parentId).length
    : groups.filter(g => !g.parentId).length;

  const newGroup: Group = {
    id,
    name,
    color: parentGroup?.color || GROUP_COLORS[groups.filter(g => !g.parentId).length % GROUP_COLORS.length],
    workingDir: parentGroup?.workingDir || '',
    order,
    createdAt: new Date(),
    parentId: parentId || null,
    collapsed: false,
  };

  setGroups([...groups, newGroup]);

  try {
    await window.electronAPI.createGroup(newGroup);
  } catch (error) {
    setGroups(groups.filter(g => g.id !== id));
    throw error;
  }
};
```

**Step 3: Add toggleCollapse function**

```typescript
const toggleCollapse = async (groupId: string) => {
  const group = groups.find(g => g.id === groupId);
  if (!group) return;

  const newCollapsed = !group.collapsed;
  setGroups(groups.map(g =>
    g.id === groupId ? { ...g, collapsed: newCollapsed } : g
  ));

  try {
    await window.electronAPI.updateGroup(groupId, { collapsed: newCollapsed });
  } catch (error) {
    setGroups(groups.map(g =>
      g.id === groupId ? { ...g, collapsed: !newCollapsed } : g
    ));
  }
};
```

**Step 4: Add helper functions**

```typescript
const getTopLevelGroups = () => groups.filter(g => !g.parentId).sort((a, b) => a.order - b.order);

const getSubGroups = (parentId: string) => groups.filter(g => g.parentId === parentId).sort((a, b) => a.order - b.order);

const getEffectiveWorkingDir = (groupId: string): string => {
  const group = groups.find(g => g.id === groupId);
  if (!group) return '';
  if (group.workingDir) return group.workingDir;
  if (group.parentId) {
    const parent = groups.find(g => g.id === group.parentId);
    return parent?.workingDir || '';
  }
  return '';
};
```

**Step 5: Export new functions from hook**

Add to the return object:
```typescript
return {
  groups,
  loading,
  createGroup,
  updateGroup,
  removeGroup,
  reorderGroup,
  toggleCollapse,      // NEW
  getTopLevelGroups,   // NEW
  getSubGroups,        // NEW
  getEffectiveWorkingDir, // NEW
};
```

**Step 6: Commit**

```bash
git add src/renderer/store/groups.ts
git commit -m "feat: add sub-group support to groups store

- createGroup now accepts optional parentId
- Add toggleCollapse function
- Add helpers: getTopLevelGroups, getSubGroups, getEffectiveWorkingDir"
```

---

## Task 4: Implement Collapsible Groups UI

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles/global.css`

**Step 1: Import new functions from groups store**

Update the useGroups destructuring (line 11):

```typescript
const {
  groups,
  loading: groupsLoading,
  createGroup,
  updateGroup,
  removeGroup,
  reorderGroup,
  toggleCollapse,
  getTopLevelGroups,
  getSubGroups,
  getEffectiveWorkingDir,
} = useGroups();
```

**Step 2: Update handleNewSession to use effective working dir**

Replace line 60:
```typescript
const cwd = getEffectiveWorkingDir(groupId) || homedir;
```

**Step 3: Add collapse chevron to group header**

In the group-header div (after the group-color button, around line 356), add:

```typescript
<button
  className="group-chevron"
  onClick={(e) => {
    e.stopPropagation();
    toggleCollapse(group.id);
  }}
  title={group.collapsed ? 'Expand' : 'Collapse'}
>
  {group.collapsed ? '▶' : '▼'}
</button>
```

**Step 4: Conditionally render sessions based on collapsed state**

Wrap the group-sessions div with a condition (around line 424-428):

```typescript
{!group.collapsed && (
  <div
    className={`group-sessions ${dropTarget?.id === `group:${group.id}` ? 'drop-target' : ''}`}
    onDragOver={(e) => handleGroupAreaDragOver(e, group.id)}
    onDrop={(e) => handleGroupAreaDrop(e, group.id)}
  >
    {/* existing session mapping */}
  </div>
)}
```

**Step 5: Add CSS for chevron**

In `src/renderer/styles/global.css`, after .group-color styles (around line 127), add:

```css
.group-chevron {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 10px;
  padding: 2px;
  width: 16px;
  flex-shrink: 0;
}

.group-chevron:hover {
  color: #d4d4d4;
}
```

**Step 6: Test collapse functionality**

1. Run `npm start`
2. Click chevron to collapse/expand groups
3. Verify sessions hide when collapsed
4. Verify state persists after app restart

**Step 7: Commit**

```bash
git add src/renderer/App.tsx src/renderer/styles/global.css
git commit -m "feat: add collapsible groups

- Add collapse chevron button to group header
- Hide sessions when group is collapsed
- Persist collapse state to database"
```

---

## Task 5: Implement Sub-Groups UI

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles/global.css`

**Step 1: Update context menu to include "New Sub-Group"**

In handleGroupContextMenu (around line 116-135), add after "Set Working Directory":

```typescript
{ label: 'New Sub-Group', onClick: () => handleCreateSubGroup(groupId) },
```

**Step 2: Add handleCreateSubGroup function**

After handleCreateGroup (around line 67):

```typescript
const handleCreateSubGroup = async (parentId: string) => {
  const parent = groups.find(g => g.id === parentId);
  if (!parent || parent.parentId) return; // Can't create sub-group of sub-group

  const subGroups = getSubGroups(parentId);
  const dir = await window.electronAPI.selectDirectory();
  await createGroup(`Sub-Group ${subGroups.length + 1}`, parentId);

  // Optionally set directory if user selected one
  // (handled in createGroup which inherits parent dir by default)
};
```

**Step 3: Refactor group rendering for hierarchy**

Replace the groups.map section with a nested rendering approach. The structure should render top-level groups, then their sub-groups indented within:

```typescript
{getTopLevelGroups().map(group => (
  <div key={group.id} className="group-container">
    {/* Render main group */}
    <div
      className={`group ${draggedItem?.type === 'group' && draggedItem.id === group.id ? 'dragging' : ''} ${dropTarget?.type === 'group' && dropTarget.id === group.id ? `drop-${dropTarget.position}` : ''}`}
      draggable
      onDragStart={(e) => handleGroupDragStart(e, group.id)}
      onDragEnd={handleDragEnd}
      onDragOver={(e) => handleGroupDragOver(e, group.id)}
      onDrop={(e) => handleGroupDrop(e, group.id)}
    >
      {/* existing group-header */}
      {/* existing group-sessions (when not collapsed) */}
    </div>

    {/* Render sub-groups */}
    {!group.collapsed && getSubGroups(group.id).map(subGroup => (
      <div
        key={subGroup.id}
        className={`group sub-group ${draggedItem?.type === 'group' && draggedItem.id === subGroup.id ? 'dragging' : ''}`}
        draggable
        onDragStart={(e) => handleGroupDragStart(e, subGroup.id)}
        onDragEnd={handleDragEnd}
      >
        {/* Similar structure but with sub-group styling */}
      </div>
    ))}
  </div>
))}
```

**Step 4: Add CSS for sub-groups**

In `src/renderer/styles/global.css`:

```css
.group-container {
  margin-bottom: 8px;
}

.sub-group {
  margin-left: 20px;
  margin-bottom: 8px;
}

.sub-group .group-color {
  width: 8px;
  height: 8px;
  border: 1px solid currentColor;
  background: transparent !important;
}

.group-type-indicator {
  font-size: 9px;
  color: #666;
  margin-left: 4px;
}
```

**Step 5: Add type indicator labels**

In group name span, add indicator:

```typescript
{group.workingDir && <span className="group-type-indicator">[dir]</span>}
```

For sub-groups:
```typescript
<span className="group-type-indicator">[sub]</span>
```

**Step 6: Test sub-groups**

1. Right-click a group → "New Sub-Group"
2. Verify sub-group appears indented
3. Verify sub-group can have its own sessions
4. Verify sub-group inherits parent's working dir
5. Verify collapsing parent hides sub-groups

**Step 7: Commit**

```bash
git add src/renderer/App.tsx src/renderer/styles/global.css
git commit -m "feat: implement sub-groups UI

- Add 'New Sub-Group' context menu item
- Render sub-groups indented under parent
- Sub-groups have outline dot style vs filled
- Collapsing parent hides sub-groups"
```

---

## Task 6: Add Focus Tracking State

**Files:**
- Modify: `src/renderer/App.tsx`

**Step 1: Add focus tracking state**

After the existing state declarations (around line 31), add:

```typescript
const [sidebarFocused, setSidebarFocused] = useState(false);
const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
const [focusedItemType, setFocusedItemType] = useState<'group' | 'session' | null>(null);
const sidebarRef = useRef<HTMLDivElement>(null);
```

**Step 2: Add focus/blur handlers to sidebar**

Update the aside element:

```typescript
<aside
  className={`sidebar ${sidebarFocused ? 'focused' : ''}`}
  ref={sidebarRef}
  tabIndex={0}
  onFocus={() => setSidebarFocused(true)}
  onBlur={(e) => {
    // Only blur if focus moved outside sidebar
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setSidebarFocused(false);
    }
  }}
>
```

**Step 3: Add focus styles**

In `src/renderer/styles/global.css`:

```css
.sidebar:focus {
  outline: none;
}

.sidebar.focused .group-header.item-focused,
.sidebar.focused .session.item-focused {
  outline: 1px dashed #007acc;
  outline-offset: -1px;
}
```

**Step 4: Add item-focused class to elements**

For groups (in group-header):
```typescript
className={`group-header ${focusedItemType === 'group' && focusedItemId === group.id ? 'item-focused' : ''}`}
```

For sessions:
```typescript
className={`session ${session.id === activeSessionId ? 'active' : ''} ${focusedItemType === 'session' && focusedItemId === session.id ? 'item-focused' : ''} ...`}
```

**Step 5: Commit**

```bash
git add src/renderer/App.tsx src/renderer/styles/global.css
git commit -m "feat: add focus tracking state for sidebar

- Track sidebarFocused, focusedItemId, focusedItemType
- Add sidebar ref for programmatic focus
- Add visual focus indicator (dashed outline)"
```

---

## Task 7: Implement Keyboard Navigation

**Files:**
- Modify: `src/renderer/hooks/useKeyboardShortcuts.ts`
- Modify: `src/renderer/App.tsx`

**Step 1: Extend ShortcutHandlers interface**

In `useKeyboardShortcuts.ts`, update the interface:

```typescript
interface ShortcutHandlers {
  onNewSession: () => void;
  onNextSession: () => void;
  onPrevSession: () => void;
  onNextWaiting: () => void;
  onCloseSession: () => void;
  onFocusSidebar: () => void;        // NEW
  onNewGroup: () => void;            // NEW
  onNewSubGroup?: () => void;        // NEW
  onNavigateUp?: () => void;         // NEW
  onNavigateDown?: () => void;       // NEW
  onCollapse?: () => void;           // NEW
  onExpand?: () => void;             // NEW
  onSelect?: () => void;             // NEW
}
```

**Step 2: Add new keyboard handlers**

In the handleKeyDown function, add:

```typescript
    // Ctrl+Q = Focus sidebar
    if (isMod && e.key === 'q') {
      e.preventDefault();
      handlers.onFocusSidebar();
    }

    // Ctrl+G = New group
    if (isMod && !e.shiftKey && e.key === 'g') {
      e.preventDefault();
      handlers.onNewGroup();
    }

    // Ctrl+Shift+G = New sub-group
    if (isMod && e.shiftKey && e.key === 'G') {
      e.preventDefault();
      handlers.onNewSubGroup?.();
    }

    // Arrow keys (only when sidebar focused - check in App.tsx)
    if (e.key === 'ArrowUp') {
      handlers.onNavigateUp?.();
    }
    if (e.key === 'ArrowDown') {
      handlers.onNavigateDown?.();
    }
    if (e.key === 'ArrowLeft') {
      handlers.onCollapse?.();
    }
    if (e.key === 'ArrowRight') {
      handlers.onExpand?.();
    }
    if (e.key === 'Enter' && handlers.onSelect) {
      handlers.onSelect();
    }
```

**Step 3: Build navigation list in App.tsx**

Add a useMemo to build flat navigation list:

```typescript
const navItems = useMemo(() => {
  const items: Array<{ id: string; type: 'group' | 'session'; parentId?: string }> = [];

  getTopLevelGroups().forEach(group => {
    items.push({ id: group.id, type: 'group' });

    if (!group.collapsed) {
      // Add sessions in this group
      getSessionsByGroup(group.id).sort((a, b) => a.order - b.order).forEach(session => {
        items.push({ id: session.id, type: 'session', parentId: group.id });
      });

      // Add sub-groups and their sessions
      getSubGroups(group.id).forEach(subGroup => {
        items.push({ id: subGroup.id, type: 'group', parentId: group.id });

        if (!subGroup.collapsed) {
          getSessionsByGroup(subGroup.id).sort((a, b) => a.order - b.order).forEach(session => {
            items.push({ id: session.id, type: 'session', parentId: subGroup.id });
          });
        }
      });
    }
  });

  return items;
}, [groups, sessions, getTopLevelGroups, getSubGroups, getSessionsByGroup]);
```

**Step 4: Implement navigation handlers**

```typescript
const handleFocusSidebar = useCallback(() => {
  sidebarRef.current?.focus();
  if (!focusedItemId && navItems.length > 0) {
    setFocusedItemId(navItems[0].id);
    setFocusedItemType(navItems[0].type);
  }
}, [focusedItemId, navItems]);

const handleNavigateUp = useCallback(() => {
  if (!sidebarFocused) return;
  const currentIndex = navItems.findIndex(item => item.id === focusedItemId);
  const prevIndex = currentIndex > 0 ? currentIndex - 1 : navItems.length - 1;
  setFocusedItemId(navItems[prevIndex].id);
  setFocusedItemType(navItems[prevIndex].type);
}, [sidebarFocused, focusedItemId, navItems]);

const handleNavigateDown = useCallback(() => {
  if (!sidebarFocused) return;
  const currentIndex = navItems.findIndex(item => item.id === focusedItemId);
  const nextIndex = currentIndex < navItems.length - 1 ? currentIndex + 1 : 0;
  setFocusedItemId(navItems[nextIndex].id);
  setFocusedItemType(navItems[nextIndex].type);
}, [sidebarFocused, focusedItemId, navItems]);

const handleCollapse = useCallback(() => {
  if (!sidebarFocused || !focusedItemId) return;
  if (focusedItemType === 'group') {
    const group = groups.find(g => g.id === focusedItemId);
    if (group && !group.collapsed) {
      toggleCollapse(focusedItemId);
    }
  } else if (focusedItemType === 'session') {
    // Find parent group and collapse it
    const session = sessions.find(s => s.id === focusedItemId);
    if (session) {
      toggleCollapse(session.groupId);
    }
  }
}, [sidebarFocused, focusedItemId, focusedItemType, groups, sessions, toggleCollapse]);

const handleExpand = useCallback(() => {
  if (!sidebarFocused || !focusedItemId) return;
  if (focusedItemType === 'group') {
    const group = groups.find(g => g.id === focusedItemId);
    if (group && group.collapsed) {
      toggleCollapse(focusedItemId);
    }
  }
}, [sidebarFocused, focusedItemId, focusedItemType, groups, toggleCollapse]);

const handleSelect = useCallback(() => {
  if (!sidebarFocused || !focusedItemId) return;
  if (focusedItemType === 'group') {
    toggleCollapse(focusedItemId);
  } else if (focusedItemType === 'session') {
    setActiveSessionId(focusedItemId);
    // Focus terminal
    setSidebarFocused(false);
  }
}, [sidebarFocused, focusedItemId, focusedItemType, toggleCollapse, setActiveSessionId]);

const handleNewGroup = useCallback(async () => {
  await createGroup(`Group ${groups.filter(g => !g.parentId).length + 1}`);
}, [createGroup, groups]);

const handleNewSubGroup = useCallback(async () => {
  if (focusedItemType === 'group' && focusedItemId) {
    const group = groups.find(g => g.id === focusedItemId);
    if (group && !group.parentId) {
      await handleCreateSubGroup(focusedItemId);
    }
  }
}, [focusedItemType, focusedItemId, groups, handleCreateSubGroup]);
```

**Step 5: Update shortcutHandlers**

```typescript
const shortcutHandlers = useMemo(() => ({
  onNewSession: handleKeyboardNewSession,
  onNextSession: handleNextSession,
  onPrevSession: handlePrevSession,
  onNextWaiting: handleNextWaiting,
  onCloseSession: handleCloseSession,
  onFocusSidebar: handleFocusSidebar,
  onNewGroup: handleNewGroup,
  onNewSubGroup: handleNewSubGroup,
  onNavigateUp: handleNavigateUp,
  onNavigateDown: handleNavigateDown,
  onCollapse: handleCollapse,
  onExpand: handleExpand,
  onSelect: handleSelect,
}), [/* all dependencies */]);
```

**Step 6: Test keyboard navigation**

1. Press Ctrl+Q to focus sidebar
2. Use arrow keys to navigate
3. Press Enter to select session / toggle group
4. Press Left/Right to collapse/expand
5. Press Ctrl+G to create new group

**Step 7: Commit**

```bash
git add src/renderer/hooks/useKeyboardShortcuts.ts src/renderer/App.tsx
git commit -m "feat: implement keyboard navigation

- Ctrl+Q focuses sidebar
- Arrow Up/Down navigates items
- Arrow Left/Right collapses/expands groups
- Enter selects session or toggles group collapse
- Ctrl+G creates new group
- Ctrl+Shift+G creates sub-group under focused group"
```

---

## Task 8: Create Terminal Header Component

**Files:**
- Create: `src/renderer/components/TerminalHeader.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles/global.css`

**Step 1: Create TerminalHeader.tsx**

```typescript
import React, { useState } from 'react';
import { Session } from '../../shared/types';

interface TerminalHeaderProps {
  session: Session;
  onRename: (name: string) => void;
  onRestart: () => void;
  onStop: () => void;
  onClose: () => void;
}

const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  session,
  onRename,
  onRestart,
  onStop,
  onClose,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(session.name);

  const handleFinishEdit = () => {
    if (editName.trim() && editName !== session.name) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  const truncatePath = (path: string, maxLen: number = 50) => {
    if (path.length <= maxLen) return path;
    return '...' + path.slice(-(maxLen - 3));
  };

  return (
    <div className="terminal-header">
      <span className={`header-state-dot ${session.state}`} title={session.state} />

      {isEditing ? (
        <input
          className="header-name-input"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={handleFinishEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleFinishEdit();
            if (e.key === 'Escape') {
              setEditName(session.name);
              setIsEditing(false);
            }
          }}
          autoFocus
        />
      ) : (
        <span
          className="header-name"
          onDoubleClick={() => {
            setEditName(session.name);
            setIsEditing(true);
          }}
          title="Double-click to rename"
        >
          {session.name}
        </span>
      )}

      <span className="header-path" title={session.workingDir}>
        {truncatePath(session.workingDir)}
      </span>

      <div className="header-actions">
        <button
          className="header-action"
          onClick={onRestart}
          title="Restart session"
        >
          ↻
        </button>
        <button
          className="header-action"
          onClick={onStop}
          title="Stop session"
        >
          ■
        </button>
        <button
          className="header-action danger"
          onClick={onClose}
          title="Close session"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default TerminalHeader;
```

**Step 2: Add CSS for header**

In `src/renderer/styles/global.css`:

```css
/* Terminal Header */
.terminal-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: #252526;
  border-bottom: 1px solid #3c3c3c;
  font-size: 13px;
}

.header-state-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.header-state-dot.idle { background: #888; }
.header-state-dot.working { background: #61afef; }
.header-state-dot.waiting { background: #e5c07b; }
.header-state-dot.error { background: #e06c75; }
.header-state-dot.stopped { background: #666; }

.header-name {
  font-weight: 500;
  cursor: pointer;
}

.header-name:hover {
  text-decoration: underline;
}

.header-name-input {
  font-size: 13px;
  font-weight: 500;
  background: #3c3c3c;
  border: 1px solid #007acc;
  color: #d4d4d4;
  padding: 2px 6px;
  border-radius: 2px;
  outline: none;
}

.header-path {
  flex: 1;
  color: #888;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.header-action {
  background: none;
  border: 1px solid #555;
  color: #888;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-action:hover {
  background: #3c3c3c;
  color: #d4d4d4;
}

.header-action.danger:hover {
  background: #4d2626;
  color: #e06c75;
  border-color: #e06c75;
}
```

**Step 3: Use TerminalHeader in App.tsx**

Add import:
```typescript
import TerminalHeader from './components/TerminalHeader';
```

Update terminal-wrapper to include header:
```typescript
<div
  key={session.id}
  className="terminal-wrapper"
  style={{ display: session.id === activeSessionId ? 'flex' : 'none' }}
>
  <TerminalHeader
    session={session}
    onRename={(name) => updateSession(session.id, { name })}
    onRestart={() => {
      // Restart logic - kill and recreate
      updateSession(session.id, { state: 'idle' });
    }}
    onStop={() => updateSession(session.id, { state: 'stopped' })}
    onClose={() => handleRemoveSession(session.id)}
  />
  <Terminal
    sessionId={session.id}
    cwd={session.workingDir}
    launchClaude={session.shellType === 'claude'}
    isStopped={session.state === 'stopped'}
    onStart={() => updateSession(session.id, { state: 'idle' })}
    onError={() => updateSession(session.id, { state: 'error' })}
  />
</div>
```

**Step 4: Update terminal-wrapper CSS**

```css
.terminal-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
}

.terminal-wrapper .terminal-container {
  flex: 1;
}
```

**Step 5: Test header**

1. Verify header shows session name, path, state
2. Double-click name to edit
3. Click action buttons

**Step 6: Commit**

```bash
git add src/renderer/components/TerminalHeader.tsx src/renderer/App.tsx src/renderer/styles/global.css
git commit -m "feat: add terminal header bar

- Shows session name (editable), path, state dot
- Action buttons: restart, stop, close
- Path truncates from left when too long"
```

---

## Task 9: Add Context-Aware Shortcuts to Status Bar

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles/global.css`

**Step 1: Create shortcuts display component**

In App.tsx, add a helper to get context-aware shortcuts:

```typescript
const getContextShortcuts = useCallback(() => {
  if (sidebarFocused) {
    return [
      { key: '↑↓', label: 'Navigate' },
      { key: 'Enter', label: 'Select' },
      { key: '←→', label: 'Collapse' },
      { key: 'Ctrl+G', label: 'New Group' },
    ];
  }
  return [
    { key: 'Ctrl+Q', label: 'Sidebar' },
    { key: 'Ctrl+Tab', label: 'Next' },
    { key: 'Ctrl+W', label: 'Close' },
  ];
}, [sidebarFocused]);
```

**Step 2: Update status bar JSX**

```typescript
<footer className="status-bar">
  <div className="status-left">
    <span className="status-item waiting">* {counts.waiting} waiting</span>
    <span className="status-item working">o {counts.working} working</span>
    <span className="status-item idle">o {counts.idle} idle</span>
    <span className="status-item stopped">- {counts.stopped} stopped</span>
    <span className="status-item error">! {counts.error} errors</span>
  </div>
  <div className="status-right">
    {getContextShortcuts().map((shortcut, i) => (
      <span key={i} className="status-shortcut">
        <kbd>{shortcut.key}</kbd> {shortcut.label}
      </span>
    ))}
  </div>
</footer>
```

**Step 3: Add CSS for status bar layout**

```css
.status-bar {
  grid-column: 1 / 3;
  background: #1e1e1e;
  border-top: 1px solid #3c3c3c;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 12px;
  font-size: 12px;
  color: #888;
}

.status-left {
  display: flex;
  gap: 16px;
}

.status-right {
  display: flex;
  gap: 16px;
}

.status-shortcut {
  display: flex;
  align-items: center;
  gap: 4px;
}

.status-shortcut kbd {
  background: #3c3c3c;
  padding: 1px 4px;
  border-radius: 2px;
  font-family: inherit;
  font-size: 11px;
}
```

**Step 4: Test status bar**

1. Focus sidebar - verify sidebar shortcuts shown
2. Focus terminal - verify terminal shortcuts shown
3. Verify layout is balanced

**Step 5: Commit**

```bash
git add src/renderer/App.tsx src/renderer/styles/global.css
git commit -m "feat: add context-aware shortcuts to status bar

- Show sidebar shortcuts when sidebar focused
- Show terminal shortcuts otherwise
- Styled with kbd elements"
```

---

## Task 10: Remove Session Path Label

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles/global.css`

**Step 1: Remove session-dir from session JSX**

In App.tsx, find the session-info div (around line 441-474) and remove the session-dir span:

```typescript
// DELETE these lines:
<span className="session-dir" title={session.workingDir}>
  {session.workingDir.split('/').pop() || session.workingDir}
</span>
```

**Step 2: Update session-info CSS**

```css
.session-info {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

Remove `.session-dir` styles (lines 268-274).

**Step 3: Commit**

```bash
git add src/renderer/App.tsx src/renderer/styles/global.css
git commit -m "refactor: remove path label from session list

Path is now shown in the terminal header bar instead."
```

---

## Task 11: Add Folder Path Prompt When Creating Group

**Files:**
- Modify: `src/renderer/App.tsx`

**Step 1: Update handleCreateGroup**

```typescript
const handleCreateGroup = async () => {
  const name = `Group ${groups.filter(g => !g.parentId).length + 1}`;

  // Prompt for directory (optional)
  const dir = await window.electronAPI.selectDirectory();

  // Create group (store will use empty string if dir is null)
  const id = await createGroup(name);

  // If directory was selected, update the group
  if (dir && id) {
    await updateGroup(id, { workingDir: dir });
  }
};
```

Note: This requires createGroup to return the new group ID. Update store if needed.

**Step 2: Update handleNewGroup keyboard handler similarly**

**Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: prompt for folder path when creating group

- Show folder picker after creating group
- User can cancel to skip setting path"
```

---

## Task 12: Clean Up Highlander References

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `src/renderer/splash.html`
- Modify: `src/renderer/about.html`
- Modify: `build/icon.svg`

**Step 1: Update package.json description**

```json
"description": "Cross-platform Claude Code session manager",
```

**Step 2: Update README.md**

Replace Highlander-themed content with professional alternatives:

- Remove hero image reference
- Change "THERE CAN BE ONLY ONE" to "Unified Session Management"
- Change "The Quickening" to "Real-Time Status"
- Remove "immortal" references
- Remove movie quotes
- Keep professional feature descriptions

**Step 3: Update splash.html**

Remove or replace:
- highlander-hero.png image
- "There Can Be Only One!" tagline

Replace with:
```html
<p class="tagline">Unified Claude Code Session Manager</p>
```

**Step 4: Update about.html**

Remove:
- highlander-hero.png image
- "I am Immortal" text
- "there can be only one... session manager" quote
- "THERE CAN BE ONLY ONE!" tagline

Replace with professional content:
```html
<p>Claudelander - Cross-platform Claude Code session manager</p>
```

**Step 5: Update icon.svg comment**

Remove "Highlander sword" comment, replace with neutral description.

**Step 6: Commit**

```bash
git add package.json README.md src/renderer/splash.html src/renderer/about.html build/icon.svg
git commit -m "refactor: remove Highlander movie references

Replace movie-themed content with professional descriptions
while keeping the Claudelander name."
```

---

## Final Task: Version Bump and Testing

**Step 1: Update version in package.json**

```json
"version": "1.2.0"
```

**Step 2: Full test pass**

1. `npm run build`
2. `npm start`
3. Test all features:
   - [ ] Terminal sizing on session switch
   - [ ] Create/collapse groups
   - [ ] Create sub-groups
   - [ ] Keyboard navigation (Ctrl+Q, arrows, Enter)
   - [ ] Ctrl+G new group with folder prompt
   - [ ] Terminal header with actions
   - [ ] Context-aware status bar shortcuts
   - [ ] No path under sessions
   - [ ] No Highlander references in UI

**Step 3: Final commit**

```bash
git add package.json
git commit -m "chore: bump version to 1.2.0"
```

---

## Summary

| Task | Feature | Est. Complexity |
|------|---------|-----------------|
| 1 | Fix terminal squished | Low |
| 2 | Database migration | Low |
| 3 | Groups store update | Medium |
| 4 | Collapsible groups UI | Medium |
| 5 | Sub-groups UI | High |
| 6 | Focus tracking state | Low |
| 7 | Keyboard navigation | High |
| 8 | Terminal header | Medium |
| 9 | Status bar shortcuts | Low |
| 10 | Remove session path | Low |
| 11 | Folder prompt on create | Low |
| 12 | Highlander cleanup | Low |
