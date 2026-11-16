import { SummarizeErrorLog } from '../../../claude-mods/summarize/hooks/summarizeErrorLog.ts';
import { SummarizeRepos } from '../../../claude-mods/summarize/hooks/summarizeRepos.ts';
import { SummarizeSessionFiles } from '../../../claude-mods/summarize/hooks/summarizeSessionFiles.ts';
import type { IterationSummarizeLink } from '../../../claude-mods/summarize/types';
import { OpencodeSummarizeHost } from './opencodeSummarizeHost.ts';
import { OpencodeSessionSummarize } from './opencodeSessionSummarize.ts';
import { OpencodeTurns } from './opencodeTurns.ts';
import type { SummarizeContext } from './summarizeContext.ts';
import type { OpencodeSessionMessage } from './types.ts';

type SummarizeChange = (sessionId: string, summarize: OpencodeSessionSummarize, isTurnFinished: boolean, isInitial: boolean) => void | Promise<void>;

/** The summarize of every opencode session, rebuilt from the session messages when a turn ends. */
export class SessionSummarizes {
  private static readonly TURN_END_EVENTS = ['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'] as const;

  private readonly summarizes = new Map<string, OpencodeSessionSummarize>();
  private readonly initialLoads = new Map<string, Promise<void>>();
  private readonly branchPullRequests = new Map<string, IterationSummarizeLink>();

  constructor(
    private readonly data: SummarizeContext['data'],
    private readonly directory: () => string,
    private readonly onChange: SummarizeChange,
  ) {}

  /** Follows turn starts and ends; returns the unsubscribe. */
  watch(): () => void {
    const releases = [
      this.data.on('session.execution.started', (event) => void this.onTurnStart(event.data.sessionID)),
      ...SessionSummarizes.TURN_END_EVENTS.map((type) => this.data.on(type, (event) => void this.load(event.data.sessionID, this.summarizeOf(event.data.sessionID), true))),
    ];
    return () => {
      for (const release of releases) {
        release();
      }
    };
  }

  /** The session's summarize once its history has loaded, so a command never reads the empty state of a resumed session. */
  async ready(sessionId: string): Promise<OpencodeSessionSummarize> {
    const summarize = this.summarizeOf(sessionId);
    await this.initialLoads.get(sessionId);
    return summarize;
  }

  /** The session's summarize; the first call loads the turns the session already has. */
  summarizeOf(sessionId: string): OpencodeSessionSummarize {
    const known = this.summarizes.get(sessionId);
    if (known) {
      return known;
    }
    const host = new OpencodeSummarizeHost(() => sessionId, this.directory);
    const errors = new SummarizeErrorLog(host);
    const repos = new SummarizeRepos(host, errors, this.branchPullRequests, this.directory());
    const summarize = new OpencodeSessionSummarize(repos, new SummarizeSessionFiles(host, repos, errors));
    this.summarizes.set(sessionId, summarize);
    this.initialLoads.set(sessionId, this.load(sessionId, summarize, false, true));
    return summarize;
  }

  async logError(sessionId: string, error: unknown): Promise<void> {
    const host = new OpencodeSummarizeHost(() => sessionId, this.directory);
    await new SummarizeErrorLog(host).log(`opencode summarize failed: ${SummarizeErrorLog.describe(error)}`);
  }

  private async onTurnStart(sessionId: string): Promise<void> {
    await this.summarizeOf(sessionId).noteTurnStart().catch((error: unknown) => this.logError(sessionId, error));
  }

  private async load(sessionId: string, summarize: OpencodeSessionSummarize, isTurnFinished: boolean, isInitial = false): Promise<void> {
    try {
      await this.data.session.message.sync(sessionId);
      const messages = this.data.session.message.list(sessionId) as ReadonlyArray<OpencodeSessionMessage>;
      const isRunning = !isTurnFinished && this.data.session.status(sessionId) === 'running';
      await summarize.record(OpencodeTurns.split(messages, isRunning), Date.now());
      if (summarize.entries.length === 0 && messages.length > 0) {
        await this.logError(sessionId, new Error(`no iterations from ${messages.length} messages (types: ${[...new Set(messages.map((message) => message.type))].join(', ')})`));
      }
      await summarize.refreshFiles(isTurnFinished);
    } catch (error) {
      await this.logError(sessionId, error);
    }
    await this.onChange(sessionId, summarize, isTurnFinished, isInitial);
  }
}
