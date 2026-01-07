/**
 * IPC Input Validation Utilities
 *
 * Provides validation functions for IPC handler inputs to prevent
 * injection attacks and ensure data integrity.
 */

// UUID v4 pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Allowed preference keys (whitelist)
const ALLOWED_PREFERENCE_KEYS = new Set([
  'autoLaunchClaude',
  'customShellPath',
  'showSplash',
  'splashDuration',
  'enableNotifications',
  'notificationSound',
  'closeToTray',
  'fontSize',
  'webglRenderer',
  'soundVolume',
  'soundWaitingEnabled',
  'soundWaitingCustomPath',
  'soundErrorEnabled',
  'soundErrorCustomPath',
  'soundStartEnabled',
  'soundStartCustomPath',
  'soundCompleteEnabled',
  'soundCompleteCustomPath',
  'teamsTokens',
  'auth_token_encrypted',
  'windowBounds',
]);

/**
 * Validate that a string is a valid UUID v4
 */
export function isValidUUID(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/**
 * Validate that a preference key is in the whitelist
 */
export function isValidPreferenceKey(key: unknown): key is string {
  return typeof key === 'string' && ALLOWED_PREFERENCE_KEYS.has(key);
}

/**
 * Validate string with max length
 */
export function isValidString(value: unknown, maxLength: number = 10000): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

/**
 * Validate non-empty string with max length
 */
export function isNonEmptyString(value: unknown, maxLength: number = 10000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/**
 * Validate that a value is a positive integer
 */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Validate that a value is a non-negative integer
 */
export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Validate a file path (basic sanity check - no null bytes, reasonable length)
 */
export function isValidFilePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 4096) return false;
  if (value.includes('\0')) return false; // No null bytes
  return true;
}

/**
 * Validate a share code format
 */
export function isValidShareCode(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // Share codes should be alphanumeric and reasonably short
  return /^[A-Za-z0-9]{4,32}$/.test(value);
}

/**
 * Validate session state
 */
export function isValidSessionState(value: unknown): value is string {
  const validStates = ['idle', 'working', 'waiting', 'error', 'stopped'];
  return typeof value === 'string' && validStates.includes(value);
}

/**
 * Validate sound event type
 */
export function isValidSoundEvent(value: unknown): value is string {
  const validEvents = ['waiting', 'error', 'start', 'complete'];
  return typeof value === 'string' && validEvents.includes(value);
}

/**
 * Validate group color (hex color)
 */
export function isValidColor(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/**
 * Validate permission type
 */
export function isValidPermission(value: unknown): value is 'read' | 'control' {
  return value === 'read' || value === 'control';
}
