import { jsx } from '@opentui/solid/jsx-runtime';
import type { JSX } from '@opentui/solid/jsx-runtime';
import { RecapText } from '../../../claude-mods/summarize/hooks/recapText.ts';
import type { OpencodeSessionRecap } from './opencodeSessionRecap.ts';
import { SessionRecaps } from './sessionRecaps.ts';
import type { SummarizeContext } from './summarizeContext.ts';

/**
 * The summarize recap drawn inside opencode: the sidebar, the session panel and an optional band.
 * The herdr pane version is the herdr-mods mod in `opencode-summarize/mod.ts`.
 */
export class SummarizePlugin {
  private static readonly COMMAND = 'summarize';
  private static readonly OVERVIEW_WORD = 'overview';
  private static readonly BAND_WORD = 'band';
  private static readonly HEADING_COLOR = '#D77757';
  private static readonly MUTED_COLOR = '#999999';
  private static readonly HEADING_PREFIXES = ['This session', 'Iteration '];

  private readonly recaps: SessionRecaps;
  private readonly revision: ReturnType<SummarizeContext['storage']['memory']>;
  private readonly showFilePaths: boolean;
  private isBandShown: boolean;
  private isPanelOpenedByPlugin = false;
  private isPanelDismissed = false;

  // The host's store is the reactive source: a signal from this repo's own solid-js copy is not tracked by the host.
  constructor(private readonly context: SummarizeContext) {
    this.revision = context.storage.memory('summarize', { initial: { revision: 0 } });
    this.showFilePaths = context.options?.['showFilePaths'] === true;
    this.isBandShown = context.options?.['showBand'] === true;
    this.recaps = new SessionRecaps(context.data, () => this.directory(), (sessionId, recap, isTurnFinished) => {
      this.bump();
      if (isTurnFinished) {
        this.autoOpenPanel(sessionId, recap);
      }
    });
  }

  register(): () => void {
    const releases = [
      this.context.ui.slot({ append: 'sidebar.content', render: (input) => this.panel(input.sessionID, false) }),
      this.context.ui.slot({
        append: 'session.panel',
        render: (input) => (input.name === SummarizePlugin.COMMAND ? this.panel(input.sessionID, true) : null),
      }),
      this.context.ui.slot({ append: 'session.composer.top', render: (input) => this.band(input.sessionID) }),
      this.recaps.watch(),
      this.context.ui.slot({ append: 'app', render: () => this.registerCommand() }),
    ];
    return () => {
      for (const release of releases) {
        release();
      }
    };
  }

  // A keymap layer lives as long as the reactive owner that created it, so it is created inside a slot render.
  private registerCommand(): null {
    try {
      this.context.keymap.layer(() => ({
        mode: 'global',
        commands: [
          {
            id: SummarizePlugin.COMMAND,
            title: 'Summarize',
            group: 'Session',
            description: 'Browse the iteration recap (prev, next, last, <n>), toggle the band (band), or write the session overview (overview)',
            palette: true,
            slash: { name: SummarizePlugin.COMMAND, arguments: true },
            run: (input?: string) => void this.command(input ?? ''),
          },
        ],
      }));
    } catch (error) {
      void this.recaps.logError('', error);
    }
    return null;
  }

  private panel(sessionId: string, isOpenedPanel: boolean): JSX.Element {
    const plugin = this;
    return jsx('box', {
      style: { flexDirection: 'column', width: '100%' },
      get children() {
        return plugin.panelLines(sessionId, isOpenedPanel);
      },
    });
  }

  private band(sessionId: string): JSX.Element {
    const plugin = this;
    return jsx('box', {
      style: { width: '100%' },
      get children() {
        void plugin.revision[0].revision;
        const latest = plugin.recaps.recapOf(sessionId).entries.at(-1);
        if (!plugin.isBandShown || !latest) {
          return null;
        }
        return jsx('text', { fg: SummarizePlugin.MUTED_COLOR, children: `↳ ${latest.summary}` });
      },
    });
  }

  // The sidebar hides an empty recap; the panel `/summarize` opens says so, like the Claude reply.
  private panelLines(sessionId: string, isOpenedPanel: boolean): JSX.Element[] {
    void this.revision[0].revision;
    const recap = this.recaps.recapOf(sessionId);
    if (recap.entries.length === 0) {
      return isOpenedPanel ? [jsx('text', { fg: SummarizePlugin.MUTED_COLOR, children: 'No iterations recorded yet.' })] : [];
    }
    const text = RecapText.commandText(recap.selected(), recap.entries, this.directory(), recap.answers, this.showFilePaths, recap.sessionHead, true);
    return [
      jsx('text', { fg: SummarizePlugin.HEADING_COLOR, children: 'Summarize' }),
      ...text.split('\n').map((line) =>
        jsx('text', {
          fg: SummarizePlugin.HEADING_PREFIXES.some((prefix) => line.startsWith(prefix)) ? SummarizePlugin.HEADING_COLOR : undefined,
          children: line,
        }),
      ),
    ];
  }

  // Like the Claude pane: open beside the chat after every new turn, until the person closes it.
  private autoOpenPanel(sessionId: string, recap: OpencodeSessionRecap): void {
    const isShown = this.context.ui.panel.current()?.name === SummarizePlugin.COMMAND;
    if (this.isPanelOpenedByPlugin && !isShown) {
      this.isPanelDismissed = true;
    }
    const route = this.context.ui.router.current();
    const isViewed = route.type === 'session' && route.sessionID === sessionId;
    if (this.isPanelDismissed || isShown || !isViewed || recap.entries.length === 0) {
      return;
    }
    this.openPanel();
  }

  private openPanel(): void {
    this.isPanelOpenedByPlugin = this.context.ui.panel.open(SummarizePlugin.COMMAND, { presentation: 'panel' });
  }

  private async command(input: string): Promise<void> {
    const route = this.context.ui.router.current();
    const sessionId = route.type === 'session' ? route.sessionID : undefined;
    if (!sessionId) {
      this.toast('Open a session first.');
      return;
    }
    const recap = this.recaps.recapOf(sessionId);
    const word = input.trim().toLowerCase();
    if (word === SummarizePlugin.OVERVIEW_WORD) {
      this.toast(await recap.renderOverview());
      return;
    }
    if (word === SummarizePlugin.BAND_WORD) {
      this.isBandShown = !this.isBandShown;
      this.toast(this.isBandShown ? 'Recap band shown.' : 'Recap band hidden.');
      this.bump();
      return;
    }
    recap.moveCursor(word);
    this.bump();
    this.isPanelDismissed = false;
    this.openPanel();
  }

  private toast(message: string): void {
    this.context.ui.toast.show({ title: 'Summarize', message, variant: 'info' });
  }

  private directory(): string {
    return this.context.data.location.default()?.directory ?? process.cwd();
  }

  private bump(): void {
    this.revision[1]((draft) => {
      draft.revision += 1;
    });
  }
}
