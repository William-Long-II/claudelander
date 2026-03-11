#!/usr/bin/env node
/**
 * ClaudeLander Knowledge MCP Server
 *
 * Provides Claude with tools to access and manage the knowledge graph and code search.
 * Communicates with ClaudeLander via HTTP API (no native dependencies).
 *
 * Run as: node dist/mcp-server/index.js
 *
 * Knowledge Tools:
 * - search_knowledge: FTS search for knowledge nodes
 * - add_knowledge: Create a new knowledge node
 * - get_related: Get edges and connected nodes for a knowledge node
 * - promote_knowledge: Promote a node to a higher tier
 * - list_knowledge: List knowledge nodes with filters
 * - delete_knowledge: Delete a knowledge node
 * - pin_knowledge: Pin/unpin a knowledge node (boost/reduce confidence)
 * - list_groups: List available groups
 *
 * Code Search Tools:
 * - search_code: Semantic code search using natural language
 * - find_symbol: Find function/class/method definitions
 * - get_index_status: Check if a directory is indexed
 * - list_indexes: List all available code indexes
 * - start_indexing: Start indexing a directory for code search
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ClaudeLander API configuration
const API_BASE = process.env.CLAUDELANDER_API_URL || 'http://127.0.0.1:8443';
const API_PREFIX = '/api/v1/knowledge';

// Types
interface KnowledgeNode {
  id: string;
  tier: 1 | 2 | 3;
  content: string;
  confidence: number;
  source: string;
  scopeSessionId: string | null;
  scopeGroupId: string | null;
  domains: string[];
  tags: string[];
  createdAt: string;
  lastReinforcedAt: string;
}

interface KnowledgeEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  weight: number;
  createdAt: string;
}

interface KnowledgePromotion {
  id: string;
  nodeId: string;
  fromTier: number;
  toTier: number;
  trigger: string;
  evidence: string[];
  promotedAt: string;
}

interface Group {
  id: string;
  name: string;
}

// HTTP client helpers
async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${API_PREFIX}${path}`);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${API_PREFIX}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function apiDelete(path: string): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE}${API_PREFIX}${path}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<{ success: boolean }>;
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${API_PREFIX}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

// Knowledge operations via API
async function searchKnowledge(
  query: string,
  domains?: string[],
  tier?: number,
  limit: number = 20
): Promise<KnowledgeNode[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (domains && domains.length > 0) params.set('domain', domains[0]);
  if (tier) params.set('tier', String(tier));

  const result = await apiGet<{ nodes: KnowledgeNode[] }>(`/search?${params}`);
  return result.nodes;
}

async function addKnowledge(
  content: string,
  tier: number,
  domains: string[],
  groupId?: string,
  tags?: string[]
): Promise<KnowledgeNode> {
  const result = await apiPost<{ node: KnowledgeNode }>('/', {
    content,
    tier,
    domains,
    group_id: groupId,
    tags,
  });
  return result.node;
}

async function getRelated(
  nodeId: string,
  relationship?: string,
  limit: number = 20
): Promise<{ edges: KnowledgeEdge[]; nodes: KnowledgeNode[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (relationship) params.set('relationship', relationship);

  return apiGet<{ edges: KnowledgeEdge[]; nodes: KnowledgeNode[] }>(`/${nodeId}/related?${params}`);
}

async function promoteKnowledge(
  nodeId: string,
  toTier: number,
  evidence?: string[]
): Promise<{ success: boolean; promotion: KnowledgePromotion }> {
  return apiPost<{ success: boolean; promotion: KnowledgePromotion }>(`/${nodeId}/promote`, {
    to_tier: toTier,
    evidence: evidence || [],
  });
}

async function listKnowledge(
  groupId?: string,
  tier?: number,
  domains?: string[],
  limit: number = 50
): Promise<KnowledgeNode[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (groupId) params.set('group_id', groupId);
  if (tier) params.set('tier', String(tier));
  if (domains && domains.length > 0) params.set('domain', domains[0]);

  const result = await apiGet<{ nodes: KnowledgeNode[] }>(`?${params}`);
  return result.nodes;
}

async function deleteKnowledge(id: string): Promise<boolean> {
  try {
    await apiDelete(`/${id}`);
    return true;
  } catch {
    return false;
  }
}

async function pinKnowledge(id: string, pinned: boolean): Promise<boolean> {
  try {
    await apiPatch(`/${id}/pin`, { pinned });
    return true;
  } catch {
    return false;
  }
}

async function getGroups(): Promise<Group[]> {
  const result = await apiGet<{ groups: Group[] }>('/groups');
  return result.groups;
}

// Helper to format tier label
function tierLabel(tier: number): string {
  switch (tier) {
    case 1: return 'T1-Session';
    case 2: return 'T2-Project';
    case 3: return 'T3-Global';
    default: return `T${tier}`;
  }
}

// Helper to format a knowledge node for display
function formatNode(n: KnowledgeNode): string {
  const parts = [
    `[${tierLabel(n.tier)}] ${n.content}`,
    `  ID: ${n.id} | Confidence: ${n.confidence.toFixed(2)} | Source: ${n.source}`,
  ];
  if (n.domains.length > 0) parts.push(`  Domains: ${n.domains.join(', ')}`);
  if (n.tags.length > 0) parts.push(`  Tags: ${n.tags.join(', ')}`);
  return parts.join('\n');
}

// Check if ClaudeLander is running
async function checkConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// Create and run server
async function main() {
  // Check if ClaudeLander is running
  const isConnected = await checkConnection();
  if (!isConnected) {
    console.error('[MCP Knowledge] Warning: ClaudeLander is not running. Knowledge tools will not work until ClaudeLander is started.');
  } else {
    console.error('[MCP Knowledge] Connected to ClaudeLander API');
  }

  // Create MCP server
  const server = new McpServer({
    name: 'claudelander-knowledge',
    version: '2.0.0',
  });

  // ── Knowledge Tools ─────────────────────────────────────────────────────────

  // Register search_knowledge tool
  server.registerTool(
    'search_knowledge',
    {
      title: 'Search Knowledge',
      description: 'Search the knowledge graph by keyword or phrase using full-text search. Returns knowledge nodes ranked by confidence. Use this to find relevant context from past sessions and established patterns. Requires ClaudeLander to be running.',
      inputSchema: {
        query: z.string().describe('Search query - keywords or phrases to find in knowledge nodes'),
        domains: z.array(z.string()).optional().describe('Filter by domain(s), e.g. ["typescript", "react"]'),
        tier: z.number().min(1).max(3).optional().describe('Filter by tier: 1=session, 2=project, 3=global'),
        limit: z.number().optional().default(20).describe('Maximum results to return'),
      },
    },
    async ({ query, domains, tier, limit }) => {
      try {
        const nodes = await searchKnowledge(query, domains, tier, limit || 20);
        const text = nodes.length > 0
          ? `Found ${nodes.length} knowledge nodes:\n\n${nodes.map(formatNode).join('\n\n')}`
          : 'No knowledge nodes found matching your query.';
        return { content: [{ type: 'text', text }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error searching knowledge: ${msg}. Is ClaudeLander running?` }] };
      }
    }
  );

  // Register add_knowledge tool
  server.registerTool(
    'add_knowledge',
    {
      title: 'Add Knowledge',
      description: 'Store a new knowledge node in the knowledge graph. Knowledge is organized into 3 tiers: Tier 1 (session-scoped, ephemeral), Tier 2 (project-level, persists across sessions), Tier 3 (global, highest confidence). Requires ClaudeLander to be running.',
      inputSchema: {
        content: z.string().describe('The content of the knowledge to store'),
        tier: z.number().min(1).max(3).describe('Knowledge tier: 1=session (ephemeral), 2=project (persistent), 3=global (established)'),
        domains: z.array(z.string()).describe('Domains this knowledge belongs to, e.g. ["typescript", "error-handling", "react"]'),
        group_id: z.string().optional().describe('Group ID to scope the knowledge to. Use list_groups to see available groups.'),
        tags: z.array(z.string()).optional().describe('Tags for categorization'),
      },
    },
    async ({ content, tier, domains, group_id, tags }) => {
      try {
        const node = await addKnowledge(content, tier, domains, group_id, tags);
        return {
          content: [{
            type: 'text',
            text: `Knowledge stored successfully!\n${formatNode(node)}`,
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error adding knowledge: ${msg}. Is ClaudeLander running?` }] };
      }
    }
  );

  // Register get_related tool
  server.registerTool(
    'get_related',
    {
      title: 'Get Related Knowledge',
      description: 'Get knowledge nodes connected to a given node via edges in the knowledge graph. Returns both the edges (relationships) and the connected nodes. Useful for exploring how knowledge is linked. Requires ClaudeLander to be running.',
      inputSchema: {
        node_id: z.string().describe('The ID of the knowledge node to find relations for'),
        relationship: z.enum(['derived_from', 'supports', 'contradicts', 'relates_to', 'applied_in', 'same_domain']).optional()
          .describe('Filter by relationship type'),
        limit: z.number().optional().default(20).describe('Maximum related nodes to return'),
      },
    },
    async ({ node_id, relationship, limit }) => {
      try {
        const { edges, nodes } = await getRelated(node_id, relationship, limit || 20);

        if (nodes.length === 0) {
          return { content: [{ type: 'text', text: `No related knowledge nodes found for ${node_id}.` }] };
        }

        const edgesSummary = edges.map(e => {
          const direction = e.sourceId === node_id ? '->' : '<-';
          const otherId = e.sourceId === node_id ? e.targetId : e.sourceId;
          return `  ${direction} [${e.relationship}] ${otherId} (weight: ${e.weight.toFixed(2)})`;
        }).join('\n');

        const nodesSummary = nodes.map(formatNode).join('\n\n');

        const text = `Edges (${edges.length}):\n${edgesSummary}\n\nConnected Nodes (${nodes.length}):\n\n${nodesSummary}`;
        return { content: [{ type: 'text', text }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error getting related knowledge: ${msg}. Is ClaudeLander running?` }] };
      }
    }
  );

  // Register promote_knowledge tool
  server.registerTool(
    'promote_knowledge',
    {
      title: 'Promote Knowledge',
      description: 'Promote a knowledge node to a higher tier. Tier 1 -> Tier 2 means the knowledge has proven useful across sessions. Tier 2 -> Tier 3 means it is established global knowledge. Promotion is logged for auditing. Requires ClaudeLander to be running.',
      inputSchema: {
        node_id: z.string().describe('The ID of the knowledge node to promote'),
        to_tier: z.number().min(2).max(3).describe('Target tier: 2=project, 3=global. Must be higher than current tier.'),
        evidence: z.array(z.string()).optional().describe('Evidence supporting the promotion, e.g. ["Used in 5 sessions", "Confirmed by user"]'),
      },
    },
    async ({ node_id, to_tier, evidence }) => {
      try {
        const { promotion } = await promoteKnowledge(node_id, to_tier, evidence);
        return {
          content: [{
            type: 'text',
            text: `Knowledge promoted successfully!\n` +
              `Node: ${promotion.nodeId}\n` +
              `${tierLabel(promotion.fromTier)} -> ${tierLabel(promotion.toTier)}\n` +
              `Trigger: ${promotion.trigger}` +
              (promotion.evidence.length > 0 ? `\nEvidence: ${promotion.evidence.join('; ')}` : ''),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error promoting knowledge: ${msg}. Is ClaudeLander running?` }] };
      }
    }
  );

  // Register list_knowledge tool
  server.registerTool(
    'list_knowledge',
    {
      title: 'List Knowledge',
      description: 'List knowledge nodes with optional filters. Returns nodes sorted by confidence. Requires ClaudeLander to be running.',
      inputSchema: {
        group_id: z.string().optional().describe('Filter by group ID'),
        tier: z.number().min(1).max(3).optional().describe('Filter by tier: 1=session, 2=project, 3=global'),
        domains: z.array(z.string()).optional().describe('Filter by domain(s)'),
        limit: z.number().optional().default(50).describe('Maximum results to return'),
      },
    },
    async ({ group_id, tier, domains, limit }) => {
      try {
        const nodes = await listKnowledge(group_id, tier, domains, limit || 50);
        const text = nodes.length > 0
          ? `Found ${nodes.length} knowledge nodes:\n\n${nodes.map(formatNode).join('\n\n')}`
          : 'No knowledge nodes found.';
        return { content: [{ type: 'text', text }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error listing knowledge: ${msg}. Is ClaudeLander running?` }] };
      }
    }
  );

  // Register delete_knowledge tool
  server.registerTool(
    'delete_knowledge',
    {
      title: 'Delete Knowledge',
      description: 'Delete a knowledge node by ID. This also removes associated edges. Requires ClaudeLander to be running.',
      inputSchema: {
        id: z.string().describe('The ID of the knowledge node to delete'),
      },
    },
    async ({ id }) => {
      try {
        const success = await deleteKnowledge(id);
        return {
          content: [{
            type: 'text',
            text: success ? `Knowledge node ${id} deleted successfully.` : `Knowledge node ${id} not found.`,
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error deleting knowledge: ${msg}. Is ClaudeLander running?` }] };
      }
    }
  );

  // Register pin_knowledge tool
  server.registerTool(
    'pin_knowledge',
    {
      title: 'Pin Knowledge',
      description: 'Pin or unpin a knowledge node. Pinning boosts confidence to 1.0 (maximum), making it appear first in search results and preventing confidence decay. Unpinning sets confidence to 0.5. Requires ClaudeLander to be running.',
      inputSchema: {
        id: z.string().describe('The ID of the knowledge node to pin/unpin'),
        pinned: z.boolean().describe('True to pin (confidence -> 1.0), false to unpin (confidence -> 0.5)'),
      },
    },
    async ({ id, pinned }) => {
      try {
        const success = await pinKnowledge(id, pinned);
        return {
          content: [{
            type: 'text',
            text: success
              ? `Knowledge node ${id} ${pinned ? 'pinned (confidence set to 1.0)' : 'unpinned (confidence set to 0.5)'}.`
              : `Knowledge node ${id} not found.`,
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error updating knowledge: ${msg}. Is ClaudeLander running?` }] };
      }
    }
  );

  // ── Group Tool ──────────────────────────────────────────────────────────────

  // Register list_groups tool
  server.registerTool(
    'list_groups',
    {
      title: 'List Groups',
      description: 'List available groups. Groups organize knowledge and sessions by project/context. Requires ClaudeLander to be running.',
      inputSchema: {},
    },
    async () => {
      try {
        const groups = await getGroups();
        const text = groups.length > 0
          ? `Available groups:\n${groups.map(g => `- ${g.name} (ID: ${g.id})`).join('\n')}`
          : 'No groups found. Create a group in ClaudeLander first.';
        return { content: [{ type: 'text', text }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error listing groups: ${msg}. Is ClaudeLander running?` }] };
      }
    }
  );

  // ── Code Search Tools ───────────────────────────────────────────────────────

  // Register search_code tool (semantic code search)
  server.registerTool(
    'search_code',
    {
      title: 'Semantic Code Search',
      description: 'Search the codebase semantically using natural language queries. Returns relevant code chunks ranked by similarity. The codebase must be indexed first. Requires ClaudeLander to be running.',
      inputSchema: {
        query: z.string().describe('Natural language query describing what code to find'),
        path: z.string().optional().describe('Directory path to search in. Defaults to current working directory.'),
        limit: z.number().optional().default(10).describe('Maximum results to return'),
      },
    },
    async ({ query, path, limit }) => {
      try {
        const searchPath = path || process.cwd();
        const params = new URLSearchParams({
          q: query,
          path: searchPath,
          limit: String(limit || 10),
        });

        const response = await fetch(`${API_BASE}/api/v1/code/search?${params}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        const { results } = await response.json() as { results: any[] };

        if (results.length === 0) {
          return {
            content: [{ type: 'text', text: 'No matching code found. Make sure the directory is indexed.' }],
          };
        }

        const formatted = results.map((r, i) =>
          `### Result ${i + 1} (${Math.round(r.score * 100)}% match)\n` +
          `**File:** ${r.filePath}:${r.startLine}-${r.endLine}\n` +
          `\`\`\`\n${r.content}\n\`\`\``
        ).join('\n\n');

        return {
          content: [{ type: 'text', text: formatted }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error searching code: ${msg}. Is ClaudeLander running?` }] };
      }
    }
  );

  // Register find_symbol tool
  server.registerTool(
    'find_symbol',
    {
      title: 'Find Symbol Definition',
      description: 'Find where a function, class, method, or other symbol is defined in the codebase. The codebase must be indexed first. Requires ClaudeLander to be running.',
      inputSchema: {
        name: z.string().describe('Name of the symbol to find (function, class, method, variable, interface, or type)'),
        path: z.string().optional().describe('Directory path to search in. Defaults to current working directory.'),
        symbol_type: z.enum(['function', 'class', 'method', 'variable', 'interface', 'type']).optional()
          .describe('Type of symbol to find'),
        limit: z.number().optional().default(20).describe('Maximum results to return'),
      },
    },
    async ({ name, path, symbol_type, limit }) => {
      try {
        const searchPath = path || process.cwd();
        const params = new URLSearchParams({
          name,
          path: searchPath,
          limit: String(limit || 20),
        });
        if (symbol_type) params.set('type', symbol_type);

        const response = await fetch(`${API_BASE}/api/v1/code/symbols?${params}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        const { results } = await response.json() as { results: any[] };

        if (results.length === 0) {
          return {
            content: [{ type: 'text', text: `No symbol named "${name}" found. Make sure the directory is indexed.` }],
          };
        }

        const formatted = results.map(r =>
          `- **${r.symbolType}** \`${r.name}\` at ${r.filePath}:${r.line}:${r.column}` +
          (r.signature ? `\n  Signature: \`${r.signature}\`` : '')
        ).join('\n');

        return {
          content: [{ type: 'text', text: `Found ${results.length} definition(s):\n\n${formatted}` }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error finding symbol: ${msg}. Is ClaudeLander running?` }] };
      }
    }
  );

  // Register get_index_status tool
  server.registerTool(
    'get_index_status',
    {
      title: 'Get Code Index Status',
      description: 'Check if a directory has been indexed for semantic code search. Use this before search_code to verify the codebase is ready for searching. Requires ClaudeLander to be running.',
      inputSchema: {
        path: z.string().describe('Directory path to check. Use the working directory of the current project.'),
      },
    },
    async ({ path }) => {
      try {
        const params = new URLSearchParams({ path });
        const response = await fetch(`${API_BASE}/api/v1/code/index/status?${params}`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        const { index } = await response.json() as { index: any | null };

        if (!index) {
          return {
            content: [{ type: 'text', text: `Directory "${path}" has not been indexed.\n\nUse start_indexing to index this codebase for semantic search.` }],
          };
        }

        const statusEmojiMap: Record<string, string> = {
          ready: '✅',
          indexing: '🔄',
          pending: '⏳',
          error: '❌',
          stale: '⚠️',
        };
        const statusEmoji = statusEmojiMap[index.status as string] || '❓';

        const text = `Index Status for: ${path}\n\n` +
          `${statusEmoji} Status: ${index.status}\n` +
          `📁 Files: ${index.fileCount}\n` +
          `📦 Chunks: ${index.chunkCount}\n` +
          `🔣 Symbols: ${index.symbolCount}\n` +
          `🤖 Model: ${index.modelName}\n` +
          (index.lastIndexedAt ? `📅 Last indexed: ${index.lastIndexedAt}\n` : '') +
          (index.errorMessage ? `\n⚠️ Error: ${index.errorMessage}` : '');

        return { content: [{ type: 'text', text }] };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error checking index status: ${msg}. Is ClaudeLander running?` }] };
      }
    }
  );

  // Register list_indexes tool
  server.registerTool(
    'list_indexes',
    {
      title: 'List Code Indexes',
      description: 'List all available code indexes. Shows which directories have been indexed for semantic code search. Requires ClaudeLander to be running.',
      inputSchema: {},
    },
    async () => {
      try {
        const response = await fetch(`${API_BASE}/api/v1/code/indexes`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        const { indexes } = await response.json() as { indexes: any[] };

        if (indexes.length === 0) {
          return {
            content: [{ type: 'text', text: 'No code indexes found.\n\nUse start_indexing to index a codebase for semantic search.' }],
          };
        }

        const statusEmojiMap: Record<string, string> = {
          ready: '✅',
          indexing: '🔄',
          pending: '⏳',
          error: '❌',
          stale: '⚠️',
        };
        const formatted = indexes.map(idx => {
          const statusEmoji = statusEmojiMap[idx.status as string] || '❓';
          return `${statusEmoji} ${idx.directoryPath}\n   Status: ${idx.status} | Files: ${idx.fileCount} | Chunks: ${idx.chunkCount}`;
        }).join('\n\n');

        return {
          content: [{ type: 'text', text: `Found ${indexes.length} code index(es):\n\n${formatted}` }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error listing indexes: ${msg}. Is ClaudeLander running?` }] };
      }
    }
  );

  // Register start_indexing tool
  server.registerTool(
    'start_indexing',
    {
      title: 'Start Code Indexing',
      description: 'Start indexing a directory for semantic code search. WARNING: Indexing can be resource-intensive (CPU, memory) and may take several minutes for large codebases. The index will be built in the background. Use get_index_status to check progress. Requires ClaudeLander to be running.',
      inputSchema: {
        path: z.string().describe('Directory path to index. This should be the root of the codebase you want to search.'),
      },
    },
    async ({ path }) => {
      try {
        const response = await fetch(`${API_BASE}/api/v1/code/index`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        });
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
          throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        return {
          content: [{
            type: 'text',
            text: `Indexing started for: ${path}\n\n` +
              `Indexing runs in the background. This may take several minutes for large codebases.\n\n` +
              `Use get_index_status to check progress.\n` +
              `Once status is "ready", you can use search_code and find_symbol.`,
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: `Error starting indexing: ${msg}. Is ClaudeLander running?` }] };
      }
    }
  );

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP Knowledge] Server started');
}

main().catch((err) => {
  console.error('[MCP Knowledge] Fatal error:', err);
  process.exit(1);
});
