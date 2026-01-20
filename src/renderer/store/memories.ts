import { useState, useCallback, useEffect, useRef } from 'react';
import { Memory, MemoryType, MemorySource } from '../../shared/types';

interface UseMemoriesOptions {
  sessionId: string | null;
  groupId: string | null;
}

export function useMemories({ sessionId, groupId }: UseMemoriesOptions) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [pinnedMemories, setPinnedMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Memory[] | null>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Load memories when session/group changes
  useEffect(() => {
    const loadMemories = async () => {
      if (!groupId) {
        setMemories([]);
        setPinnedMemories([]);
        return;
      }

      setLoading(true);
      try {
        // Load session-specific memories if session is active
        let sessionMemories: Memory[] = [];
        if (sessionId) {
          sessionMemories = await window.electronAPI.getMemoriesBySession(sessionId);
        }

        // Load group memories (includes pinned and session-less)
        const groupMemories = await window.electronAPI.getMemoriesByGroup(groupId);

        // Load pinned memories
        const pinned = await window.electronAPI.getPinnedMemories(groupId);

        // Combine and deduplicate
        const allMemories = [...sessionMemories];
        for (const gm of groupMemories) {
          if (!allMemories.some(m => m.id === gm.id)) {
            allMemories.push(gm);
          }
        }

        // Sort by date (newest first)
        allMemories.sort((a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        setMemories(allMemories);
        setPinnedMemories(pinned);
      } catch (error) {
        console.error('Failed to load memories:', error);
      } finally {
        setLoading(false);
      }
    };

    loadMemories();

    // Listen for auto-extracted memories
    const cleanup = window.electronAPI.onMemoryExtracted((memory: Memory) => {
      // Only add if it belongs to current session or group
      if (
        (sessionId && memory.sessionId === sessionId) ||
        (groupId && memory.groupId === groupId)
      ) {
        setMemories(prev => {
          // Don't add duplicates
          if (prev.some(m => m.id === memory.id)) {
            return prev;
          }
          return [memory, ...prev];
        });

        if (memory.pinned) {
          setPinnedMemories(prev => {
            if (prev.some(m => m.id === memory.id)) {
              return prev;
            }
            return [memory, ...prev];
          });
        }
      }
    });

    return () => cleanup();
  }, [sessionId, groupId]);

  // Search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(async () => {
      try {
        const results = await window.electronAPI.searchMemories(searchQuery, groupId || undefined);
        setSearchResults(results);
      } catch (error) {
        console.error('Failed to search memories:', error);
        setSearchResults([]);
      }
    }, 300);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [searchQuery, groupId]);

  const createMemory = useCallback(async (
    type: MemoryType,
    content: string,
    options?: { tags?: string[]; pinned?: boolean }
  ): Promise<Memory | null> => {
    if (!groupId) {
      console.error('Cannot create memory without a group');
      return null;
    }

    try {
      const memory = await window.electronAPI.createMemory({
        id: crypto.randomUUID(),
        sessionId,
        groupId,
        type,
        content,
        source: 'manual' as MemorySource,
        tags: options?.tags || [],
        pinned: options?.pinned || false,
      });

      // Optimistically add to state
      setMemories(prev => [memory, ...prev]);

      if (memory.pinned) {
        setPinnedMemories(prev => [memory, ...prev]);
      }

      return memory;
    } catch (error) {
      console.error('Failed to create memory:', error);
      return null;
    }
  }, [sessionId, groupId]);

  const updateMemory = useCallback(async (
    id: string,
    updates: { content?: string; type?: MemoryType; tags?: string[]; pinned?: boolean }
  ): Promise<boolean> => {
    try {
      await window.electronAPI.updateMemory(id, updates);

      // Update local state
      setMemories(prev => prev.map(m =>
        m.id === id ? { ...m, ...updates, updatedAt: new Date() } : m
      ));

      // Handle pinned state changes
      if (updates.pinned !== undefined) {
        if (updates.pinned) {
          const memory = memories.find(m => m.id === id);
          if (memory && !pinnedMemories.some(m => m.id === id)) {
            setPinnedMemories(prev => [{ ...memory, pinned: true }, ...prev]);
          }
        } else {
          setPinnedMemories(prev => prev.filter(m => m.id !== id));
        }
      }

      return true;
    } catch (error) {
      console.error('Failed to update memory:', error);
      return false;
    }
  }, [memories, pinnedMemories]);

  const deleteMemory = useCallback(async (id: string): Promise<boolean> => {
    try {
      await window.electronAPI.deleteMemory(id);

      // Remove from local state
      setMemories(prev => prev.filter(m => m.id !== id));
      setPinnedMemories(prev => prev.filter(m => m.id !== id));

      return true;
    } catch (error) {
      console.error('Failed to delete memory:', error);
      return false;
    }
  }, []);

  const togglePin = useCallback(async (id: string): Promise<boolean> => {
    const memory = memories.find(m => m.id === id);
    if (!memory) return false;

    return updateMemory(id, { pinned: !memory.pinned });
  }, [memories, updateMemory]);

  const search = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults(null);
  }, []);

  // Get memories grouped by type
  const getMemoriesByType = useCallback(() => {
    const displayMemories = searchResults || memories;
    const grouped: Record<MemoryType, Memory[]> = {
      decision: [],
      error_fix: [],
      pattern: [],
      context: [],
      note: [],
    };

    for (const memory of displayMemories) {
      grouped[memory.type].push(memory);
    }

    return grouped;
  }, [memories, searchResults]);

  return {
    memories: searchResults || memories,
    pinnedMemories,
    loading,
    searchQuery,
    isSearching: searchResults !== null,
    createMemory,
    updateMemory,
    deleteMemory,
    togglePin,
    search,
    clearSearch,
    getMemoriesByType,
  };
}
