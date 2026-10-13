import { describe, expect, it } from 'bun:test';
import { ClaudeCredentialReader } from '../src/shared/claudeCredentialReader.ts';

describe('ClaudeCredentialReader', () => {
  it('extracts the OAuth access token from Claude credentials', () => {
    const reader = new ClaudeCredentialReader();
    const extract = (reader as unknown as { extractToken(raw: string): string | null }).extractToken.bind(reader);
    expect(extract(JSON.stringify({ claudeAiOauth: { accessToken: 'test-token' } }))).toBe('test-token');
  });

  it('rejects malformed credentials and missing tokens', () => {
    const reader = new ClaudeCredentialReader();
    const extract = (reader as unknown as { extractToken(raw: string): string | null }).extractToken.bind(reader);
    expect(extract('{invalid')).toBeNull();
    expect(extract(JSON.stringify({ claudeAiOauth: {} }))).toBeNull();
    expect(extract(JSON.stringify({ claudeAiOauth: { accessToken: 42 } }))).toBeNull();
  });
});
