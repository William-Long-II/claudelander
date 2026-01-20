export type SessionState = 'idle' | 'working' | 'waiting' | 'error' | 'stopped';

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
  workingDir: string;
  order: number;
  createdAt: Date;
  parentId: string | null;
  collapsed: boolean;
}

export interface AppState {
  groups: Group[];
  sessions: Session[];
  activeSessionId: string | null;
}

// =============================================================================
// Sharing Types
// =============================================================================
// These types use `string` for dates (ISO 8601 format) because they represent
// data from JSON API responses from the relay server. In contrast, the local
// Session/Group types above use `Date` objects because they are managed as
// local application state.
// =============================================================================

/**
 * The authenticated user from OAuth, stored locally.
 * This represents YOU when you are sharing or joining sessions.
 * Compare with GuestInfo which represents others connected to your session.
 */
export interface ShareUser {
  id: string;
  username: string;
  email?: string;
  tier: 'free' | 'pro' | 'admin';
}

export interface ShareSession {
  id: string;
  hostPublicKey: string;
  startedAt: string;
  codes: ShareCode[];
}

export interface ShareCode {
  code: string;
  permission: 'read' | 'control';
  /** Maximum number of times this code can be used. `null` means unlimited. */
  maxUses: number | null;
  currentUses: number;
  /** When this code expires (ISO 8601). `null` means no expiration. */
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateCodeOptions {
  permission: 'read' | 'control';
  maxUses?: number;
  expiresInMinutes?: number;
}

export interface SharedSessionInfo {
  sessionId: string;
  hostUsername: string;
  permission: 'read' | 'control';
  connectedAt: Date;
}

/**
 * A guest connected to YOUR shared session, as reported by the relay server.
 * This represents OTHER users who have joined your session using a share code.
 * Compare with ShareUser which represents the authenticated local user.
 */
export interface GuestInfo {
  userId: string;
  username: string;
  permission: 'read' | 'control';
  publicKey: string;
}

// =============================================================================
// Mobile API Server Types
// =============================================================================
// Types for the local API server that enables mobile companion app connectivity
// =============================================================================

export interface RelayConnectionStatus {
  enabled: boolean;
  connected: boolean;
  desktopId: string | null;
  relayUrl: string;
}

export interface ApiServerStatus {
  running: boolean;
  port?: number;
  addresses?: string[];
  relay?: RelayConnectionStatus;
}

export interface PairingCode {
  code: string;
  qrCode: string;
  expiresAt: number;
  addresses?: string[];
  port?: number;
}

export interface PairedDevice {
  id: string;
  name: string;
  platform: string;
  createdAt: string;
  lastUsedAt: string;
  canControl: boolean;
  canModify: boolean;
}

export interface ApiServerConfig {
  port?: number;
  enableMdns?: boolean;
}

export interface DevicePermissions {
  canControl?: boolean;
  canModify?: boolean;
}

// =============================================================================
// Memory Types
// =============================================================================
// Types for session memory/knowledge persistence feature
// =============================================================================

export type MemoryType = 'decision' | 'error_fix' | 'pattern' | 'context' | 'note';
export type MemorySource = 'auto' | 'manual' | 'claude';

export interface Memory {
  id: string;
  sessionId: string | null;
  groupId: string;
  type: MemoryType;
  content: string;
  source: MemorySource;
  tags: string[];
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface MemoryCreateInput {
  id: string;
  sessionId: string | null;
  groupId: string;
  type: MemoryType;
  content: string;
  source: MemorySource;
  tags?: string[];
  pinned?: boolean;
}

export interface MemoryUpdateInput {
  content?: string;
  type?: MemoryType;
  tags?: string[];
  pinned?: boolean;
}

export interface MemoryEvent {
  type: 'memory';
  sessionId: string;
  memory: {
    type: MemoryType;
    content: string;
    source: 'claude';
  };
  timestamp: number;
}
