import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class SetupWizard {
  private static readonly GLOBAL_SETTINGS_DIR = path.join(os.homedir(), '.claude');
  private static readonly DEFAULT_CURSOR_CONFIG_PATH = path.join(os.homedir(), '.cursor', 'cli-config.json');
  private static readonly COPILOT_HOME = process.env['COPILOT_HOME'] ?? path.join(os.homedir(), '.copilot');
  private static readonly DEFAULT_COPILOT_SETTINGS_PATH = path.join(SetupWizard.COPILOT_HOME, 'settings.json');
  private static readonly COPILOT_QUOTA_EXTENSION_NAME = 'harness-status-line-quota';
  private static readonly COPILOT_QUOTA_EXTENSION_FILES = [
    'extension.mjs',
    'ghCopilotQuotaClient.mjs',
    'quotaWriter.mjs',
  ];
  private static readonly COPILOT_QUOTA_EXTENSION_SOURCE = path.join(
    import.meta.dir,
    '..',
    'extensions',
    SetupWizard.COPILOT_QUOTA_EXTENSION_NAME,
  );
  private static readonly COMMAND = 'bunx barnuri/harness-status-line';
  private static readonly STATUS_LINE_TYPE = 'command';
  private static readonly INTERVAL_MS = 2000;
  private static readonly TIMEOUT_MS = 2000;
  private static readonly COPILOT_REFRESH_INTERVAL_SECONDS = 2;

  private readonly claudeSettingsPathOverride: string | undefined;
  private readonly cursorConfigPath: string;
  private readonly copilotSettingsPath: string;

  constructor(claudeSettingsPath?: string, cursorConfigPath?: string, copilotSettingsPath?: string) {
    this.claudeSettingsPathOverride = claudeSettingsPath;
    this.cursorConfigPath = cursorConfigPath ?? SetupWizard.DEFAULT_CURSOR_CONFIG_PATH;
    this.copilotSettingsPath = copilotSettingsPath ?? SetupWizard.DEFAULT_COPILOT_SETTINGS_PATH;
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

    this.installCopilotQuotaExtension();
    const copilotSettings = this.loadJsonObject(this.copilotSettingsPath);
    copilotSettings.statusLine = {
      command: SetupWizard.COMMAND,
      refreshInterval: SetupWizard.COPILOT_REFRESH_INTERVAL_SECONDS,
    };
    this.writeJsonObject(this.copilotSettingsPath, copilotSettings);

    console.log('✅ Status line configured');
    console.log(`   Claude settings: ${claudeSettingsPath}`);
    console.log(`   Cursor config: ${this.cursorConfigPath}`);
    console.log(`   Copilot CLI settings: ${this.copilotSettingsPath}`);
    console.log(`   Copilot quota extension: ${path.join(path.dirname(this.copilotSettingsPath), 'extensions', SetupWizard.COPILOT_QUOTA_EXTENSION_NAME)}`);
    console.log(`   Command: ${SetupWizard.COMMAND}`);
    console.log('\nRestart Claude Code, Cursor, or Copilot CLI to activate the status line.\n');
    console.log('Status line will show:');
    console.log('  📁 Current folder | 🤖 Model | 🧠 Effort | 📊 Context% | 🔢 Tokens | ⚙ Workflow | ⏱ Rate limits%\n');
  }

  private installCopilotQuotaExtension(): void {
    const extensionPath = path.join(
      path.dirname(this.copilotSettingsPath),
      'extensions',
      SetupWizard.COPILOT_QUOTA_EXTENSION_NAME,
    );
    fs.mkdirSync(extensionPath, { recursive: true });
    for (const fileName of SetupWizard.COPILOT_QUOTA_EXTENSION_FILES) {
      fs.copyFileSync(
        path.join(SetupWizard.COPILOT_QUOTA_EXTENSION_SOURCE, fileName),
        path.join(extensionPath, fileName),
      );
    }
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
