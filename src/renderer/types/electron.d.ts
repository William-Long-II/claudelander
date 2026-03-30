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
  Memory,
  MemoryCreateInput,
  MemoryUpdateInput,
  CodeIndex,
  CodeSearchResult,
  SymbolSearchResult,
  IndexProgress,
  SymbolType,
  SessionStatus,
  ClaudeJsonEvent,
  ClaudeConfig,
  ChatMessage,
  SessionTemplate,
  SessionTemplateCreateInput,
  ConversationBranch,
  KnowledgeNode,
  KnowledgeEdge,
  KnowledgePromotion,
  SkillEntry,
} from '../../shared/types';

export interface ElectronAPI {
  platform: string;
  homedir: string;

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

  // Database - Memories
  getMemoriesBySession: (sessionId: string) => Promise<Memory[]>;
  getMemoriesByGroup: (groupId: string) => Promise<Memory[]>;
  getPinnedMemories: (groupId?: string) => Promise<Memory[]>;
  searchMemories: (query: string, groupId?: string) => Promise<Memory[]>;
  createMemory: (memory: MemoryCreateInput) => Promise<Memory>;
  updateMemory: (id: string, updates: MemoryUpdateInput) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  getMemoriesForInjection: (sessionId: string, groupId: string) => Promise<Memory[]>;
  getMemoryById: (id: string) => Promise<Memory | null>;
  getGlobalContextMemories: () => Promise<Memory[]>;
  onMemoryExtracted: (callback: (memory: Memory) => void) => () => void;

  // Chat Messages
  chatGetMessages: (sessionId: string, limit?: number) => Promise<ChatMessage[]>;
  chatGetMessagesByBranch: (branchId: string, limit?: number) => Promise<ChatMessage[]>;
  chatCreateMessage: (input: any) => Promise<ChatMessage>;
  chatSearchMessages: (query: string, sessionId?: string, limit?: number) => Promise<ChatMessage[]>;

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

  // Vector Search
  getIndexStatus: (directoryPath: string) => Promise<CodeIndex | null>;
  getAllIndexes: () => Promise<CodeIndex[]>;
  startIndexing: (directoryPath: string) => Promise<{ success: boolean; error?: string }>;
  searchCode: (directoryPath: string, query: string, limit?: number) => Promise<CodeSearchResult[]>;
  searchSymbols: (directoryPath: string, name: string, symbolType?: SymbolType, limit?: number) => Promise<SymbolSearchResult[]>;
  cancelIndexing: (indexId: string) => Promise<{ success: boolean }>;
  deleteCodeIndex: (directoryPath: string) => Promise<{ success: boolean }>;
  retryIndexing: (directoryPath: string) => Promise<{ success: boolean; error?: string }>;
  onIndexingProgress: (callback: (progress: IndexProgress) => void) => () => void;
  onIndexingComplete: (callback: (data: { indexId: string; directoryPath?: string }) => void) => () => void;
  onIndexingError: (callback: (data: { indexId: string; error: string; directoryPath?: string }) => void) => () => void;

  // Editor Integration
  openInEditor: (filePath: string, line?: number, column?: number) => Promise<{ success: boolean; error?: string }>;
  detectAvailableEditors: () => Promise<string[]>;
  getEditorOptions: () => Promise<{ value: string; label: string }[]>;

  // Session Templates
  templatesGetAll: () => Promise<SessionTemplate[]>;
  templatesCreate: (input: SessionTemplateCreateInput) => Promise<SessionTemplate>;
  templatesDelete: (id: string) => Promise<boolean>;

  // Conversation Branches
  branchesGetBySession: (sessionId: string) => Promise<ConversationBranch[]>;
  branchesCreate: (input: {
    id: string;
    sessionId: string;
    parentBranchId?: string;
    forkMessageId: string;
    name?: string;
  }) => Promise<ConversationBranch>;
  branchesDelete: (id: string) => Promise<boolean>;

  // Knowledge Graph
  knowledgeCreate: (content: string, options?: { tier?: number; domains?: string[]; tags?: string[]; scopeSessionId?: string; scopeGroupId?: string }) => Promise<KnowledgeNode>;
  knowledgeSearch: (query: string, limit?: number) => Promise<KnowledgeNode[]>;
  knowledgeGetByTier: (tier: number, limit?: number) => Promise<KnowledgeNode[]>;
  knowledgeGetByDomain: (domain: string, limit?: number) => Promise<KnowledgeNode[]>;
  knowledgeGetRelated: (nodeId: string) => Promise<KnowledgeEdge[]>;
  knowledgeGetNode: (id: string) => Promise<KnowledgeNode | null>;
  knowledgePromote: (id: string, toTier: number, evidence?: string[]) => Promise<KnowledgePromotion | null>;
  knowledgePin: (id: string, pinned: boolean) => Promise<boolean>;
  knowledgeDelete: (id: string) => Promise<boolean>;
  knowledgeExtractFromChat: (userContent: string, assistantContent: string, sessionId: string, groupId?: string) => Promise<any[]>;

  // Skill System
  skillListAll: () => Promise<SkillEntry[]>;
  skillGetContent: (id: string) => Promise<string | null>;
  skillSearch: (query: string) => Promise<SkillEntry[]>;
  skillRefresh: () => Promise<SkillEntry[]>;
  skillInvoke: (sessionId: string, skillId: string, userArgs: string) => Promise<{ skillId: string; name: string }>;
  skillClear: (sessionId: string) => Promise<void>;

  // Claude Session API (3.0)
  claudeStart: (sessionId: string, cwd: string, prompt: string, options?: any) => Promise<void>;
  claudeSend: (sessionId: string, prompt: string) => Promise<void>;
  claudeKill: (sessionId: string) => Promise<void>;
  claudeGetStatus: (sessionId: string) => Promise<SessionStatus>;
  claudeIsRunning: (sessionId: string) => Promise<boolean>;
  claudeHasSession: (sessionId: string) => Promise<boolean>;
  claudeGetResolvedConfig: (sessionId: string) => Promise<ClaudeConfig>;
  onClaudeEvent: (callback: (sessionId: string, event: ClaudeJsonEvent) => void) => () => void;
  onClaudeStateChange: (callback: (sessionId: string, status: SessionStatus) => void) => () => void;
  onClaudeEnded: (callback: (sessionId: string) => void) => () => void;
  onClaudeError: (callback: (sessionId: string, error: string) => void) => () => void;
  onClaudePermissionRequest: (callback: (sessionId: string, request: any) => void) => () => void;
  claudeRespondPermission: (sessionId: string, requestId: string, decision: 'allow' | 'deny', scope: string, toolPattern?: string) => Promise<void>;
  getPermissionRules: () => Promise<any[]>;
  deletePermissionRule: (id: string) => Promise<void>;
  clearPermissionRules: () => Promise<void>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
