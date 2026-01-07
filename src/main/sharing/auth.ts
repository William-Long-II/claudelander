import { shell, safeStorage } from 'electron';
import * as crypto from 'crypto';
import { RELAY_URL } from '../../shared/constants';
import { ShareUser } from '../../shared/types';
import * as prefsRepo from '../repositories/preferences';
import log from 'electron-log';

const AUTH_TOKEN_KEY = 'auth_token_encrypted';
const AUTH_STATE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

interface AuthState {
  token: string | null;
  user: ShareUser | null;
}

interface PendingAuth {
  state: string;
  createdAt: number;
}

class AuthService {
  private state: AuthState = {
    token: null,
    user: null,
  };

  // Track pending auth requests to validate state parameter
  private pendingAuth: PendingAuth | null = null;

  /**
   * Securely store token using electron safeStorage
   */
  private saveTokenSecurely(token: string): void {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(token);
      prefsRepo.setPreference(AUTH_TOKEN_KEY, encrypted.toString('base64'));
      log.info('Token saved securely with encryption');
    } else {
      // Fallback: store with warning (better than localStorage)
      log.warn('safeStorage encryption not available, storing token without encryption');
      prefsRepo.setPreference(AUTH_TOKEN_KEY, token);
    }
  }

  /**
   * Retrieve securely stored token
   */
  private loadTokenSecurely(): string | null {
    const stored = prefsRepo.getPreference(AUTH_TOKEN_KEY);
    if (!stored) return null;

    if (safeStorage.isEncryptionAvailable()) {
      try {
        const buffer = Buffer.from(stored, 'base64');
        return safeStorage.decryptString(buffer);
      } catch (e) {
        log.error('Failed to decrypt token:', e);
        return null;
      }
    }
    // Fallback: return as-is
    return stored;
  }

  /**
   * Clear stored token
   */
  private clearStoredToken(): void {
    prefsRepo.setPreference(AUTH_TOKEN_KEY, '');
  }

  /**
   * Initialize auth state from stored token
   */
  async initialize(): Promise<void> {
    const storedToken = this.loadTokenSecurely();
    if (storedToken) {
      try {
        await this.handleCallback(storedToken);
        log.info('Restored auth from secure storage');
      } catch (e) {
        log.error('Failed to restore auth:', e);
        this.clearStoredToken();
      }
    }
  }

  get isAuthenticated(): boolean {
    return this.state.token !== null;
  }

  get currentUser(): ShareUser | null {
    return this.state.user;
  }

  get token(): string | null {
    return this.state.token;
  }

  /**
   * Generate a cryptographically secure state parameter
   */
  private generateState(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Validate state parameter from callback
   */
  validateState(state: string): boolean {
    if (!this.pendingAuth) {
      log.warn('No pending auth request');
      return false;
    }

    const { state: expectedState, createdAt } = this.pendingAuth;

    // Check expiry
    if (Date.now() - createdAt > AUTH_STATE_EXPIRY_MS) {
      log.warn('Auth state expired');
      this.pendingAuth = null;
      return false;
    }

    // Constant-time comparison to prevent timing attacks
    const valid = crypto.timingSafeEqual(
      Buffer.from(state),
      Buffer.from(expectedState)
    );

    if (valid) {
      this.pendingAuth = null; // Clear after successful validation
    } else {
      log.warn('Auth state mismatch');
    }

    return valid;
  }

  /**
   * Start GitHub OAuth flow by opening browser
   */
  startLogin(): void {
    // Generate state for CSRF protection
    const state = this.generateState();
    this.pendingAuth = { state, createdAt: Date.now() };

    const authUrl = `${RELAY_URL}/auth/github?state=${encodeURIComponent(state)}`;
    shell.openExternal(authUrl);
  }

  /**
   * Handle the OAuth callback with token
   * Called when deep link claudelander://auth?token=xxx is received
   */
  async handleCallback(token: string): Promise<ShareUser> {
    this.state.token = token;

    // Fetch user info
    const response = await fetch(`${RELAY_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      this.state.token = null;
      throw new Error('Failed to fetch user info');
    }

    const user = (await response.json()) as ShareUser;
    this.state.user = user;

    // Save token securely
    this.saveTokenSecurely(token);

    log.info('User authenticated:', user.username);
    return user;
  }

  /**
   * Set token directly (for restoring from storage)
   */
  async setToken(token: string): Promise<ShareUser | null> {
    try {
      return await this.handleCallback(token);
    } catch (e) {
      log.error('Failed to restore token:', e);
      return null;
    }
  }

  /**
   * Log out
   */
  logout(): void {
    this.state.token = null;
    this.state.user = null;
    this.clearStoredToken();
  }

  /**
   * Get auth headers for API requests
   */
  getHeaders(): Record<string, string> {
    if (!this.state.token) {
      throw new Error('Not authenticated');
    }
    return {
      Authorization: `Bearer ${this.state.token}`,
      'Content-Type': 'application/json',
    };
  }
}

export const authService = new AuthService();
