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
    return {
      shell: 'wsl.exe',
      args: ['-d', distros[0]], // Use first available distro
      isWSL: true,
    };
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
    const output = execSync('wsl.exe --list --quiet', { encoding: 'utf-8' });
    return output.split('\n').map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
