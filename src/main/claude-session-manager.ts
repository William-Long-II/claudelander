import { spawn, ChildProcess, execSync } from 'child_process';
import { EventEmitter } from 'events';
import log from 'electron-log';
import { ClaudeJsonEvent, SessionStatus, SessionState3 } from '../shared/types';

const IS_WINDOWS = process.platform === 'win32';

interface ManagedSession {
  id: string;
  cwd: string;
  process: ChildProcess | null;
  claudeSessionId: string | null;
  state: SessionState3;
  description: string;
  currentTool: string | null;
  filesBeingEdited: string[];
  commandRunning: string | null;
  lastActivity: Date;
  stdoutBuffer: string;
  groupId: string | null;
}

/**
 * Manages Claude Code CLI subprocesses in headless JSON mode.
 * Replaces PtyManager for 3.0 chat-first architecture.
 *
 * Each session spawns: claude -p --output-format stream-json [prompt]
 * Follow-up messages use: claude -p --output-format stream-json --resume SESSION_ID [prompt]
 *
 * Emits:
 *   'event' — { sessionId, event: ClaudeJsonEvent }
 *   'session-ended' — { sessionId, exitCode }
 *   'state-change' — { sessionId, status: SessionStatus }
 *   'error' — { sessionId, error: string }
 */
export class ClaudeSessionManager extends EventEmitter {
  private sessions: Map<string, ManagedSession> = new Map();

  startSession(
    sessionId: string,
    cwd: string,
    prompt: string,
    options?: {
      groupId?: string;
      systemPrompt?: string;
      allowedTools?: string[];
      disallowedTools?: string[];
    }
  ): void {
    if (this.sessions.has(sessionId) && this.sessions.get(sessionId)!.process) {
      log.warn(`[ClaudeSession] Session ${sessionId} already running`);
      return;
    }

    const args = ['-p', '--output-format', 'stream-json'];

    if (options?.systemPrompt) {
      args.push('--append-system-prompt', options.systemPrompt);
    }

    if (options?.allowedTools) {
      args.push('--allowedTools', ...options.allowedTools);
    }

    if (options?.disallowedTools) {
      args.push('--disallowedTools', ...options.disallowedTools);
    }

    // The prompt itself
    args.push(prompt);

    const proc = spawn('claude', args, {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session: ManagedSession = {
      id: sessionId,
      cwd,
      process: proc,
      claudeSessionId: null,
      state: 'thinking',
      description: 'Starting...',
      currentTool: null,
      filesBeingEdited: [],
      commandRunning: null,
      lastActivity: new Date(),
      stdoutBuffer: '',
      groupId: options?.groupId ?? null,
    };

    this.sessions.set(sessionId, session);
    this.emitStateChange(session);

    proc.stdout!.on('data', (chunk: Buffer) => {
      this.handleStdoutData(sessionId, chunk);
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      log.warn(`[ClaudeSession] stderr for ${sessionId}:`, text);
      this.emit('error', { sessionId, error: text });
    });

    proc.on('close', (exitCode) => {
      const sess = this.sessions.get(sessionId);
      if (sess) {
        sess.process = null;
        sess.state = 'idle';
        sess.description = 'Idle';
        this.emitStateChange(sess);
      }
      this.emit('session-ended', { sessionId, exitCode });
    });

    proc.on('error', (err) => {
      log.error(`[ClaudeSession] Process error for ${sessionId}:`, err);
      const sess = this.sessions.get(sessionId);
      if (sess) {
        sess.state = 'error';
        sess.description = err.message;
        this.emitStateChange(sess);
      }
      this.emit('error', { sessionId, error: err.message });
    });
  }

  sendMessage(sessionId: string, prompt: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      log.error(`[ClaudeSession] No session ${sessionId} for sendMessage`);
      return;
    }

    // If process is still running, this shouldn't happen in normal flow
    if (session.process) {
      log.warn(`[ClaudeSession] Session ${sessionId} still has active process`);
      return;
    }

    const args = ['-p', '--output-format', 'stream-json'];

    // Resume the Claude session for multi-turn
    if (session.claudeSessionId) {
      args.push('--resume', session.claudeSessionId);
    }

    args.push(prompt);

    const proc = spawn('claude', args, {
      cwd: session.cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    session.process = proc;
    session.state = 'thinking';
    session.description = 'Thinking...';
    session.lastActivity = new Date();
    this.emitStateChange(session);

    proc.stdout!.on('data', (chunk: Buffer) => {
      this.handleStdoutData(sessionId, chunk);
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      log.warn(`[ClaudeSession] stderr for ${sessionId}:`, text);
      this.emit('error', { sessionId, error: text });
    });

    proc.on('close', (exitCode) => {
      session.process = null;
      session.state = 'idle';
      session.description = 'Idle';
      this.emitStateChange(session);
      this.emit('session-ended', { sessionId, exitCode });
    });

    proc.on('error', (err) => {
      log.error(`[ClaudeSession] Resume error for ${sessionId}:`, err);
      session.state = 'error';
      session.description = err.message;
      this.emitStateChange(session);
      this.emit('error', { sessionId, error: err.message });
    });
  }

  killSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.process) return Promise.resolve();

    const proc = session.process;
    const pid = proc.pid;

    return new Promise<void>((resolve) => {
      // Resolve when the process actually exits
      proc.once('close', () => resolve());

      if (IS_WINDOWS && pid) {
        // On Windows, kill the entire process tree to avoid orphan subprocesses
        try {
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
        } catch {
          // Process may have already exited
          proc.kill();
        }
      } else {
        proc.kill('SIGTERM');
        // Force kill after 3 seconds if still alive
        const forceKillTimer = setTimeout(() => {
          if (session.process) {
            proc.kill('SIGKILL');
          }
        }, 3000);
        proc.once('close', () => clearTimeout(forceKillTimer));
      }

      // Safety timeout — don't block forever
      setTimeout(() => resolve(), 5000);
    });
  }

  async killAll(): Promise<void> {
    const kills: Promise<void>[] = [];
    for (const [id] of this.sessions) {
      kills.push(this.killSession(id));
    }
    await Promise.all(kills);
  }

  async removeSession(sessionId: string): Promise<void> {
    await this.killSession(sessionId);
    this.sessions.delete(sessionId);
  }

  getSessionStatus(sessionId: string): SessionStatus {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        state: 'idle',
        description: 'No active session',
        lastActivity: new Date(),
      };
    }
    return {
      state: session.state,
      description: session.description,
      currentTool: session.currentTool ?? undefined,
      filesBeingEdited: session.filesBeingEdited.length > 0 ? session.filesBeingEdited : undefined,
      commandRunning: session.commandRunning ?? undefined,
      lastActivity: session.lastActivity,
    };
  }

  isSessionRunning(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session?.process;
  }

  getClaudeSessionId(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.claudeSessionId ?? null;
  }

  // ---- Private ----

  private handleStdoutData(sessionId: string, chunk: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.stdoutBuffer += chunk.toString();
    session.lastActivity = new Date();

    // Process complete NDJSON lines
    const lines = session.stdoutBuffer.split('\n');
    // Keep the last incomplete line in the buffer
    session.stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event: ClaudeJsonEvent = JSON.parse(trimmed);
        this.processEvent(sessionId, event);
        this.emit('event', { sessionId, event });
      } catch (e) {
        // Non-JSON output (shouldn't happen in stream-json mode, but be safe)
        log.debug(`[ClaudeSession] Non-JSON line for ${sessionId}: ${trimmed.substring(0, 100)}`);
      }
    }
  }

  private processEvent(sessionId: string, event: ClaudeJsonEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    switch (event.type) {
      case 'message_start':
        session.state = 'thinking';
        session.description = 'Thinking...';
        break;

      case 'content_block_start':
        if (event.content_block?.type === 'tool_use') {
          session.state = 'tool_executing';
          session.currentTool = event.content_block.name;
          session.description = `Using ${event.content_block.name}`;

          if (event.content_block.name === 'Bash') {
            session.description = 'Running command...';
          }
        } else if (event.content_block?.type === 'thinking') {
          session.state = 'thinking';
          session.description = 'Thinking...';
        } else {
          session.state = 'streaming';
          session.description = 'Responding...';
        }
        break;

      case 'content_block_delta':
        if (event.delta?.type === 'text_delta') {
          session.state = 'streaming';
          if (session.description === 'Thinking...') {
            session.description = 'Responding...';
          }
        } else if (event.delta?.type === 'input_json_delta') {
          try {
            const partial = event.delta.partial_json || '';
            if (session.currentTool === 'Edit' || session.currentTool === 'Write') {
              const fileMatch = partial.match(/"file_path"\s*:\s*"([^"]+)"/);
              if (fileMatch) {
                const file = fileMatch[1].split(/[/\\]/).pop() || fileMatch[1];
                session.description = `Editing ${file}`;
                if (!session.filesBeingEdited.includes(file)) {
                  session.filesBeingEdited.push(file);
                }
              }
            } else if (session.currentTool === 'Bash') {
              const cmdMatch = partial.match(/"command"\s*:\s*"([^"]+)"/);
              if (cmdMatch) {
                session.commandRunning = cmdMatch[1].substring(0, 50);
                session.description = `Running: ${session.commandRunning}`;
              }
            }
          } catch {
            // Partial JSON, not parseable yet
          }
        }
        break;

      case 'content_block_stop':
        if (session.state === 'tool_executing') {
          session.currentTool = null;
          session.commandRunning = null;
        }
        break;

      case 'message_delta':
        if (event.delta?.stop_reason === 'end_turn') {
          session.state = 'idle';
          session.description = 'Idle';
          session.filesBeingEdited = [];
        } else if (event.delta?.stop_reason === 'tool_use') {
          session.state = 'tool_executing';
        }
        break;

      case 'message_stop':
        if (event.session_id) {
          session.claudeSessionId = event.session_id;
        }
        break;

      case 'error':
        session.state = 'error';
        session.description = event.error?.message || 'Unknown error';
        break;
    }

    this.emitStateChange(session);
  }

  private emitStateChange(session: ManagedSession): void {
    this.emit('state-change', {
      sessionId: session.id,
      status: {
        state: session.state,
        description: session.description,
        currentTool: session.currentTool ?? undefined,
        filesBeingEdited: session.filesBeingEdited.length > 0 ? session.filesBeingEdited : undefined,
        commandRunning: session.commandRunning ?? undefined,
        lastActivity: session.lastActivity,
      },
    });
  }
}

export const claudeSessionManager = new ClaudeSessionManager();
