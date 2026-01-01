import * as pty from 'node-pty';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { getClaudeCommand, getSocketPath } from './claude-launcher';

interface PtySession {
  id: string;
  pty: pty.IPty;
  cwd: string;
  isClaudeSession: boolean;
}

class PtyManager extends EventEmitter {
  private sessions: Map<string, PtySession> = new Map();
  private socketPath: string;

  constructor() {
    super();
    this.socketPath = getSocketPath();
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
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

    if (launchClaude) {
      const claudeConfig = getClaudeCommand({
        sessionId: id,
        projectDir: cwd,
        socketPath: this.socketPath,
      });
      shell = claudeConfig.command;
      args = claudeConfig.args;
      env = claudeConfig.env as { [key: string]: string };
    } else {
      shell = this.getDefaultShell();
    }

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd,
      env: env,
    });

    ptyProcess.onData((data) => {
      this.emit('data', { id, data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', { id, exitCode });
      this.sessions.delete(id);
    });

    this.sessions.set(id, { id, pty: ptyProcess, cwd, isClaudeSession: launchClaude });
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
