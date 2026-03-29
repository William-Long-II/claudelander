import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ChatMessage, Session } from '../../shared/types';
import './SearchModal.css';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (sessionId: string, messageId: string) => void;
  sessions: Session[];
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
  sessions,
}) => {
  const [query, setQuery] = useState('');
  const [filterSessionId, setFilterSessionId] = useState<string>('');
  const [results, setResults] = useState<ChatMessage[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Build a map of session IDs to names for display
  const sessionNameMap = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const map = new Map<string, string>();
    for (const s of sessions) {
      map.set(s.id, s.name);
    }
    sessionNameMap.current = map;
  }, [sessions]);

  // Focus input and reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSearchError(null);
      setFocusedIndex(-1);
      setFilterSessionId('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Perform debounced search
  const doSearch = useCallback(async (searchQuery: string, sessionId?: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      setSearchError(null);
      return;
    }

    setIsSearching(true);
    setSearchError(null);

    try {
      const messages = await window.electronAPI.chatSearchMessages(
        searchQuery,
        sessionId || undefined,
        50,
      );
      setResults(messages);
      setFocusedIndex(-1);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Trigger search on query or filter change
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setResults([]);
      setSearchError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      doSearch(query, filterSessionId || undefined);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, filterSessionId, doSearch]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(prev => Math.min(prev + 1, results.length - 1));
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(prev => Math.max(prev - 1, -1));
    }

    if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < results.length) {
      e.preventDefault();
      const result = results[focusedIndex];
      onNavigate(result.sessionId, result.id);
      onClose();
    }
  }, [onClose, results, focusedIndex, onNavigate]);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0 && resultsRef.current) {
      const items = resultsRef.current.querySelectorAll('.chat-search-result-item');
      if (items[focusedIndex]) {
        items[focusedIndex].scrollIntoView({ block: 'nearest' });
      }
    }
  }, [focusedIndex]);

  // Trap focus in modal
  const handleModalKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      const modal = e.currentTarget as HTMLElement;
      const focusable = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [onClose]);

  const handleResultClick = (result: ChatMessage) => {
    onNavigate(result.sessionId, result.id);
    onClose();
  };

  const formatTimestamp = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const highlightMatch = (content: string, searchQuery: string): string => {
    if (!searchQuery.trim()) return content;

    // Truncate content for display
    const maxLen = 200;
    const truncated = content.length > maxLen ? content.slice(0, maxLen) + '...' : content;

    // Simple word-level highlight (escape HTML first)
    const escaped = truncated
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const words = searchQuery.trim().split(/\s+/).filter(w => w.length > 0);
    let highlighted = escaped;
    for (const word of words) {
      const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(${escapedWord})`, 'gi');
      highlighted = highlighted.replace(regex, '<mark>$1</mark>');
    }

    return highlighted;
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="chat-search-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-search-title"
        onKeyDown={handleModalKeyDown}
      >
        <div className="chat-search-header">
          <h3 id="chat-search-title">Conversation History Search</h3>
          <span className="chat-search-shortcut">Ctrl+Shift+H</span>
        </div>

        {/* Search Input */}
        <div className="chat-search-input-row">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search chat messages..."
            autoFocus
          />
          <select
            className="chat-search-session-filter"
            value={filterSessionId}
            onChange={e => setFilterSessionId(e.target.value)}
          >
            <option value="">All sessions</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Results */}
        <div className="chat-search-results" ref={resultsRef}>
          {isSearching && (
            <div className="chat-search-loading">Searching...</div>
          )}

          {searchError && (
            <div className="chat-search-error">{searchError}</div>
          )}

          {!isSearching && !searchError && !query.trim() && (
            <div className="chat-search-empty">Type to search across all conversations</div>
          )}

          {!isSearching && !searchError && query.trim() && results.length === 0 && (
            <div className="chat-search-no-results">No messages found</div>
          )}

          {results.length > 0 && (
            <ul className="chat-search-results-list">
              {results.map((msg, i) => (
                <li
                  key={msg.id}
                  className={`chat-search-result-item ${i === focusedIndex ? 'focused' : ''}`}
                  onClick={() => handleResultClick(msg)}
                >
                  <div className="chat-search-result-meta">
                    <span className={`chat-search-role-badge ${msg.role}`}>
                      {msg.role}
                    </span>
                    <span className="chat-search-session-name">
                      {sessionNameMap.current.get(msg.sessionId) || 'Unknown Session'}
                    </span>
                    <span className="chat-search-timestamp">
                      {formatTimestamp(msg.createdAt)}
                    </span>
                  </div>
                  <div
                    className="chat-search-content-preview"
                    dangerouslySetInnerHTML={{
                      __html: highlightMatch(msg.content, query),
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="chat-search-footer">
          <span className="chat-search-footer-hint">
            <kbd>Up</kbd> <kbd>Down</kbd> to navigate, <kbd>Enter</kbd> to select, <kbd>Esc</kbd> to close
          </span>
          <button
            className="chat-search-close-btn"
            onClick={onClose}
            aria-label="Close search"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
