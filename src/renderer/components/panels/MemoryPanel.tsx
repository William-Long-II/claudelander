import React, { useState, useCallback } from 'react';
import { Panel } from './Panel';
import { useMemories } from '../../store/memories';
import { Memory, MemoryType, GLOBAL_CONTEXT_GROUP_ID } from '../../../shared/types';
import './MemoryPanel.css';

type ContextMode = 'project' | 'global';

interface MemoryPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  sessionId: string | null;
  groupId: string | null;
}

const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  decision: 'Decision',
  error_fix: 'Error Fix',
  pattern: 'Pattern',
  context: 'Context',
  note: 'Note',
};

const MEMORY_TYPE_ICONS: Record<MemoryType, string> = {
  decision: '!',
  error_fix: 'x',
  pattern: '#',
  context: 'i',
  note: '*',
};

export function MemoryPanel({ isOpen, onToggle, sessionId, groupId }: MemoryPanelProps) {
  const [contextMode, setContextMode] = useState<ContextMode>('project');

  // Use the appropriate groupId based on context mode
  const effectiveGroupId = contextMode === 'global' ? GLOBAL_CONTEXT_GROUP_ID : groupId;
  const effectiveSessionId = contextMode === 'global' ? null : sessionId;

  const {
    memories,
    pinnedMemories,
    loading,
    error,
    searchQuery,
    searchResults,
    createMemory,
    updateMemory,
    deleteMemory,
    togglePin,
    search,
    clearSearch,
  } = useMemories(effectiveSessionId, effectiveGroupId);

  const [isAdding, setIsAdding] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState<MemoryType>('note');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    search(query);
  }, [search]);

  const handleAddMemory = useCallback(async () => {
    if (!newContent.trim()) return;

    await createMemory(newType, newContent.trim());
    setNewContent('');
    setNewType('note');
    setIsAdding(false);
  }, [newContent, newType, createMemory]);

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

  const displayMemories = searchResults !== null ? searchResults : memories;

  // Group memories by type
  const groupedMemories = displayMemories.reduce((acc, memory) => {
    if (!acc[memory.type]) {
      acc[memory.type] = [];
    }
    acc[memory.type].push(memory);
    return acc;
  }, {} as Record<MemoryType, Memory[]>);

  const renderMemoryItem = (memory: Memory) => {
    const isEditing = editingId === memory.id;

    return (
      <div key={memory.id} className={`memory-item ${memory.pinned ? 'pinned' : ''}`}>
        {isEditing ? (
          <div className="memory-edit">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              autoFocus
              rows={3}
            />
            <div className="memory-edit-actions">
              <button onClick={handleSaveEdit} className="btn-save">Save</button>
              <button onClick={handleCancelEdit} className="btn-cancel">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="memory-content">{memory.content}</div>
            <div className="memory-meta">
              <span className="memory-date">
                {new Date(memory.createdAt).toLocaleDateString()}
              </span>
              {memory.source !== 'manual' && (
                <span className="memory-source">{memory.source}</span>
              )}
            </div>
            <div className="memory-actions">
              <button
                onClick={() => togglePin(memory.id)}
                className={`btn-pin ${memory.pinned ? 'active' : ''}`}
                title={memory.pinned ? 'Unpin' : 'Pin'}
                aria-label={memory.pinned ? 'Unpin memory' : 'Pin memory'}
              >
                {memory.pinned ? '!' : 'o'}
              </button>
              <button
                onClick={() => handleStartEdit(memory)}
                className="btn-edit"
                title="Edit"
                aria-label="Edit memory"
              >
                /
              </button>
              <button
                onClick={() => deleteMemory(memory.id)}
                className="btn-delete"
                title="Delete"
                aria-label="Delete memory"
              >
                x
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <Panel
      isOpen={isOpen}
      onToggle={onToggle}
      title="Context"
      icon="*"
    >
      <div className="memory-panel">
        {/* Context mode toggle */}
        <div className="context-mode-toggle">
          <button
            className={`mode-btn ${contextMode === 'project' ? 'active' : ''}`}
            onClick={() => setContextMode('project')}
            title="Context for current project only"
          >
            Project
          </button>
          <button
            className={`mode-btn ${contextMode === 'global' ? 'active' : ''}`}
            onClick={() => setContextMode('global')}
            title="Context for all projects"
          >
            Global
          </button>
        </div>

        {/* Search */}
        <div className="memory-search">
          <input
            type="text"
            placeholder={`Search ${contextMode} context...`}
            value={searchQuery}
            onChange={handleSearch}
          />
          {searchQuery && (
            <button onClick={clearSearch} className="search-clear" aria-label="Clear search">x</button>
          )}
        </div>

        {/* Add button */}
        <div className="memory-toolbar">
          <button
            onClick={() => setIsAdding(!isAdding)}
            className="btn-add-memory"
          >
            {isAdding ? 'Cancel' : '+ Add Context'}
          </button>
        </div>

        {/* Add form */}
        {isAdding && (
          <div className="memory-add-form">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as MemoryType)}
            >
              {Object.entries(MEMORY_TYPE_LABELS).map(([type, label]) => (
                <option key={type} value={type}>{label}</option>
              ))}
            </select>
            <textarea
              placeholder="Enter content..."
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={3}
              autoFocus
            />
            <button
              onClick={handleAddMemory}
              disabled={!newContent.trim()}
              className="btn-save-memory"
            >
              Save
            </button>
          </div>
        )}

        {/* Loading/Error states */}
        {loading && <div className="memory-loading">Loading...</div>}
        {error && <div className="memory-error">{error}</div>}

        {/* No group selected (only applies to project mode) */}
        {contextMode === 'project' && !groupId && !loading && (
          <div className="memory-empty">
            Select a session to view project context
          </div>
        )}

        {/* Memories list */}
        {!loading && effectiveGroupId && (
          <div className="memory-list">
            {/* Pinned section */}
            {pinnedMemories.length > 0 && !searchResults && (
              <div className="memory-section pinned-section">
                <div className="memory-section-header">
                  <span className="section-icon">!</span>
                  <span>Pinned</span>
                </div>
                <div className="memory-section-items">
                  {pinnedMemories.map(renderMemoryItem)}
                </div>
              </div>
            )}

            {/* Grouped by type */}
            {Object.entries(groupedMemories).map(([type, typeMemories]) => (
              <div key={type} className="memory-section">
                <div className="memory-section-header">
                  <span className="section-icon">{MEMORY_TYPE_ICONS[type as MemoryType]}</span>
                  <span>{MEMORY_TYPE_LABELS[type as MemoryType]}</span>
                  <span className="section-count">{typeMemories.length}</span>
                </div>
                <div className="memory-section-items">
                  {typeMemories.map(renderMemoryItem)}
                </div>
              </div>
            ))}

            {/* Empty state */}
            {displayMemories.length === 0 && !searchResults && (
              <div className="memory-empty">
                No context yet. Add one above.
              </div>
            )}

            {/* No search results */}
            {searchResults && searchResults.length === 0 && (
              <div className="memory-empty">
                No context matches "{searchQuery}"
              </div>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
