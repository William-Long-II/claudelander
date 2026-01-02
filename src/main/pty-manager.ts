import * as pty from 'node-pty';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import { getClaudeCommand, getSocketPath } from './claude-launcher';
import { detectShell, ShellInfo } from './shell-detector';
import { getPreference } from './repositories/preferences';

interface PtySession {
  id: string;
  pty: pty.IPty;
  cwd: string;
  isClaudeSession: boolean;
  shellInfo: ShellInfo;
  lastState: string;
  outputBuffer: string;
  idleTimeout: NodeJS.Timeout | null;
  workingDebounce: NodeJS.Timeout | null;
  recentOutputBytes: number;
  lastOutputTime: number;
}

class PtyManager extends EventEmitter {
  private sessions: Map<string, PtySession> = new Map();
  private socketPath: string;

  constructor() {
    super();
    this.socketPath = getSocketPath();
  }

  private getShellInfo(): ShellInfo {
    // Get custom shell path from preferences (re-read each time to pick up changes)
    const customShellPath = getPreference('customShellPath') || '';
    console.log('Custom shell path from preferences:', customShellPath || '(not set)');
    const result = detectShell(customShellPath);
    console.log('Detected shell:', result);
    return result;
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  getDefaultShellInfo(): ShellInfo {
    return this.getShellInfo();
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
    const shellInfo = this.getShellInfo();

    console.log('Creating session with shell:', shellInfo.shell, 'args:', shellInfo.args, 'isWSL:', shellInfo.isWSL);

    // Validate shell exists
    if (!shellInfo.shell || !fs.existsSync(shellInfo.shell)) {
      const errorMsg = `Shell not found: ${shellInfo.shell || '(empty)'}`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

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
      } else if (process.platform === 'win32') {
        // On Windows without WSL, run Claude through the shell
        // node-pty needs full paths, so use shell to resolve PATH
        shell = shellInfo.shell;
        if (shellInfo.shell.toLowerCase().includes('powershell')) {
          args = ['-NoLogo', '-Command', 'claude'];
        } else if (shellInfo.shell.toLowerCase().includes('cmd')) {
          args = ['/c', 'claude'];
        } else {
          // Assume bash-like shell (Git Bash, etc.)
          args = ['-c', 'claude'];
        }
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

      if (launchClaude) {
        this.detectClaudeState(id, data);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', { id, exitCode });
      this.sessions.delete(id);
    });

    this.sessions.set(id, {
      id,
      pty: ptyProcess,
      cwd,
      isClaudeSession: launchClaude,
      shellInfo,
      lastState: 'idle',
      outputBuffer: '',
      idleTimeout: null,
      workingDebounce: null,
      recentOutputBytes: 0,
      lastOutputTime: 0,
    });
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
      if (session.idleTimeout) {
        clearTimeout(session.idleTimeout);
      }
      if (session.workingDebounce) {
        clearTimeout(session.workingDebounce);
      }
      session.pty.kill();
      this.sessions.delete(id);
    }
  }

  getSession(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }

  private detectClaudeState(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) return;

    const now = Date.now();

    // Safety: ensure working state always has an idle timeout
    // This catches cases where filtered events come in but timeout was never set
    if (session.lastState === 'working' && !session.idleTimeout) {
      session.idleTimeout = setTimeout(() => {
        const sess = this.sessions.get(id);
        if (sess && sess.lastState === 'working') {
          sess.lastState = 'idle';
          sess.recentOutputBytes = 0;
          sess.idleTimeout = null;
          this.emit('stateChange', {
            sessionId: id,
            state: 'idle',
            event: 'idle_timeout',
            timestamp: Math.floor(Date.now() / 1000),
          });
        }
      }, 2000);
    }

    // Ignore mouse events (xterm mouse reporting)
    if (/\x1b\[M/.test(data) || /\x1b\[</.test(data)) {
      return;
    }

    // Ignore focus events
    if (/\x1b\[I/.test(data) || /\x1b\[O/.test(data)) {
      return;
    }

    // Strip ANSI codes and control characters for analysis
    const cleanData = data
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')  // ANSI escape codes
      .replace(/\x1b\[[0-9;]*[mM]/g, '')      // SGR sequences
      .replace(/\x1b\][^\x07]*\x07/g, '')      // OSC sequences
      .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '') // DCS, SOS, PM, APC sequences
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ''); // Control chars (keep \n, \r, \t)

    const printableContent = cleanData.replace(/\s/g, '').trim();

    // Ignore tiny outputs (cursor moves, redraws, etc.)
    if (printableContent.length < 3) {
      return;
    }

    // Ignore if raw data is mostly control sequences (resize/redraw events)
    // If less than 10% is printable content, it's likely a terminal control event
    if (data.length > 20 && printableContent.length < data.length * 0.1) {
      return;
    }

    // Add to output buffer for pattern matching
    session.outputBuffer = (session.outputBuffer + cleanData).slice(-2000);

    // Track recent output volume (reset if gap > 1 second)
    if (now - session.lastOutputTime > 1000) {
      session.recentOutputBytes = 0;
    }
    session.recentOutputBytes += printableContent.length;
    session.lastOutputTime = now;

    // Detect waiting for user input patterns (check recent buffer)
    const recentBuffer = session.outputBuffer.slice(-500);
    const waitingPatterns = [
      /\?\s*$/,                          // Ends with question mark
      /\(y\/n\)/i,                        // Yes/no prompt
      /\[Y\/n\]/i,                        // Yes/no prompt
      /Press Enter/i,                     // Press enter prompt
      /Enter to confirm/i,               // Claude confirmation prompt
      /Do you want to/i,                  // Permission prompts
      /Do you trust/i,                    // Trust folder prompt
      /Would you like/i,                  // Permission prompts
      /Allow.*Deny/s,                     // Claude permission dialog
      /Yes,\s*proceed/i,                  // Yes/No options
      /\d+\.\s*Yes/i,                     // Numbered Yes option
    ];

    let isWaiting = false;
    for (const pattern of waitingPatterns) {
      if (pattern.test(recentBuffer)) {
        isWaiting = true;
        break;
      }
    }

    if (isWaiting && session.lastState !== 'waiting') {
      // Immediately transition to waiting
      if (session.workingDebounce) {
        clearTimeout(session.workingDebounce);
        session.workingDebounce = null;
      }
      session.lastState = 'waiting';
      this.emit('stateChange', {
        sessionId: id,
        state: 'waiting',
        event: 'prompt_detected',
        timestamp: Math.floor(now / 1000),
      });
    } else if (!isWaiting && session.lastState !== 'working') {
      // Only transition to working after sustained output (200+ bytes)
      // Use debounce to avoid flickering
      if (session.recentOutputBytes > 200 && !session.workingDebounce) {
        session.workingDebounce = setTimeout(() => {
          const currentSession = this.sessions.get(id);
          if (currentSession && currentSession.recentOutputBytes > 200) {
            currentSession.lastState = 'working';
            currentSession.workingDebounce = null;
            this.emit('stateChange', {
              sessionId: id,
              state: 'working',
              event: 'sustained_output',
              timestamp: Math.floor(Date.now() / 1000),
            });
            // Set idle timeout immediately after transitioning to working
            if (!currentSession.idleTimeout) {
              currentSession.idleTimeout = setTimeout(() => {
                const sess = this.sessions.get(id);
                if (sess && sess.lastState === 'working') {
                  sess.lastState = 'idle';
                  sess.recentOutputBytes = 0;
                  sess.idleTimeout = null;
                  this.emit('stateChange', {
                    sessionId: id,
                    state: 'idle',
                    event: 'idle_timeout',
                    timestamp: Math.floor(Date.now() / 1000),
                  });
                }
              }, 2000);
            }
          }
        }, 300); // Wait 300ms of sustained output
      }
    }

    // Only reset idle timeout if there's substantial output (>10 printable chars)
    // This prevents cursor blinks and status updates from keeping "working" alive
    const isSubstantialOutput = printableContent.length > 10;

    if (isSubstantialOutput) {
      if (session.idleTimeout) {
        clearTimeout(session.idleTimeout);
        session.idleTimeout = null;
      }
    }

    // Set idle timeout if in working state and no active timeout
    if (session.lastState === 'working' && !session.idleTimeout) {
      session.idleTimeout = setTimeout(() => {
        const currentSession = this.sessions.get(id);
        if (currentSession && currentSession.lastState === 'working') {
          currentSession.lastState = 'idle';
          currentSession.recentOutputBytes = 0;
          currentSession.idleTimeout = null;
          this.emit('stateChange', {
            sessionId: id,
            state: 'idle',
            event: 'idle_timeout',
            timestamp: Math.floor(Date.now() / 1000),
          });
        }
      }, 2000);
    }
  }
}

export const ptyManager = new PtyManager();
