// Global test setup for ClaudeLander
// Mock Electron APIs that aren't available in test environment
import { vi } from 'vitest';

// Mock electron app module
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/claudelander-test'),
    isPackaged: false,
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

// Mock electron-log
vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
