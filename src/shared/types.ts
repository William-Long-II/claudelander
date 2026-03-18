export type SessionState = 'idle' | 'working' | 'waiting' | 'error' | 'stopped';

export interface ClaudeConfig {
  model?: string;
  effort?: string;
  permissionMode?: string;
  maxBudgetUsd?: number;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
}

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
  claudeConfig?: ClaudeConfig;
  claudeSessionId?: string | null;
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
  claudeConfig?: ClaudeConfig;
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

/**
 * Reserved group ID for global context that applies to all projects.
 * Memories with this group_id are injected into every session.
 */
export const GLOBAL_CONTEXT_GROUP_ID = '__global__';

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

// =============================================================================
// Code Search Types
// =============================================================================
// Types for semantic code search and symbol lookup feature
// =============================================================================

export type ChunkType = 'function' | 'class' | 'method' | 'interface' | 'type' | 'block';
export type SymbolType = 'function' | 'class' | 'method' | 'variable' | 'interface' | 'type';
export type IndexStatus = 'pending' | 'indexing' | 'ready' | 'error' | 'stale';

export interface CodeIndex {
  id: string;
  directoryPath: string;
  lastIndexedAt: Date | null;
  status: IndexStatus;
  fileCount: number;
  chunkCount: number;
  symbolCount: number;
  modelName: string;
  embeddingDimensions: number;
  errorMessage: string | null;
}

export interface IndexedFile {
  id: string;
  indexId: string;
  filePath: string;
  mtime: number;
  fileHash: string | null;
  chunkCount: number;
}

export interface CodeChunk {
  id: string;
  indexId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  chunkType: ChunkType | null;
  embedding: number[] | null;
  createdAt: Date;
}

export interface CodeSymbol {
  id: string;
  indexId: string;
  name: string;
  symbolType: SymbolType;
  filePath: string;
  line: number;
  column: number;
  parentSymbolId: string | null;
  signature: string | null;
  createdAt: Date;
}

export interface CodeSearchResult {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  chunkType: ChunkType | null;
}

export interface SymbolSearchResult {
  name: string;
  symbolType: SymbolType;
  filePath: string;
  line: number;
  column: number;
  signature: string | null;
}

export type IndexPhase = 'parsing' | 'embedding';

export interface IndexProgress {
  indexId: string;
  directoryPath: string;
  status: IndexStatus;
  phase: IndexPhase;
  filesTotal: number;
  filesIndexed: number;
  currentFile: string | null;
  error: string | null;
}

// =============================================================================
// Knowledge Graph Types (3.0)
// =============================================================================

export type KnowledgeTier = 1 | 2 | 3;
export type KnowledgeSource = 'auto-extracted' | 'user-created' | 'promoted';
export type KnowledgeRelationship = 'derived_from' | 'supports' | 'contradicts' | 'relates_to' | 'applied_in' | 'same_domain';

export interface KnowledgeNode {
  id: string;
  tier: KnowledgeTier;
  content: string;
  confidence: number;
  source: KnowledgeSource;
  scopeSessionId: string | null;
  scopeGroupId: string | null;
  domains: string[];
  tags: string[];
  createdAt: Date;
  lastReinforcedAt: Date;
}

export interface KnowledgeEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: KnowledgeRelationship;
  weight: number;
  createdAt: Date;
}

export interface KnowledgePromotion {
  id: string;
  nodeId: string;
  fromTier: KnowledgeTier;
  toTier: KnowledgeTier;
  trigger: string;
  evidence: string[];
  promotedAt: Date;
}

export interface KnowledgeNodeCreateInput {
  id: string;
  tier: KnowledgeTier;
  content: string;
  source: KnowledgeSource;
  confidence?: number;
  scopeSessionId?: string | null;
  scopeGroupId?: string | null;
  domains?: string[];
  tags?: string[];
}

export interface KnowledgeNodeUpdateInput {
  content?: string;
  tier?: KnowledgeTier;
  confidence?: number;
  domains?: string[];
  tags?: string[];
}

export interface KnowledgeEdgeCreateInput {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: KnowledgeRelationship;
  weight?: number;
}

// =============================================================================
// Chat Message Types (3.0)
// =============================================================================

export type ChatMessageRole = 'user' | 'assistant' | 'system' | 'error';
export type ChatMessageType = 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'system';

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  messageType: ChatMessageType;
  toolCalls: any[] | null;
  toolResults: any[] | null;
  thinking: string | null;
  branchId: string | null;
  parentMessageId: string | null;
  claudeSessionId: string | null;
  createdAt: Date;
}

export interface ChatMessageCreateInput {
  id: string;
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  messageType?: ChatMessageType;
  toolCalls?: any[];
  toolResults?: any[];
  thinking?: string;
  branchId?: string;
  parentMessageId?: string;
  claudeSessionId?: string;
}

// =============================================================================
// Claude Code JSON Streaming Types (3.0)
// =============================================================================

export type ClaudeEventType =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop'
  | 'ping'
  | 'error';

export interface ClaudeJsonEvent {
  type: ClaudeEventType;
  message?: any;
  index?: number;
  content_block?: any;
  delta?: any;
  error?: any;
  [key: string]: any;
}

export interface ClaudeToolUse {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface ClaudeToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

// =============================================================================
// Session Template Types (3.0)
// =============================================================================

export interface SessionTemplate {
  id: string;
  name: string;
  workingDir: string | null;
  initialPrompt: string | null;
  knowledgeContext: string[];
  groupId: string | null;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface SessionTemplateCreateInput {
  id: string;
  name: string;
  workingDir?: string;
  initialPrompt?: string;
  knowledgeContext?: string[];
  groupId?: string;
}

// =============================================================================
// Conversation Branching Types (3.0)
// =============================================================================

export interface ConversationBranch {
  id: string;
  sessionId: string;
  parentBranchId: string | null;
  forkMessageId: string;
  name: string | null;
  createdAt: Date;
}

// =============================================================================
// Session State Updates (3.0)
// =============================================================================

export type SessionState3 = 'idle' | 'thinking' | 'tool_executing' | 'streaming' | 'waiting' | 'error' | 'stopped';

export interface SessionStatus {
  state: SessionState3;
  description: string;
  currentTool?: string;
  filesBeingEdited?: string[];
  commandRunning?: string;
  lastActivity: Date;
}
