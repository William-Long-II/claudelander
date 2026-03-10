/**
 * API Server Module
 *
 * Exposes ClaudeLander functionality over HTTP/WebSocket for mobile companion app access.
 * Supports both local P2P connections (same network) and relay server fallback.
 */

import { EventEmitter } from 'events';
import { Server as HttpServer } from 'http';
import { networkInterfaces } from 'os';
import log from 'electron-log';
import { createHttpServer } from './http-server';
import { createWsServer, WsServer } from './ws-server';
import { MdnsAdvertiser } from './discovery/mdns-advertiser';
import { PairingManager } from './pairing/pairing-manager';
import { getRelayConnection, initRelayHandler, type RelayConnectionStatus } from './relay';

export interface ApiServerConfig {
  port: number;
  bindAddress: string;
  enableMdns: boolean;
}

export interface ApiServerStatus {
  running: boolean;
  port: number | null;
  addresses: string[];
  connectedClients: number;
  pairedDevices: number;
  relay: RelayConnectionStatus;
}

const DEFAULT_CONFIG: ApiServerConfig = {
  port: 8443,
  bindAddress: '127.0.0.1',
  enableMdns: true,
};

class ApiServer extends EventEmitter {
  private httpServer: HttpServer | null = null;
  private wsServer: WsServer | null = null;
  private mdnsAdvertiser: MdnsAdvertiser | null = null;
  private config: ApiServerConfig;
  private _isRunning = false;
  private _port: number | null = null;

  public readonly pairingManager: PairingManager;

  constructor(config: Partial<ApiServerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pairingManager = new PairingManager();
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  get port(): number | null {
    return this._port;
  }

  get addresses(): string[] {
    return this.getLocalAddresses();
  }

  get connectedClientCount(): number {
    return this.wsServer?.getClientCount() ?? 0;
  }

  async start(): Promise<{ port: number; addresses: string[] }> {
    if (this._isRunning) {
      throw new Error('API server is already running');
    }

    log.info('[ApiServer] Starting API server...');

    try {
      // Create HTTP server with Express
      const { server, port } = await createHttpServer({
        port: this.config.port,
        bindAddress: this.config.bindAddress,
        pairingManager: this.pairingManager,
      });

      this.httpServer = server;
      this._port = port;

      // Create WebSocket server attached to HTTP server
      this.wsServer = createWsServer(this.httpServer, this.pairingManager);

      // Start mDNS advertisement
      if (this.config.enableMdns) {
        this.mdnsAdvertiser = new MdnsAdvertiser();
        await this.mdnsAdvertiser.advertise(port);
      }

      this._isRunning = true;
      const addresses = this.getLocalAddresses();

      log.info(`[ApiServer] Started on port ${port}`);
      log.info(`[ApiServer] Available at: ${addresses.map(a => `http://${a}:${port}`).join(', ')}`);

      this.emit('started', { port, addresses });

      return { port, addresses };
    } catch (error) {
      log.error('[ApiServer] Failed to start:', error);
      await this.cleanup();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this._isRunning) {
      return;
    }

    log.info('[ApiServer] Stopping API server...');
    await this.cleanup();
    this._isRunning = false;
    this._port = null;
    this.emit('stopped');
    log.info('[ApiServer] Stopped');
  }

  private async cleanup(): Promise<void> {
    // Stop mDNS advertisement
    if (this.mdnsAdvertiser) {
      await this.mdnsAdvertiser.stop();
      this.mdnsAdvertiser = null;
    }

    // Close WebSocket server
    if (this.wsServer) {
      this.wsServer.close();
      this.wsServer = null;
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }
  }

  getStatus(): ApiServerStatus {
    return {
      running: this._isRunning,
      port: this._port,
      addresses: this._isRunning ? this.getLocalAddresses() : [],
      connectedClients: this.connectedClientCount,
      pairedDevices: this.pairingManager.getDeviceCount(),
      relay: getRelayConnection().getStatus(),
    };
  }

  /**
   * Enable remote access via relay server
   */
  async enableRemoteAccess(): Promise<void> {
    const relay = getRelayConnection();
    await relay.enable();

    // Initialize relay handler if not already done
    const handler = initRelayHandler(this.pairingManager);
    handler.start();

    log.info('[ApiServer] Remote access enabled');
  }

  /**
   * Disable remote access via relay server
   */
  disableRemoteAccess(): void {
    const relay = getRelayConnection();
    relay.disable();
    log.info('[ApiServer] Remote access disabled');
  }

  /**
   * Get remote access status
   */
  getRemoteAccessStatus(): RelayConnectionStatus {
    return getRelayConnection().getStatus();
  }

  private getLocalAddresses(): string[] {
    const addresses: string[] = [];
    const interfaces = networkInterfaces();

    for (const name of Object.keys(interfaces)) {
      const nets = interfaces[name];
      if (!nets) continue;

      for (const net of nets) {
        // Skip internal (loopback) addresses
        if (net.internal) continue;

        // Only include IPv4 addresses for simplicity
        if (net.family === 'IPv4') {
          addresses.push(net.address);
        }
      }
    }

    // Prioritize 192.168.x.x (typical LAN) over 172.x.x (often Docker/WSL/Hyper-V) and 10.x.x
    return addresses.sort((a, b) => {
      const score = (ip: string) => {
        if (ip.startsWith('192.168.')) return 0;
        if (ip.startsWith('10.')) return 1;
        if (ip.startsWith('172.')) return 2;
        return 3;
      };
      return score(a) - score(b);
    });
  }

  /**
   * Send terminal output to all subscribed mobile clients
   */
  broadcastTerminalData(sessionId: string, data: string): void {
    // Send to local WebSocket clients
    if (this.wsServer) {
      this.wsServer.broadcastToSession(sessionId, {
        type: 'terminal:output',
        sessionId,
        payload: { data },
        timestamp: Date.now(),
      });
    }

    // Send to relay clients
    try {
      const { getRelayHandler } = require('./relay');
      const handler = getRelayHandler();
      handler.broadcastTerminalData(sessionId, data);
    } catch {
      // Relay handler not initialized, ignore
    }
  }

  /**
   * Broadcast session state change to all connected clients
   */
  broadcastSessionState(sessionId: string, state: string, event?: string): void {
    // Send to local WebSocket clients
    if (this.wsServer) {
      this.wsServer.broadcast({
        type: 'session:state',
        sessionId,
        payload: { state, event },
        timestamp: Date.now(),
      });
    }

    // Send to relay clients
    try {
      const { getRelayHandler } = require('./relay');
      const handler = getRelayHandler();
      handler.broadcastSessionState(sessionId, state, event);
    } catch {
      // Relay handler not initialized, ignore
    }
  }

  /**
   * Broadcast sessions list update to all connected clients
   */
  broadcastSessionsUpdated(): void {
    // Send to local WebSocket clients
    if (this.wsServer) {
      this.wsServer.broadcast({
        type: 'sessions:updated',
        timestamp: Date.now(),
      });
    }

    // Send to relay clients
    try {
      const { getRelayHandler } = require('./relay');
      const handler = getRelayHandler();
      handler.broadcastSessionsUpdated();
    } catch {
      // Relay handler not initialized, ignore
    }
  }

  /**
   * Broadcast groups list update to all connected clients
   */
  broadcastGroupsUpdated(): void {
    if (this.wsServer) {
      this.wsServer.broadcast({
        type: 'groups:updated',
        timestamp: Date.now(),
      });
    }
  }
}

// Singleton instance
let apiServerInstance: ApiServer | null = null;

export function getApiServer(): ApiServer {
  if (!apiServerInstance) {
    apiServerInstance = new ApiServer();
  }
  return apiServerInstance;
}

export function createApiServer(config?: Partial<ApiServerConfig>): ApiServer {
  if (apiServerInstance) {
    throw new Error('API server already exists. Use getApiServer() instead.');
  }
  apiServerInstance = new ApiServer(config);
  return apiServerInstance;
}
