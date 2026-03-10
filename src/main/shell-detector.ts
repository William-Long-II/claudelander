import { execSync, execFileSync } from 'child_process';
import * as fs from 'fs';

export interface ShellInfo {
  shell: string;
  args: string[];
  isWSL: boolean;
}

export function detectShell(customShellPath?: string): ShellInfo {
  // If custom shell path is provided and exists, use it
  if (customShellPath && customShellPath.trim()) {
    const trimmedPath = customShellPath.trim();
    if (fs.existsSync(trimmedPath)) {
      // Determine if it's WSL
      const isWSL = trimmedPath.toLowerCase().includes('wsl');
      const isWindows = process.platform === 'win32';
      const isPowerShell = trimmedPath.toLowerCase().includes('powershell');

      let args: string[] = [];
      if (isWSL) {
        args = [];
      } else if (isPowerShell) {
        args = ['-NoLogo'];
      } else if (!isWindows) {
        // Unix shell - use login + interactive flags
        args = ['-l', '-i'];
      }

      return {
        shell: trimmedPath,
        args,
        isWSL,
      };
    }
    console.warn(`Custom shell path not found: ${trimmedPath}, falling back to auto-detect`);
  }

  if (process.platform === 'win32') {
    return detectWindowsShell();
  }
  return detectUnixShell();
}

function detectWindowsShell(): ShellInfo {
  // Check for WSL with available distros
  const distros = getWSLDistros();
  if (distros.length > 0) {
    // Verify the distro actually works
    try {
      execFileSync('wsl.exe', ['-d', distros[0], 'echo', 'ok'], {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return {
        shell: 'C:\\Windows\\System32\\wsl.exe',
        args: ['-d', distros[0]], // Use first available distro
        isWSL: true,
      };
    } catch {
      // WSL distro doesn't work, fall through to PowerShell
    }
  }

  // Fallback to PowerShell (use full path for node-pty compatibility)
  const powershellPath = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  if (fs.existsSync(powershellPath)) {
    return {
      shell: powershellPath,
      args: ['-NoLogo'],
      isWSL: false,
    };
  }

  // Last resort: CMD
  const cmdPath = process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
  return {
    shell: cmdPath,
    args: [],
    isWSL: false,
  };
}

function detectUnixShell(): ShellInfo {
  const shell = process.env.SHELL || '/bin/zsh';

  // Verify shell exists, fallback to common shells
  let actualShell = shell;
  if (!fs.existsSync(shell)) {
    const fallbacks = ['/bin/zsh', '/bin/bash', '/bin/sh'];
    for (const fb of fallbacks) {
      if (fs.existsSync(fb)) {
        actualShell = fb;
        break;
      }
    }
  }

  return {
    shell: actualShell,
    args: ['-l', '-i'], // Login + interactive shell to load full user config
    isWSL: false,
  };
}

export function getWSLDistros(): string[] {
  try {
    // WSL outputs UTF-16LE with BOM, need to handle encoding properly
    const output = execSync('wsl.exe --list --quiet', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'], // Capture stderr too
      timeout: 5000, // 5 second timeout
    });

    // Remove null bytes and BOM characters that WSL adds
    const cleaned = output
      .replace(/\0/g, '') // Remove null bytes from UTF-16
      .replace(/^\uFEFF/, '') // Remove BOM
      .replace(/\r/g, ''); // Normalize line endings

    const distros = cleaned
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.includes('Windows Subsystem'));

    return distros;
  } catch {
    return [];
  }
}
