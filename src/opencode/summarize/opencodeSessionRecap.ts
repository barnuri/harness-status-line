import { ArtifactExtractor } from '../../../claude-mods/summarize/hooks/artifactExtractor.ts';
import { IterationRecorder } from '../../../claude-mods/summarize/hooks/iterationRecorder.ts';
import { RecapCursor } from '../../../claude-mods/summarize/hooks/recapCursor.ts';
import type { RecapRepos } from '../../../claude-mods/summarize/hooks/recapRepos.ts';
import type { RecapSessionFiles } from '../../../claude-mods/summarize/hooks/recapSessionFiles.ts';
import type {
  IterationRecapEntry,
  IterationRecapLink,
  IterationRecapScope,
  SessionAnswers,
} from '../../../claude-mods/summarize/types';
import type { OpencodeTurn } from './types.ts';

type RepoSnapshot = { root: string | null; state: string | null };

/** The recap of one opencode session: an entry per finished turn, the session Q&A and the session repo HEAD. */
export class OpencodeSessionRecap {
  private static readonly MAX_ITERATIONS = 200;

  entries: IterationRecapEntry[] = [];
  answers: SessionAnswers | null = null;
  sessionHead: IterationRecapLink | null = null;
  cursor: number | null = null;

  private readonly recordedTurnIds = new Set<string>();
  private pendingStart: RepoSnapshot | null = null;

  constructor(
    private readonly repos: RecapRepos,
    private readonly files: RecapSessionFiles,
  ) {}

  async noteTurnStart(): Promise<void> {
    this.pendingStart = await this.repos.snapshot();
  }

  /** Records every finished turn not seen yet. Repo lookups run only for the newest turn, whose start this recap saw. */
  async record(turns: readonly OpencodeTurn[], nowMs: number): Promise<boolean> {
    let isChanged = false;
    const newestTurnId = turns.at(-1)?.turnId;
    for (const turn of turns) {
      if (!turn.isComplete || this.recordedTurnIds.has(turn.turnId)) {
        continue;
      }
      this.recordedTurnIds.add(turn.turnId);
      const entry = this.entryOf(turn, nowMs);
      if (!entry) {
        continue;
      }
      const start = turn.turnId === newestTurnId ? this.pendingStart : null;
      const resolved = start ? await this.repos.resolve(entry, this.scopeOf(turn, start)) : entry;
      this.entries = [...this.entries, resolved].slice(-OpencodeSessionRecap.MAX_ITERATIONS);
      isChanged = true;
    }
    if (isChanged) {
      this.pendingStart = null;
    }
    return isChanged;
  }

  async refreshFiles(isTurnFinished: boolean): Promise<void> {
    const root = await this.repos.root(this.repos.sessionDirectory);
    this.sessionHead = root === null ? null : await this.repos.headCommit(root);
    if (isTurnFinished) {
      const folder = await this.files.publishedSlugFolder(this.entries);
      if (folder !== null) {
        await this.files.writeOverviewFacts(folder, this.entries, this.sessionHead);
      }
    }
    const answers = await this.files.answers(this.entries);
    if (answers !== null) {
      this.answers = answers;
    }
  }

  selected(): IterationRecapEntry | undefined {
    return RecapCursor.selected(this.entries, this.cursor);
  }

  /** Applies a `/summarize` word (`prev`, `next`, `last`, `<n>`, or empty for the current one). */
  moveCursor(word: string): void {
    this.cursor = word === '' ? this.cursor : RecapCursor.parse(word, this.entries, this.cursor);
  }

  renderOverview(): Promise<string> {
    return this.files.renderOverview(this.entries, this.sessionHead);
  }

  private entryOf(turn: OpencodeTurn, nowMs: number): IterationRecapEntry | null {
    const recorder = new IterationRecorder();
    recorder.start(turn.turnId, turn.prompt, turn.startedAt);
    for (const skill of turn.skills) {
      recorder.noteSkill(skill);
    }
    for (const call of turn.calls) {
      recorder.record(call.tool, call.input, call.resultText, call.isError);
    }
    const index = (this.entries.at(-1)?.index ?? 0) + 1;
    return recorder.finish(
      { turnId: turn.turnId, answer: turn.answer, durationMs: turn.durationMs, reason: turn.reason, outputTokens: turn.outputTokens },
      index,
      nowMs,
    );
  }

  private scopeOf(turn: OpencodeTurn, start: RepoSnapshot): IterationRecapScope {
    return {
      touchedDirectories: ArtifactExtractor.candidateDirectories(turn.calls),
      changedDirectories: ArtifactExtractor.changeDirectories(turn.calls),
      startRoot: start.root,
      startState: start.state,
    };
  }
}
