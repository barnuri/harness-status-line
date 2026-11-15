import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firstUserPrompt, kebab } from '../src/shared/sessionSlug.ts';

describe('session slug', () => {
  it('kebab-cases a title to at most 6 words', () => {
    expect(kebab('Fix the Herdr resize: grow & shrink panel height now!')).toBe('fix-the-herdr-resize-grow-shrink');
  });
  it('reads the first real user prompt from a transcript', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'slug-')), 't.jsonl');
    writeFileSync(file, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: '<command-name>x</command-name>' } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Add split diff' }] } }),
    ].join('\n'));
    expect(firstUserPrompt(file)).toBe('Add split diff');
  });
});
