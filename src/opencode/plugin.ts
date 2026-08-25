import type { JSX } from '@opentui/solid/jsx-runtime';
import { ConfigManager } from '../configManager.ts';
import { StatusParser } from '../statusParser.ts';
import { UsageSnapshotReader } from '../shared/usageSnapshot.ts';
import { OpencodeStateReader } from './opencodeStateReader.ts';
import { OpencodeStatusRenderer } from './opencodeStatusRenderer.ts';
import { OpencodeStatusSource } from './statusSource.ts';
import type { Segment } from '../types.ts';
import type { OpencodeTuiSlice } from './types.ts';

type SlotRegisteringApi = { slots: { register: (plugin: unknown) => string } } & OpencodeTuiSlice;

/**
 * opencode TUI plugin entry.
 *
 * Loading contract (all four are required — violating any one fails silently):
 *   1. this file must stay `.ts` — opencode's loader ignores `.tsx`, and importing a `.tsx` from
 *      here stops the module from being evaluated at all;
 *   2. it must be listed in `~/.config/opencode/tui.json` under `plugin` (NOT opencode.jsonc's
 *      `plugin` array — that is the server loader, which calls `tui` with a server PluginInput);
 *   3. the default export must be `{ id, tui }` — both fields, or the host never invokes it;
 *   4. nodes are built with `jsx()` calls, never JSX syntax, which follows from (1).
 */
class OpencodeStatusLinePlugin {
  private static readonly SLOT = 'app_bottom';

  /**
   * Building segments costs a config file read, a snapshot file read, and — via the shared
   * parser's git branch lookup — a synchronous `git` subprocess. The slot re-renders on any
   * tracked TUI state change, so recomputing per render would block the render loop. None of
   * these inputs change meaningfully within a second.
   */
  private static readonly CACHE_TTL_MS = 1_000;

  private readonly stateReader = new OpencodeStateReader();
  private readonly snapshotReader = new UsageSnapshotReader();
  private readonly statusSource = new OpencodeStatusSource();
  private readonly parser = new StatusParser();
  private readonly renderer = new OpencodeStatusRenderer();
  private readonly configManager = new ConfigManager();

  private cachedSegments: Segment[] | null = null;
  private cachedAtMs = 0;

  register(api: SlotRegisteringApi): void {
    api.slots.register({
      slots: {
        [OpencodeStatusLinePlugin.SLOT]: () => this.renderSafely(api),
      },
    });
  }

  private renderSafely(api: OpencodeTuiSlice): JSX.Element | null {
    try {
      return this.renderer.render(this.segments(api, Date.now()));
    } catch {
      return null;
    }
  }

  private segments(api: OpencodeTuiSlice, nowMs: number): Segment[] {
    const cached = this.cachedSegments;
    if (cached && nowMs - this.cachedAtMs < OpencodeStatusLinePlugin.CACHE_TTL_MS) {
      return cached;
    }

    const status = this.statusSource.build(this.stateReader.read(api), this.snapshotReader.read(nowMs));
    const segments = this.parser.buildSegments(status, this.configManager.load());

    this.cachedSegments = segments;
    this.cachedAtMs = nowMs;
    return segments;
  }
}

const tui = async (api: SlotRegisteringApi): Promise<void> => {
  try {
    new OpencodeStatusLinePlugin().register(api);
  } catch {
    /* never throw into the TUI — a broken status line must not take opencode down */
  }
};

export default { id: 'harness-status-line', tui };
