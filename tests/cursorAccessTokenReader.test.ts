import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CursorAccessTokenReader } from '../src/shared/cursorAccessTokenReader.ts';

describe('CursorAccessTokenReader', () => {
  let dir: string;
  let dbPath: string;
  const previous = process.env['CURSOR_SESSION_TOKEN'];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-token-'));
    dbPath = path.join(dir, 'state.vscdb');
    delete process.env['CURSOR_SESSION_TOKEN'];
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env['CURSOR_SESSION_TOKEN'];
    } else {
      process.env['CURSOR_SESSION_TOKEN'] = previous;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeToken(value: string): void {
    const db = new Database(dbPath);
    db.run('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
    db.run('INSERT INTO ItemTable (key, value) VALUES (?, ?)', ['cursorAuth/accessToken', value]);
    db.close();
  }

  it('prefers CURSOR_SESSION_TOKEN over the database', () => {
    writeToken('db-token');
    process.env['CURSOR_SESSION_TOKEN'] = 'env-token';
    expect(new CursorAccessTokenReader(dbPath).read()).toBe('env-token');
  });

  it('reads the token from ItemTable', () => {
    writeToken('db-token');
    expect(new CursorAccessTokenReader(dbPath).read()).toBe('db-token');
  });

  it('unwraps a JSON-quoted token value', () => {
    writeToken('"quoted-token"');
    expect(new CursorAccessTokenReader(dbPath).read()).toBe('quoted-token');
  });

  it('returns null when the database is missing', () => {
    expect(new CursorAccessTokenReader(path.join(dir, 'absent.vscdb')).read()).toBeNull();
  });
});
