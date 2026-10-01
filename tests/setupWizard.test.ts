import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SetupWizard } from '../src/setupWizard.ts';

describe('SetupWizard', () => {
  let tempDir: string;
  let claudePath: string;
  let cursorPath: string;
  let copilotPath: string;
  let logs: string[];
  let originalLog: typeof console.log;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-wizard-'));
    claudePath = path.join(tempDir, 'claude', 'settings.json');
    cursorPath = path.join(tempDir, 'cursor', 'cli-config.json');
    copilotPath = path.join(tempDir, 'copilot', 'settings.json');
    logs = [];
    originalLog = console.log;
    console.log = (...args: unknown[]): void => {
      logs.push(args.map(String).join(' '));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const readJson = (filePath: string): Record<string, unknown> => {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  };

  const runWizard = async (
    claudeSettingsPath: string = claudePath,
    cursorConfigPath: string = cursorPath,
    copilotSettingsPath: string = copilotPath,
  ): Promise<void> => {
    await new SetupWizard(claudeSettingsPath, cursorConfigPath, copilotSettingsPath).run();
  };

  it('writes Claude settings with refreshInterval 2000 and the bunx command', async () => {
    await runWizard();

    const settings = readJson(claudePath);
    const statusLine = settings.statusLine as Record<string, unknown>;
    expect(statusLine.type).toBe('command');
    expect(statusLine.command).toBe('bunx barnuri/harness-status-line');
    expect(statusLine.refreshInterval).toBe(2000);
  });

  it('writes Cursor cli-config.json with updateIntervalMs, timeoutMs, and no padding', async () => {
    await runWizard();

    const config = readJson(cursorPath);
    const statusLine = config.statusLine as Record<string, unknown>;
    expect(statusLine.type).toBe('command');
    expect(statusLine.command).toBe('bunx barnuri/harness-status-line');
    expect(statusLine.updateIntervalMs).toBe(2000);
    expect(statusLine.timeoutMs).toBe(2000);
    expect(statusLine).not.toHaveProperty('padding');
  });

  it('preserves unrelated sibling keys and replaces statusLine in Cursor config', async () => {
    fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
    fs.writeFileSync(
      cursorPath,
      JSON.stringify({
        theme: 'dark',
        featureFlags: { x: true },
        statusLine: { type: 'old', padding: 4, command: 'stale' },
      }),
      'utf-8',
    );

    await runWizard();

    const config = readJson(cursorPath);
    expect(config.theme).toBe('dark');
    expect(config.featureFlags).toEqual({ x: true });
    const statusLine = config.statusLine as Record<string, unknown>;
    expect(statusLine.type).toBe('command');
    expect(statusLine.command).toBe('bunx barnuri/harness-status-line');
    expect(statusLine.updateIntervalMs).toBe(2000);
    expect(statusLine).not.toHaveProperty('padding');
  });

  it('writes valid Cursor statusLine when existing JSON is malformed', async () => {
    fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
    fs.writeFileSync(cursorPath, '{ this is not json', 'utf-8');

    await runWizard();

    const config = readJson(cursorPath);
    const statusLine = config.statusLine as Record<string, unknown>;
    expect(statusLine.type).toBe('command');
    expect(statusLine.command).toBe('bunx barnuri/harness-status-line');
    expect(statusLine.updateIntervalMs).toBe(2000);
    expect(statusLine.timeoutMs).toBe(2000);
  });

  it('creates parent directories if they are missing', async () => {
    const nestedClaude = path.join(tempDir, 'nested', 'deep', '.claude', 'settings.json');
    const nestedCursor = path.join(tempDir, 'nested', 'deep', '.cursor', 'cli-config.json');
    expect(fs.existsSync(path.dirname(nestedClaude))).toBe(false);
    expect(fs.existsSync(path.dirname(nestedCursor))).toBe(false);

    await runWizard(nestedClaude, nestedCursor);

    expect(fs.existsSync(nestedClaude)).toBe(true);
    expect(fs.existsSync(nestedCursor)).toBe(true);
  });

  it('writes Copilot CLI settings with command and refreshInterval in seconds', async () => {
    await runWizard();

    const settings = readJson(copilotPath);
    const statusLine = settings.statusLine as Record<string, unknown>;
    expect(statusLine.command).toBe('bunx barnuri/harness-status-line');
    expect(statusLine.refreshInterval).toBe(2);
  });

  it('installs the Copilot quota extension beside the user settings', async () => {
    await runWizard();

    const extensionDir = path.join(path.dirname(copilotPath), 'extensions', 'harness-status-line-quota');
    expect(fs.readFileSync(path.join(extensionDir, 'extension.mjs'), 'utf-8')).toContain('assistant.usage');
    expect(fs.existsSync(path.join(extensionDir, 'quotaWriter.mjs'))).toBe(true);
  });

  it('preserves unrelated sibling keys in Copilot CLI settings', async () => {
    fs.mkdirSync(path.dirname(copilotPath), { recursive: true });
    fs.writeFileSync(
      copilotPath,
      JSON.stringify({ hooks: { SessionStart: [] }, statusLine: { command: 'stale' } }),
      'utf-8',
    );

    await runWizard();

    const settings = readJson(copilotPath);
    expect(settings.hooks).toEqual({ SessionStart: [] });
    const statusLine = settings.statusLine as Record<string, unknown>;
    expect(statusLine.command).toBe('bunx barnuri/harness-status-line');
    expect(statusLine.refreshInterval).toBe(2);
  });

  it('logs Status line configured', async () => {
    await runWizard();

    const combined = logs.join('\n');
    expect(combined).toContain('Status line configured');
  });

  it('writes Claude statusLine when Cursor path is a different temp file', async () => {
    const otherCursor = path.join(tempDir, 'other-cursor', 'cli-config.json');

    await runWizard(claudePath, otherCursor);

    expect(fs.existsSync(claudePath)).toBe(true);
    expect(fs.existsSync(otherCursor)).toBe(true);
    const claudeSettings = readJson(claudePath);
    const claudeStatusLine = claudeSettings.statusLine as Record<string, unknown>;
    expect(claudeStatusLine.refreshInterval).toBe(2000);
    expect(claudeStatusLine.command).toBe('bunx barnuri/harness-status-line');
    const cursorConfig = readJson(otherCursor);
    const cursorStatusLine = cursorConfig.statusLine as Record<string, unknown>;
    expect(cursorStatusLine.updateIntervalMs).toBe(2000);
    expect(cursorStatusLine.timeoutMs).toBe(2000);
  });
});
