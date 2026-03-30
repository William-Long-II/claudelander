/**
 * MCP Server and Hooks Auto-Configuration
 *
 * Automatically registers the ClaudeLander Memory MCP server and hooks with Claude Code
 * so users don't need to manually configure them.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import log from 'electron-log';

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface HookEntry {
  type: string;
  command: string;
}

interface HookConfig {
  matcher: string;
  hooks: (string | HookEntry)[];
}

interface ClaudeMcpConfig {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

interface ClaudeSettingsConfig {
  hooks?: {
    PostToolUse?: HookConfig[];
    Stop?: HookConfig[];
    Notification?: HookConfig[];
    [key: string]: HookConfig[] | undefined;
  };
  [key: string]: unknown;
}

const MCP_SERVER_NAME = 'claudelander-memory';
const HOOK_IDENTIFIER = 'claudelander-hook';

/**
 * Get the path to the MCP server script
 */
function getMcpServerPath(): string {
  // In development, use the dist folder relative to the project
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'dist', 'mcp-server', 'index.js');
  }

  // In production, the MCP server is in the resources folder
  // For asar-packed apps, it's in app.asar/dist/mcp-server
  // But we need it outside asar for Node to run it directly
  const resourcesPath = process.resourcesPath;

  // Check for unpacked location first (if we configure electron-builder to unpack it)
  const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked', 'dist', 'mcp-server', 'index.js');
  if (fs.existsSync(unpackedPath)) {
    return unpackedPath;
  }

  // Fall back to regular path (may not work if inside asar)
  return path.join(resourcesPath, 'app', 'dist', 'mcp-server', 'index.js');
}

/**
 * Get the path to Claude Code's config file
 * MCP servers are stored in ~/.claude.json (not ~/.claude/settings.json)
 */
function getClaudeConfigPath(): string {
  const homeDir = os.homedir();

  // Claude Code stores MCP servers in ~/.claude.json on all platforms
  return path.join(homeDir, '.claude.json');
}

/**
 * Read Claude Code MCP config (~/.claude.json), returning empty object if doesn't exist
 */
function readClaudeMcpConfig(): ClaudeMcpConfig {
  const configPath = getClaudeConfigPath();

  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    log.warn('[MCP Config] Failed to read Claude MCP config:', err);
  }

  return {};
}

/**
 * Write Claude Code MCP config
 */
function writeClaudeMcpConfig(config: ClaudeMcpConfig): boolean {
  const configPath = getClaudeConfigPath();

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (err) {
    log.error('[MCP Config] Failed to write Claude MCP config:', err);
    return false;
  }
}

/**
 * Get path to Claude Code settings file (~/.claude/settings.json)
 * This is where hooks are configured
 */
function getClaudeSettingsPath(): string {
  const homeDir = os.homedir();
  return path.join(homeDir, '.claude', 'settings.json');
}

/**
 * Read Claude Code settings (~/.claude/settings.json)
 */
function readClaudeSettings(): ClaudeSettingsConfig {
  const settingsPath = getClaudeSettingsPath();

  try {
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    log.warn('[Hooks Config] Failed to read Claude settings:', err);
  }

  return {};
}

/**
 * Write Claude Code settings
 */
function writeClaudeSettings(settings: ClaudeSettingsConfig): boolean {
  const settingsPath = getClaudeSettingsPath();

  try {
    // Ensure .claude directory exists
    const claudeDir = path.dirname(settingsPath);
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    return true;
  } catch (err) {
    log.error('[Hooks Config] Failed to write Claude settings:', err);
    return false;
  }
}

/**
 * Get the path to the hook handler script
 */
function getHookScriptPath(): string {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'dist', 'hooks', 'claudelander-hook.js');
  }

  const resourcesPath = process.resourcesPath;

  // Check for unpacked location first
  const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked', 'dist', 'hooks', 'claudelander-hook.js');
  if (fs.existsSync(unpackedPath)) {
    return unpackedPath;
  }

  return path.join(resourcesPath, 'app', 'dist', 'hooks', 'claudelander-hook.js');
}

/**
 * Check if our MCP server is already configured with the correct path
 */
function isServerConfigured(config: ClaudeMcpConfig, expectedPath: string): boolean {
  const serverConfig = config.mcpServers?.[MCP_SERVER_NAME];
  if (!serverConfig) return false;

  // Check if the path matches
  const configuredPath = serverConfig.args?.[0];
  return configuredPath === expectedPath;
}

/**
 * Check if our hooks are already configured
 */
function areHooksConfigured(settings: ClaudeSettingsConfig, hookScriptPath: string): boolean {
  const hooks = settings.hooks;
  if (!hooks) return false;

  // Check if any hook contains our identifier
  const hookStr = (h: string | HookEntry): string => typeof h === 'string' ? h : h.command || '';
  const checkHookType = (hookConfigs: HookConfig[] | undefined): boolean => {
    if (!hookConfigs) return false;
    return hookConfigs.some(config =>
      config.hooks.some(h => hookStr(h).includes(HOOK_IDENTIFIER) || hookStr(h).includes(hookScriptPath))
    );
  };

  return checkHookType(hooks.PostToolUse) || checkHookType(hooks.Stop);
}

/**
 * Register the ClaudeLander Memory MCP server with Claude Code
 * Returns true if configuration was added/updated, false if already configured
 */
export function registerMcpServer(): { success: boolean; action: 'added' | 'updated' | 'unchanged' | 'error'; path?: string; error?: string } {
  try {
    const mcpServerPath = getMcpServerPath();

    // Verify the MCP server exists
    if (!fs.existsSync(mcpServerPath)) {
      log.warn('[MCP Config] MCP server not found at:', mcpServerPath);
      return { success: false, action: 'error', error: `MCP server not found at ${mcpServerPath}` };
    }

    const config = readClaudeMcpConfig();

    // Check if already configured correctly
    if (isServerConfigured(config, mcpServerPath)) {
      log.info('[MCP Config] MCP server already configured correctly');
      return { success: true, action: 'unchanged', path: mcpServerPath };
    }

    // Determine if we're adding or updating
    const action = config.mcpServers?.[MCP_SERVER_NAME] ? 'updated' : 'added';

    // Add or update the MCP server configuration
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    config.mcpServers[MCP_SERVER_NAME] = {
      command: 'node',
      args: [mcpServerPath],
    };

    // Write the updated config
    if (writeClaudeMcpConfig(config)) {
      log.info(`[MCP Config] MCP server ${action} successfully:`, mcpServerPath);
      return { success: true, action, path: mcpServerPath };
    } else {
      return { success: false, action: 'error', error: 'Failed to write config file' };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error('[MCP Config] Error registering MCP server:', errorMsg);
    return { success: false, action: 'error', error: errorMsg };
  }
}

/**
 * Register ClaudeLander hooks with Claude Code
 * Adds hooks for PostToolUse (git commits) and Stop (session summaries)
 */
export function registerHooks(): { success: boolean; action: 'added' | 'updated' | 'unchanged' | 'error'; error?: string } {
  try {
    const hookScriptPath = getHookScriptPath();

    // Verify the hook script exists
    if (!fs.existsSync(hookScriptPath)) {
      log.warn('[Hooks Config] Hook script not found at:', hookScriptPath);
      return { success: false, action: 'error', error: `Hook script not found at ${hookScriptPath}` };
    }

    const settings = readClaudeSettings();

    // Check if already configured
    if (areHooksConfigured(settings, hookScriptPath)) {
      log.info('[Hooks Config] Hooks already configured');
      return { success: true, action: 'unchanged' };
    }

    // Determine if we're adding or updating
    const action = settings.hooks ? 'updated' : 'added';

    // Initialize hooks object if needed
    if (!settings.hooks) {
      settings.hooks = {};
    }

    // Build the hook command - Claude Code expects { type, command } objects
    const nodeCmd = 'node';
    const makeHookCmd = (hookType: string): HookEntry => ({
      type: 'command',
      command: `cat | ${nodeCmd} -e "require('${hookScriptPath.replace(/\\/g, '/')}')" ${hookType}`,
    });

    // PreToolUse hook for permission approval fallback (3.1)
    const preToolUseHook: HookConfig = {
      matcher: '',  // Match ALL tools for permission checks
      hooks: [makeHookCmd('PreToolUse')],
    };

    // PostToolUse hook for Bash (captures git commits)
    const postToolUseHook: HookConfig = {
      matcher: 'Bash',
      hooks: [makeHookCmd('PostToolUse')],
    };

    // Stop hook (captures session summaries after significant work)
    const stopHook: HookConfig = {
      matcher: '',  // Match all stops
      hooks: [makeHookCmd('Stop')],
    };

    // Remove any existing ClaudeLander hooks first
    const filterOurHooks = (configs: HookConfig[] | undefined): HookConfig[] => {
      if (!configs) return [];
      return configs.filter(config =>
        !config.hooks.some(h => { const s = typeof h === 'string' ? h : h.command || ''; return s.includes(HOOK_IDENTIFIER) || s.includes('claudelander'); })
      );
    };

    // Add our hooks
    settings.hooks.PreToolUse = [...filterOurHooks(settings.hooks.PreToolUse), preToolUseHook];
    settings.hooks.PostToolUse = [...filterOurHooks(settings.hooks.PostToolUse), postToolUseHook];
    settings.hooks.Stop = [...filterOurHooks(settings.hooks.Stop), stopHook];

    // Write the updated settings
    if (writeClaudeSettings(settings)) {
      log.info(`[Hooks Config] Hooks ${action} successfully`);
      return { success: true, action };
    } else {
      return { success: false, action: 'error', error: 'Failed to write settings file' };
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error('[Hooks Config] Error registering hooks:', errorMsg);
    return { success: false, action: 'error', error: errorMsg };
  }
}

/**
 * Unregister the ClaudeLander Memory MCP server from Claude Code
 */
export function unregisterMcpServer(): boolean {
  try {
    const config = readClaudeMcpConfig();

    if (config.mcpServers?.[MCP_SERVER_NAME]) {
      delete config.mcpServers[MCP_SERVER_NAME];

      // Clean up empty mcpServers object
      if (Object.keys(config.mcpServers).length === 0) {
        delete config.mcpServers;
      }

      if (writeClaudeMcpConfig(config)) {
        log.info('[MCP Config] MCP server unregistered successfully');
        return true;
      }
    }

    return false;
  } catch (err) {
    log.error('[MCP Config] Error unregistering MCP server:', err);
    return false;
  }
}

/**
 * Unregister ClaudeLander hooks from Claude Code
 */
export function unregisterHooks(): boolean {
  try {
    const settings = readClaudeSettings();

    if (!settings.hooks) return false;

    let modified = false;

    // Remove our hooks from each hook type
    const filterOurHooks = (configs: HookConfig[] | undefined): HookConfig[] | undefined => {
      if (!configs) return undefined;
      const filtered = configs.filter(config =>
        !config.hooks.some(h => { const s = typeof h === 'string' ? h : h.command || ''; return s.includes(HOOK_IDENTIFIER) || s.includes('claudelander'); })
      );
      if (filtered.length !== configs.length) modified = true;
      return filtered.length > 0 ? filtered : undefined;
    };

    settings.hooks.PostToolUse = filterOurHooks(settings.hooks.PostToolUse);
    settings.hooks.Stop = filterOurHooks(settings.hooks.Stop);

    // Clean up empty hooks object
    if (settings.hooks.PostToolUse === undefined) delete settings.hooks.PostToolUse;
    if (settings.hooks.Stop === undefined) delete settings.hooks.Stop;
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    if (modified && writeClaudeSettings(settings)) {
      log.info('[Hooks Config] Hooks unregistered successfully');
      return true;
    }

    return false;
  } catch (err) {
    log.error('[Hooks Config] Error unregistering hooks:', err);
    return false;
  }
}

/**
 * Get the current MCP server configuration status
 */
export function getMcpServerStatus(): { configured: boolean; path?: string; expectedPath?: string } {
  try {
    const expectedPath = getMcpServerPath();
    const config = readClaudeMcpConfig();
    const serverConfig = config.mcpServers?.[MCP_SERVER_NAME];

    if (!serverConfig) {
      return { configured: false, expectedPath };
    }

    return {
      configured: true,
      path: serverConfig.args?.[0],
      expectedPath,
    };
  } catch (err) {
    log.error('[MCP Config] Error getting MCP server status:', err);
    return { configured: false };
  }
}

/**
 * Get the current hooks configuration status
 */
export function getHooksStatus(): { configured: boolean; hookScriptPath?: string } {
  try {
    const hookScriptPath = getHookScriptPath();
    const settings = readClaudeSettings();
    const configured = areHooksConfigured(settings, hookScriptPath);

    return { configured, hookScriptPath };
  } catch (err) {
    log.error('[Hooks Config] Error getting hooks status:', err);
    return { configured: false };
  }
}
