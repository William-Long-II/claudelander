import { spawn, ChildProcess, execSync } from 'child_process';
import { EventEmitter } from 'events';
import log from 'electron-log';
import { ClaudeJsonEvent, SessionStatus, SessionState3, ClaudeConfig, PermissionRequest, DiffReviewData } from '../shared/types';
import { configToCliArgs } from './claude-config-resolver';
import { evaluatePermission } from './permission-evaluator';
import { evaluateGuard } from './filesystem-guard';
import { worktreeManager } from './worktree-manager';
import * as crypto from 'crypto';

const IS_WINDOWS = process.platform === 'win32';

function cleanEnvForClaude(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // Remove CLAUDECODE so nested Claude CLI instances don't refuse to start
  delete env.CLAUDECODE;
  return env;
}

interface PendingPermission {
  requestId: string;
  resolve: (result: { behavior: 'allow' | 'deny'; updatedInput?: Record<string, unknown>; message?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
}

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
  controlProtocolActive: boolean;
  pendingPermissions: Map<string, PendingPermission>;
  /** True when permissionMode is 'fullAuto' (sandboxed) */
  isFullAuto: boolean;
  /** Worktree path for sandboxed sessions */
  worktreePath: string | null;
}

/**
 * Manages Claude Code CLI subprocesses in headless JSON mode.
 *
 * 3.1: Uses --input-format stream-json and --permission-prompt-tool stdio
 * for bidirectional control protocol. Keeps stdin open for permission responses.
 *
 * Emits:
 *   'event' — { sessionId, event: ClaudeJsonEvent }
 *   'session-ended' — { sessionId, exitCode }
 *   'state-change' — { sessionId, status: SessionStatus }
 *   'error' — { sessionId, error: string }
 *   'permission-request' — { sessionId, request: PermissionRequest }
 */
export class ClaudeSessionManager extends EventEmitter {
  private sessions: Map<string, ManagedSession> = new Map();

  /** Permission auto-deny timeout (5 minutes) */
  private static readonly PERMISSION_TIMEOUT_MS = 300_000;

  startSession(
    sessionId: string,
    cwd: string,
    prompt: string,
    options?: {
      groupId?: string;
      claudeConfig?: ClaudeConfig;
      resumeSessionId?: string;
    }
  ): void {
    if (this.sessions.has(sessionId) && this.sessions.get(sessionId)!.process) {
      log.warn(`[ClaudeSession] Session ${sessionId} already running`);
      return;
    }

    const isFullAuto = options?.claudeConfig?.permissionMode === 'fullAuto';
    let effectiveCwd = cwd;
    let worktreePath: string | null = null;

    // For fullAuto mode: create a git worktree and use it as the cwd
    if (isFullAuto) {
      try {
        const wtInfo = worktreeManager.create(cwd, sessionId);
        effectiveCwd = wtInfo.worktreePath;
        worktreePath = wtInfo.worktreePath;
        log.info(`[ClaudeSession] FullAuto: created worktree at ${worktreePath}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(`[ClaudeSession] Failed to create worktree for fullAuto: ${msg}`);
        this.emit('error', { sessionId, error: `Sandbox setup failed: ${msg}` });
        return;
      }
    }

    const args = this.buildArgs(options?.claudeConfig, options?.resumeSessionId, isFullAuto);

    if (options?.claudeConfig) {
      // For fullAuto, strip the permissionMode from config-to-CLI since we handle it ourselves
      const configForArgs = isFullAuto
        ? { ...options.claudeConfig, permissionMode: undefined }
        : options.claudeConfig;
      args.push(...configToCliArgs(configForArgs));
    }

    log.info(`[ClaudeSession] Spawning: claude ${args.join(' ').substring(0, 120)}`);
    log.info(`[ClaudeSession] CWD: ${effectiveCwd}, prompt length: ${prompt.length}`);

    const proc = spawn('claude', args, {
      cwd: effectiveCwd,
      env: cleanEnvForClaude(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: IS_WINDOWS,
    });

    log.info(`[ClaudeSession] Process spawned, PID: ${proc.pid}`);

    // Write prompt as stream-json input, keep stdin OPEN for control protocol responses
    proc.stdin!.write(JSON.stringify({ type: 'user_message', content: prompt }) + '\n');
    // DO NOT call proc.stdin!.end() — stdin stays open for permission responses

    const session: ManagedSession = {
      id: sessionId,
      cwd: effectiveCwd,
      process: proc,
      claudeSessionId: options?.resumeSessionId || null,
      state: 'thinking',
      description: 'Starting...',
      currentTool: null,
      filesBeingEdited: [],
      commandRunning: null,
      lastActivity: new Date(),
      stdoutBuffer: '',
      groupId: options?.groupId ?? null,
      controlProtocolActive: false,
      pendingPermissions: new Map(),
      isFullAuto,
      worktreePath,
    };

    this.sessions.set(sessionId, session);
    this.emitStateChange(session);

    this.attachProcessHandlers(sessionId, proc, session);
  }

  sendMessage(sessionId: string, prompt: string, claudeConfig?: ClaudeConfig): void {
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

    const args = this.buildArgs(claudeConfig, session.claudeSessionId ?? undefined, session.isFullAuto);

    if (claudeConfig) {
      const configForArgs = session.isFullAuto
        ? { ...claudeConfig, permissionMode: undefined }
        : claudeConfig;
      args.push(...configToCliArgs(configForArgs));
    }

    const proc = spawn('claude', args, {
      cwd: session.cwd,
      env: cleanEnvForClaude(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: IS_WINDOWS,
    });

    // Write prompt as stream-json input, keep stdin OPEN for control protocol responses
    proc.stdin!.write(JSON.stringify({ type: 'user_message', content: prompt }) + '\n');

    session.process = proc;
    session.state = 'thinking';
    session.description = 'Thinking...';
    session.lastActivity = new Date();
    session.controlProtocolActive = false;
    session.pendingPermissions = new Map();
    this.emitStateChange(session);

    this.attachProcessHandlers(sessionId, proc, session);
  }

  /**
   * Respond to a pending permission request.
   * Called by the IPC handler when the user clicks Allow/Deny in the UI.
   */
  respondToPermission(
    sessionId: string,
    requestId: string,
    decision: 'allow' | 'deny',
    message?: string,
    updatedInput?: Record<string, unknown>
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      log.warn(`[ClaudeSession] No session ${sessionId} for permission response`);
      return;
    }

    const pending = session.pendingPermissions.get(requestId);
    if (!pending) {
      log.warn(`[ClaudeSession] No pending permission ${requestId} for session ${sessionId}`);
      return;
    }

    clearTimeout(pending.timer);
    session.pendingPermissions.delete(requestId);

    if (session.controlProtocolActive) {
      // Send control_response via stdin
      this.sendControlResponse(session, requestId, decision, message, updatedInput);
    } else {
      // Resolve the hook's pending promise
      pending.resolve({
        behavior: decision,
        updatedInput,
        message,
      });
    }

    // Restore state from waiting_permission
    if (session.state === 'waiting_permission' && session.pendingPermissions.size === 0) {
      session.state = 'tool_executing';
      session.description = 'Working...';
      this.emitStateChange(session);
    }
  }

  /**
   * Handle a permission request from the PreToolUse hook fallback.
   * Returns a promise that resolves when the user responds.
   */
  handleHookPermissionRequest(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, unknown>,
    toolUseId: string
  ): Promise<{ behavior: 'allow' | 'deny'; updatedInput?: Record<string, unknown>; message?: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return Promise.resolve({ behavior: 'deny', message: 'Session not found' });
    }

    // If the control protocol is active, it handles permissions — auto-allow
    // the hook to avoid double-prompting the user for the same tool use
    if (session.controlProtocolActive) {
      log.info(`[ClaudeSession] Hook: auto-allowing ${toolName} (control protocol is active)`);
      return Promise.resolve({ behavior: 'allow' });
    }

    // FullAuto mode: use filesystem guard
    if (session.isFullAuto && session.worktreePath) {
      const guardResult = evaluateGuard(toolName, toolInput, session.worktreePath);
      if (guardResult.decision === 'allow') {
        log.info(`[ClaudeSession] FullAuto hook guard: allowed ${toolName} (within boundary)`);
        return Promise.resolve({ behavior: 'allow' });
      }
      log.info(`[ClaudeSession] FullAuto hook guard: prompting for ${toolName} — ${guardResult.reason}`);
      // Fall through to prompt user
    }

    // Check saved permission rules first (for non-fullAuto sessions)
    if (!session.isFullAuto) {
      const evalResult = evaluatePermission(toolName, toolInput, sessionId, session.groupId);
      if (evalResult.matched) {
        log.info(`[ClaudeSession] Hook permission auto-resolved: ${evalResult.decision} for ${toolName}`);
        return Promise.resolve({ behavior: evalResult.decision });
      }
    }

    // No saved rule — prompt the user
    const requestId = crypto.randomUUID();

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        log.warn(`[ClaudeSession] Permission request ${requestId} timed out, auto-denying`);
        session.pendingPermissions.delete(requestId);
        resolve({ behavior: 'deny', message: 'Permission request timed out' });

        if (session.state === 'waiting_permission' && session.pendingPermissions.size === 0) {
          session.state = 'tool_executing';
          session.description = 'Working...';
          this.emitStateChange(session);
        }
      }, ClaudeSessionManager.PERMISSION_TIMEOUT_MS);

      session.pendingPermissions.set(requestId, { requestId, resolve, timer });

      session.state = 'waiting_permission';
      session.description = `Waiting: approve ${toolName}`;
      this.emitStateChange(session);

      const request: PermissionRequest = {
        requestId,
        sessionId,
        toolName,
        toolInput,
        toolUseId,
      };
      this.emit('permission-request', { sessionId, request });
    });
  }

  killSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.process) return Promise.resolve();

    // Clean up any pending permissions
    for (const [, pending] of session.pendingPermissions) {
      clearTimeout(pending.timer);
      pending.resolve({ behavior: 'deny', message: 'Session killed' });
    }
    session.pendingPermissions.clear();

    const proc = session.process;
    const pid = proc.pid;

    // Close stdin before killing
    try { proc.stdin?.end(); } catch { /* ignore */ }

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
    // Clean up worktree if this was a sandboxed session
    if (worktreeManager.hasWorktree(sessionId)) {
      worktreeManager.cleanup(sessionId);
    }
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

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  isSessionRunning(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session?.process;
  }

  getClaudeSessionId(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.claudeSessionId ?? null;
  }

  /**
   * Check if a session is running in fullAuto (sandboxed) mode.
   */
  isFullAutoSession(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isFullAuto ?? false;
  }

  /**
   * Get the worktree path for a sandboxed session.
   */
  getWorktreePath(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.worktreePath ?? null;
  }

  // ---- Private ----

  private buildArgs(claudeConfig?: ClaudeConfig, resumeSessionId?: string, isFullAuto?: boolean): string[] {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];

    if (isFullAuto) {
      // FullAuto: skip Claude's built-in permissions (we enforce boundaries via filesystem guard)
      // Still use permission-prompt-tool so the guard can intercept out-of-boundary operations
      args.push('--permission-prompt-tool', 'stdio');
      args.push('--dangerously-skip-permissions');
    } else {
      // Normal mode: use control protocol for interactive permission prompts
      args.push('--permission-prompt-tool', 'stdio');
    }

    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }

    return args;
  }

  private attachProcessHandlers(sessionId: string, proc: ChildProcess, session: ManagedSession): void {
    proc.stdout!.on('data', (chunk: Buffer) => {
      log.info(`[ClaudeSession] stdout data (${chunk.length} bytes) for ${sessionId}`);
      this.handleStdoutData(sessionId, chunk);
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      log.info(`[ClaudeSession] stderr for ${sessionId}: ${text.substring(0, 200)}`);
      this.emit('error', { sessionId, error: text });
    });

    proc.on('close', (exitCode) => {
      log.info(`[ClaudeSession] Process closed for ${sessionId}, exitCode: ${exitCode}`);
      const sess = this.sessions.get(sessionId);
      if (sess) {
        // Flush any remaining data in stdout buffer (e.g. the result line)
        if (sess.stdoutBuffer.trim()) {
          this.handleStdoutData(sessionId, Buffer.from('\n'));
        }
        // Clean up pending permissions
        for (const [, pending] of sess.pendingPermissions) {
          clearTimeout(pending.timer);
          pending.resolve({ behavior: 'deny', message: 'Process exited' });
        }
        sess.pendingPermissions.clear();

        log.info(`[ClaudeSession] Claude session ID for resume: ${sess.claudeSessionId || 'NOT CAPTURED'}`);

        // For fullAuto sessions: generate diff for review before cleanup
        if (sess.isFullAuto && sess.worktreePath) {
          try {
            const diffResult = worktreeManager.getDiff(sessionId);
            if (diffResult.files.length > 0) {
              const diffData: DiffReviewData = {
                sessionId,
                baseBranch: diffResult.baseBranch,
                worktreeBranch: diffResult.worktreeBranch,
                files: diffResult.files,
                summary: diffResult.summary,
              };
              log.info(`[ClaudeSession] FullAuto: ${diffResult.files.length} files changed, emitting diff review`);
              this.emit('diff-review', { sessionId, diffData });
            } else {
              log.info(`[ClaudeSession] FullAuto: no changes to review, cleaning up worktree`);
              worktreeManager.cleanup(sessionId);
            }
          } catch (err) {
            log.error(`[ClaudeSession] FullAuto: failed to get diff:`, err);
            // Clean up anyway
            worktreeManager.cleanup(sessionId);
          }
        }

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
        const parsed = JSON.parse(trimmed);

        // Handle control_request from --permission-prompt-tool stdio
        if (parsed.type === 'control_request') {
          this.handleControlRequest(sessionId, parsed);
          continue;
        }

        // CLI wraps API events in {"type":"stream_event","event":{...}}
        if (parsed.type === 'stream_event' && parsed.event) {
          const event: ClaudeJsonEvent = parsed.event;
          this.processEvent(sessionId, event);
          this.emit('event', { sessionId, event });
        } else if (parsed.type === 'result') {
          // Final result — extract session ID for resume
          if (parsed.session_id) {
            const sess = this.sessions.get(sessionId);
            if (sess) sess.claudeSessionId = parsed.session_id;
            log.info(`[ClaudeSession] Captured Claude session ID: ${parsed.session_id}`);
          } else {
            log.warn(`[ClaudeSession] Result line has no session_id:`, JSON.stringify(parsed).substring(0, 200));
          }
          // Close stdin after receiving the result — session turn is done
          try { session.process?.stdin?.end(); } catch { /* ignore */ }
        } else if (parsed.type === 'system' || parsed.type === 'rate_limit_event') {
          // System events (hooks, init) and rate limits — skip
        } else if (parsed.type === 'assistant') {
          // Full assistant message — skip (we get content from stream_events)
        } else {
          // Unknown wrapper — try processing as raw event
          this.processEvent(sessionId, parsed as ClaudeJsonEvent);
          this.emit('event', { sessionId, event: parsed as ClaudeJsonEvent });
        }
      } catch (e) {
        // Non-JSON output (shouldn't happen in stream-json mode, but be safe)
        log.debug(`[ClaudeSession] Non-JSON line for ${sessionId}: ${trimmed.substring(0, 100)}`);
      }
    }
  }

  /**
   * Handle a control_request from Claude Code's permission-prompt-tool stdio protocol.
   *
   * Expected format:
   * {
   *   "type": "control_request",
   *   "request_id": "req_abc123",
   *   "request": {
   *     "subtype": "can_use_tool",
   *     "tool_name": "Bash",
   *     "input": { "command": "..." },
   *     "decision_reason": "...",
   *     "tool_use_id": "toolu_xyz"
   *   }
   * }
   */
  private handleControlRequest(sessionId: string, parsed: any): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.controlProtocolActive = true;

    const request = parsed.request;
    if (!request || request.subtype !== 'can_use_tool') {
      log.warn(`[ClaudeSession] Unknown control_request subtype: ${request?.subtype}`);
      // Respond with allow to avoid blocking
      this.sendControlResponse(session, parsed.request_id, 'allow');
      return;
    }

    const toolName = request.tool_name;
    const toolInput = request.input || {};
    const toolUseId = request.tool_use_id || '';

    // FullAuto mode: use filesystem guard instead of normal permission rules
    if (session.isFullAuto && session.worktreePath) {
      const guardResult = evaluateGuard(toolName, toolInput, session.worktreePath);
      if (guardResult.decision === 'allow') {
        log.info(`[ClaudeSession] FullAuto guard: allowed ${toolName} (within boundary)`);
        this.sendControlResponse(session, parsed.request_id, 'allow', undefined, toolInput);
        return;
      }
      // Guard says prompt — fall through to show permission UI
      log.info(`[ClaudeSession] FullAuto guard: prompting for ${toolName} — ${guardResult.reason}`);
    }

    // Check saved permission rules first (for non-fullAuto, or fullAuto out-of-boundary)
    if (!session.isFullAuto) {
      const evalResult = evaluatePermission(toolName, toolInput, sessionId, session.groupId);
      if (evalResult.matched) {
        log.info(`[ClaudeSession] Permission auto-resolved: ${evalResult.decision} for ${toolName}`);
        this.sendControlResponse(
          session,
          parsed.request_id,
          evalResult.decision,
          evalResult.decision === 'deny' ? 'Blocked by saved rule' : undefined,
          evalResult.decision === 'allow' ? toolInput : undefined
        );
        return;
      }
    }

    // No saved rule — prompt the user via the renderer
    const requestId = parsed.request_id;

    const timer = setTimeout(() => {
      log.warn(`[ClaudeSession] Permission request ${requestId} timed out, auto-denying`);
      session.pendingPermissions.delete(requestId);
      this.sendControlResponse(session, requestId, 'deny', 'Permission request timed out');

      if (session.state === 'waiting_permission' && session.pendingPermissions.size === 0) {
        session.state = 'tool_executing';
        session.description = 'Working...';
        this.emitStateChange(session);
      }
    }, ClaudeSessionManager.PERMISSION_TIMEOUT_MS);

    session.pendingPermissions.set(requestId, {
      requestId,
      resolve: () => {}, // Not used for control protocol path — response sent directly via stdin
      timer,
    });

    session.state = 'waiting_permission';
    session.description = `Waiting: approve ${toolName}`;
    this.emitStateChange(session);

    const permRequest: PermissionRequest = {
      requestId,
      sessionId,
      toolName,
      toolInput,
      toolUseId,
      decisionReason: request.decision_reason,
    };
    this.emit('permission-request', { sessionId, request: permRequest });
  }

  /**
   * Send a control_response back to Claude Code via stdin.
   */
  private sendControlResponse(
    session: ManagedSession,
    requestId: string,
    decision: 'allow' | 'deny',
    message?: string,
    updatedInput?: Record<string, unknown>
  ): void {
    if (!session.process?.stdin?.writable) {
      log.warn(`[ClaudeSession] Cannot send control_response: stdin not writable for session ${session.id}`);
      return;
    }

    const response: any = {
      type: 'control_response',
      id: requestId,
      result: decision === 'allow'
        ? { behavior: 'allow', updatedInput }
        : { behavior: 'deny', message: message || 'User denied' },
    };

    const line = JSON.stringify(response) + '\n';
    log.info(`[ClaudeSession] Sending control_response for ${session.id}: ${decision} (${requestId})`);

    try {
      session.process.stdin.write(line);
    } catch (err) {
      log.error(`[ClaudeSession] Failed to write control_response:`, err);
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
          // Fallback detection: if we see a tool_use without having received any
          // control_request, the control protocol isn't working (known issue on some
          // CLI versions). The PreToolUse hook fallback will handle permissions instead.
          if (!session.controlProtocolActive) {
            log.warn(`[ClaudeSession] Tool use '${event.content_block.name}' arrived without control protocol active — relying on PreToolUse hook fallback for permissions`);
          }

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
