import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UsageSnapshotReader } from '../src/shared/usageSnapshot.ts';

const NOW_MS = Date.parse('2026-08-04T06:00:00Z');
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

describe('UsageSnapshotReader', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-snapshot-'));
    file = path.join(dir, 'usage-snapshot.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (contents: string): void => {
    fs.writeFileSync(file, contents, 'utf8');
  };

  const snapshotJson = (capturedAt: string): string =>
    JSON.stringify({
      api: { type: 'subscription' },
      rate_limits: {
        five_hour: { used_percentage: 9, resets_at: 1785833400 },
        seven_day: { used_percentage: 80, resets_at: 1785924000 },
      },
      session_id: 'abc-123',
      captured_at: capturedAt,
    });

  describe('missing file', () => {
    it('returns null when the file does not exist', () => {
      const reader = new UsageSnapshotReader(path.join(dir, 'absent.json'));
      expect(reader.read(NOW_MS)).toBeNull();
    });
  });

  describe('unparseable content', () => {
    it('returns null for malformed JSON', () => {
      write('{ this is not json');
      expect(new UsageSnapshotReader(file).read(NOW_MS)).toBeNull();
    });

    it('returns null for an empty file', () => {
      write('');
      expect(new UsageSnapshotReader(file).read(NOW_MS)).toBeNull();
    });

    it('returns null for whitespace only', () => {
      write('   \n  ');
      expect(new UsageSnapshotReader(file).read(NOW_MS)).toBeNull();
    });

    it('returns null when JSON is an array', () => {
      write('[1, 2, 3]');
      expect(new UsageSnapshotReader(file).read(NOW_MS)).toBeNull();
    });

    it('returns null when JSON is a bare literal', () => {
      write('null');
      expect(new UsageSnapshotReader(file).read(NOW_MS)).toBeNull();
    });
  });

  describe('freshness', () => {
    it('returns the snapshot when captured_at is fresh', () => {
      write(snapshotJson('2026-08-04T05:55:00Z'));
      const snapshot = new UsageSnapshotReader(file).read(NOW_MS);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.rate_limits?.['seven_day']?.used_percentage).toBe(80);
      expect(snapshot?.session_id).toBe('abc-123');
    });

    it('returns null when captured_at is older than the max age', () => {
      write(snapshotJson('2026-08-04T05:40:00Z'));
      expect(new UsageSnapshotReader(file).read(NOW_MS)).toBeNull();
    });

    it('treats a snapshot exactly at the max age as fresh', () => {
      const capturedAt = new Date(NOW_MS - FIFTEEN_MINUTES_MS).toISOString();
      write(snapshotJson(capturedAt));
      expect(new UsageSnapshotReader(file).read(NOW_MS)).not.toBeNull();
    });

    it('treats a snapshot one millisecond past the max age as stale', () => {
      const capturedAt = new Date(NOW_MS - FIFTEEN_MINUTES_MS - 1).toISOString();
      write(snapshotJson(capturedAt));
      expect(new UsageSnapshotReader(file).read(NOW_MS)).toBeNull();
    });

    it('accepts a future captured_at rather than treating clock skew as stale', () => {
      write(snapshotJson('2026-08-04T06:05:00Z'));
      expect(new UsageSnapshotReader(file).read(NOW_MS)).not.toBeNull();
    });

    it('honours a custom max age', () => {
      write(snapshotJson('2026-08-04T05:58:00Z'));
      expect(new UsageSnapshotReader(file, 60 * 1000).read(NOW_MS)).toBeNull();
      expect(new UsageSnapshotReader(file, 5 * 60 * 1000).read(NOW_MS)).not.toBeNull();
    });
  });

  describe('mtime fallback', () => {
    it('falls back to file mtime when captured_at is absent', () => {
      write(JSON.stringify({ rate_limits: { five_hour: { used_percentage: 12 } } }));
      const mtimeMs = fs.statSync(file).mtimeMs;

      expect(new UsageSnapshotReader(file).read(mtimeMs)).not.toBeNull();
      expect(new UsageSnapshotReader(file).read(mtimeMs + FIFTEEN_MINUTES_MS + 1)).toBeNull();
    });

    it('falls back to file mtime when captured_at is unparseable', () => {
      write(JSON.stringify({ captured_at: 'not-a-date', rate_limits: {} }));
      const mtimeMs = fs.statSync(file).mtimeMs;

      expect(new UsageSnapshotReader(file).read(mtimeMs)).not.toBeNull();
      expect(new UsageSnapshotReader(file).read(mtimeMs + FIFTEEN_MINUTES_MS + 1)).toBeNull();
    });

    it('falls back to file mtime when captured_at is not a string', () => {
      write(JSON.stringify({ captured_at: 12345, rate_limits: {} }));
      const mtimeMs = fs.statSync(file).mtimeMs;
      expect(new UsageSnapshotReader(file).read(mtimeMs)).not.toBeNull();
    });
  });

  describe('default location', () => {
    it('defaults to ~/.claude/usage-snapshot.json without throwing', () => {
      expect(() => new UsageSnapshotReader().read(NOW_MS)).not.toThrow();
    });
  });
});
