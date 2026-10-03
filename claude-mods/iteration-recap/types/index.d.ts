export type IterationRecapLink = { label: string; url?: string; isCreated?: boolean };

export type IterationRecapQuestion = { text: string; isAnswered: boolean };

export type IterationRecapToolCall = {
  tool: string;
  input: Record<string, unknown>;
  resultText: string;
  isError: boolean;
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
  changedRepos: string[];
  pullRequests: IterationRecapLink[];
  reviews: string[];
  plans: string[];
  commits: string[];
  questions: IterationRecapQuestion[];
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
};

export type IterationRecapHandlers = {
  onPrevious: () => void;
  onNext: () => void;
  onLatest: () => void;
  onJump: (index: number) => void;
  onOpen: () => void;
  onHide: () => void;
};

declare module 'claude-code' {
  interface PluginState {
    'iteration-recap': {
      iterations: IterationRecapEntry[];
      cursor: number | null;
      isBandHidden: boolean;
      isPaneDismissed: boolean;
      isActive: boolean;
    };
  }
}
