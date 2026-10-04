export type IterationRecapLink = { label: string; url?: string; isCreated?: boolean; isBranch?: boolean };

export type IterationRecapQuestion = { text: string; isAnswered: boolean };

export type IterationRecapGitFacts = {
  editedFiles: string[];
  commitSha?: string;
  pullRequest?: { number: number; url?: string; action: string };
};

export type IterationRecapToolCall = {
  tool: string;
  input: Record<string, unknown>;
  resultText: string;
  isError: boolean;
  git?: IterationRecapGitFacts;
};

export type IterationRecapTurnEnd = {
  turnId: string;
  answer: string;
  durationMs: number;
  reason: string;
  outputTokens: number;
};

export type IterationRecapArtifacts = {
  files: string[];
  skills: string[];
  repos: string[];
  changedRepos: IterationRecapLink[];
  pullRequests: IterationRecapLink[];
  reviews: string[];
  plans: string[];
  commits: string[];
  questions: IterationRecapQuestion[];
};

export type IterationRecapSummaryFacts = {
  artifacts: IterationRecapArtifacts;
  toolCounts: Record<string, number>;
};

export type IterationRecapEntry = {
  index: number;
  turnId: string;
  prompt: string;
  summary: string;
  isSummaryFromModel: boolean;
  startedAt: number;
  durationMs: number;
  outputTokens: number;
  toolCounts: Record<string, number>;
  endReason: string;
  artifacts: IterationRecapArtifacts;
};

export type IterationRecapScope = {
  touchedDirectories: string[];
  changedDirectories: string[];
  startRoot: string | null;
  startState: string | null;
};

export type IterationRecapHandlers = {
  onPrevious: () => void;
  onNext: () => void;
  onLatest: () => void;
  onJump: (index: number) => void;
  onOpen: () => void;
  onHide: () => void;
  onTogglePrompt: () => void;
  onToggleHistory: () => void;
};

export type IterationRecapPaneLayout = {
  isPromptOpen: boolean;
  isHistoryOpen: boolean;
  bodyRows: number;
};

declare module 'claude-code' {
  interface PluginState {
    'summarize': {
      iterations: IterationRecapEntry[];
      cursor: number | null;
      isBandHidden: boolean;
      isPaneDismissed: boolean;
      isActive: boolean;
      isPromptOpen: boolean;
      isHistoryOpen: boolean;
    };
  }
}
