/**
 * Knowledge API Routes
 *
 * Provides REST endpoints for knowledge graph operations.
 * Used by the MCP server to access knowledge nodes without native module dependencies.
 */

import { Router, Request, Response } from 'express';
import * as knowledgeRepo from '../../repositories/knowledge';
import * as groupsRepo from '../../repositories/groups';
import { KnowledgeTier } from '../../../shared/types';
import { getStringParam } from '../middleware/validation';
import log from 'electron-log';

/**
 * Middleware to restrict to localhost only (for MCP server)
 */
function localhostOnly(req: Request, res: Response, next: () => void): void {
  const ip = req.socket.remoteAddress || '';
  const clientIp = ip.replace(/^::ffff:/, '');

  if (clientIp !== '127.0.0.1' && clientIp !== '::1' && clientIp !== 'localhost') {
    log.warn(`[KnowledgeAPI] Rejected non-localhost request from: ${clientIp}`);
    res.status(403).json({ error: 'Access denied: localhost only' });
    return;
  }

  next();
}

export function createKnowledgeRouter(): Router {
  const router = Router();

  // Apply localhost-only restriction to all knowledge routes
  router.use(localhostOnly);

  /**
   * GET /knowledge
   * List knowledge nodes with optional filters
   */
  router.get('/', (req: Request, res: Response) => {
    try {
      const { group_id, tier, domain, limit } = req.query;
      const maxResults = limit ? parseInt(limit as string, 10) : 50;

      let nodes;

      if (group_id) {
        nodes = knowledgeRepo.getKnowledgeNodesByGroup(group_id as string, maxResults);
      } else if (tier) {
        const tierNum = parseInt(tier as string, 10) as KnowledgeTier;
        if (![1, 2, 3].includes(tierNum)) {
          res.status(400).json({ error: 'tier must be 1, 2, or 3' });
          return;
        }
        nodes = knowledgeRepo.getKnowledgeNodesByTier(tierNum, maxResults);
      } else if (domain) {
        nodes = knowledgeRepo.getKnowledgeNodesByDomain(domain as string, maxResults);
      } else {
        // No filter: return tier 3 (most established) first, then tier 2, then tier 1
        const tier3 = knowledgeRepo.getKnowledgeNodesByTier(3, maxResults);
        const tier2 = knowledgeRepo.getKnowledgeNodesByTier(2, maxResults);
        const tier1 = knowledgeRepo.getKnowledgeNodesByTier(1, maxResults);
        nodes = [...tier3, ...tier2, ...tier1].slice(0, maxResults);
      }

      // Apply additional filters if multiple were provided
      if (group_id && tier) {
        const tierNum = parseInt(tier as string, 10) as KnowledgeTier;
        nodes = nodes.filter(n => n.tier === tierNum);
      }
      if (domain && (group_id || tier)) {
        nodes = nodes.filter(n => n.domains.includes(domain as string));
      }

      res.json({ nodes });
    } catch (error) {
      log.error('[KnowledgeAPI] Error listing knowledge nodes:', error);
      res.status(500).json({ error: 'Failed to list knowledge nodes' });
    }
  });

  /**
   * GET /knowledge/search
   * FTS search for knowledge nodes
   */
  router.get('/search', (req: Request, res: Response) => {
    try {
      const { q, domain, tier, limit } = req.query;

      if (!q) {
        res.status(400).json({ error: 'Query parameter "q" is required' });
        return;
      }

      const maxResults = limit ? parseInt(limit as string, 10) : 20;
      let nodes = knowledgeRepo.searchKnowledgeNodes(q as string, maxResults);

      // Apply optional filters
      if (domain) {
        nodes = nodes.filter(n => n.domains.includes(domain as string));
      }
      if (tier) {
        const tierNum = parseInt(tier as string, 10) as KnowledgeTier;
        nodes = nodes.filter(n => n.tier === tierNum);
      }

      res.json({ nodes });
    } catch (error) {
      log.error('[KnowledgeAPI] Error searching knowledge nodes:', error);
      res.status(500).json({ error: 'Failed to search knowledge nodes' });
    }
  });

  /**
   * POST /knowledge
   * Create a new knowledge node
   */
  router.post('/', (req: Request, res: Response) => {
    try {
      const { content, tier, domains, group_id, tags } = req.body;

      if (!content || tier === undefined) {
        res.status(400).json({ error: 'content and tier are required' });
        return;
      }

      // Validate tier
      if (![1, 2, 3].includes(tier)) {
        res.status(400).json({ error: 'tier must be 1, 2, or 3' });
        return;
      }

      const node = knowledgeRepo.createKnowledgeNode({
        id: crypto.randomUUID(),
        tier: tier as KnowledgeTier,
        content,
        source: 'user-created',
        scopeGroupId: group_id || null,
        domains: domains || [],
        tags: tags || [],
      });

      res.status(201).json({ node });
    } catch (error) {
      log.error('[KnowledgeAPI] Error creating knowledge node:', error);
      res.status(500).json({ error: 'Failed to create knowledge node' });
    }
  });

  /**
   * DELETE /knowledge/:id
   * Delete a knowledge node
   */
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const id = getStringParam(req.params.id);

      const existing = knowledgeRepo.getKnowledgeNode(id);
      if (!existing) {
        res.status(404).json({ error: 'Knowledge node not found' });
        return;
      }

      knowledgeRepo.deleteKnowledgeNode(id);
      res.json({ success: true });
    } catch (error) {
      log.error('[KnowledgeAPI] Error deleting knowledge node:', error);
      res.status(500).json({ error: 'Failed to delete knowledge node' });
    }
  });

  /**
   * PATCH /knowledge/:id/pin
   * Pin or unpin a knowledge node (sets confidence to 1.0 when pinned, 0.5 when unpinned)
   */
  router.patch('/:id/pin', (req: Request, res: Response) => {
    try {
      const id = getStringParam(req.params.id);
      const { pinned } = req.body;

      if (typeof pinned !== 'boolean') {
        res.status(400).json({ error: 'pinned must be a boolean' });
        return;
      }

      const existing = knowledgeRepo.getKnowledgeNode(id);
      if (!existing) {
        res.status(404).json({ error: 'Knowledge node not found' });
        return;
      }

      // Pinning boosts confidence to 1.0, unpinning sets to 0.5
      knowledgeRepo.updateKnowledgeNode(id, {
        confidence: pinned ? 1.0 : 0.5,
      });

      res.json({ success: true });
    } catch (error) {
      log.error('[KnowledgeAPI] Error updating knowledge node:', error);
      res.status(500).json({ error: 'Failed to update knowledge node' });
    }
  });

  /**
   * GET /knowledge/:id/related
   * Get related nodes via edges
   */
  router.get('/:id/related', (req: Request, res: Response) => {
    try {
      const id = getStringParam(req.params.id);
      const { relationship, limit } = req.query;
      const maxResults = limit ? parseInt(limit as string, 10) : 20;

      const existing = knowledgeRepo.getKnowledgeNode(id);
      if (!existing) {
        res.status(404).json({ error: 'Knowledge node not found' });
        return;
      }

      let edges = knowledgeRepo.getEdgesForNode(id, 'both');

      // Filter by relationship type if specified
      if (relationship) {
        edges = edges.filter(e => e.relationship === relationship);
      }

      // Get the connected nodes
      const connectedNodeIds = new Set<string>();
      for (const edge of edges) {
        if (edge.sourceId === id) {
          connectedNodeIds.add(edge.targetId);
        } else {
          connectedNodeIds.add(edge.sourceId);
        }
      }

      const relatedNodes = [];
      for (const nodeId of connectedNodeIds) {
        const node = knowledgeRepo.getKnowledgeNode(nodeId);
        if (node) {
          relatedNodes.push(node);
        }
        if (relatedNodes.length >= maxResults) break;
      }

      res.json({ edges, nodes: relatedNodes });
    } catch (error) {
      log.error('[KnowledgeAPI] Error getting related nodes:', error);
      res.status(500).json({ error: 'Failed to get related nodes' });
    }
  });

  /**
   * POST /knowledge/:id/promote
   * Promote a knowledge node to a higher tier
   */
  router.post('/:id/promote', (req: Request, res: Response) => {
    try {
      const id = getStringParam(req.params.id);
      const { to_tier, evidence } = req.body;

      if (to_tier === undefined) {
        res.status(400).json({ error: 'to_tier is required' });
        return;
      }

      if (![1, 2, 3].includes(to_tier)) {
        res.status(400).json({ error: 'to_tier must be 1, 2, or 3' });
        return;
      }

      const existing = knowledgeRepo.getKnowledgeNode(id);
      if (!existing) {
        res.status(404).json({ error: 'Knowledge node not found' });
        return;
      }

      if (to_tier <= existing.tier) {
        res.status(400).json({ error: `Cannot promote: node is already at tier ${existing.tier}, target tier ${to_tier} must be higher` });
        return;
      }

      const fromTier = existing.tier;

      // Update the node tier
      knowledgeRepo.updateKnowledgeNode(id, { tier: to_tier as KnowledgeTier });

      // Log the promotion
      const promotion = knowledgeRepo.logPromotion({
        id: crypto.randomUUID(),
        nodeId: id,
        fromTier: fromTier,
        toTier: to_tier as KnowledgeTier,
        trigger: 'manual',
        evidence: evidence || [],
      });

      res.json({ success: true, promotion });
    } catch (error) {
      log.error('[KnowledgeAPI] Error promoting knowledge node:', error);
      res.status(500).json({ error: 'Failed to promote knowledge node' });
    }
  });

  /**
   * GET /knowledge/groups
   * List available groups (convenience endpoint for MCP)
   */
  router.get('/groups', (_req: Request, res: Response) => {
    try {
      const groups = groupsRepo.getAllGroups();
      res.json({ groups: groups.map(g => ({ id: g.id, name: g.name })) });
    } catch (error) {
      log.error('[KnowledgeAPI] Error listing groups:', error);
      res.status(500).json({ error: 'Failed to list groups' });
    }
  });

  return router;
}
