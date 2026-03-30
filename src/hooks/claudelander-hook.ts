#!/usr/bin/env node
/**
 * ClaudeLander Hook Handler
 *
 * This script is called by Claude Code hooks to capture events and save memories.
 * It receives hook data on stdin and calls the ClaudeLander API.
 *
 * Usage: node claudelander-hook.js <hook-type> [--group-id <id>] [--session-id <id>]
 *
 * Hook types: PreToolUse, PostToolUse, Stop, Notification
 */

const API_BASE = process.env.CLAUDELANDER_API_URL || 'http://127.0.0.1:8443';
const API_PREFIX = '/api/v1/hooks';

interface HookInput {
  // PostToolUse fields
  tool_name?: string;
  tool_input?: unknown;
  tool_result?: unknown;

  // Stop fields
  stop_reason?: string;
  num_turns?: number;
  transcript?: Array<{ role: string; content: string }>;

  // Notification fields
  type?: string;
  message?: string;

  // Session context (if available)
  session_id?: string;
  cwd?: string;
}

/**
 * Read all input from stdin
 */
async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    const stdin = process.stdin;

    stdin.setEncoding('utf8');

    stdin.on('readable', () => {
      let chunk;
      while ((chunk = stdin.read()) !== null) {
        data += chunk;
      }
    });

    stdin.on('end', () => resolve(data));
    stdin.on('error', reject);

    // Handle case where stdin is already closed (no input)
    if (stdin.readableEnded) {
      resolve(data);
    }
  });
}

/**
 * Call the ClaudeLander API
 */
async function callApi(endpoint: string, data: Record<string, unknown>): Promise<unknown> {
  try {
    const response = await fetch(`${API_BASE}${API_PREFIX}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return response.json();
  } catch (error) {
    // Don't fail loudly - ClaudeLander might not be running
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ClaudeLander Hook] API call failed: ${message}`);
    return null;
  }
}

/**
 * Extract summary from Stop hook transcript
 */
function extractSummaryHint(transcript: Array<{ role: string; content: string }> | undefined): string | null {
  if (!transcript || transcript.length === 0) return null;

  // Get the last assistant message
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role === 'assistant') {
      const content = transcript[i].content;
      // Look for explicit summary markers or decision statements
      if (typeof content === 'string') {
        // Check for decision patterns
        const decisionPatterns = [
          /(?:decided|choosing|will use|going with|implementing)\s+(.{10,100})/i,
          /(?:the approach|the solution|the fix)\s+(?:is|was)\s+(.{10,100})/i,
        ];

        for (const pattern of decisionPatterns) {
          const match = content.match(pattern);
          if (match) {
            return match[0];
          }
        }
      }
      break;
    }
  }

  return null;
}

/**
 * Count significant tool uses from transcript
 */
function countToolUses(transcript: Array<{ role: string; content: string }> | undefined): number {
  if (!transcript) return 0;

  let count = 0;
  for (const msg of transcript) {
    if (msg.role === 'assistant' && typeof msg.content === 'string') {
      // Count tool use markers (this is a heuristic)
      const toolMatches = msg.content.match(/(?:Edit|Write|Bash|Read)/g);
      if (toolMatches) count += toolMatches.length;
    }
  }

  return count;
}

/**
 * Process PreToolUse hook (permission approval fallback for 3.1)
 *
 * This hook is invoked BEFORE a tool executes. It calls ClaudeLander's
 * pre-tool-use API which long-polls until the user approves/denies.
 *
 * Return values:
 *   { "allow": true } on stdout → tool proceeds
 *   Exit code 2 → tool is blocked
 */
async function handlePreToolUse(input: HookInput, groupId?: string, sessionId?: string): Promise<void> {
  const toolName = input.tool_name;
  const toolInput = input.tool_input;

  if (!toolName) {
    // No tool name, allow by default
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/v1/permissions/pre-tool-use`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool_name: toolName,
        tool_input: toolInput,
        tool_use_id: (input as any).tool_use_id || '',
        session_id: sessionId || input.session_id,
        group_id: groupId,
      }),
    });

    if (!response.ok) {
      // API error — allow by default to avoid blocking
      console.error(`[ClaudeLander Hook] PreToolUse API error: ${response.status}`);
      console.log(JSON.stringify({ continue: true }));
      return;
    }

    const result = await response.json() as { allow?: boolean; deny?: boolean; message?: string };

    if (result.deny) {
      // User denied — exit with code 2 to block the tool
      process.exit(2);
    } else {
      // User allowed (or auto-allowed by saved rule)
      console.log(JSON.stringify({ allow: true }));
    }
  } catch (error) {
    // Network error — ClaudeLander might not be running, allow by default
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ClaudeLander Hook] PreToolUse failed: ${message}`);
    console.log(JSON.stringify({ continue: true }));
  }
}

/**
 * Process PostToolUse hook
 */
async function handlePostToolUse(input: HookInput, groupId?: string, sessionId?: string): Promise<void> {
  if (!input.tool_name) return;

  await callApi('/post-tool-use', {
    tool_name: input.tool_name,
    tool_input: input.tool_input,
    tool_output: input.tool_result,
    session_id: sessionId || input.session_id,
    group_id: groupId,
  });
}

/**
 * Process Stop hook
 */
async function handleStop(input: HookInput, groupId?: string, sessionId?: string): Promise<void> {
  const toolUsesCount = countToolUses(input.transcript);
  const summaryHint = extractSummaryHint(input.transcript);

  await callApi('/stop', {
    session_id: sessionId || input.session_id,
    group_id: groupId,
    stop_reason: input.stop_reason,
    tool_uses_count: toolUsesCount,
    summary_hint: summaryHint,
  });
}

/**
 * Process Notification hook
 */
async function handleNotification(input: HookInput, groupId?: string, sessionId?: string): Promise<void> {
  await callApi('/notification', {
    session_id: sessionId || input.session_id,
    group_id: groupId,
    notification_type: input.type,
    message: input.message,
  });
}

/**
 * Parse command line arguments
 */
function parseArgs(): { hookType: string; groupId?: string; sessionId?: string } {
  const args = process.argv.slice(2);
  let hookType = 'PostToolUse';
  let groupId: string | undefined;
  let sessionId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--group-id' && args[i + 1]) {
      groupId = args[++i];
    } else if (args[i] === '--session-id' && args[i + 1]) {
      sessionId = args[++i];
    } else if (!args[i].startsWith('-')) {
      hookType = args[i];
    }
  }

  return { hookType, groupId, sessionId };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const { hookType, groupId, sessionId } = parseArgs();

  // Read hook data from stdin
  let inputData: string;
  try {
    inputData = await readStdin();
  } catch (error) {
    console.error('[ClaudeLander Hook] Failed to read stdin:', error);
    return;
  }

  // Parse JSON input
  let input: HookInput;
  try {
    input = inputData.trim() ? JSON.parse(inputData) : {};
  } catch (error) {
    console.error('[ClaudeLander Hook] Failed to parse JSON input:', error);
    return;
  }

  // Process based on hook type
  switch (hookType) {
    case 'PreToolUse':
      await handlePreToolUse(input, groupId, sessionId);
      // handlePreToolUse outputs its own response — do not output '{}'
      return;
    case 'PostToolUse':
      await handlePostToolUse(input, groupId, sessionId);
      break;
    case 'Stop':
      await handleStop(input, groupId, sessionId);
      break;
    case 'Notification':
      await handleNotification(input, groupId, sessionId);
      break;
    default:
      console.error(`[ClaudeLander Hook] Unknown hook type: ${hookType}`);
  }

  // Output empty JSON to indicate success (Claude Code expects this)
  console.log('{}');
}

main().catch((error) => {
  console.error('[ClaudeLander Hook] Fatal error:', error);
  process.exit(1);
});
