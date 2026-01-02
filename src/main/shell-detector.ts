import { execSync } from 'child_process';
import * as fs from 'fs';

export interface ShellInfo {
  shell: string;
  args: string[];
  isWSL: boolean;
}

export function detectShell(): ShellInfo {
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
      execSync(`wsl.exe -d "${distros[0]}" echo ok`, {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return {
        shell: 'wsl.exe',
        args: ['-d', distros[0]], // Use first available distro
        isWSL: true,
      };
    } catch {
      // WSL distro doesn't work, fall through to PowerShell
    }
  }

  // Fallback to PowerShell or CMD
  const powershell = process.env.COMSPEC?.includes('powershell')
    || fs.existsSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');

  if (powershell) {
    return {
      shell: 'powershell.exe',
      args: ['-NoLogo'],
      isWSL: false,
    };
  }

  return {
    shell: process.env.COMSPEC || 'cmd.exe',
    args: [],
    isWSL: false,
  };
}

function detectUnixShell(): ShellInfo {
  const shell = process.env.SHELL || '/bin/bash';
  return {
    shell,
    args: [],
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
