/**
 * Pairing Manager
 *
 * Manages device pairing for mobile companions, including:
 * - Generating pairing codes
 * - Validating pairing attempts
 * - Storing paired devices
 * - Managing authentication tokens
 */

import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import log from 'electron-log';
import { getDatabase } from '../../database';

export interface PairedDevice {
  id: string;
  name: string;
  platform: string;
  canControl: boolean;
  canModify: boolean;
  createdAt: Date;
  lastUsedAt: Date;
}

export interface PairingCode {
  code: string;
  expiresAt: number;
  permissions: {
    canControl: boolean;
    canModify: boolean;
  };
}

interface DeviceRow {
  id: string;
  name: string;
  secret_hash: string;
  platform: string;
  can_control: number;
  can_modify: number;
  created_at: string;
  last_used_at: string;
}

const PAIRING_CODE_LENGTH = 6;
const PAIRING_CODE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_SECRET_LENGTH = 32; // 256 bits

export class PairingManager {
  private activePairingCode: PairingCode | null = null;

  constructor() {
    this.ensureTableExists();
  }

  private ensureTableExists(): void {
    const db = getDatabase();
    db.exec(`
      CREATE TABLE IF NOT EXISTS paired_devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        secret_hash TEXT NOT NULL,
        platform TEXT,
        can_control INTEGER DEFAULT 1,
        can_modify INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_used_at TEXT
      )
    `);
  }

  /**
   * Generate a new pairing code for QR code display
   */
  generatePairingCode(permissions?: { canControl?: boolean; canModify?: boolean }): PairingCode {
    // Generate a 6-digit numeric code
    const codeNum = randomBytes(4).readUInt32BE() % 1000000;
    const code = codeNum.toString().padStart(PAIRING_CODE_LENGTH, '0');

    this.activePairingCode = {
      code,
      expiresAt: Date.now() + PAIRING_CODE_EXPIRY_MS,
      permissions: {
        canControl: permissions?.canControl ?? true,
        canModify: permissions?.canModify ?? false,
      },
    };

    log.info(`[PairingManager] Generated pairing code (expires in ${PAIRING_CODE_EXPIRY_MS / 1000}s)`);

    return this.activePairingCode;
  }

  /**
   * Validate a pairing code and return pairing info if valid
   */
  validatePairingCode(code: string): PairingCode | null {
    if (!this.activePairingCode) {
      log.warn('[PairingManager] No active pairing code');
      return null;
    }

    if (Date.now() > this.activePairingCode.expiresAt) {
      log.warn('[PairingManager] Pairing code expired');
      this.activePairingCode = null;
      return null;
    }

    // Use timing-safe comparison
    const codeBuffer = Buffer.from(code);
    const expectedBuffer = Buffer.from(this.activePairingCode.code);

    if (codeBuffer.length !== expectedBuffer.length) {
      log.warn('[PairingManager] Invalid pairing code length');
      return null;
    }

    if (!timingSafeEqual(codeBuffer, expectedBuffer)) {
      log.warn('[PairingManager] Invalid pairing code');
      return null;
    }

    log.info('[PairingManager] Pairing code validated');
    return this.activePairingCode;
  }

  /**
   * Complete pairing and create a new paired device
   */
  completePairing(
    code: string,
    deviceName: string,
    platform: string
  ): { device: PairedDevice; token: string } | null {
    const pairingInfo = this.validatePairingCode(code);
    if (!pairingInfo) {
      return null;
    }

    // Generate device ID and secret
    const deviceId = this.generateUUID();
    const secret = randomBytes(TOKEN_SECRET_LENGTH);
    const secretHash = this.hashSecret(secret);

    // Create the token (deviceId:secret in base64)
    const token = Buffer.from(`${deviceId}:${secret.toString('base64')}`).toString('base64');

    // Store in database
    const db = getDatabase();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO paired_devices (id, name, secret_hash, platform, can_control, can_modify, created_at, last_used_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      deviceId,
      deviceName,
      secretHash,
      platform,
      pairingInfo.permissions.canControl ? 1 : 0,
      pairingInfo.permissions.canModify ? 1 : 0,
      now,
      now
    );

    // Clear the pairing code after successful use
    this.activePairingCode = null;

    const device: PairedDevice = {
      id: deviceId,
      name: deviceName,
      platform,
      canControl: pairingInfo.permissions.canControl,
      canModify: pairingInfo.permissions.canModify,
      createdAt: new Date(now),
      lastUsedAt: new Date(now),
    };

    log.info(`[PairingManager] Device paired: ${deviceName} (${platform})`);

    return { device, token };
  }

  /**
   * Validate an authentication token and return the device if valid
   */
  validateToken(token: string): PairedDevice | null {
    try {
      // Decode the token
      const decoded = Buffer.from(token, 'base64').toString();
      const separatorIndex = decoded.indexOf(':');

      if (separatorIndex === -1) {
        return null;
      }

      const deviceId = decoded.substring(0, separatorIndex);
      const secretBase64 = decoded.substring(separatorIndex + 1);
      const secret = Buffer.from(secretBase64, 'base64');

      // Look up the device
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM paired_devices WHERE id = ?').get(deviceId) as DeviceRow | undefined;

      if (!row) {
        return null;
      }

      // Verify the secret
      const expectedHash = row.secret_hash;
      const actualHash = this.hashSecret(secret);

      if (!timingSafeEqual(Buffer.from(expectedHash), Buffer.from(actualHash))) {
        return null;
      }

      return {
        id: row.id,
        name: row.name,
        platform: row.platform,
        canControl: Boolean(row.can_control),
        canModify: Boolean(row.can_modify),
        createdAt: new Date(row.created_at),
        lastUsedAt: new Date(row.last_used_at),
      };
    } catch (error) {
      log.error('[PairingManager] Token validation error:', error);
      return null;
    }
  }

  /**
   * Update the last used timestamp for a device
   */
  updateLastUsed(deviceId: string): void {
    const db = getDatabase();
    db.prepare('UPDATE paired_devices SET last_used_at = ? WHERE id = ?')
      .run(new Date().toISOString(), deviceId);
  }

  /**
   * Get all paired devices
   */
  getAllDevices(): PairedDevice[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM paired_devices ORDER BY last_used_at DESC').all() as DeviceRow[];

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      platform: row.platform,
      canControl: Boolean(row.can_control),
      canModify: Boolean(row.can_modify),
      createdAt: new Date(row.created_at),
      lastUsedAt: new Date(row.last_used_at),
    }));
  }

  /**
   * Get the count of paired devices
   */
  getDeviceCount(): number {
    const db = getDatabase();
    const result = db.prepare('SELECT COUNT(*) as count FROM paired_devices').get() as { count: number };
    return result.count;
  }

  /**
   * Remove a paired device
   */
  unpairDevice(deviceId: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM paired_devices WHERE id = ?').run(deviceId);
    const success = result.changes > 0;

    if (success) {
      log.info(`[PairingManager] Device unpaired: ${deviceId}`);
    }

    return success;
  }

  /**
   * Update device permissions
   */
  updateDevicePermissions(
    deviceId: string,
    permissions: { canControl?: boolean; canModify?: boolean }
  ): boolean {
    const db = getDatabase();
    const fields: string[] = [];
    const values: (number | string)[] = [];

    if (permissions.canControl !== undefined) {
      fields.push('can_control = ?');
      values.push(permissions.canControl ? 1 : 0);
    }
    if (permissions.canModify !== undefined) {
      fields.push('can_modify = ?');
      values.push(permissions.canModify ? 1 : 0);
    }

    if (fields.length === 0) {
      return false;
    }

    values.push(deviceId);
    const result = db.prepare(`UPDATE paired_devices SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    return result.changes > 0;
  }

  /**
   * Check if there's an active pairing code
   */
  hasActivePairingCode(): boolean {
    if (!this.activePairingCode) {
      return false;
    }
    if (Date.now() > this.activePairingCode.expiresAt) {
      this.activePairingCode = null;
      return false;
    }
    return true;
  }

  /**
   * Cancel the current pairing code
   */
  cancelPairing(): void {
    this.activePairingCode = null;
    log.info('[PairingManager] Pairing cancelled');
  }

  private hashSecret(secret: Buffer): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  private generateUUID(): string {
    const bytes = randomBytes(16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10

    const hex = bytes.toString('hex');
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join('-');
  }
}
