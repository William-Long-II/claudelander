export type SessionState = 'idle' | 'working' | 'waiting' | 'error';

export interface Session {
  id: string;
  groupId: string;
  name: string;
  workingDir: string;
  state: SessionState;
  shellType: string;
  order: number;
  createdAt: Date;
  lastActivityAt: Date;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  order: number;
  createdAt: Date;
}

export interface AppState {
  groups: Group[];
  sessions: Session[];
  activeSessionId: string | null;
}
