/**
 * HTTP Server Setup
 *
 * Creates an Express server with security middleware and API routes.
 */

import { createServer, Server } from 'http';
import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import log from 'electron-log';
import { PairingManager } from './pairing/pairing-manager';
import { authenticateDevice } from './middleware/auth';
import { createSessionsRouter } from './routes/sessions';
import { createGroupsRouter } from './routes/groups';
import { createSystemRouter } from './routes/system';
import { createPairingRouter } from './routes/pairing';
import { createTerminalRouter } from './routes/terminal';
import { createChatRouter } from './routes/chat';
import { createMemoriesRouter } from './routes/memories';
import { createKnowledgeRouter } from './routes/knowledge';
import { createHooksRouter } from './routes/hooks';
import { createCodeSearchRouter } from './routes/code-search';

export interface HttpServerConfig {
  port: number;
  bindAddress: string;
  pairingManager: PairingManager;
}

export interface HttpServerResult {
  app: Express;
  server: Server;
  port: number;
}

/**
 * Check if an IP address is on the local network
 */
function isLocalNetworkIp(ip: string): boolean {
  // Allow loopback
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
    return true;
  }

  // Allow private IP ranges
  const privateRanges = [
    /^10\./,                          // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
    /^192\.168\./,                    // 192.168.0.0/16
    /^169\.254\./,                    // Link-local
    /^fc00:/,                         // IPv6 unique local
    /^fe80:/,                         // IPv6 link-local
  ];

  return privateRanges.some(range => range.test(ip));
}

/**
 * Extract client IP from request
 */
function getClientIp(req: Request): string {
  // Don't trust X-Forwarded-For - we're not behind a proxy
  const ip = req.socket.remoteAddress || '';
  // Handle IPv4-mapped IPv6 addresses
  return ip.replace(/^::ffff:/, '');
}

/**
 * Middleware to restrict access to local network only
 */
function localNetworkOnly(req: Request, res: Response, next: NextFunction): void {
  const clientIp = getClientIp(req);

  if (!isLocalNetworkIp(clientIp)) {
    log.warn(`[HttpServer] Rejected connection from non-local IP: ${clientIp}`);
    res.status(403).json({ error: 'Access denied: local network only' });
    return;
  }

  next();
}

/**
 * Create and configure the Express HTTP server
 */
export async function createHttpServer(config: HttpServerConfig): Promise<HttpServerResult> {
  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: false, // API only, no HTML
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin for mobile app
  }));

  // CORS - allow requests from any origin on local network
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (same-origin, mobile apps, curl)
      if (!origin) return callback(null, true);
      // Block cross-origin requests from browsers
      callback(new Error('CORS not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  }));

  // Restrict to local network
  app.use(localNetworkOnly);

  // Parse JSON bodies
  app.use(express.json({ limit: '1mb' }));

  // Rate limiting
  const generalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const pairingLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 pairing attempts per minute
    message: { error: 'Too many pairing attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Health check endpoint (no auth required)
  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Pairing routes (rate limited, no auth required for initiation)
  app.use('/api/v1/pairing', pairingLimiter, createPairingRouter(config.pairingManager));

  // Memory routes for MCP server (localhost-only, no device auth needed)
  // Kept for backward compatibility during transition
  app.use('/api/v1/memories', generalLimiter, createMemoriesRouter());

  // Knowledge routes for MCP server (localhost-only, no device auth needed)
  app.use('/api/v1/knowledge', generalLimiter, createKnowledgeRouter());

  // Hook routes for Claude Code hooks (localhost-only, no device auth needed)
  app.use('/api/v1/hooks', generalLimiter, createHooksRouter());

  // Code search routes for MCP server (localhost-only, no device auth needed)
  app.use('/api/v1/code', generalLimiter, createCodeSearchRouter());

  // Protected routes (require device authentication)
  const authMiddleware = authenticateDevice(config.pairingManager);
  app.use('/api/v1/sessions', generalLimiter, authMiddleware, createSessionsRouter());
  app.use('/api/v1/groups', generalLimiter, authMiddleware, createGroupsRouter());
  app.use('/api/v1/system', generalLimiter, authMiddleware, createSystemRouter());
  app.use('/api/v1/terminal', generalLimiter, authMiddleware, createTerminalRouter());
  app.use('/api/v1/chat', generalLimiter, authMiddleware, createChatRouter());

  // Error handling middleware
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log.error('[HttpServer] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Create HTTP server
  const server = createServer(app);

  // Find available port
  const port = await findAvailablePort(config.port, config.bindAddress, server);

  return { app, server, port };
}

/**
 * Find an available port, trying the preferred port first
 */
async function findAvailablePort(
  preferredPort: number,
  bindAddress: string,
  server: Server
): Promise<number> {
  const maxAttempts = 100;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = preferredPort + attempt;

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            log.debug(`[HttpServer] Port ${port} is in use, trying next...`);
            resolve(); // Try next port
          } else {
            reject(err);
          }
        });

        server.listen(port, bindAddress, () => {
          log.info(`[HttpServer] Listening on ${bindAddress}:${port}`);
          resolve();
        });
      });

      // Check if server is actually listening
      const address = server.address();
      if (address && typeof address === 'object') {
        return address.port;
      }
    } catch (error) {
      log.error(`[HttpServer] Error binding to port ${port}:`, error);
      throw error;
    }
  }

  throw new Error(`Could not find available port after ${maxAttempts} attempts`);
}
