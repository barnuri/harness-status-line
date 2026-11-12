import { OpencodeToolCall } from './opencodeToolCall.ts';
import type { OpencodeSessionMessage, OpencodeTurn } from './types.ts';

/** Splits an opencode session's messages into turns: each user prompt plus the assistant messages after it. */
export class OpencodeTurns {
  private static readonly USER = 'user';
  private static readonly ASSISTANT = 'assistant';
  private static readonly SKILL_TOOL = 'Skill';
  private static readonly ERROR_REASON = 'error';
  private static readonly DEFAULT_REASON = 'stop';

  static split(messages: ReadonlyArray<OpencodeSessionMessage>, isSessionRunning: boolean): OpencodeTurn[] {
    const groups: { user: OpencodeSessionMessage; replies: OpencodeSessionMessage[] }[] = [];
    for (const message of messages) {
      if (message.type === OpencodeTurns.USER) {
        groups.push({ user: message, replies: [] });
        continue;
      }
      if (message.type === OpencodeTurns.ASSISTANT) {
        groups.at(-1)?.replies.push(message);
      }
    }
    return groups.map((group, index) => {
      const isLast = index === groups.length - 1;
      return OpencodeTurns.turn(group.user, group.replies, !isLast || !isSessionRunning);
    });
  }

  private static turn(user: OpencodeSessionMessage, replies: readonly OpencodeSessionMessage[], isComplete: boolean): OpencodeTurn {
    const calls = replies.flatMap((reply) =>
      (reply.content ?? []).map((part) => OpencodeToolCall.from(part)).filter((call) => call !== null),
    );
    const startedAt = user.time?.created ?? 0;
    const last = replies.at(-1);
    const endedAt = last?.time?.completed ?? last?.time?.created ?? startedAt;
    const attachedSkills = (user.skills ?? []).map((skill) => skill.name).filter((name): name is string => !!name);
    const toolSkills = calls
      .filter((call) => call.tool === OpencodeTurns.SKILL_TOOL && typeof call.input['skill'] === 'string')
      .map((call) => String(call.input['skill']));
    return {
      turnId: user.id ?? String(startedAt),
      prompt: user.text ?? '',
      startedAt,
      skills: [...new Set([...attachedSkills, ...toolSkills])],
      calls,
      answer: OpencodeTurns.answer(last),
      durationMs: Math.max(0, endedAt - startedAt),
      outputTokens: replies.reduce((sum, reply) => sum + (reply.tokens?.output ?? 0), 0),
      reason: last?.error ? OpencodeTurns.ERROR_REASON : (last?.finish ?? OpencodeTurns.DEFAULT_REASON),
      isComplete,
    };
  }

  private static answer(reply: OpencodeSessionMessage | undefined): string {
    return (reply?.content ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text ?? '')
      .join('\n')
      .trim();
  }
}
