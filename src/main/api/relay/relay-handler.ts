/**
 * Relay Handler
 *
 * Processes API requests that come through the relay from mobile clients.
 * Validates device tokens and executes the appropriate handlers.
 */

import log from 'electron-log';
import { hostname } from 'os';
import { PairingManager } from '../pairing/pairing-manager';
import { getRelayConnection } from './relay-connection';
import { claudeSessionManager } from '../../claude-session-manager';
import * as sessionsRepo from '../../repositories/sessions';
import * as groupsRepo from '../../repositories/groups';
import { app } from 'electron';

interface RelayedRequest {
  from: string;
  deviceToken: string;
  data: {
    requestId: string;
    method: string;
    endpoint: string;
    body?: unknown;
  };
}

interface RelayedResponse {
  requestId: string;
  status: number;
  data?: unknown;
  error?: string;
}

export class RelayHandler {
  private pairingManager: PairingManager;
  private terminalSubscriptions: Map<string, Set<string>> = new Map(); // deviceToken -> Set<sessionId>

  constructor(pairingManager: PairingManager) {
    this.pairingManager = pairingManager;
  }

  /**
   * Start handling relayed messages
   */
  start(): void {
    const relay = getRelayConnection();

    relay.on('message', (payload: unknown) => {
      this.handleMessage(payload as RelayedRequest);
    });

    relay.on('mobile_disconnected', (deviceToken: string) => {
      // Clean up terminal subscriptions for disconnected mobile
      this.terminalSubscriptions.delete(deviceToken);
    });

    log.info('[RelayHandler] Started');
  }

  /**
   * Handle incoming relayed message
   */
  private async handleMessage(request: RelayedRequest): Promise<void> {
    const { deviceToken, data } = request;

    if (!deviceToken || !data?.requestId) {
      log.warn('[RelayHandler] Invalid request format');
      return;
    }

    // Validate device token
    const device = await this.pairingManager.validateToken(
      `${Buffer.from(deviceToken, 'base64').toString()}`
    );

    if (!device) {
      log.warn(`[RelayHandler] Invalid device token`);
      this.sendResponse(data.requestId, 401, undefined, 'Unauthorized');
      return;
    }

    // Process the request
    try {
      const response = await this.processRequest(device, data);
      this.sendResponse(data.requestId, response.status, response.data, response.error);
    } catch (error) {
      log.error('[RelayHandler] Error processing request:', error);
      this.sendResponse(data.requestId, 500, undefined, 'Internal server error');
    }
  }

  /**
   * Process API request
   */
  private async processRequest(
    device: { id: string; canControl: boolean; canModify: boolean },
    request: { method: string; endpoint: string; body?: unknown }
  ): Promise<{ status: number; data?: unknown; error?: string }> {
    const { method, endpoint, body } = request;

    log.debug(`[RelayHandler] ${method} ${endpoint}`);

    // Route to appropriate handler
    if (endpoint === '/api/v1/sessions' && method === 'GET') {
      return this.getSessions();
    }

    if (endpoint.startsWith('/api/v1/sessions/') && method === 'GET') {
      const sessionId = endpoint.split('/')[4];
      return this.getSession(sessionId);
    }

    if (endpoint === '/api/v1/groups' && method === 'GET') {
      return this.getGroups();
    }

    if (endpoint === '/api/v1/system/info' && method === 'GET') {
      return this.getSystemInfo();
    }

    // Terminal operations
    if (endpoint.startsWith('/api/v1/terminal/')) {
      return this.handleTerminalRequest(device, endpoint, method, body);
    }

    return { status: 404, error: 'Not found' };
  }

  /**
   * Get all sessions
   */
  private async getSessions(): Promise<{ status: number; data?: unknown }> {
    const sessions = sessionsRepo.getAllSessions();
    return { status: 200, data: sessions };
  }

  /**
   * Get single session
   */
  private async getSession(sessionId: string): Promise<{ status: number; data?: unknown; error?: string }> {
    const sessions = sessionsRepo.getAllSessions();
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      return { status: 404, error: 'Session not found' };
    }
    return { status: 200, data: session };
  }

  /**
   * Get all groups
   */
  private async getGroups(): Promise<{ status: number; data?: unknown }> {
    const groups = groupsRepo.getAllGroups();
    return { status: 200, data: groups };
  }

  /**
   * Get system info
   */
  private async getSystemInfo(): Promise<{ status: number; data?: unknown }> {
    return {
      status: 200,
      data: {
        platform: process.platform,
        version: app.getVersion(),
        hostname: hostname(),
      },
    };
  }

  /**
   * Handle terminal-related requests
   */
  private async handleTerminalRequest(
    device: { id: string; canControl: boolean },
    endpoint: string,
    method: string,
    body?: unknown
  ): Promise<{ status: number; data?: unknown; error?: string }> {
    const parts = endpoint.split('/');
    const sessionId = parts[4];
    const action = parts[5];

    if (!sessionId) {
      return { status: 400, error: 'Missing session ID' };
    }

    switch (action) {
      case 'subscribe':
        if (method === 'POST') {
          return this.subscribeToTerminal(device.id, sessionId);
        }
        break;

      case 'unsubscribe':
        if (method === 'POST') {
          return this.unsubscribeFromTerminal(device.id, sessionId);
        }
        break;

      case 'input':
        if (method === 'POST' && device.canControl) {
          const { data } = body as { data?: string } || {};
          if (data) {
            return this.sendTerminalInput(sessionId, data);
          }
          return { status: 400, error: 'Missing input data' };
        } else if (!device.canControl) {
          return { status: 403, error: 'Permission denied' };
        }
        break;

      case 'resize':
        if (method === 'POST' && device.canControl) {
          const { cols, rows } = body as { cols?: number; rows?: number } || {};
          if (cols && rows) {
            return this.resizeTerminal(sessionId, cols, rows);
          }
          return { status: 400, error: 'Missing cols/rows' };
        } else if (!device.canControl) {
          return { status: 403, error: 'Permission denied' };
        }
        break;

      case 'buffer':
        if (method === 'GET') {
          return this.getTerminalBuffer(sessionId);
        }
        break;
    }

    return { status: 404, error: 'Not found' };
  }

  /**
   * Get terminal scrollback buffer
   */
  private getTerminalBuffer(sessionId: string): { status: number; data?: unknown; error?: string } {
    // Terminal buffer is no longer available in chat-first mode
    return { status: 410, error: 'Terminal buffer not available in chat mode' };
  }

  /**
   * Subscribe to terminal output
   */
  private subscribeToTerminal(deviceToken: string, sessionId: string): { status: number; data?: unknown } {
    let sessions = this.terminalSubscriptions.get(deviceToken);
    if (!sessions) {
      sessions = new Set();
      this.terminalSubscriptions.set(deviceToken, sessions);
    }
    sessions.add(sessionId);

    log.debug(`[RelayHandler] Device ${deviceToken.substring(0, 8)}... subscribed to session ${sessionId}`);
    return { status: 200, data: { subscribed: true } };
  }

  /**
   * Unsubscribe from terminal output
   */
  private unsubscribeFromTerminal(deviceToken: string, sessionId: string): { status: number; data?: unknown } {
    const sessions = this.terminalSubscriptions.get(deviceToken);
    if (sessions) {
      sessions.delete(sessionId);
    }

    log.debug(`[RelayHandler] Device ${deviceToken.substring(0, 8)}... unsubscribed from session ${sessionId}`);
    return { status: 200, data: { subscribed: false } };
  }

  /**
   * Send input to terminal
   */
  private sendTerminalInput(sessionId: string, data: string): { status: number; data?: unknown; error?: string } {
    // In chat mode, use Claude session manager instead
    if (claudeSessionManager.isSessionRunning(sessionId)) {
      return { status: 409, error: 'Session is currently processing' };
    }
    claudeSessionManager.sendMessage(sessionId, data);
    return { status: 200, data: { sent: true } };
  }

  /**
   * Resize terminal
   */
  private resizeTerminal(_sessionId: string, _cols: number, _rows: number): { status: number; data?: unknown; error?: string } {
    // Resize not applicable in chat mode
    return { status: 410, error: 'Terminal resize not available in chat mode' };
  }

  /**
   * Send response back through relay
   */
  private sendResponse(requestId: string, status: number, data?: unknown, error?: string): void {
    const relay = getRelayConnection();
    const response: RelayedResponse = { requestId, status };

    if (data !== undefined) {
      response.data = data;
    }
    if (error) {
      response.error = error;
    }

    relay.sendToMobile({
      type: 'response',
      ...response,
    });
  }

  /**
   * Broadcast terminal data to subscribed mobile clients
   */
  broadcastTerminalData(sessionId: string, data: string): void {
    const relay = getRelayConnection();
    if (!relay.isConnected()) {
      return;
    }

    // Send to all mobile clients (relay will forward)
    relay.sendToMobile({
      type: 'terminal:output',
      sessionId,
      data,
    });
  }

  /**
   * Broadcast session state change
   */
  broadcastSessionState(sessionId: string, state: string, event?: string): void {
    const relay = getRelayConnection();
    if (!relay.isConnected()) {
      return;
    }

    relay.sendToMobile({
      type: 'session:state',
      sessionId,
      state,
      event,
    });
  }

  /**
   * Broadcast sessions list update
   */
  broadcastSessionsUpdated(): void {
    const relay = getRelayConnection();
    if (!relay.isConnected()) {
      return;
    }

    relay.sendToMobile({
      type: 'sessions:updated',
    });
  }
}

// Singleton instance
let relayHandler: RelayHandler | null = null;

export function getRelayHandler(pairingManager?: PairingManager): RelayHandler {
  if (!relayHandler && pairingManager) {
    relayHandler = new RelayHandler(pairingManager);
  }
  if (!relayHandler) {
    throw new Error('RelayHandler not initialized');
  }
  return relayHandler;
}

export function initRelayHandler(pairingManager: PairingManager): RelayHandler {
  if (relayHandler) {
    return relayHandler;
  }
  relayHandler = new RelayHandler(pairingManager);
  return relayHandler;
}
