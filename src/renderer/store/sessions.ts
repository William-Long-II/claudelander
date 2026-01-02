import { useState, useCallback, useEffect } from 'react';
import { Session, SessionState } from '../../shared/types';

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load sessions from database on mount
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const dbSessions = await window.electronAPI.getAllSessions();
        setSessions(dbSessions);
      } catch (error) {
        console.error('Failed to load sessions:', error);
      } finally {
        setLoading(false);
      }
    };
    loadSessions();

    // Listen for state changes from hooks
    const cleanupStateChange = window.electronAPI.onStateChange((event) => {
      // Validate state is a valid SessionState
      const validStates: SessionState[] = ['idle', 'working', 'waiting', 'error', 'stopped'];
      if (!validStates.includes(event.state as SessionState)) {
        console.error('Invalid session state received:', event.state);
        return;
      }

      setSessions(prev => prev.map(s =>
        s.id === event.sessionId
          ? { ...s, state: event.state as SessionState, lastActivityAt: new Date(event.timestamp * 1000) }
          : s
      ));
    });

    return () => {
      cleanupStateChange();
    };
  }, []);

  const createSession = useCallback(async (
    groupId: string,
    name: string,
    workingDir: string,
    launchClaude: boolean = true
  ): Promise<Session> => {
    return new Promise((resolve, reject) => {
      setSessions(prev => {
        const session: Session = {
          id: crypto.randomUUID(),
          groupId,
          name,
          workingDir,
          state: 'idle',
          shellType: launchClaude ? 'claude' : 'bash',
          order: prev.filter(s => s.groupId === groupId).length,
          createdAt: new Date(),
          lastActivityAt: new Date(),
        };

        // Persist asynchronously
        window.electronAPI.createDbSession(session)
          .then(() => {
            setActiveSessionId(session.id);
            resolve(session);
          })
          .catch((error) => {
            console.error('Failed to create session:', error);
            // Rollback by removing the session
            setSessions(current => current.filter(s => s.id !== session.id));
            reject(error);
          });

        return [...prev, session]; // Optimistic update
      });
    });
  }, []);

  const updateSessionState = useCallback(async (id: string, state: SessionState) => {
    try {
      const updates = { state, lastActivityAt: new Date() };
      await window.electronAPI.updateDbSession(id, updates);
      setSessions(prev => prev.map(s =>
        s.id === id
          ? { ...s, ...updates }
          : s
      ));
    } catch (error) {
      console.error('Failed to update session state:', error);
      // Don't update state - DB failed
    }
  }, []);

  const updateSession = useCallback(async (id: string, updates: Partial<Session>) => {
    try {
      await window.electronAPI.updateDbSession(id, updates);
      setSessions(prev => prev.map(s =>
        s.id === id ? { ...s, ...updates } : s
      ));
    } catch (error) {
      console.error('Failed to update session:', error);
    }
  }, []);

  const removeSession = useCallback(async (id: string) => {
    try {
      await window.electronAPI.deleteDbSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
      }
    } catch (error) {
      console.error('Failed to remove session:', error);
      // Don't update state - DB failed
    }
  }, [activeSessionId]);

  const getSessionsByGroup = useCallback((groupId: string) => {
    return sessions.filter(s => s.groupId === groupId);
  }, [sessions]);

  const getStateCounts = useCallback(() => {
    return {
      waiting: sessions.filter(s => s.state === 'waiting').length,
      working: sessions.filter(s => s.state === 'working').length,
      idle: sessions.filter(s => s.state === 'idle').length,
      error: sessions.filter(s => s.state === 'error').length,
      stopped: sessions.filter(s => s.state === 'stopped').length,
    };
  }, [sessions]);

  const reorderSession = useCallback(async (sessionId: string, targetGroupId: string, newOrder: number) => {
    setSessions(prev => {
      const session = prev.find(s => s.id === sessionId);
      if (!session) return prev;

      // Get sessions in target group, excluding the moved session
      const targetGroupSessions = prev
        .filter(s => s.groupId === targetGroupId && s.id !== sessionId)
        .sort((a, b) => a.order - b.order);

      // Insert at new position
      targetGroupSessions.splice(newOrder, 0, { ...session, groupId: targetGroupId });

      // Update orders for all sessions in target group
      const updatedTargetSessions = targetGroupSessions.map((s, idx) => ({
        ...s,
        order: idx,
      }));

      // Keep sessions from other groups, and replace target group sessions
      const otherSessions = prev.filter(s => s.groupId !== targetGroupId && s.id !== sessionId);
      const newSessions = [...otherSessions, ...updatedTargetSessions];

      // Persist changes
      updatedTargetSessions.forEach(s => {
        window.electronAPI.updateDbSession(s.id, { groupId: s.groupId, order: s.order })
          .catch(err => console.error('Failed to update session order:', err));
      });

      return newSessions;
    });
  }, []);

  return {
    sessions,
    loading,
    activeSessionId,
    setActiveSessionId,
    createSession,
    updateSession,
    updateSessionState,
    removeSession,
    getSessionsByGroup,
    getStateCounts,
    reorderSession,
  };
}
