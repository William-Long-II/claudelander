import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Group } from '../../shared/types';

const DEFAULT_COLORS = ['#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2'];

export function useGroups() {
  const [groups, setGroups] = useState<Group[]>([
    {
      id: 'default',
      name: 'Default',
      color: DEFAULT_COLORS[0],
      order: 0,
      createdAt: new Date(),
    },
  ]);

  const createGroup = useCallback((name: string): Group => {
    const group: Group = {
      id: uuidv4(),
      name,
      color: DEFAULT_COLORS[groups.length % DEFAULT_COLORS.length],
      order: groups.length,
      createdAt: new Date(),
    };

    setGroups(prev => [...prev, group]);
    return group;
  }, [groups]);

  const updateGroup = useCallback((id: string, updates: Partial<Group>) => {
    setGroups(prev => prev.map(g =>
      g.id === id ? { ...g, ...updates } : g
    ));
  }, []);

  const removeGroup = useCallback((id: string) => {
    setGroups(prev => prev.filter(g => g.id !== id));
  }, []);

  return {
    groups,
    createGroup,
    updateGroup,
    removeGroup,
  };
}
