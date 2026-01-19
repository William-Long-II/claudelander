import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log';

export interface MemoryEntry {
  id: string;
  sessionId: string;
  type: 'note' | 'decision' | 'learning' | 'context' | 'task';
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
}

export interface SessionMemory {
  sessionId: string;
  entries: MemoryEntry[];
  customInstructions: string;
  lastUpdated: string;
}

class MemoryManager {
  private memoryDir: string;
  private memories: Map<string, SessionMemory> = new Map();

  constructor() {
    this.memoryDir = path.join(app.getPath('userData'), 'memories');
    this.ensureMemoryDir();
  }

  private ensureMemoryDir() {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
  }

  private getMemoryPath(sessionId: string): string {
    return path.join(this.memoryDir, `${sessionId}.json`);
  }

  /**
   * Load memory for a session
   */
  async loadMemory(sessionId: string): Promise<SessionMemory> {
    // Check cache first
    if (this.memories.has(sessionId)) {
      return this.memories.get(sessionId)!;
    }

    const memoryPath = this.getMemoryPath(sessionId);

    if (fs.existsSync(memoryPath)) {
      try {
        const data = fs.readFileSync(memoryPath, 'utf-8');
        const memory = JSON.parse(data) as SessionMemory;
        this.memories.set(sessionId, memory);
        return memory;
      } catch (error) {
        log.error(`Failed to load memory for session ${sessionId}:`, error);
      }
    }

    // Create new memory
    const memory: SessionMemory = {
      sessionId,
      entries: [],
      customInstructions: '',
      lastUpdated: new Date().toISOString(),
    };
    this.memories.set(sessionId, memory);
    return memory;
  }

  /**
   * Save memory for a session
   */
  async saveMemory(sessionId: string): Promise<void> {
    const memory = this.memories.get(sessionId);
    if (!memory) return;

    memory.lastUpdated = new Date().toISOString();
    const memoryPath = this.getMemoryPath(sessionId);

    try {
      fs.writeFileSync(memoryPath, JSON.stringify(memory, null, 2));
    } catch (error) {
      log.error(`Failed to save memory for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Add a memory entry
   */
  async addEntry(sessionId: string, entry: Omit<MemoryEntry, 'id' | 'sessionId' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry> {
    const memory = await this.loadMemory(sessionId);

    const newEntry: MemoryEntry = {
      ...entry,
      id: crypto.randomUUID(),
      sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    memory.entries.push(newEntry);
    await this.saveMemory(sessionId);

    return newEntry;
  }

  /**
   * Update a memory entry
   */
  async updateEntry(sessionId: string, entryId: string, updates: Partial<MemoryEntry>): Promise<MemoryEntry | null> {
    const memory = await this.loadMemory(sessionId);
    const entry = memory.entries.find(e => e.id === entryId);

    if (!entry) return null;

    Object.assign(entry, updates, { updatedAt: new Date().toISOString() });
    await this.saveMemory(sessionId);

    return entry;
  }

  /**
   * Delete a memory entry
   */
  async deleteEntry(sessionId: string, entryId: string): Promise<boolean> {
    const memory = await this.loadMemory(sessionId);
    const index = memory.entries.findIndex(e => e.id === entryId);

    if (index === -1) return false;

    memory.entries.splice(index, 1);
    await this.saveMemory(sessionId);

    return true;
  }

  /**
   * Set custom instructions for a session
   */
  async setCustomInstructions(sessionId: string, instructions: string): Promise<void> {
    const memory = await this.loadMemory(sessionId);
    memory.customInstructions = instructions;
    await this.saveMemory(sessionId);
  }

  /**
   * Get all entries for a session
   */
  async getEntries(sessionId: string, type?: string): Promise<MemoryEntry[]> {
    const memory = await this.loadMemory(sessionId);
    if (type) {
      return memory.entries.filter(e => e.type === type);
    }
    return memory.entries;
  }

  /**
   * Search entries across all sessions
   */
  async searchEntries(query: string, sessionIds?: string[]): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];
    const searchLower = query.toLowerCase();

    // Get all memory files if no specific sessions
    let sessionsToSearch = sessionIds;
    if (!sessionsToSearch) {
      const files = fs.readdirSync(this.memoryDir);
      sessionsToSearch = files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    }

    for (const sessionId of sessionsToSearch) {
      const memory = await this.loadMemory(sessionId);
      const matches = memory.entries.filter(e =>
        e.content.toLowerCase().includes(searchLower) ||
        e.tags.some(t => t.toLowerCase().includes(searchLower))
      );
      results.push(...matches);
    }

    return results;
  }

  /**
   * Delete all memory for a session
   */
  async deleteMemory(sessionId: string): Promise<void> {
    const memoryPath = this.getMemoryPath(sessionId);
    this.memories.delete(sessionId);

    if (fs.existsSync(memoryPath)) {
      fs.unlinkSync(memoryPath);
    }
  }

  /**
   * Export memory to markdown format
   */
  async exportToMarkdown(sessionId: string): Promise<string> {
    const memory = await this.loadMemory(sessionId);
    let md = `# Session Memory\n\n`;

    if (memory.customInstructions) {
      md += `## Custom Instructions\n\n${memory.customInstructions}\n\n`;
    }

    const pinnedEntries = memory.entries.filter(e => e.pinned);
    const regularEntries = memory.entries.filter(e => !e.pinned);

    if (pinnedEntries.length > 0) {
      md += `## Pinned\n\n`;
      for (const entry of pinnedEntries) {
        md += `### ${entry.type.charAt(0).toUpperCase() + entry.type.slice(1)}\n`;
        md += `${entry.content}\n`;
        if (entry.tags.length > 0) {
          md += `\nTags: ${entry.tags.join(', ')}\n`;
        }
        md += `\n`;
      }
    }

    // Group by type
    const byType = regularEntries.reduce((acc, entry) => {
      if (!acc[entry.type]) acc[entry.type] = [];
      acc[entry.type].push(entry);
      return acc;
    }, {} as Record<string, MemoryEntry[]>);

    for (const [type, entries] of Object.entries(byType)) {
      md += `## ${type.charAt(0).toUpperCase() + type.slice(1)}s\n\n`;
      for (const entry of entries) {
        md += `- ${entry.content}`;
        if (entry.tags.length > 0) {
          md += ` (${entry.tags.join(', ')})`;
        }
        md += `\n`;
      }
      md += `\n`;
    }

    return md;
  }

  /**
   * Initialize IPC handlers
   */
  initialize() {
    ipcMain.handle('memory:load', async (_event, sessionId: string) => {
      return this.loadMemory(sessionId);
    });

    ipcMain.handle('memory:addEntry', async (_event, sessionId: string, entry: Omit<MemoryEntry, 'id' | 'sessionId' | 'createdAt' | 'updatedAt'>) => {
      return this.addEntry(sessionId, entry);
    });

    ipcMain.handle('memory:updateEntry', async (_event, sessionId: string, entryId: string, updates: Partial<MemoryEntry>) => {
      return this.updateEntry(sessionId, entryId, updates);
    });

    ipcMain.handle('memory:deleteEntry', async (_event, sessionId: string, entryId: string) => {
      return this.deleteEntry(sessionId, entryId);
    });

    ipcMain.handle('memory:setInstructions', async (_event, sessionId: string, instructions: string) => {
      return this.setCustomInstructions(sessionId, instructions);
    });

    ipcMain.handle('memory:getEntries', async (_event, sessionId: string, type?: string) => {
      return this.getEntries(sessionId, type);
    });

    ipcMain.handle('memory:search', async (_event, query: string, sessionIds?: string[]) => {
      return this.searchEntries(query, sessionIds);
    });

    ipcMain.handle('memory:delete', async (_event, sessionId: string) => {
      return this.deleteMemory(sessionId);
    });

    ipcMain.handle('memory:export', async (_event, sessionId: string) => {
      return this.exportToMarkdown(sessionId);
    });
  }
}

export const memoryManager = new MemoryManager();
