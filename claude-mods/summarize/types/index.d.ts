export type IterationSummarizeLink = { label: string; url?: string; isCreated?: boolean; isBranch?: boolean; repo?: string };

export type IterationSummarizeQuestion = { text: string; isAnswered: boolean; fullText?: string; answer?: string };

export type IterationSummarizeGitFacts = {
  editedFiles: string[];
  commitSha?: string;
  pullRequest?: { number: number; url?: string; action: string };
};

export type IterationSummarizeToolCall = {
  tool: string;
  input: Record<string, unknown>;
  resultText: string;
  isError: boolean;
  git?: IterationSummarizeGitFacts;
};

export type IterationSummarizeTurnEnd = {
  turnId: string;
  answer: string;
  durationMs: number;
  reason: string;
  outputTokens: number;
};

export type IterationSummarizeArtifacts = {
  files: string[];
  overviewFiles?: string[];
  skills: string[];
  repos: string[];
  changedRepos: IterationSummarizeLink[];
  pullRequests: IterationSummarizeLink[];
  commitLinks?: IterationSummarizeLink[];
  headCommits?: IterationSummarizeLink[];
  reviews: string[];
  plans: string[];
  commits: string[];
  questions: IterationSummarizeQuestion[];
};

export type IterationSummarizeSummaryFacts = {
  artifacts: IterationSummarizeArtifacts;
  toolCounts: Record<string, number>;
};

export type IterationSummarizeEntry = {
  index: number;
  turnId: string;
  prompt: string;
  summary: string;
  startedAt: number;
  durationMs: number;
  outputTokens: number;
  toolCounts: Record<string, number>;
  endReason: string;
  artifacts: IterationSummarizeArtifacts;
};

export type IterationSummarizeScope = {
  touchedDirectories: string[];
  changedDirectories: string[];
  startRoot: string | null;
  startState: string | null;
};

export type IterationSummarizeHandlers = {
  onPrevious: () => void;
  onNext: () => void;
  onLatest: () => void;
  onJump: (index: number) => void;
  onOpen: () => void;
  onHide: () => void;
  onTogglePrompt: () => void;
  onToggleHistory: () => void;
  onToggleQa: () => void;
  onOpenFile: (path: string) => void;
  onOpenOverview: (html: string) => void;
};

export type IterationSummarizePaneLayout = {
  isPromptOpen: boolean;
  isHistoryOpen: boolean;
  isQaOpen: boolean;
  showFilePaths: boolean;
  bodyRows: number;
};

export type SessionAnswer = { number: string; question: string; answer: string };

export type SessionAnswers = { path: string; slug: string; session: string; items: SessionAnswer[] };

/** The session's `agent-spec/<slug>/` folder and its `session-overview.html` page. */
export type SessionOverview = { slug: string; folder: string; html: string };

/** The overview-facts.json document (schemaVersion 1). Answers are not part of it. */
export type OverviewFactsDocument = {
  schemaVersion: 1;
  slug: string;
  sessionId: string;
  cwd: string;
  turns: number;
  durationMs: number;
  outputTokens: number;
  toolCounts: Record<string, number>;
  files: string[];
  skills: string[];
  changedRepos: IterationSummarizeLink[];
  pullRequests: IterationSummarizeLink[];
  commits: IterationSummarizeLink[];
  lastCommits: IterationSummarizeLink[];
  plans: string[];
  reviews: string[];
};

declare module 'claude-code' {
  interface PluginState {
    'summarize': {
      iterations: IterationSummarizeEntry[];
      answers: SessionAnswers | null;
      overview: SessionOverview | null;
      sessionHead: IterationSummarizeLink | null;
      cursor: number | null;
      isBandHidden: boolean;
      isPaneDismissed: boolean;
      isActive: boolean;
      isPromptOpen: boolean;
      isHistoryOpen: boolean;
      isQaOpen: boolean;
    };
  }
}
