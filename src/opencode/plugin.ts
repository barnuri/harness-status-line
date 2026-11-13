import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { jsx } from '@opentui/solid/jsx-runtime';
import type { JSX } from '@opentui/solid/jsx-runtime';
import { OpencodeStateReader } from './opencodeStateReader.ts';
import { OpencodeStatusRenderer } from './opencodeStatusRenderer.ts';
import { OpencodeActivityTracker } from './activityTracker.ts';
import { ActivitySegment } from '../shared/activitySegment.ts';
import { ConfigManager } from '../configManager.ts';
import type { ActivityState, Config, Segment } from '../types.ts';
import type { OpencodeTuiSlice } from './types.ts';

interface SlotClaim {
  readonly append?: 'home.footer';
  readonly replace?: 'prompt.footer';
  readonly render: (input: { readonly sessionID?: string }) => JSX.Element;
}

type RevisionStore = readonly [{ readonly revision: number }, (mutation: (draft: { revision: number }) => void) => void];

type PluginContext = OpencodeTuiSlice & {
  readonly ui: { readonly slot: (claim: SlotClaim) => () => void };
  readonly storage: { memory(key: string, options: { readonly initial: { revision: number } }): RevisionStore };
};

/**
 * opencode 2 TUI plugin, listed in `~/.config/opencode/cli.json` under `plugins`. This file is only a shim:
 * it reads opencode's state, runs `segmentsCli.ts` in a fresh process and draws the segments it returns,
 * so edits to the status logic apply without restarting opencode. Only this file and the renderer need a restart.
 */
class OpencodeStatusLinePlugin {
  // Replaces the prompt footer row so the line gets the full width below the prompt.
  private static readonly PLACEMENTS: ReadonlyArray<Pick<SlotClaim, 'append' | 'replace'>> = [
    { replace: 'prompt.footer' },
    { append: 'home.footer' },
  ];
  /** Each rebuild starts a process: at most one every 2 seconds. */
  private static readonly REBUILD_INTERVAL_MS = 2_000;
  private static readonly RUN_TIMEOUT_MS = 10_000;
  private static readonly CLI_PATH = path.join(import.meta.dir, 'segmentsCli.ts');
  private static readonly CACHE_FILE = path.join(os.homedir(), '.claude', 'harness-status-line-opencode-segments.json');
  private static readonly ERROR_LOG = path.join(os.homedir(), '.claude', 'harness-status-line-opencode-error.log');

  private readonly stateReader = new OpencodeStateReader();
  private readonly renderer = new OpencodeStatusRenderer();
  private readonly activitySegment = new ActivitySegment();
  private readonly activityTracker: OpencodeActivityTracker;
  private readonly config: Config = new ConfigManager().load();
  private readonly revision: RevisionStore;

  private segments: Segment[] = [];
  private builtAtMs = 0;
  private builtInputKey = '';
  private builtModelKey = '';
  private running = false;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private activityTimer: ReturnType<typeof setInterval> | undefined;
  private stopActivityListen: (() => void) | undefined;
  private shownActivity: ActivityState | null = null;

  // The host's store is the reactive source: a signal from this repo's own solid-js copy is not tracked by the host.
  constructor(private readonly context: PluginContext) {
    this.revision = context.storage.memory('harness-status-line', { initial: { revision: 0 } });
    this.segments = this.readCache();
    this.activityTracker = new OpencodeActivityTracker(context);
    this.stopActivityListen = this.activityTracker.start();
    // Redraws each spinner frame while the session works, and once on every state change otherwise.
    this.activityTimer = setInterval(() => {
      try {
        const activity = this.activityTracker.current(this.activityTracker.routeSessionId());
        const changed = activity !== this.shownActivity;
        this.shownActivity = activity;
        if (changed || (activity && ActivitySegment.isAnimated(activity))) {
          this.bumpRevision();
        }
      } catch {
        /* the spinner must never break the TUI */
      }
    }, ActivitySegment.FRAME_MS);
    // Poll the selected model so changes invoked by commands such as `/model` are detected
    // even when the host does not re-render the slot immediately. Lightweight: checks every 300ms.
    this.pollTimer = setInterval(() => {
      try {
        const input = this.stateReader.read(this.context, undefined);
        const key = `${input.providerId ?? ''}/${input.modelId ?? ''}`;
        if (key && key !== this.builtModelKey && !this.running) {
          // trigger an immediate rebuild for model changes
          this.builtModelKey = key;
          const inputJson = JSON.stringify(input);
          void this.runCli(inputJson)
            .then((segments) => {
              this.segments = segments;
              this.writeCache(segments);
            })
            .catch((err: unknown) => this.logFailure(err))
            .finally(() => {
              this.bumpRevision();
            });
        }
      } catch (e) {
        /* swallow */
      }
    }, 300);
  }

  register(): () => void {
    const releases = OpencodeStatusLinePlugin.PLACEMENTS.map((placement) =>
      this.context.ui.slot({
        ...placement,
        render: (input) => {
          const plugin = this;
          return jsx('box', {
            // Encourage the host to give this renderable the full row and stretch children.
            style: { width: '100%', flex: 1, alignItems: 'stretch', justifyContent: 'flex-start', flexDirection: 'row' },
            get children() {
              return plugin.renderSafely(input.sessionID);
            },
          });
        },
      }),
    );
    return () => {
      clearTimeout(this.refreshTimer);
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
      }
      clearInterval(this.activityTimer);
      this.stopActivityListen?.();
      releases.forEach((release) => release());
    };
  }

  private renderSafely(sessionId: string | undefined): JSX.Element | null {
    try {
      return this.renderer.render([...this.activitySegments(sessionId), ...this.currentSegments(sessionId)]);
    } catch (err) {
      this.logFailure(err);
      return null;
    }
  }

  // Computed in this process, not in segmentsCli, so the spinner advances every frame instead of every rebuild.
  private activitySegments(sessionId: string | undefined): Segment[] {
    const activity = this.activityTracker.current(sessionId ?? this.activityTracker.routeSessionId());
    if (!activity || !this.config.segments.activity) {
      return [];
    }
    return [this.activitySegment.build(activity, this.config.colors)];
  }

  // Reads the reactive opencode state on every call, so the line follows new messages and model switches.
  private currentSegments(sessionId: string | undefined): Segment[] {
    void this.revision[0].revision;
    const input = this.stateReader.read(this.context, sessionId);
    const inputKey = JSON.stringify(input);
    const modelKey = `${input.providerId ?? ''}/${input.modelId ?? ''}`;
    const nowMs = Date.now();
    const sinceBuildMs = nowMs - this.builtAtMs;
    // A model switch rebuilds at once, so the quota of the new profile shows without the throttle delay.
    const modelChanged = modelKey !== this.builtModelKey;
    if (this.running) {
      return this.segments;
    }
    if (!modelChanged && sinceBuildMs < OpencodeStatusLinePlugin.REBUILD_INTERVAL_MS) {
      if (inputKey !== this.builtInputKey) {
        this.scheduleRebuild(OpencodeStatusLinePlugin.REBUILD_INTERVAL_MS - sinceBuildMs);
      }
      return this.segments;
    }
    this.builtModelKey = modelKey;
    this.builtAtMs = nowMs;
    this.builtInputKey = inputKey;
    this.running = true;
    void this.runCli(inputKey)
      .then((segments) => {
        this.segments = segments;
        this.writeCache(segments);
      })
      .catch((err: unknown) => this.logFailure(err))
      .finally(() => {
        this.running = false;
        this.bumpRevision();
      });
    return this.segments;
  }

  // The last good segments stay on screen when a run fails, for example while the code is mid-edit.
  private async runCli(inputJson: string): Promise<Segment[]> {
    const runtime = /(^|\/)bun(-[\w.]+)?$/.test(process.execPath) ? process.execPath : (Bun.which('bun') ?? 'bun');
    const child = Bun.spawn([runtime, OpencodeStatusLinePlugin.CLI_PATH], {
      stdin: new Blob([inputJson]),
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: OpencodeStatusLinePlugin.RUN_TIMEOUT_MS,
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) {
      throw new Error(`segmentsCli exited ${code}: ${stderr.trim()}`);
    }
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) {
      throw new Error('segmentsCli did not return an array');
    }
    return parsed as Segment[];
  }

  // The last line is drawn on the first frame, before the first fresh build finishes.
  private readCache(): Segment[] {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(OpencodeStatusLinePlugin.CACHE_FILE, 'utf8'));
      return Array.isArray(parsed) ? (parsed as Segment[]) : [];
    } catch {
      return [];
    }
  }

  private writeCache(segments: Segment[]): void {
    try {
      fs.writeFileSync(OpencodeStatusLinePlugin.CACHE_FILE, JSON.stringify(segments));
    } catch {
      /* the cache is only a head start */
    }
  }

  private logFailure(err: unknown): void {
    try {
      fs.appendFileSync(OpencodeStatusLinePlugin.ERROR_LOG, `${new Date().toISOString()} ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    } catch {
      /* logging must never fail the render */
    }
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
    } catch (err) {
      try {
        fs.appendFileSync(
          path.join(os.homedir(), '.claude', 'harness-status-line-opencode-error.log'),
          `${new Date().toISOString()} setup failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
        );
      } catch {
        /* ignore */
      }
      /* never throw into the TUI — a broken status line must not take opencode down */
      return undefined;
    }
  }
};
