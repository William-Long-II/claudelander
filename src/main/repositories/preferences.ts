import { getDatabase } from '../database';

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized?: boolean;
}

export function getPreference(key: string): string | null {
  const db = getDatabase();
  const row = db.prepare('SELECT value FROM preferences WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setPreference(key: string, value: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO preferences (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function getWindowBounds(): WindowBounds | null {
  const value = getPreference('windowBounds');
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function setWindowBounds(bounds: WindowBounds): void {
  setPreference('windowBounds', JSON.stringify(bounds));
}
