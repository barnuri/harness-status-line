import { afterAll, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OpencodeActivityTracker } from '../src/opencode/activityTracker.ts';
import { ActivitySegment } from '../src/shared/activitySegment.ts';
import { ConfigManager } from '../src/configManager.ts';
import type { OpencodeTuiSlice } from '../src/opencode/types.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-activity-test-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const write = (id: string, body: object | string): void =>
  fs.writeFileSync(path.join(dir, `${id}.json`), typeof body === 'string' ? body : JSON.stringify(body));
const tracker = (now: () => number) => new OpencodeActivityTracker({} as OpencodeTuiSlice, dir, now);

describe('OpencodeActivityTracker.orchSummary()', () => {
  it('returns the summary of an active, fresh file', () => {
    write('a', { active: true, updated_at: 1000, summary: 'orch: 3 running' });
    expect(tracker(() => 1_050_000).orchSummary('a')).toBe('orch: 3 running');
  });

  it('is null when inactive, stale, missing, malformed, or the id is unsafe', () => {
    write('off', { active: false, updated_at: 1000, summary: 'x' });
    write('old', { active: true, updated_at: 1000, summary: 'x' });
    write('bad', '{nope');
    const t = tracker(() => 1_200_000);
    expect(t.orchSummary('off')).toBeNull();
    expect(t.orchSummary('old')).toBeNull();
    expect(t.orchSummary('missing')).toBeNull();
    expect(t.orchSummary('bad')).toBeNull();
    expect(t.orchSummary('../x')).toBeNull();
    expect(t.orchSummary(undefined)).toBeNull();
  });

  it('caches for 2 s and then rereads', () => {
    write('c', { active: true, updated_at: 1000, summary: 'one' });
    let nowMs = 1_010_000;
    const t = tracker(() => nowMs);
    expect(t.orchSummary('c')).toBe('one');
    write('c', { active: true, updated_at: 1000, summary: 'two' });
    nowMs += 1000;
    expect(t.orchSummary('c')).toBe('one');
    nowMs += 1500;
    expect(t.orchSummary('c')).toBe('two');
  });
});

describe('ActivitySegment.buildOrch()', () => {
  const colors = ConfigManager.DEFAULT_CONFIG.colors;
  it('uses the running colors and prefixes orch once', () => {
    const seg = new ActivitySegment().buildOrch('3 agents', colors, 0);
    expect(seg.value).toBe('orch: 3 agents');
    expect(seg.fg).toBe(colors.activityRunning.fg);
    expect(new ActivitySegment().buildOrch('orch: 3 running', colors, 0).value).toBe('orch: 3 running');
  });
});
