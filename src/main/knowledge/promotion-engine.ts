import {
  getKnowledgeNodesByTier,
  applyConfidenceDecay,
} from '../repositories/knowledge';
import { KnowledgeNode, KnowledgeTier } from '../../shared/types';

export interface PromotionCandidate {
  fromTier: KnowledgeTier;
  toTier: KnowledgeTier;
  proposedContent: string;
  domains: string[];
  evidence: string[];  // node IDs
  trigger: string;
}

/**
 * Find Tier 1 facts that could be promoted to Tier 2 patterns.
 * Groups facts by domain, finds clusters of 3+, proposes patterns.
 *
 * Uses simple text similarity (shared word overlap) rather than embeddings
 * for the initial version. Embeddings can be added later for better clustering.
 */
export function findPromotionCandidates(): PromotionCandidate[] {
  const candidates: PromotionCandidate[] = [];
  const tier1 = getKnowledgeNodesByTier(1, 500);

  // Group by domain
  const domainGroups = new Map<string, KnowledgeNode[]>();
  for (const node of tier1) {
    for (const domain of node.domains) {
      if (!domainGroups.has(domain)) {
        domainGroups.set(domain, []);
      }
      domainGroups.get(domain)!.push(node);
    }
  }

  // For each domain with 3+ facts, check for clusters
  for (const [domain, nodes] of domainGroups) {
    if (nodes.length < 3) continue;

    // Simple clustering: find groups of nodes with high word overlap
    const clusters = clusterByWordOverlap(nodes, 0.3);

    for (const cluster of clusters) {
      if (cluster.length < 3) continue;

      // Use the highest-confidence node as the representative content,
      // with a note about how many observations reinforced it
      const sorted = [...cluster].sort((a, b) => b.confidence - a.confidence);
      const representative = sorted[0];
      // Trim to first 2 sentences for a concise pattern
      const sentences = representative.content.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
      const proposedContent = `${sentences} (recurring pattern from ${cluster.length} observations in ${domain})`;

      candidates.push({
        fromTier: 1,
        toTier: 2,
        proposedContent,
        domains: [domain],
        evidence: cluster.map(n => n.id),
        trigger: 'repetition',
      });
    }
  }

  return candidates;
}

function clusterByWordOverlap(nodes: KnowledgeNode[], threshold: number): KnowledgeNode[][] {
  const clusters: KnowledgeNode[][] = [];
  const assigned = new Set<string>();

  for (let i = 0; i < nodes.length; i++) {
    if (assigned.has(nodes[i].id)) continue;

    const cluster = [nodes[i]];
    assigned.add(nodes[i].id);

    for (let j = i + 1; j < nodes.length; j++) {
      if (assigned.has(nodes[j].id)) continue;

      if (wordOverlap(nodes[i].content, nodes[j].content) >= threshold) {
        cluster.push(nodes[j]);
        assigned.add(nodes[j].id);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }

  return overlap / Math.min(wordsA.size, wordsB.size);
}

function findCommonKeywords(nodes: KnowledgeNode[]): string[] {
  const wordCounts = new Map<string, number>();
  for (const node of nodes) {
    const words = new Set(node.content.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  }

  // Words that appear in majority of nodes
  const threshold = Math.ceil(nodes.length * 0.5);
  return Array.from(wordCounts.entries())
    .filter(([_, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

/**
 * Apply confidence decay to all nodes that haven't been reinforced recently.
 * Should be called periodically (e.g., on app startup or every N sessions).
 */
export function applyDecayPass(): number {
  // ~0.7% per day ≈ 5% per week, applied to nodes not reinforced in 7+ days
  return applyConfidenceDecay(0.007, 7);
}
