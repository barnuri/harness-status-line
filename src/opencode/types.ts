export interface OpencodeMessageTokens {
  readonly total?: number;
  readonly input?: number;
  readonly output?: number;
  readonly reasoning?: number;
  readonly cache?: {
    readonly read?: number;
    readonly write?: number;
  };
}

export interface OpencodeMessage {
  readonly role?: string;
  readonly modelID?: string;
  readonly providerID?: string;
  readonly tokens?: OpencodeMessageTokens;
}

export interface OpencodeModel {
  readonly name?: string;
  readonly limit?: {
    readonly context?: number;
  };
}

export interface OpencodeProvider {
  readonly id?: string;
  readonly models?: Readonly<Record<string, OpencodeModel>>;
}

export interface OpencodeRoute {
  readonly name?: string;
  readonly params?: {
    readonly sessionID?: string;
  };
}

export interface OpencodeTuiState {
  readonly path?: {
    readonly directory?: string;
    readonly worktree?: string;
  };
  readonly provider?: ReadonlyArray<OpencodeProvider>;
  readonly session?: {
    readonly messages?: (sessionID: string) => ReadonlyArray<OpencodeMessage>;
  };
}

/** The narrow slice of opencode's `TuiPluginApi` this status line actually reads. */
export interface OpencodeTuiSlice {
  readonly app?: {
    readonly version?: string;
  };
  readonly route?: {
    readonly current?: OpencodeRoute;
  };
  readonly state?: OpencodeTuiState;
}
