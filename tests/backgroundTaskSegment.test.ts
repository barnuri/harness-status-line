import { describe, expect, it } from 'bun:test';
import { BackgroundTaskSegment } from '../src/shared/backgroundTaskSegment.ts';
import { ConfigManager } from '../src/configManager.ts';

const colors = ConfigManager.DEFAULT_CONFIG.colors;
const segment = new BackgroundTaskSegment();

describe('BackgroundTaskSegment.build()', () => {
  it('returns null when nothing is running', () => {
    expect(segment.build({ commands: 0, agents: 0, monitors: 0 }, colors)).toBeNull();
  });

  it('lists each kind with singular and plural forms', () => {
    expect(segment.build({ commands: 1, agents: 2, monitors: 1 }, colors)?.value).toBe('2 agents · 1 monitor · 1 cmd');
    expect(segment.build({ commands: 3, agents: 0, monitors: 0 }, colors)?.value).toBe('3 cmds');
  });

  it('uses the background colors', () => {
    const built = segment.build({ commands: 0, agents: 1, monitors: 0 }, colors);
    expect(built?.fg).toEqual(colors.background.fg);
    expect(built?.bg).toEqual(colors.background.bg);
  });
});
