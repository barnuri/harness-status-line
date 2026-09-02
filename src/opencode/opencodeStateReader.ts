import type { OpencodeStatusInput } from '../types.ts';
import type { OpencodeMessage, OpencodeModel, OpencodeTuiSlice } from './types.ts';

export class OpencodeStateReader {
  private static readonly ASSISTANT_ROLE = 'assistant';

  read(api: OpencodeTuiSlice): OpencodeStatusInput {
    const messages = this.sessionMessages(api);
    const message = this.latestAssistantMessage(messages);
    const model = this.resolveModel(api, message);
    const directory = this.directory(api);
    const sessionId = this.sessionId(api);
    const contextTokens = this.contextTokens(message);
    const sessionCostUsd = this.sessionCost(messages);
    const version = api.app?.version;

    return {
      ...(directory ? { directory } : {}),
      ...(version ? { version } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(model.name ? { model: model.name } : {}),
      ...(model.contextLimit !== null ? { contextWindowSize: model.contextLimit } : {}),
      ...(contextTokens !== null ? { contextTokens } : {}),
      ...(sessionCostUsd !== null ? { sessionCostUsd } : {}),
    };
  }

  private directory(api: OpencodeTuiSlice): string | undefined {
    return api.state?.path?.directory ?? api.state?.path?.worktree;
  }

  private sessionId(api: OpencodeTuiSlice): string | undefined {
    const route = api.route?.current;
    if (route?.name !== 'session') {
      return undefined;
    }
    return route.params?.sessionID;
  }

  private sessionMessages(api: OpencodeTuiSlice): ReadonlyArray<OpencodeMessage> {
    const sessionID = this.sessionId(api);
    const messages = api.state?.session?.messages;
    if (!sessionID || typeof messages !== 'function') {
      return [];
    }
    try {
      return messages(sessionID) ?? [];
    } catch {
      return [];
    }
  }

  private latestAssistantMessage(list: ReadonlyArray<OpencodeMessage>): OpencodeMessage | null {
    for (let index = list.length - 1; index >= 0; index--) {
      const message = list[index];
      if (message?.role === OpencodeStateReader.ASSISTANT_ROLE) {
        return message;
      }
    }
    return null;
  }

  private sessionCost(list: ReadonlyArray<OpencodeMessage>): number | null {
    const costs = list
      .filter((message) => message?.role === OpencodeStateReader.ASSISTANT_ROLE)
      .map((message) => message.cost)
      .filter((cost): cost is number => typeof cost === 'number');
    if (costs.length === 0) {
      return null;
    }
    return costs.reduce((sum, cost) => sum + cost, 0);
  }

  private resolveModel(
    api: OpencodeTuiSlice,
    message: OpencodeMessage | null,
  ): { name: string | undefined; contextLimit: number | null } {
    if (!message?.modelID) {
      return { name: undefined, contextLimit: null };
    }

    const model = this.lookupModel(api, message);
    return {
      name: model?.name ?? message.modelID,
      contextLimit: typeof model?.limit?.context === 'number' ? model.limit.context : null,
    };
  }

  private lookupModel(api: OpencodeTuiSlice, message: OpencodeMessage): OpencodeModel | undefined {
    const providers = api.state?.provider ?? [];
    const modelID = message.modelID;
    if (!modelID) {
      return undefined;
    }

    const matching = providers.find((provider) => provider.id === message.providerID);
    const fromMatching = matching?.models?.[modelID];
    if (fromMatching) {
      return fromMatching;
    }

    for (const provider of providers) {
      const model = provider.models?.[modelID];
      if (model) {
        return model;
      }
    }
    return undefined;
  }

  private contextTokens(message: OpencodeMessage | null): number | null {
    const tokens = message?.tokens;
    if (!tokens) {
      return null;
    }
    if (typeof tokens.total === 'number') {
      return tokens.total;
    }

    const parts = [tokens.input, tokens.output, tokens.reasoning, tokens.cache?.read, tokens.cache?.write];
    const present = parts.filter((part): part is number => typeof part === 'number');
    if (present.length === 0) {
      return null;
    }
    return present.reduce((sum, part) => sum + part, 0);
  }
}
