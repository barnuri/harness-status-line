import { RecapCursor } from '../claude-mods/summarize/hooks/recapCursor.ts';
import { RecapView } from '../claude-mods/summarize/hooks/recapView.tsx';
import type { IterationRecapHandlers } from '../claude-mods/summarize/types';
import type { SummarizePaneState } from '../src/opencode/summarize/types.ts';

interface PaneUi {
  readonly elements: { readonly Box: string; readonly Text: string; readonly Button: string; readonly Link: string };
  readonly rows: number;
  local<Value>(name: string, initial: Value): readonly [Value, (next: Value) => void];
  open(target: string): void;
  close(): void;
}

// The summarize pane: the Claude mod's own RecapView, with its cursor and toggles kept in the pane.
export default function view(state: SummarizePaneState | null, ui: PaneUi): unknown {
  const entries = state?.entries ?? [];
  const [cursor, setCursor] = ui.local<number | null>('cursor', null);
  const [isPromptOpen, setPromptOpen] = ui.local('isPromptOpen', false);
  const [isHistoryOpen, setHistoryOpen] = ui.local('isHistoryOpen', false);
  const [isQaOpen, setQaOpen] = ui.local('isQaOpen', true);
  const handlers: IterationRecapHandlers = {
    onPrevious: () => setCursor(RecapCursor.step(entries, cursor, -1)),
    onNext: () => setCursor(RecapCursor.step(entries, cursor, 1)),
    onLatest: () => setCursor(null),
    onJump: (index) => setCursor(RecapCursor.jump(entries, index)),
    onOpen: () => undefined,
    onHide: () => ui.close(),
    onTogglePrompt: () => setPromptOpen(!isPromptOpen),
    onToggleHistory: () => setHistoryOpen(!isHistoryOpen),
    onToggleQa: () => setQaOpen(!isQaOpen),
    onOpenFile: (path) => ui.open(path),
  };
  return RecapView.pane(
    ui.elements as never,
    entries,
    RecapCursor.selected(entries, cursor),
    state?.cwd ?? '',
    { isPromptOpen, isHistoryOpen, isQaOpen, showFilePaths: state?.showFilePaths ?? false, bodyRows: ui.rows },
    handlers,
    state?.answers ?? null,
    state?.sessionHead ?? null,
  );
}
