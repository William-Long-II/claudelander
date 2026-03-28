import { describe, it, expect } from 'vitest';
import type {
  KnowledgeNode,
  KnowledgeEdge,
  ChatMessage,
  ClaudeJsonEvent,
  SessionTemplate,
  ConversationBranch,
} from '../shared/types';

describe('Knowledge Graph Types (3.0)', () => {
  it('should create a tier-1 KnowledgeNode', () => {
    const node: KnowledgeNode = {
      id: 'kn-001',
      tier: 1,
      content: 'Always use absolute paths on Windows',
      confidence: 0.95,
      source: 'auto-extracted',
      scopeSessionId: 'sess-1',
      scopeGroupId: null,
      domains: ['filesystem', 'windows'],
      tags: ['best-practice'],
      createdAt: new Date('2026-03-01'),
      lastReinforcedAt: new Date('2026-03-10'),
    };

    expect(node.id).toBe('kn-001');
    expect(node.tier).toBe(1);
    expect(node.confidence).toBe(0.95);
    expect(node.source).toBe('auto-extracted');
    expect(node.scopeGroupId).toBeNull();
    expect(node.domains).toContain('filesystem');
  });

  it('should create a derived_from KnowledgeEdge', () => {
    const edge: KnowledgeEdge = {
      id: 'ke-001',
      sourceId: 'kn-001',
      targetId: 'kn-002',
      relationship: 'derived_from',
      weight: 0.8,
      createdAt: new Date('2026-03-05'),
    };

    expect(edge.id).toBe('ke-001');
    expect(edge.relationship).toBe('derived_from');
    expect(edge.weight).toBe(0.8);
    expect(edge.sourceId).toBe('kn-001');
    expect(edge.targetId).toBe('kn-002');
  });
});

describe('Chat Message Types (3.0)', () => {
  it('should create a user ChatMessage', () => {
    const msg: ChatMessage = {
      id: 'msg-001',
      sessionId: 'sess-1',
      role: 'user',
      content: 'Hello, Claude!',
      messageType: 'text',
      toolCalls: null,
      toolResults: null,
      thinking: null,
      branchId: null,
      parentMessageId: null,
      claudeSessionId: null,
      createdAt: new Date('2026-03-10T12:00:00Z'),
    };

    expect(msg.id).toBe('msg-001');
    expect(msg.role).toBe('user');
    expect(msg.messageType).toBe('text');
    expect(msg.toolCalls).toBeNull();
    expect(msg.branchId).toBeNull();
  });

  it('should create an assistant ChatMessage with tool calls', () => {
    const msg: ChatMessage = {
      id: 'msg-002',
      sessionId: 'sess-1',
      role: 'assistant',
      content: 'Let me read that file for you.',
      messageType: 'tool_use',
      toolCalls: [{ id: 'tc-1', name: 'Read', input: { file_path: '/tmp/test.ts' } }],
      toolResults: [{ toolUseId: 'tc-1', content: 'file contents here' }],
      thinking: 'I should read the file first.',
      branchId: 'branch-main',
      parentMessageId: 'msg-001',
      claudeSessionId: 'claude-sess-abc',
      createdAt: new Date('2026-03-10T12:01:00Z'),
    };

    expect(msg.id).toBe('msg-002');
    expect(msg.role).toBe('assistant');
    expect(msg.messageType).toBe('tool_use');
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0].name).toBe('Read');
    expect(msg.thinking).toBe('I should read the file first.');
    expect(msg.parentMessageId).toBe('msg-001');
  });
});

describe('Claude JSON Streaming Types (3.0)', () => {
  it('should create a message_start ClaudeJsonEvent', () => {
    const event: ClaudeJsonEvent = {
      type: 'message_start',
      message: { id: 'msg-123', role: 'assistant', content: [] },
    };

    expect(event.type).toBe('message_start');
    expect(event.message).toBeDefined();
    expect(event.message.id).toBe('msg-123');
  });

  it('should create a content_block_delta ClaudeJsonEvent', () => {
    const event: ClaudeJsonEvent = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello' },
    };

    expect(event.type).toBe('content_block_delta');
    expect(event.index).toBe(0);
    expect(event.delta.type).toBe('text_delta');
    expect(event.delta.text).toBe('Hello');
  });
});

describe('Session Template Types (3.0)', () => {
  it('should create a SessionTemplate', () => {
    const template: SessionTemplate = {
      id: 'tmpl-001',
      name: 'Node.js Backend',
      workingDir: 'D:\\projects\\backend',
      initialPrompt: 'You are working on a Node.js backend.',
      knowledgeContext: ['kn-001', 'kn-002'],
      groupId: 'grp-1',
      createdAt: new Date('2026-03-01'),
      updatedAt: new Date('2026-03-10'),
    };

    expect(template.id).toBe('tmpl-001');
    expect(template.name).toBe('Node.js Backend');
    expect(template.knowledgeContext).toHaveLength(2);
    expect(template.workingDir).toBe('D:\\projects\\backend');
    expect(template.updatedAt).toBeInstanceOf(Date);
  });
});

describe('Conversation Branching Types (3.0)', () => {
  it('should create a ConversationBranch', () => {
    const branch: ConversationBranch = {
      id: 'branch-001',
      sessionId: 'sess-1',
      parentBranchId: null,
      forkMessageId: 'msg-005',
      name: 'Alternative approach',
      createdAt: new Date('2026-03-10'),
    };

    expect(branch.id).toBe('branch-001');
    expect(branch.sessionId).toBe('sess-1');
    expect(branch.parentBranchId).toBeNull();
    expect(branch.forkMessageId).toBe('msg-005');
    expect(branch.name).toBe('Alternative approach');
  });
});
