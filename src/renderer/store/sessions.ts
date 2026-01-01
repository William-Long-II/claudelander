import { useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
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
          id: uuidv4(),
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
    };
  }, [sessions]);

  return {
    sessions,
    loading,
    activeSessionId,
    setActiveSessionId,
    createSession,
    updateSessionState,
    removeSession,
    getSessionsByGroup,
    getStateCounts,
  };
}
