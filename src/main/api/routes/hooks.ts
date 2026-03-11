/**
 * Hook API Routes
 *
 * Receives events from Claude Code hooks and processes them for knowledge graph storage.
 * Hooks are configured in Claude Code to call these endpoints at key moments.
 */

import { Router, Request, Response } from 'express';
import * as knowledgeRepo from '../../repositories/knowledge';
import { extractKnowledgeCandidates } from '../../knowledge/extractor';
import { detectDomains } from '../../knowledge/domain-tagger';
import log from 'electron-log';

/**
 * Middleware to restrict to localhost only
 */
function localhostOnly(req: Request, res: Response, next: () => void): void {
  const ip = req.socket.remoteAddress || '';
  const clientIp = ip.replace(/^::ffff:/, '');

  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== 'localhost') {
    log.warn(`[HooksAPI] Rejected non-localhost request from: ${clientIp}`);
    res.status(403).json({ error: 'Access denied: localhost only' });
    return;
  }

  next();
}

/**
 * Extract git commit info from Bash tool output
 */
function extractGitCommitInfo(input: string, output: string): { message: string; branch?: string } | null {
  // Check if this is a git commit command
  const isCommitCommand = /git\s+commit/.test(input);
  if (!isCommitCommand) return null;

  // Try to extract commit message from various patterns
  // Pattern 1: -m "message" or -m 'message'
  const messageMatch = input.match(/-m\s+["']([^"']+)["']/);
  if (messageMatch) {
    return { message: messageMatch[1] };
  }

  // Pattern 2: From output "[branch hash] message"
  const outputMatch = output.match(/\[([^\]]+)\s+[a-f0-9]+\]\s+(.+)/);
  if (outputMatch) {
    return { branch: outputMatch[1], message: outputMatch[2] };
  }

  return null;
}

/**
 * Determine if the tool use is significant enough to potentially warrant a memory
 */
function isSignificantToolUse(toolName: string, input: unknown): boolean {
  // Git operations
  if (toolName === 'Bash') {
    const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
    if (/git\s+(commit|merge|rebase|cherry-pick)/.test(inputStr)) return true;
  }

  // File editing (batched edits might be significant)
  if (toolName === 'Edit' || toolName === 'Write') return true;

  return false;
}

export function createHooksRouter(): Router {
  const router = Router();

  // Apply localhost-only restriction
  router.use(localhostOnly);

  /**
   * POST /hooks/post-tool-use
   * Called by Claude Code PostToolUse hook
   */
  router.post('/post-tool-use', (req: Request, res: Response) => {
    try {
      const { tool_name, tool_input, tool_output, session_id, group_id } = req.body;

      log.info(`[HooksAPI] PostToolUse: ${tool_name}`);

      // Handle git commits specially
      if (tool_name === 'Bash') {
        const inputStr = typeof tool_input === 'string' ? tool_input :
          (tool_input?.command || JSON.stringify(tool_input));
        const outputStr = typeof tool_output === 'string' ? tool_output : JSON.stringify(tool_output);

        // Skip our own MCP memory tool calls to avoid recursion/double-processing
        if (inputStr.includes('claudelander-memory') || inputStr.includes('mcp-cli call claudelander')) {
          log.debug('[HooksAPI] Skipping own MCP memory call');
          res.json({ saved: false, reason: 'own_mcp_call' });
          return;
        }

        const commitInfo = extractGitCommitInfo(inputStr, outputStr);

        if (commitInfo && group_id) {
          // Save commit as a Tier 1 knowledge node
          const content = commitInfo.branch
            ? `[Git Commit on ${commitInfo.branch}] ${commitInfo.message}`
            : `[Git Commit] ${commitInfo.message}`;

          const node = knowledgeRepo.createKnowledgeNode({
            id: crypto.randomUUID(),
            tier: 1,
            content,
            source: 'auto-extracted',
            scopeGroupId: group_id,
            scopeSessionId: session_id || null,
            domains: detectDomains(content),
            tags: ['git', 'commit', 'auto-captured'],
          });

          log.info(`[HooksAPI] Saved git commit as knowledge node: ${node.id}`);
          res.json({ saved: true, node_id: node.id, type: 'git_commit' });
          return;
        }
      }

      // For other significant tool uses, just acknowledge
      res.json({ saved: false, reason: 'not_actionable' });
    } catch (error) {
      log.error('[HooksAPI] Error processing PostToolUse:', error);
      res.status(500).json({ error: 'Failed to process hook' });
    }
  });

  /**
   * POST /hooks/stop
   * Called by Claude Code Stop hook when Claude finishes responding
   */
  router.post('/stop', (req: Request, res: Response) => {
    try {
      const {
        session_id,
        group_id,
        stop_reason,
        tool_uses_count,
        files_edited,
        summary_hint
      } = req.body;

      log.info(`[HooksAPI] Stop: session=${session_id}, reason=${stop_reason}, tools=${tool_uses_count}`);

      // Only process if there was significant activity
      const isSignificant = (tool_uses_count && tool_uses_count > 3) ||
                           (files_edited && files_edited.length > 0);

      if (!isSignificant) {
        res.json({ saved: false, reason: 'not_significant' });
        return;
      }

      // If a summary hint was provided by the hook script, save it
      if (summary_hint && group_id) {
        // Save the summary as a Tier 1 knowledge node
        const summaryNode = knowledgeRepo.createKnowledgeNode({
          id: crypto.randomUUID(),
          tier: 1,
          content: summary_hint,
          source: 'auto-extracted',
          scopeGroupId: group_id,
          scopeSessionId: session_id || null,
          domains: detectDomains(summary_hint),
          tags: ['session-summary', 'auto-captured'],
        });

        log.info(`[HooksAPI] Saved session summary as knowledge node: ${summaryNode.id}`);

        // Additionally, extract knowledge candidates (decisions/patterns/fixes) from the summary
        const candidates = extractKnowledgeCandidates('', summary_hint);
        const extractedNodeIds: string[] = [];

        for (const candidate of candidates) {
          const node = knowledgeRepo.createKnowledgeNode({
            id: crypto.randomUUID(),
            tier: 1,
            content: candidate.content,
            source: 'auto-extracted',
            confidence: candidate.confidence,
            scopeGroupId: group_id,
            scopeSessionId: session_id || null,
            domains: candidate.domains,
            tags: [candidate.trigger, 'extracted-from-summary', 'auto-captured'],
          });
          extractedNodeIds.push(node.id);
          log.info(`[HooksAPI] Extracted ${candidate.trigger} knowledge node: ${node.id}`);
        }

        res.json({
          saved: true,
          node_id: summaryNode.id,
          type: 'session_summary',
          extracted_nodes: extractedNodeIds,
        });
        return;
      }

      res.json({ saved: false, reason: 'no_summary_provided' });
    } catch (error) {
      log.error('[HooksAPI] Error processing Stop hook:', error);
      res.status(500).json({ error: 'Failed to process hook' });
    }
  });

  /**
   * POST /hooks/notification
   * Called when Claude sends a notification (e.g., task complete, error)
   */
  router.post('/notification', (req: Request, res: Response) => {
    try {
      const { session_id, group_id, notification_type, message } = req.body;

      log.info(`[HooksAPI] Notification: ${notification_type}`);

      // Capture error notifications as Tier 1 knowledge nodes
      if (notification_type === 'error' && message && group_id) {
        const content = `[Error Encountered] ${message}`;
        const node = knowledgeRepo.createKnowledgeNode({
          id: crypto.randomUUID(),
          tier: 1,
          content,
          source: 'auto-extracted',
          scopeGroupId: group_id,
          scopeSessionId: session_id || null,
          domains: detectDomains(content),
          tags: ['error', 'auto-captured'],
        });

        log.info(`[HooksAPI] Saved error as knowledge node: ${node.id}`);
        res.json({ saved: true, node_id: node.id, type: 'error' });
        return;
      }

      res.json({ saved: false, reason: 'not_actionable' });
    } catch (error) {
      log.error('[HooksAPI] Error processing Notification hook:', error);
      res.status(500).json({ error: 'Failed to process hook' });
    }
  });

  /**
   * GET /hooks/status
   * Check if hook API is available
   */
  router.get('/status', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      version: '1.0.0',
      endpoints: ['post-tool-use', 'stop', 'notification']
    });
  });

  return router;
}
