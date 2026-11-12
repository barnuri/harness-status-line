import { describe, expect, it } from 'bun:test';
import { PayloadClassifier } from '../src/shared/payloadClassifier.ts';
import type { StatusJSON } from '../src/types.ts';

describe('PayloadClassifier', () => {
  const classifier = new PayloadClassifier({});
  const classify = (status: StatusJSON): string => classifier.classify(status);

  it('classifies a Cursor payload by its render width', () => {
    expect(classify({ render_width_chars: 120 } as StatusJSON)).toBe('cursor');
  });

  it('classifies a Copilot CLI payload by its usage fields', () => {
    expect(classify({ ai_used: 3 } as StatusJSON)).toBe('copilot-cli');
  });

  it('classifies a hub-qualified model id as claude-hub', () => {
    expect(classify({ model: { id: 'copilot/claude-opus-5-5', display_name: 'Opus' } } as StatusJSON)).toBe('claude-hub');
  });

  it('finds a hub id in the display name when the id is bare', () => {
    expect(classify({ model: { id: 'claude-opus-5-5', display_name: 'copilot/auto' } } as StatusJSON)).toBe('claude-hub');
  });

  it('classifies a hub-qualified model id with its own path as claude-hub', () => {
    expect(classify({ model: { id: 'llmgw/azure/gpt-5.4-mini', display_name: 'GPT' } } as StatusJSON)).toBe('claude-hub');
  });

  it('classifies an Anthropic model id as claude', () => {
    expect(classify({ model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' } } as StatusJSON)).toBe('claude');
  });

  it('classifies a bare Claude id as claude-hub when ANTHROPIC_BASE_URL points at a gateway', () => {
    const hub = new PayloadClassifier({ ANTHROPIC_BASE_URL: 'http://localhost:8888' });
    expect(hub.classify({ model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' } } as StatusJSON)).toBe('claude-hub');
  });

  it('keeps claude when ANTHROPIC_BASE_URL is Anthropic itself', () => {
    const direct = new PayloadClassifier({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' });
    expect(direct.classify({ model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' } } as StatusJSON)).toBe('claude');
  });
});
