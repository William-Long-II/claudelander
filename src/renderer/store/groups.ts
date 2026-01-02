import { useState, useCallback, useEffect } from 'react';
import { Group } from '../../shared/types';

const DEFAULT_COLORS = ['#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2'];

export function useGroups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  // Load groups from database on mount
  useEffect(() => {
    const loadGroups = async () => {
      try {
        const dbGroups = await window.electronAPI.getAllGroups();
        setGroups(dbGroups);
      } catch (error) {
        console.error('Failed to load groups:', error);
      } finally {
        setLoading(false);
      }
    };
    loadGroups();
  }, []);

  const createGroup = useCallback(async (name: string): Promise<Group> => {
    return new Promise((resolve, reject) => {
      setGroups(prev => {
        const group: Group = {
          id: crypto.randomUUID(),
          name,
          color: DEFAULT_COLORS[prev.length % DEFAULT_COLORS.length],
          workingDir: '',
          order: prev.length,
          createdAt: new Date(),
        };

        // Persist asynchronously
        window.electronAPI.createGroup(group)
          .then(() => resolve(group))
          .catch((error) => {
            console.error('Failed to create group:', error);
            // Rollback by removing the group
            setGroups(current => current.filter(g => g.id !== group.id));
            reject(error);
          });

        return [...prev, group]; // Optimistic update
      });
    });
  }, []);

  const updateGroup = useCallback(async (id: string, updates: Partial<Group>) => {
    try {
      await window.electronAPI.updateGroup(id, updates);
      setGroups(prev => prev.map(g =>
        g.id === id ? { ...g, ...updates } : g
      ));
    } catch (error) {
      console.error('Failed to update group:', error);
      // Don't update state - DB failed
    }
  }, []);

  const removeGroup = useCallback(async (id: string) => {
    try {
      await window.electronAPI.deleteGroup(id);
      setGroups(prev => prev.filter(g => g.id !== id));
    } catch (error) {
      console.error('Failed to remove group:', error);
      // Don't update state - DB failed
    }
  }, []);

  const reorderGroup = useCallback(async (groupId: string, newOrder: number) => {
    setGroups(prev => {
      const group = prev.find(g => g.id === groupId);
      if (!group) return prev;

      // Remove group from current position
      const filtered = prev.filter(g => g.id !== groupId);

      // Insert at new position
      filtered.splice(newOrder, 0, group);

      // Update orders
      const reordered = filtered.map((g, idx) => ({
        ...g,
        order: idx,
      }));

      // Persist changes
      reordered.forEach(g => {
        window.electronAPI.updateGroup(g.id, { order: g.order })
          .catch(err => console.error('Failed to update group order:', err));
      });

      return reordered;
    });
  }, []);

  return {
    groups,
    loading,
    createGroup,
    updateGroup,
    removeGroup,
    reorderGroup,
  };
}
