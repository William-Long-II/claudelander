import { EventEmitter } from 'events';
import { RELAY_URL } from '../../shared/constants';
import { ShareCode, CreateCodeOptions, ShareSession } from '../../shared/types';
import { authService } from './auth';
import { RelayClient } from './relay-client';
import { claudeSessionManager } from '../claude-session-manager';
import log from 'electron-log';

interface ActiveShare {
  localSessionId: string;
  remoteSessionId: string;
  relayClient: RelayClient;
  guests: Map<string, { username: string; permission: string }>;
}

class ShareManager extends EventEmitter {
  private activeShares: Map<string, ActiveShare> = new Map();
  private joinedSessions: Map<string, RelayClient> = new Map();

  /**
   * Start sharing a local session
   */
  async startSharing(localSessionId: string, sessionName?: string): Promise<ShareSession> {
    if (this.activeShares.has(localSessionId)) {
      throw new Error('Session is already being shared');
    }

    const client = new RelayClient();
    const { sessionId, publicKey } = await client.connectAsHost(localSessionId, sessionName);

    const share: ActiveShare = {
      localSessionId,
      remoteSessionId: sessionId,
      relayClient: client,
      guests: new Map(),
    };

    this.activeShares.set(localSessionId, share);

    // Forward Claude session events to relay
    const eventHandler = ({ sessionId: sid, event }: { sessionId: string; event: unknown }) => {
      if (sid === localSessionId && share.guests.size > 0) {
        client.send(JSON.stringify(event));
      }
    };
    claudeSessionManager.on('event', eventHandler);

    // Handle guest events
    client.on('guestJoined', (info) => {
      share.guests.set(info.userId, {
        username: info.userId, // Will be enriched later
        permission: info.permission,
      });
      this.emit('guestJoined', { localSessionId, ...info });
    });

    client.on('guestLeft', (info) => {
      share.guests.delete(info.userId);
      this.emit('guestLeft', { localSessionId, ...info });
    });

    // Handle input from guests with control permission
    client.on('data', (data: Buffer) => {
      const content = data.toString();
      if (content && !claudeSessionManager.isSessionRunning(localSessionId)) {
        claudeSessionManager.sendMessage(localSessionId, content);
      }
    });

    client.on('disconnected', () => {
      // Clean up on disconnect
      claudeSessionManager.off('event', eventHandler);
      this.activeShares.delete(localSessionId);
      this.emit('shareEnded', { localSessionId });
    });

    log.info('Started sharing session:', localSessionId, '→', sessionId);

    return {
      id: sessionId,
      hostPublicKey: publicKey,
      startedAt: new Date().toISOString(),
      codes: [],
    };
  }

  /**
   * Stop sharing a session
   */
  async stopSharing(localSessionId: string): Promise<void> {
    const share = this.activeShares.get(localSessionId);
    if (!share) return;

    // End session on server
    try {
      await fetch(`${RELAY_URL}/sessions/${share.remoteSessionId}`, {
        method: 'DELETE',
        headers: authService.getHeaders(),
      });
    } catch (e) {
      log.error('Failed to end session on server:', e);
    }

    share.relayClient.disconnect();
    this.activeShares.delete(localSessionId);

    log.info('Stopped sharing session:', localSessionId);
  }

  /**
   * Stop all active shares (called on app quit)
   */
  async stopAllSharing(): Promise<void> {
    const sessionIds = Array.from(this.activeShares.keys());
    log.info(`Stopping ${sessionIds.length} active shares...`);

    await Promise.all(sessionIds.map((id) => this.stopSharing(id)));

    // Also leave any joined sessions
    const codes = Array.from(this.joinedSessions.keys());
    await Promise.all(codes.map((code) => this.leaveSession(code)));

    log.info('All shares stopped');
  }

  /**
   * Create a share code for a session
   */
  async createCode(
    localSessionId: string,
    options: CreateCodeOptions,
  ): Promise<ShareCode> {
    const share = this.activeShares.get(localSessionId);
    if (!share) {
      throw new Error('Session is not being shared');
    }

    const response = await fetch(
      `${RELAY_URL}/sessions/${share.remoteSessionId}/codes`,
      {
        method: 'POST',
        headers: authService.getHeaders(),
        body: JSON.stringify(options),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to create code');
    }

    return response.json();
  }

  /**
   * Revoke a share code
   */
  async revokeCode(code: string): Promise<void> {
    await fetch(`${RELAY_URL}/codes/${code}`, {
      method: 'DELETE',
      headers: authService.getHeaders(),
    });
  }

  /**
   * Get active codes for a session
   */
  async getCodes(localSessionId: string): Promise<ShareCode[]> {
    const share = this.activeShares.get(localSessionId);
    if (!share) {
      return [];
    }

    const response = await fetch(
      `${RELAY_URL}/sessions/${share.remoteSessionId}/codes`,
      {
        headers: authService.getHeaders(),
      },
    );

    if (!response.ok) {
      return [];
    }

    return response.json();
  }

  /**
   * Join a shared session as a guest
   */
  async joinSession(code: string): Promise<{
    permission: 'read' | 'control';
    hostUsername: string;
    sessionName: string;
    relayClient: RelayClient;
  }> {
    const client = new RelayClient();
    const result = await client.connectAsGuest(code);

    this.joinedSessions.set(code, client);

    return {
      permission: result.permission,
      hostUsername: result.hostUsername,
      sessionName: result.sessionName,
      relayClient: client,
    };
  }

  /**
   * Leave a joined session
   */
  leaveSession(code: string): void {
    const client = this.joinedSessions.get(code);
    if (client) {
      client.disconnect();
      this.joinedSessions.delete(code);
    }
  }

  /**
   * Get a joined session's relay client
   */
  getJoinedClient(code: string): RelayClient | undefined {
    return this.joinedSessions.get(code);
  }

  /**
   * Check if a session is being shared
   */
  isSharing(localSessionId: string): boolean {
    return this.activeShares.has(localSessionId);
  }

  /**
   * Get guest count for a session
   */
  getGuestCount(localSessionId: string): number {
    return this.activeShares.get(localSessionId)?.guests.size || 0;
  }
}

export const shareManager = new ShareManager();
