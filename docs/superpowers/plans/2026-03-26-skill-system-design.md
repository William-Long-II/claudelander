# Skill System for ClaudeLander 3.0 — Design Document

**Status:** Approved design, not yet implemented
**Created:** 2026-03-26
**Context:** ClaudeLander 3.0 switched from interactive terminal to `claude -p` one-shot mode, losing access to slash commands, skills, and plugin invocations. This document describes the approach to restore skill functionality without switching back to interactive mode.

---

## Problem

In 2.x (interactive terminal), users could invoke skills like:
- `/cook-en:brainstorm Feature X`
- `/bodhi:start-task PROJ-123`
- `/superpowers:writing-plans`
- `/atlassian:triage-issue`

In 3.0 (`claude -p` mode), these don't exist. Each message is a one-shot invocation with no interactive session for slash commands.

## Key Insight

**Skills are markdown prompt files on disk.** They're not compiled code — they're instructions that tell Claude how to behave. Claude in `-p` mode already has full tool access (Bash, Read, Write, MCP tools). The only missing piece is injecting the skill prompt.

**Multi-turn is already solved.** The `--resume SESSION_ID` flag preserves conversation history across `-p` invocations. A brainstorm skill that requires back-and-forth works naturally: skill prompt → Claude responds → user replies → `--resume` continues.

## Architecture

### Phase 1: Skill Registry + Invocation

#### Skill Registry Scanner (`src/main/skill-registry.ts`)

On app startup, scan the plugin system:

1. Read `~/.claude/plugins/installed_plugins.json` (v2 registry)
2. For each enabled plugin, read `<installPath>/.claude-plugin/plugin.json`
3. Discover skills by scanning:
   - `commands/*.md` — cook-en (39), bodhi (21)
   - `agents/roles/*.md` — cook-en (9)
   - `skills/*/SKILL.md` — atlassian (5)
4. Parse each file: extract YAML frontmatter (name, description, model, tools) and content
5. Build in-memory registry: `{ id, name, plugin, description, path, type }`

**Registry is rebuilt on startup** and can be refreshed via IPC call.

#### Skill File Formats

| Plugin Type | Path Pattern | Metadata | Content |
|------------|-------------|----------|---------|
| cook-en commands | `commands/*.md` | None (plain markdown) | Full prompt instructions |
| cook-en roles | `agents/roles/*.md` | YAML frontmatter (name, description, model, tools) | Role instructions |
| bodhi commands | `commands/*.md` | None | Workflow with Skill tool references |
| atlassian skills | `skills/*/SKILL.md` | YAML frontmatter (name, description) | Multi-step workflow |

#### Chat Input Interceptor

When user types `/` in the chat input:

1. Show autocomplete dropdown with matching skills (filtered by typed text)
2. Display: skill name, plugin source, description
3. On selection, read the `.md` file content
4. Inject as the first message: `[skill prompt content]\n\n---\n\nUser request: [user's args]`
5. Send via normal `claude -p` flow (or `--resume` if continuing)

#### IPC Handlers

```
skill:listAll → returns skill registry entries (id, name, plugin, description)
skill:getContent(id) → reads and returns the full .md file content
skill:invoke(sessionId, skillId, userArgs) → loads skill, prepends to prompt, sends to Claude
```

#### Command Palette Integration

Skills appear in Ctrl+K alongside sessions and templates:
- Type `/` or search by skill name
- Shows plugin source (cook-en, bodhi, atlassian)
- Selecting a skill opens chat with skill prompt pre-loaded

### Phase 2: Plugin Management UI

#### Plugin Manager Panel

A new panel (or settings tab) showing:

- **Installed Plugins** — name, version, source, enable/disable toggle
- **Available Skills** per plugin — name, description, last used
- **MCP Servers** — registered servers, connection status, configuration

#### MCP Server Management

- List registered MCP servers from `~/.claude/settings.json` mcpServers
- Show connection status (running/stopped)
- Allow adding/removing servers
- Configure environment variables and args

#### Plugin Discovery (future)

- Browse marketplace registries
- Install/update plugins from within the app

## File Structure

```
src/main/skill-registry.ts          — scanner + in-memory registry
src/main/api/routes/skills.ts       — REST API for mobile
src/renderer/components/chat/SkillAutocomplete.tsx  — / dropdown in chat input
src/renderer/components/panels/PluginManagerPanel.tsx — Phase 2 panel
```

## Plugin Cache Locations (Windows)

```
Registry:     ~/.claude/plugins/installed_plugins.json
Marketplaces: ~/.claude/plugins/known_marketplaces.json
Plugin root:  ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
Plugin meta:  <plugin-root>/.claude-plugin/plugin.json
Settings:     ~/.claude/settings.json (enabledPlugins, mcpServers)
```

## Risks and Mitigations

1. **Bodhi commands reference other skills via Skill tool** — When injected as a prompt, Claude may try to call the Skill tool which isn't available in `-p` mode. Mitigation: intercept Skill tool references and resolve them inline before injection.

2. **Plugin cache paths change on updates** — The version directory changes. Mitigation: always resolve from `installed_plugins.json` installPath, never hardcode.

3. **Large skill files** — Some skills are very detailed (multi-KB). Mitigation: inject only the skill content, don't duplicate into system prompt AND user prompt.

4. **Model/tool restrictions in skill metadata** — Some roles specify `model: opus` or limited `tools: [Read, Grep]`. Mitigation: pass model from frontmatter to `--model` flag, but don't restrict tools (Claude in `-p` mode uses permission mode, not tool allowlists by default).

## Implementation Priority

1. `skill-registry.ts` — scanner and registry (foundation)
2. IPC handlers — `skill:listAll`, `skill:getContent`
3. `SkillAutocomplete.tsx` — `/` dropdown in chat input
4. Command palette integration — skills in Ctrl+K
5. Plugin Manager panel — Phase 2
6. MCP server management — Phase 2
