import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const GITHUB_API_URL = 'https://api.github.com/repos/barnuri/harness-status-line/commits/master';
const STATE_DIR = path.join(os.homedir(), '.cache', 'harness-status-line');
const STATE_FILE = path.join(STATE_DIR, 'last-update.json');
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface UpdateState {
  readonly lastCheckedAt: number;
  readonly lastSeenSha: string;
}

export class UpdateChecker {
  checkAndUpdateInBackground(): void {
    if (!this.isDue()) {
      return;
    }
    void this.runCheck();
  }

  private isDue(): boolean {
    const state = this.loadState();
    if (!state) {
      return true;
    }
    return Date.now() - state.lastCheckedAt >= CHECK_INTERVAL_MS;
  }

  private async runCheck(): Promise<void> {
    const knownSha = this.loadState()?.lastSeenSha ?? '';
    try {
      const latestSha = await this.fetchLatestSha();
      this.saveState({ lastCheckedAt: Date.now(), lastSeenSha: latestSha });
      if (knownSha && knownSha !== latestSha) {
        this.spawnReload();
      }
    } catch {
      // silently ignore network errors — update checks are best-effort
    }
  }

  private async fetchLatestSha(): Promise<string> {
    const response = await fetch(GITHUB_API_URL, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'harness-status-line-updater' },
    });
    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }
    const data = await response.json() as { sha?: string };
    if (!data.sha) {
      throw new Error('No sha in GitHub API response');
    }
    return data.sha;
  }

  private spawnReload(): void {
    Bun.spawn(['bunx', '--reload', 'barnuri/harness-status-line', '--noop'], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  }

  private loadState(): UpdateState | null {
    if (!fs.existsSync(STATE_FILE)) {
      return null;
    }
    try {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(raw) as UpdateState;
    } catch {
      return null;
    }
  }

  private saveState(state: UpdateState): void {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf-8');
  }
}
