import { afterAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BackgroundTaskReader } from '../src/shared/backgroundTaskReader.ts';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'background-test-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const T0 = Date.parse('2026-10-25T10:00:00.000Z');
const line = (row: unknown): string => JSON.stringify(row);
const bashStart = (id: string): string =>
  line({
    type: 'user',
    timestamp: '2026-10-25T10:00:00.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'Command running in background with ID: bx1. Output is being written to: /tmp/x' }] }] },
  });
const agentStart = (id: string): string =>
  line({
    type: 'user',
    timestamp: '2026-10-25T10:00:00.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'Async agent launched successfully. agentId: a1' }] }] },
  });
// Some transcripts store the result as a serialized array string.
const agentStartSerialized = (id: string): string =>
  line({
    type: 'user',
    timestamp: '2026-10-25T10:00:00.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '[{"type": "text", "text": "Async agent launched successfully."}]' }] },
  });
const monitorStart = (id: string, expires: string): string =>
  line({
    type: 'user',
    timestamp: '2026-10-25T10:00:00.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: `Monitor started (task m1, expires in ${expires} unless the source ends first)` }] }] },
  });
const queueNotice = (id: string, status: string | null): string =>
  line({
    type: 'queue-operation',
    operation: 'enqueue',
    content: `<task-notification>\n<task-id>t1</task-id>\n<tool-use-id>${id}</tool-use-id>${status === null ? '' : `\n<status>${status}</status>`}\n</task-notification>`,
  });
const userNotice = (id: string, status: string): string =>
  line({
    type: 'user',
    message: { role: 'user', content: `<task-notification>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n</task-notification>` },
  });

const writeTranscript = (name: string, lines: ReadonlyArray<string>): string => {
  const file = path.join(tmpDir, `${name}.jsonl`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
};

describe('BackgroundTaskReader.read()', () => {
  it('returns no counts without a session id, a path-like id, or a transcript', () => {
    const reader = new BackgroundTaskReader(path.join(tmpDir, 'cache-a'));
    expect(reader.read(undefined, undefined)).toEqual(BackgroundTaskReader.NONE);
    expect(reader.read('a/b', '/nope')).toEqual(BackgroundTaskReader.NONE);
    expect(reader.read('missing', path.join(tmpDir, 'missing.jsonl'))).toEqual(BackgroundTaskReader.NONE);
  });

  it('counts a started command until its status notice arrives', () => {
    const reader = new BackgroundTaskReader(path.join(tmpDir, 'cache-b'));
    const file = writeTranscript('cmd', [bashStart('toolu_cmd1')]);
    expect(reader.read('cmd', file, T0)).toEqual({ commands: 1, agents: 0, monitors: 0 });

    fs.appendFileSync(file, queueNotice('toolu_cmd1', 'completed') + '\n');
    expect(reader.read('cmd', file, T0)).toEqual({ commands: 0, agents: 0, monitors: 0 });
  });

  it('closes an agent on a user-message notice with a plain-string content', () => {
    const reader = new BackgroundTaskReader(path.join(tmpDir, 'cache-c'));
    const file = writeTranscript('agent', [agentStart('toolu_ag1')]);
    expect(reader.read('agent', file, T0).agents).toBe(1);

    fs.appendFileSync(file, userNotice('toolu_ag1', 'completed') + '\n');
    expect(reader.read('agent', file, T0).agents).toBe(0);
  });

  it('recognises an agent start stored as a serialized array string', () => {
    const reader = new BackgroundTaskReader(path.join(tmpDir, 'cache-d'));
    const file = writeTranscript('agent-serialized', [agentStartSerialized('toolu_ag2')]);
    expect(reader.read('agent-serialized', file, T0).agents).toBe(1);
  });

  it('keeps a monitor open on event notices and closes it on a status notice', () => {
    const reader = new BackgroundTaskReader(path.join(tmpDir, 'cache-e'));
    const file = writeTranscript('mon', [monitorStart('toolu_m1', '10m')]);
    fs.appendFileSync(file, queueNotice('toolu_m1', null) + '\n');
    expect(reader.read('mon', file, T0).monitors).toBe(1);

    fs.appendFileSync(file, queueNotice('toolu_m1', 'stopped') + '\n');
    expect(reader.read('mon', file, T0).monitors).toBe(0);
  });

  it('drops a monitor once its stated expiry has passed', () => {
    const reader = new BackgroundTaskReader(path.join(tmpDir, 'cache-f'));
    const file = writeTranscript('mon-expiry', [monitorStart('toolu_m2', '6m 40s')]);
    expect(reader.read('mon-expiry', file, T0 + 6 * 60 * 1000).monitors).toBe(1);
    expect(reader.read('mon-expiry', file, T0 + 7 * 60 * 1000).monitors).toBe(0);
  });

  it('ignores a partial last line until it is complete', () => {
    const reader = new BackgroundTaskReader(path.join(tmpDir, 'cache-g'));
    const file = path.join(tmpDir, 'partial.jsonl');
    const full = bashStart('toolu_p1');
    fs.writeFileSync(file, full.slice(0, 40));
    expect(reader.read('partial', file, T0).commands).toBe(0);

    fs.writeFileSync(file, full + '\n');
    expect(reader.read('partial', file, T0).commands).toBe(1);
  });

  it('resets and re-reads when the transcript shrinks', () => {
    const reader = new BackgroundTaskReader(path.join(tmpDir, 'cache-h'));
    const file = writeTranscript('shrink', [bashStart('toolu_s1'), agentStart('toolu_s2')]);
    expect(reader.read('shrink', file, T0)).toEqual({ commands: 1, agents: 1, monitors: 0 });

    fs.writeFileSync(file, bashStart('toolu_s3') + '\n');
    expect(reader.read('shrink', file, T0)).toEqual({ commands: 1, agents: 0, monitors: 0 });
  });

  it('restores open items from the cache in a new reader instance', () => {
    const cacheDir = path.join(tmpDir, 'cache-i');
    const file = writeTranscript('roundtrip', [bashStart('toolu_r1')]);
    expect(new BackgroundTaskReader(cacheDir).read('roundtrip', file, T0).commands).toBe(1);

    // A new instance reads only the new line and still knows the first command.
    fs.appendFileSync(file, agentStart('toolu_r2') + '\n');
    expect(new BackgroundTaskReader(cacheDir).read('roundtrip', file, T0)).toEqual({ commands: 1, agents: 1, monitors: 0 });
  });
});
