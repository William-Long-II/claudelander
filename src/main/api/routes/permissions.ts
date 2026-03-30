/**
 * Permission Rules API Routes
 *
 * CRUD operations for managing saved permission rules.
 * Also provides the pre-tool-use endpoint for the PreToolUse hook fallback.
 */

import { Router, Request, Response } from 'express';
import * as permissionRulesRepo from '../../repositories/permission-rules';
import { claudeSessionManager } from '../../claude-session-manager';
import log from 'electron-log';

/**
 * Middleware to restrict to localhost only
 */
function localhostOnly(req: Request, res: Response, next: () => void): void {
  const ip = req.socket.remoteAddress || '';
  const clientIp = ip.replace(/^::ffff:/, '');

  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== 'localhost') {
    log.warn(`[PermissionsAPI] Rejected non-localhost request from: ${clientIp}`);
    res.status(403).json({ error: 'Access denied: localhost only' });
    return;
  }

  next();
}

export function createPermissionsRouter(): Router {
  const router = Router();

  router.use(localhostOnly);

  /**
   * POST /permissions/pre-tool-use
   *
   * Called by the PreToolUse hook when the control protocol isn't available.
   * This is a long-poll endpoint: it holds the response open until the user
   * approves/denies the tool use in the UI, or until timeout.
   */
  router.post('/pre-tool-use', async (req: Request, res: Response) => {
    try {
      const { tool_name, tool_input, tool_use_id, session_id } = req.body;

      if (!tool_name || !session_id) {
        res.status(400).json({ error: 'Missing tool_name or session_id' });
        return;
      }

      log.info(`[PermissionsAPI] PreToolUse hook: ${tool_name} for session ${session_id}`);

      // Delegate to session manager — this blocks until user responds or timeout
      const result = await claudeSessionManager.handleHookPermissionRequest(
        session_id,
        tool_name,
        tool_input || {},
        tool_use_id || ''
      );

      if (result.behavior === 'allow') {
        // Return allow response — hook script will return { allow: true } to Claude
        res.json({ allow: true, updatedInput: result.updatedInput });
      } else {
        // Return deny response — hook script will exit with code 2
        res.json({ deny: true, message: result.message || 'User denied' });
      }
    } catch (error) {
      log.error('[PermissionsAPI] Error processing pre-tool-use:', error);
      // On error, allow the tool to avoid blocking the session
      res.json({ allow: true });
    }
  });

  /**
   * GET /permissions/rules
   * List all saved permission rules
   */
  router.get('/rules', (_req: Request, res: Response) => {
    try {
      const rules = permissionRulesRepo.getAllRules();
      res.json({ rules });
    } catch (error) {
      log.error('[PermissionsAPI] Error listing rules:', error);
      res.status(500).json({ error: 'Failed to list rules' });
    }
  });

  /**
   * DELETE /permissions/rules/:id
   * Delete a specific permission rule
   */
  router.delete('/rules/:id', (req: Request<{ id: string }>, res: Response) => {
    try {
      permissionRulesRepo.deleteRule(req.params.id);
      res.json({ deleted: true });
    } catch (error) {
      log.error('[PermissionsAPI] Error deleting rule:', error);
      res.status(500).json({ error: 'Failed to delete rule' });
    }
  });

  /**
   * DELETE /permissions/rules
   * Clear all permission rules
   */
  router.delete('/rules', (_req: Request, res: Response) => {
    try {
      permissionRulesRepo.clearAllRules();
      res.json({ cleared: true });
    } catch (error) {
      log.error('[PermissionsAPI] Error clearing rules:', error);
      res.status(500).json({ error: 'Failed to clear rules' });
    }
  });

  return router;
}
