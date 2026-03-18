# Security & UX Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Address all security vulnerabilities, accessibility gaps, and UX issues identified in the comprehensive codebase audit before proceeding with 2.0 features.

**Architecture:** Changes are organized into 8 phases targeting security (phases 1-3), code quality (phase 4), accessibility (phases 5-6), error handling (phase 7), and UI consistency (phase 8). Each phase is independently committable. No new dependencies are introduced except `focus-trap-react` for modal accessibility.

**Tech Stack:** Electron 39, React, TypeScript (strict), better-sqlite3, node-pty, sodium-native, xterm.js

**Pre-existing (already addressed - DO NOT re-implement):**
- Global error handlers exist (index.ts:27-38)
- WAL mode enabled (database.ts:20)
- autoDownload = false (auto-updater.ts:10)
- strict: true in tsconfig.json
- Preload uses explicit IPC wrappers, NOT raw ipcRenderer
- All IPC listeners return cleanup functions
- Release workflow uses windows-latest for Windows builds
- Default group created on first run
- Nonce generation uses sodium.randombytes_buf (sharing/crypto.ts:58)

---

## Phase 1: Security Critical — Input Validation & Injection Prevention

### Task 1.1: Validate URLs in shell:openExternal

**Files:**
- Modify: `src/main/index.ts:744-746`

**Implementation:**
Replace the unvalidated `shell.openExternal` call with protocol validation:

```typescript
ipcMain.handle('shell:openExternal', (_, url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      log.warn('[Main] Blocked shell:openExternal for non-HTTP URL:', url);
      return;
    }
    shell.openExternal(url);
  } catch {
    log.warn('[Main] Invalid URL passed to shell:openExternal:', url);
  }
});
```

**Verify:** Search codebase for `openExternal` calls in renderer to confirm all use `https://` URLs.

---

### Task 1.2: Sanitize file paths in editor launcher

**Files:**
- Modify: `src/main/editor-launcher.ts:180-188`

**Implementation:**
After the `path.resolve()` on line 136, add shell metacharacter rejection before the `spawn` call:

```typescript
// After line 136: const normalizedPath = path.resolve(filePath);
// Add validation for Windows shell metacharacters
if (process.platform === 'win32' && /[&|><^]/.test(normalizedPath)) {
  return { success: false, error: 'Invalid characters in file path' };
}
```

---

### Task 1.3: Replace execSync with execFileSync for WSL detection

**Files:**
- Modify: `src/main/shell-detector.ts:51-55`

**Implementation:**
Replace the shell-interpolated `execSync` call:

```typescript
// Before (line 51):
// execSync(`wsl.exe -d "${distros[0]}" echo ok`, { ... });

// After:
import { execFileSync } from 'child_process';
execFileSync('wsl.exe', ['-d', distros[0], 'echo', 'ok'], {
  encoding: 'utf-8',
  timeout: 5000,
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

Check the existing import at the top of the file — it likely already imports `execSync` from `child_process`. Add `execFileSync` to that import.

---

### Task 1.4: Commit Phase 1

```
git add src/main/index.ts src/main/editor-launcher.ts src/main/shell-detector.ts
git commit -m "security: validate URLs, sanitize editor paths, fix WSL command injection"
```

---

## Phase 2: Security Medium — CSP, Network Binding, CORS

### Task 2.1: Add lang="en" and CSP to all HTML files

**Files:**
- Modify: `src/renderer/index.html:2` — add `lang="en"`
- Modify: `src/renderer/about.html:2` — add `lang="en"` and CSP meta tag
- Modify: `src/renderer/splash.html:2` — add `lang="en"`

**index.html (line 2):**
```html
<html lang="en">
```

**about.html (after line 4, before `<title>`):**
```html
<html lang="en">
```
Add CSP after the charset meta:
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'">
```

**splash.html (line 2):**
```html
<html lang="en">
```

---

### Task 2.2: Bind API server to 127.0.0.1 by default

**Files:**
- Modify: `src/main/api/index.ts:33-37`

**Implementation:**
Change the default bind address. The server should only bind to all interfaces when explicitly configured:

```typescript
const DEFAULT_CONFIG: ApiServerConfig = {
  port: 8443,
  bindAddress: '127.0.0.1',  // Was '0.0.0.0' — only bind to all interfaces when user enables mobile
  enableMdns: true,
};
```

Then in the `start()` method, when mobile/remote features are enabled, allow overriding to `0.0.0.0`. Check how the API server is started from `index.ts` IPC handlers — the `api:start` handler may already pass config overrides.

---

### Task 2.3: Restrict CORS to not reflect all origins

**Files:**
- Modify: `src/main/api/http-server.ts:95-101`

**Implementation:**
Replace `origin: true` with a function that only allows known origins:

```typescript
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin, mobile apps, curl)
    if (!origin) return callback(null, true);
    // Block cross-origin requests from browsers
    callback(new Error('CORS not allowed'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
```

---

### Task 2.4: Mask pairing code in logs

**Files:**
- Modify: `src/main/api/pairing/pairing-manager.ts:89`

**Implementation:**
```typescript
// Before:
// log.info(`[PairingManager] Generated pairing code: ${code} (expires in ${PAIRING_CODE_EXPIRY_MS / 1000}s)`);

// After:
log.info(`[PairingManager] Generated pairing code (expires in ${PAIRING_CODE_EXPIRY_MS / 1000}s)`);
```

---

### Task 2.5: Commit Phase 2

```
git add src/renderer/index.html src/renderer/about.html src/renderer/splash.html \
  src/main/api/index.ts src/main/api/http-server.ts src/main/api/pairing/pairing-manager.ts
git commit -m "security: add CSP/lang to HTML, restrict API binding and CORS, mask pairing code"
```

---

## Phase 3: Security — Data Handling & Auth Hardening

### Task 3.1: Escape LIKE wildcards in search queries

**Files:**
- Modify: `src/main/repositories/memories.ts:144-145`
- Modify: `src/main/repositories/code-search.ts:327`

**Implementation:**
Add a helper function (can be placed in either file or a shared utils):

In `memories.ts`, before `searchMemories`:
```typescript
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}
```

Then at line 145:
```typescript
const likeQuery = `%${escapeLike(query)}%`;
```

And add `ESCAPE '\\'` to the SQL:
```typescript
let sql = "SELECT * FROM memories WHERE content LIKE ? ESCAPE '\\\\'";
```

In `code-search.ts` at line 327:
```typescript
const params: any[] = [indexId, `%${escapeLike(name)}%`];
```
And update the query to include `ESCAPE '\\\\'` after the LIKE clause.

---

### Task 3.2: Add OAuth state parameter to deep link handling

**Files:**
- Modify: `src/main/index.ts:98-129` (handleDeepLink)
- Modify: `src/main/sharing/auth.ts` (login method — add state generation)

**Implementation:**
Add a module-level state map for pending OAuth flows:

```typescript
// Near top of index.ts (after imports)
const pendingOAuthStates = new Map<string, { type: string; timestamp: number }>();
```

In the `auth:login` handler, generate and store a state:
```typescript
import { randomBytes } from 'crypto';
// When initiating login:
const state = randomBytes(16).toString('hex');
pendingOAuthStates.set(state, { type: 'sharing', timestamp: Date.now() });
// Pass state to the auth URL
```

In `handleDeepLink`, validate the state:
```typescript
const state = parsed.searchParams.get('state');
if (state && !pendingOAuthStates.has(state)) {
  log.warn('[Main] OAuth callback with invalid state parameter');
  return;
}
if (state) pendingOAuthStates.delete(state);
```

**Note:** This requires checking how `authService.login()` constructs the OAuth URL to add the state parameter. If the relay server doesn't support state pass-through, this may need to be coordinated.

---

### Task 3.3: Enable foreign_keys pragma

**Files:**
- Modify: `src/main/database.ts:20` (after the WAL pragma)

**Implementation:**
```typescript
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
```

**Verify:** Check that existing `ON DELETE CASCADE` constraints in the schema are correct before enabling this.

---

### Task 3.4: Commit Phase 3

```
git add src/main/repositories/memories.ts src/main/repositories/code-search.ts \
  src/main/index.ts src/main/sharing/auth.ts src/main/database.ts
git commit -m "security: escape LIKE wildcards, add OAuth state validation, enable foreign keys"
```

---

## Phase 4: Code Quality — Error Handling & Resource Management

### Task 4.1: Wrap IPC handlers in try/catch with logging

**Files:**
- Modify: `src/main/index.ts` — all `ipcMain.handle` and `ipcMain.on` bodies

**Implementation:**
Add a `safeHandle` and `safeOn` wrapper near the top (after imports, before the IPC handlers section):

```typescript
function safeHandle(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args);
    } catch (err) {
      log.error(`[IPC] ${channel} failed:`, err);
      throw err;
    }
  });
}

function safeOn(channel: string, handler: (event: Electron.IpcMainEvent, ...args: any[]) => void): void {
  ipcMain.on(channel, (event, ...args) => {
    try {
      handler(event, ...args);
    } catch (err) {
      log.error(`[IPC] ${channel} failed:`, err);
    }
  });
}
```

Then replace `ipcMain.handle(` with `safeHandle(` and `ipcMain.on(` with `safeOn(` throughout index.ts. The handler signatures stay the same — just remove the first `event` parameter from the handler since the wrapper provides it.

**Note:** This is a large mechanical change. Do it carefully — some handlers are `async` and some are sync. The `safeHandle` wrapper handles both via `await`.

---

### Task 4.2: Add PTY force-kill timeout on cleanup

**Files:**
- Modify: `src/main/pty-manager.ts` — the `kill` method and the cleanup path

**Implementation:**
In the `kill` method (around line 224), add a timeout guard:

```typescript
async kill(sessionId: string): Promise<void> {
  const session = this.sessions.get(sessionId);
  if (!session) return;

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      // Force kill if graceful kill didn't work within 3 seconds
      try {
        if (process.platform === 'win32' && session.pty.pid) {
          require('child_process').spawn('taskkill', ['/F', '/T', '/PID', String(session.pty.pid)], {
            detached: true,
            stdio: 'ignore',
          });
        }
      } catch { /* ignore */ }
      this.sessions.delete(sessionId);
      resolve();
    }, 3000);

    session.pty.onExit(() => {
      clearTimeout(timeout);
      this.sessions.delete(sessionId);
      resolve();
    });

    try {
      session.pty.kill();
    } catch {
      clearTimeout(timeout);
      this.sessions.delete(sessionId);
      resolve();
    }
  });
}
```

**Note:** Check the existing kill method structure first — it may already handle some of this. Adapt the pattern to match.

---

### Task 4.3: Add async cleanup gate to before-quit

**Files:**
- Modify: `src/main/index.ts:1043-1059`

**Implementation:**
```typescript
let cleanupComplete = false;

app.on('before-quit', (event) => {
  if (cleanupComplete) return;

  event.preventDefault();
  isQuitting = true;

  (async () => {
    try {
      await shareManager.stopAllSharing();
    } catch (e) {
      log.error('Error stopping shares on quit:', e);
    }

    // Kill all PTY sessions with timeout
    try {
      await ptyManager.killAll();
    } catch (e) {
      log.error('Error killing PTYs on quit:', e);
    }

    disposeVectorSearchManager();
    trayManager.destroy();
    stateMonitor?.stop();
    closeDatabase();

    cleanupComplete = true;
    app.quit();
  })();
});
```

**Note:** Check if `ptyManager` has a `killAll` method. If not, add one that iterates all sessions and calls `kill()` with `Promise.all`.

---

### Task 4.4: Redact sensitive env vars in PTY spawn logs

**Files:**
- Modify: `src/main/pty-manager.ts` — anywhere env vars are logged during session creation

**Implementation:**
Search for any `log.*` calls that include `env` or `options` objects. Add redaction:

```typescript
function redactEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  return Object.fromEntries(
    Object.entries(env).map(([k, v]) => [
      k,
      /key|secret|token|password|auth/i.test(k) ? '[REDACTED]' : v,
    ])
  );
}
```

Use `redactEnv(options.env)` in any log output.

---

### Task 4.5: Commit Phase 4

```
git add src/main/index.ts src/main/pty-manager.ts
git commit -m "quality: safe IPC wrappers, PTY force-kill timeout, async cleanup gate, env redaction"
```

---

## Phase 5: Accessibility — HTML & Landmarks

Already done in Task 2.1 (lang="en"). This phase covers React landmarks.

### Task 5.1: Add landmark labels and semantic structure

**Files:**
- Modify: `src/renderer/App.tsx` — the `<aside>` element

**Implementation:**
Find the `<aside className="sidebar"` element and add:
```tsx
<aside className="sidebar" aria-label="Session navigation" ...>
```

---

### Task 5.2: Commit Phase 5

Combined with Phase 6 commit.

---

## Phase 6: Accessibility — Interactive Components

### Task 6.1: Add aria-label to all icon-only buttons

**Files:**
- Modify: `src/renderer/App.tsx` — sidebar header buttons, color picker, session close buttons
- Modify: `src/renderer/components/panels/MemoryPanel.tsx` — pin/edit/delete buttons
- Modify: `src/renderer/components/Terminal.tsx` — context menu buttons, restart/stop/close
- Modify: `src/renderer/components/TerminalHeader.tsx` — any icon buttons

**Implementation:**
Search for all `<button` elements that render single characters or emojis. For each, add `aria-label`:

Examples:
```tsx
// Settings gear
<button aria-label="Settings" title="Settings">⚙</button>

// Memory panel toggle
<button aria-label="Toggle Memory Panel" title="Memory Panel">*</button>

// Code search
<button aria-label="Code Search" title="Code Search">🔍</button>

// New group
<button aria-label="New Group" title="New Group">+</button>

// Session close
<button aria-label="Close Session" title="Close">×</button>

// Color picker options
<button aria-label={`Set color to ${color}`} className="color-option" ...>

// MemoryPanel pin/edit/delete
<button aria-label="Pin memory" title="Pin">!</button>
<button aria-label="Edit memory" title="Edit">/</button>
<button aria-label="Delete memory" title="Delete">x</button>
```

---

### Task 6.2: Add dialog roles and focus management to modals

**Files:**
- Modify: `src/renderer/components/SettingsModal.tsx`
- Modify: `src/renderer/components/ShareModal.tsx`
- Modify: `src/renderer/components/JoinSessionModal.tsx`
- Modify: `src/renderer/components/NamePromptModal.tsx`
- Modify: `src/renderer/components/CodeSearchModal.tsx`

**Implementation:**
For each modal's outermost container div, add:
```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-title-id"
  className="modal-content ..."
>
  <h2 id="modal-title-id">Modal Title</h2>
```

For focus trapping, add an `onKeyDown` handler to each modal:
```tsx
const handleModalKeyDown = useCallback((e: React.KeyboardEvent) => {
  if (e.key === 'Escape') {
    onClose();
    return;
  }
  if (e.key === 'Tab') {
    const modal = e.currentTarget as HTMLElement;
    const focusable = modal.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}, [onClose]);
```

Apply `onKeyDown={handleModalKeyDown}` to the modal container.

---

### Task 6.3: Add ARIA roles to ContextMenu

**Files:**
- Modify: `src/renderer/components/ContextMenu.tsx`

**Implementation:**
```tsx
// Container:
<div role="menu" className="context-menu" ...>

// Each item:
<button role="menuitem" className={...} ...>
```

Add keyboard navigation:
```tsx
const handleKeyDown = (e: React.KeyboardEvent) => {
  const items = containerRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
  if (!items?.length) return;
  const currentIndex = Array.from(items).indexOf(document.activeElement as HTMLElement);

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    items[(currentIndex + 1) % items.length].focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    items[(currentIndex - 1 + items.length) % items.length].focus();
  } else if (e.key === 'Escape') {
    onClose();
  }
};
```

Auto-focus first item on mount:
```tsx
useEffect(() => {
  const firstItem = containerRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
  firstItem?.focus();
}, []);
```

---

### Task 6.4: Add form label associations

**Files:**
- Modify: `src/renderer/components/ShareModal.tsx` — add `htmlFor`/`id` to form controls
- Modify: `src/renderer/components/JoinSessionModal.tsx` — add label to code input

**Implementation:**
In ShareModal, for each `<label>` and `<select>`/`<input>` pair:
```tsx
<label htmlFor="share-permission">Permission</label>
<select id="share-permission" ...>
```

In JoinSessionModal, add a label for the code input:
```tsx
<label htmlFor="join-code" className="sr-only">Session Code</label>
<input id="join-code" ...>
```

Add screen-reader-only class to global.css:
```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

---

### Task 6.5: Commit Phase 6

```
git add src/renderer/App.tsx src/renderer/components/*.tsx \
  src/renderer/components/panels/MemoryPanel.tsx src/renderer/styles/global.css
git commit -m "a11y: aria-labels, dialog roles, focus trapping, keyboard nav, form labels"
```

---

## Phase 7: UX — Error Handling & Destructive Action Confirmation

### Task 7.1: Surface errors in SettingsModal

**Files:**
- Modify: `src/renderer/components/SettingsModal.tsx`

**Implementation:**
Add an error state and banner:
```tsx
const [error, setError] = useState<string | null>(null);

// In each catch block, replace console.error with:
setError(`Failed to ${action}: ${(e as Error).message}`);

// Clear error after 5 seconds:
useEffect(() => {
  if (error) {
    const timer = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(timer);
  }
}, [error]);
```

Add an error banner at the top of the modal body:
```tsx
{error && (
  <div className="settings-error-banner" role="alert">
    {error}
    <button onClick={() => setError(null)} aria-label="Dismiss error">×</button>
  </div>
)}
```

Add CSS for the banner:
```css
.settings-error-banner {
  background: #ff000020;
  border: 1px solid #ff4444;
  color: #ff6b6b;
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}
```

---

### Task 7.2: Add confirmation for destructive actions

**Files:**
- Modify: `src/renderer/App.tsx` — `handleRemoveSession` and `handleDeleteGroup`

**Implementation:**
For session close, add state and a confirm function:
```tsx
const [confirmAction, setConfirmAction] = useState<{
  type: 'closeSession' | 'deleteGroup' | 'stopSharing';
  id: string;
  message: string;
} | null>(null);
```

In `handleRemoveSession`:
```tsx
const handleRemoveSession = useCallback((sessionId: string) => {
  const session = sessions.find(s => s.id === sessionId);
  if (session && (session.state === 'working' || session.state === 'waiting')) {
    setConfirmAction({
      type: 'closeSession',
      id: sessionId,
      message: `This session is ${session.state}. Close it anyway?`,
    });
    return;
  }
  // Proceed with close for idle/stopped sessions
  doRemoveSession(sessionId);
}, [sessions]);
```

Add a simple confirmation dialog component (inline or as a small component):
```tsx
{confirmAction && (
  <div className="modal-overlay" onClick={() => setConfirmAction(null)}>
    <div className="modal-content confirm-dialog" role="alertdialog" aria-modal="true"
         aria-describedby="confirm-message" onClick={e => e.stopPropagation()}>
      <p id="confirm-message">{confirmAction.message}</p>
      <div className="confirm-actions">
        <button className="btn" onClick={() => setConfirmAction(null)}>Cancel</button>
        <button className="btn danger" onClick={() => {
          if (confirmAction.type === 'closeSession') doRemoveSession(confirmAction.id);
          if (confirmAction.type === 'deleteGroup') doDeleteGroup(confirmAction.id);
          setConfirmAction(null);
        }}>Confirm</button>
      </div>
    </div>
  </div>
)}
```

---

### Task 7.3: Improve first-run empty state

**Files:**
- Modify: `src/renderer/App.tsx` — the empty state / "No active session" section

**Implementation:**
Find the empty state that shows when there are no groups/sessions. Replace the disabled "Create Session" button with an onboarding message:

```tsx
{!groups.length ? (
  <div className="empty-state">
    <h2>Welcome to ClaudeLander</h2>
    <p>Create a group to organize your Claude Code sessions.</p>
    <button className="btn primary" onClick={handleCreateGroup}>
      Create Your First Group
    </button>
  </div>
) : (
  <div className="empty-state">
    <p>Select a session or create a new one</p>
    <button className="btn primary" onClick={() => handleNewSession(groups[0]?.id)}
            disabled={!groups.length}>
      Create Session
    </button>
  </div>
)}
```

---

### Task 7.4: Commit Phase 7

```
git add src/renderer/App.tsx src/renderer/components/SettingsModal.tsx \
  src/renderer/styles/global.css
git commit -m "ux: surface errors to users, add destructive action confirmation, improve first-run"
```

---

## Phase 8: UX — Consistency & Polish

### Task 8.1: Consolidate button styles

**Files:**
- Modify: `src/renderer/styles/global.css`

**Implementation:**
Find the two conflicting primary button definitions. Consolidate to a single style using the blue `#007acc` color (consistent with VS Code conventions):

Remove the `.btn.primary` green variant and update all references to use `.btn.primary` with blue styling. Search for any JSX using `className="btn primary"` and ensure consistency.

---

### Task 8.2: Consistent close button character

**Files:**
- Modify: `src/renderer/components/SettingsModal.tsx` — change `x` to `×`
- Modify: `src/renderer/components/JoinSessionModal.tsx` — change `x` to `×`

**Implementation:**
Search for close buttons rendering lowercase `x` and replace with `×` (multiplication sign, `\u00D7`). All close buttons should render `×`.

---

### Task 8.3: Fix settings modal responsive height

**Files:**
- Modify: `src/renderer/styles/global.css` — the `.settings-modal` rule

**Implementation:**
Replace `height: 550px` with:
```css
.settings-modal {
  width: 750px;
  min-height: 400px;
  max-height: 90vh;
}
```

---

### Task 8.4: Dynamic copyright year in about.html

**Files:**
- Modify: `src/renderer/about.html:197`

**Implementation:**
Replace the hardcoded year:
```html
<span style="color: #555;" id="copyright">&copy; 2024-2025</span>
```

Add script at the bottom:
```javascript
document.getElementById('copyright').textContent = `\u00A9 2024-${new Date().getFullYear()}`;
```

---

### Task 8.5: Color picker dismiss on Escape and click-outside

**Files:**
- Modify: `src/renderer/App.tsx` — where `colorPickerGroupId` state is managed

**Implementation:**
Add an effect to handle Escape and click-outside:
```tsx
useEffect(() => {
  if (!colorPickerGroupId) return;

  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setColorPickerGroupId(null);
  };

  const handleClickOutside = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.color-picker') && !target.closest('.color-dot')) {
      setColorPickerGroupId(null);
    }
  };

  document.addEventListener('keydown', handleEscape);
  document.addEventListener('mousedown', handleClickOutside);
  return () => {
    document.removeEventListener('keydown', handleEscape);
    document.removeEventListener('mousedown', handleClickOutside);
  };
}, [colorPickerGroupId]);
```

---

### Task 8.6: Commit Phase 8

```
git add src/renderer/styles/global.css src/renderer/about.html \
  src/renderer/App.tsx src/renderer/components/SettingsModal.tsx \
  src/renderer/components/JoinSessionModal.tsx
git commit -m "ux: consolidate button styles, consistent close chars, responsive modal, polish"
```

---

## Verification

After all phases, run:
1. `npm run build` — ensure no TypeScript errors
2. `npm start` — manual smoke test:
   - Create group, create session, verify terminal works
   - Open settings, trigger errors (e.g., invalid port), verify error banner shows
   - Try close active session — verify confirmation dialog
   - Open about dialog — verify copyright year, CSP works
   - Test keyboard navigation through sidebar and modals
3. Test external URL opening — only http/https should work

---

## Summary

| Phase | Focus | Tasks | Estimated Effort |
|-------|-------|-------|-----------------|
| 1 | Security Critical | 3 fixes | 15 min |
| 2 | Security Network/CSP | 4 fixes | 20 min |
| 3 | Security Data/Auth | 3 fixes | 30 min |
| 4 | Code Quality | 4 fixes | 45 min |
| 5-6 | Accessibility | 5 fixes | 45 min |
| 7 | Error Handling/UX | 3 fixes | 30 min |
| 8 | Consistency/Polish | 5 fixes | 20 min |
| **Total** | | **27 tasks** | **~3.5 hours** |
