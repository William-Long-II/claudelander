import React, { useState, useEffect, useCallback } from 'react';
import { KnowledgeNode, KnowledgeEdge, KnowledgeTier } from '../../../shared/types';

interface NodeDetailPanelProps {
  nodeId: string;
  onBack: () => void;
  onNavigateToNode: (nodeId: string) => void;
}

function getTierLabel(tier: KnowledgeTier): string {
  switch (tier) {
    case 1: return 'T1 - Session';
    case 2: return 'T2 - Project';
    case 3: return 'T3 - Global';
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

function formatRelationship(rel: string): string {
  return rel.replace(/_/g, ' ');
}

export function NodeDetailPanel({ nodeId, onBack, onNavigateToNode }: NodeDetailPanelProps) {
  const [node, setNode] = useState<KnowledgeNode | null>(null);
  const [edges, setEdges] = useState<KnowledgeEdge[]>([]);
  const [relatedNodes, setRelatedNodes] = useState<Map<string, KnowledgeNode>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadNode = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const fetchedNode = await window.electronAPI.knowledgeGetNode(nodeId);
      if (!fetchedNode) {
        setError('Node not found');
        return;
      }
      setNode(fetchedNode);

      const fetchedEdges = await window.electronAPI.knowledgeGetRelated(nodeId);
      setEdges(fetchedEdges || []);

      // Fetch related node details
      const relatedMap = new Map<string, KnowledgeNode>();
      for (const edge of (fetchedEdges || [])) {
        const relatedId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
        if (!relatedMap.has(relatedId)) {
          const relatedNode = await window.electronAPI.knowledgeGetNode(relatedId);
          if (relatedNode) {
            relatedMap.set(relatedId, relatedNode);
          }
        }
      }
      setRelatedNodes(relatedMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load node');
    } finally {
      setLoading(false);
    }
  }, [nodeId]);

  useEffect(() => {
    loadNode();
  }, [loadNode]);

  const handlePin = useCallback(async () => {
    if (!node) return;
    const isPinned = node.confidence >= 1.0;
    await window.electronAPI.knowledgePin(node.id, !isPinned);
    loadNode();
  }, [node, loadNode]);

  const handlePromote = useCallback(async () => {
    if (!node || node.tier >= 3) return;
    const nextTier = (node.tier + 1) as KnowledgeTier;
    await window.electronAPI.knowledgePromote(node.id, nextTier);
    loadNode();
  }, [node, loadNode]);

  const handleDelete = useCallback(async () => {
    if (!node) return;
    await window.electronAPI.knowledgeDelete(node.id);
    onBack();
  }, [node, onBack]);

  if (loading) {
    return (
      <div className="knowledge-detail">
        <button className="knowledge-detail-back" onClick={onBack}>
          &larr; Back to list
        </button>
        <div className="knowledge-loading">Loading...</div>
      </div>
    );
  }

  if (error || !node) {
    return (
      <div className="knowledge-detail">
        <button className="knowledge-detail-back" onClick={onBack}>
          &larr; Back to list
        </button>
        <div className="knowledge-error">{error || 'Node not found'}</div>
      </div>
    );
  }

  const isPinned = node.confidence >= 1.0;

  return (
    <div className="knowledge-detail">
      <button className="knowledge-detail-back" onClick={onBack}>
        &larr; Back to list
      </button>

      {/* Header */}
      <div className="knowledge-detail-header">
        <span className={`tier-badge ${getTierClass(node.tier)}`}>
          {getTierLabel(node.tier)}
        </span>
      </div>

      {/* Full content */}
      <div className="knowledge-detail-content">
        {node.content}
      </div>

      {/* Confidence */}
      <div className="knowledge-detail-section">
        <div className="knowledge-detail-section-title">Confidence</div>
        <div className="knowledge-detail-confidence">
          <div className="knowledge-confidence-bar">
            <div
              className={`knowledge-confidence-bar-fill ${getConfidenceClass(node.confidence)}`}
              style={{ width: `${Math.round(node.confidence * 100)}%` }}
            />
          </div>
          <span className="knowledge-detail-confidence-value">
            {Math.round(node.confidence * 100)}%
          </span>
        </div>
      </div>

      {/* Domains */}
      {node.domains && node.domains.length > 0 && (
        <div className="knowledge-detail-section">
          <div className="knowledge-detail-section-title">Domains</div>
          <div className="knowledge-detail-domains">
            {node.domains.map((domain, i) => (
              <span key={i} className="knowledge-domain-tag">{domain}</span>
            ))}
          </div>
        </div>
      )}

      {/* Tags */}
      {node.tags && node.tags.length > 0 && (
        <div className="knowledge-detail-section">
          <div className="knowledge-detail-section-title">Tags</div>
          <div className="knowledge-detail-tags">
            {node.tags.map((tag, i) => (
              <span key={i} className="knowledge-tag">{tag}</span>
            ))}
          </div>
        </div>
      )}

      {/* Related Nodes (Edges) */}
      {edges.length > 0 && (
        <div className="knowledge-detail-section">
          <div className="knowledge-detail-section-title">
            Related Nodes ({edges.length})
          </div>
          <div className="knowledge-edges-list">
            {edges.map((edge) => {
              const relatedId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
              const relatedNode = relatedNodes.get(relatedId);
              return (
                <div
                  key={edge.id}
                  className="knowledge-edge-item"
                  onClick={() => onNavigateToNode(relatedId)}
                >
                  <span className="knowledge-edge-relationship">
                    {formatRelationship(edge.relationship)}
                  </span>
                  <span className="knowledge-edge-preview">
                    {relatedNode ? relatedNode.content.substring(0, 80) : relatedId.substring(0, 8) + '...'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="knowledge-detail-section">
        <div className="knowledge-detail-section-title">Metadata</div>
        <div style={{ fontSize: '12px', color: '#888', lineHeight: 1.6 }}>
          <div>Source: {node.source}</div>
          <div>Created: {new Date(node.createdAt).toLocaleDateString()}</div>
          <div>Last reinforced: {new Date(node.lastReinforcedAt).toLocaleDateString()}</div>
        </div>
      </div>

      {/* Actions */}
      <div className="knowledge-detail-actions">
        <button
          className={`btn-pin ${isPinned ? 'active' : ''}`}
          onClick={handlePin}
          title={isPinned ? 'Unpin (set confidence to 0.5)' : 'Pin (set confidence to 1.0)'}
        >
          {isPinned ? 'Unpin' : 'Pin'}
        </button>
        {node.tier < 3 && (
          <button
            className="btn-promote"
            onClick={handlePromote}
            title={`Promote to T${node.tier + 1}`}
          >
            Promote to T{node.tier + 1}
          </button>
        )}
        <button
          className="btn-delete"
          onClick={handleDelete}
          title="Delete this node"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
