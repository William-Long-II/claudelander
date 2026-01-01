import { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
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
          id: uuidv4(),
          name,
          color: DEFAULT_COLORS[prev.length % DEFAULT_COLORS.length],
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

  return {
    groups,
    loading,
    createGroup,
    updateGroup,
    removeGroup,
  };
}
