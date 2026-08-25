import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface CursorAuthInfo {
  readonly teamId: number;
  readonly authId: string;
}

export class CursorCliConfigReader {
  private static readonly TEAM_ID_ENV = 'CURSOR_TEAM_ID';
  private static readonly AUTH_ID_ENV = 'CURSOR_AUTH_ID';

  private readonly configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath ?? CursorCliConfigReader.defaultConfigPath();
  }

  readAuthInfo(): CursorAuthInfo | null {
    const fromEnv = this.readFromEnv();
    if (fromEnv) {
      return fromEnv;
    }
    return this.readFromFile();
  }

  private readFromEnv(): CursorAuthInfo | null {
    const teamIdRaw = process.env[CursorCliConfigReader.TEAM_ID_ENV];
    const authId = process.env[CursorCliConfigReader.AUTH_ID_ENV];
    const teamId = typeof teamIdRaw === 'string' ? Number.parseInt(teamIdRaw, 10) : NaN;
    if (!Number.isFinite(teamId) || typeof authId !== 'string' || authId.length === 0) {
      return null;
    }
    return { teamId, authId };
  }

  private readFromFile(): CursorAuthInfo | null {
    if (!fs.existsSync(this.configPath)) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      const authInfo = (parsed as Record<string, unknown>)['authInfo'];
      if (typeof authInfo !== 'object' || authInfo === null || Array.isArray(authInfo)) {
        return null;
      }
      const record = authInfo as Record<string, unknown>;
      const teamId = this.asTeamId(record['teamId']);
      const authId = this.asAuthId(record['authId']);
      if (teamId === null || authId === null) {
        return null;
      }
      return { teamId, authId };
    } catch (err) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    }
  }

  private asTeamId(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private asAuthId(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private static defaultConfigPath(): string {
    return path.join(os.homedir(), '.cursor', 'cli-config.json');
  }
}
