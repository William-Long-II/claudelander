import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';

// =============================================================================
// Types
// =============================================================================

export type SkillType = 'command' | 'role' | 'skill';

export interface SkillEntry {
  id: string;          // e.g. "cook-en:analyze-dependencies" or "atlassian:triage-issue"
  name: string;        // e.g. "analyze-dependencies"
  plugin: string;      // e.g. "cook-en"
  description: string;
  type: SkillType;
  path: string;        // absolute path to .md file
  model?: string;      // from frontmatter (roles only)
  tools?: string[];    // from frontmatter (roles only)
}

interface PluginRegistryFile {
  version: number;
  plugins: Record<string, Array<{
    scope: string;
    installPath: string;
    version: string;
    installedAt: string;
    lastUpdated: string;
    gitCommitSha?: string;
  }>>;
}

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  model?: string;
  tools?: string[];
  [key: string]: unknown;
}

// =============================================================================
// YAML Frontmatter Parser (lightweight, no external dep)
// =============================================================================

function parseFrontmatter(content: string): { frontmatter: ParsedFrontmatter | null; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: null, body: content };

  const yamlBlock = match[1];
  const body = match[2];
  const fm: ParsedFrontmatter = {};

  for (const line of yamlBlock.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Handle list items under a key (e.g. tools)
    if (trimmed.startsWith('- ')) {
      // Append to last array key
      const lastArrayKey = Object.keys(fm).reverse().find(k => Array.isArray(fm[k]));
      if (lastArrayKey) {
        (fm[lastArrayKey] as string[]).push(trimmed.slice(2).trim());
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();

    if (rawValue === '' || rawValue === '[]') {
      // Could be start of a list, or empty value
      fm[key] = [];
    } else {
      // Strip surrounding quotes
      const value = rawValue.replace(/^["']|["']$/g, '');
      fm[key] = value;
    }
  }

  // Convert tools to array if it's a string (inline format: [Read, Grep])
  if (typeof fm.tools === 'string') {
    const str = fm.tools as string;
    if (str.startsWith('[') && str.endsWith(']')) {
      fm.tools = str.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else {
      fm.tools = [str];
    }
  }

  return { frontmatter: fm, body };
}

// =============================================================================
// Skill Registry
// =============================================================================

let registry: SkillEntry[] = [];
let enabledPlugins: Record<string, boolean> = {};

function getPluginsDir(): string {
  return path.join(os.homedir(), '.claude', 'plugins');
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function getEnabledPlugins(): Record<string, boolean> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  const settings = readJsonSafe<{ enabledPlugins?: Record<string, boolean> }>(settingsPath);
  return settings?.enabledPlugins ?? {};
}

function descriptionFromMarkdown(body: string): string {
  // Try to extract a description from the first non-heading, non-empty line
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('```')) break;
    // Return first meaningful line, capped at 200 chars
    return trimmed.length > 200 ? trimmed.slice(0, 200) + '...' : trimmed;
  }
  return '';
}

function scanCommands(pluginName: string, pluginRoot: string): SkillEntry[] {
  const commandsDir = path.join(pluginRoot, 'commands');
  if (!fs.existsSync(commandsDir)) return [];

  const entries: SkillEntry[] = [];
  try {
    const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const filePath = path.join(commandsDir, file);
      const skillName = file.replace(/\.md$/, '');
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(content);
        entries.push({
          id: `${pluginName}:${skillName}`,
          name: frontmatter?.name || skillName,
          plugin: pluginName,
          description: (frontmatter?.description as string) || descriptionFromMarkdown(body),
          type: 'command',
          path: filePath,
        });
      } catch (err) {
        log.warn(`[SkillRegistry] Failed to read command ${filePath}:`, err);
      }
    }
  } catch (err) {
    log.warn(`[SkillRegistry] Failed to scan commands dir ${commandsDir}:`, err);
  }
  return entries;
}

function scanRoles(pluginName: string, pluginRoot: string): SkillEntry[] {
  const rolesDir = path.join(pluginRoot, 'agents', 'roles');
  if (!fs.existsSync(rolesDir)) return [];

  const entries: SkillEntry[] = [];
  try {
    const files = fs.readdirSync(rolesDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const filePath = path.join(rolesDir, file);
      const skillName = file.replace(/\.md$/, '');
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(content);
        entries.push({
          id: `${pluginName}:roles:${frontmatter?.name || skillName}`,
          name: (frontmatter?.name as string) || skillName,
          plugin: pluginName,
          description: (frontmatter?.description as string) || descriptionFromMarkdown(body),
          type: 'role',
          path: filePath,
          model: frontmatter?.model as string | undefined,
          tools: Array.isArray(frontmatter?.tools) ? frontmatter.tools as string[] : undefined,
        });
      } catch (err) {
        log.warn(`[SkillRegistry] Failed to read role ${filePath}:`, err);
      }
    }
  } catch (err) {
    log.warn(`[SkillRegistry] Failed to scan roles dir ${rolesDir}:`, err);
  }
  return entries;
}

function scanSkills(pluginName: string, pluginRoot: string): SkillEntry[] {
  const skillsDir = path.join(pluginRoot, 'skills');
  if (!fs.existsSync(skillsDir)) return [];

  const entries: SkillEntry[] = [];
  try {
    const subdirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
    for (const dir of subdirs) {
      const skillFile = path.join(skillsDir, dir.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      try {
        const content = fs.readFileSync(skillFile, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(content);
        entries.push({
          id: `${pluginName}:${frontmatter?.name || dir.name}`,
          name: (frontmatter?.name as string) || dir.name,
          plugin: pluginName,
          description: (frontmatter?.description as string) || descriptionFromMarkdown(body),
          type: 'skill',
          path: skillFile,
        });
      } catch (err) {
        log.warn(`[SkillRegistry] Failed to read skill ${skillFile}:`, err);
      }
    }
  } catch (err) {
    log.warn(`[SkillRegistry] Failed to scan skills dir ${skillsDir}:`, err);
  }
  return entries;
}

// =============================================================================
// Public API
// =============================================================================

export function buildRegistry(): SkillEntry[] {
  const startTime = Date.now();
  const pluginsDir = getPluginsDir();
  const registryPath = path.join(pluginsDir, 'installed_plugins.json');

  const installedPlugins = readJsonSafe<PluginRegistryFile>(registryPath);
  if (!installedPlugins?.plugins) {
    log.info('[SkillRegistry] No installed_plugins.json found or empty');
    registry = [];
    return registry;
  }

  enabledPlugins = getEnabledPlugins();
  const entries: SkillEntry[] = [];

  for (const [pluginKey, versions] of Object.entries(installedPlugins.plugins)) {
    // pluginKey is like "cook-en@claude-code-cookbook"
    const pluginName = pluginKey.split('@')[0];

    // Check if plugin is enabled
    if (enabledPlugins[pluginKey] === false) {
      log.info(`[SkillRegistry] Skipping disabled plugin: ${pluginKey}`);
      continue;
    }

    // Use the latest version (first entry)
    const latest = versions[0];
    if (!latest?.installPath) continue;

    const pluginRoot = latest.installPath;
    if (!fs.existsSync(pluginRoot)) {
      log.warn(`[SkillRegistry] Plugin path not found: ${pluginRoot}`);
      continue;
    }

    log.info(`[SkillRegistry] Scanning plugin: ${pluginName} at ${pluginRoot}`);

    // Scan all skill types
    entries.push(...scanCommands(pluginName, pluginRoot));
    entries.push(...scanRoles(pluginName, pluginRoot));
    entries.push(...scanSkills(pluginName, pluginRoot));
  }

  registry = entries;
  const elapsed = Date.now() - startTime;
  log.info(`[SkillRegistry] Built registry: ${entries.length} skills from ${Object.keys(installedPlugins.plugins).length} plugins (${elapsed}ms)`);
  return registry;
}

export function getRegistry(): SkillEntry[] {
  return registry;
}

export function getSkillById(id: string): SkillEntry | undefined {
  return registry.find(s => s.id === id);
}

export function getSkillContent(id: string): string | null {
  const skill = getSkillById(id);
  if (!skill) return null;

  try {
    const content = fs.readFileSync(skill.path, 'utf-8');
    return content || null; // treat empty file as null
  } catch (err) {
    log.error(`[SkillRegistry] Failed to read skill content for ${id}:`, err);
    return null;
  }
}

export function searchSkills(query: string): SkillEntry[] {
  if (!query.trim()) return registry;
  const lowerQuery = query.toLowerCase();
  return registry.filter(s =>
    s.id.toLowerCase().includes(lowerQuery) ||
    s.name.toLowerCase().includes(lowerQuery) ||
    s.plugin.toLowerCase().includes(lowerQuery) ||
    s.description.toLowerCase().includes(lowerQuery)
  );
}
