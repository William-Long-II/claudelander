import { describe, it, expect } from 'vitest';
import { extractKnowledgeCandidates, KnowledgeCandidate } from '../main/knowledge/extractor';

describe('extractKnowledgeCandidates', () => {
  it('should extract a decision from conversation', () => {
    const candidates = extractKnowledgeCandidates(
      'Should I use PostgreSQL or MySQL?',
      'I recommend PostgreSQL for this project because it has better JSON support and more advanced indexing.'
    );
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0].content).toContain('PostgreSQL');
    expect(candidates[0].domains).toContain('database');
  });

  it('should extract an error fix', () => {
    const candidates = extractKnowledgeCandidates(
      'I am getting a "connection refused" error',
      'The issue is that the database connection pool was exhausted. I fixed it by increasing the pool size from 5 to 20 in the config.'
    );
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const fix = candidates.find(c => c.content.toLowerCase().includes('pool'));
    expect(fix).toBeDefined();
  });

  it('should extract a pattern from code changes', () => {
    const candidates = extractKnowledgeCandidates(
      'Add error handling to the API endpoints',
      'I wrapped all route handlers in try-catch blocks and added a centralized error handler middleware. This pattern ensures consistent error responses.'
    );
    expect(candidates.length).toBeGreaterThanOrEqual(1);
  });

  it('should return empty for trivial conversations', () => {
    const candidates = extractKnowledgeCandidates(
      'Hello',
      'Hello! How can I help you today?'
    );
    expect(candidates).toHaveLength(0);
  });
});
