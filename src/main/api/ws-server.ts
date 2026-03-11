/**
 * WebSocket Server
 *
 * Handles real-time terminal streaming and session state updates.
 */

import { Server as HttpServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';
import log from 'electron-log';
import { PairingManager, PairedDevice } from './pairing/pairing-manager';
import { ptyManager } from '../pty-manager';
import { claudeSessionManager } from '../claude-session-manager';

export interface WsMessage {
  type: string;
  sessionId?: string;
  payload?: unknown;
  timestamp: number;
}

interface ClientInfo {
  device: PairedDevice;
  subscribedSessions: Set<string>;
}

export interface WsServer {
  broadcast(message: WsMessage): void;
  broadcastToSession(sessionId: string, message: WsMessage): void;
  getClientCount(): number;
  close(): void;
}

/**
 * Create WebSocket server attached to HTTP server
 */
export function createWsServer(httpServer: HttpServer, pairingManager: PairingManager): WsServer {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, ClientInfo>();

  // Handle upgrade requests
  httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    // Authenticate the connection
    const device = authenticateWsConnection(request, pairingManager);

    if (!device) {
      log.warn('[WsServer] Rejected WebSocket connection: authentication failed');
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, device);
    });
  });

  // Handle new connections
  wss.on('connection', (ws: WebSocket, _request: IncomingMessage, device: PairedDevice) => {
    log.info(`[WsServer] Client connected: ${device.name} (${device.platform})`);

    clients.set(ws, {
      device,
      subscribedSessions: new Set(),
    });

    // Send welcome message
    sendMessage(ws, {
      type: 'connected',
      payload: {
        deviceId: device.id,
        canControl: device.canControl,
        canModify: device.canModify,
      },
      timestamp: Date.now(),
    });

    // Handle incoming messages
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as WsMessage;
        handleClientMessage(ws, message, clients.get(ws)!);
      } catch (error) {
        log.error('[WsServer] Error parsing message:', error);
        sendMessage(ws, {
          type: 'error',
          payload: { message: 'Invalid message format' },
          timestamp: Date.now(),
        });
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      const info = clients.get(ws);
      log.info(`[WsServer] Client disconnected: ${info?.device.name}`);
      clients.delete(ws);
    });

    // Handle errors
    ws.on('error', (error) => {
      log.error('[WsServer] WebSocket error:', error);
    });
  });

  // Set up PTY data forwarding
  setupPtyForwarding(clients);

  // Set up chat event forwarding for Claude session manager
  setupChatForwarding(clients);

  return {
    broadcast(message: WsMessage): void {
      const data = JSON.stringify(message);
      for (const [ws] of clients) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      }
    },

    broadcastToSession(sessionId: string, message: WsMessage): void {
      const data = JSON.stringify(message);
      for (const [ws, info] of clients) {
        if (ws.readyState === WebSocket.OPEN && info.subscribedSessions.has(sessionId)) {
          ws.send(data);
        }
      }
    },

    getClientCount(): number {
      return clients.size;
    },

    close(): void {
      for (const [ws] of clients) {
        ws.close(1000, 'Server shutting down');
      }
      wss.close();
    },
  };
}

/**
 * Authenticate WebSocket connection from query parameter
 */
function authenticateWsConnection(request: IncomingMessage, pairingManager: PairingManager): PairedDevice | null {
  try {
    const url = new URL(request.url || '', `http://${request.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      return null;
    }

    return pairingManager.validateToken(token);
  } catch (error) {
    log.error('[WsServer] Auth error:', error);
    return null;
  }
}

/**
 * Handle messages from clients
 */
function handleClientMessage(ws: WebSocket, message: WsMessage, clientInfo: ClientInfo): void {
  switch (message.type) {
    case 'terminal:subscribe': {
      const sessionId = message.sessionId;
      if (sessionId) {
        clientInfo.subscribedSessions.add(sessionId);
        log.debug(`[WsServer] Client subscribed to session: ${sessionId}`);
        sendMessage(ws, {
          type: 'terminal:subscribed',
          sessionId,
          timestamp: Date.now(),
        });
      }
      break;
    }

    case 'terminal:unsubscribe': {
      const sessionId = message.sessionId;
      if (sessionId) {
        clientInfo.subscribedSessions.delete(sessionId);
        log.debug(`[WsServer] Client unsubscribed from session: ${sessionId}`);
      }
      break;
    }

    case 'terminal:input': {
      if (!clientInfo.device.canControl) {
        sendMessage(ws, {
          type: 'error',
          payload: { message: 'Control permission required' },
          timestamp: Date.now(),
        });
        return;
      }

      const sessionId = message.sessionId;
      const data = (message.payload as { data?: string })?.data;

      if (sessionId && data && ptyManager.getSession(sessionId)) {
        ptyManager.write(sessionId, data);
      }
      break;
    }

    case 'terminal:resize': {
      if (!clientInfo.device.canControl) {
        sendMessage(ws, {
          type: 'error',
          payload: { message: 'Control permission required' },
          timestamp: Date.now(),
        });
        return;
      }

      const sessionId = message.sessionId;
      const { cols, rows } = (message.payload as { cols?: number; rows?: number }) || {};

      if (sessionId && cols && rows && ptyManager.getSession(sessionId)) {
        ptyManager.resize(sessionId, cols, rows);
      }
      break;
    }

    case 'chat:subscribe': {
      const sessionId = message.sessionId;
      if (sessionId) {
        clientInfo.subscribedSessions.add(sessionId);
        log.debug(`[WsServer] Client subscribed to chat session: ${sessionId}`);
        sendMessage(ws, {
          type: 'chat:subscribed',
          sessionId,
          timestamp: Date.now(),
        });
      }
      break;
    }

    case 'chat:unsubscribe': {
      const sessionId = message.sessionId;
      if (sessionId) {
        clientInfo.subscribedSessions.delete(sessionId);
        log.debug(`[WsServer] Client unsubscribed from chat session: ${sessionId}`);
      }
      break;
    }

    case 'chat:send': {
      if (!clientInfo.device.canControl) {
        sendMessage(ws, {
          type: 'error',
          payload: { message: 'Control permission required' },
          timestamp: Date.now(),
        });
        return;
      }

      const sessionId = message.sessionId;
      const content = (message.payload as { content?: string })?.content;

      if (sessionId && content) {
        const isRunning = claudeSessionManager.isSessionRunning(sessionId);
        if (isRunning) {
          sendMessage(ws, {
            type: 'error',
            payload: { message: 'Session is currently processing. Wait for it to become idle.' },
            timestamp: Date.now(),
          });
        } else {
          claudeSessionManager.sendMessage(sessionId, content);
        }
      }
      break;
    }

    case 'ping': {
      sendMessage(ws, {
        type: 'pong',
        payload: { clientTimestamp: message.timestamp },
        timestamp: Date.now(),
      });
      break;
    }

    default:
      log.warn(`[WsServer] Unknown message type: ${message.type}`);
  }
}

/**
 * Set up forwarding of PTY data to subscribed clients
 */
function setupPtyForwarding(clients: Map<WebSocket, ClientInfo>): void {
  // Listen for PTY data events
  ptyManager.on('data', ({ id, data }: { id: string; data: string }) => {
    const message: WsMessage = {
      type: 'terminal:output',
      sessionId: id,
      payload: { data },
      timestamp: Date.now(),
    };

    const msgStr = JSON.stringify(message);

    for (const [ws, info] of clients) {
      if (ws.readyState === WebSocket.OPEN && info.subscribedSessions.has(id)) {
        ws.send(msgStr);
      }
    }
  });

  // Listen for PTY exit events
  ptyManager.on('exit', ({ id, exitCode }: { id: string; exitCode: number }) => {
    const message: WsMessage = {
      type: 'terminal:exit',
      sessionId: id,
      payload: { exitCode },
      timestamp: Date.now(),
    };

    const msgStr = JSON.stringify(message);

    for (const [ws, info] of clients) {
      if (ws.readyState === WebSocket.OPEN && info.subscribedSessions.has(id)) {
        ws.send(msgStr);
      }
    }
  });
}

/**
 * Set up forwarding of Claude session manager events to subscribed clients
 */
function setupChatForwarding(clients: Map<WebSocket, ClientInfo>): void {
  // Forward Claude JSON events
  claudeSessionManager.on('event', ({ sessionId, event }: { sessionId: string; event: unknown }) => {
    const message: WsMessage = {
      type: 'chat:event',
      sessionId,
      payload: { event },
      timestamp: Date.now(),
    };

    const msgStr = JSON.stringify(message);

    for (const [ws, info] of clients) {
      if (ws.readyState === WebSocket.OPEN && info.subscribedSessions.has(sessionId)) {
        ws.send(msgStr);
      }
    }
  });

  // Forward state changes
  claudeSessionManager.on('state-change', ({ sessionId, status }: { sessionId: string; status: unknown }) => {
    const message: WsMessage = {
      type: 'chat:stateChange',
      sessionId,
      payload: { status },
      timestamp: Date.now(),
    };

    const msgStr = JSON.stringify(message);

    for (const [ws, info] of clients) {
      if (ws.readyState === WebSocket.OPEN && info.subscribedSessions.has(sessionId)) {
        ws.send(msgStr);
      }
    }
  });

  // Forward session ended
  claudeSessionManager.on('session-ended', ({ sessionId, exitCode }: { sessionId: string; exitCode: number }) => {
    const message: WsMessage = {
      type: 'chat:ended',
      sessionId,
      payload: { exitCode },
      timestamp: Date.now(),
    };

    const msgStr = JSON.stringify(message);

    for (const [ws, info] of clients) {
      if (ws.readyState === WebSocket.OPEN && info.subscribedSessions.has(sessionId)) {
        ws.send(msgStr);
      }
    }
  });

  // Forward errors
  claudeSessionManager.on('error', ({ sessionId, error }: { sessionId: string; error: string }) => {
    const message: WsMessage = {
      type: 'chat:error',
      sessionId,
      payload: { error },
      timestamp: Date.now(),
    };

    const msgStr = JSON.stringify(message);

    for (const [ws, info] of clients) {
      if (ws.readyState === WebSocket.OPEN && info.subscribedSessions.has(sessionId)) {
        ws.send(msgStr);
      }
    }
  });
}

/**
 * Send a message to a single client
 */
function sendMessage(ws: WebSocket, message: WsMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}
