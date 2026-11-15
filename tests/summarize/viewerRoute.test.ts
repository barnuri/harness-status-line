import { describe, expect, it } from 'bun:test';
import { ViewerRoute, type ViewerRouteHost } from '../../claude-mods/summarize/hooks/viewerRoute.ts';

const NOW = Date.parse('2026-11-15T10:00:00Z');
const FRESH = '2026-11-15T09:59:30Z';
const STALE = '2026-11-15T09:58:00Z';
const SNAPSHOT_FOCUSED = JSON.stringify({ result: { snapshot: { focused_pane_id: 'p1' } } });
const SNAPSHOT_OTHER = JSON.stringify({ result: { snapshot: { focused_pane_id: 'p2' } } });

function route(options: { state?: string | Error; focus?: string; exitCode?: number; env?: Record<string, string>; now?: number }) {
  const env: Record<string, string> = { HERDR_PANE_ID: 'p1', ...options.env };
  const host: ViewerRouteHost = {
    read: async (path: string) => {
      if (path.endsWith('mobile-viewer.json') && options.state instanceof Error) {
        throw options.state;
      }
      return options.state ?? '';
    },
    now: async () => options.now ?? NOW,
    home: async () => '/home/u',
    env: async (name: string) => env[name],
    run: async () => ({ exitCode: options.exitCode ?? 0, stdout: options.focus ?? SNAPSHOT_FOCUSED, stderr: '' }),
  };
  return new ViewerRoute(host);
}

const state = (mobileAttached: number, updatedAt: string) => JSON.stringify({ mobileAttached, updatedAt });

describe('ViewerRoute.isMobilePanelFocused()', () => {
  it('is true for a fresh attached state and a focused pane', async () => {
    expect(await route({ state: state(1, FRESH) }).isMobilePanelFocused()).toBe(true);
  });

  it('is false for a stale state', async () => {
    expect(await route({ state: state(1, STALE) }).isMobilePanelFocused()).toBe(false);
  });

  it('is false for a desktop state with no mobile client', async () => {
    expect(await route({ state: state(0, FRESH) }).isMobilePanelFocused()).toBe(false);
  });

  it('is false when this pane is not focused', async () => {
    expect(await route({ state: state(1, FRESH), focus: SNAPSHOT_OTHER }).isMobilePanelFocused()).toBe(false);
  });

  it('is false for malformed json', async () => {
    expect(await route({ state: '{not json' }).isMobilePanelFocused()).toBe(false);
  });

  it('is false when the state file is missing', async () => {
    expect(await route({ state: new Error('ENOENT') }).isMobilePanelFocused()).toBe(false);
  });

  it('is false when the snapshot command fails', async () => {
    expect(await route({ state: state(1, FRESH), exitCode: 1 }).isMobilePanelFocused()).toBe(false);
  });

  it('reads the state from HERDR_PLUGIN_STATE_DIR when set', async () => {
    const paths: string[] = [];
    const host: ViewerRouteHost = {
      read: async (path: string) => {
        paths.push(path);
        return state(1, FRESH);
      },
      now: async () => NOW,
      home: async () => '/home/u',
      env: async (name: string) => (name === 'HERDR_PLUGIN_STATE_DIR' ? '/state' : 'p1'),
      run: async () => ({ exitCode: 0, stdout: SNAPSHOT_FOCUSED, stderr: '' }),
    };
    expect(await new ViewerRoute(host).isMobilePanelFocused()).toBe(true);
    expect(paths).toEqual(['/state/mobile-viewer.json']);
  });
});
