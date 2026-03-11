import { describe, it, expect } from 'vitest';

describe('Test framework smoke test', () => {
  it('should run a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('should handle async operations', async () => {
    const result = await Promise.resolve('hello');
    expect(result).toBe('hello');
  });
});
