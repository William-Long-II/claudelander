/**
 * Chat Routes
 *
 * REST API endpoints for chat-first Claude session interactions.
 * Replaces terminal buffer endpoints with structured chat message access.
 */

import { Router, Request, Response } from 'express';
import log from 'electron-log';
import { getStringParam, getStringQuery } from '../middleware/validation';
import { requireControlPermission } from '../middleware/auth';
import { getMessagesBySession, createChatMessage } from '../../repositories/chat-messages';
import { claudeSessionManager } from '../../claude-session-manager';
import * as sessionsRepo from '../../repositories/sessions';
import { ChatMessageType } from '../../../shared/types';

function safeParseInt(value: string, defaultValue: number): number {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 1 ? defaultValue : parsed;
}

export function createChatRouter(): Router {
  const router = Router();

  /**
   * GET /api/v1/chat/:sessionId/messages
   * Get chat messages for a session (replaces terminal buffer)
   *
   * Query params:
   *   limit  - Max messages to return (default 50, max 200)
   *   before - Cursor pagination: return messages before this message ID's timestamp
   *   type   - Filter by message type (text, tool_use, tool_result, thinking, system)
   */
  router.get('/:sessionId/messages', (req: Request, res: Response) => {
    try {
      const sessionId = getStringParam(req.params.sessionId);

      // Verify session exists
      const sessions = sessionsRepo.getAllSessions();
      const session = sessions.find(s => s.id === sessionId);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      const limitStr = getStringQuery(req.query.limit);
      const beforeStr = getStringQuery(req.query.before);
      const typeStr = getStringQuery(req.query.type);

      let limit = limitStr ? safeParseInt(limitStr, 50) : 50;
      if (limit > 200) limit = 200;

      // Get messages with optional cursor pagination
      // The repo uses offset-based pagination, but we adapt for cursor-based
      let messages = getMessagesBySession(sessionId, limit + 1, 0);

      // If 'before' cursor is provided, filter messages created before that message
      if (beforeStr) {
        const cursorIndex = messages.findIndex(m => m.id === beforeStr);
        if (cursorIndex > 0) {
          messages = messages.slice(0, cursorIndex);
        }
      }

      // Filter by message type if specified
      if (typeStr) {
        const validTypes: ChatMessageType[] = ['text', 'tool_use', 'tool_result', 'thinking', 'system'];
        if (validTypes.includes(typeStr as ChatMessageType)) {
          messages = messages.filter(m => m.messageType === typeStr);
        }
      }

      // Determine if there are more messages (for pagination)
      const hasMore = messages.length > limit;
      if (hasMore) {
        messages = messages.slice(-limit);
      }

      res.json({
        messages: messages.slice(0, limit),
        hasMore,
        cursor: messages.length > 0 ? messages[0].id : null,
      });
    } catch (error) {
      log.error('[ChatAPI] Error getting messages:', error);
      res.status(500).json({ error: 'Failed to get chat messages' });
    }
  });

  /**
   * POST /api/v1/chat/:sessionId/messages
   * Send a user message to a Claude session
   *
   * Body: { content: string }
   *
   * For a new session (no active Claude process), starts a new session.
   * For an existing session (idle, with claudeSessionId), sends a follow-up.
   */
  router.post('/:sessionId/messages', requireControlPermission, (req: Request, res: Response) => {
    try {
      const sessionId = getStringParam(req.params.sessionId);
      const { content } = req.body;

      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'Missing or invalid content' });
        return;
      }

      // Verify session exists
      const sessions = sessionsRepo.getAllSessions();
      const session = sessions.find(s => s.id === sessionId);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      // Store the user message
      const messageId = crypto.randomUUID();
      const userMessage = createChatMessage({
        id: messageId,
        sessionId,
        role: 'user',
        content,
        messageType: 'text',
      });

      // Determine whether to start or resume
      const isRunning = claudeSessionManager.isSessionRunning(sessionId);
      const claudeSessionId = claudeSessionManager.getClaudeSessionId(sessionId);

      if (isRunning) {
        // Session process is still active, can't send another message yet
        res.status(409).json({
          error: 'Session is currently processing. Wait for it to become idle.',
          message: userMessage,
        });
        return;
      }

      if (claudeSessionId) {
        // Resume existing Claude session with follow-up
        claudeSessionManager.sendMessage(sessionId, content);
      } else {
        // Start a new Claude session
        claudeSessionManager.startSession(sessionId, session.workingDir, content, {
          groupId: session.groupId,
        });
      }

      res.status(201).json({ message: userMessage });
    } catch (error) {
      log.error('[ChatAPI] Error sending message:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  /**
   * GET /api/v1/chat/:sessionId/status
   * Get session status (state, description, currentTool)
   */
  router.get('/:sessionId/status', (req: Request, res: Response) => {
    try {
      const sessionId = getStringParam(req.params.sessionId);

      // Verify session exists
      const sessions = sessionsRepo.getAllSessions();
      const session = sessions.find(s => s.id === sessionId);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      const status = claudeSessionManager.getSessionStatus(sessionId);

      res.json({ status });
    } catch (error) {
      log.error('[ChatAPI] Error getting session status:', error);
      res.status(500).json({ error: 'Failed to get session status' });
    }
  });

  return router;
}
