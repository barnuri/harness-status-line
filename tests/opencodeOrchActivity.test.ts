import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OpencodeActivityTracker } from '../src/opencode/activityTracker.ts';
import { OrchStateReader } from '../src/opencode/orchStateReader.ts';
import { ActivitySegment } from '../src/shared/activitySegment.ts';
import { BackgroundTaskSegment } from '../src/shared/backgroundTaskSegment.ts';
import { ConfigManager } from '../src/configManager.ts';
import type { OpencodeTuiSlice } from '../src/opencode/types.ts';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-state-test-'));
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

const write = (kind: string, id: string, state: object): void => {
  fs.mkdirSync(path.join(home, kind, id), { recursive: true });
  fs.writeFileSync(path.join(home, kind, id, 'state.json'), JSON.stringify(state));
};
const node = (status: string, session = 'ses-me') => ({ status, session, owner_id: null });
const reader = () => new OrchStateReader(home);
const alivePid = process.pid;
const deadPid = 999999;

beforeAll(() => {
  write('runs', 'r-mine', { status: 'running', title: 'Ship the feature', coordinator: { session_id: 'ses-me' }, nodes: [node('running'), node('running'), node('done'), node('waiting')] });
  write('runs', 'r-other', { status: 'running', coordinator: { session_id: 'ses-other' }, nodes: [node('running', 'ses-other')] });
  write('runs', 'r-finished', { status: 'done', coordinator: { session_id: 'ses-me' }, nodes: [node('running')] });
  write('loops', 'r-mine', { status: 'running', pid: alivePid });
  write('loops', 'stopped', { status: 'stopped', pid: alivePid, run_id: 'r-mine' });
  write('loops', 'dead', { status: 'running', pid: deadPid, run_id: 'r-mine' });
  write('watches', 'w1', { status: 'running', pid: alivePid, run_id: 'r-mine' });
  write('watches', 'w2', { status: 'running', pid: alivePid, run_id: 'r-other' });
});

describe('OrchStateReader.read()', () => {
  it('counts nodes of the session runs and the loops and monitors those runs own', () => {
    expect(reader().read('ses-me')).toEqual({
      running: 2,
      done: 1,
      total: 4,
      loops: 1,
      monitors: 1,
      runTitle: 'Ship the feature',
    });
  });

  it('is null for a session with no running node in its runs', () => {
    expect(reader().read('ses-nobody')).toBeNull();
  });

  it('does not show a run that another session coordinates, even when this session owns one of its nodes', () => {
    write('runs', 'r-foreign', { status: 'running', title: 'Foreign', coordinator: { session_id: 'ses-coord' }, nodes: [node('running', 'ses-coord'), { status: 'running', session: null, owner_id: 'ses-helper' }] });
    expect(reader().read('ses-helper')).toBeNull();
    expect(reader().read('ses-coord')?.runTitle).toBe('Foreign');
  });

  it('falls back to the run id when the run has no title', () => {
    write('runs', 'r-untitled', { status: 'running', coordinator: { session_id: 'ses-untitled' }, nodes: [node('running', 'ses-untitled')] });
    expect(reader().read('ses-untitled')?.runTitle).toBe('r-untitled');
  });

  it('never throws on a missing home or malformed state', () => {
    write('runs', 'bad', 'not json' as unknown as object);
    expect(new OrchStateReader(path.join(home, 'absent')).read('ses-me')).toBeNull();
    expect(reader().read('ses-me')?.running).toBe(2);
  });
});

describe('OpencodeActivityTracker.orch()', () => {
  it('caches the read for 2 s and then rereads', () => {
    let nowMs = 1_000_000;
    const tracker = new OpencodeActivityTracker({} as OpencodeTuiSlice, reader(), () => nowMs);
    expect(tracker.orch('ses-me')?.running).toBe(2);
    write('runs', 'r-mine', { status: 'running', title: 'Ship the feature', coordinator: { session_id: 'ses-me' }, nodes: [node('running')] });
    nowMs += 1000;
    expect(tracker.orch('ses-me')?.running).toBe(2);
    nowMs += 1500;
    expect(tracker.orch('ses-me')?.running).toBe(1);
    write('runs', 'r-mine', { status: 'running', title: 'Ship the feature', coordinator: { session_id: 'ses-me' }, nodes: [node('running'), node('running'), node('running')] });
  });

  it('is null without a session id', () => {
    expect(new OpencodeActivityTracker({} as OpencodeTuiSlice, reader()).orch(undefined)).toBeNull();
  });
});

describe('OpencodeActivityTracker.agents()', () => {
  const sessions: Record<string, string> = { 'root': 'running', 'child-a': 'running', 'child-b': 'idle', 'child-c': 'running' };
  const api = {
    data: {
      session: {
        family: (id: string) => (id === 'root' ? ['child-a', 'child-b', 'child-c', 'root'] : []),
        status: (id: string) => sessions[id],
      },
    },
  } as unknown as OpencodeTuiSlice;

  it('counts the running child sessions, not the session itself or idle children', () => {
    expect(new OpencodeActivityTracker(api, reader()).agents('root')).toBe(2);
  });

  it('is 0 without a session id or when the api throws', () => {
    const broken = { data: { session: { family: () => { throw new Error('boom'); } } } } as unknown as OpencodeTuiSlice;
    expect(new OpencodeActivityTracker(api, reader()).agents(undefined)).toBe(0);
    expect(new OpencodeActivityTracker(broken, reader()).agents('root')).toBe(0);
  });
});

describe('ActivitySegment.buildOrch() and buildRun()', () => {
  const colors = ConfigManager.DEFAULT_CONFIG.colors;
  const work = { running: 3, done: 2, total: 6, loops: 0, monitors: 0, runTitle: null };

  it('shows the node counts with the running colors', () => {
    const seg = new ActivitySegment().buildOrch(work, colors, 0);
    expect(seg.value).toBe('orch: 3 running, 2/6 done');
    expect(seg.fg).toBe(colors.activityRunning.fg);
  });

  it('shows the run title and cuts it to RUN_TITLE_MAX characters', () => {
    expect(new ActivitySegment().buildRun('Ship it', colors).value).toBe('Ship it');
    const long = new ActivitySegment().buildRun('x'.repeat(100), colors).value;
    expect(long.length).toBe(ActivitySegment.RUN_TITLE_MAX);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('BackgroundTaskSegment with loops', () => {
  it('lists loops between agents and monitors, and omits them when unset', () => {
    const segment = new BackgroundTaskSegment();
    expect(segment.build({ commands: 0, agents: 2, monitors: 1, loops: 1 }, ConfigManager.DEFAULT_CONFIG.colors)?.value).toBe('2 agents · 1 loop · 1 monitor');
    expect(segment.build({ commands: 0, agents: 0, monitors: 0, loops: 0 }, ConfigManager.DEFAULT_CONFIG.colors)).toBeNull();
  });
});
