import React, { useState, useCallback } from 'react';
import { Panel } from './Panel';
import { useMemories } from '../../store/memories';
import { Memory, MemoryType } from '../../../shared/types';
import './MemoryPanel.css';

interface MemoryPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  sessionId: string | null;
  groupId: string | null;
}

const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  decision: 'Decisions',
  error_fix: 'Error Fixes',
  pattern: 'Patterns',
  context: 'Context',
  note: 'Notes',
};

const MEMORY_TYPE_ICONS: Record<MemoryType, string> = {
  decision: '→',
  error_fix: '✓',
  pattern: '◆',
  context: '○',
  note: '♦',
};

export const MemoryPanel: React.FC<MemoryPanelProps> = ({
  isOpen,
  onToggle,
  sessionId,
  groupId,
}) => {
  const {
    memories,
    pinnedMemories,
    loading,
    searchQuery,
    isSearching,
    createMemory,
    updateMemory,
    deleteMemory,
    togglePin,
    search,
    clearSearch,
    getMemoriesByType,
  } = useMemories({ sessionId, groupId });

  const [isAdding, setIsAdding] = useState(false);
  const [newMemoryType, setNewMemoryType] = useState<MemoryType>('note');
  const [newMemoryContent, setNewMemoryContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const handleAddMemory = useCallback(async () => {
    if (!newMemoryContent.trim()) return;

    await createMemory(newMemoryType, newMemoryContent.trim());
    setNewMemoryContent('');
    setIsAdding(false);
  }, [createMemory, newMemoryType, newMemoryContent]);

  const handleStartEdit = useCallback((memory: Memory) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId || !editContent.trim()) return;

    await updateMemory(editingId, { content: editContent.trim() });
    setEditingId(null);
    setEditContent('');
  }, [editingId, editContent, updateMemory]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditContent('');
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    if (window.confirm('Delete this memory?')) {
      await deleteMemory(id);
    }
  }, [deleteMemory]);

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const renderMemory = (memory: Memory) => {
    const isEditing = editingId === memory.id;

    return (
      <div key={memory.id} className={`memory-item ${memory.pinned ? 'pinned' : ''}`}>
        <div className="memory-header">
          <span className="memory-type-icon" title={MEMORY_TYPE_LABELS[memory.type]}>
            {MEMORY_TYPE_ICONS[memory.type]}
          </span>
          <span className="memory-date">{formatDate(memory.createdAt)}</span>
          <span className={`memory-source ${memory.source}`}>{memory.source}</span>
          <div className="memory-actions">
            <button
              className={`memory-action-btn pin ${memory.pinned ? 'active' : ''}`}
              onClick={() => togglePin(memory.id)}
              title={memory.pinned ? 'Unpin' : 'Pin'}
            >
              📌
            </button>
            <button
              className="memory-action-btn edit"
              onClick={() => handleStartEdit(memory)}
              title="Edit"
            >
              ✎
            </button>
            <button
              className="memory-action-btn delete"
              onClick={() => handleDelete(memory.id)}
              title="Delete"
            >
              ×
            </button>
          </div>
        </div>
        {isEditing ? (
          <div className="memory-edit">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                  handleSaveEdit();
                } else if (e.key === 'Escape') {
                  handleCancelEdit();
                }
              }}
            />
            <div className="memory-edit-actions">
              <button className="btn-save" onClick={handleSaveEdit}>Save</button>
              <button className="btn-cancel" onClick={handleCancelEdit}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="memory-content">{memory.content}</div>
        )}
      </div>
    );
  };

  const groupedMemories = getMemoriesByType();

  return (
    <Panel
      isOpen={isOpen}
      onToggle={onToggle}
      title="Memory"
      position="right"
      defaultWidth={320}
      minWidth={280}
      maxWidth={500}
    >
      <div className="memory-panel">
        {/* Search */}
        <div className="memory-search">
          <input
            type="text"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => search(e.target.value)}
          />
          {isSearching && (
            <button className="search-clear" onClick={clearSearch} title="Clear search">
              ×
            </button>
          )}
        </div>

        {/* Add button */}
        {!isAdding && (
          <button className="memory-add-btn" onClick={() => setIsAdding(true)}>
            + Add Memory
          </button>
        )}

        {/* Add form */}
        {isAdding && (
          <div className="memory-add-form">
            <select
              value={newMemoryType}
              onChange={(e) => setNewMemoryType(e.target.value as MemoryType)}
            >
              <option value="note">Note</option>
              <option value="decision">Decision</option>
              <option value="error_fix">Error Fix</option>
              <option value="pattern">Pattern</option>
              <option value="context">Context</option>
            </select>
            <textarea
              placeholder="Enter memory content..."
              value={newMemoryContent}
              onChange={(e) => setNewMemoryContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                  handleAddMemory();
                } else if (e.key === 'Escape') {
                  setIsAdding(false);
                  setNewMemoryContent('');
                }
              }}
              autoFocus
            />
            <div className="memory-add-actions">
              <button className="btn-save" onClick={handleAddMemory}>Add</button>
              <button
                className="btn-cancel"
                onClick={() => {
                  setIsAdding(false);
                  setNewMemoryContent('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="memory-loading">Loading...</div>
        ) : memories.length === 0 ? (
          <div className="memory-empty">
            {isSearching
              ? 'No memories match your search'
              : 'No memories yet. Add one or let Claude capture them automatically.'}
          </div>
        ) : (
          <div className="memory-list">
            {/* Pinned section */}
            {pinnedMemories.length > 0 && !isSearching && (
              <div className="memory-section">
                <h4 className="memory-section-title">📌 Pinned</h4>
                {pinnedMemories.map(renderMemory)}
              </div>
            )}

            {/* Grouped by type */}
            {(['decision', 'error_fix', 'pattern', 'context', 'note'] as MemoryType[]).map(type => {
              const typeMemories = groupedMemories[type].filter(m => !m.pinned || isSearching);
              if (typeMemories.length === 0) return null;

              return (
                <div key={type} className="memory-section">
                  <h4 className="memory-section-title">
                    {MEMORY_TYPE_ICONS[type]} {MEMORY_TYPE_LABELS[type]}
                  </h4>
                  {typeMemories.map(renderMemory)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
};

export default MemoryPanel;
