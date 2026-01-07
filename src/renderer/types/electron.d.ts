import { Group, Session, ShareUser, ShareCode, CreateCodeOptions, GuestInfo } from '../../shared/types';

interface StateChangeEvent {
  sessionId: string;
  state: string;
  event: string;
  timestamp: number;
}

export interface ElectronAPI {
  platform: string;
  homedir: string;
  createSession: (id: string, cwd: string, launchClaude?: boolean) => Promise<void>;
  writeToSession: (id: string, data: string) => void;
  resizeSession: (id: string, cols: number, rows: number) => void;
  killSession: (id: string) => void;
  onPtyData: (callback: (id: string, data: string) => void) => () => void;
  onPtyExit: (callback: (id: string, exitCode: number) => void) => () => void;
  onStateChange: (callback: (event: StateChangeEvent) => void) => () => void;

  // Menu events
  onMenuNewSession: (callback: () => void) => () => void;
  onMenuCloseSession: (callback: () => void) => () => void;
  onMenuNextSession: (callback: () => void) => () => void;
  onMenuPrevSession: (callback: () => void) => () => void;
  onMenuNextWaiting: (callback: () => void) => () => void;

  // Session selection from notifications/tray
  onSessionSelect: (callback: (sessionId: string) => void) => () => void;

  // Dialogs
  selectDirectory: () => Promise<string | null>;

  // Database - Groups
  getAllGroups: () => Promise<Group[]>;
  createGroup: (group: Group) => Promise<void>;
  updateGroup: (id: string, updates: Partial<Group>) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;

  // Database - Sessions
  getAllSessions: () => Promise<Session[]>;
  createDbSession: (session: Session) => Promise<void>;
  updateDbSession: (id: string, updates: Partial<Session>) => Promise<void>;
  deleteDbSession: (id: string) => Promise<void>;

  // Preferences
  getPreference: (key: string) => Promise<string | null>;
  setPreference: (key: string, value: string) => Promise<void>;
  getAllPreferences: () => Promise<Record<string, string>>;

  // Auth
  login: () => Promise<void>;
  logout: () => Promise<void>;
  getUser: () => Promise<ShareUser | null>;
  setAuthToken: (token: string) => Promise<ShareUser | null>;
  onAuthChanged: (callback: (data: { user: ShareUser; token: string | null }) => void) => () => void;
  onAuthError: (callback: (data: { error: string }) => void) => () => void;

  // Sharing (host)
  startSharing: (sessionId: string) => Promise<void>;
  stopSharing: (sessionId: string) => Promise<void>;
  createShareCode: (sessionId: string, options: CreateCodeOptions) => Promise<ShareCode>;
  revokeShareCode: (code: string) => Promise<void>;
  getShareCodes: (sessionId: string) => Promise<ShareCode[]>;
  isSharing: (sessionId: string) => Promise<boolean>;
  getGuestCount: (sessionId: string) => Promise<number>;
  onGuestJoined: (callback: (info: GuestInfo) => void) => () => void;
  onGuestLeft: (callback: (info: { sessionId: string; guestUserId: string }) => void) => () => void;

  // Sharing (guest)
  joinSession: (code: string) => Promise<{
    code: string;
    permission: 'read' | 'control';
    hostUsername: string;
    sessionName: string;
  }>;
  leaveSession: (code: string) => Promise<void>;
  writeToRemote: (code: string, data: string) => Promise<{ success: boolean; error?: string }>;
  onShareData: (callback: (data: { code: string; data: string }) => void) => () => void;
  onShareEnded: (callback: (data: { code: string; reason: string }) => void) => () => void;

  // Shell (with URL validation - may reject disallowed URLs)
  openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;

  // Sound notifications
  testSound: (event: 'waiting' | 'error' | 'start' | 'complete') => Promise<void>;
  selectSoundFile: () => Promise<string | null>;
  onSoundPlay: (callback: (data: { path: string; volume: number }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
