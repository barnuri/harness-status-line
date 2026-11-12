import type {
  IterationRecapEntry,
  IterationRecapLink,
  IterationRecapToolCall,
  SessionAnswers,
} from '../../../claude-mods/summarize/types';
import type { OpencodeToolPart } from './opencodeToolCall.ts';

export interface OpencodeSessionMessage {
  readonly id?: string;
  readonly type?: string;
  readonly text?: string;
  readonly time?: { readonly created?: number; readonly completed?: number };
  readonly skills?: ReadonlyArray<{ readonly name?: string }>;
  readonly content?: ReadonlyArray<OpencodeToolPart & { readonly text?: string }>;
  readonly tokens?: { readonly output?: number };
  readonly finish?: string;
  readonly error?: unknown;
}

/** One user prompt and the assistant work that answered it. */
export interface OpencodeTurn {
  readonly turnId: string;
  readonly prompt: string;
  readonly startedAt: number;
  readonly skills: readonly string[];
  readonly calls: readonly Omit<IterationRecapToolCall, 'git'>[];
  readonly answer: string;
  readonly durationMs: number;
  readonly outputTokens: number;
  readonly reason: string;
  readonly isComplete: boolean;
}

/** What the summarize mod publishes for a session's herdr pane. */
export interface SummarizePaneState {
  readonly cwd: string;
  readonly showFilePaths: boolean;
  readonly entries: readonly IterationRecapEntry[];
  readonly answers: SessionAnswers | null;
  readonly sessionHead: IterationRecapLink | null;
}
