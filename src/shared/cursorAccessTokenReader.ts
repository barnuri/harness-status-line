import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export class CursorAccessTokenReader {
  private static readonly TOKEN_KEY = 'cursorAuth/accessToken';
  private static readonly ENV_TOKEN_KEY = 'CURSOR_SESSION_TOKEN';
  private static readonly KEYCHAIN_SERVICE = 'cursor-access-token';
  private static readonly KEYCHAIN_ACCOUNT = 'cursor-user';

  private readonly databasePath: string;
  private readonly allowKeychain: boolean;

  constructor(databasePath?: string) {
    this.allowKeychain = databasePath === undefined;
    this.databasePath = databasePath ?? CursorAccessTokenReader.defaultDatabasePath();
  }

  read(): string | null {
    const fromEnv = process.env[CursorAccessTokenReader.ENV_TOKEN_KEY];
    if (typeof fromEnv === 'string' && fromEnv.length > 0) {
      return fromEnv;
    }
    return this.readFromDatabase() ?? (this.allowKeychain ? this.readFromKeychain() : null);
  }

  private readFromDatabase(): string | null {
    if (!fs.existsSync(this.databasePath)) {
      return null;
    }
    try {
      const db = new Database(this.databasePath, { readonly: true });
      try {
        const row = db.query('SELECT value FROM ItemTable WHERE key = ?').get(CursorAccessTokenReader.TOKEN_KEY) as
          | { value: unknown }
          | null;
        return this.asToken(row?.value);
      } finally {
        db.close();
      }
    } catch (err) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    }
  }

  private readFromKeychain(): string | null {
    if (process.platform !== 'darwin') {
      return null;
    }
    try {
      const result = Bun.spawnSync([
        'security',
        'find-generic-password',
        '-s',
        CursorAccessTokenReader.KEYCHAIN_SERVICE,
        '-a',
        CursorAccessTokenReader.KEYCHAIN_ACCOUNT,
        '-w',
      ], { stdout: 'pipe', stderr: 'pipe' });
      if (result.exitCode !== 0 || !result.stdout) {
        return null;
      }
      const token = result.stdout.toString('utf-8').trim();
      return token.length > 0 ? token : null;
    } catch (err) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    }
  }

  private asToken(value: unknown): string | null {
    if (typeof value !== 'string' || value.length === 0) {
      return null;
    }
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        const parsed: unknown = JSON.parse(value);
        return typeof parsed === 'string' && parsed.length > 0 ? parsed : null;
      } catch (err) {
        if (err instanceof Error) {
          return value;
        }
        throw err;
      }
    }
    return value;
  }

  private static defaultDatabasePath(): string {
    if (process.platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    }
    if (process.platform === 'win32') {
      const appData = process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming');
      return path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    }
    return path.join(os.homedir(), '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  }
}
