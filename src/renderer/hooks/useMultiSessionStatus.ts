import { useState, useEffect, useRef } from 'react';

export interface SessionLiveStatus {
  sessionId: string;
  state: 'idle' | 'thinking' | 'streaming' | 'tool_executing' | 'waiting_permission' | 'error';
  description: string;
  latestSnippet: string;
  isStreaming: boolean;
  completedAt: Date | null;
}

export interface MultiSessionStats {
  total: number;
  completed: number;
  working: number;
  error: number;
}

/**
 * Lightweight hook for tracking live status across multiple sessions.
 * Unlike useClaudeSession (which tracks full message history for one session),
 * this only tracks state + latest ~200 chars per session.
 */
export function useMultiSessionStatus(sessionIds: string[]) {
  const [statuses, setStatuses] = useState<Map<string, SessionLiveStatus>>(new Map());
  const snippetBuffers = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (sessionIds.length === 0) {
      setStatuses(new Map());
      return;
    }

    // Initialize statuses for all selected sessions
    const sessionIdSet = new Set(sessionIds);
    setStatuses(prev => {
      const next = new Map<string, SessionLiveStatus>();
      for (const sid of sessionIds) {
        next.set(sid, prev.get(sid) || {
          sessionId: sid,
          state: 'idle',
          description: 'Idle',
          latestSnippet: '',
          isStreaming: false,
          completedAt: null,
        });
      }
      return next;
    });

    // Subscribe to Claude events for streaming content
    const unsubEvent = window.electronAPI.onClaudeEvent((sid: string, event: any) => {
      if (!sessionIdSet.has(sid)) return;

      if (event.type === 'message_start') {
        snippetBuffers.current.set(sid, '');
        setStatuses(prev => {
          const next = new Map(prev);
          const existing = next.get(sid);
          if (existing) {
            next.set(sid, { ...existing, latestSnippet: '', isStreaming: true, completedAt: null });
          }
          return next;
        });
      }

      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const buf = (snippetBuffers.current.get(sid) || '') + event.delta.text;
        // Keep only last 200 chars
        const trimmed = buf.length > 200 ? buf.slice(-200) : buf;
        snippetBuffers.current.set(sid, trimmed);
        setStatuses(prev => {
          const next = new Map(prev);
          const existing = next.get(sid);
          if (existing) {
            next.set(sid, { ...existing, latestSnippet: trimmed, isStreaming: true });
          }
          return next;
        });
      }

      if (event.type === 'message_delta' && event.delta?.stop_reason === 'end_turn') {
        setStatuses(prev => {
          const next = new Map(prev);
          const existing = next.get(sid);
          if (existing) {
            next.set(sid, { ...existing, isStreaming: false, completedAt: new Date() });
          }
          return next;
        });
      }
    });

    // Subscribe to state changes for status description
    const unsubState = window.electronAPI.onClaudeStateChange((sid: string, status: any) => {
      if (!sessionIdSet.has(sid)) return;
      setStatuses(prev => {
        const next = new Map(prev);
        const existing = next.get(sid);
        if (existing) {
          next.set(sid, {
            ...existing,
            state: status.state,
            description: status.description,
          });
        }
        return next;
      });
    });

    // Subscribe to session end
    const unsubEnded = window.electronAPI.onClaudeEnded((sid: string) => {
      if (!sessionIdSet.has(sid)) return;
      setStatuses(prev => {
        const next = new Map(prev);
        const existing = next.get(sid);
        if (existing) {
          next.set(sid, {
            ...existing,
            state: 'idle',
            description: 'Idle',
            isStreaming: false,
            completedAt: existing.completedAt || new Date(),
          });
        }
        return next;
      });
    });

    return () => {
      unsubEvent();
      unsubState();
      unsubEnded();
    };
  }, [sessionIds.join(',')]); // Re-subscribe when session list changes

  // Compute aggregate stats
  const stats: MultiSessionStats = {
    total: sessionIds.length,
    completed: 0,
    working: 0,
    error: 0,
  };
  for (const [, status] of statuses) {
    if (status.completedAt && status.state === 'idle') stats.completed++;
    else if (status.state === 'error') stats.error++;
    else if (status.state !== 'idle') stats.working++;
  }

  return { statuses, stats };
}
