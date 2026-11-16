import { join } from 'node:path';
import { FileOpener } from '../claude-mods/summarize/hooks/fileOpener.ts';
import { SummarizeCursor } from '../claude-mods/summarize/hooks/summarizeCursor.ts';
import { SummarizeErrorLog } from '../claude-mods/summarize/hooks/summarizeErrorLog.ts';
import { SummarizeView } from '../claude-mods/summarize/hooks/summarizeView.tsx';
import { ViewerRoute } from '../claude-mods/summarize/hooks/viewerRoute.ts';
import type { IterationSummarizeHandlers } from '../claude-mods/summarize/types';
import { OpencodeSummarizeHost } from '../src/opencode/summarize/opencodeSummarizeHost.ts';
import { PaneOverviewOpener } from '../src/opencode/summarize/paneOverviewOpener.ts';
import type { PaneTakeover } from '../src/opencode/summarize/paneOverviewOpener.ts';
import type { SummarizePaneState } from '../src/opencode/summarize/types.ts';

const BACK_SCRIPT = join(import.meta.dir, 'overviewBack.js');

interface PaneUi extends PaneTakeover {
  readonly elements: { readonly Box: string; readonly Text: string; readonly Button: string; readonly Link: string };
  readonly rows: number;
  readonly key: string;
  local<Value>(name: string, initial: Value): readonly [Value, (next: Value) => void];
  open(target: string): void;
  close(): void;
}

// The summarize pane: the Claude mod's own SummarizeView, with its cursor and toggles kept in the pane.
export default function view(state: SummarizePaneState | null, ui: PaneUi): unknown {
  const entries = state?.entries ?? [];
  const [cursor, setCursor] = ui.local<number | null>('cursor', null);
  const [isPromptOpen, setPromptOpen] = ui.local('isPromptOpen', false);
  const [isHistoryOpen, setHistoryOpen] = ui.local('isHistoryOpen', false);
  const [isQaOpen, setQaOpen] = ui.local('isQaOpen', true);
  const route = viewerRoute();
  const handlers: IterationSummarizeHandlers = {
    onPrevious: () => setCursor(SummarizeCursor.step(entries, cursor, -1)),
    onNext: () => setCursor(SummarizeCursor.step(entries, cursor, 1)),
    onLatest: () => setCursor(null),
    onJump: (index) => setCursor(SummarizeCursor.jump(entries, index)),
    onOpen: () => undefined,
    onHide: () => ui.close(),
    onTogglePrompt: () => setPromptOpen(!isPromptOpen),
    onToggleHistory: () => setHistoryOpen(!isHistoryOpen),
    onToggleQa: () => setQaOpen(!isQaOpen),
    onOpenFile: (path) => ui.open(path),
    onOpenOverview: (html) => void new PaneOverviewOpener(ui, BACK_SCRIPT, () => route.isMobilePanelFocused(), () => overviewOpener(state, ui, route)).open(html),
  };
  return SummarizeView.pane(
    ui.elements as never,
    entries,
    SummarizeCursor.selected(entries, cursor),
    state?.cwd ?? '',
    { isPromptOpen, isHistoryOpen, isQaOpen, showFilePaths: state?.showFilePaths ?? false, bodyRows: ui.rows },
    handlers,
    state?.answers ?? null,
    state?.sessionHead ?? null,
    state?.overview ?? null,
  );
}

// The fallback when the pane cannot be taken over: the OS browser, or the split when a phone viewer is focused.
function overviewOpener(state: SummarizePaneState | null, ui: PaneUi, route: ViewerRoute): FileOpener {
  const host = new OpencodeSummarizeHost(() => ui.key, () => state?.cwd ?? process.cwd());
  return new FileOpener(host, new SummarizeErrorLog(host), route);
}

/** The phone-viewer check for this pane: the state file under HERDR_PLUGIN_STATE_DIR or ~/.local/state, and the focused pane. */
function viewerRoute(): ViewerRoute {
  const host = new OpencodeSummarizeHost(() => '', () => process.cwd());
  return new ViewerRoute({ ...host, env: async (name) => process.env[name] });
}
