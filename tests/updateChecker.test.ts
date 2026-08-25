import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const STATE_DIR = path.join(os.homedir(), '.cache', 'harness-status-line');
const STATE_FILE = path.join(STATE_DIR, 'last-update.json');

function writeState(state: { lastCheckedAt: number; lastSeenSha: string }): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf-8');
}

function readState(): { lastCheckedAt: number; lastSeenSha: string } | null {
  if (!fs.existsSync(STATE_FILE)) { return null; }
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as { lastCheckedAt: number; lastSeenSha: string };
  } catch {
    return null;
  }
}

function removeStateFile(): void {
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }
}

describe('UpdateChecker — state file', () => {
  afterEach(() => removeStateFile());

  it('isDue returns true when state file does not exist', async () => {
    removeStateFile();
    const { UpdateChecker } = await import('../src/updateChecker.ts');
    const checker = new UpdateChecker();
    expect((checker as unknown as { isDue(): boolean }).isDue()).toBe(true);
  });

  it('isDue returns false when checked less than 1 hour ago', async () => {
    writeState({ lastCheckedAt: Date.now() - 10_000, lastSeenSha: 'abc123' });
    const { UpdateChecker } = await import('../src/updateChecker.ts');
    const checker = new UpdateChecker();
    expect((checker as unknown as { isDue(): boolean }).isDue()).toBe(false);
  });

  it('isDue returns true when last check was more than 1 hour ago', async () => {
    writeState({ lastCheckedAt: Date.now() - 61 * 60 * 1000, lastSeenSha: 'abc123' });
    const { UpdateChecker } = await import('../src/updateChecker.ts');
    const checker = new UpdateChecker();
    expect((checker as unknown as { isDue(): boolean }).isDue()).toBe(true);
  });

  it('saveState writes valid JSON to state file', async () => {
    const { UpdateChecker } = await import('../src/updateChecker.ts');
    const checker = new UpdateChecker();
    const now = Date.now();
    (checker as unknown as { saveState(s: object): void }).saveState({ lastCheckedAt: now, lastSeenSha: 'deadbeef' });
    const saved = readState();
    expect(saved?.lastSeenSha).toBe('deadbeef');
    expect(saved?.lastCheckedAt).toBe(now);
  });

  it('loadState returns null for missing file', async () => {
    removeStateFile();
    const { UpdateChecker } = await import('../src/updateChecker.ts');
    const checker = new UpdateChecker();
    expect((checker as unknown as { loadState(): null }).loadState()).toBeNull();
  });

  it('loadState returns null for corrupted JSON', async () => {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, '{not valid json}', 'utf-8');
    const { UpdateChecker } = await import('../src/updateChecker.ts');
    const checker = new UpdateChecker();
    expect((checker as unknown as { loadState(): null }).loadState()).toBeNull();
  });

  it('loadState returns parsed state for valid file', async () => {
    writeState({ lastCheckedAt: 12345, lastSeenSha: 'sha1' });
    const { UpdateChecker } = await import('../src/updateChecker.ts');
    const checker = new UpdateChecker();
    const state = (checker as unknown as { loadState(): { lastCheckedAt: number; lastSeenSha: string } | null }).loadState();
    expect(state?.lastCheckedAt).toBe(12345);
    expect(state?.lastSeenSha).toBe('sha1');
  });
});

describe('UpdateChecker — checkAndUpdateInBackground', () => {
  beforeEach(() => removeStateFile());
  afterEach(() => removeStateFile());

  it('does not throw when called', async () => {
    const { UpdateChecker } = await import('../src/updateChecker.ts');
    const checker = new UpdateChecker();
    expect(() => checker.checkAndUpdateInBackground()).not.toThrow();
  });

  it('does not call runCheck when isDue is false', async () => {
    writeState({ lastCheckedAt: Date.now() - 1000, lastSeenSha: 'sha1' });
    const { UpdateChecker } = await import('../src/updateChecker.ts');
    const checker = new UpdateChecker();
    let called = false;
    (checker as unknown as { runCheck(): Promise<void> }).runCheck = async () => { called = true; };
    checker.checkAndUpdateInBackground();
    await new Promise(r => setTimeout(r, 10));
    expect(called).toBe(false);
  });

  it('calls runCheck when isDue is true', async () => {
    removeStateFile();
    const { UpdateChecker } = await import('../src/updateChecker.ts');
    const checker = new UpdateChecker();
    let called = false;
    (checker as unknown as { runCheck(): Promise<void> }).runCheck = async () => { called = true; };
    checker.checkAndUpdateInBackground();
    await new Promise(r => setTimeout(r, 10));
    expect(called).toBe(true);
  });
});
