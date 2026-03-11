/**
 * Sessions API Routes
 *
 * CRUD operations for sessions.
 */

import { Router, Request, Response } from 'express';
import log from 'electron-log';
import * as sessionsRepo from '../../repositories/sessions';
import { claudeSessionManager } from '../../claude-session-manager';
import { requireControlPermission, requireModifyPermission } from '../middleware/auth';
import {
  validateIdParam,
  validateCreateSession,
  validateUpdateSession,
  getStringParam,
} from '../middleware/validation';
import { isValidUUID } from '../../validation';
import { Session } from '../../../shared/types';

export function createSessionsRouter(): Router {
  const router = Router();

  /**
   * GET /sessions - List all sessions
   */
  router.get('/', (_req: Request, res: Response) => {
    try {
      const sessions = sessionsRepo.getAllSessions();
      res.json({ sessions });
    } catch (error) {
      log.error('[SessionsAPI] Error listing sessions:', error);
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  /**
   * GET /sessions/:id - Get a specific session
   */
  router.get('/:id', validateIdParam, (req: Request, res: Response) => {
    try {
      const sessions = sessionsRepo.getAllSessions();
      const session = sessions.find(s => s.id === req.params.id);

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json({ session });
    } catch (error) {
      log.error('[SessionsAPI] Error getting session:', error);
      res.status(500).json({ error: 'Failed to get session' });
    }
  });

  /**
   * POST /sessions - Create a new session
   */
  router.post(
    '/',
    requireModifyPermission,
    validateCreateSession,
    (req: Request, res: Response) => {
      try {
        const { groupId, name, workingDir, launchClaude } = req.body;

        // Generate UUID for new session
        const id = generateUUID();
        const now = new Date();

        const session: Session = {
          id,
          groupId,
          name,
          workingDir: workingDir || process.cwd(),
          state: 'idle',
          shellType: launchClaude ? 'claude' : 'bash',
          order: getNextOrder(),
          createdAt: now,
          lastActivityAt: now,
        };

        sessionsRepo.createSession(session);

        // Start Claude session if requested
        if (launchClaude) {
          claudeSessionManager.startSession(id, session.workingDir, '', { groupId });
        }

        log.info(`[SessionsAPI] Created session: ${id}`);
        res.status(201).json({ session });
      } catch (error) {
        log.error('[SessionsAPI] Error creating session:', error);
        res.status(500).json({ error: 'Failed to create session' });
      }
    }
  );

  /**
   * PATCH /sessions/:id - Update a session
   */
  router.patch(
    '/:id',
    requireModifyPermission,
    validateIdParam,
    validateUpdateSession,
    (req: Request, res: Response) => {
      try {
        const id = getStringParam(req.params.id);
        const updates = req.body;

        // Check session exists
        const sessions = sessionsRepo.getAllSessions();
        const session = sessions.find(s => s.id === id);

        if (!session) {
          res.status(404).json({ error: 'Session not found' });
          return;
        }

        sessionsRepo.updateSession(id, updates);

        log.info(`[SessionsAPI] Updated session: ${id}`);
        res.json({ success: true });
      } catch (error) {
        log.error('[SessionsAPI] Error updating session:', error);
        res.status(500).json({ error: 'Failed to update session' });
      }
    }
  );

  /**
   * DELETE /sessions/:id - Delete a session
   */
  router.delete(
    '/:id',
    requireModifyPermission,
    validateIdParam,
    (req: Request, res: Response) => {
      try {
        const id = getStringParam(req.params.id);

        // Stop Claude session if running
        claudeSessionManager.removeSession(id);

        sessionsRepo.deleteSession(id);

        log.info(`[SessionsAPI] Deleted session: ${id}`);
        res.json({ success: true });
      } catch (error) {
        log.error('[SessionsAPI] Error deleting session:', error);
        res.status(500).json({ error: 'Failed to delete session' });
      }
    }
  );

  /**
   * POST /sessions/:id/stop - Stop a Claude session
   */
  router.post(
    '/:id/stop',
    requireControlPermission,
    validateIdParam,
    (req: Request, res: Response) => {
      try {
        const id = getStringParam(req.params.id);

        if (!claudeSessionManager.isSessionRunning(id)) {
          res.status(400).json({ error: 'Session is not running' });
          return;
        }

        claudeSessionManager.killSession(id);

        log.info(`[SessionsAPI] Stopped session: ${id}`);
        res.json({ success: true });
      } catch (error) {
        log.error('[SessionsAPI] Error stopping session:', error);
        res.status(500).json({ error: 'Failed to stop session' });
      }
    }
  );

  return router;
}

function generateUUID(): string {
  const { randomBytes } = require('crypto');
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function getNextOrder(): number {
  const sessions = sessionsRepo.getAllSessions();
  if (sessions.length === 0) return 0;
  return Math.max(...sessions.map(s => s.order)) + 1;
}
