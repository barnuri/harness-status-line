import type { OpencodeSessionRecap } from './opencodeSessionRecap.ts';
import { SessionRecaps } from './sessionRecaps.ts';
import type { SummarizeContext } from './summarizeContext.ts';
import type { SummarizePaneState } from './types.ts';

/** The herdr-mods host API a mod gets inside opencode (the subset this mod uses). */
interface ModHostApi {
  readonly options: Readonly<Record<string, unknown>>;
  readonly opencode: unknown;
  directory(): string;
  currentSessionId(): string | undefined;
  publish(key: string, state: unknown): Promise<void>;
  openPane(key: string, options?: { readonly isForced?: boolean }): Promise<boolean>;
}

/**
 * The summarize mod for herdr-mods: records each opencode session's turns, publishes the recap, and
 * opens the session's herdr pane after a new turn. `/summarize overview` writes the overview page.
 */
export class SummarizeMod {
  static readonly ID = 'summarize';
  private static readonly OVERVIEW_WORD = 'overview';
  private static readonly STARTUP_POLL_MS = 1000;

  private readonly recaps: SessionRecaps;

  constructor(private readonly api: ModHostApi) {
    const context = api.opencode as SummarizeContext;
    this.recaps = new SessionRecaps(context.data, () => api.directory(), (sessionId, recap, isTurnFinished, isInitial) =>
      this.onChange(sessionId, recap, isTurnFinished, isInitial),
    );
  }

  /** The `HerdrMod` definition; `viewModule` is the absolute path of the pane view. */
  static definition(viewModule: string) {
    let instance: SummarizeMod | null = null;
    return {
      id: SummarizeMod.ID,
      pane: { module: viewModule },
      command: {
        name: SummarizeMod.ID,
        description: 'Open the iteration recap beside opencode, or write the session overview page (overview)',
        run: (args: string) => instance?.command(args),
      },
      setup: (api: ModHostApi) => {
        instance = new SummarizeMod(api);
        return instance.start();
      },
    };
  }

  /** Follows turn events, and loads the session the person opens at startup or resume so its pane opens by itself. */
  start(): () => void {
    const release = this.recaps.watch();
    let timer: ReturnType<typeof setInterval> | undefined = setInterval(() => {
      const sessionId = this.api.currentSessionId();
      if (sessionId === undefined) {
        return;
      }
      clearInterval(timer);
      timer = undefined;
      this.recaps.recapOf(sessionId);
    }, SummarizeMod.STARTUP_POLL_MS);
    return () => {
      if (timer !== undefined) {
        clearInterval(timer);
      }
      release();
    };
  }

  async command(args: string): Promise<string | void> {
    const sessionId = this.api.currentSessionId();
    if (!sessionId) {
      return 'Open a session first.';
    }
    const recap = await this.recaps.ready(sessionId);
    if (args.toLowerCase() === SummarizeMod.OVERVIEW_WORD) {
      return recap.renderOverview();
    }
    await this.publish(sessionId, recap);
    const isOpen = await this.api.openPane(sessionId, { isForced: true });
    return isOpen ? undefined : 'The recap pane did not open.';
  }

  private async onChange(sessionId: string, recap: OpencodeSessionRecap, isTurnFinished: boolean, isInitial: boolean): Promise<void> {
    await this.publish(sessionId, recap);
    if ((isTurnFinished || isInitial) && recap.entries.length > 0) {
      await this.api.openPane(sessionId);
    }
  }

  private async publish(sessionId: string, recap: OpencodeSessionRecap): Promise<void> {
    const state: SummarizePaneState = {
      cwd: this.api.directory(),
      showFilePaths: this.api.options['showFilePaths'] === true,
      entries: recap.entries,
      answers: recap.answers,
      overview: recap.overview,
      sessionHead: recap.sessionHead,
    };
    await this.api.publish(sessionId, state);
  }
}
