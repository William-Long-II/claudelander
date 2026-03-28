import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process.spawn
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp/test') },
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { ClaudeSessionManager } from '../main/claude-session-manager';

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.pid = 12345;
  proc.kill = vi.fn();
  return proc;
}

describe('ClaudeSessionManager', () => {
  let manager: ClaudeSessionManager;
  let mockProcess: any;

  beforeEach(() => {
    mockSpawn.mockReset();
    manager = new ClaudeSessionManager();
    mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
  });

  describe('startSession', () => {
    it('should spawn claude with correct flags', () => {
      manager.startSession('sess-1', '/projects/myapp', 'Hello Claude');

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['-p', '--output-format', 'stream-json']),
        expect.objectContaining({
          cwd: '/projects/myapp',
        })
      );
    });

    it('should write the user prompt to stdin', () => {
      manager.startSession('sess-1', '/projects/myapp', 'Fix the auth bug');

      expect(mockProcess.stdin.write).toHaveBeenCalledWith('Fix the auth bug');
      expect(mockProcess.stdin.end).toHaveBeenCalled();
    });

    it('should emit events when JSON data arrives on stdout', () => {
      const events: any[] = [];
      manager.on('event', (data) => events.push(data));

      manager.startSession('sess-1', '/projects/myapp', 'Hello');

      // Simulate NDJSON line from Claude
      const jsonLine = JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello!' },
      });
      mockProcess.stdout.emit('data', Buffer.from(jsonLine + '\n'));

      expect(events).toHaveLength(1);
      expect(events[0].sessionId).toBe('sess-1');
      expect(events[0].event.type).toBe('content_block_delta');
    });

    it('should handle multi-line buffered output', () => {
      const events: any[] = [];
      manager.on('event', (data) => events.push(data));

      manager.startSession('sess-1', '/projects/myapp', 'Hello');

      const line1 = JSON.stringify({ type: 'message_start', message: { id: 'msg-1', role: 'assistant' } });
      const line2 = JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text' } });

      mockProcess.stdout.emit('data', Buffer.from(line1 + '\n' + line2 + '\n'));

      expect(events).toHaveLength(2);
    });

    it('should handle partial lines across chunks', () => {
      const events: any[] = [];
      manager.on('event', (data) => events.push(data));

      manager.startSession('sess-1', '/projects/myapp', 'Hello');

      const fullLine = JSON.stringify({ type: 'ping' });
      const half1 = fullLine.substring(0, 5);
      const half2 = fullLine.substring(5) + '\n';

      mockProcess.stdout.emit('data', Buffer.from(half1));
      expect(events).toHaveLength(0);

      mockProcess.stdout.emit('data', Buffer.from(half2));
      expect(events).toHaveLength(1);
      expect(events[0].event.type).toBe('ping');
    });
  });

  describe('sendMessage (resume)', () => {
    it('should spawn claude with --resume flag for follow-up messages', () => {
      manager.startSession('sess-1', '/projects/myapp', 'Initial prompt');
      // Simulate message_stop with session_id so claudeSessionId is captured
      const msgStop = JSON.stringify({ type: 'message_stop', session_id: 'claude-sess-abc123' });
      mockProcess.stdout.emit('data', Buffer.from(msgStop + '\n'));
      // Simulate completion
      mockProcess.emit('close', 0);

      // Reset mock
      const newProcess = createMockProcess();
      mockSpawn.mockReturnValue(newProcess);

      manager.sendMessage('sess-1', 'Follow-up question');

      const args = mockSpawn.mock.calls[1][1];
      expect(args).toContain('--resume');
    });
  });

  describe('killSession', () => {
    it('should kill the subprocess', () => {
      manager.startSession('sess-1', '/projects/myapp', 'Hello');
      manager.killSession('sess-1');
      expect(mockProcess.kill).toHaveBeenCalled();
    });

    it('should emit session-ended event', () => {
      const ended: string[] = [];
      manager.on('session-ended', (data) => ended.push(data.sessionId));

      manager.startSession('sess-1', '/projects/myapp', 'Hello');
      mockProcess.emit('close', 0);

      expect(ended).toContain('sess-1');
    });
  });

  describe('getSessionStatus', () => {
    it('should return idle for unknown session', () => {
      const status = manager.getSessionStatus('nonexistent');
      expect(status.state).toBe('idle');
    });

    it('should track state based on events', () => {
      manager.startSession('sess-1', '/projects/myapp', 'Hello');

      // Simulate content streaming
      const event = JSON.stringify({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Working...' },
      });
      mockProcess.stdout.emit('data', Buffer.from(event + '\n'));

      const status = manager.getSessionStatus('sess-1');
      expect(status.state).toBe('streaming');
    });
  });
});
