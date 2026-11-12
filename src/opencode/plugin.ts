import { jsx } from '@opentui/solid/jsx-runtime';
import type { JSX } from '@opentui/solid/jsx-runtime';
import { ConfigManager } from '../configManager.ts';
import { StatusParser } from '../statusParser.ts';
import { UsageSnapshotReader } from '../shared/usageSnapshot.ts';
import { OpencodeHubEnricher } from './hubEnricher.ts';
import { OpencodeStateReader } from './opencodeStateReader.ts';
import { OpencodeStatusRenderer } from './opencodeStatusRenderer.ts';
import { OpencodeStatusSource } from './statusSource.ts';
import type { Segment } from '../types.ts';
import type { OpencodeTuiSlice } from './types.ts';

interface SlotClaim {
  readonly append: string;
  readonly render: (input: { readonly sessionID?: string }) => JSX.Element;
}

type RevisionStore = readonly [{ readonly revision: number }, (mutation: (draft: { revision: number }) => void) => void];

type PluginContext = OpencodeTuiSlice & {
  readonly ui: { readonly slot: (claim: SlotClaim) => () => void };
  readonly storage: { memory(key: string, options: { readonly initial: { revision: number } }): RevisionStore };
};

/**
 * opencode 2 TUI plugin, listed in `~/.config/opencode/cli.json` under `plugins`. The file stays
 * `.ts` and builds nodes with `jsx()` calls. The line sits under the prompt footer.
 */
class OpencodeStatusLinePlugin {
  private static readonly ANCHOR = 'app';
  /** Segments cost file reads, a `git` subprocess and, on llm-hub, HTTP calls: rebuild at most once a second. */
  private static readonly REBUILD_INTERVAL_MS = 1_000;

  private readonly stateReader = new OpencodeStateReader();
  private readonly snapshotReader = new UsageSnapshotReader();
  private readonly statusSource = new OpencodeStatusSource();
  private readonly parser = new StatusParser();
  private readonly renderer = new OpencodeStatusRenderer();
  private readonly configManager = new ConfigManager();
  private readonly hubEnricher = new OpencodeHubEnricher();
  private readonly revision: RevisionStore;

  private segments: Segment[] = [];
  private builtAtMs = 0;
  private builtInputKey = '';
  private hubRefreshing = false;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  // The host's store is the reactive source: a signal from this repo's own solid-js copy is not tracked by the host.
  constructor(private readonly context: PluginContext) {
    this.revision = context.storage.memory('harness-status-line', { initial: { revision: 0 } });
  }

  register(): () => void {
    const release = this.context.ui.slot({
      append: OpencodeStatusLinePlugin.ANCHOR,
      render: (input) => {
        const plugin = this;
        return jsx('box', {
          style: { width: '100%' },
          get children() {
            return plugin.renderSafely(input.sessionID);
          },
        });
      },
    });
    return () => {
      clearTimeout(this.refreshTimer);
      release();
    };
  }

  private renderSafely(sessionId: string | undefined): JSX.Element | null {
    try {
      return this.renderer.render(this.currentSegments(sessionId));
    } catch {
      return null;
    }
  }

  // Reads the reactive opencode state on every call, so the line follows new messages and model switches.
  private currentSegments(sessionId: string | undefined): Segment[] {
    void this.revision[0].revision;
    const input = this.stateReader.read(this.context, sessionId);
    const inputKey = JSON.stringify(input);
    const nowMs = Date.now();
    const sinceBuildMs = nowMs - this.builtAtMs;
    if (sinceBuildMs < OpencodeStatusLinePlugin.REBUILD_INTERVAL_MS) {
      if (inputKey !== this.builtInputKey) {
        this.scheduleRebuild(OpencodeStatusLinePlugin.REBUILD_INTERVAL_MS - sinceBuildMs);
      }
      return this.segments;
    }
    this.builtAtMs = nowMs;
    this.builtInputKey = inputKey;
    const base = this.statusSource.build(input, this.snapshotReader.read(nowMs));
    const config = this.configManager.load();
    if (!this.hubEnricher.applies(input)) {
      this.segments = this.parser.buildSegments(base, config);
      return this.segments;
    }
    if (this.segments.length === 0) {
      this.segments = this.parser.buildSegments(base, config);
    }
    if (!this.hubRefreshing) {
      this.hubRefreshing = true;
      void this.hubEnricher
        .apply(input, base)
        .then((status) => {
          this.segments = this.parser.buildSegments(status, config);
        })
        .catch(() => undefined)
        .finally(() => {
          this.hubRefreshing = false;
          this.bumpRevision();
        });
    }
    return this.segments;
  }

  private scheduleRebuild(delayMs: number): void {
    if (this.refreshTimer !== undefined) {
      return;
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      this.bumpRevision();
    }, delayMs);
  }

  private bumpRevision(): void {
    this.revision[1]((draft) => {
      draft.revision += 1;
    });
  }
}

export default {
  id: 'harness-status-line',
  setup(context: PluginContext): (() => void) | undefined {
    try {
      return new OpencodeStatusLinePlugin(context).register();
    } catch {
      /* never throw into the TUI — a broken status line must not take opencode down */
      return undefined;
    }
  },
};
