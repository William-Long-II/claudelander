import * as pty from 'node-pty';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { getClaudeCommand, getSocketPath } from './claude-launcher';
import { detectShell, ShellInfo } from './shell-detector';

interface PtySession {
  id: string;
  pty: pty.IPty;
  cwd: string;
  isClaudeSession: boolean;
  shellInfo: ShellInfo;
}

class PtyManager extends EventEmitter {
  private sessions: Map<string, PtySession> = new Map();
  private socketPath: string;
  private defaultShellInfo: ShellInfo;

  constructor() {
    super();
    this.socketPath = getSocketPath();
    this.defaultShellInfo = detectShell();
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  getDefaultShellInfo(): ShellInfo {
    return this.defaultShellInfo;
  }

  createSession(id: string, cwd: string, launchClaude: boolean = false): void {
    // Validate cwd exists
    if (!fs.existsSync(cwd)) {
      console.error(`Working directory does not exist: ${cwd}`);
      throw new Error(`Working directory does not exist: ${cwd}`);
    }

    let shell: string;
    let args: string[] = [];
    let env = process.env as { [key: string]: string };
    const shellInfo = this.defaultShellInfo;

    if (launchClaude) {
      const claudeConfig = getClaudeCommand({
        sessionId: id,
        projectDir: cwd,
        socketPath: this.socketPath,
      });

      if (shellInfo.isWSL) {
        // Launch Claude inside WSL
        shell = 'wsl.exe';
        args = [...shellInfo.args, '--', 'claude'];
        env = { ...env, ...claudeConfig.env } as { [key: string]: string };
      } else {
        shell = claudeConfig.command;
        args = claudeConfig.args;
        env = claudeConfig.env as { [key: string]: string };
      }
    } else {
      shell = shellInfo.shell;
      args = shellInfo.args;
    }

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: shellInfo.isWSL && !launchClaude ? undefined : cwd,
      env: env,
    });

    ptyProcess.onData((data) => {
      this.emit('data', { id, data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', { id, exitCode });
      this.sessions.delete(id);
    });

    this.sessions.set(id, { id, pty: ptyProcess, cwd, isClaudeSession: launchClaude, shellInfo });
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.write(data);
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.resize(cols, rows);
    }
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.pty.kill();
      this.sessions.delete(id);
    }
  }

  getSession(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }
}

export const ptyManager = new PtyManager();
