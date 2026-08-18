import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class SetupWizard {
  private static readonly GLOBAL_SETTINGS_DIR = path.join(os.homedir(), '.claude');

  async run(): Promise<void> {
    console.log('\n🚀 Claude Status Line — Setup\n');

    const settingsPath = this.resolveSettingsPath();
    const settings = this.loadSettings(settingsPath);

    const command = 'bunx barnuri/claude-status-line';

    settings.statusLine = {
      type: 'command',
      command,
      refreshInterval: 2000,
    };

    this.writeSettings(settingsPath, settings);

    console.log(`✅ Status line configured in: ${settingsPath}`);
    console.log(`   Command: ${command}`);
    console.log('\nRestart Claude Code to activate the status line.\n');
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

  private loadSettings(settingsPath: string): Record<string, unknown> {
    if (!fs.existsSync(settingsPath)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private writeSettings(settingsPath: string, settings: Record<string, unknown>): void {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  }
}
