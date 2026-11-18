import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OpencodeJobReader } from '../src/opencode/jobStateReader.ts';
import { JobSegment } from '../src/shared/jobSegment.ts';
import { ConfigManager } from '../src/configManager.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobs-test-'));
const dbPath = path.join(dir, 'opencode.db');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const NOW = 1_000_000_000;

beforeAll(() => {
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE job (notification_id text PRIMARY KEY, id text, session_id text, child_session_id text, kind text, title text, status text, time_created integer, time_updated integer);
  CREATE TABLE session_v2 (id text PRIMARY KEY, parent_id text, slug text, title text, time_busy integer, time_idle integer, time_archived integer);`);
  const job = (n: string, ses: string, kind: string, title: string, status: string, t: number) =>
    db.run('INSERT INTO job VALUES (?,?,?,?,?,?,?,?,?)', [n, n, ses, null, kind, title, status, t, t]);
  job('a', 'me', 'shell', 'sleep 600 && echo this-is-a-very-long-command', 'running', NOW - 125_000);
  job('b', 'me', 'shell', 'tail -f x', 'running', NOW - 5_000);
  job('c', 'me', 'shell', 'done one', 'completed', NOW - 9_000);
  job('d', 'other', 'shell', 'other session', 'running', NOW - 9_000);
  job('e', 'kid', 'shell', 'child cmd', 'running', NOW - 1_000);
  const ses = (id: string, parent: string | null, title: string, busy: number | null, idle: number | null) =>
    db.run('INSERT INTO session_v2 (id,parent_id,slug,title,time_busy,time_idle) VALUES (?,?,?,?,?,?)', [id, parent, id, title, busy, idle]);
  ses('me', null, 'main', NOW - 999_000, null);
  ses('kid', 'me', 'Explore the repo', NOW - 70_000, NOW - 80_000);
  ses('kid-done', 'me', 'Finished agent', NOW - 90_000, NOW - 50_000);
  ses('grandkid', 'kid', 'Nested agent', NOW - 3_000, null);
  ses('stranger', 'other', 'Not mine', NOW - 3_000, null);
  db.close();
});

const colors = new ConfigManager().load().colors;
const reader = () => new OpencodeJobReader(dbPath, () => NOW);

describe('OpencodeJobReader', () => {
  it('counts running shell jobs of the session and its children, oldest first', () => {
    const work = reader().read('me');
    expect(work.bgCount).toBe(3);
    expect(work.bgOldest?.text).toContain('sleep 600');
  });
  it('counts busy descendants only, first by start time', () => {
    const work = reader().read('me');
    expect(work.subCount).toBe(2);
    expect(work.subFirst?.text).toBe('Explore the repo');
  });
  it('returns zero for a session with nothing', () => {
    const work = reader().read('stranger-less');
    expect([work.bgCount, work.subCount]).toEqual([0, 0]);
  });
  it('never throws and returns zero when the database is missing', () => {
    const work = new OpencodeJobReader(path.join(dir, 'missing.db'), () => NOW).read('me');
    expect(work.bgCount + work.subCount).toBe(0);
  });
  it('caches for 2 s', () => {
    let t = NOW;
    const r = new OpencodeJobReader(dbPath, () => t);
    r.read('me');
    fs.renameSync(dbPath, `${dbPath}.moved`);
    try {
      t += 1500;
      expect(r.read('me').bgCount).toBe(3);
      t += 1000;
      expect(r.read('me').bgCount).toBe(3); // refresh fails: last good value stays
    } finally {
      fs.renameSync(`${dbPath}.moved`, dbPath);
    }
  });
  it('does not write to the database', () => {
    const before = fs.statSync(dbPath).mtimeMs;
    reader().read('me');
    expect(fs.statSync(dbPath).mtimeMs).toBe(before);
  });
  it('runs under 50 ms', () => {
    const start = performance.now();
    new OpencodeJobReader(dbPath, () => NOW).read('me');
    expect(performance.now() - start).toBeLessThan(50);
  });
});

describe('JobSegment', () => {
  const seg = new JobSegment();
  it('shows bg and sub with 24-char text and age', () => {
    const out = seg.build(reader().read('me'), colors, NOW);
    expect(out.map((s) => s.value)).toEqual(['bg 3 sleep 600 && echo this-i 2m', 'sub 2 Explore the repo 1m']);
  });
  it('shows nothing when counts are 0', () => {
    expect(seg.build({ bgCount: 0, bgOldest: null, subCount: 0, subFirst: null }, colors, NOW)).toEqual([]);
  });
  it('formats ages', () => {
    expect([5_000, 125_000, 3_900_000, 90_000_000].map(JobSegment.age)).toEqual(['5s', '2m', '1h5m', '1d']);
  });
});
