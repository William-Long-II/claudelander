import * as pty from 'node-pty';
import { EventEmitter } from 'events';

interface PtySession {
  id: string;
  pty: pty.IPty;
  cwd: string;
}

class PtyManager extends EventEmitter {
  private sessions: Map<string, PtySession> = new Map();

  getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/bash';
  }

  createSession(id: string, cwd: string): void {
    const shell = this.getDefaultShell();

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd,
      env: process.env as { [key: string]: string },
    });

    ptyProcess.onData((data) => {
      this.emit('data', { id, data });
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', { id, exitCode });
      this.sessions.delete(id);
    });

    this.sessions.set(id, { id, pty: ptyProcess, cwd });
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
