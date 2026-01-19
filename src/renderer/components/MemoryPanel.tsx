import React, { useState, useEffect, useCallback } from 'react';
import './MemoryPanel.css';

interface MemoryEntry {
  id: string;
  sessionId: string;
  type: 'note' | 'decision' | 'learning' | 'context' | 'task';
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
}

interface SessionMemory {
  sessionId: string;
  entries: MemoryEntry[];
  customInstructions: string;
  lastUpdated: string;
}

interface MemoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  sessionName: string;
}

const ENTRY_TYPES = [
  { value: 'note', label: 'Note', icon: '📝' },
  { value: 'decision', label: 'Decision', icon: '✅' },
  { value: 'learning', label: 'Learning', icon: '💡' },
  { value: 'context', label: 'Context', icon: '📋' },
  { value: 'task', label: 'Task', icon: '📌' },
];

const MemoryPanel: React.FC<MemoryPanelProps> = ({
  isOpen,
  onClose,
  sessionId,
  sessionName,
}) => {
  const [memory, setMemory] = useState<SessionMemory | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'entries' | 'instructions'>('entries');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // New entry form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntryType, setNewEntryType] = useState<string>('note');
  const [newEntryContent, setNewEntryContent] = useState('');
  const [newEntryTags, setNewEntryTags] = useState('');

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  // Custom instructions
  const [instructions, setInstructions] = useState('');
  const [instructionsSaved, setInstructionsSaved] = useState(true);

  const loadMemory = useCallback(async () => {
    if (!sessionId) return;

    setLoading(true);
    try {
      const data = await window.electronAPI.memoryLoad(sessionId);
      setMemory(data);
      setInstructions(data.customInstructions || '');
      setInstructionsSaved(true);
    } catch (error) {
      console.error('Failed to load memory:', error);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (isOpen && sessionId) {
      loadMemory();
    }
  }, [isOpen, sessionId, loadMemory]);

  const handleAddEntry = async () => {
    if (!newEntryContent.trim()) return;

    try {
      const tags = newEntryTags
        .split(',')
        .map(t => t.trim())
        .filter(t => t);

      await window.electronAPI.memoryAddEntry(sessionId, {
        type: newEntryType as MemoryEntry['type'],
        content: newEntryContent.trim(),
        tags,
        pinned: false,
      });

      setNewEntryContent('');
      setNewEntryTags('');
      setShowAddForm(false);
      await loadMemory();
    } catch (error) {
      console.error('Failed to add entry:', error);
    }
  };

  const handleUpdateEntry = async (entryId: string) => {
    if (!editContent.trim()) return;

    try {
      await window.electronAPI.memoryUpdateEntry(sessionId, entryId, {
        content: editContent.trim(),
      });
      setEditingId(null);
      await loadMemory();
    } catch (error) {
      console.error('Failed to update entry:', error);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!confirm('Delete this memory entry?')) return;

    try {
      await window.electronAPI.memoryDeleteEntry(sessionId, entryId);
      await loadMemory();
    } catch (error) {
      console.error('Failed to delete entry:', error);
    }
  };

  const handleTogglePin = async (entry: MemoryEntry) => {
    try {
      await window.electronAPI.memoryUpdateEntry(sessionId, entry.id, {
        pinned: !entry.pinned,
      });
      await loadMemory();
    } catch (error) {
      console.error('Failed to toggle pin:', error);
    }
  };

  const handleSaveInstructions = async () => {
    try {
      await window.electronAPI.memorySetInstructions(sessionId, instructions);
      setInstructionsSaved(true);
    } catch (error) {
      console.error('Failed to save instructions:', error);
    }
  };

  const handleExport = async () => {
    try {
      const markdown = await window.electronAPI.memoryExport(sessionId);
      // Copy to clipboard
      await navigator.clipboard.writeText(markdown);
      alert('Memory exported to clipboard!');
    } catch (error) {
      console.error('Failed to export memory:', error);
    }
  };

  const filteredEntries = memory?.entries.filter(entry => {
    if (filterType !== 'all' && entry.type !== filterType) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        entry.content.toLowerCase().includes(query) ||
        entry.tags.some(t => t.toLowerCase().includes(query))
      );
    }
    return true;
  }) || [];

  const pinnedEntries = filteredEntries.filter(e => e.pinned);
  const regularEntries = filteredEntries.filter(e => !e.pinned);

  if (!isOpen) return null;

  return (
    <div className="memory-overlay" onClick={onClose}>
      <div className="memory-panel" onClick={e => e.stopPropagation()}>
        <div className="memory-header">
          <h2>Session Memory</h2>
          <span className="session-name">{sessionName}</span>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="memory-tabs">
          <button
            className={`tab ${activeTab === 'entries' ? 'active' : ''}`}
            onClick={() => setActiveTab('entries')}
          >
            Entries ({memory?.entries.length || 0})
          </button>
          <button
            className={`tab ${activeTab === 'instructions' ? 'active' : ''}`}
            onClick={() => setActiveTab('instructions')}
          >
            Custom Instructions
            {!instructionsSaved && <span className="unsaved-dot">●</span>}
          </button>
        </div>

        {activeTab === 'entries' ? (
          <div className="memory-content">
            <div className="memory-toolbar">
              <div className="memory-filters">
                <select
                  value={filterType}
                  onChange={e => setFilterType(e.target.value)}
                >
                  <option value="all">All Types</option>
                  {ENTRY_TYPES.map(t => (
                    <option key={t.value} value={t.value}>
                      {t.icon} {t.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="memory-actions">
                <button className="btn primary" onClick={() => setShowAddForm(true)}>
                  + Add Entry
                </button>
                <button className="btn secondary" onClick={handleExport}>
                  Export
                </button>
              </div>
            </div>

            {showAddForm && (
              <div className="add-entry-form">
                <div className="form-row">
                  <select
                    value={newEntryType}
                    onChange={e => setNewEntryType(e.target.value)}
                  >
                    {ENTRY_TYPES.map(t => (
                      <option key={t.value} value={t.value}>
                        {t.icon} {t.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Tags (comma-separated)"
                    value={newEntryTags}
                    onChange={e => setNewEntryTags(e.target.value)}
                  />
                </div>
                <textarea
                  placeholder="Enter your note, decision, learning..."
                  value={newEntryContent}
                  onChange={e => setNewEntryContent(e.target.value)}
                  rows={3}
                />
                <div className="form-actions">
                  <button className="btn secondary" onClick={() => setShowAddForm(false)}>
                    Cancel
                  </button>
                  <button
                    className="btn primary"
                    onClick={handleAddEntry}
                    disabled={!newEntryContent.trim()}
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            <div className="entries-list">
              {loading ? (
                <div className="loading">Loading...</div>
              ) : filteredEntries.length === 0 ? (
                <div className="empty">
                  {searchQuery || filterType !== 'all'
                    ? 'No matching entries'
                    : 'No memory entries yet. Add your first note!'}
                </div>
              ) : (
                <>
                  {pinnedEntries.length > 0 && (
                    <div className="entries-section">
                      <h4>Pinned</h4>
                      {pinnedEntries.map(entry => (
                        <EntryCard
                          key={entry.id}
                          entry={entry}
                          isEditing={editingId === entry.id}
                          editContent={editContent}
                          onEdit={() => {
                            setEditingId(entry.id);
                            setEditContent(entry.content);
                          }}
                          onEditChange={setEditContent}
                          onSave={() => handleUpdateEntry(entry.id)}
                          onCancel={() => setEditingId(null)}
                          onDelete={() => handleDeleteEntry(entry.id)}
                          onTogglePin={() => handleTogglePin(entry)}
                        />
                      ))}
                    </div>
                  )}
                  {regularEntries.length > 0 && (
                    <div className="entries-section">
                      {pinnedEntries.length > 0 && <h4>Other</h4>}
                      {regularEntries.map(entry => (
                        <EntryCard
                          key={entry.id}
                          entry={entry}
                          isEditing={editingId === entry.id}
                          editContent={editContent}
                          onEdit={() => {
                            setEditingId(entry.id);
                            setEditContent(entry.content);
                          }}
                          onEditChange={setEditContent}
                          onSave={() => handleUpdateEntry(entry.id)}
                          onCancel={() => setEditingId(null)}
                          onDelete={() => handleDeleteEntry(entry.id)}
                          onTogglePin={() => handleTogglePin(entry)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="memory-content">
            <div className="instructions-section">
              <p className="instructions-hint">
                Custom instructions that will be included when starting this session.
                Use this for project-specific context, coding guidelines, or preferences.
              </p>
              <textarea
                className="instructions-textarea"
                placeholder="Enter custom instructions for this session..."
                value={instructions}
                onChange={e => {
                  setInstructions(e.target.value);
                  setInstructionsSaved(false);
                }}
                rows={15}
              />
              <div className="instructions-actions">
                <button
                  className="btn primary"
                  onClick={handleSaveInstructions}
                  disabled={instructionsSaved}
                >
                  {instructionsSaved ? 'Saved' : 'Save Instructions'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Entry card component
interface EntryCardProps {
  entry: MemoryEntry;
  isEditing: boolean;
  editContent: string;
  onEdit: () => void;
  onEditChange: (content: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
}

const EntryCard: React.FC<EntryCardProps> = ({
  entry,
  isEditing,
  editContent,
  onEdit,
  onEditChange,
  onSave,
  onCancel,
  onDelete,
  onTogglePin,
}) => {
  const typeInfo = ENTRY_TYPES.find(t => t.value === entry.type);

  return (
    <div className={`entry-card ${entry.pinned ? 'pinned' : ''}`}>
      <div className="entry-header">
        <span className="entry-type">
          {typeInfo?.icon} {typeInfo?.label}
        </span>
        <span className="entry-date">
          {new Date(entry.createdAt).toLocaleDateString()}
        </span>
      </div>

      {isEditing ? (
        <div className="entry-edit">
          <textarea
            value={editContent}
            onChange={e => onEditChange(e.target.value)}
            rows={3}
            autoFocus
          />
          <div className="entry-edit-actions">
            <button className="btn small secondary" onClick={onCancel}>
              Cancel
            </button>
            <button className="btn small primary" onClick={onSave}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="entry-content">{entry.content}</div>
      )}

      {entry.tags.length > 0 && (
        <div className="entry-tags">
          {entry.tags.map(tag => (
            <span key={tag} className="tag">{tag}</span>
          ))}
        </div>
      )}

      <div className="entry-actions">
        <button
          className={`btn-icon ${entry.pinned ? 'active' : ''}`}
          onClick={onTogglePin}
          title={entry.pinned ? 'Unpin' : 'Pin'}
        >
          📌
        </button>
        <button className="btn-icon" onClick={onEdit} title="Edit">
          ✏️
        </button>
        <button className="btn-icon danger" onClick={onDelete} title="Delete">
          🗑️
        </button>
      </div>
    </div>
  );
};

export default MemoryPanel;
