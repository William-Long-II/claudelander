import {
  Group,
  Session,
  ShareUser,
  ShareCode,
  CreateCodeOptions,
  GuestInfo,
  ApiServerStatus,
  PairingCode,
  PairedDevice,
  ApiServerConfig,
  DevicePermissions,
  RelayConnectionStatus,
} from '../../shared/types';

interface StateChangeEvent {
  sessionId: string;
  state: string;
  event: string;
  timestamp: number;
}

interface OrchestrationTask {
  id: string;
  name: string;
  prompt: string;
  sessionId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

interface OrchestrationJob {
  id: string;
  name: string;
  description?: string;
  tasks: OrchestrationTask[];
  status: 'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  maxConcurrent: number;
  aggregatedResult?: string;
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

  // Settings modal
  onOpenSettings: (callback: () => void) => () => void;

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
  onAuthChanged: (callback: (data: { user: ShareUser; token?: string }) => void) => () => void;
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

  // Shell
  openExternal: (url: string) => Promise<void>;

  // Sound notifications
  testSound: (event: 'waiting' | 'error' | 'start' | 'complete') => Promise<void>;
  selectSoundFile: () => Promise<string | null>;
  onSoundPlay: (callback: (data: { path: string; volume: number }) => void) => () => void;

  // Mobile API Server
  apiStart: (config?: ApiServerConfig) => Promise<void>;
  apiStop: () => Promise<void>;
  apiGetStatus: () => Promise<ApiServerStatus>;
  apiGeneratePairingCode: (options?: DevicePermissions) => Promise<{
    success: boolean;
    code?: string;
    qrCode?: string;
    expiresAt?: number;
    addresses?: string[];
    port?: number;
    error?: string;
  }>;
  apiCancelPairing: () => Promise<void>;
  apiGetPairedDevices: () => Promise<PairedDevice[]>;
  apiUnpairDevice: (deviceId: string) => Promise<void>;
  apiUpdateDevicePermissions: (deviceId: string, permissions: DevicePermissions) => Promise<void>;
  apiHasPairingCode: () => Promise<{ active: boolean }>;

  // Remote access
  apiEnableRemoteAccess: () => Promise<{
    success: boolean;
    status?: RelayConnectionStatus;
    error?: string;
  }>;
  apiDisableRemoteAccess: () => Promise<{ success: boolean; error?: string }>;
  apiGetRemoteAccessStatus: () => Promise<RelayConnectionStatus>;

  // Orchestration
  orchestrationCreateJob: (name: string, description?: string, config?: {
    maxConcurrent?: number;
    timeoutMs?: number;
    retryOnFail?: boolean;
    aggregateResults?: boolean;
  }) => Promise<OrchestrationJob>;
  orchestrationAddTasks: (jobId: string, tasks: Array<{ name: string; prompt: string }>) => Promise<OrchestrationJob>;
  orchestrationStartJob: (jobId: string) => Promise<OrchestrationJob>;
  orchestrationCancelJob: (jobId: string) => Promise<OrchestrationJob>;
  orchestrationGetJob: (jobId: string) => Promise<OrchestrationJob | undefined>;
  orchestrationGetJobs: () => Promise<OrchestrationJob[]>;
  orchestrationDeleteJob: (jobId: string) => Promise<boolean>;
  orchestrationUpdateTaskResult: (taskId: string, result: string) => Promise<boolean>;
  orchestrationUpdateTaskError: (taskId: string, error: string) => Promise<boolean>;
  orchestrationAssignSession: (taskId: string, sessionId: string) => Promise<boolean>;
  onOrchestrationUpdate: (callback: (jobs: OrchestrationJob[]) => void) => () => void;
  onOrchestrationStartTask: (callback: (data: { jobId: string; task: OrchestrationTask }) => void) => () => void;
  onOrchestrationJobCompleted: (callback: (data: {
    jobId: string;
    status: string;
    completedCount: number;
    failedCount: number;
  }) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
