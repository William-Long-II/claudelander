import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Session, SessionState } from '../../shared/types';

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const createSession = useCallback((groupId: string, name: string, workingDir: string): Session => {
    const session: Session = {
      id: uuidv4(),
      groupId,
      name,
      workingDir,
      state: 'idle',
      shellType: 'bash',
      order: sessions.filter(s => s.groupId === groupId).length,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };

    setSessions(prev => [...prev, session]);
    setActiveSessionId(session.id);
    return session;
  }, [sessions]);

  const updateSessionState = useCallback((id: string, state: SessionState) => {
    setSessions(prev => prev.map(s =>
      s.id === id
        ? { ...s, state, lastActivityAt: new Date() }
        : s
    ));
  }, []);

  const removeSession = useCallback((id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
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
    activeSessionId,
    setActiveSessionId,
    createSession,
    updateSessionState,
    removeSession,
    getSessionsByGroup,
    getStateCounts,
  };
}
