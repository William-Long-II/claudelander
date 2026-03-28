# Session Claude Config Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add per-session, per-group, and global default controls for Claude CLI configuration (model, effort, permission mode, budget, system prompt, tool restrictions) with a settings bar in the chat header.

**Architecture:** ClaudeConfig stored as JSON blob in DB columns on sessions/groups tables and in preferences. Resolved at spawn time via a 3-tier cascade: global defaults → group defaults → session overrides. A new SessionSettingsBar component in ChatContainer exposes the controls.

**Tech Stack:** TypeScript, React, Electron IPC, better-sqlite3, existing CSS dark theme

---

### Task 1: Add ClaudeConfig Type

**Files:**
- Modify: `src/shared/types.ts:1-13` (Session interface), `src/shared/types.ts:15-24` (Group interface)

**Step 1: Add the ClaudeConfig interface and update Session/Group types**

Add after the `SessionState` type (line 1) and before the `Session` interface:

```typescript
export interface ClaudeConfig {
  model?: string;
  effort?: string;
  permissionMode?: string;
  maxBudgetUsd?: number;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
}
```

Add `claudeConfig?: ClaudeConfig` to the `Session` interface (after `lastActivityAt`) and to the `Group` interface (after `collapsed`).

**Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add ClaudeConfig type to Session and Group interfaces"
```

---

### Task 2: Database Migrations

**Files:**
- Modify: `src/main/database.ts:116-130` (migration section)

**Step 1: Add claude_config column migrations**

Add after the existing `collapsed` migration block (after line 130):

```typescript
// Migration: Add claude_config column to sessions if it doesn't exist
const sessionColumns = database.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
if (!sessionColumns.some(col => col.name === 'claude_config')) {
  database.exec("ALTER TABLE sessions ADD COLUMN claude_config TEXT");
}

// Migration: Add claude_config column to groups if it doesn't exist
if (!columns.some(col => col.name === 'claude_config')) {
  database.exec("ALTER TABLE groups ADD COLUMN claude_config TEXT");
}
```

Note: `columns` already holds the groups PRAGMA result from line 117.

**Step 2: Run `npm run build:main` to verify compilation**

**Step 3: Commit**

```bash
git add src/main/database.ts
git commit -m "feat: add claude_config column to sessions and groups tables"
```

---

### Task 3: Update Repositories to Parse/Serialize ClaudeConfig

**Files:**
- Modify: `src/main/repositories/sessions.ts` (all functions)
- Modify: `src/main/repositories/groups.ts` (all functions)

**Step 1: Update sessions repository**

In `getAllSessions` (line 8-18), add to the map callback:
```typescript
claudeConfig: row.claude_config ? JSON.parse(row.claude_config) : undefined,
```

In `createSession` (line 21-37), add `claude_config` to the INSERT:
```typescript
// Add to INSERT column list and VALUES
// Serialize: session.claudeConfig ? JSON.stringify(session.claudeConfig) : null
```

In `updateSession` (line 39-69), add handling for `claudeConfig`:
```typescript
if (updates.claudeConfig !== undefined) {
  fields.push('claude_config = ?');
  values.push(updates.claudeConfig ? JSON.stringify(updates.claudeConfig) : null);
}
```

**Step 2: Update groups repository**

In `getAllGroups` (line 4-18), add to the map callback:
```typescript
claudeConfig: row.claude_config ? JSON.parse(row.claude_config) : undefined,
```

In `createGroup` (line 20-35), add `claude_config` column and serialization.

In `updateGroup` (line 37-71), add:
```typescript
if (updates.claudeConfig !== undefined) {
  fields.push('claude_config = ?');
  values.push(updates.claudeConfig ? JSON.stringify(updates.claudeConfig) : null);
}
```

**Step 3: Run `npm run build:main` to verify compilation**

**Step 4: Commit**

```bash
git add src/main/repositories/sessions.ts src/main/repositories/groups.ts
git commit -m "feat: parse/serialize ClaudeConfig in session and group repositories"
```

---

### Task 4: Config Resolver

**Files:**
- Create: `src/main/claude-config-resolver.ts`

**Step 1: Create the config resolver module**

```typescript
import { ClaudeConfig } from '../shared/types';
import * as sessionsRepo from './repositories/sessions';
import * as groupsRepo from './repositories/groups';
import * as prefsRepo from './repositories/preferences';
import log from 'electron-log';

/**
 * Load global default ClaudeConfig from preferences table.
 */
function getGlobalDefaults(): ClaudeConfig {
  const raw = prefsRepo.getPreference('claude.defaultConfig');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Load group-level ClaudeConfig override.
 */
function getGroupConfig(groupId: string): ClaudeConfig {
  const groups = groupsRepo.getAllGroups();
  const group = groups.find(g => g.id === groupId);
  return group?.claudeConfig || {};
}

/**
 * Resolve the final ClaudeConfig for a session by merging:
 * global defaults → group defaults → session overrides
 */
export function resolveClaudeConfig(sessionId: string): ClaudeConfig {
  const sessions = sessionsRepo.getAllSessions();
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return getGlobalDefaults();

  const global = getGlobalDefaults();
  const group = session.groupId ? getGroupConfig(session.groupId) : {};
  const sessionConfig = session.claudeConfig || {};

  // Merge: later values override earlier. Only override if defined.
  const merged: ClaudeConfig = { ...global };
  for (const src of [group, sessionConfig]) {
    if (src.model !== undefined) merged.model = src.model;
    if (src.effort !== undefined) merged.effort = src.effort;
    if (src.permissionMode !== undefined) merged.permissionMode = src.permissionMode;
    if (src.maxBudgetUsd !== undefined) merged.maxBudgetUsd = src.maxBudgetUsd;
    if (src.systemPrompt !== undefined) merged.systemPrompt = src.systemPrompt;
    if (src.allowedTools !== undefined) merged.allowedTools = src.allowedTools;
    if (src.disallowedTools !== undefined) merged.disallowedTools = src.disallowedTools;
  }

  log.info(`[ClaudeConfig] Resolved for session ${sessionId}:`, JSON.stringify(merged));
  return merged;
}

/**
 * Convert a resolved ClaudeConfig into CLI flag array for claude -p.
 */
export function configToCliArgs(config: ClaudeConfig): string[] {
  const args: string[] = [];

  if (config.model) {
    args.push('--model', config.model);
  }
  if (config.effort) {
    args.push('--effort', config.effort);
  }
  if (config.permissionMode) {
    args.push('--permission-mode', config.permissionMode);
  }
  if (config.maxBudgetUsd !== undefined && config.maxBudgetUsd > 0) {
    args.push('--max-budget-usd', String(config.maxBudgetUsd));
  }
  if (config.systemPrompt) {
    args.push('--append-system-prompt', config.systemPrompt);
  }
  if (config.allowedTools && config.allowedTools.length > 0) {
    args.push('--allowedTools', ...config.allowedTools);
  }
  if (config.disallowedTools && config.disallowedTools.length > 0) {
    args.push('--disallowedTools', ...config.disallowedTools);
  }

  return args;
}
```

**Step 2: Run `npm run build:main` to verify compilation**

**Step 3: Commit**

```bash
git add src/main/claude-config-resolver.ts
git commit -m "feat: add ClaudeConfig resolver with 3-tier cascade and CLI arg mapping"
```

---

### Task 5: Update Session Manager to Use ClaudeConfig

**Files:**
- Modify: `src/main/claude-session-manager.ts:46-75` (startSession options), `src/main/claude-session-manager.ts:153-173` (sendMessage)

**Step 1: Import and use configToCliArgs**

Add import at top:
```typescript
import { configToCliArgs } from './claude-config-resolver';
import { ClaudeConfig } from '../shared/types';
```

Change `startSession` options parameter from the current individual fields to:
```typescript
options?: {
  groupId?: string;
  claudeConfig?: ClaudeConfig;
}
```

Replace the individual flag-building logic (lines 64-74) with:
```typescript
// Apply resolved Claude config as CLI flags
if (options?.claudeConfig) {
  args.push(...configToCliArgs(options.claudeConfig));
}
```

**Step 2: Update sendMessage to accept and apply config**

Change `sendMessage` signature to:
```typescript
sendMessage(sessionId: string, prompt: string, claudeConfig?: ClaudeConfig): void
```

After the `--resume` args (line 171), add:
```typescript
if (claudeConfig) {
  args.push(...configToCliArgs(claudeConfig));
}
```

**Step 3: Run `npm run build:main` to verify compilation**

**Step 4: Commit**

```bash
git add src/main/claude-session-manager.ts
git commit -m "feat: session manager accepts ClaudeConfig and maps to CLI flags"
```

---

### Task 6: Update IPC Handlers and Preload

**Files:**
- Modify: `src/main/index.ts:453-469` (claude:start and claude:send handlers)
- Modify: `src/main/preload.ts:317-328` (Claude session API section)
- Modify: `src/renderer/types/electron.d.ts` (type declarations)

**Step 1: Update claude:start IPC handler**

In `src/main/index.ts`, update the `claude:start` handler (line 453) to resolve config:

```typescript
safeHandle('claude:start', async (sessionId: string, cwd: string, prompt: string, options?: any) => {
  log.info(`[ClaudeSession IPC] claude:start called — session=${sessionId}, cwd=${cwd}, prompt=${prompt.substring(0, 50)}`);
  const sessions = sessionsRepo.getAllSessions();
  const session = sessions.find(s => s.id === sessionId);
  const groupId = session?.groupId || null;

  // Resolve the 3-tier config cascade
  const resolvedConfig = resolveClaudeConfig(sessionId);

  claudeSessionManager.startSession(sessionId, cwd, prompt, {
    groupId,
    claudeConfig: resolvedConfig,
  });

  soundManager.playStartSound();
});
```

Add import at top of index.ts:
```typescript
import { resolveClaudeConfig } from './claude-config-resolver';
```

**Step 2: Update claude:send IPC handler**

```typescript
safeHandle('claude:send', (sessionId: string, prompt: string) => {
  const resolvedConfig = resolveClaudeConfig(sessionId);
  claudeSessionManager.sendMessage(sessionId, prompt, resolvedConfig);
});
```

**Step 3: Add claude:getResolvedConfig handler**

```typescript
safeHandle('claude:getResolvedConfig', (sessionId: string) => {
  return resolveClaudeConfig(sessionId);
});
```

**Step 4: Update preload.ts**

Add to the Claude Session API section (after line 328):
```typescript
claudeGetResolvedConfig: (sessionId: string) =>
  ipcRenderer.invoke('claude:getResolvedConfig', sessionId),
```

**Step 5: Update electron.d.ts**

Add the new method to the electronAPI interface and add ClaudeConfig import type.

**Step 6: Run `npm run build:main` to verify compilation**

**Step 7: Commit**

```bash
git add src/main/index.ts src/main/preload.ts src/renderer/types/electron.d.ts
git commit -m "feat: wire up ClaudeConfig through IPC with 3-tier resolution"
```

---

### Task 7: Create SessionSettingsBar Component

**Files:**
- Create: `src/renderer/components/chat/SessionSettingsBar.tsx`

**Step 1: Create the component**

```tsx
import React, { useState } from 'react';
import { ClaudeConfig } from '../../../shared/types';

interface Props {
  config: ClaudeConfig;
  onChange: (config: ClaudeConfig) => void;
  disabled?: boolean;
}

const MODEL_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'haiku', label: 'Haiku' },
];

const EFFORT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
];

const PERMISSION_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'plan', label: 'Plan' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'auto', label: 'Auto' },
];

export const SessionSettingsBar: React.FC<Props> = ({ config, onChange, disabled }) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customModel, setCustomModel] = useState('');
  const [showCustomModel, setShowCustomModel] = useState(false);

  const update = (partial: Partial<ClaudeConfig>) => {
    onChange({ ...config, ...partial });
  };

  const isModelPreset = MODEL_OPTIONS.some(o => o.value === (config.model || ''));

  return (
    <div className="session-settings-bar">
      <div className="settings-bar-primary">
        {/* Model picker */}
        <div className="settings-bar-field">
          <label>Model</label>
          {showCustomModel ? (
            <input
              type="text"
              className="settings-bar-input"
              value={config.model || ''}
              onChange={e => update({ model: e.target.value || undefined })}
              onBlur={() => { if (!config.model) setShowCustomModel(false); }}
              placeholder="e.g. claude-sonnet-4-6"
              disabled={disabled}
              autoFocus
            />
          ) : (
            <select
              className="settings-bar-select"
              value={isModelPreset ? (config.model || '') : '__custom__'}
              onChange={e => {
                if (e.target.value === '__custom__') {
                  setShowCustomModel(true);
                } else {
                  update({ model: e.target.value || undefined });
                }
              }}
              disabled={disabled}
            >
              {MODEL_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
              <option value="__custom__">Custom...</option>
            </select>
          )}
        </div>

        {/* Effort selector */}
        <div className="settings-bar-field">
          <label>Effort</label>
          <div className="settings-bar-segmented">
            {EFFORT_OPTIONS.map(o => (
              <button
                key={o.value}
                className={`segmented-btn ${(config.effort || '') === o.value ? 'active' : ''}`}
                onClick={() => update({ effort: o.value || undefined })}
                disabled={disabled}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Permission picker */}
        <div className="settings-bar-field">
          <label>Permissions</label>
          <select
            className="settings-bar-select"
            value={config.permissionMode || ''}
            onChange={e => update({ permissionMode: e.target.value || undefined })}
            disabled={disabled}
          >
            {PERMISSION_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Advanced toggle */}
        <button
          className={`settings-bar-advanced-toggle ${showAdvanced ? 'open' : ''}`}
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          Advanced {showAdvanced ? '▾' : '▸'}
        </button>
      </div>

      {showAdvanced && (
        <div className="settings-bar-advanced">
          {/* Budget */}
          <div className="settings-bar-field">
            <label>Budget</label>
            <div className="budget-input-wrapper">
              <span className="budget-prefix">$</span>
              <input
                type="number"
                className="settings-bar-input budget-input"
                value={config.maxBudgetUsd ?? ''}
                onChange={e => update({ maxBudgetUsd: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="No limit"
                min="0"
                step="0.5"
                disabled={disabled}
              />
            </div>
          </div>

          {/* System Prompt */}
          <div className="settings-bar-field full-width">
            <label>System Prompt</label>
            <textarea
              className="settings-bar-textarea"
              value={config.systemPrompt || ''}
              onChange={e => update({ systemPrompt: e.target.value || undefined })}
              placeholder="Appended to default system prompt..."
              rows={2}
              disabled={disabled}
            />
          </div>

          {/* Allowed Tools */}
          <div className="settings-bar-field">
            <label>Allowed Tools</label>
            <TagInput
              tags={config.allowedTools || []}
              onChange={tags => update({ allowedTools: tags.length > 0 ? tags : undefined })}
              placeholder="Add tool name..."
              disabled={disabled}
            />
          </div>

          {/* Disallowed Tools */}
          <div className="settings-bar-field">
            <label>Disallowed Tools</label>
            <TagInput
              tags={config.disallowedTools || []}
              onChange={tags => update({ disallowedTools: tags.length > 0 ? tags : undefined })}
              placeholder="Add tool name..."
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  );
};

/** Simple tag input: type + Enter to add, click × to remove */
const TagInput: React.FC<{
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}> = ({ tags, onChange, placeholder, disabled }) => {
  const [input, setInput] = useState('');

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      if (!tags.includes(input.trim())) {
        onChange([...tags, input.trim()]);
      }
      setInput('');
    }
  };

  return (
    <div className="tag-input-wrapper">
      {tags.map(tag => (
        <span key={tag} className="tag">
          {tag}
          <button className="tag-remove" onClick={() => onChange(tags.filter(t => t !== tag))} disabled={disabled}>×</button>
        </span>
      ))}
      <input
        type="text"
        className="tag-input"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? placeholder : ''}
        disabled={disabled}
      />
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add src/renderer/components/chat/SessionSettingsBar.tsx
git commit -m "feat: add SessionSettingsBar component with model, effort, permission, and advanced controls"
```

---

### Task 8: Add Settings Bar Styles

**Files:**
- Modify: `src/renderer/styles/chat.css` (append at end)

**Step 1: Add the styles**

```css
/* Session Settings Bar */
.session-settings-bar {
  border-bottom: 1px solid #2a2a3e;
  background: rgba(30, 30, 50, 0.5);
  padding: 6px 12px;
  font-size: 0.8rem;
}

.settings-bar-primary {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.settings-bar-field {
  display: flex;
  align-items: center;
  gap: 6px;
}

.settings-bar-field label {
  color: #8080b0;
  font-size: 0.75rem;
  white-space: nowrap;
}

.settings-bar-field.full-width {
  width: 100%;
  flex-direction: column;
  align-items: flex-start;
}

.settings-bar-select {
  background: #1e1e2e;
  color: #ccc;
  border: 1px solid #3b3b5b;
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 0.8rem;
  cursor: pointer;
}

.settings-bar-select:focus {
  border-color: #61afef;
  outline: none;
}

.settings-bar-input {
  background: #1e1e2e;
  color: #ccc;
  border: 1px solid #3b3b5b;
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 0.8rem;
  width: 120px;
}

.settings-bar-input:focus {
  border-color: #61afef;
  outline: none;
}

.settings-bar-textarea {
  background: #1e1e2e;
  color: #ccc;
  border: 1px solid #3b3b5b;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 0.8rem;
  width: 100%;
  resize: vertical;
  font-family: inherit;
}

.settings-bar-textarea:focus {
  border-color: #61afef;
  outline: none;
}

/* Segmented button group */
.settings-bar-segmented {
  display: flex;
  border: 1px solid #3b3b5b;
  border-radius: 4px;
  overflow: hidden;
}

.segmented-btn {
  background: #1e1e2e;
  color: #888;
  border: none;
  border-right: 1px solid #3b3b5b;
  padding: 3px 8px;
  font-size: 0.75rem;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.segmented-btn:last-child {
  border-right: none;
}

.segmented-btn:hover {
  background: #2a2a3e;
  color: #ccc;
}

.segmented-btn.active {
  background: #3b3b5b;
  color: #61afef;
}

/* Advanced toggle */
.settings-bar-advanced-toggle {
  background: none;
  border: none;
  color: #666;
  font-size: 0.75rem;
  cursor: pointer;
  margin-left: auto;
  padding: 2px 6px;
}

.settings-bar-advanced-toggle:hover {
  color: #aaa;
}

.settings-bar-advanced-toggle.open {
  color: #61afef;
}

/* Advanced section */
.settings-bar-advanced {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 8px;
  margin-top: 6px;
  border-top: 1px solid #2a2a3e;
}

/* Budget input */
.budget-input-wrapper {
  display: flex;
  align-items: center;
  gap: 2px;
}

.budget-prefix {
  color: #666;
  font-size: 0.8rem;
}

.budget-input {
  width: 70px;
}

/* Tag input */
.tag-input-wrapper {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  background: #1e1e2e;
  border: 1px solid #3b3b5b;
  border-radius: 4px;
  padding: 3px 6px;
  min-width: 150px;
  align-items: center;
}

.tag-input-wrapper:focus-within {
  border-color: #61afef;
}

.tag {
  display: flex;
  align-items: center;
  gap: 2px;
  background: #3b3b5b;
  color: #ccc;
  border-radius: 3px;
  padding: 1px 6px;
  font-size: 0.75rem;
}

.tag-remove {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 0 2px;
  font-size: 0.85rem;
  line-height: 1;
}

.tag-remove:hover {
  color: #e06c75;
}

.tag-input {
  background: none;
  border: none;
  color: #ccc;
  font-size: 0.8rem;
  outline: none;
  flex: 1;
  min-width: 80px;
  padding: 0;
}
```

**Step 2: Commit**

```bash
git add src/renderer/styles/chat.css
git commit -m "feat: add SessionSettingsBar styles matching dark theme"
```

---

### Task 9: Integrate Settings Bar into ChatContainer

**Files:**
- Modify: `src/renderer/components/chat/ChatContainer.tsx`

**Step 1: Update ChatContainer**

Add `claudeConfig` and `onConfigChange` to Props:
```typescript
interface Props {
  sessionId: string | null;
  sessionName: string;
  workingDir: string;
  claudeConfig?: ClaudeConfig;
  onConfigChange?: (config: ClaudeConfig) => void;
}
```

Import and mount `SessionSettingsBar` between the chat-header div and chat-messages div:
```tsx
import { SessionSettingsBar } from './SessionSettingsBar';
import { ClaudeConfig } from '../../../shared/types';

// In the JSX, after </div> closing chat-header, before <div className="chat-messages">:
<SessionSettingsBar
  config={claudeConfig || {}}
  onChange={(config) => onConfigChange?.(config)}
  disabled={isRunning}
/>
```

**Step 2: Update App.tsx to pass config props**

In `src/renderer/App.tsx`, find the ChatContainer mount (around line 1370):
```tsx
<ChatContainer
  sessionId={session.id}
  sessionName={session.name}
  workingDir={session.workingDir}
  claudeConfig={session.claudeConfig}
  onConfigChange={(config) => updateSession(session.id, { claudeConfig: config })}
/>
```

**Step 3: Run `npm run build` to verify full compilation**

**Step 4: Commit**

```bash
git add src/renderer/components/chat/ChatContainer.tsx src/renderer/App.tsx
git commit -m "feat: integrate SessionSettingsBar into ChatContainer with config persistence"
```

---

### Task 10: Update useClaudeSession to Pass Config

**Files:**
- Modify: `src/renderer/hooks/useClaudeSession.ts:147-180` (sendMessage)

**Step 1: Remove config passing from hook**

The config is now resolved server-side in the IPC handler using `resolveClaudeConfig(sessionId)`. The renderer doesn't need to pass config — it just calls `claudeStart` and `claudeSend` as before. The IPC handlers (updated in Task 6) read the session's config from the DB.

No code changes needed in the hook — the config flows through the DB → IPC handler → resolver → session manager automatically.

**Step 2: Verify the flow**

1. User changes model in SessionSettingsBar → `onConfigChange` → `updateSession(id, { claudeConfig })` → saves to DB
2. User sends message → `claudeStart`/`claudeSend` IPC → handler calls `resolveClaudeConfig(sessionId)` → reads DB → merges cascade → passes to session manager → CLI flags

**Step 3: Commit** (skip if no changes needed)

---

### Task 11: Settings Modal — Claude Defaults Tab

**Files:**
- Modify: `src/renderer/components/SettingsModal.tsx`

**Step 1: Add a "Claude" tab to the settings nav**

Add a new tab button after the existing tabs (around line 495):
```tsx
<button
  className={`settings-nav-item ${activeTab === 'claude' ? 'active' : ''}`}
  onClick={() => setActiveTab('claude')}
>Claude</button>
```

**Step 2: Add the Claude defaults section**

Add after the last `activeTab` conditional block:
```tsx
{activeTab === 'claude' && (
  <div className="settings-section">
    <h3>Claude Defaults</h3>
    <p className="settings-hint">Default settings for new sessions. Groups and sessions can override these.</p>
    <SessionSettingsBar
      config={claudeDefaults}
      onChange={handleClaudeDefaultsChange}
    />
  </div>
)}
```

**Step 3: Add state and handler**

At the top of the SettingsModal component, add state for claude defaults:
```typescript
const [claudeDefaults, setClaudeDefaults] = useState<ClaudeConfig>({});

// Load on mount
useEffect(() => {
  window.electronAPI.getPreference('claude.defaultConfig').then(raw => {
    if (raw) {
      try { setClaudeDefaults(JSON.parse(raw)); } catch {}
    }
  });
}, []);

const handleClaudeDefaultsChange = (config: ClaudeConfig) => {
  setClaudeDefaults(config);
  window.electronAPI.setPreference('claude.defaultConfig', JSON.stringify(config));
};
```

Import `SessionSettingsBar` and `ClaudeConfig` at top.

**Step 4: Run `npm run build` to verify compilation**

**Step 5: Commit**

```bash
git add src/renderer/components/SettingsModal.tsx
git commit -m "feat: add Claude Defaults tab to settings modal"
```

---

### Task 12: Group-Level Config Override

**Files:**
- Modify: `src/renderer/App.tsx` (group header area)

**Step 1: Add gear icon to group header**

Find the group header rendering in App.tsx (search for group name rendering near the `+` button). Add a gear icon button:

```tsx
<button
  className="group-config-btn"
  title="Claude settings for this group"
  onClick={(e) => {
    e.stopPropagation();
    setConfigGroupId(configGroupId === group.id ? null : group.id);
  }}
>⚙</button>
```

**Step 2: Add config popover**

Add state: `const [configGroupId, setConfigGroupId] = useState<string | null>(null);`

Below the gear button, render a popover when active:
```tsx
{configGroupId === group.id && (
  <div className="group-config-popover" onClick={e => e.stopPropagation()}>
    <h4>Claude Settings — {group.name}</h4>
    <SessionSettingsBar
      config={group.claudeConfig || {}}
      onChange={(config) => {
        updateGroup(group.id, { claudeConfig: config });
        setConfigGroupId(null);
      }}
    />
  </div>
)}
```

**Step 3: Add popover styles**

Add to `src/renderer/styles/global.css`:
```css
.group-config-btn {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  padding: 0 4px;
  font-size: 0.85rem;
}

.group-config-btn:hover {
  color: #aaa;
}

.group-config-popover {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 100;
  background: #1e1e2e;
  border: 1px solid #3b3b5b;
  border-radius: 6px;
  padding: 10px;
  min-width: 400px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
}

.group-config-popover h4 {
  margin: 0 0 8px 0;
  color: #ccc;
  font-size: 0.85rem;
}
```

**Step 4: Update the groups store `updateGroup` to handle `claudeConfig`**

Verify the App.tsx `updateGroup` function passes the update through to `db:groups:update` IPC which hits the groups repository (already updated in Task 3).

**Step 5: Run `npm run build` to verify full compilation**

**Step 6: Commit**

```bash
git add src/renderer/App.tsx src/renderer/styles/global.css
git commit -m "feat: add group-level Claude config popover with gear icon"
```

---

### Task 13: Update Renderer Sessions Store for ClaudeConfig

**Files:**
- Modify: `src/renderer/store/sessions.ts`

**Step 1: Ensure createSession includes claudeConfig**

In the `createSession` callback, add `claudeConfig` to the session object if it should inherit from defaults. For now, new sessions start with `claudeConfig: undefined` (inherits from cascade). No changes needed unless we want to pre-populate — the cascade handles it.

Verify the `updateSession` function can handle `claudeConfig` in the updates partial — it already uses `Partial<Session>` so it should work with no changes since Task 1 added the field to the Session type.

**Step 2: Commit** (skip if no changes needed)

---

### Task 14: Final Integration Test

**Step 1: Run full build**

```bash
npm run build
```

**Step 2: Manual test checklist**

1. Start the app — verify no migration errors in console
2. Open settings → Claude tab → set model to "opus" → close settings
3. Create a new session → settings bar should show "Default" (inherits opus from global)
4. Send a message → check console logs for `[ClaudeConfig] Resolved` showing model: "opus"
5. Change session model to "haiku" in the settings bar
6. Send another message → console should show model: "haiku" (session override)
7. Click gear on group → set effort to "high" → close popover
8. Create new session in that group → send message → should use opus + high effort
9. Expand Advanced → set budget to $1 → add disallowed tool "Write"
10. Send message → console should show `--max-budget-usd 1 --disallowedTools Write`

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: session Claude config — settings bar, defaults cascade, group overrides"
```
