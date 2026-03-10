import * as pty from 'node-pty';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { EventEmitter } from 'events';
import { getClaudeCommand, getSocketPath } from './claude-launcher';
import { detectShell, ShellInfo } from './shell-detector';
import { getPreference } from './repositories/preferences';
import { writeMemoryFile, getMemoryInjectionContent } from './memory/injector';
import log from 'electron-log';

function redactEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  return Object.fromEntries(
    Object.entries(env).map(([k, v]) => [
      k,
      /key|secret|token|password|auth/i.test(k) ? '[REDACTED]' : v,
    ])
  );
}

interface PtySession {
  id: string;
  pty: pty.IPty;
  cwd: string;
  groupId: string | null;  // For memory injection
  isClaudeSession: boolean;
  shellInfo: ShellInfo;
  lastState: string;
  outputBuffer: string;
  scrollbackBuffer: string;  // Larger buffer for terminal history
  idleTimeout: NodeJS.Timeout | null;
  workingDebounce: NodeJS.Timeout | null;
  recentOutputBytes: number;
  lastOutputTime: number;
}

// Max scrollback buffer size (100KB should be plenty for recent terminal history)
const MAX_SCROLLBACK_SIZE = 100 * 1024;

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

  createSession(id: string, cwd: string, launchClaude: boolean = false, groupId: string | null = null): void {
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

      // Get memory content for system prompt injection
      // Pass via environment variable to avoid shell escaping issues with newlines
      let claudeCmd = 'claude';
      let processEnv = { ...env, ...claudeConfig.env } as { [key: string]: string };

      if (groupId) {
        const memoryContent = getMemoryInjectionContent(id, groupId, cwd);
        if (memoryContent) {
          processEnv.CLAUDELANDER_SYSTEM_PROMPT = memoryContent;
        }
      }

      if (shellInfo.isWSL) {
        // Launch Claude inside WSL
        shell = 'wsl.exe';
        if (processEnv.CLAUDELANDER_SYSTEM_PROMPT) {
          claudeCmd = 'claude --append-system-prompt "$CLAUDELANDER_SYSTEM_PROMPT"';
        }
        args = [...shellInfo.args, '--', 'bash', '-c', claudeCmd];
        env = processEnv;
      } else if (process.platform === 'win32') {
        // On Windows without WSL, run Claude through the shell
        shell = shellInfo.shell;
        if (shellInfo.shell.toLowerCase().includes('powershell')) {
          if (processEnv.CLAUDELANDER_SYSTEM_PROMPT) {
            claudeCmd = 'claude --append-system-prompt $env:CLAUDELANDER_SYSTEM_PROMPT';
          }
          args = ['-NoLogo', '-Command', claudeCmd];
        } else if (shellInfo.shell.toLowerCase().includes('cmd')) {
          if (processEnv.CLAUDELANDER_SYSTEM_PROMPT) {
            claudeCmd = 'claude --append-system-prompt "%CLAUDELANDER_SYSTEM_PROMPT%"';
          }
          args = ['/c', claudeCmd];
        } else {
          // Assume bash-like shell (Git Bash, etc.)
          if (processEnv.CLAUDELANDER_SYSTEM_PROMPT) {
            claudeCmd = 'claude --append-system-prompt "$CLAUDELANDER_SYSTEM_PROMPT"';
          }
          args = ['-c', claudeCmd];
        }
        env = processEnv;
      } else {
        // macOS/Linux: run Claude through interactive login shell
        shell = shellInfo.shell;
        if (processEnv.CLAUDELANDER_SYSTEM_PROMPT) {
          claudeCmd = 'claude --append-system-prompt "$CLAUDELANDER_SYSTEM_PROMPT"';
        }
        args = ['-l', '-i', '-c', claudeCmd];
        env = processEnv;
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
      // Windows ConPTY options to reduce race conditions (error 299)
      ...(process.platform === 'win32' ? {
        useConptyDll: true,  // Use bundled ConPTY DLL from Windows Terminal (often newer/more stable)
        conptyInheritCursor: false,  // Don't inherit cursor - cleaner startup
      } : {}),
    });

    ptyProcess.onData((data) => {
      // Filter out Windows ConPTY error messages
      // Win32 error 299 (ERROR_PARTIAL_COPY) is a race condition when reading from
      // a terminating process. Using useConptyDll should reduce these occurrences.
      // We still filter the error message text if it appears.
      let filteredData = data;
      if (process.platform === 'win32') {
        // Remove "windows pid XXXXX, Win32 error NNN" error messages
        filteredData = filteredData.replace(/windows pid \d+, Win32 error \d+/gi, '');
        // If the entire chunk was just the error message, skip emitting
        if (filteredData.trim() === '') {
          return;
        }
      }

      // Append to scrollback buffer
      const session = this.sessions.get(id);
      if (session) {
        session.scrollbackBuffer += filteredData;
        // Trim if too large (keep last MAX_SCROLLBACK_SIZE bytes)
        if (session.scrollbackBuffer.length > MAX_SCROLLBACK_SIZE) {
          session.scrollbackBuffer = session.scrollbackBuffer.slice(-MAX_SCROLLBACK_SIZE);
        }
      }

      this.emit('data', { id, data: filteredData });

      if (launchClaude) {
        this.detectClaudeState(id, data);
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.emit('exit', { id, exitCode });
      this.sessions.delete(id);
    });

    // Write memory file for Claude sessions (for reference)
    if (launchClaude && groupId) {
      writeMemoryFile(id, groupId, cwd);
    }

    this.sessions.set(id, {
      id,
      pty: ptyProcess,
      cwd,
      groupId,
      isClaudeSession: launchClaude,
      shellInfo,
      lastState: 'idle',
      outputBuffer: '',
      scrollbackBuffer: '',
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

  kill(id: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const session = this.sessions.get(id);
      if (!session) {
        resolve();
        return;
      }

      if (session.idleTimeout) {
        clearTimeout(session.idleTimeout);
      }
      if (session.workingDebounce) {
        clearTimeout(session.workingDebounce);
      }

      const pid = session.pty.pid;
      let exited = false;

      const onExit = () => {
        if (exited) return;
        exited = true;
        this.sessions.delete(id);
        resolve();
      };

      // Listen for normal exit
      session.pty.onExit(() => onExit());

      // Send graceful kill signal
      session.pty.kill();

      // Force-kill after 3 seconds if process hasn't exited (Windows only)
      if (process.platform === 'win32' && pid) {
        setTimeout(() => {
          if (!exited) {
            log.warn(`[PTY] Force-killing session ${id} (pid ${pid}) after 3s timeout`);
            try {
              execFile('taskkill', ['/F', '/T', '/PID', String(pid)], (err) => {
                if (err) {
                  log.error(`[PTY] taskkill failed for pid ${pid}:`, err);
                }
                onExit();
              });
            } catch (err) {
              log.error(`[PTY] Failed to spawn taskkill for pid ${pid}:`, err);
              onExit();
            }
          }
        }, 3000);
      } else {
        // On non-Windows, fall back to a timeout cleanup
        setTimeout(() => {
          if (!exited) {
            log.warn(`[PTY] Session ${id} did not exit within 3s, cleaning up`);
            onExit();
          }
        }, 3000);
      }
    });
  }

  async killAll(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.kill(id)));
  }

  getSession(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }

  /**
   * Get the scrollback buffer for a session
   */
  getBuffer(id: string): string {
    const session = this.sessions.get(id);
    return session?.scrollbackBuffer || '';
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
      /Enter to select/i,                // Claude Code selection menu prompt
      /Tab\/Arrow keys to navigate/i,    // Claude Code selection menu
      /Esc to cancel/i,                  // Claude Code selection menu
      /Do you want to/i,                  // Permission prompts
      /Do you trust/i,                    // Trust folder prompt
      /Would you like/i,                  // Permission prompts
      /Allow.*Deny/s,                     // Claude permission dialog
      /Yes,\s*proceed/i,                  // Yes/No options
      /\d+\.\s*Yes/i,                     // Numbered Yes option
      /Type something/i,                  // Claude Code "Type something" option
      />\s*\d+\./,                        // Selected numbered option (> 1.)
      // Conversational questions from Claude asking for feedback/confirmation
      /does this.{0,50}work for you\?/i,      // "Does this approach work for you?"
      /does this.{0,50}look right/i,          // "Does this look right?"
      /does that.{0,50}work/i,                // "Does that work for you?"
      /does that.{0,50}make sense/i,          // "Does that make sense?"
      /what do you think\?/i,                 // "What do you think?"
      /how does this look\?/i,                // "How does this look?"
      /is this.{0,30}(okay|ok|correct|right)\?/i, // "Is this okay?"
      /should I.{0,50}\?/i,                   // "Should I proceed?"
      /shall I.{0,50}\?/i,                    // "Shall I continue?"
      /let me know.{0,30}(if|when|what)/i,    // "Let me know if..."
      /any.{0,20}(feedback|thoughts|questions)\?/i, // "Any feedback?"
      /sound good\?/i,                        // "Sound good?"
      /ready to.{0,30}\?/i,                   // "Ready to proceed?"
      /want me to.{0,50}\?/i,                 // "Want me to continue?"
      /proceed with/i,                        // "Proceed with this approach?"
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
