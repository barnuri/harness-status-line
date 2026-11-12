import { describe, expect, it } from 'bun:test';
import { StatusParser } from '../src/statusParser.ts';
import { ConfigManager } from '../src/configManager.ts';
import type { StatusJSON } from '../src/types.ts';

describe('StatusParser auth label', () => {
  it('shows llm-hub for opencode hub payloads', () => {
    const parser = new StatusParser();
    const status: StatusJSON = {
      model: { id: 'hub/smart-auto-balance', display_name: 'Smart Auto' },
      api: { base_url: 'http://localhost:8888' },
      context_window: { tokens: 1, size: 100 },
    };

    const segments = parser.buildSegments(status, new ConfigManager().load());
    expect(segments.find((segment) => segment.label === 'auth')?.value).toBe('llm-hub');
  });
});

describe('StatusParser auth label for copilot-profile hub models', () => {
  it('shows llm-hub for a copilot model served by the hub', () => {
    const status: StatusJSON = {
      model: { id: 'copilot/claude-haiku-5-5', display_name: 'Haiku' },
      api: { base_url: 'http://localhost:8888' },
    };
    const segments = new StatusParser().buildSegments(status, new ConfigManager().load());
    expect(segments.find((segment) => segment.label === 'auth')?.value).toBe('llm-hub');
  });
});
