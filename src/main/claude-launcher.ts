import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { app } from 'electron';

export interface ClaudeLaunchConfig {
  sessionId: string;
  projectDir: string;
  socketPath: string;
}

export function getClaudeCommand(config: ClaudeLaunchConfig): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const hookScriptPath = getHookScriptPath();

  // Ensure hook script exists and is executable
  ensureHookScript(hookScriptPath);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDELANDER_SESSION_ID: config.sessionId,
    CLAUDELANDER_SOCKET: config.socketPath,
    // Point Claude to use our hook
    CLAUDE_HOOKS_DIR: path.dirname(hookScriptPath),
  };

  return {
    command: 'claude',
    args: [],
    env,
  };
}

function getHookScriptPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'hooks', 'claudelander-hook.sh');
}

function ensureHookScript(hookPath: string): void {
  const hookDir = path.dirname(hookPath);

  try {
    if (!fs.existsSync(hookDir)) {
      fs.mkdirSync(hookDir, { recursive: true });
    }

    // Copy hook script from resources or create it
    const hookContent = `#!/bin/bash
# Claudelander hook script - reports Claude state to main process

SESSION_ID="\${CLAUDELANDER_SESSION_ID}"
SOCKET_PATH="\${CLAUDELANDER_SOCKET}"

report_state() {
    local state="$1"
    local event="$2"
    # Escape special JSON characters in SESSION_ID
    local safe_id=$(echo "$SESSION_ID" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    if [ -n "$SOCKET_PATH" ] && [ -S "$SOCKET_PATH" ]; then
        echo "{\\"sessionId\\":\\"$safe_id\\",\\"state\\":\\"$state\\",\\"event\\":\\"$event\\",\\"timestamp\\":$(date +%s)}" | nc -U "$SOCKET_PATH" 2>/dev/null || true
    fi
}

# Hook handlers based on Claude Code hook events
case "$1" in
    "PreToolUse")
        report_state "waiting" "tool_approval"
        ;;
    "PostToolUse")
        report_state "working" "tool_complete"
        ;;
    "Notification")
        report_state "working" "notification"
        ;;
    "Stop")
        report_state "idle" "stopped"
        ;;
esac

# Always exit 0 to not block Claude
exit 0
`;

    fs.writeFileSync(hookPath, hookContent, { mode: 0o755 });
  } catch (error) {
    console.error('Failed to write hook script:', error);
    throw new Error(`Failed to set up hook script at ${hookPath}: ${error}`);
  }
}

export function getSocketPath(): string {
  const tmpDir = os.tmpdir();
  return path.join(tmpDir, `claudelander-${process.pid}.sock`);
}
