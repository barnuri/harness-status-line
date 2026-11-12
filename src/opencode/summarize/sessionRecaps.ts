import { RecapErrorLog } from '../../../claude-mods/summarize/hooks/recapErrorLog.ts';
import { RecapRepos } from '../../../claude-mods/summarize/hooks/recapRepos.ts';
import { RecapSessionFiles } from '../../../claude-mods/summarize/hooks/recapSessionFiles.ts';
import type { IterationRecapLink } from '../../../claude-mods/summarize/types';
import { OpencodeRecapHost } from './opencodeRecapHost.ts';
import { OpencodeSessionRecap } from './opencodeSessionRecap.ts';
import { OpencodeTurns } from './opencodeTurns.ts';
import type { SummarizeContext } from './summarizeContext.ts';
import type { OpencodeSessionMessage } from './types.ts';

type RecapChange = (sessionId: string, recap: OpencodeSessionRecap, isTurnFinished: boolean, isInitial: boolean) => void | Promise<void>;

/** The summarize recap of every opencode session, rebuilt from the session messages when a turn ends. */
export class SessionRecaps {
  private static readonly TURN_END_EVENTS = ['session.execution.succeeded', 'session.execution.failed', 'session.execution.interrupted'] as const;

  private readonly recaps = new Map<string, OpencodeSessionRecap>();
  private readonly initialLoads = new Map<string, Promise<void>>();
  private readonly branchPullRequests = new Map<string, IterationRecapLink>();

  constructor(
    private readonly data: SummarizeContext['data'],
    private readonly directory: () => string,
    private readonly onChange: RecapChange,
  ) {}

  /** Follows turn starts and ends; returns the unsubscribe. */
  watch(): () => void {
    const releases = [
      this.data.on('session.execution.started', (event) => void this.onTurnStart(event.data.sessionID)),
      ...SessionRecaps.TURN_END_EVENTS.map((type) => this.data.on(type, (event) => void this.load(event.data.sessionID, this.recapOf(event.data.sessionID), true))),
    ];
    return () => {
      for (const release of releases) {
        release();
      }
    };
  }

  /** The session's recap once its history has loaded, so a command never reads the empty state of a resumed session. */
  async ready(sessionId: string): Promise<OpencodeSessionRecap> {
    const recap = this.recapOf(sessionId);
    await this.initialLoads.get(sessionId);
    return recap;
  }

  /** The session's recap; the first call loads the turns the session already has. */
  recapOf(sessionId: string): OpencodeSessionRecap {
    const known = this.recaps.get(sessionId);
    if (known) {
      return known;
    }
    const host = new OpencodeRecapHost(() => sessionId, this.directory);
    const errors = new RecapErrorLog(host);
    const repos = new RecapRepos(host, errors, this.branchPullRequests, this.directory());
    const recap = new OpencodeSessionRecap(repos, new RecapSessionFiles(host, repos, errors));
    this.recaps.set(sessionId, recap);
    this.initialLoads.set(sessionId, this.load(sessionId, recap, false, true));
    return recap;
  }

  async logError(sessionId: string, error: unknown): Promise<void> {
    const host = new OpencodeRecapHost(() => sessionId, this.directory);
    await new RecapErrorLog(host).log(`opencode recap failed: ${RecapErrorLog.describe(error)}`);
  }

  private async onTurnStart(sessionId: string): Promise<void> {
    await this.recapOf(sessionId).noteTurnStart().catch((error: unknown) => this.logError(sessionId, error));
  }

  private async load(sessionId: string, recap: OpencodeSessionRecap, isTurnFinished: boolean, isInitial = false): Promise<void> {
    try {
      await this.data.session.message.sync(sessionId);
      const messages = this.data.session.message.list(sessionId) as ReadonlyArray<OpencodeSessionMessage>;
      const isRunning = !isTurnFinished && this.data.session.status(sessionId) === 'running';
      await recap.record(OpencodeTurns.split(messages, isRunning), Date.now());
      if (recap.entries.length === 0 && messages.length > 0) {
        await this.logError(sessionId, new Error(`no iterations from ${messages.length} messages (types: ${[...new Set(messages.map((message) => message.type))].join(', ')})`));
      }
      await recap.refreshFiles(isTurnFinished);
    } catch (error) {
      await this.logError(sessionId, error);
    }
    await this.onChange(sessionId, recap, isTurnFinished, isInitial);
  }
}
