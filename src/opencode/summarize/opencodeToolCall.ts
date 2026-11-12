import type { IterationRecapToolCall } from '../../../claude-mods/summarize/types';

export interface OpencodeToolPart {
  readonly type?: string;
  readonly name?: string;
  readonly state?: {
    readonly status?: string;
    readonly input?: Readonly<Record<string, unknown>>;
    readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
    readonly error?: unknown;
  };
}

/** Maps an opencode tool part to the Claude tool call the recap extractor reads. */
export class OpencodeToolCall {
  private static readonly TOOL_NAMES: Readonly<Record<string, string>> = {
    bash: 'Bash',
    shell: 'Bash',
    edit: 'Edit',
    write: 'Write',
    multiedit: 'MultiEdit',
    patch: 'Edit',
    read: 'Read',
    glob: 'Glob',
    grep: 'Grep',
    list: 'LS',
    skill: 'Skill',
    task: 'Agent',
    question: 'AskUserQuestion',
    todowrite: 'TodoWrite',
    webfetch: 'WebFetch',
    websearch: 'WebSearch',
  };
  private static readonly FINISHED = new Set(['completed', 'error']);
  private static readonly ERROR_STATUS = 'error';

  static from(part: OpencodeToolPart): Omit<IterationRecapToolCall, 'git'> | null {
    const status = part.state?.status;
    if (part.type !== 'tool' || !part.name || !status || !OpencodeToolCall.FINISHED.has(status)) {
      return null;
    }
    const tool = OpencodeToolCall.claudeName(part.name);
    const input = OpencodeToolCall.claudeInput(tool, part.state?.input ?? {});
    const isError = status === OpencodeToolCall.ERROR_STATUS;
    const text = (part.state?.content ?? [])
      .map((content) => (content.type === 'text' ? (content.text ?? '') : ''))
      .join('\n');
    const resultText = isError && text === '' ? OpencodeToolCall.errorText(part.state?.error) : text;
    return { tool, input, resultText, isError };
  }

  static claudeName(name: string): string {
    const known = OpencodeToolCall.TOOL_NAMES[name.toLowerCase()];
    if (known) {
      return known;
    }
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  private static claudeInput(tool: string, input: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const mapped: Record<string, unknown> = { ...input };
    const filePath = input['filePath'] ?? input['path'];
    if (mapped['file_path'] === undefined && typeof filePath === 'string') {
      mapped['file_path'] = filePath;
    }
    if (tool === 'Skill' && mapped['skill'] === undefined && typeof input['name'] === 'string') {
      mapped['skill'] = input['name'];
    }
    if (tool === 'Agent' && mapped['subagent_type'] === undefined && typeof input['agent'] === 'string') {
      mapped['subagent_type'] = input['agent'];
    }
    return mapped;
  }

  private static errorText(error: unknown): string {
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
      return error.message;
    }
    return '';
  }
}
