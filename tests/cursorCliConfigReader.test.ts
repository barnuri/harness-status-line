import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CursorCliConfigReader } from '../src/shared/cursorCliConfigReader.ts';

describe('CursorCliConfigReader', () => {
  const dirs: string[] = [];

  afterEach(() => {
    delete process.env['CURSOR_TEAM_ID'];
    delete process.env['CURSOR_AUTH_ID'];
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('reads teamId and authId from cli-config.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsl-cli-config-'));
    dirs.push(dir);
    const configPath = path.join(dir, 'cli-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      authInfo: {
        teamId: 13283281,
        authId: 'auth0|user_01KZXFSJK6FSRNH90J90VP378B',
      },
    }));
    const reader = new CursorCliConfigReader(configPath);
    expect(reader.readAuthInfo()).toEqual({
      teamId: 13283281,
      authId: 'auth0|user_01KZXFSJK6FSRNH90J90VP378B',
    });
  });

  it('prefers environment overrides', () => {
    process.env['CURSOR_TEAM_ID'] = '99';
    process.env['CURSOR_AUTH_ID'] = 'auth0|override';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsl-cli-config-'));
    dirs.push(dir);
    const configPath = path.join(dir, 'cli-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      authInfo: { teamId: 1, authId: 'auth0|file' },
    }));
    const reader = new CursorCliConfigReader(configPath);
    expect(reader.readAuthInfo()).toEqual({ teamId: 99, authId: 'auth0|override' });
  });
});
