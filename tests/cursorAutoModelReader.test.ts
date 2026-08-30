import { afterEach, describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CursorAutoModelReader } from '../src/shared/cursorAutoModelReader.ts';

describe('CursorAutoModelReader', () => {
  const dirs: string[] = [];

  const makeChatsRoot = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsl-cursor-chats-'));
    dirs.push(dir);
    return dir;
  };

  const writeStore = (chatsRoot: string, sessionId: string, blobs: readonly string[]): void => {
    const sessionDir = path.join(chatsRoot, 'workspacehash', sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    const db = new Database(path.join(sessionDir, 'store.db'));
    db.run('create table blobs (id TEXT PRIMARY KEY, data BLOB)');
    blobs.forEach((data, index) => {
      db.run('insert into blobs (id, data) values (?, ?)', [`blob-${index}`, data]);
    });
    db.close();
  };

  const blobWithModel = (modelName: string): string =>
    `{"role":"assistant","providerOptions":{"cursor":{"modelName":"${modelName}"}}}`;

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it('reads the newest modelName from the session store', () => {
    const chatsRoot = makeChatsRoot();
    writeStore(chatsRoot, 'session-1', [
      blobWithModel('composer-2.5-fast'),
      blobWithModel('cursor-grok-4.6-high'),
    ]);
    const reader = new CursorAutoModelReader(chatsRoot);
    expect(reader.readResolvedModelName('session-1')).toBe('cursor-grok-4.6-high');
  });

  it('maps model families to short labels', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['cursor-grok-4.6-high', 'Grok'],
      ['composer-2.5-fast', 'Composer'],
      ['claude-4.5-sonnet', 'Claude'],
      ['gpt-5-codex', 'GPT'],
      ['gemini-3-pro', 'Gemini'],
      ['mistral-large', 'Mistral'],
    ];
    for (const [modelName, expected] of cases) {
      const chatsRoot = makeChatsRoot();
      writeStore(chatsRoot, 'session-1', [blobWithModel(modelName)]);
      expect(new CursorAutoModelReader(chatsRoot).readResolvedLabel('session-1')).toBe(expected);
    }
  });

  it('returns null when the store has no resolved model', () => {
    const chatsRoot = makeChatsRoot();
    writeStore(chatsRoot, 'session-1', ['{"role":"user","content":"hi"}']);
    const reader = new CursorAutoModelReader(chatsRoot);
    expect(reader.readResolvedLabel('session-1')).toBeNull();
  });

  it('returns null for an unknown session id', () => {
    const chatsRoot = makeChatsRoot();
    writeStore(chatsRoot, 'session-1', [blobWithModel('cursor-grok-4.6-high')]);
    const reader = new CursorAutoModelReader(chatsRoot);
    expect(reader.readResolvedLabel('session-2')).toBeNull();
  });

  it('returns null for a missing or empty session id', () => {
    const reader = new CursorAutoModelReader(makeChatsRoot());
    expect(reader.readResolvedLabel(undefined)).toBeNull();
    expect(reader.readResolvedLabel('')).toBeNull();
  });

  it('returns null when the chats root does not exist', () => {
    const reader = new CursorAutoModelReader(path.join(os.tmpdir(), 'hsl-cursor-chats-missing'));
    expect(reader.readResolvedLabel('session-1')).toBeNull();
  });
});
