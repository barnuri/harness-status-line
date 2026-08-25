import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CursorAccessTokenReader } from '../src/shared/cursorAccessTokenReader.ts';
import { CursorUsageClient } from '../src/shared/cursorUsageClient.ts';
import { CursorUsageStore } from '../src/shared/cursorUsageStore.ts';

describe('CursorUsageClient', () => {
  const dirs: string[] = [];

  afterEach(() => {
    delete process.env['CURSOR_SESSION_TOKEN'];
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('writes request-pool credits when period usage has no quota fields', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsl-cursor-client-'));
    dirs.push(dir);
    process.env['CURSOR_SESSION_TOKEN'] = 'test-token';
    const store = new CursorUsageStore(path.join(dir, 'cursor-usage.json'));
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('GetCurrentPeriodUsage')) {
        return new Response(JSON.stringify({
          billingCycleStart: '1',
          billingCycleEnd: '1',
          displayThreshold: 100,
        }), { status: 200 });
      }
      if (url.includes('/auth/usage')) {
        return new Response(JSON.stringify({
          'gpt-4': { numRequests: 200, maxRequestUsage: 1000 },
          startOfMonth: '2026-08-01T00:00:00.000Z',
        }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const client = new CursorUsageClient(
      new CursorAccessTokenReader(path.join(dir, 'missing.vscdb')),
      store,
      fetchImpl,
    );
    client.refreshInBackground(Date.now());
    await waitFor(() => store.read()?.credits?.used === 200);
    expect(store.read()?.credits).toMatchObject({
      unit: 'requests',
      used: 200,
      limit: 1000,
      remaining: 800,
    });
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number = 1000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for usage cache');
    }
    await Bun.sleep(10);
  }
}
