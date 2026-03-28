# ClaudeLander 3.0 — Design Document

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create the implementation plan from this design.

**Goal:** Transform ClaudeLander from a terminal-based session manager into an intelligent, chat-first development environment powered by a 3-tier knowledge graph.

**Version:** 3.0.0
**Date:** 2026-03-11
**Status:** Design Approved

---

## Executive Summary

ClaudeLander 3.0 is a ground-up reimagining of the user experience. Two architectural pillars drive every change:

1. **Chat-First Interface** — Replace the terminal emulator with a rich chat UI. Claude Code runs headless (JSON output mode) as the backend engine, preserving Claude Max subscription usage. All output is structured data rendered as markdown, code diffs, tool panels, and status indicators.

2. **3-Tier Knowledge Graph** — Replace the flat memory table with a graph-based knowledge system. Facts (Tier 1) emerge from sessions, promote to Patterns (Tier 2) through repetition and reinforcement, and crystallize into Principles (Tier 3) over time. Nodes connect via typed relationships across projects and domains.

Together, these pillars create a feedback loop: the chat UI enables structured knowledge extraction, extraction feeds the graph, the graph powers cross-session intelligence, and intelligence makes the chat experience magical.

---

## Pillar 1: Chat-First Interface

### Motivation

The terminal-based approach (xterm.js + node-pty + ConPTY) introduces:
- Platform-specific PTY bugs (ConPTY race conditions on Windows)
- State detection via regex heuristics (fragile, false positives)
- Raw terminal output that can't be structured or searched
- Shell escaping and encoding issues
- WebGL renderer complexity

By switching to Claude Code's JSON output mode, we eliminate all of this and gain structured data we fully control.

### Architecture

```
User Input (Chat UI)
  → Claude Code CLI (headless, --output-format stream-json)
    → Structured JSON responses
      → Chat Renderer (markdown, diffs, tool panels)
        → Knowledge Extractor (async, non-blocking)
          → Knowledge Graph
```

Claude Code remains the engine — preserving Claude Max subscription usage (no separate API charges). We spawn it as a subprocess with JSON streaming, not in a PTY.

### What Gets Removed

- xterm.js terminal emulator
- node-pty / ConPTY
- Terminal state detection heuristics (regex-based)
- WebGL terminal renderer
- Terminal resize handling
- Raw terminal scrollback buffers
- Shell detection logic (bash/zsh/PowerShell/WSL)

### Chat UI Layout

**Left Sidebar** (similar to 2.x but richer):
- Session groups with color coding
- Session entries showing rich status: "Editing src/auth.ts — adding OAuth flow" instead of just "working"
- Drag-and-drop reordering (preserved from 2.x)

**Main Area** — Chat conversation:
- User messages: text with markdown, file attachments, knowledge node references
- Claude messages: rendered markdown with collapsible sections for:
  - Syntax-highlighted code blocks (with copy + "Apply" buttons)
  - File diffs (before/after with accept/reject per hunk)
  - Shell command output (formatted, not terminal)
  - Thinking/reasoning (collapsible by default)
  - Tool use panels ("Read 3 files", "Edited auth.ts", "Ran tests")
- System messages: knowledge suggestions, session events, errors

**Right Panel** (collapsible):
- Knowledge graph explorer for current session/project

**Input Area:**
- Multi-line text input with markdown support
- File attachment (drag-and-drop or button)
- Context selector: pick knowledge nodes to include
- Configurable send: Ctrl+Enter or Enter

### Message Types

| Type | Source | Rendering |
|------|--------|-----------|
| User message | User input | Chat bubble, markdown |
| Assistant message | Claude response | Rich markdown, collapsible tool panels |
| Tool result | Claude Code tool execution | Styled output block (code, diff, search results) |
| System message | ClaudeLander | Knowledge suggestions, session events |
| Error message | Claude Code or system | Red-styled alert |

### Session Persistence

Full conversation history stored in database:
- Every message (user, assistant, system) persisted with timestamps
- Resume conversations across app restarts
- Scroll back through complete history
- Searchable across all sessions

### Session Status

Since every Claude response is structured JSON, we know exactly what's happening:
- What files are being read/edited
- What commands are running
- What the current task is
- Whether Claude is thinking, executing tools, or waiting for input

This replaces the fragile regex-based state detection with certainty.

---

## Pillar 2: 3-Tier Knowledge Graph

### Motivation

Current memory system is flat — rows in a table with types and tags. But knowledge is inherently connected and hierarchical:
- You encounter specific **facts** ("this error happened, this fix worked")
- Over time, **patterns** emerge ("when I see X, Y usually works")
- Eventually, **principles** crystallize ("always prefer X architecture because...")

No developer tool models this learning process. ClaudeLander 3.0 will.

### Data Architecture

#### Nodes Table
```sql
CREATE TABLE knowledge_nodes (
  id TEXT PRIMARY KEY,
  tier INTEGER NOT NULL CHECK(tier IN (1, 2, 3)),  -- 1=fact, 2=pattern, 3=principle
  content TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,          -- 0.0-1.0, decays over time
  source TEXT NOT NULL,                  -- auto-extracted, user-created, promoted
  scope_session_id TEXT,                 -- NULL for project/global scope
  scope_group_id TEXT,                   -- NULL for global scope
  domains TEXT NOT NULL DEFAULT '[]',    -- JSON array: ["database", "auth", "testing"]
  tags TEXT DEFAULT '[]',                -- JSON array for additional categorization
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_reinforced_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

#### Edges Table
```sql
CREATE TABLE knowledge_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL CHECK(relationship IN (
    'derived_from',   -- fact → pattern it promoted to
    'supports',       -- fact reinforces a pattern/principle
    'contradicts',    -- new fact conflicts with existing knowledge
    'relates_to',     -- conceptual connection across projects/domains
    'applied_in',     -- knowledge was used in a session
    'same_domain'     -- connects nodes sharing a domain
  )),
  weight REAL DEFAULT 1.0,              -- strength of connection, grows with reinforcement
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, target_id, relationship)
);
```

#### Promotion Log Table
```sql
CREATE TABLE knowledge_promotions (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  from_tier INTEGER NOT NULL,
  to_tier INTEGER NOT NULL,
  trigger TEXT NOT NULL,                -- repetition, time-tested, user-endorsed, cross-domain
  evidence TEXT NOT NULL DEFAULT '[]',  -- JSON: list of supporting node IDs
  promoted_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### Tier Definitions

**Tier 1 — Facts:**
- Specific events, fixes, decisions from sessions
- Examples: "Fixed auth bug by adding null check in middleware", "Chose PostgreSQL over MySQL for this project"
- Created automatically from session analysis or manually by user
- Scoped to session, project, or global

**Tier 2 — Patterns:**
- Recurring approaches that emerge from multiple facts
- Examples: "Always null-check auth responses at service boundaries", "Connection pooling resolves DB timeout issues"
- Created via promotion engine or manually
- Broader scope than facts — typically project or global

**Tier 3 — Principles:**
- High-level rules that crystallize from consistent patterns
- Examples: "Defensive coding at all service boundaries", "Prefer composition over inheritance"
- Created via promotion from well-tested patterns
- Almost always global scope

### Knowledge Extraction

Runs asynchronously after each Claude response. Analyzes the **full exchange** (user question + Claude response together):

**Extraction triggers:**
- **Decision made**: Claude chose approach A over B → Tier 1 fact
- **Error resolved**: Error occurred, Claude fixed it → Tier 1 fact
- **File pattern**: Claude structured code a specific way → Tier 1 fact
- **Explicit save**: User clicks "Save as knowledge" on any message → Tier 1 fact
- **Claude suggests**: Claude says "remember this" via MCP tool → Tier 1 fact

Domains are auto-tagged by analyzing content (e.g., mention of SQL/queries → "database" domain).

Proposed facts appear as subtle inline suggestions: "Save as knowledge?" with one-click accept/dismiss/edit. User stays in control.

### Promotion Engine

Runs periodically (every N sessions or on-demand), not real-time:

```
1. Cluster Tier 1 facts by domain
2. For each cluster with 3+ facts:
   a. Compare semantic similarity (reuse ONNX/bge-base embeddings from code search)
   b. Scope comparisons to same-domain clusters (keeps it lightweight)
   c. Cache similarity scores for repeated runs
   d. If similar enough → propose Tier 2 pattern
   e. Create "derived_from" edges to source facts
3. For each Tier 2 pattern:
   a. Count supporting edges (facts that reinforce it)
   b. Check for contradicting edges
   c. If confidence > 0.8 AND age > 2 weeks AND no contradictions
     → propose Tier 3 principle
4. Apply confidence decay (~5% per week without reinforcement)
5. Surface all promotions to user for approval (notification badge)
```

**Promotion triggers (Tier 1 → Tier 2):**
- Same type of fix applied multiple times (even within one project)
- A fact that keeps getting injected into sessions (stays relevant)
- User explicitly pins/highlights a fact
- A decision that influenced subsequent decisions (growing graph connections)
- Time-tested: fact still relevant after N sessions

**Promotion triggers (Tier 2 → Tier 3):**
- Pattern holds across different domains within a project
- Pattern the user never overrides or contradicts
- Pattern with many connected nodes in the graph
- User explicitly endorses ("I always do it this way")

### Confidence & Decay

- Every node has a confidence score (0.0-1.0)
- Decays ~5% per week without reinforcement
- Reinforced when: used in a session, user references it, new supporting edge added
- Contradictions reduce confidence but don't delete — they narrow scope
- Nodes below 0.1 confidence stop surfacing (but remain in graph for history)

### Cross-Session Intelligence

When Claude encounters a problem in Session B:
1. Extract domains from current context
2. Query knowledge graph for relevant nodes across all projects in those domains
3. Rank by: confidence, recency, relationship density
4. Inject top-K relevant nodes into Claude's context
5. If a strong match is found, surface proactively: "You solved a similar issue in Project X — here's what worked"

### Knowledge Graph Explorer (Right Panel)

Visual interactive graph showing:
- Nodes as circles, sized by confidence, colored by tier (blue=fact, purple=pattern, gold=principle)
- Edges as lines, thickness = weight
- Filter by: tier, domain, project, time range
- Click node to see full content, connections, promotion history
- Search across all knowledge

---

## Intelligence Features

### Rich Session Status

Since all Claude output is structured JSON:
- Sidebar shows contextual status: "Implementing OAuth — editing 2 files" not just "working"
- Status derived from actual tool calls, not regex guessing
- Progress indicators for multi-step tasks
- "Waiting for input" shows *what* Claude is asking about

### Proactive Suggestions

The system actively helps:
- Detects when Claude hits a known issue → surfaces relevant knowledge
- Suggests related sessions when working on similar domains
- Recommends knowledge nodes to include in context before starting a task
- Alerts when a new fact contradicts an existing pattern

### Auto-Knowledge Extraction

After each exchange:
1. Analyze user question + Claude response as a pair
2. Identify knowledge-worthy content (decisions, fixes, patterns)
3. Auto-tag domains
4. Propose as inline suggestion (non-blocking)
5. User approves/dismisses/edits with one click

---

## Power User Features

### Session Templates

Save session configurations as reusable templates:
- Working directory
- Initial prompt / instructions
- Knowledge context to include
- Group assignment
- Name pattern

One-click: "Start a new TDD session for this project."

### Conversation History Search

Full-text search across all sessions:
- Search message content, tool outputs, file names
- Filter by: session, group, date range, message type
- Jump to any point in any conversation
- "Find that time I set up Docker in the billing project"

Trivial to implement since everything is structured data.

### Conversation Branching

Fork any conversation from any message:
- "Claude went the wrong direction here" → branch from message N
- Try a different approach
- Compare branches side by side
- Merge insights back (create knowledge nodes from what worked)

This is a killer feature that's only possible because we control the chat UI. You can't branch a terminal session.

### Command Palette (Ctrl+K)

Quick access to everything:
- Switch sessions
- Search knowledge graph
- Start session from template
- Search conversation history
- Toggle panels
- All settings

Power users never touch the mouse.

---

## Sharing — Updated for Chat

Session sharing re-architected for chat model:

**What changes:**
- Instead of streaming encrypted terminal bytes, share structured conversation data
- Guests see the same rich chat UI (markdown, diffs, tool panels)
- Much better experience than watching raw terminal output

**What stays:**
- E2E encryption (X25519 + XChaCha20-Poly1305)
- Permission model (read vs control)
- Share codes (SYCLX- format)
- Relay server for remote access
- GitHub OAuth authentication

**Improvement:** Guests joining mid-session can scroll back through conversation history, not just see live output. Read permission becomes much more useful.

---

## Mobile API — Updated

API endpoints updated for chat model:
- `GET /api/v1/sessions/:id/messages` — conversation history (replaces terminal buffer)
- `POST /api/v1/sessions/:id/messages` — send user message (replaces terminal input)
- WebSocket: stream new messages in real-time (replaces terminal data stream)
- All other endpoints (groups, memories → knowledge, pairing) updated accordingly

Mobile app becomes a chat client rather than a terminal viewer — much better mobile UX.

---

## MCP Server — Expanded

Existing tools updated + new knowledge graph tools:

**Knowledge tools (replaces memory tools):**
- `search_knowledge(query, domains?, tier?, limit?)` — semantic search across graph
- `add_knowledge(content, tier, domains, groupId?, tags?)` — create node
- `get_related(nodeId, relationship?, limit?)` — traverse graph edges
- `promote_knowledge(nodeId, toTier, evidence?)` — propose promotion
- `list_knowledge(groupId?, tier?, domains?, limit?)` — list nodes
- `delete_knowledge(id)` — remove node
- `pin_knowledge(id, pinned)` — toggle pin

**Code search tools:** unchanged (search_code, find_symbol, etc.)

---

## Migration from 2.x

### Groups
Direct migration, no changes needed.

### Memories → Knowledge Graph
Each existing memory becomes a Tier 1 fact:
- `type` field maps to initial domain tag
- `pinned` memories get confidence boost (1.0 vs 0.8)
- `source` preserved (auto → auto-extracted, manual → user-created, claude → auto-extracted)
- Session and group scope preserved
- Run domain auto-tagging on first launch

### Code Indexes
No migration needed — stays as-is.

### Sessions
Existing terminal sessions cannot become chat conversations.
- Archive existing sessions as read-only history
- New sessions start fresh as chat
- Clean break, no data loss

### Preferences
- Terminal-specific preferences removed (fontSize, webglRenderer)
- Chat-specific preferences added (send shortcut, theme, panel layout)
- All other preferences carry over

---

## Technical Considerations

### Claude Code JSON Mode

Claude Code supports `--output-format stream-json` which emits structured events:
- `assistant` messages with content blocks (text, tool_use, tool_result)
- Streaming tokens for real-time rendering
- Tool execution results with structured output

We need to verify the exact JSON schema and streaming behavior before implementation begins. This is a critical dependency.

### Performance

- Knowledge graph queries via SQLite recursive CTEs — fast for graphs under 100K nodes
- Embedding comparisons scoped to same-domain clusters — avoids O(n^2) blowup
- Similarity scores cached between promotion runs
- Chat message rendering uses virtual scrolling for long conversations

### Security

- All 2.x security hardening carries forward (CSP, CORS, input validation, etc.)
- Knowledge graph inherits encryption model from sharing
- No new external service dependencies
- Claude Code subprocess sandboxed same as current PTY approach

---

## Deferred to 3.1

- **Batch Operations** — Run same prompt across multiple sessions. Complex UX for parallel result display. Valuable but not core to the 3.0 vision.

---

## Summary

| Area | 2.x | 3.0 |
|------|-----|-----|
| Interface | Terminal (xterm.js) | Chat UI (rich markdown) |
| Backend | PTY (node-pty) | Claude Code JSON (headless) |
| Knowledge | Flat memories table | 3-tier graph with relationships |
| Intelligence | Regex state detection | Structured data + cross-session insights |
| Status | "working" / "waiting" pills | "Editing auth.ts — adding OAuth flow" |
| Sharing | Encrypted terminal stream | Encrypted chat with scroll-back |
| Mobile | Terminal viewer | Chat client |
| State detection | Heuristic | Certain (structured output) |
| Branching | Impossible | Native feature |
| Search | Memory text search | Full conversation + knowledge search |
