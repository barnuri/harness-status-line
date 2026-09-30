import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CopilotEffortReader } from '../src/shared/copilotEffortReader.ts';

describe('CopilotEffortReader', () => {
  const dirs: string[] = [];

  const makeRoot = (sessionId: string, events: readonly unknown[]): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hsl-copilot-state-'));
    dirs.push(root);
    fs.mkdirSync(path.join(root, sessionId));
    fs.writeFileSync(path.join(root, sessionId, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return root;
  };

  const modelChange = (reasoningEffort: string | null): unknown => ({
    type: 'session.model_change',
    data: { source: 'model_picker', newModel: 'claude-opus-5.5', reasoningEffort },
  });

  afterEach(() => {
    for (const dir of dirs.splice(0)) { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('returns the effort from the latest model change', () => {
    const root = makeRoot('s1', [modelChange('low'), modelChange('high')]);
    expect(new CopilotEffortReader(root).readEffort('s1')).toBe('high');
  });

  it('ignores per-call efforts from utility model calls', () => {
    const root = makeRoot('s1', [
      modelChange('xhigh'),
      { type: 'model.model_call_success', data: { reasoningEffort: 'low' } },
    ]);
    expect(new CopilotEffortReader(root).readEffort('s1')).toBe('xhigh');
  });

  it('returns null when the latest model change has no effort', () => {
    const root = makeRoot('s1', [modelChange('high'), modelChange(null)]);
    expect(new CopilotEffortReader(root).readEffort('s1')).toBeNull();
  });

  it('returns null for missing sessions, unsafe ids, and malformed lines', () => {
    const root = makeRoot('s1', []);
    fs.writeFileSync(path.join(root, 's1', 'events.jsonl'), '{"type":"session.model_change", broken\n');
    const reader = new CopilotEffortReader(root);
    expect(reader.readEffort('s1')).toBeNull();
    expect(reader.readEffort('missing')).toBeNull();
    expect(reader.readEffort('../s1')).toBeNull();
    expect(reader.readEffort(undefined)).toBeNull();
  });
});
