export interface OpencodeTokenUsage {
  readonly input?: number;
  readonly output?: number;
  readonly reasoning?: number;
  readonly cache?: {
    readonly read?: number;
    readonly write?: number;
  };
}

export interface OpencodeModelRef {
  readonly id?: string;
  readonly providerID?: string;
}

export interface OpencodeMessage {
  readonly type?: string;
  readonly model?: OpencodeModelRef;
  readonly tokens?: OpencodeTokenUsage;
  readonly cost?: number;
}

export interface OpencodeModel {
  readonly modelID?: string;
  readonly providerID?: string;
  readonly name?: string;
  readonly limit?: {
    readonly context?: number;
  };
}

/** The narrow slice of opencode 2's TUI plugin `Context` this status line reads. */
export interface OpencodeTuiSlice {
  readonly app?: {
    readonly version?: string;
  };
  readonly data?: {
    readonly session?: {
      readonly cost?: (sessionID: string) => number;
      readonly message?: {
        readonly list?: (sessionID: string) => ReadonlyArray<OpencodeMessage>;
      };
    };
    readonly location?: {
      readonly default?: () => { readonly directory?: string } | undefined;
      readonly model?: {
        readonly list?: () => ReadonlyArray<OpencodeModel> | undefined;
      };
    };
  };
  readonly ui?: {
    readonly router?: {
      readonly current?: () => { readonly type: string; readonly sessionID?: string } | undefined;
    };
    readonly model?: {
      readonly current?: () => { readonly providerID: string; readonly modelID: string } | undefined;
    };
  };
}
