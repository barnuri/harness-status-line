import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export class CopilotEffortReader {
  private static readonly EVENTS_FILE_NAME = 'events.jsonl';
  private static readonly MODEL_CHANGE_MARKER = '"type":"session.model_change"';
  private static readonly SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

  private readonly sessionStateRoot: string;

  constructor(sessionStateRoot?: string) {
    this.sessionStateRoot = sessionStateRoot ?? path.join(os.homedir(), '.copilot', 'session-state');
  }

  // The statusLine payload has no effort field, so read the user's latest model-picker choice.
  readEffort(sessionId: string | undefined): string | null {
    if (typeof sessionId !== 'string' || !CopilotEffortReader.SESSION_ID_PATTERN.test(sessionId)) { return null; }
    const content = this.readEvents(sessionId);
    if (content === null) { return null; }
    const lines = content.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i] ?? '';
      if (!line.includes(CopilotEffortReader.MODEL_CHANGE_MARKER)) { continue; }
      return CopilotEffortReader.parseEffort(line);
    }
    return null;
  }

  private readEvents(sessionId: string): string | null {
    const eventsPath = path.join(this.sessionStateRoot, sessionId, CopilotEffortReader.EVENTS_FILE_NAME);
    try {
      return fs.readFileSync(eventsPath, 'utf8');
    } catch (err) {
      if (err instanceof Error) { return null; }
      throw err;
    }
  }

  private static parseEffort(line: string): string | null {
    try {
      const event: unknown = JSON.parse(line);
      if (typeof event !== 'object' || event === null) { return null; }
      const data = (event as { data?: unknown }).data;
      if (typeof data !== 'object' || data === null) { return null; }
      const effort = (data as { reasoningEffort?: unknown }).reasoningEffort;
      return typeof effort === 'string' && effort.length > 0 ? effort : null;
    } catch (err) {
      if (err instanceof Error) { return null; }
      throw err;
    }
  }
}
