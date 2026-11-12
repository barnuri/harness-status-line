import type { JSX } from '@opentui/solid/jsx-runtime';

interface SessionEvent {
  readonly data: { readonly sessionID: string };
}

type TurnEventType =
  | 'session.execution.started'
  | 'session.execution.succeeded'
  | 'session.execution.failed'
  | 'session.execution.interrupted';

interface SummarizeCommand {
  readonly id: string;
  readonly title: string;
  readonly group: string;
  readonly description: string;
  readonly palette: true;
  readonly slash: { readonly name: string; readonly arguments: true };
  readonly run: (input?: string) => void;
}

/** The narrow slice of opencode 2's TUI plugin `Context` the summarize plugin uses. */
export interface SummarizeContext {
  readonly options?: Readonly<Record<string, unknown>>;
  readonly storage: {
    memory(
      key: string,
      options: { readonly initial: { revision: number } },
    ): readonly [{ readonly revision: number }, (mutation: (draft: { revision: number }) => void) => void];
  };
  readonly data: {
    readonly on: (type: TurnEventType, handler: (event: SessionEvent) => void) => () => void;
    readonly session: {
      status(sessionID: string): 'idle' | 'running';
      readonly message: {
        list(sessionID: string): ReadonlyArray<unknown>;
        sync(sessionID: string): Promise<void>;
      };
    };
    readonly location: { default(): { readonly directory: string } | undefined };
  };
  readonly keymap: { layer(factory: () => { readonly mode: 'global'; readonly commands: readonly SummarizeCommand[] }): void };
  readonly ui: {
    readonly slot: (claim: {
      readonly append: 'sidebar.content' | 'session.composer.top' | 'session.panel' | 'app';
      readonly render: (input: { readonly sessionID: string; readonly name?: string }) => JSX.Element | null;
    }) => () => void;
    readonly panel: {
      open(name: string, options?: { readonly presentation?: 'panel' | 'fullscreen' }): boolean;
      current(): { readonly name: string; readonly sessionID: string } | undefined;
    };
    readonly router: { current(): { readonly type: string; readonly sessionID?: string } };
    readonly toast: { show(toast: { readonly title?: string; readonly message: string; readonly variant: 'info' }): void };
  };
}
