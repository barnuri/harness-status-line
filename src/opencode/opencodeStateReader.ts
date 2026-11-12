import type { OpencodeStatusInput } from '../types.ts';
import type { OpencodeMessage, OpencodeModel, OpencodeModelRef, OpencodeTuiSlice } from './types.ts';

export class OpencodeStateReader {
  private static readonly ASSISTANT_TYPE = 'assistant';
  private static readonly SESSION_ROUTE = 'session';

  read(api: OpencodeTuiSlice, slotSessionId?: string): OpencodeStatusInput {
    const sessionId = slotSessionId ?? this.routeSessionId(api);
    const messages = this.sessionMessages(api, sessionId);
    const message = this.latestAssistantMessage(messages);
    const modelRef = message?.model ?? this.selectedModel(api);
    const model = this.lookupModel(api, modelRef);
    const directory = this.call(() => api.data?.location?.default?.()?.directory);
    const contextTokens = this.contextTokens(message);
    const sessionCostUsd = this.sessionCost(api, sessionId, messages);
    const version = api.app?.version;

    return {
      ...(directory ? { directory } : {}),
      ...(version ? { version } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(modelRef?.id ? { model: model?.name ?? modelRef.id, modelId: modelRef.id } : {}),
      ...(modelRef?.providerID ? { providerId: modelRef.providerID } : {}),
      ...(typeof model?.limit?.context === 'number' ? { contextWindowSize: model.limit.context } : {}),
      ...(contextTokens !== null ? { contextTokens } : {}),
      ...(sessionCostUsd !== null ? { sessionCostUsd } : {}),
    };
  }

  private call<T>(read: () => T): T | undefined {
    try {
      return read();
    } catch {
      return undefined;
    }
  }

  private routeSessionId(api: OpencodeTuiSlice): string | undefined {
    const route = this.call(() => api.ui?.router?.current?.());
    return route?.type === OpencodeStateReader.SESSION_ROUTE ? route.sessionID : undefined;
  }

  private sessionMessages(api: OpencodeTuiSlice, sessionId: string | undefined): ReadonlyArray<OpencodeMessage> {
    if (!sessionId) {
      return [];
    }
    return this.call(() => api.data?.session?.message?.list?.(sessionId)) ?? [];
  }

  private selectedModel(api: OpencodeTuiSlice): OpencodeModelRef | undefined {
    const selected = this.call(() => api.ui?.model?.current?.());
    return selected ? { id: selected.modelID, providerID: selected.providerID } : undefined;
  }

  private latestAssistantMessage(list: ReadonlyArray<OpencodeMessage>): OpencodeMessage | null {
    for (let index = list.length - 1; index >= 0; index--) {
      const message = list[index];
      if (message?.type === OpencodeStateReader.ASSISTANT_TYPE) {
        return message;
      }
    }
    return null;
  }

  private sessionCost(
    api: OpencodeTuiSlice,
    sessionId: string | undefined,
    messages: ReadonlyArray<OpencodeMessage>,
  ): number | null {
    if (!sessionId || messages.length === 0) {
      return null;
    }
    const cost = this.call(() => api.data?.session?.cost?.(sessionId));
    return typeof cost === 'number' ? cost : null;
  }

  private lookupModel(api: OpencodeTuiSlice, ref: OpencodeModelRef | undefined): OpencodeModel | undefined {
    if (!ref?.id) {
      return undefined;
    }
    const models = this.call(() => api.data?.location?.model?.list?.()) ?? [];
    return (
      models.find((model) => model.modelID === ref.id && model.providerID === ref.providerID) ??
      models.find((model) => model.modelID === ref.id)
    );
  }

  private contextTokens(message: OpencodeMessage | null): number | null {
    const tokens = message?.tokens;
    if (!tokens) {
      return null;
    }
    const parts = [tokens.input, tokens.output, tokens.reasoning, tokens.cache?.read, tokens.cache?.write];
    const present = parts.filter((part): part is number => typeof part === 'number');
    if (present.length === 0) {
      return null;
    }
    return present.reduce((sum, part) => sum + part, 0);
  }
}
