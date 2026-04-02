import { useState, useCallback, useEffect } from 'react';
import { Session, SessionState } from '../../shared/types';

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
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
  }, []);

  const createSession = useCallback(async (
    groupId: string,
    name: string,
    workingDir: string,
    launchClaude: boolean = true,
    initialPrompt?: string,
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
          .then(async () => {
            setActiveSessionId(session.id);
            // Auto-start Claude with template initial prompt
            if (launchClaude && initialPrompt) {
              await window.electronAPI.claudeStart(session.id, workingDir, initialPrompt);
            }
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

  // Synchronous local-state update for sidebar — main process already handles the DB write,
  // so we only need to keep the renderer's sessions array in sync immediately.
  const updateSessionState = useCallback((id: string, state: SessionState) => {
    setSessions(prev => prev.map(s =>
      s.id === id
        ? { ...s, state, lastActivityAt: new Date() }
        : s
    ));
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

  /** Toggle a session in/out of multi-select. First Ctrl+Click adds both active + clicked. */
  const toggleSessionSelection = useCallback((sessionId: string) => {
    setSelectedSessionIds(prev => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
        // If down to 1 or 0, exit multi-select
        if (next.size <= 1) return new Set();
        return next;
      }
      // First Ctrl+Click: seed the set with current active + clicked
      if (next.size === 0 && activeSessionId && activeSessionId !== sessionId) {
        next.add(activeSessionId);
      }
      next.add(sessionId);
      return next;
    });
  }, [activeSessionId]);

  /** Select all sessions in a group (for "Broadcast to Group") */
  const selectGroupSessions = useCallback((groupId: string) => {
    const groupSessions = sessions.filter(s => s.groupId === groupId);
    if (groupSessions.length < 2) return;
    setSelectedSessionIds(new Set(groupSessions.map(s => s.id)));
    // Set active to first session in group as fallback
    setActiveSessionId(groupSessions[0].id);
  }, [sessions]);

  /** Exit multi-select mode */
  const clearMultiSelect = useCallback(() => {
    setSelectedSessionIds(new Set());
  }, []);

  // Clean up removed sessions from selection
  const removeSession = useCallback(async (id: string) => {
    try {
      await window.electronAPI.deleteDbSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
      }
      setSelectedSessionIds(prev => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        if (next.size <= 1) return new Set();
        return next;
      });
    } catch (error) {
      console.error('Failed to remove session:', error);
    }
  }, [activeSessionId]);

  return {
    sessions,
    loading,
    activeSessionId,
    setActiveSessionId,
    selectedSessionIds,
    toggleSessionSelection,
    selectGroupSessions,
    clearMultiSelect,
    createSession,
    updateSession,
    updateSessionState,
    removeSession,
    getSessionsByGroup,
    getStateCounts,
    reorderSession,
  };
}
