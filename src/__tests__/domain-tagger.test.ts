import { describe, it, expect } from 'vitest';
import { detectDomains } from '../main/knowledge/domain-tagger';

describe('detectDomains', () => {
  it('should detect database domain', () => {
    expect(detectDomains('Fixed SQL query timeout by adding connection pooling')).toContain('database');
  });

  it('should detect auth domain', () => {
    expect(detectDomains('Added OAuth2 authentication flow with JWT tokens')).toContain('auth');
  });

  it('should detect testing domain', () => {
    expect(detectDomains('Write unit tests for the user service using vitest')).toContain('testing');
  });

  it('should detect multiple domains', () => {
    const domains = detectDomains('Fixed authentication bug in database migration');
    expect(domains).toContain('auth');
    expect(domains).toContain('database');
  });

  it('should return general for unrecognized content', () => {
    expect(detectDomains('Something happened')).toEqual(['general']);
  });

  it('should detect frontend domain', () => {
    expect(detectDomains('Updated React component with CSS grid layout')).toContain('frontend');
  });

  it('should detect devops domain', () => {
    expect(detectDomains('Configured Docker container with nginx reverse proxy')).toContain('devops');
  });
});
