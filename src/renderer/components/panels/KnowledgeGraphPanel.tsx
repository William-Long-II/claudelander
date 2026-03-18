import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Panel } from './Panel';
import { NodeDetailPanel } from './NodeDetailPanel';
import { KnowledgeNode, KnowledgeTier } from '../../../shared/types';
import './KnowledgeGraphPanel.css';

type TierFilter = 'all' | 1 | 2 | 3;

interface KnowledgeGraphPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

function getTierLabel(tier: KnowledgeTier): string {
  switch (tier) {
    case 1: return 'T1';
    case 2: return 'T2';
    case 3: return 'T3';
    default: return `T${tier}`;
  }
}

function getTierClass(tier: KnowledgeTier): string {
  return `tier-${tier}`;
}

function getConfidenceClass(confidence: number): string {
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.4) return 'medium';
  return 'low';
}

export function KnowledgeGraphPanel({ isOpen, onToggle }: KnowledgeGraphPanelProps) {
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [nodes, setNodes] = useState<KnowledgeNode[]>([]);
  const [allDomains, setAllDomains] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadNodes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let fetchedNodes: KnowledgeNode[];

      if (searchQuery.trim()) {
        fetchedNodes = await window.electronAPI.knowledgeSearch(searchQuery.trim(), 50);
      } else if (domainFilter !== 'all') {
        fetchedNodes = await window.electronAPI.knowledgeGetByDomain(domainFilter, 100);
      } else if (tierFilter !== 'all') {
        fetchedNodes = await window.electronAPI.knowledgeGetByTier(tierFilter, 100);
      } else {
        // Load all tiers
        const [t1, t2, t3] = await Promise.all([
          window.electronAPI.knowledgeGetByTier(1, 100),
          window.electronAPI.knowledgeGetByTier(2, 100),
          window.electronAPI.knowledgeGetByTier(3, 100),
        ]);
        fetchedNodes = [...t1, ...t2, ...t3];
      }

      // Apply tier filter if domain or search returned mixed results
      if (tierFilter !== 'all' && (searchQuery.trim() || domainFilter !== 'all')) {
        fetchedNodes = fetchedNodes.filter(n => n.tier === tierFilter);
      }

      // Sort by confidence descending
      fetchedNodes.sort((a, b) => b.confidence - a.confidence);

      setNodes(fetchedNodes);

      // Collect all unique domains for filter dropdown
      const domainSet = new Set<string>();
      for (const node of fetchedNodes) {
        if (node.domains) {
          for (const d of node.domains) {
            domainSet.add(d);
          }
        }
      }
      setAllDomains(Array.from(domainSet).sort());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load knowledge nodes');
    } finally {
      setLoading(false);
    }
  }, [tierFilter, domainFilter, searchQuery]);

  useEffect(() => {
    if (isOpen) {
      loadNodes();
    }
  }, [isOpen, loadNodes]);

  // Auto-refresh knowledge panel every 10 seconds when open
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      loadNodes();
    }, 10000);
    return () => clearInterval(interval);
  }, [isOpen, loadNodes]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);

    // Debounce the search
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      // loadNodes will fire via the useEffect dependency on searchQuery
    }, 300);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  const handleBackToList = useCallback(() => {
    setSelectedNodeId(null);
    loadNodes(); // Refresh in case something changed
  }, [loadNodes]);

  const handleNavigateToNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  return (
    <Panel
      isOpen={isOpen}
      onToggle={onToggle}
      title="Knowledge Graph"
      icon="K"
    >
      {selectedNodeId ? (
        <NodeDetailPanel
          nodeId={selectedNodeId}
          onBack={handleBackToList}
          onNavigateToNode={handleNavigateToNode}
        />
      ) : (
        <div className="knowledge-panel">
          {/* Tier filter buttons */}
          <div className="knowledge-tier-filters">
            <button
              className={`tier-btn ${tierFilter === 'all' ? 'active' : ''}`}
              onClick={() => setTierFilter('all')}
            >
              All
            </button>
            <button
              className={`tier-btn ${tierFilter === 1 ? 'active' : ''}`}
              onClick={() => setTierFilter(1)}
            >
              T1
            </button>
            <button
              className={`tier-btn ${tierFilter === 2 ? 'active' : ''}`}
              onClick={() => setTierFilter(2)}
            >
              T2
            </button>
            <button
              className={`tier-btn ${tierFilter === 3 ? 'active' : ''}`}
              onClick={() => setTierFilter(3)}
            >
              T3
            </button>
          </div>

          {/* Domain filter dropdown */}
          {allDomains.length > 0 && (
            <div className="knowledge-domain-filter">
              <select
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value)}
              >
                <option value="all">All Domains</option>
                {allDomains.map((domain) => (
                  <option key={domain} value={domain}>{domain}</option>
                ))}
              </select>
            </div>
          )}

          {/* Search */}
          <div className="knowledge-search">
            <input
              type="text"
              placeholder="Search knowledge nodes..."
              value={searchQuery}
              onChange={handleSearchChange}
            />
            {searchQuery && (
              <button
                onClick={handleClearSearch}
                className="knowledge-search-clear"
                aria-label="Clear search"
              >
                x
              </button>
            )}
          </div>

          {/* Loading state */}
          {loading && <div className="knowledge-loading">Loading...</div>}

          {/* Error state */}
          {error && <div className="knowledge-error">{error}</div>}

          {/* Node list */}
          {!loading && !error && (
            <div className="knowledge-node-list">
              {nodes.length === 0 ? (
                <div className="knowledge-empty">
                  {searchQuery
                    ? `No nodes match "${searchQuery}"`
                    : 'No knowledge nodes found'}
                </div>
              ) : (
                nodes.map((node) => (
                  <div
                    key={node.id}
                    className="knowledge-node-card"
                    onClick={() => handleNodeClick(node.id)}
                  >
                    <div className="knowledge-node-card-header">
                      <span className={`tier-badge ${getTierClass(node.tier)}`}>
                        {getTierLabel(node.tier)}
                      </span>
                      <span className="knowledge-node-content-preview">
                        {node.content}
                      </span>
                    </div>
                    <div className="knowledge-confidence-bar-container">
                      <div className="knowledge-confidence-bar">
                        <div
                          className={`knowledge-confidence-bar-fill ${getConfidenceClass(node.confidence)}`}
                          style={{ width: `${Math.round(node.confidence * 100)}%` }}
                        />
                      </div>
                      <span className="knowledge-confidence-value">
                        {Math.round(node.confidence * 100)}%
                      </span>
                    </div>
                    {node.domains && node.domains.length > 0 && (
                      <div className="knowledge-node-domains">
                        {node.domains.map((domain, i) => (
                          <span key={i} className="knowledge-domain-tag">{domain}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
