import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class SetupWizard {
  private static readonly GLOBAL_SETTINGS_DIR = path.join(os.homedir(), '.claude');
  private static readonly DEFAULT_CURSOR_CONFIG_PATH = path.join(os.homedir(), '.cursor', 'cli-config.json');
  private static readonly COMMAND = 'bunx barnuri/harness-status-line';
  private static readonly STATUS_LINE_TYPE = 'command';
  private static readonly INTERVAL_MS = 2000;
  private static readonly TIMEOUT_MS = 2000;

  private readonly claudeSettingsPathOverride: string | undefined;
  private readonly cursorConfigPath: string;

  constructor(claudeSettingsPath?: string, cursorConfigPath?: string) {
    this.claudeSettingsPathOverride = claudeSettingsPath;
    this.cursorConfigPath = cursorConfigPath ?? SetupWizard.DEFAULT_CURSOR_CONFIG_PATH;
  }

  async run(): Promise<void> {
    console.log('\n🚀 Harness Status Line — Setup\n');

    const claudeSettingsPath = this.claudeSettingsPathOverride ?? this.resolveSettingsPath();
    const claudeSettings = this.loadJsonObject(claudeSettingsPath);
    claudeSettings.statusLine = {
      type: SetupWizard.STATUS_LINE_TYPE,
      command: SetupWizard.COMMAND,
      refreshInterval: SetupWizard.INTERVAL_MS,
    };
    this.writeJsonObject(claudeSettingsPath, claudeSettings);

    const cursorConfig = this.loadJsonObject(this.cursorConfigPath);
    cursorConfig.statusLine = {
      type: SetupWizard.STATUS_LINE_TYPE,
      command: SetupWizard.COMMAND,
      updateIntervalMs: SetupWizard.INTERVAL_MS,
      timeoutMs: SetupWizard.TIMEOUT_MS,
    };
    this.writeJsonObject(this.cursorConfigPath, cursorConfig);

    console.log('✅ Status line configured');
    console.log(`   Claude settings: ${claudeSettingsPath}`);
    console.log(`   Cursor config: ${this.cursorConfigPath}`);
    console.log(`   Command: ${SetupWizard.COMMAND}`);
    console.log('\nRestart Claude Code or Cursor to activate the status line.\n');
    console.log('Status line will show:');
    console.log('  📁 Current folder | 🤖 Model | 📊 Context% | 🔢 Tokens | 🧠 Effort | ⚙ Workflow | ⏱ Rate limits%\n');
  }

  private resolveSettingsPath(): string {
    const candidates = [
      path.join(process.cwd(), '.claude', 'settings.json'),
      path.join(SetupWizard.GLOBAL_SETTINGS_DIR, 'settings.json'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    const globalPath = candidates[1];
    if (!globalPath) {
      throw new Error('Could not determine Claude settings path');
    }

    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    return globalPath;
  }

  private loadJsonObject(filePath: string): Record<string, unknown> {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return {};
      }
      return parsed as Record<string, unknown>;
    } catch (err) {
      if (err instanceof Error) {
        return {};
      }
      throw err;
    }
  }

  private writeJsonObject(filePath: string, data: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }
}
