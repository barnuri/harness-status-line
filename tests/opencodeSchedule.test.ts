import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OpencodeScheduleReader } from '../src/opencode/scheduleStateReader.ts';
import { ScheduleSegment } from '../src/shared/scheduleSegment.ts';
import { ConfigManager } from '../src/configManager.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-test-'));
const dbPath = path.join(dir, 'opencode.db');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const NOW = 1_000_000_000;
const MIN = 60_000;
const GOAL_PREFIX = 'plugin:006f00700065006e0063006f00640065002e0067006f0061006c:session:';

beforeAll(() => {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE automation (id text PRIMARY KEY, session_id text, name text, trigger text, status text, next_due_at integer, run_count integer, last_outcome text, expires_at integer);
  CREATE TABLE todo (session_id text, content text, status text, priority text, position integer);
  CREATE TABLE kv (key text PRIMARY KEY, value text, time_created integer, time_updated integer);`);
  const goal = (ses: string, value: string) => db.run('INSERT INTO kv VALUES (?,?,?,?)', [GOAL_PREFIX + ses, value, 0, 0]);
  const json = (status: string, objective: string) => JSON.stringify({ id: 'g', objective, status, rounds: 3, maxRounds: 50, reason: 'secret reason' });
  goal('me', json('active', 'Ship the graph wrapper and then a very long tail'));
  goal('paused', json('paused', 'Fix tests'));
  goal('complete', json('complete', 'Done'));
  goal('broken', '{not json');
  const auto = (id: string, ses: string, status: string, due: number | null, outcome: string | null, trigger: string) =>
    db.run('INSERT INTO automation VALUES (?,?,?,?,?,?,?,?,?)', [id, ses, id, trigger, status, due, 0, outcome, null]);
  auto('a', 'me', 'active', NOW + 28 * MIN, null, '{"type":"every","every":"5 minutes"}');
  auto('b', 'me', 'active', NOW + 125 * MIN, 'failed', '{"type":"cron","cron":"0 9 * * *"}');
  auto('c', 'me', 'done', NOW + 1 * MIN, null, '{"type":"at"}');
  auto('d', 'other', 'active', NOW + 1 * MIN, null, '{"type":"at"}');
  auto('o', 'overdue', 'active', NOW - MIN, null, '{"type":"at"}');
  const todo = (ses: string, content: string, status: string, pos: number) =>
    db.run('INSERT INTO todo VALUES (?,?,?,?,?)', [ses, content, status, 'high', pos]);
  todo('me', 'one', 'completed', 0);
  todo('me', 'two', 'completed', 1);
  todo('me', 'Wire graph wrapper and then a very long tail of words', 'in_progress', 2);
  todo('me', 'four', 'pending', 3);
  todo('finished', 'x', 'completed', 0);
  db.close();
});

const colors = new ConfigManager().load().colors;
const reader = (file = dbPath) => new OpencodeScheduleReader(file, () => NOW);
const segment = new ScheduleSegment();

describe('OpencodeScheduleReader', () => {
  it('counts active automations of the session only, with next due and failures', () => {
    const { automations } = reader().read('me');
    expect(automations).toEqual({ count: 2, nextDueMs: NOW + 28 * MIN, failed: 1 });
  });
  it('hides a session with no rows', () => {
    expect(reader().read('nobody')).toEqual(OpencodeScheduleReader.EMPTY);
  });
  it('keeps an overdue due time', () => {
    expect(reader().read('overdue').automations.nextDueMs).toBe(NOW - MIN);
  });
  it('reads goal counts and the item in progress', () => {
    expect(reader().read('me').goals).toEqual({ completed: 2, total: 4, current: 'Wire graph wrapper and then a very long tail of words' });
  });
  it('returns empty when the database is missing', () => {
    expect(reader(path.join(dir, 'missing.db')).read('me')).toEqual(OpencodeScheduleReader.EMPTY);
  });
  it('returns empty when the file is corrupt', () => {
    const bad = path.join(dir, 'bad.db');
    fs.writeFileSync(bad, 'this is not a sqlite database at all, just text');
    expect(reader(bad).read('me')).toEqual(OpencodeScheduleReader.EMPTY);
  });
  it('returns empty when the database is locked', () => {
    const locked = path.join(dir, 'locked.db');
    const db = new Database(locked);
    db.exec('CREATE TABLE automation (id text); CREATE TABLE todo (id text); BEGIN EXCLUSIVE');
    try {
      expect(reader(locked).read('me')).toEqual(OpencodeScheduleReader.EMPTY);
    } finally {
      db.close();
    }
  });
  it('caches for 5 s', () => {
    let t = NOW;
    const r = new OpencodeScheduleReader(dbPath, () => t);
    r.read('me');
    fs.renameSync(dbPath, `${dbPath}.moved`);
    try {
      t += 4000;
      expect(r.read('me').automations.count).toBe(2);
    } finally {
      fs.renameSync(`${dbPath}.moved`, dbPath);
    }
  });
});

describe('ScheduleSegment', () => {
  it('renders scheduled count, next due and a failed chip', () => {
    const out = segment.buildAutomations(reader().read('me').automations, colors, NOW);
    expect(out.map((s) => s.icon + s.value)).toEqual(['⏰ 2 scheduled · next 28m', '1 failed']);
    expect(out[1]?.bg).toEqual(colors.rateWarning.bg);
  });
  it('renders overdue as due and hides at zero or when disabled', () => {
    const overdue = reader().read('overdue').automations;
    expect(segment.buildAutomations(overdue, colors, NOW)[0]?.value).toBe('1 scheduled · next due');
    expect(segment.buildAutomations(reader().read('nobody').automations, colors, NOW)).toEqual([]);
    expect(segment.buildAutomations(reader().read('me').automations, colors, NOW, false)).toEqual([]);
  });
  it('formats short durations', () => {
    expect(ScheduleSegment.until(125 * MIN)).toBe('2h5m');
    expect(ScheduleSegment.until(3 * 86_400_000 + 5 * MIN)).toBe('3d');
  });
  it('renders goals with the current item cut to 30 chars', () => {
    const seg = segment.buildGoals(reader().read('me').goals, colors);
    expect(seg?.icon + (seg?.value ?? '')).toBe('☑ 2/4 · Wire graph wrapper and then a');
    expect(seg?.value.split(' · ')[1]?.length).toBeLessThanOrEqual(30);
  });
  it('hides goals when none, all completed, or disabled', () => {
    expect(segment.buildGoals(reader().read('nobody').goals, colors)).toBeNull();
    expect(segment.buildGoals(reader().read('finished').goals, colors)).toBeNull();
    expect(segment.buildGoals(reader().read('me').goals, colors, false)).toBeNull();
  });
});

describe('session goal', () => {
  it('reads an active and a paused goal of the session only', () => {
    expect(reader().read('me').goal).toEqual({ status: 'active', objective: 'Ship the graph wrapper and then a very long tail', rounds: 3, maxRounds: 50 });
    expect(reader().read('paused').goal?.status).toBe('paused');
    expect(reader().read('nobody').goal).toBeNull();
  });
  it('treats malformed JSON as no goal', () => {
    expect(reader().read('broken').goal).toBeNull();
  });
  it('returns empty when the kv table is missing, keeping the other data', () => {
    const noKv = path.join(dir, 'nokv.db');
    const db = new Database(noKv);
    db.exec('CREATE TABLE automation (id text, session_id text, status text, next_due_at integer, last_outcome text); CREATE TABLE todo (session_id text, content text, status text, position integer);');
    db.close();
    expect(reader(noKv).read('me')).toEqual(OpencodeScheduleReader.EMPTY);
  });
  it('renders active, paused (warning color, no reason) and hides complete or none', () => {
    const active = segment.buildGoal(reader().read('me').goal, colors);
    expect(active?.icon + (active?.value ?? '')).toBe('🎯 goal 3/50 · Ship the graph wrapper and the');
    const paused = segment.buildGoal(reader().read('paused').goal, colors);
    expect(paused?.value).toBe('goal 3/50 · paused · Fix tests');
    expect(paused?.bg).toEqual(colors.rateWarning.bg);
    expect(segment.buildGoal(reader().read('complete').goal, colors)).toBeNull();
    expect(segment.buildGoal(null, colors)).toBeNull();
    expect(segment.buildGoal(reader().read('me').goal, colors, false)).toBeNull();
  });
  it('renders the todo chip as a checkbox', () => {
    const todo = segment.buildGoals(reader().read('me').goals, colors);
    expect(todo?.icon).toBe('☑ ');
  });
});
