# ClaudeLander 3.0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform ClaudeLander from a terminal-based session manager into a chat-first development environment powered by a 3-tier knowledge graph, using Claude Code CLI in JSON output mode as the backend engine.

**Architecture:** Replace node-pty/xterm.js terminal with Claude Code CLI subprocess (`claude -p --output-format stream-json`), rendering structured JSON responses as rich chat UI. Replace flat memories table with a 3-tier knowledge graph (Facts → Patterns → Principles) in SQLite with typed relationships, confidence scoring, and an async promotion engine. Reuse existing ONNX/bge-base embedding infrastructure for knowledge similarity comparisons.

**Tech Stack:** Electron 39, React 19, TypeScript 5.9, better-sqlite3, Claude Code CLI (headless JSON mode), Vitest (new), existing: sodium-native, express, @huggingface/transformers, sqlite-vec, @modelcontextprotocol/sdk

**Design Document:** `docs/plans/2026-03-11-claudelander-3.0-design.md`

---

## Codebase Reference

**Key paths (current 2.x):**
- Main process entry: `src/main/index.ts` (1104 lines)
- PTY manager (TO REMOVE): `src/main/pty-manager.ts` (507 lines)
- Shell detector (TO REMOVE): `src/main/shell-detector.ts`
- State monitor (TO REPLACE): `src/main/state-monitor.ts`
- Claude launcher (TO REPLACE): `src/main/claude-launcher.ts` (101 lines)
- Database: `src/main/database.ts` (300 lines)
- Shared types: `src/shared/types.ts` (288 lines)
- Renderer App: `src/renderer/App.tsx` (~1550 lines)
- Terminal component (TO REMOVE): `src/renderer/components/Terminal.tsx`
- Terminal header (TO REMOVE): `src/renderer/components/TerminalHeader.tsx`
- Remote terminal (TO REMOVE): `src/renderer/components/RemoteTerminal.tsx`
- Memory panel (TO REPLACE): `src/renderer/components/panels/MemoryPanel.tsx`
- MCP server: `src/mcp-server/index.ts` (605 lines)
- Preload: `src/main/preload.ts` (307 lines)
- Memory injector: `src/main/memory/injector.ts`
- Repositories: `src/main/repositories/` (groups, sessions, memories, preferences)
- API routes: `src/main/api/routes/` (8 route files)
- Vector search: `src/main/vector-search/` (6 files)
- Sharing: `src/main/sharing/` (4 files)

**Dependencies to REMOVE:** `node-pty`, `xterm`, `xterm-addon-fit`, `xterm-addon-webgl`
**Dependencies to ADD:** `vitest`, `marked` (markdown rendering), `highlight.js` (syntax highlighting), `diff` (diff rendering)

**Current DB tables:** groups, sessions, preferences, memories, memories_fts, code_indexes, indexed_files, code_chunks, symbols, code_chunks_vec
**New DB tables:** knowledge_nodes, knowledge_edges, knowledge_promotions, knowledge_nodes_fts, chat_messages, session_templates, conversation_branches

---

## Phase 1: Foundation — Test Framework & Database Schema

### Task 1.1: Add Vitest Test Framework

**Files:**
- Create: `vitest.config.ts`
- Create: `src/__tests__/setup.ts`
- Modify: `package.json`
- Create: `src/__tests__/smoke.test.ts`

**Step 1: Install vitest**

Run: `npm install --save-dev vitest @vitest/coverage-v8`
Expected: Package installed successfully

**Step 2: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules', 'dist', 'src/__tests__'],
    },
  },
});
```

**Step 3: Create test setup file**

Create `src/__tests__/setup.ts`:
```typescript
// Global test setup for ClaudeLander
// Mock Electron APIs that aren't available in test environment
import { vi } from 'vitest';

// Mock electron app module
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/claudelander-test'),
    isPackaged: false,
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

// Mock electron-log
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
```

**Step 4: Add test scripts to package.json**

Add to `package.json` scripts:
```json
{
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

**Step 5: Write smoke test**

Create `src/__tests__/smoke.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('Test framework smoke test', () => {
  it('should run a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('should handle async operations', async () => {
    const result = await Promise.resolve('hello');
    expect(result).toBe('hello');
  });
});
```

**Step 6: Run tests to verify framework works**

Run: `npx vitest run`
Expected: 2 tests pass

**Step 7: Commit**

```bash
git add vitest.config.ts src/__tests__/setup.ts src/__tests__/smoke.test.ts package.json package-lock.json
git commit -m "feat: add vitest test framework"
```

---

### Task 1.2: Add Knowledge Graph Database Tables

**Files:**
- Modify: `src/main/database.ts`
- Create: `src/__tests__/database-knowledge.test.ts`

**Step 1: Write failing test for knowledge_nodes table**

Create `src/__tests__/database-knowledge.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// Test with in-memory SQLite (no Electron dependency)
let db: Database.Database;

function initKnowledgeTables(database: Database.Database): void {
  // We'll import and test the actual function once written
  // For now, test the SQL directly
  database.pragma('foreign_keys = ON');

  database.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#888888',
      working_dir TEXT DEFAULT '',
      "order" INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      working_dir TEXT NOT NULL,
      state TEXT DEFAULT 'idle',
      "order" INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Import the function under test
  const { initKnowledgeGraphTables } = require('../main/database-knowledge');
  initKnowledgeGraphTables(database);
}

beforeEach(() => {
  db = new Database(':memory:');
  initKnowledgeTables(db);
});

afterEach(() => {
  db.close();
});

describe('knowledge_nodes table', () => {
  it('should create a tier 1 fact', () => {
    db.prepare(`
      INSERT INTO knowledge_nodes (id, tier, content, source, domains)
      VALUES ('node-1', 1, 'Fixed auth bug with null check', 'auto-extracted', '["auth"]')
    `).run();

    const node = db.prepare('SELECT * FROM knowledge_nodes WHERE id = ?').get('node-1') as any;
    expect(node).toBeDefined();
    expect(node.tier).toBe(1);
    expect(node.confidence).toBe(1.0);
    expect(node.content).toBe('Fixed auth bug with null check');
    expect(JSON.parse(node.domains)).toEqual(['auth']);
  });

  it('should reject invalid tier values', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO knowledge_nodes (id, tier, content, source)
        VALUES ('node-bad', 4, 'Invalid', 'auto-extracted')
      `).run();
    }).toThrow();
  });

  it('should reject invalid source values', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO knowledge_nodes (id, tier, content, source)
        VALUES ('node-bad', 1, 'Invalid', 'invalid-source')
      `).run();
    }).toThrow();
  });

  it('should set default confidence to 1.0', () => {
    db.prepare(`
      INSERT INTO knowledge_nodes (id, tier, content, source)
      VALUES ('node-2', 1, 'Test', 'user-created')
    `).run();
    const node = db.prepare('SELECT confidence FROM knowledge_nodes WHERE id = ?').get('node-2') as any;
    expect(node.confidence).toBe(1.0);
  });

  it('should allow session and group scoping', () => {
    db.prepare(`INSERT INTO groups (id, name) VALUES ('grp-1', 'Test Group')`).run();
    db.prepare(`INSERT INTO sessions (id, group_id, name, working_dir) VALUES ('sess-1', 'grp-1', 'Test', '/tmp')`).run();

    db.prepare(`
      INSERT INTO knowledge_nodes (id, tier, content, source, scope_session_id, scope_group_id)
      VALUES ('node-3', 1, 'Scoped fact', 'auto-extracted', 'sess-1', 'grp-1')
    `).run();

    const node = db.prepare('SELECT scope_session_id, scope_group_id FROM knowledge_nodes WHERE id = ?').get('node-3') as any;
    expect(node.scope_session_id).toBe('sess-1');
    expect(node.scope_group_id).toBe('grp-1');
  });
});

describe('knowledge_edges table', () => {
  beforeEach(() => {
    db.prepare(`INSERT INTO knowledge_nodes (id, tier, content, source) VALUES ('n1', 1, 'Fact A', 'auto-extracted')`).run();
    db.prepare(`INSERT INTO knowledge_nodes (id, tier, content, source) VALUES ('n2', 2, 'Pattern B', 'promoted')`).run();
  });

  it('should create a derived_from edge', () => {
    db.prepare(`
      INSERT INTO knowledge_edges (id, source_id, target_id, relationship)
      VALUES ('e1', 'n1', 'n2', 'derived_from')
    `).run();

    const edge = db.prepare('SELECT * FROM knowledge_edges WHERE id = ?').get('e1') as any;
    expect(edge.relationship).toBe('derived_from');
    expect(edge.weight).toBe(1.0);
  });

  it('should enforce unique constraint on source+target+relationship', () => {
    db.prepare(`
      INSERT INTO knowledge_edges (id, source_id, target_id, relationship)
      VALUES ('e1', 'n1', 'n2', 'supports')
    `).run();

    expect(() => {
      db.prepare(`
        INSERT INTO knowledge_edges (id, source_id, target_id, relationship)
        VALUES ('e2', 'n1', 'n2', 'supports')
      `).run();
    }).toThrow();
  });

  it('should reject invalid relationship types', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO knowledge_edges (id, source_id, target_id, relationship)
        VALUES ('e-bad', 'n1', 'n2', 'invalid_type')
      `).run();
    }).toThrow();
  });

  it('should cascade delete when source node is deleted', () => {
    db.prepare(`
      INSERT INTO knowledge_edges (id, source_id, target_id, relationship)
      VALUES ('e1', 'n1', 'n2', 'derived_from')
    `).run();

    db.prepare('DELETE FROM knowledge_nodes WHERE id = ?').run('n1');

    const edge = db.prepare('SELECT * FROM knowledge_edges WHERE id = ?').get('e1');
    expect(edge).toBeUndefined();
  });
});

describe('knowledge_promotions table', () => {
  it('should log a promotion event', () => {
    db.prepare(`INSERT INTO knowledge_nodes (id, tier, content, source) VALUES ('n1', 2, 'Promoted pattern', 'promoted')`).run();

    db.prepare(`
      INSERT INTO knowledge_promotions (id, node_id, from_tier, to_tier, trigger, evidence)
      VALUES ('p1', 'n1', 1, 2, 'repetition', '["fact-1","fact-2","fact-3"]')
    `).run();

    const promo = db.prepare('SELECT * FROM knowledge_promotions WHERE id = ?').get('p1') as any;
    expect(promo.from_tier).toBe(1);
    expect(promo.to_tier).toBe(2);
    expect(promo.trigger).toBe('repetition');
    expect(JSON.parse(promo.evidence)).toHaveLength(3);
  });
});

describe('chat_messages table', () => {
  it('should store a user message', () => {
    db.prepare(`INSERT INTO groups (id, name) VALUES ('grp-1', 'Test')`).run();
    db.prepare(`INSERT INTO sessions (id, group_id, name, working_dir) VALUES ('sess-1', 'grp-1', 'Test', '/tmp')`).run();

    db.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, message_type)
      VALUES ('msg-1', 'sess-1', 'user', 'Hello Claude', 'text')
    `).run();

    const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get('msg-1') as any;
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello Claude');
    expect(msg.branch_id).toBeNull();
  });

  it('should store an assistant message with tool data', () => {
    db.prepare(`INSERT INTO groups (id, name) VALUES ('grp-1', 'Test')`).run();
    db.prepare(`INSERT INTO sessions (id, group_id, name, working_dir) VALUES ('sess-1', 'grp-1', 'Test', '/tmp')`).run();

    db.prepare(`
      INSERT INTO chat_messages (id, session_id, role, content, message_type, tool_calls)
      VALUES ('msg-2', 'sess-1', 'assistant', 'I will edit the file', 'text', '[{"tool":"Edit","file":"auth.ts"}]')
    `).run();

    const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get('msg-2') as any;
    expect(msg.role).toBe('assistant');
    expect(JSON.parse(msg.tool_calls)).toHaveLength(1);
  });
});

describe('knowledge_nodes_fts', () => {
  it('should support full-text search on knowledge nodes', () => {
    db.prepare(`
      INSERT INTO knowledge_nodes (id, tier, content, source)
      VALUES ('n1', 1, 'Fixed authentication bug in OAuth middleware', 'auto-extracted')
    `).run();
    db.prepare(`
      INSERT INTO knowledge_nodes (id, tier, content, source)
      VALUES ('n2', 1, 'Database connection pooling resolves timeouts', 'auto-extracted')
    `).run();

    const results = db.prepare(`
      SELECT kn.* FROM knowledge_nodes kn
      JOIN knowledge_nodes_fts fts ON kn.rowid = fts.rowid
      WHERE knowledge_nodes_fts MATCH 'authentication'
    `).all();

    expect(results).toHaveLength(1);
    expect((results[0] as any).id).toBe('n1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/database-knowledge.test.ts`
Expected: FAIL — `Cannot find module '../main/database-knowledge'`

**Step 3: Create the knowledge graph table initialization module**

Create `src/main/database-knowledge.ts`:
```typescript
import Database from 'better-sqlite3';
import log from 'electron-log';

/**
 * Initialize the 3-tier knowledge graph tables.
 * Called from database.ts during app startup.
 */
export function initKnowledgeGraphTables(database: Database.Database): void {
  // Knowledge nodes — the core of the 3-tier graph
  database.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_nodes (
      id TEXT PRIMARY KEY,
      tier INTEGER NOT NULL CHECK(tier IN (1, 2, 3)),
      content TEXT NOT NULL,
      confidence REAL DEFAULT 1.0 CHECK(confidence >= 0.0 AND confidence <= 1.0),
      source TEXT NOT NULL CHECK(source IN ('auto-extracted', 'user-created', 'promoted')),
      scope_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      scope_group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
      domains TEXT NOT NULL DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_reinforced_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Knowledge edges — typed relationships between nodes
  database.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
      relationship TEXT NOT NULL CHECK(relationship IN (
        'derived_from', 'supports', 'contradicts', 'relates_to', 'applied_in', 'same_domain'
      )),
      weight REAL DEFAULT 1.0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(source_id, target_id, relationship)
    )
  `);

  // Promotion log — tracks tier transitions
  database.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_promotions (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
      from_tier INTEGER NOT NULL,
      to_tier INTEGER NOT NULL,
      trigger TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '[]',
      promoted_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Chat messages — full conversation persistence
  database.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'error')),
      content TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text' CHECK(message_type IN ('text', 'tool_use', 'tool_result', 'thinking', 'system')),
      tool_calls TEXT,
      tool_results TEXT,
      thinking TEXT,
      branch_id TEXT,
      parent_message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
      claude_session_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Session templates — reusable session configurations
  database.exec(`
    CREATE TABLE IF NOT EXISTS session_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      working_dir TEXT,
      initial_prompt TEXT,
      knowledge_context TEXT DEFAULT '[]',
      group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT
    )
  `);

  // Conversation branches — fork points for branching
  database.exec(`
    CREATE TABLE IF NOT EXISTS conversation_branches (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      parent_branch_id TEXT REFERENCES conversation_branches(id) ON DELETE SET NULL,
      fork_message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Indexes for performance
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_kn_tier ON knowledge_nodes(tier);
    CREATE INDEX IF NOT EXISTS idx_kn_confidence ON knowledge_nodes(confidence);
    CREATE INDEX IF NOT EXISTS idx_kn_scope_group ON knowledge_nodes(scope_group_id);
    CREATE INDEX IF NOT EXISTS idx_kn_scope_session ON knowledge_nodes(scope_session_id);
    CREATE INDEX IF NOT EXISTS idx_kn_source ON knowledge_nodes(source);
    CREATE INDEX IF NOT EXISTS idx_kn_last_reinforced ON knowledge_nodes(last_reinforced_at);

    CREATE INDEX IF NOT EXISTS idx_ke_source ON knowledge_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_ke_target ON knowledge_edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_ke_relationship ON knowledge_edges(relationship);

    CREATE INDEX IF NOT EXISTS idx_kp_node ON knowledge_promotions(node_id);

    CREATE INDEX IF NOT EXISTS idx_cm_session ON chat_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_cm_branch ON chat_messages(branch_id);
    CREATE INDEX IF NOT EXISTS idx_cm_created ON chat_messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_cm_claude_session ON chat_messages(claude_session_id);

    CREATE INDEX IF NOT EXISTS idx_cb_session ON conversation_branches(session_id);
  `);

  // FTS5 for knowledge node content search
  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_nodes_fts USING fts5(
        content,
        content=knowledge_nodes,
        content_rowid=rowid
      )
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS kn_fts_ai AFTER INSERT ON knowledge_nodes BEGIN
        INSERT INTO knowledge_nodes_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END;

      CREATE TRIGGER IF NOT EXISTS kn_fts_ad AFTER DELETE ON knowledge_nodes BEGIN
        INSERT INTO knowledge_nodes_fts(knowledge_nodes_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
      END;

      CREATE TRIGGER IF NOT EXISTS kn_fts_au AFTER UPDATE ON knowledge_nodes BEGIN
        INSERT INTO knowledge_nodes_fts(knowledge_nodes_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
        INSERT INTO knowledge_nodes_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END;
    `);
  } catch (e) {
    // Triggers may already exist
    log.info('Knowledge FTS5 setup (may already exist):', e);
  }

  // FTS5 for chat message search
  try {
    database.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chat_messages_fts USING fts5(
        content,
        content=chat_messages,
        content_rowid=rowid
      )
    `);

    database.exec(`
      CREATE TRIGGER IF NOT EXISTS cm_fts_ai AFTER INSERT ON chat_messages BEGIN
        INSERT INTO chat_messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END;

      CREATE TRIGGER IF NOT EXISTS cm_fts_ad AFTER DELETE ON chat_messages BEGIN
        INSERT INTO chat_messages_fts(chat_messages_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
      END;

      CREATE TRIGGER IF NOT EXISTS cm_fts_au AFTER UPDATE ON chat_messages BEGIN
        INSERT INTO chat_messages_fts(chat_messages_fts, rowid, content) VALUES('delete', OLD.rowid, OLD.content);
        INSERT INTO chat_messages_fts(rowid, content) VALUES (NEW.rowid, NEW.content);
      END;
    `);
  } catch (e) {
    log.info('Chat messages FTS5 setup (may already exist):', e);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/database-knowledge.test.ts`
Expected: All tests PASS

**Step 5: Wire into main database initialization**

Modify `src/main/database.ts` — add import and call at end of `initializeTables`:

After the existing `initializeCodeSearchTables(db)` call (line 52), add:
```typescript
import { initKnowledgeGraphTables } from './database-knowledge';
```
And in `getDatabase()`, after `initializeCodeSearchTables(db);`:
```typescript
  initKnowledgeGraphTables(db);
```

**Step 6: Commit**

```bash
git add src/main/database-knowledge.ts src/__tests__/database-knowledge.test.ts src/main/database.ts
git commit -m "feat: add knowledge graph and chat message database tables"
```

---

### Task 1.3: Add New Shared Types for 3.0

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/__tests__/types-knowledge.test.ts`

**Step 1: Write test for new types**

Create `src/__tests__/types-knowledge.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import type {
  KnowledgeTier,
  KnowledgeSource,
  KnowledgeRelationship,
  KnowledgeNode,
  KnowledgeEdge,
  KnowledgePromotion,
  ChatMessage,
  ChatMessageRole,
  ChatMessageType,
  SessionTemplate,
  ConversationBranch,
  ClaudeJsonEvent,
  ClaudeEventType,
} from '../shared/types';

describe('Knowledge types', () => {
  it('should allow creating a valid KnowledgeNode', () => {
    const node: KnowledgeNode = {
      id: 'test-1',
      tier: 1,
      content: 'Test fact',
      confidence: 0.9,
      source: 'auto-extracted',
      scopeSessionId: null,
      scopeGroupId: 'grp-1',
      domains: ['testing'],
      tags: [],
      createdAt: new Date(),
      lastReinforcedAt: new Date(),
    };
    expect(node.tier).toBe(1);
  });

  it('should allow creating a valid KnowledgeEdge', () => {
    const edge: KnowledgeEdge = {
      id: 'e-1',
      sourceId: 'n1',
      targetId: 'n2',
      relationship: 'derived_from',
      weight: 1.0,
      createdAt: new Date(),
    };
    expect(edge.relationship).toBe('derived_from');
  });
});

describe('Chat message types', () => {
  it('should allow creating a user chat message', () => {
    const msg: ChatMessage = {
      id: 'msg-1',
      sessionId: 'sess-1',
      role: 'user',
      content: 'Hello',
      messageType: 'text',
      toolCalls: null,
      toolResults: null,
      thinking: null,
      branchId: null,
      parentMessageId: null,
      claudeSessionId: null,
      createdAt: new Date(),
    };
    expect(msg.role).toBe('user');
  });

  it('should allow creating an assistant message with tool calls', () => {
    const msg: ChatMessage = {
      id: 'msg-2',
      sessionId: 'sess-1',
      role: 'assistant',
      content: 'I will edit the file',
      messageType: 'tool_use',
      toolCalls: [{ tool: 'Edit', file: 'auth.ts' }],
      toolResults: null,
      thinking: 'Let me think about this...',
      branchId: null,
      parentMessageId: null,
      claudeSessionId: 'claude-sess-abc',
      createdAt: new Date(),
    };
    expect(msg.toolCalls).toHaveLength(1);
  });
});

describe('Claude JSON event types', () => {
  it('should type a message_start event', () => {
    const event: ClaudeJsonEvent = {
      type: 'message_start',
      message: { id: 'msg-1', role: 'assistant' },
    };
    expect(event.type).toBe('message_start');
  });

  it('should type a content_block_delta event', () => {
    const event: ClaudeJsonEvent = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello' },
    };
    expect(event.type).toBe('content_block_delta');
  });
});

describe('Session template types', () => {
  it('should allow creating a template', () => {
    const template: SessionTemplate = {
      id: 'tmpl-1',
      name: 'TDD Session',
      workingDir: '/projects/myapp',
      initialPrompt: 'Start a TDD session for the auth module',
      knowledgeContext: ['node-1', 'node-2'],
      groupId: 'grp-1',
      createdAt: new Date(),
      updatedAt: null,
    };
    expect(template.knowledgeContext).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/types-knowledge.test.ts`
Expected: FAIL — types not exported from `shared/types`

**Step 3: Add new types to shared/types.ts**

Append to `src/shared/types.ts` after the existing `IndexProgress` interface (line 288):

```typescript
// =============================================================================
// Knowledge Graph Types (3.0)
// =============================================================================

export type KnowledgeTier = 1 | 2 | 3;
export type KnowledgeSource = 'auto-extracted' | 'user-created' | 'promoted';
export type KnowledgeRelationship = 'derived_from' | 'supports' | 'contradicts' | 'relates_to' | 'applied_in' | 'same_domain';

export interface KnowledgeNode {
  id: string;
  tier: KnowledgeTier;
  content: string;
  confidence: number;
  source: KnowledgeSource;
  scopeSessionId: string | null;
  scopeGroupId: string | null;
  domains: string[];
  tags: string[];
  createdAt: Date;
  lastReinforcedAt: Date;
}

export interface KnowledgeEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: KnowledgeRelationship;
  weight: number;
  createdAt: Date;
}

export interface KnowledgePromotion {
  id: string;
  nodeId: string;
  fromTier: KnowledgeTier;
  toTier: KnowledgeTier;
  trigger: string;
  evidence: string[];
  promotedAt: Date;
}

export interface KnowledgeNodeCreateInput {
  id: string;
  tier: KnowledgeTier;
  content: string;
  source: KnowledgeSource;
  confidence?: number;
  scopeSessionId?: string | null;
  scopeGroupId?: string | null;
  domains?: string[];
  tags?: string[];
}

export interface KnowledgeNodeUpdateInput {
  content?: string;
  tier?: KnowledgeTier;
  confidence?: number;
  domains?: string[];
  tags?: string[];
}

export interface KnowledgeEdgeCreateInput {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: KnowledgeRelationship;
  weight?: number;
}

// =============================================================================
// Chat Message Types (3.0)
// =============================================================================

export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'error';
export type ChatMessageType = 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'system';

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  messageType: ChatMessageType;
  toolCalls: any[] | null;
  toolResults: any[] | null;
  thinking: string | null;
  branchId: string | null;
  parentMessageId: string | null;
  claudeSessionId: string | null;
  createdAt: Date;
}

export interface ChatMessageCreateInput {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  messageType?: ChatMessageType;
  toolCalls?: any[];
  toolResults?: any[];
  thinking?: string;
  branchId?: string;
  parentMessageId?: string;
  claudeSessionId?: string;
}

// =============================================================================
// Claude Code JSON Streaming Types (3.0)
// =============================================================================

export type ClaudeEventType =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop'
  | 'ping'
  | 'error';

export interface ClaudeJsonEvent {
  type: ClaudeEventType;
  message?: any;
  index?: number;
  content_block?: any;
  delta?: any;
  error?: any;
  [key: string]: any;
}

export interface ClaudeToolUse {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface ClaudeToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

// =============================================================================
// Session Template Types (3.0)
// =============================================================================

export interface SessionTemplate {
  id: string;
  name: string;
  workingDir: string | null;
  initialPrompt: string | null;
  knowledgeContext: string[];
  groupId: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface SessionTemplateCreateInput {
  id: string;
  name: string;
  workingDir?: string;
  initialPrompt?: string;
  knowledgeContext?: string[];
  groupId?: string;
}

// =============================================================================
// Conversation Branching Types (3.0)
// =============================================================================

export interface ConversationBranch {
  id: string;
  sessionId: string;
  parentBranchId: string | null;
  forkMessageId: string;
  name: string | null;
  createdAt: Date;
}

// =============================================================================
// Session State Updates (3.0)
// =============================================================================

/** Enhanced session state — replaces regex heuristics with structured data */
export type SessionState3 = 'idle' | 'thinking' | 'tool_executing' | 'streaming' | 'waiting' | 'error' | 'stopped';

export interface SessionStatus {
  state: SessionState3;
  description: string;
  currentTool?: string;
  filesBeingEdited?: string[];
  commandRunning?: string;
  lastActivity: Date;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/types-knowledge.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/shared/types.ts src/__tests__/types-knowledge.test.ts
git commit -m "feat: add knowledge graph, chat, and Claude JSON streaming types"
```

---

### Task 1.4: Knowledge Node Repository

**Files:**
- Create: `src/main/repositories/knowledge.ts`
- Create: `src/__tests__/repository-knowledge.test.ts`

**Step 1: Write failing tests**

Create `src/__tests__/repository-knowledge.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initKnowledgeGraphTables } from '../main/database-knowledge';

let db: Database.Database;

// Mock getDatabase to return our test db
vi.mock('../main/database', () => ({
  getDatabase: () => db,
}));

import {
  createKnowledgeNode,
  getKnowledgeNode,
  updateKnowledgeNode,
  deleteKnowledgeNode,
  getKnowledgeNodesByTier,
  getKnowledgeNodesByDomain,
  searchKnowledgeNodes,
  reinforceKnowledgeNode,
  createKnowledgeEdge,
  getEdgesForNode,
  deleteKnowledgeEdge,
  logPromotion,
  getPromotionHistory,
  getNodesWithDecayedConfidence,
  applyConfidenceDecay,
} from '../main/repositories/knowledge';

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#888', working_dir TEXT DEFAULT '', "order" INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, group_id TEXT REFERENCES groups(id) ON DELETE CASCADE, name TEXT NOT NULL, working_dir TEXT NOT NULL, state TEXT DEFAULT 'idle', "order" INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  initKnowledgeGraphTables(db);
  db.prepare(`INSERT INTO groups (id, name) VALUES ('grp-1', 'Test Group')`).run();
});

afterEach(() => {
  db.close();
});

describe('createKnowledgeNode', () => {
  it('should create a tier 1 fact', () => {
    const node = createKnowledgeNode({
      id: 'n1',
      tier: 1,
      content: 'Fixed auth bug',
      source: 'auto-extracted',
      domains: ['auth'],
      scopeGroupId: 'grp-1',
    });
    expect(node.id).toBe('n1');
    expect(node.tier).toBe(1);
    expect(node.confidence).toBe(1.0);
    expect(node.domains).toEqual(['auth']);
  });

  it('should default domains to empty array', () => {
    const node = createKnowledgeNode({
      id: 'n2',
      tier: 1,
      content: 'Some fact',
      source: 'user-created',
    });
    expect(node.domains).toEqual([]);
  });
});

describe('getKnowledgeNode', () => {
  it('should return null for non-existent node', () => {
    expect(getKnowledgeNode('nonexistent')).toBeNull();
  });

  it('should return the node with parsed domains/tags', () => {
    createKnowledgeNode({ id: 'n1', tier: 1, content: 'Test', source: 'auto-extracted', domains: ['db', 'perf'] });
    const node = getKnowledgeNode('n1');
    expect(node).not.toBeNull();
    expect(node!.domains).toEqual(['db', 'perf']);
  });
});

describe('getKnowledgeNodesByTier', () => {
  it('should filter by tier', () => {
    createKnowledgeNode({ id: 'n1', tier: 1, content: 'Fact', source: 'auto-extracted' });
    createKnowledgeNode({ id: 'n2', tier: 2, content: 'Pattern', source: 'promoted' });
    createKnowledgeNode({ id: 'n3', tier: 1, content: 'Another fact', source: 'auto-extracted' });

    const tier1 = getKnowledgeNodesByTier(1);
    expect(tier1).toHaveLength(2);

    const tier2 = getKnowledgeNodesByTier(2);
    expect(tier2).toHaveLength(1);
  });
});

describe('getKnowledgeNodesByDomain', () => {
  it('should find nodes containing the domain', () => {
    createKnowledgeNode({ id: 'n1', tier: 1, content: 'Auth fact', source: 'auto-extracted', domains: ['auth'] });
    createKnowledgeNode({ id: 'n2', tier: 1, content: 'DB fact', source: 'auto-extracted', domains: ['database'] });
    createKnowledgeNode({ id: 'n3', tier: 1, content: 'Auth+DB', source: 'auto-extracted', domains: ['auth', 'database'] });

    const authNodes = getKnowledgeNodesByDomain('auth');
    expect(authNodes).toHaveLength(2);
    expect(authNodes.map(n => n.id).sort()).toEqual(['n1', 'n3']);
  });
});

describe('searchKnowledgeNodes', () => {
  it('should find nodes via FTS', () => {
    createKnowledgeNode({ id: 'n1', tier: 1, content: 'Fixed authentication bug in OAuth middleware', source: 'auto-extracted' });
    createKnowledgeNode({ id: 'n2', tier: 1, content: 'Database pooling resolves timeouts', source: 'auto-extracted' });

    const results = searchKnowledgeNodes('authentication');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('n1');
  });
});

describe('reinforceKnowledgeNode', () => {
  it('should update last_reinforced_at and boost confidence', () => {
    createKnowledgeNode({ id: 'n1', tier: 1, content: 'Test', source: 'auto-extracted' });
    // Manually lower confidence
    db.prepare('UPDATE knowledge_nodes SET confidence = 0.5 WHERE id = ?').run('n1');

    reinforceKnowledgeNode('n1');

    const node = getKnowledgeNode('n1')!;
    expect(node.confidence).toBeGreaterThan(0.5);
    expect(node.confidence).toBeLessThanOrEqual(1.0);
  });
});

describe('knowledge edges', () => {
  beforeEach(() => {
    createKnowledgeNode({ id: 'n1', tier: 1, content: 'Fact', source: 'auto-extracted' });
    createKnowledgeNode({ id: 'n2', tier: 2, content: 'Pattern', source: 'promoted' });
  });

  it('should create and retrieve edges', () => {
    createKnowledgeEdge({ id: 'e1', sourceId: 'n1', targetId: 'n2', relationship: 'derived_from' });

    const edges = getEdgesForNode('n1');
    expect(edges).toHaveLength(1);
    expect(edges[0].relationship).toBe('derived_from');
  });

  it('should get both incoming and outgoing edges', () => {
    createKnowledgeEdge({ id: 'e1', sourceId: 'n1', targetId: 'n2', relationship: 'derived_from' });

    const outgoing = getEdgesForNode('n1', 'outgoing');
    expect(outgoing).toHaveLength(1);

    const incoming = getEdgesForNode('n2', 'incoming');
    expect(incoming).toHaveLength(1);
  });
});

describe('confidence decay', () => {
  it('should identify nodes needing decay', () => {
    createKnowledgeNode({ id: 'n1', tier: 1, content: 'Old fact', source: 'auto-extracted' });
    // Set last_reinforced_at to 2 weeks ago
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE knowledge_nodes SET last_reinforced_at = ? WHERE id = ?').run(twoWeeksAgo, 'n1');

    const nodes = getNodesWithDecayedConfidence(7); // decay after 7 days
    expect(nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('should apply decay correctly', () => {
    createKnowledgeNode({ id: 'n1', tier: 1, content: 'Decaying', source: 'auto-extracted' });
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE knowledge_nodes SET last_reinforced_at = ? WHERE id = ?').run(twoWeeksAgo, 'n1');

    const decayed = applyConfidenceDecay(0.05, 7); // 5% per week, check every 7 days
    expect(decayed).toBeGreaterThanOrEqual(1);

    const node = getKnowledgeNode('n1')!;
    expect(node.confidence).toBeLessThan(1.0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/repository-knowledge.test.ts`
Expected: FAIL — module not found

**Step 3: Implement knowledge repository**

Create `src/main/repositories/knowledge.ts`:
```typescript
import { getDatabase } from '../database';
import {
  KnowledgeNode,
  KnowledgeEdge,
  KnowledgePromotion,
  KnowledgeNodeCreateInput,
  KnowledgeNodeUpdateInput,
  KnowledgeEdgeCreateInput,
  KnowledgeTier,
} from '../../shared/types';

function rowToNode(row: any): KnowledgeNode {
  return {
    id: row.id,
    tier: row.tier as KnowledgeTier,
    content: row.content,
    confidence: row.confidence,
    source: row.source,
    scopeSessionId: row.scope_session_id,
    scopeGroupId: row.scope_group_id,
    domains: JSON.parse(row.domains || '[]'),
    tags: JSON.parse(row.tags || '[]'),
    createdAt: new Date(row.created_at),
    lastReinforcedAt: new Date(row.last_reinforced_at),
  };
}

function rowToEdge(row: any): KnowledgeEdge {
  return {
    id: row.id,
    sourceId: row.source_id,
    targetId: row.target_id,
    relationship: row.relationship,
    weight: row.weight,
    createdAt: new Date(row.created_at),
  };
}

function rowToPromotion(row: any): KnowledgePromotion {
  return {
    id: row.id,
    nodeId: row.node_id,
    fromTier: row.from_tier,
    toTier: row.to_tier,
    trigger: row.trigger,
    evidence: JSON.parse(row.evidence || '[]'),
    promotedAt: new Date(row.promoted_at),
  };
}

// ---- Node CRUD ----

export function createKnowledgeNode(input: KnowledgeNodeCreateInput): KnowledgeNode {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO knowledge_nodes (id, tier, content, confidence, source, scope_session_id, scope_group_id, domains, tags, created_at, last_reinforced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.tier,
    input.content,
    input.confidence ?? 1.0,
    input.source,
    input.scopeSessionId ?? null,
    input.scopeGroupId ?? null,
    JSON.stringify(input.domains ?? []),
    JSON.stringify(input.tags ?? []),
    now,
    now,
  );
  return getKnowledgeNode(input.id)!;
}

export function getKnowledgeNode(id: string): KnowledgeNode | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM knowledge_nodes WHERE id = ?').get(id);
  return row ? rowToNode(row) : null;
}

export function updateKnowledgeNode(id: string, updates: KnowledgeNodeUpdateInput): void {
  const db = getDatabase();
  const sets: string[] = [];
  const values: any[] = [];

  if (updates.content !== undefined) { sets.push('content = ?'); values.push(updates.content); }
  if (updates.tier !== undefined) { sets.push('tier = ?'); values.push(updates.tier); }
  if (updates.confidence !== undefined) { sets.push('confidence = ?'); values.push(updates.confidence); }
  if (updates.domains !== undefined) { sets.push('domains = ?'); values.push(JSON.stringify(updates.domains)); }
  if (updates.tags !== undefined) { sets.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE knowledge_nodes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function deleteKnowledgeNode(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM knowledge_nodes WHERE id = ?').run(id);
}

// ---- Node Queries ----

export function getKnowledgeNodesByTier(tier: KnowledgeTier, limit: number = 100): KnowledgeNode[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM knowledge_nodes WHERE tier = ? ORDER BY last_reinforced_at DESC LIMIT ?').all(tier, limit);
  return rows.map(rowToNode);
}

export function getKnowledgeNodesByDomain(domain: string, limit: number = 100): KnowledgeNode[] {
  const db = getDatabase();
  // Use JSON LIKE query since domains is stored as JSON array
  const rows = db.prepare(`
    SELECT * FROM knowledge_nodes
    WHERE domains LIKE ?
    ORDER BY confidence DESC, last_reinforced_at DESC
    LIMIT ?
  `).all(`%"${domain}"%`, limit);
  return rows.map(rowToNode);
}

export function getKnowledgeNodesByGroup(groupId: string, limit: number = 100): KnowledgeNode[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM knowledge_nodes
    WHERE scope_group_id = ? OR scope_group_id IS NULL
    ORDER BY tier DESC, confidence DESC
    LIMIT ?
  `).all(groupId, limit);
  return rows.map(rowToNode);
}

export function searchKnowledgeNodes(query: string, limit: number = 20): KnowledgeNode[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT kn.* FROM knowledge_nodes kn
    JOIN knowledge_nodes_fts fts ON kn.rowid = fts.rowid
    WHERE knowledge_nodes_fts MATCH ?
    ORDER BY kn.confidence DESC
    LIMIT ?
  `).all(query, limit);
  return rows.map(rowToNode);
}

export function reinforceKnowledgeNode(id: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  // Boost confidence by 10%, cap at 1.0
  db.prepare(`
    UPDATE knowledge_nodes
    SET last_reinforced_at = ?,
        confidence = MIN(1.0, confidence + 0.1)
    WHERE id = ?
  `).run(now, id);
}

// ---- Edge CRUD ----

export function createKnowledgeEdge(input: KnowledgeEdgeCreateInput): KnowledgeEdge {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO knowledge_edges (id, source_id, target_id, relationship, weight)
    VALUES (?, ?, ?, ?, ?)
  `).run(input.id, input.sourceId, input.targetId, input.relationship, input.weight ?? 1.0);
  return rowToEdge(db.prepare('SELECT * FROM knowledge_edges WHERE id = ?').get(input.id));
}

export function getEdgesForNode(nodeId: string, direction: 'both' | 'outgoing' | 'incoming' = 'both'): KnowledgeEdge[] {
  const db = getDatabase();
  let sql: string;
  if (direction === 'outgoing') {
    sql = 'SELECT * FROM knowledge_edges WHERE source_id = ?';
  } else if (direction === 'incoming') {
    sql = 'SELECT * FROM knowledge_edges WHERE target_id = ?';
  } else {
    sql = 'SELECT * FROM knowledge_edges WHERE source_id = ? OR target_id = ?';
    return db.prepare(sql).all(nodeId, nodeId).map(rowToEdge);
  }
  return db.prepare(sql).all(nodeId).map(rowToEdge);
}

export function deleteKnowledgeEdge(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM knowledge_edges WHERE id = ?').run(id);
}

// ---- Promotion ----

export function logPromotion(input: {
  id: string;
  nodeId: string;
  fromTier: KnowledgeTier;
  toTier: KnowledgeTier;
  trigger: string;
  evidence: string[];
}): KnowledgePromotion {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO knowledge_promotions (id, node_id, from_tier, to_tier, trigger, evidence)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.id, input.nodeId, input.fromTier, input.toTier, input.trigger, JSON.stringify(input.evidence));
  return rowToPromotion(db.prepare('SELECT * FROM knowledge_promotions WHERE id = ?').get(input.id));
}

export function getPromotionHistory(nodeId: string): KnowledgePromotion[] {
  const db = getDatabase();
  return db.prepare('SELECT * FROM knowledge_promotions WHERE node_id = ? ORDER BY promoted_at DESC').all(nodeId).map(rowToPromotion);
}

// ---- Confidence Decay ----

export function getNodesWithDecayedConfidence(daysSinceReinforcement: number): KnowledgeNode[] {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - daysSinceReinforcement * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare(`
    SELECT * FROM knowledge_nodes
    WHERE last_reinforced_at < ? AND confidence > 0.1
    ORDER BY last_reinforced_at ASC
  `).all(cutoff);
  return rows.map(rowToNode);
}

export function applyConfidenceDecay(decayRate: number, daysSinceReinforcement: number): number {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - daysSinceReinforcement * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(`
    UPDATE knowledge_nodes
    SET confidence = MAX(0.0, confidence - ?)
    WHERE last_reinforced_at < ? AND confidence > 0.1
  `).run(decayRate, cutoff);
  return result.changes;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/repository-knowledge.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/main/repositories/knowledge.ts src/__tests__/repository-knowledge.test.ts
git commit -m "feat: add knowledge graph repository with CRUD, search, and decay"
```

---

### Task 1.5: Chat Messages Repository

**Files:**
- Create: `src/main/repositories/chat-messages.ts`
- Create: `src/__tests__/repository-chat-messages.test.ts`

**Step 1: Write failing tests**

Create `src/__tests__/repository-chat-messages.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initKnowledgeGraphTables } from '../main/database-knowledge';

let db: Database.Database;

vi.mock('../main/database', () => ({
  getDatabase: () => db,
}));

import {
  createChatMessage,
  getChatMessage,
  getMessagesBySession,
  searchMessages,
  getMessagesByBranch,
  deleteChatMessage,
} from '../main/repositories/chat-messages';

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#888', working_dir TEXT DEFAULT '', "order" INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, group_id TEXT REFERENCES groups(id) ON DELETE CASCADE, name TEXT NOT NULL, working_dir TEXT NOT NULL, state TEXT DEFAULT 'idle', "order" INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  initKnowledgeGraphTables(db);
  db.prepare(`INSERT INTO groups (id, name) VALUES ('grp-1', 'Test')`).run();
  db.prepare(`INSERT INTO sessions (id, group_id, name, working_dir) VALUES ('sess-1', 'grp-1', 'Test Session', '/tmp')`).run();
});

afterEach(() => {
  db.close();
});

describe('createChatMessage', () => {
  it('should create a user message', () => {
    const msg = createChatMessage({
      id: 'msg-1',
      sessionId: 'sess-1',
      role: 'user',
      content: 'Hello Claude',
    });
    expect(msg.id).toBe('msg-1');
    expect(msg.role).toBe('user');
    expect(msg.messageType).toBe('text');
  });

  it('should create an assistant message with tool calls', () => {
    const msg = createChatMessage({
      id: 'msg-2',
      sessionId: 'sess-1',
      role: 'assistant',
      content: 'Editing file',
      messageType: 'tool_use',
      toolCalls: [{ tool: 'Edit', file: 'test.ts' }],
      claudeSessionId: 'claude-abc',
    });
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.claudeSessionId).toBe('claude-abc');
  });
});

describe('getMessagesBySession', () => {
  it('should return messages in chronological order', () => {
    createChatMessage({ id: 'msg-1', sessionId: 'sess-1', role: 'user', content: 'First' });
    createChatMessage({ id: 'msg-2', sessionId: 'sess-1', role: 'assistant', content: 'Second' });
    createChatMessage({ id: 'msg-3', sessionId: 'sess-1', role: 'user', content: 'Third' });

    const messages = getMessagesBySession('sess-1');
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe('First');
    expect(messages[2].content).toBe('Third');
  });

  it('should support pagination', () => {
    for (let i = 0; i < 10; i++) {
      createChatMessage({ id: `msg-${i}`, sessionId: 'sess-1', role: 'user', content: `Message ${i}` });
    }

    const page = getMessagesBySession('sess-1', 5, 3);
    expect(page).toHaveLength(5);
  });
});

describe('searchMessages', () => {
  it('should find messages via FTS', () => {
    createChatMessage({ id: 'msg-1', sessionId: 'sess-1', role: 'user', content: 'Fix the authentication bug' });
    createChatMessage({ id: 'msg-2', sessionId: 'sess-1', role: 'assistant', content: 'I will update the database' });

    const results = searchMessages('authentication');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('msg-1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/repository-chat-messages.test.ts`
Expected: FAIL

**Step 3: Implement chat messages repository**

Create `src/main/repositories/chat-messages.ts`:
```typescript
import { getDatabase } from '../database';
import { ChatMessage, ChatMessageCreateInput } from '../../shared/types';

function rowToMessage(row: any): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    messageType: row.message_type,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : null,
    toolResults: row.tool_results ? JSON.parse(row.tool_results) : null,
    thinking: row.thinking,
    branchId: row.branch_id,
    parentMessageId: row.parent_message_id,
    claudeSessionId: row.claude_session_id,
    createdAt: new Date(row.created_at),
  };
}

export function createChatMessage(input: ChatMessageCreateInput): ChatMessage {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO chat_messages (id, session_id, role, content, message_type, tool_calls, tool_results, thinking, branch_id, parent_message_id, claude_session_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.sessionId,
    input.role,
    input.content,
    input.messageType ?? 'text',
    input.toolCalls ? JSON.stringify(input.toolCalls) : null,
    input.toolResults ? JSON.stringify(input.toolResults) : null,
    input.thinking ?? null,
    input.branchId ?? null,
    input.parentMessageId ?? null,
    input.claudeSessionId ?? null,
    now,
  );
  return getChatMessage(input.id)!;
}

export function getChatMessage(id: string): ChatMessage | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id);
  return row ? rowToMessage(row) : null;
}

export function getMessagesBySession(sessionId: string, limit: number = 100, offset: number = 0): ChatMessage[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM chat_messages
    WHERE session_id = ? AND branch_id IS NULL
    ORDER BY created_at ASC
    LIMIT ? OFFSET ?
  `).all(sessionId, limit, offset);
  return rows.map(rowToMessage);
}

export function getMessagesByBranch(branchId: string, limit: number = 100): ChatMessage[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM chat_messages
    WHERE branch_id = ?
    ORDER BY created_at ASC
    LIMIT ?
  `).all(branchId, limit);
  return rows.map(rowToMessage);
}

export function searchMessages(query: string, sessionId?: string, limit: number = 20): ChatMessage[] {
  const db = getDatabase();
  if (sessionId) {
    const rows = db.prepare(`
      SELECT cm.* FROM chat_messages cm
      JOIN chat_messages_fts fts ON cm.rowid = fts.rowid
      WHERE chat_messages_fts MATCH ? AND cm.session_id = ?
      ORDER BY cm.created_at DESC
      LIMIT ?
    `).all(query, sessionId, limit);
    return rows.map(rowToMessage);
  }
  const rows = db.prepare(`
    SELECT cm.* FROM chat_messages cm
    JOIN chat_messages_fts fts ON cm.rowid = fts.rowid
    WHERE chat_messages_fts MATCH ?
    ORDER BY cm.created_at DESC
    LIMIT ?
  `).all(query, limit);
  return rows.map(rowToMessage);
}

export function deleteChatMessage(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM chat_messages WHERE id = ?').run(id);
}

export function getLastMessageForSession(sessionId: string): ChatMessage | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM chat_messages
    WHERE session_id = ? AND branch_id IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(sessionId);
  return row ? rowToMessage(row) : null;
}

export function getMessageCountForSession(sessionId: string): number {
  const db = getDatabase();
  const result = db.prepare('SELECT COUNT(*) as count FROM chat_messages WHERE session_id = ?').get(sessionId) as any;
  return result.count;
}
```

**Step 4: Run tests**

Run: `npx vitest run src/__tests__/repository-chat-messages.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/main/repositories/chat-messages.ts src/__tests__/repository-chat-messages.test.ts
git commit -m "feat: add chat messages repository with CRUD and FTS search"
```

---

### Task 1.6: Memory-to-Knowledge Migration Utility

**Files:**
- Create: `src/main/migration/memory-to-knowledge.ts`
- Create: `src/__tests__/migration-memory-to-knowledge.test.ts`

**Step 1: Write failing tests**

Create `src/__tests__/migration-memory-to-knowledge.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initKnowledgeGraphTables } from '../main/database-knowledge';

let db: Database.Database;

vi.mock('../main/database', () => ({
  getDatabase: () => db,
}));

import { migrateMemoriesToKnowledge } from '../main/migration/memory-to-knowledge';

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#888', working_dir TEXT DEFAULT '', "order" INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, group_id TEXT REFERENCES groups(id) ON DELETE CASCADE, name TEXT NOT NULL, working_dir TEXT NOT NULL, state TEXT DEFAULT 'idle', "order" INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('decision', 'error_fix', 'pattern', 'context', 'note')),
      content TEXT NOT NULL,
      source TEXT DEFAULT 'auto' CHECK(source IN ('auto', 'manual', 'claude')),
      tags TEXT,
      pinned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT
    );
  `);
  initKnowledgeGraphTables(db);
  db.prepare(`INSERT INTO groups (id, name) VALUES ('grp-1', 'Test')`).run();
});

afterEach(() => {
  db.close();
});

describe('migrateMemoriesToKnowledge', () => {
  it('should migrate a simple memory to tier 1 knowledge node', () => {
    db.prepare(`
      INSERT INTO memories (id, group_id, type, content, source, pinned)
      VALUES ('mem-1', 'grp-1', 'decision', 'Chose PostgreSQL for the project', 'auto', 0)
    `).run();

    const result = migrateMemoriesToKnowledge();
    expect(result.migrated).toBe(1);
    expect(result.errors).toBe(0);

    const node = db.prepare('SELECT * FROM knowledge_nodes WHERE id = ?').get('migrated-mem-1') as any;
    expect(node).toBeDefined();
    expect(node.tier).toBe(1);
    expect(node.source).toBe('auto-extracted');
    expect(node.scope_group_id).toBe('grp-1');
  });

  it('should give pinned memories confidence 1.0 and unpinned 0.8', () => {
    db.prepare(`INSERT INTO memories (id, group_id, type, content, source, pinned) VALUES ('mem-1', 'grp-1', 'note', 'Pinned note', 'manual', 1)`).run();
    db.prepare(`INSERT INTO memories (id, group_id, type, content, source, pinned) VALUES ('mem-2', 'grp-1', 'note', 'Unpinned note', 'auto', 0)`).run();

    migrateMemoriesToKnowledge();

    const pinned = db.prepare('SELECT confidence FROM knowledge_nodes WHERE id = ?').get('migrated-mem-1') as any;
    const unpinned = db.prepare('SELECT confidence FROM knowledge_nodes WHERE id = ?').get('migrated-mem-2') as any;
    expect(pinned.confidence).toBe(1.0);
    expect(unpinned.confidence).toBe(0.8);
  });

  it('should map memory type to domain', () => {
    db.prepare(`INSERT INTO memories (id, group_id, type, content, source, pinned) VALUES ('mem-1', 'grp-1', 'error_fix', 'Fixed DB timeout', 'claude', 0)`).run();

    migrateMemoriesToKnowledge();

    const node = db.prepare('SELECT domains FROM knowledge_nodes WHERE id = ?').get('migrated-mem-1') as any;
    const domains = JSON.parse(node.domains);
    expect(domains).toContain('error_fix');
  });

  it('should map memory source correctly', () => {
    db.prepare(`INSERT INTO memories (id, group_id, type, content, source, pinned) VALUES ('mem-1', 'grp-1', 'note', 'Manual', 'manual', 0)`).run();
    db.prepare(`INSERT INTO memories (id, group_id, type, content, source, pinned) VALUES ('mem-2', 'grp-1', 'note', 'Claude', 'claude', 0)`).run();

    migrateMemoriesToKnowledge();

    const manual = db.prepare('SELECT source FROM knowledge_nodes WHERE id = ?').get('migrated-mem-1') as any;
    const claude = db.prepare('SELECT source FROM knowledge_nodes WHERE id = ?').get('migrated-mem-2') as any;
    expect(manual.source).toBe('user-created');
    expect(claude.source).toBe('auto-extracted');
  });

  it('should be idempotent — skip already migrated', () => {
    db.prepare(`INSERT INTO memories (id, group_id, type, content, source, pinned) VALUES ('mem-1', 'grp-1', 'note', 'Test', 'auto', 0)`).run();

    const first = migrateMemoriesToKnowledge();
    const second = migrateMemoriesToKnowledge();
    expect(first.migrated).toBe(1);
    expect(second.migrated).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/migration-memory-to-knowledge.test.ts`
Expected: FAIL

**Step 3: Implement migration utility**

Create `src/main/migration/memory-to-knowledge.ts`:
```typescript
import { getDatabase } from '../database';
import log from 'electron-log';

interface MigrationResult {
  migrated: number;
  skipped: number;
  errors: number;
}

const SOURCE_MAP: Record<string, string> = {
  auto: 'auto-extracted',
  manual: 'user-created',
  claude: 'auto-extracted',
};

/**
 * Migrate existing 2.x memories to 3.0 knowledge graph nodes (Tier 1 facts).
 * Idempotent — checks for existing migrated nodes before inserting.
 */
export function migrateMemoriesToKnowledge(): MigrationResult {
  const db = getDatabase();
  const result: MigrationResult = { migrated: 0, skipped: 0, errors: 0 };

  const memories = db.prepare('SELECT * FROM memories').all() as any[];

  const insertNode = db.prepare(`
    INSERT INTO knowledge_nodes (id, tier, content, confidence, source, scope_session_id, scope_group_id, domains, tags, created_at, last_reinforced_at)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const checkExists = db.prepare('SELECT id FROM knowledge_nodes WHERE id = ?');

  for (const mem of memories) {
    const nodeId = `migrated-${mem.id}`;

    // Idempotency check
    if (checkExists.get(nodeId)) {
      result.skipped++;
      continue;
    }

    try {
      const confidence = mem.pinned ? 1.0 : 0.8;
      const source = SOURCE_MAP[mem.source] || 'auto-extracted';
      const domains = [mem.type]; // Map memory type as initial domain
      const tags = mem.tags ? JSON.parse(mem.tags) : [];
      const createdAt = mem.created_at || new Date().toISOString();

      insertNode.run(
        nodeId,
        mem.content,
        confidence,
        source,
        mem.session_id || null,
        mem.group_id,
        JSON.stringify(domains),
        JSON.stringify(tags),
        createdAt,
        createdAt,
      );

      result.migrated++;
    } catch (e) {
      log.error(`Failed to migrate memory ${mem.id}:`, e);
      result.errors++;
    }
  }

  log.info(`Memory migration complete: ${result.migrated} migrated, ${result.skipped} skipped, ${result.errors} errors`);
  return result;
}
```

**Step 4: Run tests**

Run: `npx vitest run src/__tests__/migration-memory-to-knowledge.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/main/migration/memory-to-knowledge.ts src/__tests__/migration-memory-to-knowledge.test.ts
git commit -m "feat: add memory-to-knowledge migration utility for 2.x→3.0 upgrade"
```

---

**END OF PHASE 1**

Phase 1 delivers:
- Vitest test framework with Electron mocks
- Knowledge graph tables (nodes, edges, promotions) with FTS5
- Chat messages table with FTS5
- Session templates and conversation branches tables
- All new 3.0 TypeScript types
- Knowledge repository (CRUD, search, decay, edges, promotions)
- Chat messages repository (CRUD, search, pagination)
- Memory → Knowledge migration utility (idempotent)

---

## Phase 2: Claude Code Backend — Replace PTY with JSON Subprocess

This phase replaces `node-pty` + `xterm.js` terminal emulation with Claude Code CLI running in headless JSON mode (`claude -p --output-format stream-json`). Sessions become managed subprocess instances that emit structured NDJSON events instead of raw terminal bytes.

### Task 2.1: Claude Code Session Manager

**Files:**
- Create: `src/main/claude-session-manager.ts`
- Create: `src/__tests__/claude-session-manager.test.ts`

**Step 1: Write failing tests**

Create `src/__tests__/claude-session-manager.test.ts`:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process.spawn
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/test') },
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ClaudeSessionManager } from '../main/claude-session-manager';

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.pid = 12345;
  proc.kill = vi.fn();
  return proc;
}

describe('ClaudeSessionManager', () => {
  let manager: ClaudeSessionManager;
  let mockProcess: any;

  beforeEach(() => {
    manager = new ClaudeSessionManager();
    mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
  });

  describe('startSession', () => {
    it('should spawn claude with correct flags', () => {
      manager.startSession('sess-1', '/projects/myapp', 'Hello Claude');

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p', '--output-format', 'stream-json']),
        expect.objectContaining({
          cwd: '/projects/myapp',
        })
      );
    });

    it('should include the user prompt in args', () => {
      manager.startSession('sess-1', '/projects/myapp', 'Fix the auth bug');

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toContain('Fix the auth bug');
    });

    it('should emit events when JSON data arrives on stdout', () => {
      const events: any[] = [];
      manager.on('event', (data) => events.push(data));

      manager.startSession('sess-1', '/projects/myapp', 'Hello');

      // Simulate NDJSON line from Claude
      const jsonLine = JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello!' },
      });
      mockProcess.stdout.emit('data', Buffer.from(jsonLine + '\n'));

      expect(events).toHaveLength(1);
      expect(events[0].sessionId).toBe('sess-1');
      expect(events[0].event.type).toBe('content_block_delta');
    });

    it('should handle multi-line buffered output', () => {
      const events: any[] = [];
      manager.on('event', (data) => events.push(data));

      manager.startSession('sess-1', '/projects/myapp', 'Hello');

      // Simulate chunked data
      const line1 = JSON.stringify({ type: 'message_start', message: { id: 'msg-1', role: 'assistant' } });
      const line2 = JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text' } });

      mockProcess.stdout.emit('data', Buffer.from(line1 + '\n' + line2 + '\n'));

      expect(events).toHaveLength(2);
    });

    it('should handle partial lines across chunks', () => {
      const events: any[] = [];
      manager.on('event', (data) => events.push(data));

      manager.startSession('sess-1', '/projects/myapp', 'Hello');

      const fullLine = JSON.stringify({ type: 'ping' });
      const half1 = fullLine.substring(0, 5);
      const half2 = fullLine.substring(5) + '\n';

      mockProcess.stdout.emit('data', Buffer.from(half1));
      expect(events).toHaveLength(0);

      mockProcess.stdout.emit('data', Buffer.from(half2));
      expect(events).toHaveLength(1);
      expect(events[0].event.type).toBe('ping');
    });
  });

  describe('sendMessage (resume)', () => {
    it('should spawn claude with --resume flag for follow-up messages', () => {
      manager.startSession('sess-1', '/projects/myapp', 'Initial prompt');
      // Simulate completion
      mockProcess.emit('close', 0);

      // Reset mock
      const newProcess = createMockProcess();
      mockSpawn.mockReturnValue(newProcess);

      manager.sendMessage('sess-1', 'Follow-up question');

      const args = mockSpawn.mock.calls[1][1];
      expect(args).toContain('--resume');
    });
  });

  describe('killSession', () => {
    it('should kill the subprocess', () => {
      manager.startSession('sess-1', '/projects/myapp', 'Hello');
      manager.killSession('sess-1');
      expect(mockProcess.kill).toHaveBeenCalled();
    });

    it('should emit session-ended event', () => {
      const ended: string[] = [];
      manager.on('session-ended', (data) => ended.push(data.sessionId));

      manager.startSession('sess-1', '/projects/myapp', 'Hello');
      mockProcess.emit('close', 0);

      expect(ended).toContain('sess-1');
    });
  });

  describe('getSessionStatus', () => {
    it('should return idle for unknown session', () => {
      const status = manager.getSessionStatus('nonexistent');
      expect(status.state).toBe('idle');
    });

    it('should track state based on events', () => {
      manager.startSession('sess-1', '/projects/myapp', 'Hello');

      // Simulate content streaming
      const event = JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Working...' },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

      const status = manager.getSessionStatus('sess-1');
      expect(status.state).toBe('streaming');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/claude-session-manager.test.ts`
Expected: FAIL — module not found

**Step 3: Implement ClaudeSessionManager**

Create `src/main/claude-session-manager.ts`:
```typescript
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import log from 'electron-log';
import { ClaudeJsonEvent, SessionStatus, SessionState3 } from '../shared/types';

interface ManagedSession {
  id: string;
  cwd: string;
  process: ChildProcess | null;
  claudeSessionId: string | null;
  state: SessionState3;
  description: string;
  currentTool: string | null;
  filesBeingEdited: string[];
  commandRunning: string | null;
  lastActivity: Date;
  stdoutBuffer: string;
  groupId: string | null;
}

/**
 * Manages Claude Code CLI subprocesses in headless JSON mode.
 * Replaces PtyManager for 3.0 chat-first architecture.
 *
 * Each session spawns: claude -p --output-format stream-json [prompt]
 * Follow-up messages use: claude -p --output-format stream-json --resume SESSION_ID [prompt]
 *
 * Emits:
 *   'event' — { sessionId, event: ClaudeJsonEvent }
 *   'session-ended' — { sessionId, exitCode }
 *   'state-change' — { sessionId, status: SessionStatus }
 *   'error' — { sessionId, error: string }
 */
export class ClaudeSessionManager extends EventEmitter {
  private sessions: Map<string, ManagedSession> = new Map();

  startSession(
    sessionId: string,
    cwd: string,
    prompt: string,
    options?: {
      groupId?: string;
      systemPrompt?: string;
      allowedTools?: string[];
      disallowedTools?: string[];
    }
  ): void {
    if (this.sessions.has(sessionId) && this.sessions.get(sessionId)!.process) {
      log.warn(`[ClaudeSession] Session ${sessionId} already running`);
      return;
    }

    const args = ['-p', '--output-format', 'stream-json'];

    if (options?.systemPrompt) {
      args.push('--append-system-prompt', options.systemPrompt);
    }

    if (options?.allowedTools) {
      args.push('--allowedTools', ...options.allowedTools);
    }

    if (options?.disallowedTools) {
      args.push('--disallowedTools', ...options.disallowedTools);
    }

    // The prompt itself
    args.push(prompt);

    const proc = spawn('claude', args, {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session: ManagedSession = {
      id: sessionId,
      cwd,
      process: proc,
      claudeSessionId: null,
      state: 'thinking',
      description: 'Starting...',
      currentTool: null,
      filesBeingEdited: [],
      commandRunning: null,
      lastActivity: new Date(),
      stdoutBuffer: '',
      groupId: options?.groupId ?? null,
    };

    this.sessions.set(sessionId, session);
    this.emitStateChange(session);

    proc.stdout!.on('data', (chunk: Buffer) => {
      this.handleStdoutData(sessionId, chunk);
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      log.warn(`[ClaudeSession] stderr for ${sessionId}:`, text);
      this.emit('error', { sessionId, error: text });
    });

    proc.on('close', (exitCode) => {
      const sess = this.sessions.get(sessionId);
      if (sess) {
        sess.process = null;
        sess.state = 'idle';
        sess.description = 'Idle';
        this.emitStateChange(sess);
      }
      this.emit('session-ended', { sessionId, exitCode });
    });

    proc.on('error', (err) => {
      log.error(`[ClaudeSession] Process error for ${sessionId}:`, err);
      const sess = this.sessions.get(sessionId);
      if (sess) {
        sess.state = 'error';
        sess.description = err.message;
        this.emitStateChange(sess);
      }
      this.emit('error', { sessionId, error: err.message });
    });
  }

  sendMessage(sessionId: string, prompt: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      log.error(`[ClaudeSession] No session ${sessionId} for sendMessage`);
      return;
    }

    // If process is still running, this shouldn't happen in normal flow
    if (session.process) {
      log.warn(`[ClaudeSession] Session ${sessionId} still has active process`);
      return;
    }

    const args = ['-p', '--output-format', 'stream-json'];

    // Resume the Claude session for multi-turn
    if (session.claudeSessionId) {
      args.push('--resume', session.claudeSessionId);
    }

    args.push(prompt);

    const proc = spawn('claude', args, {
      cwd: session.cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    session.process = proc;
    session.state = 'thinking';
    session.description = 'Thinking...';
    session.lastActivity = new Date();
    this.emitStateChange(session);

    proc.stdout!.on('data', (chunk: Buffer) => {
      this.handleStdoutData(sessionId, chunk);
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      log.warn(`[ClaudeSession] stderr for ${sessionId}:`, chunk.toString());
    });

    proc.on('close', (exitCode) => {
      session.process = null;
      session.state = 'idle';
      session.description = 'Idle';
      this.emitStateChange(session);
      this.emit('session-ended', { sessionId, exitCode });
    });

    proc.on('error', (err) => {
      log.error(`[ClaudeSession] Resume error for ${sessionId}:`, err);
      session.state = 'error';
      session.description = err.message;
      this.emitStateChange(session);
    });
  }

  killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.process) {
      session.process.kill('SIGTERM');
      // Force kill after 3 seconds
      setTimeout(() => {
        if (session.process) {
          session.process.kill('SIGKILL');
        }
      }, 3000);
    }
  }

  async killAll(): Promise<void> {
    for (const [id] of this.sessions) {
      this.killSession(id);
    }
  }

  removeSession(sessionId: string): void {
    this.killSession(sessionId);
    this.sessions.delete(sessionId);
  }

  getSessionStatus(sessionId: string): SessionStatus {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        state: 'idle',
        description: 'No active session',
        lastActivity: new Date(),
      };
    }
    return {
      state: session.state,
      description: session.description,
      currentTool: session.currentTool ?? undefined,
      filesBeingEdited: session.filesBeingEdited.length > 0 ? session.filesBeingEdited : undefined,
      commandRunning: session.commandRunning ?? undefined,
      lastActivity: session.lastActivity,
    };
  }

  isSessionRunning(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session?.process;
  }

  getClaudeSessionId(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.claudeSessionId ?? null;
  }

  // ---- Private ----

  private handleStdoutData(sessionId: string, chunk: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.stdoutBuffer += chunk.toString();
    session.lastActivity = new Date();

    // Process complete NDJSON lines
    const lines = session.stdoutBuffer.split('\n');
    // Keep the last incomplete line in the buffer
    session.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event: ClaudeJsonEvent = JSON.parse(trimmed);
        this.processEvent(sessionId, event);
        this.emit('event', { sessionId, event });
      } catch (e) {
        // Non-JSON output (shouldn't happen in stream-json mode, but be safe)
        log.debug(`[ClaudeSession] Non-JSON line for ${sessionId}: ${trimmed.substring(0, 100)}`);
      }
    }
  }

  private processEvent(sessionId: string, event: ClaudeJsonEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    switch (event.type) {
      case 'message_start':
        session.state = 'thinking';
        session.description = 'Thinking...';
        // Capture the Claude session ID from the response
        if (event.message?.id) {
          // The actual session ID for --resume comes from the session_id field
          // in the message_start event
        }
        break;

      case 'content_block_start':
        if (event.content_block?.type === 'tool_use') {
          session.state = 'tool_executing';
          session.currentTool = event.content_block.name;
          session.description = `Using ${event.content_block.name}`;

          // Track specific tool context
          if (event.content_block.name === 'Edit' || event.content_block.name === 'Write') {
            // Will get file info from input delta
          } else if (event.content_block.name === 'Bash') {
            session.description = 'Running command...';
          }
        } else if (event.content_block?.type === 'thinking') {
          session.state = 'thinking';
          session.description = 'Thinking...';
        } else {
          session.state = 'streaming';
          session.description = 'Responding...';
        }
        break;

      case 'content_block_delta':
        if (event.delta?.type === 'text_delta') {
          session.state = 'streaming';
          if (session.description === 'Thinking...') {
            session.description = 'Responding...';
          }
        } else if (event.delta?.type === 'input_json_delta') {
          // Tool input being streamed — extract context
          try {
            const partial = event.delta.partial_json || '';
            if (session.currentTool === 'Edit' || session.currentTool === 'Write') {
              const fileMatch = partial.match(/"file_path"\s*:\s*"([^"]+)"/);
              if (fileMatch) {
                const file = fileMatch[1].split(/[/\\]/).pop() || fileMatch[1];
                session.description = `Editing ${file}`;
                if (!session.filesBeingEdited.includes(file)) {
                  session.filesBeingEdited.push(file);
                }
              }
            } else if (session.currentTool === 'Bash') {
              const cmdMatch = partial.match(/"command"\s*:\s*"([^"]+)"/);
              if (cmdMatch) {
                session.commandRunning = cmdMatch[1].substring(0, 50);
                session.description = `Running: ${session.commandRunning}`;
              }
            }
          } catch {
            // Partial JSON, not parseable yet — fine
          }
        }
        break;

      case 'content_block_stop':
        if (session.state === 'tool_executing') {
          session.currentTool = null;
          session.commandRunning = null;
        }
        break;

      case 'message_delta':
        if (event.delta?.stop_reason === 'end_turn') {
          session.state = 'idle';
          session.description = 'Idle';
          session.filesBeingEdited = [];
        } else if (event.delta?.stop_reason === 'tool_use') {
          // Claude is about to execute tools — stay in working state
          session.state = 'tool_executing';
        }
        break;

      case 'message_stop':
        // Extract session ID for --resume
        if (event.session_id) {
          session.claudeSessionId = event.session_id;
        }
        break;

      case 'error':
        session.state = 'error';
        session.description = event.error?.message || 'Unknown error';
        break;
    }

    this.emitStateChange(session);
  }

  private emitStateChange(session: ManagedSession): void {
    this.emit('state-change', {
      sessionId: session.id,
      status: {
        state: session.state,
        description: session.description,
        currentTool: session.currentTool ?? undefined,
        filesBeingEdited: session.filesBeingEdited.length > 0 ? session.filesBeingEdited : undefined,
        commandRunning: session.commandRunning ?? undefined,
        lastActivity: session.lastActivity,
      },
    });
  }
}

export const claudeSessionManager = new ClaudeSessionManager();
```

**Step 4: Run tests**

Run: `npx vitest run src/__tests__/claude-session-manager.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/main/claude-session-manager.ts src/__tests__/claude-session-manager.test.ts
git commit -m "feat: add ClaudeSessionManager for headless JSON subprocess management"
```

---

### Task 2.2: Wire Claude Session Manager into IPC

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/types/electron.d.ts`

**Step 1: Add new IPC channels to main process**

Add to `src/main/index.ts` — new import and IPC handlers replacing PTY channels:

```typescript
// NEW import (add near top)
import { claudeSessionManager } from './claude-session-manager';
```

Add new IPC handlers (alongside existing PTY handlers — we keep both during transition):

```typescript
// ============================================================================
// Claude Session IPC Handlers (3.0 — replaces PTY)
// ============================================================================

safeHandle('claude:start', async (sessionId: string, cwd: string, prompt: string, options?: any) => {
  // Look up session for groupId
  const sessions = sessionsRepo.getAllSessions();
  const session = sessions.find(s => s.id === sessionId);
  const groupId = session?.groupId || null;

  claudeSessionManager.startSession(sessionId, cwd, prompt, {
    groupId,
    ...options,
  });

  soundManager.playStartSound();
});

safeHandle('claude:send', (sessionId: string, prompt: string) => {
  claudeSessionManager.sendMessage(sessionId, prompt);
});

safeHandle('claude:kill', (sessionId: string) => {
  claudeSessionManager.killSession(sessionId);
});

safeHandle('claude:status', (sessionId: string) => {
  return claudeSessionManager.getSessionStatus(sessionId);
});

safeHandle('claude:isRunning', (sessionId: string) => {
  return claudeSessionManager.isSessionRunning(sessionId);
});
```

Wire up events to forward to renderer:
```typescript
// Claude session event forwarding (add in createWindow function)
claudeSessionManager.on('event', ({ sessionId, event }) => {
  mainWindow?.webContents.send('claude:event', sessionId, event);
});

claudeSessionManager.on('state-change', ({ sessionId, status }) => {
  mainWindow?.webContents.send('claude:stateChange', sessionId, status);
  // Update database
  try {
    sessionsRepo.updateSession(sessionId, {
      state: status.state === 'idle' ? 'idle' : status.state === 'error' ? 'error' : 'working',
      lastActivityAt: new Date(),
    });
  } catch (error) {
    log.error('Failed to update session state:', error);
  }
  // Handle notifications
  handleStateChange(sessionId, status.state === 'idle' ? 'idle' : status.state === 'error' ? 'error' : 'working');
});

claudeSessionManager.on('session-ended', ({ sessionId }) => {
  mainWindow?.webContents.send('claude:ended', sessionId);
});

claudeSessionManager.on('error', ({ sessionId, error }) => {
  mainWindow?.webContents.send('claude:error', sessionId, error);
});
```

**Step 2: Add preload API methods**

Add to `src/main/preload.ts`:
```typescript
// Claude Session API (3.0)
claudeStart: (sessionId: string, cwd: string, prompt: string, options?: any) =>
  ipcRenderer.invoke('claude:start', sessionId, cwd, prompt, options),
claudeSend: (sessionId: string, prompt: string) =>
  ipcRenderer.invoke('claude:send', sessionId, prompt),
claudeKill: (sessionId: string) =>
  ipcRenderer.invoke('claude:kill', sessionId),
claudeGetStatus: (sessionId: string) =>
  ipcRenderer.invoke('claude:status', sessionId),
claudeIsRunning: (sessionId: string) =>
  ipcRenderer.invoke('claude:isRunning', sessionId),
onClaudeEvent: (callback: (sessionId: string, event: any) => void) => {
  const handler = (_: any, sessionId: string, event: any) => callback(sessionId, event);
  ipcRenderer.on('claude:event', handler);
  return () => ipcRenderer.removeListener('claude:event', handler);
},
onClaudeStateChange: (callback: (sessionId: string, status: any) => void) => {
  const handler = (_: any, sessionId: string, status: any) => callback(sessionId, status);
  ipcRenderer.on('claude:stateChange', handler);
  return () => ipcRenderer.removeListener('claude:stateChange', handler);
},
onClaudeEnded: (callback: (sessionId: string) => void) => {
  const handler = (_: any, sessionId: string) => callback(sessionId);
  ipcRenderer.on('claude:ended', handler);
  return () => ipcRenderer.removeListener('claude:ended', handler);
},
onClaudeError: (callback: (sessionId: string, error: string) => void) => {
  const handler = (_: any, sessionId: string, error: string) => callback(sessionId, error);
  ipcRenderer.on('claude:error', handler);
  return () => ipcRenderer.removeListener('claude:error', handler);
},
```

**Step 3: Update TypeScript types for preload**

Add to `src/renderer/types/electron.d.ts` the new Claude session methods matching the preload additions above.

**Step 4: Build and verify compilation**

Run: `npm run build:main`
Expected: Compiles without errors

**Step 5: Commit**

```bash
git add src/main/index.ts src/main/preload.ts src/renderer/types/electron.d.ts
git commit -m "feat: wire ClaudeSessionManager into IPC and preload API"
```

---

**END OF PHASE 2**

Phase 2 delivers:
- `ClaudeSessionManager` class — spawns `claude -p --output-format stream-json` subprocesses
- NDJSON line parsing with buffering for partial chunks
- Automatic state tracking from structured events (thinking, streaming, tool_executing, idle, error)
- Rich status descriptions ("Editing auth.ts", "Running: npm test")
- Multi-turn conversation via `--resume SESSION_ID`
- Full IPC channel wiring (claude:start, claude:send, claude:kill, events)
- Preload API for renderer access

---

## Phase 3: Chat UI Core — Replace Terminal with Chat Renderer

This phase creates the React chat components that replace Terminal.tsx and xterm.js rendering.

### Task 3.1: Install Chat UI Dependencies

**Step 1: Install markdown and syntax highlighting libraries**

Run: `npm install marked highlight.js diff`
Run: `npm install --save-dev @types/diff`

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add marked, highlight.js, diff for chat UI rendering"
```

---

### Task 3.2: Chat Message Components

**Files:**
- Create: `src/renderer/components/chat/ChatMessage.tsx`
- Create: `src/renderer/components/chat/UserMessage.tsx`
- Create: `src/renderer/components/chat/AssistantMessage.tsx`
- Create: `src/renderer/components/chat/SystemMessage.tsx`
- Create: `src/renderer/components/chat/ToolPanel.tsx`
- Create: `src/renderer/components/chat/CodeBlock.tsx`
- Create: `src/renderer/components/chat/DiffView.tsx`
- Create: `src/renderer/components/chat/ThinkingBlock.tsx`
- Create: `src/renderer/styles/chat.css`

**Step 1: Create the ChatMessage dispatcher component**

Create `src/renderer/components/chat/ChatMessage.tsx`:
```tsx
import React from 'react';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { SystemMessage } from './SystemMessage';

export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  messageType: string;
  toolCalls?: any[] | null;
  toolResults?: any[] | null;
  thinking?: string | null;
  createdAt: Date;
  isStreaming?: boolean;
}

interface ChatMessageProps {
  message: ChatMessageData;
  onSaveAsKnowledge?: (content: string) => void;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message, onSaveAsKnowledge }) => {
  switch (message.role) {
    case 'user':
      return <UserMessage message={message} />;
    case 'assistant':
      return <AssistantMessage message={message} onSaveAsKnowledge={onSaveAsKnowledge} />;
    case 'system':
    case 'error':
      return <SystemMessage message={message} />;
    default:
      return null;
  }
};
```

**Step 2: Create UserMessage component**

Create `src/renderer/components/chat/UserMessage.tsx`:
```tsx
import React from 'react';
import type { ChatMessageData } from './ChatMessage';

interface Props {
  message: ChatMessageData;
}

export const UserMessage: React.FC<Props> = ({ message }) => {
  return (
    <div className="chat-message user-message">
      <div className="message-avatar">You</div>
      <div className="message-body">
        <div className="message-content">{message.content}</div>
        <div className="message-time">
          {message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
};
```

**Step 3: Create AssistantMessage component (with collapsible tool panels, thinking, markdown)**

Create `src/renderer/components/chat/AssistantMessage.tsx`:
```tsx
import React, { useState, useMemo } from 'react';
import { CodeBlock } from './CodeBlock';
import { ToolPanel } from './ToolPanel';
import { ThinkingBlock } from './ThinkingBlock';
import type { ChatMessageData } from './ChatMessage';

interface Props {
  message: ChatMessageData;
  onSaveAsKnowledge?: (content: string) => void;
}

// Simple markdown rendering — parse code blocks, bold, italic, headers, lists
function renderMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      nodes.push(<CodeBlock key={key++} code={codeLines.join('\n')} language={lang} />);
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      nodes.push(<h3 key={key++} className="md-h3">{line.slice(4)}</h3>);
    } else if (line.startsWith('## ')) {
      nodes.push(<h2 key={key++} className="md-h2">{line.slice(3)}</h2>);
    } else if (line.startsWith('# ')) {
      nodes.push(<h1 key={key++} className="md-h1">{line.slice(2)}</h1>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      nodes.push(<li key={key++} className="md-li">{renderInline(line.slice(2))}</li>);
    } else if (line.trim() === '') {
      nodes.push(<br key={key++} />);
    } else {
      nodes.push(<p key={key++} className="md-p">{renderInline(line)}</p>);
    }
    i++;
  }

  return nodes;
}

function renderInline(text: string): React.ReactNode {
  // Replace **bold**, *italic*, `code`
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="inline-code">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

export const AssistantMessage: React.FC<Props> = ({ message, onSaveAsKnowledge }) => {
  const renderedContent = useMemo(() => renderMarkdown(message.content), [message.content]);

  return (
    <div className={`chat-message assistant-message ${message.isStreaming ? 'streaming' : ''}`}>
      <div className="message-avatar">Claude</div>
      <div className="message-body">
        {message.thinking && <ThinkingBlock content={message.thinking} />}

        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolPanel tools={message.toolCalls} results={message.toolResults} />
        )}

        <div className="message-content markdown-body">
          {renderedContent}
          {message.isStreaming && <span className="typing-cursor" />}
        </div>

        <div className="message-footer">
          <span className="message-time">
            {message.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {onSaveAsKnowledge && (
            <button
              className="save-knowledge-btn"
              onClick={() => onSaveAsKnowledge(message.content)}
              title="Save as knowledge"
            >
              Save as knowledge
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
```

**Step 4: Create SystemMessage component**

Create `src/renderer/components/chat/SystemMessage.tsx`:
```tsx
import React from 'react';
import type { ChatMessageData } from './ChatMessage';

interface Props {
  message: ChatMessageData;
}

export const SystemMessage: React.FC<Props> = ({ message }) => {
  const isError = message.role === 'error';

  return (
    <div className={`chat-message system-message ${isError ? 'error' : ''}`}>
      <div className="system-content">
        {isError && <span className="error-icon">!</span>}
        {message.content}
      </div>
    </div>
  );
};
```

**Step 5: Create ToolPanel component**

Create `src/renderer/components/chat/ToolPanel.tsx`:
```tsx
import React, { useState } from 'react';

interface Props {
  tools: any[];
  results?: any[] | null;
}

const TOOL_LABELS: Record<string, string> = {
  Read: 'Read file',
  Edit: 'Edited file',
  Write: 'Created file',
  Bash: 'Ran command',
  Grep: 'Searched code',
  Glob: 'Found files',
  Agent: 'Dispatched agent',
};

export const ToolPanel: React.FC<Props> = ({ tools, results }) => {
  const [expanded, setExpanded] = useState(false);

  const summary = tools.map(t => {
    const name = t.name || t.tool || 'Tool';
    return TOOL_LABELS[name] || name;
  });

  return (
    <div className="tool-panel">
      <button
        className="tool-panel-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="tool-icon">{'>'}</span>
        <span className="tool-summary">
          {summary.length === 1 ? summary[0] : `${summary.length} tool calls`}
        </span>
        <span className={`tool-chevron ${expanded ? 'expanded' : ''}`}>
          {expanded ? 'v' : '>'}
        </span>
      </button>

      {expanded && (
        <div className="tool-panel-details">
          {tools.map((tool, i) => (
            <div key={i} className="tool-call">
              <div className="tool-name">{tool.name || tool.tool}</div>
              {tool.input && (
                <pre className="tool-input">{JSON.stringify(tool.input, null, 2)}</pre>
              )}
              {results && results[i] && (
                <div className="tool-result">
                  <pre>{typeof results[i] === 'string' ? results[i] : JSON.stringify(results[i], null, 2)}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
```

**Step 6: Create CodeBlock component**

Create `src/renderer/components/chat/CodeBlock.tsx`:
```tsx
import React, { useState, useCallback } from 'react';

interface Props {
  code: string;
  language?: string;
}

export const CodeBlock: React.FC<Props> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div className="code-block">
      <div className="code-block-header">
        {language && <span className="code-language">{language}</span>}
        <button className="copy-btn" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="code-content">
        <code className={language ? `language-${language}` : ''}>{code}</code>
      </pre>
    </div>
  );
};
```

**Step 7: Create ThinkingBlock component**

Create `src/renderer/components/chat/ThinkingBlock.tsx`:
```tsx
import React, { useState } from 'react';

interface Props {
  content: string;
}

export const ThinkingBlock: React.FC<Props> = ({ content }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="thinking-block">
      <button
        className="thinking-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="thinking-icon">Thinking</span>
        <span className={`thinking-chevron ${expanded ? 'expanded' : ''}`}>
          {expanded ? 'v' : '>'}
        </span>
      </button>
      {expanded && (
        <div className="thinking-content">
          {content}
        </div>
      )}
    </div>
  );
};
```

**Step 8: Create chat CSS**

Create `src/renderer/styles/chat.css` with styling for all chat components (messages, code blocks, tool panels, thinking blocks, streaming cursor animation). This is a large CSS file — see design document for layout specifications.

**Step 9: Commit**

```bash
git add src/renderer/components/chat/ src/renderer/styles/chat.css
git commit -m "feat: add chat UI components — messages, tools, code blocks, thinking"
```

---

### Task 3.3: Chat Container and Input Area

**Files:**
- Create: `src/renderer/components/chat/ChatContainer.tsx`
- Create: `src/renderer/components/chat/ChatInput.tsx`
- Create: `src/renderer/hooks/useClaudeSession.ts`

**Step 1: Create the useClaudeSession hook**

Create `src/renderer/hooks/useClaudeSession.ts`:
```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessageData } from '../components/chat/ChatMessage';

interface UseClaudeSessionOptions {
  sessionId: string | null;
  onKnowledgeSuggestion?: (content: string) => void;
}

export function useClaudeSession({ sessionId, onKnowledgeSuggestion }: UseClaudeSessionOptions) {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<any>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const [streamingToolCalls, setStreamingToolCalls] = useState<any[]>([]);
  const contentRef = useRef('');
  const thinkingRef = useRef('');

  // Load saved messages from database on session change
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }

    // Load from DB via IPC
    // window.electronAPI.getMessagesBySession(sessionId).then(setMessages);
  }, [sessionId]);

  // Subscribe to Claude events
  useEffect(() => {
    if (!sessionId) return;

    const unsubEvent = window.electronAPI.onClaudeEvent((sid: string, event: any) => {
      if (sid !== sessionId) return;

      switch (event.type) {
        case 'message_start':
          contentRef.current = '';
          thinkingRef.current = '';
          setStreamingContent('');
          setStreamingThinking('');
          setStreamingToolCalls([]);
          setIsRunning(true);
          break;

        case 'content_block_delta':
          if (event.delta?.type === 'text_delta') {
            contentRef.current += event.delta.text;
            setStreamingContent(contentRef.current);
          } else if (event.delta?.type === 'thinking_delta') {
            thinkingRef.current += event.delta.thinking;
            setStreamingThinking(thinkingRef.current);
          }
          break;

        case 'content_block_start':
          if (event.content_block?.type === 'tool_use') {
            setStreamingToolCalls(prev => [...prev, {
              name: event.content_block.name,
              id: event.content_block.id,
              input: {},
            }]);
          }
          break;

        case 'message_stop':
          // Finalize the message
          const finalMessage: ChatMessageData = {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: contentRef.current,
            messageType: 'text',
            thinking: thinkingRef.current || null,
            toolCalls: streamingToolCalls.length > 0 ? streamingToolCalls : null,
            createdAt: new Date(),
            isStreaming: false,
          };
          setMessages(prev => [...prev, finalMessage]);
          setStreamingContent('');
          setStreamingThinking('');
          setStreamingToolCalls([]);
          setIsRunning(false);

          // Save to DB
          // window.electronAPI.createChatMessage(finalMessage);
          break;
      }
    });

    const unsubState = window.electronAPI.onClaudeStateChange((sid: string, s: any) => {
      if (sid !== sessionId) return;
      setStatus(s);
    });

    const unsubEnded = window.electronAPI.onClaudeEnded((sid: string) => {
      if (sid !== sessionId) return;
      setIsRunning(false);
    });

    return () => {
      unsubEvent();
      unsubState();
      unsubEnded();
    };
  }, [sessionId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!sessionId || !content.trim()) return;

    // Add user message
    const userMsg: ChatMessageData = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      messageType: 'text',
      createdAt: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);

    // Save to DB
    // window.electronAPI.createChatMessage(userMsg);

    // Send to Claude
    if (messages.length === 0) {
      // First message — start new session
      const session = await window.electronAPI.getAllSessions();
      const sess = session.find((s: any) => s.id === sessionId);
      await window.electronAPI.claudeStart(sessionId, sess?.workingDir || '.', content);
    } else {
      // Follow-up — resume
      await window.electronAPI.claudeSend(sessionId, content);
    }
  }, [sessionId, messages]);

  const stopSession = useCallback(() => {
    if (sessionId) {
      window.electronAPI.claudeKill(sessionId);
    }
  }, [sessionId]);

  // Build the streaming message for display
  const currentStreamingMessage: ChatMessageData | null = isRunning && streamingContent
    ? {
        id: 'streaming',
        role: 'assistant',
        content: streamingContent,
        messageType: 'text',
        thinking: streamingThinking || null,
        toolCalls: streamingToolCalls.length > 0 ? streamingToolCalls : null,
        createdAt: new Date(),
        isStreaming: true,
      }
    : null;

  return {
    messages,
    isRunning,
    status,
    currentStreamingMessage,
    sendMessage,
    stopSession,
  };
}
```

**Step 2: Create ChatContainer component**

Create `src/renderer/components/chat/ChatContainer.tsx`:
```tsx
import React, { useRef, useEffect } from 'react';
import { ChatMessage, ChatMessageData } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useClaudeSession } from '../../hooks/useClaudeSession';

interface Props {
  sessionId: string | null;
  sessionName: string;
  workingDir: string;
}

export const ChatContainer: React.FC<Props> = ({ sessionId, sessionName, workingDir }) => {
  const {
    messages,
    isRunning,
    status,
    currentStreamingMessage,
    sendMessage,
    stopSession,
  } = useClaudeSession({ sessionId });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentStreamingMessage?.content]);

  const allMessages = [...messages];
  if (currentStreamingMessage) {
    allMessages.push(currentStreamingMessage);
  }

  if (!sessionId) {
    return (
      <div className="chat-container empty">
        <div className="chat-empty-state">
          <h2>Welcome to ClaudeLander</h2>
          <p>Select a session or create a new one to start chatting with Claude.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h3>{sessionName}</h3>
        <span className="chat-working-dir">{workingDir}</span>
        {status && (
          <span className={`chat-status ${status.state}`}>
            {status.description}
          </span>
        )}
      </div>

      <div className="chat-messages">
        {allMessages.length === 0 && (
          <div className="chat-welcome">
            <p>Start a conversation with Claude. Your messages are saved and searchable.</p>
          </div>
        )}

        {allMessages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        onSend={sendMessage}
        onStop={stopSession}
        isRunning={isRunning}
        disabled={!sessionId}
      />
    </div>
  );
};
```

**Step 3: Create ChatInput component**

Create `src/renderer/components/chat/ChatInput.tsx`:
```tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';

interface Props {
  onSend: (message: string) => void;
  onStop: () => void;
  isRunning: boolean;
  disabled: boolean;
}

export const ChatInput: React.FC<Props> = ({ onSend, onStop, isRunning, disabled }) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    if (!input.trim() || disabled) return;
    onSend(input.trim());
    setInput('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, onSend, disabled]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Ctrl+Enter or Cmd+Enter to send
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }
  }, [input]);

  return (
    <div className="chat-input-area">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={isRunning ? 'Claude is working...' : 'Message Claude... (Ctrl+Enter to send)'}
        disabled={disabled || isRunning}
        rows={1}
        className="chat-textarea"
      />
      <div className="chat-input-actions">
        {isRunning ? (
          <button className="btn stop-btn" onClick={onStop} title="Stop Claude">
            Stop
          </button>
        ) : (
          <button
            className="btn send-btn"
            onClick={handleSend}
            disabled={disabled || !input.trim()}
            title="Send message (Ctrl+Enter)"
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
};
```

**Step 4: Commit**

```bash
git add src/renderer/components/chat/ChatContainer.tsx src/renderer/components/chat/ChatInput.tsx src/renderer/hooks/useClaudeSession.ts
git commit -m "feat: add ChatContainer, ChatInput, and useClaudeSession hook"
```

---

### Task 3.4: Integrate Chat UI into App.tsx

**Files:**
- Modify: `src/renderer/App.tsx`

**Step 1: Replace Terminal component with ChatContainer**

In `src/renderer/App.tsx`:
- Replace `import Terminal from './components/Terminal'` with `import { ChatContainer } from './components/chat/ChatContainer'`
- Remove `import TerminalHeader from './components/TerminalHeader'`
- Remove `import RemoteTerminal from './components/RemoteTerminal'`
- Add `import './styles/chat.css'`
- Replace the terminal rendering section (where `<Terminal>` and `<TerminalHeader>` are used) with:

```tsx
<ChatContainer
  sessionId={activeSessionId}
  sessionName={activeSession?.name || 'Session'}
  workingDir={activeSession?.workingDir || ''}
/>
```

- Remove all PTY-related calls (`createSession`, `writeToSession`, `resizeSession`) and replace with Claude session calls
- Update session creation flow: instead of spawning a PTY, the first message in ChatInput triggers `claudeStart`

**Step 2: Build and verify**

Run: `npm run build`
Expected: Compiles without errors

**Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: replace Terminal with ChatContainer in main app"
```

---

**END OF PHASE 3**

Phase 3 delivers:
- Chat message components (user, assistant, system, error)
- Rich rendering: markdown, code blocks with syntax highlighting, collapsible tool panels, thinking blocks
- ChatContainer with auto-scroll, empty state, session header with status
- ChatInput with multi-line, auto-resize, Ctrl+Enter to send, stop button
- useClaudeSession hook bridging renderer to ClaudeSessionManager via IPC
- App.tsx integration replacing Terminal with ChatContainer

---

## Phase 4: Knowledge Extraction & Intelligence

This phase adds async knowledge extraction from conversations, inline suggestions, the promotion engine, and cross-session knowledge surfacing.

### Task 4.1: Domain Auto-Tagger

**Files:**
- Create: `src/main/knowledge/domain-tagger.ts`
- Create: `src/__tests__/domain-tagger.test.ts`

**Step 1: Write failing tests**

Create `src/__tests__/domain-tagger.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { detectDomains } from '../main/knowledge/domain-tagger';

describe('detectDomains', () => {
  it('should detect database domain', () => {
    expect(detectDomains('Fixed SQL query timeout by adding connection pooling')).toContain('database');
  });

  it('should detect auth domain', () => {
    expect(detectDomains('Added OAuth2 authentication flow with JWT tokens')).toContain('auth');
  });

  it('should detect testing domain', () => {
    expect(detectDomains('Write unit tests for the user service using vitest')).toContain('testing');
  });

  it('should detect multiple domains', () => {
    const domains = detectDomains('Fixed authentication bug in database migration');
    expect(domains).toContain('auth');
    expect(domains).toContain('database');
  });

  it('should return general for unrecognized content', () => {
    expect(detectDomains('Something happened')).toEqual(['general']);
  });

  it('should detect frontend domain', () => {
    expect(detectDomains('Updated React component with CSS grid layout')).toContain('frontend');
  });

  it('should detect devops domain', () => {
    expect(detectDomains('Configured Docker container with nginx reverse proxy')).toContain('devops');
  });
});
```

**Step 2: Implement domain tagger**

Create `src/main/knowledge/domain-tagger.ts`:
```typescript
const DOMAIN_PATTERNS: Record<string, RegExp[]> = {
  database: [/sql/i, /query/i, /database/i, /postgres/i, /mysql/i, /sqlite/i, /migration/i, /schema/i, /table/i, /index/i, /connection pool/i, /transaction/i, /orm/i],
  auth: [/auth/i, /oauth/i, /jwt/i, /token/i, /login/i, /password/i, /session/i, /permission/i, /rbac/i, /credential/i],
  testing: [/test/i, /spec/i, /vitest/i, /jest/i, /mock/i, /assert/i, /coverage/i, /tdd/i, /fixture/i],
  frontend: [/react/i, /css/i, /html/i, /component/i, /render/i, /dom/i, /layout/i, /style/i, /webpack/i, /vite/i, /ui\b/i, /ux/i],
  backend: [/api/i, /endpoint/i, /server/i, /middleware/i, /route/i, /handler/i, /express/i, /rest/i, /graphql/i],
  devops: [/docker/i, /kubernetes/i, /ci\/cd/i, /deploy/i, /nginx/i, /pipeline/i, /github action/i, /terraform/i, /aws/i, /cloud/i],
  performance: [/performance/i, /optimize/i, /cache/i, /latency/i, /memory leak/i, /profil/i, /bottleneck/i, /speed/i],
  security: [/security/i, /vulnerability/i, /xss/i, /csrf/i, /injection/i, /encrypt/i, /sanitiz/i, /owasp/i],
  architecture: [/architect/i, /pattern/i, /design/i, /refactor/i, /abstraction/i, /module/i, /dependency/i, /solid/i],
  error_handling: [/error/i, /exception/i, /catch/i, /throw/i, /retry/i, /fallback/i, /graceful/i, /stack trace/i],
};

export function detectDomains(content: string): string[] {
  const detected: string[] = [];

  for (const [domain, patterns] of Object.entries(DOMAIN_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        detected.push(domain);
        break;
      }
    }
  }

  return detected.length > 0 ? detected : ['general'];
}
```

**Step 3: Run tests**

Run: `npx vitest run src/__tests__/domain-tagger.test.ts`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/main/knowledge/domain-tagger.ts src/__tests__/domain-tagger.test.ts
git commit -m "feat: add domain auto-tagger for knowledge extraction"
```

---

### Task 4.2: Knowledge Extraction Engine

**Files:**
- Create: `src/main/knowledge/extractor.ts`
- Create: `src/__tests__/knowledge-extractor.test.ts`

**Step 1: Write failing tests**

Create `src/__tests__/knowledge-extractor.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { extractKnowledgeCandidates, KnowledgeCandidate } from '../main/knowledge/extractor';

describe('extractKnowledgeCandidates', () => {
  it('should extract a decision from conversation', () => {
    const candidates = extractKnowledgeCandidates(
      'Should I use PostgreSQL or MySQL?',
      'I recommend PostgreSQL for this project because it has better JSON support and more advanced indexing.'
    );
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0].content).toContain('PostgreSQL');
    expect(candidates[0].domains).toContain('database');
  });

  it('should extract an error fix', () => {
    const candidates = extractKnowledgeCandidates(
      'I am getting a "connection refused" error',
      'The issue is that the database connection pool was exhausted. I fixed it by increasing the pool size from 5 to 20 in the config.'
    );
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const fix = candidates.find(c => c.content.toLowerCase().includes('pool'));
    expect(fix).toBeDefined();
  });

  it('should extract a pattern from code changes', () => {
    const candidates = extractKnowledgeCandidates(
      'Add error handling to the API endpoints',
      'I wrapped all route handlers in try-catch blocks and added a centralized error handler middleware. This pattern ensures consistent error responses.'
    );
    expect(candidates.length).toBeGreaterThanOrEqual(1);
  });

  it('should return empty for trivial conversations', () => {
    const candidates = extractKnowledgeCandidates(
      'Hello',
      'Hello! How can I help you today?'
    );
    expect(candidates).toHaveLength(0);
  });
});
```

**Step 2: Implement extraction engine**

Create `src/main/knowledge/extractor.ts`:
```typescript
import { detectDomains } from './domain-tagger';

export interface KnowledgeCandidate {
  content: string;
  domains: string[];
  trigger: 'decision' | 'error_fix' | 'pattern' | 'insight';
  confidence: number;
}

// Patterns indicating knowledge-worthy content
const DECISION_PATTERNS = [
  /I recommend/i, /chose .+ over/i, /went with/i, /better (choice|option|approach)/i,
  /decided to/i, /prefer .+ because/i, /the (best|right) approach/i,
];

const ERROR_FIX_PATTERNS = [
  /fixed .+ by/i, /the (issue|problem|bug) (is|was)/i, /resolved .+ by/i,
  /the fix (is|was)/i, /solved .+ by/i, /root cause/i,
];

const PATTERN_INDICATORS = [
  /this pattern/i, /always .+ when/i, /best practice/i, /consistent/i,
  /centralized/i, /reusable/i, /convention/i,
];

const TRIVIAL_PATTERNS = [
  /^(hello|hi|hey|thanks|thank you|ok|okay|sure|got it)/i,
  /how can I help/i, /let me know/i,
];

function isTrivial(userMsg: string, assistantMsg: string): boolean {
  return (
    (userMsg.length < 20 && TRIVIAL_PATTERNS.some(p => p.test(userMsg))) ||
    (assistantMsg.length < 50)
  );
}

function extractDecisions(assistantMsg: string): string[] {
  const sentences = assistantMsg.split(/[.!]\s+/);
  return sentences.filter(s => DECISION_PATTERNS.some(p => p.test(s))).map(s => s.trim());
}

function extractErrorFixes(assistantMsg: string): string[] {
  const sentences = assistantMsg.split(/[.!]\s+/);
  return sentences.filter(s => ERROR_FIX_PATTERNS.some(p => p.test(s))).map(s => s.trim());
}

function extractPatterns(assistantMsg: string): string[] {
  const sentences = assistantMsg.split(/[.!]\s+/);
  return sentences.filter(s => PATTERN_INDICATORS.some(p => p.test(s))).map(s => s.trim());
}

export function extractKnowledgeCandidates(
  userMessage: string,
  assistantMessage: string
): KnowledgeCandidate[] {
  if (isTrivial(userMessage, assistantMessage)) return [];

  const candidates: KnowledgeCandidate[] = [];
  const fullContext = `${userMessage} ${assistantMessage}`;

  // Extract decisions
  for (const decision of extractDecisions(assistantMessage)) {
    if (decision.length > 20) {
      candidates.push({
        content: decision,
        domains: detectDomains(fullContext),
        trigger: 'decision',
        confidence: 0.7,
      });
    }
  }

  // Extract error fixes
  for (const fix of extractErrorFixes(assistantMessage)) {
    if (fix.length > 20) {
      candidates.push({
        content: fix,
        domains: detectDomains(fullContext),
        trigger: 'error_fix',
        confidence: 0.8,
      });
    }
  }

  // Extract patterns
  for (const pattern of extractPatterns(assistantMessage)) {
    if (pattern.length > 20) {
      candidates.push({
        content: pattern,
        domains: detectDomains(fullContext),
        trigger: 'pattern',
        confidence: 0.6,
      });
    }
  }

  return candidates;
}
```

**Step 3: Run tests**

Run: `npx vitest run src/__tests__/knowledge-extractor.test.ts`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/main/knowledge/extractor.ts src/__tests__/knowledge-extractor.test.ts
git commit -m "feat: add knowledge extraction engine for conversations"
```

---

### Task 4.3: Promotion Engine

**Files:**
- Create: `src/main/knowledge/promotion-engine.ts`
- Create: `src/__tests__/promotion-engine.test.ts`

**Step 1: Write failing tests**

Create `src/__tests__/promotion-engine.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initKnowledgeGraphTables } from '../main/database-knowledge';

let db: Database.Database;

vi.mock('../main/database', () => ({
  getDatabase: () => db,
}));

import { createKnowledgeNode, createKnowledgeEdge } from '../main/repositories/knowledge';
import { findPromotionCandidates, applyDecayPass } from '../main/knowledge/promotion-engine';

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE groups (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT DEFAULT '#888', working_dir TEXT DEFAULT '', "order" INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, group_id TEXT REFERENCES groups(id) ON DELETE CASCADE, name TEXT NOT NULL, working_dir TEXT NOT NULL, state TEXT DEFAULT 'idle', "order" INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP);
  `);
  initKnowledgeGraphTables(db);
  db.prepare(`INSERT INTO groups (id, name) VALUES ('grp-1', 'Test')`).run();
});

afterEach(() => {
  db.close();
});

describe('findPromotionCandidates (Tier 1 → Tier 2)', () => {
  it('should propose promotion when 3+ similar facts exist in same domain', () => {
    createKnowledgeNode({ id: 'n1', tier: 1, content: 'Always null-check auth responses', source: 'auto-extracted', domains: ['auth'] });
    createKnowledgeNode({ id: 'n2', tier: 1, content: 'Add null check for auth token validation', source: 'auto-extracted', domains: ['auth'] });
    createKnowledgeNode({ id: 'n3', tier: 1, content: 'Null check needed on auth middleware response', source: 'auto-extracted', domains: ['auth'] });

    const candidates = findPromotionCandidates();
    // Should find at least one promotion candidate from auth domain
    const authCandidates = candidates.filter(c => c.domains.includes('auth'));
    expect(authCandidates.length).toBeGreaterThanOrEqual(1);
    expect(authCandidates[0].fromTier).toBe(1);
    expect(authCandidates[0].toTier).toBe(2);
    expect(authCandidates[0].evidence.length).toBeGreaterThanOrEqual(3);
  });

  it('should not propose promotion with fewer than 3 facts', () => {
    createKnowledgeNode({ id: 'n1', tier: 1, content: 'Some auth fact', source: 'auto-extracted', domains: ['auth'] });
    createKnowledgeNode({ id: 'n2', tier: 1, content: 'Another auth fact', source: 'auto-extracted', domains: ['auth'] });

    const candidates = findPromotionCandidates();
    expect(candidates).toHaveLength(0);
  });
});

describe('applyDecayPass', () => {
  it('should decay old nodes', () => {
    createKnowledgeNode({ id: 'n1', tier: 1, content: 'Old fact', source: 'auto-extracted' });
    const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE knowledge_nodes SET last_reinforced_at = ? WHERE id = ?').run(twoWeeksAgo, 'n1');

    const decayed = applyDecayPass();
    expect(decayed).toBeGreaterThanOrEqual(1);
  });
});
```

**Step 2: Implement promotion engine**

Create `src/main/knowledge/promotion-engine.ts`:
```typescript
import { getDatabase } from '../database';
import {
  getKnowledgeNodesByTier,
  getKnowledgeNodesByDomain,
  applyConfidenceDecay,
} from '../repositories/knowledge';
import { KnowledgeNode, KnowledgeTier } from '../../shared/types';
import log from 'electron-log';

export interface PromotionCandidate {
  fromTier: KnowledgeTier;
  toTier: KnowledgeTier;
  proposedContent: string;
  domains: string[];
  evidence: string[];  // node IDs
  trigger: string;
}

/**
 * Find Tier 1 facts that could be promoted to Tier 2 patterns.
 * Groups facts by domain, finds clusters of 3+, proposes patterns.
 *
 * Uses simple text similarity (shared word overlap) rather than embeddings
 * for the initial version. Embeddings can be added later for better clustering.
 */
export function findPromotionCandidates(): PromotionCandidate[] {
  const candidates: PromotionCandidate[] = [];
  const tier1 = getKnowledgeNodesByTier(1, 500);

  // Group by domain
  const domainGroups = new Map<string, KnowledgeNode[]>();
  for (const node of tier1) {
    for (const domain of node.domains) {
      if (!domainGroups.has(domain)) {
        domainGroups.set(domain, []);
      }
      domainGroups.get(domain)!.push(node);
    }
  }

  // For each domain with 3+ facts, check for clusters
  for (const [domain, nodes] of domainGroups) {
    if (nodes.length < 3) continue;

    // Simple clustering: find groups of nodes with high word overlap
    const clusters = clusterByWordOverlap(nodes, 0.3);

    for (const cluster of clusters) {
      if (cluster.length < 3) continue;

      // Generate a pattern summary from the cluster
      const commonWords = findCommonKeywords(cluster);
      const proposedContent = `Pattern: ${commonWords.join(', ')} (from ${cluster.length} related observations in ${domain})`;

      candidates.push({
        fromTier: 1,
        toTier: 2,
        proposedContent,
        domains: [domain],
        evidence: cluster.map(n => n.id),
        trigger: 'repetition',
      });
    }
  }

  return candidates;
}

function clusterByWordOverlap(nodes: KnowledgeNode[], threshold: number): KnowledgeNode[][] {
  const clusters: KnowledgeNode[][] = [];
  const assigned = new Set<string>();

  for (let i = 0; i < nodes.length; i++) {
    if (assigned.has(nodes[i].id)) continue;

    const cluster = [nodes[i]];
    assigned.add(nodes[i].id);

    for (let j = i + 1; j < nodes.length; j++) {
      if (assigned.has(nodes[j].id)) continue;

      if (wordOverlap(nodes[i].content, nodes[j].content) >= threshold) {
        cluster.push(nodes[j]);
        assigned.add(nodes[j].id);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }

  return overlap / Math.min(wordsA.size, wordsB.size);
}

function findCommonKeywords(nodes: KnowledgeNode[]): string[] {
  const wordCounts = new Map<string, number>();
  for (const node of nodes) {
    const words = new Set(node.content.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  }

  // Words that appear in majority of nodes
  const threshold = Math.ceil(nodes.length * 0.5);
  return Array.from(wordCounts.entries())
    .filter(([_, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

/**
 * Apply confidence decay to all nodes that haven't been reinforced recently.
 * Should be called periodically (e.g., on app startup or every N sessions).
 */
export function applyDecayPass(): number {
  return applyConfidenceDecay(0.05, 7); // 5% per week
}
```

**Step 3: Run tests**

Run: `npx vitest run src/__tests__/promotion-engine.test.ts`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/main/knowledge/promotion-engine.ts src/__tests__/promotion-engine.test.ts
git commit -m "feat: add knowledge promotion engine with domain clustering and decay"
```

---

**END OF PHASE 4**

Phase 4 delivers:
- Domain auto-tagger (10 domains with keyword patterns)
- Knowledge extraction engine (decisions, error fixes, patterns from conversations)
- Promotion engine (Tier 1→2 via domain clustering and word overlap)
- Confidence decay pass (5% per week)

---

## Phase 5: MCP Server Updates

### Task 5.1: Replace Memory Tools with Knowledge Tools

**Files:**
- Modify: `src/mcp-server/index.ts`

Replace the 5 memory tools (search_memories, add_memory, list_memories, delete_memory, pin_memory) with 7 knowledge tools:

1. `search_knowledge(query, domains?, tier?, limit?)` — FTS + domain filter
2. `add_knowledge(content, tier, domains, groupId?, tags?)` — create node
3. `get_related(nodeId, relationship?, limit?)` — traverse edges
4. `promote_knowledge(nodeId, toTier, evidence?)` — propose promotion
5. `list_knowledge(groupId?, tier?, domains?, limit?)` — list nodes
6. `delete_knowledge(id)` — remove node
7. `pin_knowledge(id, pinned)` — toggle pin (boost/reduce confidence)

The `search_code`, `find_symbol`, `get_index_status`, `list_indexes`, `start_indexing` tools remain unchanged.

API endpoints on the Express server need corresponding updates in `src/main/api/routes/memories.ts` → rename to `knowledge.ts` with new endpoints.

**Step 1: Update MCP tool definitions**
**Step 2: Update API routes**
**Step 3: Test via MCP tool list**
**Step 4: Commit**

---

## Phase 6: Sharing, Mobile API & Hook Updates

### Task 6.1: Update Sharing for Chat Model

**Files:**
- Modify: `src/main/sharing/share-manager.ts`
- Modify: `src/main/api/routes/terminal.ts` → rename to `chat.ts`
- Modify: `src/main/api/ws-server.ts`

Instead of streaming encrypted terminal bytes, share structured conversation data:
- Host sends new chat messages as they arrive (JSON, not raw bytes)
- Guests see the rich chat UI with full scroll-back
- Encryption (X25519 + XChaCha20-Poly1305) still applies to message content
- WebSocket protocol changes from binary terminal data to JSON message events

### Task 6.2: Update Mobile API Endpoints

**Files:**
- Modify: `src/main/api/routes/sessions.ts`
- Remove: `src/main/api/routes/terminal.ts`
- Create: `src/main/api/routes/chat.ts`
- Modify: `src/main/api/ws-server.ts`

New endpoints:
- `GET /api/v1/sessions/:id/messages` — conversation history (replaces terminal buffer)
- `POST /api/v1/sessions/:id/messages` — send user message (replaces terminal input)
- WebSocket: stream new messages in real-time (replaces terminal data stream)

### Task 6.3: Update Hooks for Chat Model

**Files:**
- Modify: `src/hooks/claudelander-hook.ts`
- Modify: `src/main/api/routes/hooks.ts`

The hooks now process structured JSON from Claude Code instead of terminal output:
- Stop hook: Extract knowledge from the full conversation transcript
- Post-tool-use hook: Track tool usage for knowledge extraction
- Knowledge extraction runs asynchronously after each conversation turn

---

## Phase 7: Power User Features

### Task 7.1: Session Templates

**Files:**
- Create: `src/main/repositories/session-templates.ts`
- Create: `src/renderer/components/TemplateModal.tsx`
- Modify: `src/main/preload.ts`

CRUD for session templates: create, list, delete, "Start from template" button.

### Task 7.2: Conversation History Search

**Files:**
- Create: `src/renderer/components/SearchModal.tsx`
- Modify: `src/main/preload.ts`

Full-text search across all chat messages using the `chat_messages_fts` table.
Filter by session, date range, message type. Jump to any point in any conversation.

### Task 7.3: Conversation Branching

**Files:**
- Create: `src/renderer/components/chat/BranchSelector.tsx`
- Modify: `src/renderer/hooks/useClaudeSession.ts`
- Create: `src/main/repositories/conversation-branches.ts`

Fork from any message: duplicate messages up to fork point into a new branch,
start a new Claude session with that context. Branch selector in chat header.

### Task 7.4: Command Palette (Ctrl+K)

**Files:**
- Create: `src/renderer/components/CommandPalette.tsx`
- Modify: `src/renderer/hooks/useKeyboardShortcuts.ts`

Fuzzy search across: sessions, knowledge nodes, templates, history.
Keyboard-navigable list with categories. Binds to Ctrl+K globally.

---

## Phase 8: Knowledge Graph Explorer (Right Panel)

### Task 8.1: Graph Visualization Component

**Files:**
- Create: `src/renderer/components/panels/KnowledgeGraphPanel.tsx`
- Create: `src/renderer/components/panels/GraphCanvas.tsx`
- Create: `src/renderer/components/panels/NodeDetailPanel.tsx`

Interactive canvas-based graph visualization:
- Nodes as circles, sized by confidence, colored by tier
- Edges as lines with thickness by weight
- Force-directed layout using simple spring physics
- Click to select, filter by tier/domain/group
- Detail panel shows full content, edges, promotion history

---

## Phase 9: Migration & Cleanup

### Task 9.1: Remove Terminal Code

**Files to DELETE:**
- `src/renderer/components/Terminal.tsx`
- `src/renderer/components/TerminalHeader.tsx`
- `src/renderer/components/RemoteTerminal.tsx`
- `src/main/pty-manager.ts`
- `src/main/shell-detector.ts`
- `src/main/state-monitor.ts`

**Files to MODIFY:**
- `src/main/index.ts` — remove all PTY IPC handlers, PTY event forwarding, state monitor
- `src/main/preload.ts` — remove PTY methods (createSession, writeToSession, resizeSession, killSession, onPtyData, onPtyExit)
- `src/main/claude-launcher.ts` — remove shell/hook logic, simplify to just env var setup
- `src/renderer/App.tsx` — remove any remaining Terminal imports/references

**Dependencies to REMOVE from package.json:**
- `node-pty`
- `xterm`
- `xterm-addon-fit`
- `xterm-addon-webgl`

Run: `npm uninstall node-pty xterm xterm-addon-fit xterm-addon-webgl`

**Build config changes:**
- `electron-builder.yml` — remove `node-pty` from `asarUnpack`
- `package.json` — remove `node-pty` from `postinstall` electron-rebuild
- `scripts/copy-conpty.js` — DELETE (no longer needed)

### Task 9.2: Run Memory-to-Knowledge Migration on Startup

**Files:**
- Modify: `src/main/database.ts`

Add migration check: if `knowledge_nodes` table is empty and `memories` table has rows, run `migrateMemoriesToKnowledge()` automatically on first 3.0 launch.

### Task 9.3: Archive Existing Terminal Sessions

**Files:**
- Modify: `src/main/database.ts`

On first 3.0 launch, mark all existing sessions with `state = 'archived'`. Add 'archived' to the session state check constraint. Archived sessions appear in sidebar as read-only history (no chat, just metadata).

### Task 9.4: Update Preferences

**Files:**
- Modify: `src/main/index.ts` (prefs:getAll handler)
- Modify: `src/renderer/components/SettingsModal.tsx`

Remove terminal preferences: `fontSize`, `webglRenderer`, `customShellPath`
Add chat preferences: `sendShortcut` ('ctrl+enter' | 'enter'), `chatFontSize`, `showThinking` (boolean), `knowledgePanelOpen` (boolean)

### Task 9.5: Update electron-builder.yml

**Files:**
- Modify: `electron-builder.yml`

Remove node-pty related entries from `asarUnpack` and any ConPTY references.

### Task 9.6: Final Build Verification

**Step 1:** Run `npm run build`
**Step 2:** Run `npx vitest run`
**Step 3:** Run `npm run dist` for platform build
**Step 4:** Smoke test the packaged app

### Task 9.7: Version Bump and Release

**Step 1:** Update version to 3.0.0 in package.json
**Step 2:** Commit all changes
**Step 3:** Merge develop → main
**Step 4:** Push to trigger release build

---

**END OF ALL PHASES**

## Summary

| Phase | Tasks | What It Delivers |
|-------|-------|-----------------|
| 1: Foundation | 1.1–1.6 | Test framework, DB schema, types, repos, migration |
| 2: Claude Backend | 2.1–2.2 | ClaudeSessionManager, IPC wiring |
| 3: Chat UI | 3.1–3.4 | All chat components, input, hooks, App integration |
| 4: Knowledge Intelligence | 4.1–4.3 | Domain tagger, extractor, promotion engine |
| 5: MCP Server | 5.1 | Knowledge tools replacing memory tools |
| 6: Sharing/Mobile/Hooks | 6.1–6.3 | Chat-based sharing, new API endpoints, hook updates |
| 7: Power User | 7.1–7.4 | Templates, search, branching, command palette |
| 8: Knowledge Explorer | 8.1 | Interactive graph visualization panel |
| 9: Migration & Cleanup | 9.1–9.7 | Remove terminal, migrate data, build, release |

**Total estimated tasks:** 25 tasks across 9 phases
**Dependencies removed:** node-pty, xterm, xterm-addon-fit, xterm-addon-webgl
**Dependencies added:** vitest, marked, highlight.js, diff
**New files:** ~30+
**Files removed:** ~6
**Files modified:** ~20+
