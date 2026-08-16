import type { ContextWindow, OpencodeStatusInput, StatusJSON, UsageSnapshot } from '../types.ts';

export class OpencodeStatusSource {
  build(input: OpencodeStatusInput, snapshot: UsageSnapshot | null): StatusJSON {
    const contextWindow = this.buildContextWindow(input);

    return {
      ...(input.directory ? { cwd: input.directory, workspace: { current_dir: input.directory } } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
      ...(input.version ? { version: input.version } : {}),
      ...(contextWindow ? { context_window: contextWindow } : {}),
      ...(snapshot?.rate_limits ? { rate_limits: snapshot.rate_limits } : {}),
      ...(snapshot?.api ? { api: snapshot.api } : {}),
    };
  }

  private buildContextWindow(input: OpencodeStatusInput): ContextWindow | null {
    const hasTokens = typeof input.contextTokens === 'number';
    const hasSize = typeof input.contextWindowSize === 'number';
    if (!hasTokens && !hasSize) {
      return null;
    }
    return {
      ...(hasTokens ? { tokens: input.contextTokens } : {}),
      ...(hasSize ? { size: input.contextWindowSize } : {}),
    };
  }
}
