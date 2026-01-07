/**
 * Shell IPC Handlers
 */
import { ipcMain, shell } from 'electron';
import log from 'electron-log';

// URL validation for external links
const ALLOWED_PROTOCOLS = ['https:', 'http:', 'mailto:'];
const ALLOWED_DOMAINS = [
  'github.com',
  'cl-relay.sytanek.tech',
  'login.microsoftonline.com',
  'anthropic.com',
  'claude.ai',
];

function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
      log.warn('Blocked external URL with disallowed protocol:', parsed.protocol);
      return false;
    }
    if (parsed.protocol === 'mailto:') {
      return true;
    }
    const isAllowedDomain = ALLOWED_DOMAINS.some(
      (domain) => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
    );
    if (!isAllowedDomain) {
      log.warn('Blocked external URL with disallowed domain:', parsed.hostname);
      return false;
    }
    return true;
  } catch {
    log.warn('Blocked invalid external URL:', url);
    return false;
  }
}

export function registerShellHandlers(): void {
  ipcMain.handle('shell:openExternal', (_, url: string) => {
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
      return { success: true };
    }
    return { success: false, error: 'URL not allowed' };
  });
}
