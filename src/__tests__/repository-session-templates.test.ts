import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initKnowledgeGraphTables } from '../main/database-knowledge';

// We need to mock ../main/database so the repository uses our in-memory DB
let testDb: Database.Database;

vi.mock('../main/database', () => ({
  getDatabase: () => testDb,
}));

// Import repository functions AFTER the mock is set up
import {
  createSessionTemplate,
  getSessionTemplate,
  getAllSessionTemplates,
  getSessionTemplatesByGroup,
  updateSessionTemplate,
  deleteSessionTemplate,
} from '../main/repositories/session-templates';

/**
 * Helper: create prerequisite tables (groups, sessions) that the
 * session_templates table references via foreign keys.
 */
function createPrerequisiteTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#888888',
      working_dir TEXT DEFAULT '',
      "order" INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      group_id TEXT REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      working_dir TEXT NOT NULL,
      state TEXT DEFAULT 'idle',
      shell_type TEXT DEFAULT 'bash',
      "order" INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed groups so FK references succeed
  db.prepare(`INSERT INTO groups (id, name) VALUES ('g1', 'Test Group')`).run();
  db.prepare(`INSERT INTO groups (id, name) VALUES ('g2', 'Other Group')`).run();
}

describe('Session Templates Repository', () => {
  beforeEach(() => {
    testDb = new Database(':memory:');
    testDb.pragma('foreign_keys = ON');
    createPrerequisiteTables(testDb);
    initKnowledgeGraphTables(testDb);
  });

  afterEach(() => {
    testDb.close();
  });

  // ---------- CRUD ----------

  describe('createSessionTemplate', () => {
    it('should create a template with all fields', () => {
      const template = createSessionTemplate({
        id: 'tpl-001',
        name: 'My Template',
        workingDir: '/projects/myapp',
        initialPrompt: 'Start coding on the main feature',
        knowledgeContext: ['ctx-1', 'ctx-2'],
        groupId: 'g1',
      });

      expect(template.id).toBe('tpl-001');
      expect(template.name).toBe('My Template');
      expect(template.workingDir).toBe('/projects/myapp');
      expect(template.initialPrompt).toBe('Start coding on the main feature');
      expect(template.knowledgeContext).toEqual(['ctx-1', 'ctx-2']);
      expect(template.groupId).toBe('g1');
      expect(template.createdAt).toBeInstanceOf(Date);
      expect(template.updatedAt).toBeNull();
    });

    it('should create a template with minimal fields', () => {
      const template = createSessionTemplate({
        id: 'tpl-002',
        name: 'Minimal Template',
      });

      expect(template.id).toBe('tpl-002');
      expect(template.name).toBe('Minimal Template');
      expect(template.workingDir).toBeNull();
      expect(template.initialPrompt).toBeNull();
      expect(template.knowledgeContext).toEqual([]);
      expect(template.groupId).toBeNull();
    });
  });

  describe('getSessionTemplate', () => {
    it('should return null for nonexistent template', () => {
      const result = getSessionTemplate('nonexistent');
      expect(result).toBeNull();
    });

    it('should return a template by id', () => {
      createSessionTemplate({
        id: 'tpl-003',
        name: 'Fetched Template',
        workingDir: '/tmp',
      });

      const template = getSessionTemplate('tpl-003');
      expect(template).not.toBeNull();
      expect(template!.name).toBe('Fetched Template');
      expect(template!.workingDir).toBe('/tmp');
    });
  });

  describe('getAllSessionTemplates', () => {
    it('should return all templates', () => {
      createSessionTemplate({ id: 'tpl-a', name: 'Template A' });
      createSessionTemplate({ id: 'tpl-b', name: 'Template B' });
      createSessionTemplate({ id: 'tpl-c', name: 'Template C' });

      const templates = getAllSessionTemplates();
      expect(templates).toHaveLength(3);
      const ids = templates.map(t => t.id).sort();
      expect(ids).toEqual(['tpl-a', 'tpl-b', 'tpl-c']);
    });

    it('should return empty array when no templates exist', () => {
      const templates = getAllSessionTemplates();
      expect(templates).toEqual([]);
    });
  });

  describe('getSessionTemplatesByGroup', () => {
    it('should return templates for a specific group', () => {
      createSessionTemplate({ id: 'tpl-g1a', name: 'G1 Template A', groupId: 'g1' });
      createSessionTemplate({ id: 'tpl-g1b', name: 'G1 Template B', groupId: 'g1' });
      createSessionTemplate({ id: 'tpl-g2a', name: 'G2 Template A', groupId: 'g2' });
      createSessionTemplate({ id: 'tpl-none', name: 'No Group Template' });

      const g1Templates = getSessionTemplatesByGroup('g1');
      expect(g1Templates).toHaveLength(2);
      expect(g1Templates.every(t => t.groupId === 'g1')).toBe(true);

      const g2Templates = getSessionTemplatesByGroup('g2');
      expect(g2Templates).toHaveLength(1);
      expect(g2Templates[0].id).toBe('tpl-g2a');
    });

    it('should return empty array for group with no templates', () => {
      const templates = getSessionTemplatesByGroup('g1');
      expect(templates).toEqual([]);
    });
  });

  describe('updateSessionTemplate', () => {
    it('should update name', () => {
      createSessionTemplate({ id: 'tpl-upd', name: 'Original' });

      updateSessionTemplate('tpl-upd', { name: 'Updated Name' });

      const template = getSessionTemplate('tpl-upd');
      expect(template!.name).toBe('Updated Name');
      expect(template!.updatedAt).toBeInstanceOf(Date);
    });

    it('should update working directory', () => {
      createSessionTemplate({ id: 'tpl-upd2', name: 'Template', workingDir: '/old' });

      updateSessionTemplate('tpl-upd2', { workingDir: '/new/path' });

      const template = getSessionTemplate('tpl-upd2');
      expect(template!.workingDir).toBe('/new/path');
    });

    it('should update initial prompt', () => {
      createSessionTemplate({ id: 'tpl-upd3', name: 'Template' });

      updateSessionTemplate('tpl-upd3', { initialPrompt: 'New prompt' });

      const template = getSessionTemplate('tpl-upd3');
      expect(template!.initialPrompt).toBe('New prompt');
    });

    it('should update knowledge context', () => {
      createSessionTemplate({ id: 'tpl-upd4', name: 'Template', knowledgeContext: ['old'] });

      updateSessionTemplate('tpl-upd4', { knowledgeContext: ['new-1', 'new-2'] });

      const template = getSessionTemplate('tpl-upd4');
      expect(template!.knowledgeContext).toEqual(['new-1', 'new-2']);
    });

    it('should update group id', () => {
      createSessionTemplate({ id: 'tpl-upd5', name: 'Template', groupId: 'g1' });

      updateSessionTemplate('tpl-upd5', { groupId: 'g2' });

      const template = getSessionTemplate('tpl-upd5');
      expect(template!.groupId).toBe('g2');
    });

    it('should update multiple fields at once', () => {
      createSessionTemplate({ id: 'tpl-upd6', name: 'Original', workingDir: '/old' });

      updateSessionTemplate('tpl-upd6', {
        name: 'Updated',
        workingDir: '/new',
        initialPrompt: 'Do something',
      });

      const template = getSessionTemplate('tpl-upd6');
      expect(template!.name).toBe('Updated');
      expect(template!.workingDir).toBe('/new');
      expect(template!.initialPrompt).toBe('Do something');
    });
  });

  describe('deleteSessionTemplate', () => {
    it('should delete an existing template and return true', () => {
      createSessionTemplate({ id: 'tpl-del', name: 'To Delete' });

      const result = deleteSessionTemplate('tpl-del');
      expect(result).toBe(true);
      expect(getSessionTemplate('tpl-del')).toBeNull();
    });

    it('should return false when deleting nonexistent template', () => {
      const result = deleteSessionTemplate('nonexistent');
      expect(result).toBe(false);
    });

    it('should not affect other templates', () => {
      createSessionTemplate({ id: 'tpl-keep', name: 'Keep' });
      createSessionTemplate({ id: 'tpl-remove', name: 'Remove' });

      deleteSessionTemplate('tpl-remove');

      expect(getSessionTemplate('tpl-keep')).not.toBeNull();
      expect(getAllSessionTemplates()).toHaveLength(1);
    });
  });
});
