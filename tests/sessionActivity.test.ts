import { afterAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionActivityReader } from '../src/shared/sessionActivityReader.ts';
import { ActivitySegment } from '../src/shared/activitySegment.ts';
import { OpencodeActivityTracker } from '../src/opencode/activityTracker.ts';
import { StatusParser } from '../src/statusParser.ts';
import { ConfigManager } from '../src/configManager.ts';
import type { ActivityState } from '../src/types.ts';
import type { OpencodeDataEvent, OpencodeMessage, OpencodeTuiSlice } from '../src/opencode/types.ts';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-test-'));
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const writeState = (sessionId: string, state: string): void => {
  fs.writeFileSync(path.join(tmpDir, sessionId), JSON.stringify({ state, updated_at: 1 }));
};
const writeTranscript = (name: string, lines: ReadonlyArray<string>): string => {
  const file = path.join(tmpDir, `${name}.jsonl`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
};

const reader = new SessionActivityReader(tmpDir);
const colors = ConfigManager.DEFAULT_CONFIG.colors;

describe('SessionActivityReader.read()', () => {
  it('returns null without a session id, for a path-like id, or without a state file', () => {
    expect(reader.read(undefined)).toBeNull();
    expect(reader.read('../etc')).toBeNull();
    expect(reader.read('missing')).toBeNull();
  });

  it('returns each known state as written', () => {
    for (const state of SessionActivityReader.STATES) {
      writeState(`s-${state}`, state);
      expect(reader.read(`s-${state}`)).toBe(state);
    }
  });

  it('returns null for an unknown state or malformed file', () => {
    writeState('s-unknown', 'dancing');
    expect(reader.read('s-unknown')).toBeNull();
    fs.writeFileSync(path.join(tmpDir, 's-bad'), '{not json');
    expect(reader.read('s-bad')).toBeNull();
  });

  it('reads running as interrupted when the transcript ends in the Esc marker', () => {
    writeState('s-esc', 'running');
    const transcript = writeTranscript('esc', ['{"type":"assistant"}', '{"type":"user","content":"[Request interrupted by user for tool use]"}']);
    expect(reader.read('s-esc', transcript)).toBe('interrupted');
  });

  it('keeps running when the marker is not the last transcript entry, or the transcript is missing', () => {
    writeState('s-run', 'running');
    const transcript = writeTranscript('run', ['{"content":"[Request interrupted by user]"}', '{"type":"user","content":"go on"}']);
    expect(reader.read('s-run', transcript)).toBe('running');
    expect(reader.read('s-run', path.join(tmpDir, 'nope.jsonl'))).toBe('running');
  });

  it('does not turn a non-running state into interrupted', () => {
    writeState('s-idle-esc', 'idle');
    const transcript = writeTranscript('idle-esc', ['[Request interrupted by user]']);
    expect(reader.read('s-idle-esc', transcript)).toBe('idle');
  });
});

describe('ActivitySegment.build()', () => {
  const segment = new ActivitySegment();

  it('shows a spinner frame that advances with time for running and compacting', () => {
    const first = segment.build('running', colors, 0);
    const next = segment.build('running', colors, ActivitySegment.FRAME_MS);
    expect(first.icon).toBe(`${ActivitySegment.SPINNER_FRAMES[0]} `);
    expect(next.icon).toBe(`${ActivitySegment.SPINNER_FRAMES[1]} `);
    expect(segment.build('compacting', colors, 0).value).toBe('compacting');
    expect(first.bg).toEqual(colors.activityRunning.bg);
  });

  it('shows a different frame on consecutive 2 s Claude refreshes', () => {
    expect(segment.build('running', colors, 0).icon).not.toBe(segment.build('running', colors, 2000).icon);
  });

  it('shows a fixed icon, word and colour for every other state', () => {
    const cases: ReadonlyArray<[ActivityState, string, string, keyof typeof colors]> = [
      ['permission', '⏸ ', 'approve', 'activityWaiting'],
      ['question', '❓ ', 'question', 'activityWaiting'],
      ['idle', '✓ ', 'ready', 'activityIdle'],
      ['error', '✗ ', 'error', 'activityError'],
      ['interrupted', '⏹ ', 'interrupted', 'activityStopped'],
    ];
    for (const [state, icon, value, colorKey] of cases) {
      const built = segment.build(state, colors, 0);
      expect(built).toEqual({ icon, label: '', value, fg: colors[colorKey].fg, bg: colors[colorKey].bg });
      expect(ActivitySegment.isAnimated(state)).toBe(false);
    }
  });
});

describe('StatusParser activity segment', () => {
  it('puts the activity segment first, before the folder', () => {
    writeState('s-first', 'running');
    const parser = new StatusParser(undefined, undefined, reader);
    const segments = parser.buildSegments({ session_id: 's-first', cwd: '/repo/project' }, ConfigManager.DEFAULT_CONFIG);
    expect(segments[0]?.value).toBe('running');
    expect(segments[1]?.icon).toBe('📁 ');
  });

  it('prefers the payload activity over the state file', () => {
    writeState('s-payload', 'running');
    const parser = new StatusParser(undefined, undefined, reader);
    const segments = parser.buildSegments({ session_id: 's-payload', activity: 'error' }, ConfigManager.DEFAULT_CONFIG);
    expect(segments[0]?.value).toBe('error');
  });

  it('omits the segment without a state, or when hidden in config', () => {
    const parser = new StatusParser(undefined, undefined, reader);
    expect(parser.buildSegments({ session_id: 'missing', cwd: '/x' }, ConfigManager.DEFAULT_CONFIG)[0]?.icon).toBe('📁 ');
    writeState('s-hidden', 'idle');
    const config = { ...ConfigManager.DEFAULT_CONFIG, segments: { ...ConfigManager.DEFAULT_CONFIG.segments, activity: false } };
    expect(parser.buildSegments({ session_id: 's-hidden', cwd: '/x' }, config)[0]?.icon).toBe('📁 ');
  });
});

describe('OpencodeActivityTracker.current()', () => {
  interface Fake {
    status?: string;
    permissions?: Record<string, ReadonlyArray<unknown>>;
    forms?: Record<string, ReadonlyArray<unknown>>;
    family?: ReadonlyArray<string>;
    messages?: ReadonlyArray<OpencodeMessage>;
  }
  let emit: (event: OpencodeDataEvent) => void = () => {};
  const api = (fake: Fake): OpencodeTuiSlice => ({
    data: {
      session: {
        status: () => fake.status,
        family: () => fake.family ?? [],
        permission: { list: (id) => fake.permissions?.[id] ?? [] },
        form: { list: (id) => fake.forms?.[id] ?? [] },
        message: { list: () => fake.messages ?? [] },
      },
      listen: (handler) => {
        emit = handler;
        return () => {};
      },
    },
    ui: { router: { current: () => ({ type: 'session', sessionID: 'ses-1' }) } },
  });
  const tracker = (fake: Fake): OpencodeActivityTracker => {
    const created = new OpencodeActivityTracker(api(fake));
    created.start();
    return created;
  };
  const outcome = (type: string, sessionID = 'ses-1'): void => emit({ details: { type, data: { sessionID } } });

  it('returns null without a session and idle for a quiet session', () => {
    expect(tracker({}).current(undefined)).toBeNull();
    expect(tracker({}).current('ses-1')).toBe('idle');
  });

  it('returns running while the session status is running', () => {
    expect(tracker({ status: 'running' }).current('ses-1')).toBe('running');
  });

  it('ranks an open permission (own or a subagent) over a question over running', () => {
    expect(tracker({ status: 'running', permissions: { 'ses-child': [{}] }, family: ['ses-child'], forms: { 'ses-1': [{}] } }).current('ses-1')).toBe('permission');
    expect(tracker({ status: 'running', forms: { 'ses-1': [{}] } }).current('ses-1')).toBe('question');
  });

  it('returns compacting while the last message is a running compaction', () => {
    expect(tracker({ status: 'running', messages: [{ type: 'compaction', status: 'running' }] }).current('ses-1')).toBe('compacting');
    expect(tracker({ messages: [{ type: 'compaction', status: 'completed' }] }).current('ses-1')).toBe('idle');
  });

  it('remembers how the last turn ended until the next turn starts', () => {
    const live = tracker({});
    outcome('session.execution.failed');
    expect(live.current('ses-1')).toBe('error');
    outcome('session.execution.interrupted');
    expect(live.current('ses-1')).toBe('interrupted');
    outcome('session.execution.failed', 'ses-other');
    expect(live.current('ses-1')).toBe('interrupted');
    outcome('session.execution.started');
    expect(live.current('ses-1')).toBe('idle');
    outcome('session.execution.succeeded');
    expect(live.current('ses-1')).toBe('idle');
  });

  it('ignores malformed events and survives throwing getters', () => {
    const live = tracker({});
    emit({});
    emit({ details: { type: 'session.execution.failed', data: null } });
    expect(live.current('ses-1')).toBe('idle');
    const broken = new OpencodeActivityTracker({ data: { session: { status: () => { throw new Error('boom'); } } } });
    expect(broken.current('ses-1')).toBe('idle');
    expect(broken.start()).toBeInstanceOf(Function);
  });

  it('reads the session id from the route', () => {
    expect(tracker({}).routeSessionId()).toBe('ses-1');
  });
});
