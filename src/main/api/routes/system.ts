/**
 * System API Routes
 *
 * System information and status endpoints.
 */

import { Router, Request, Response } from 'express';
import { app } from 'electron';
import { hostname, platform, release, homedir, cpus, totalmem, freemem } from 'os';
import log from 'electron-log';

export function createSystemRouter(): Router {
  const router = Router();

  /**
   * GET /system/info - Get system information
   */
  router.get('/info', (_req: Request, res: Response) => {
    try {
      res.json({
        app: {
          name: 'ClaudeLander',
          version: app.getVersion(),
        },
        platform: {
          os: platform(),
          release: release(),
          hostname: hostname(),
          homeDir: homedir(),
        },
        uptime: process.uptime(),
        timestamp: Date.now(),
      });
    } catch (error) {
      log.error('[SystemAPI] Error getting system info:', error);
      res.status(500).json({ error: 'Failed to get system info' });
    }
  });

  /**
   * GET /system/shells - Get available shells (legacy endpoint)
   */
  router.get('/shells', (_req: Request, res: Response) => {
    // Shell detection removed in 3.0 — Claude CLI manages its own shell
    res.json({
      default: { name: 'claude', path: 'claude' },
      wslDistros: [],
    });
  });

  /**
   * GET /system/status - Get detailed system status
   */
  router.get('/status', (_req: Request, res: Response) => {
    try {
      const cpuInfo = cpus();
      const totalMemory = totalmem();
      const freeMemory = freemem();

      res.json({
        memory: {
          total: totalMemory,
          free: freeMemory,
          used: totalMemory - freeMemory,
          percentUsed: ((totalMemory - freeMemory) / totalMemory * 100).toFixed(1),
        },
        cpu: {
          count: cpuInfo.length,
          model: cpuInfo[0]?.model || 'Unknown',
        },
        process: {
          pid: process.pid,
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      log.error('[SystemAPI] Error getting system status:', error);
      res.status(500).json({ error: 'Failed to get system status' });
    }
  });

  /**
   * GET /system/paths - Get important paths
   */
  router.get('/paths', (_req: Request, res: Response) => {
    try {
      res.json({
        home: homedir(),
        userData: app.getPath('userData'),
        temp: app.getPath('temp'),
        logs: app.getPath('logs'),
      });
    } catch (error) {
      log.error('[SystemAPI] Error getting paths:', error);
      res.status(500).json({ error: 'Failed to get paths' });
    }
  });

  return router;
}
