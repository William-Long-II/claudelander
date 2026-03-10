/**
 * Editor Launcher
 *
 * Detects installed editors and launches them to open files at specific lines.
 */

import { exec, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import log from 'electron-log';

const execAsync = promisify(exec);

export type EditorType = 'vscode' | 'cursor' | 'sublime' | 'atom' | 'notepadpp' | 'vim' | 'emacs' | 'idea' | 'webstorm';

interface EditorInfo {
  name: string;
  command: string;
  args: (file: string, line: number, column: number) => string[];
  detectCommands: string[];
}

const EDITORS: Record<EditorType, EditorInfo> = {
  vscode: {
    name: 'Visual Studio Code',
    command: 'code',
    args: (file, line, column) => ['--goto', `${file}:${line}:${column}`],
    detectCommands: ['code --version'],
  },
  cursor: {
    name: 'Cursor',
    command: 'cursor',
    args: (file, line, column) => ['--goto', `${file}:${line}:${column}`],
    detectCommands: ['cursor --version'],
  },
  sublime: {
    name: 'Sublime Text',
    command: process.platform === 'darwin' ? 'subl' : 'sublime_text',
    args: (file, line, column) => [`${file}:${line}:${column}`],
    detectCommands: ['subl --version', 'sublime_text --version'],
  },
  atom: {
    name: 'Atom',
    command: 'atom',
    args: (file, line, column) => [`${file}:${line}:${column}`],
    detectCommands: ['atom --version'],
  },
  notepadpp: {
    name: 'Notepad++',
    command: 'notepad++',
    args: (file, line) => ['-n' + line, file],
    detectCommands: [],
  },
  vim: {
    name: 'Vim',
    command: 'vim',
    args: (file, line) => [`+${line}`, file],
    detectCommands: ['vim --version'],
  },
  emacs: {
    name: 'Emacs',
    command: 'emacs',
    args: (file, line) => [`+${line}`, file],
    detectCommands: ['emacs --version'],
  },
  idea: {
    name: 'IntelliJ IDEA',
    command: 'idea',
    args: (file, line) => ['--line', String(line), file],
    detectCommands: ['idea --version'],
  },
  webstorm: {
    name: 'WebStorm',
    command: 'webstorm',
    args: (file, line) => ['--line', String(line), file],
    detectCommands: ['webstorm --version'],
  },
};

// Check if editor is available
async function isEditorAvailable(editor: EditorInfo): Promise<boolean> {
  if (editor.detectCommands.length === 0) {
    // For editors without detect commands, try to find the executable
    try {
      const which = process.platform === 'win32' ? 'where' : 'which';
      await execAsync(`${which} ${editor.command}`);
      return true;
    } catch {
      return false;
    }
  }

  for (const cmd of editor.detectCommands) {
    try {
      await execAsync(cmd);
      return true;
    } catch {
      // Try next command
    }
  }

  return false;
}

// Detect all available editors
export async function detectAvailableEditors(): Promise<EditorType[]> {
  const available: EditorType[] = [];

  for (const [type, info] of Object.entries(EDITORS) as [EditorType, EditorInfo][]) {
    try {
      if (await isEditorAvailable(info)) {
        available.push(type);
      }
    } catch {
      // Skip this editor
    }
  }

  return available;
}

// Get editor display name
export function getEditorName(type: EditorType): string {
  return EDITORS[type]?.name ?? type;
}

// Open file in editor
export async function openInEditor(
  filePath: string,
  line: number = 1,
  column: number = 1,
  preferredEditor?: EditorType
): Promise<{ success: boolean; error?: string }> {
  // Normalize path
  const normalizedPath = path.resolve(filePath);

  // Validate for Windows shell metacharacters to prevent command injection
  if (process.platform === 'win32' && /[&|><^]/.test(normalizedPath)) {
    return { success: false, error: 'Invalid characters in file path' };
  }

  // Check file exists
  if (!fs.existsSync(normalizedPath)) {
    return { success: false, error: `File not found: ${normalizedPath}` };
  }

  // Determine which editor to use
  let editorType: EditorType | null = null;

  if (preferredEditor && EDITORS[preferredEditor]) {
    const available = await isEditorAvailable(EDITORS[preferredEditor]);
    if (available) {
      editorType = preferredEditor;
    }
  }

  if (!editorType) {
    // Try to find any available editor
    const available = await detectAvailableEditors();
    if (available.length > 0) {
      // Prefer VS Code > Cursor > others
      const priority: EditorType[] = ['vscode', 'cursor', 'sublime', 'idea', 'webstorm', 'atom', 'vim', 'emacs'];
      for (const type of priority) {
        if (available.includes(type)) {
          editorType = type;
          break;
        }
      }
      if (!editorType) {
        editorType = available[0];
      }
    }
  }

  if (!editorType) {
    return { success: false, error: 'No supported editor found' };
  }

  const editor = EDITORS[editorType];
  const args = editor.args(normalizedPath, line, column);

  log.info(`[EditorLauncher] Opening ${normalizedPath}:${line}:${column} in ${editor.name}`);

  try {
    // Spawn detached so the editor doesn't block
    const child = spawn(editor.command, args, {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });

    child.unref();

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`[EditorLauncher] Failed to open editor: ${message}`);
    return { success: false, error: message };
  }
}

// Get list of editors for settings UI
export function getEditorOptions(): { value: EditorType; label: string }[] {
  return Object.entries(EDITORS).map(([type, info]) => ({
    value: type as EditorType,
    label: info.name,
  }));
}
