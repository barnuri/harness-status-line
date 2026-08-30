import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export class CursorAutoModelReader {
  private static readonly STORE_FILE_NAME = 'store.db';
  private static readonly BLOB_SCAN_ROWS = 40;
  private static readonly MODEL_NAME_PATTERN = /"modelName":"([^"]+)"/;
  private static readonly CURSOR_PREFIX = 'cursor-';
  private static readonly FAMILY_LABELS: ReadonlyArray<readonly [string, string]> = [
    ['grok', 'Grok'],
    ['composer', 'Composer'],
    ['claude', 'Claude'],
    ['sonnet', 'Claude'],
    ['opus', 'Claude'],
    ['haiku', 'Claude'],
    ['gpt', 'GPT'],
    ['o3', 'GPT'],
    ['o4', 'GPT'],
    ['codex', 'Codex'],
    ['gemini', 'Gemini'],
    ['deepseek', 'DeepSeek'],
    ['kimi', 'Kimi'],
    ['qwen', 'Qwen'],
  ];

  private readonly chatsRoot: string;

  constructor(chatsRoot?: string) {
    this.chatsRoot = chatsRoot ?? CursorAutoModelReader.defaultChatsRoot();
  }

  readResolvedLabel(sessionId: string | undefined): string | null {
    const modelName = this.readResolvedModelName(sessionId);
    if (modelName === null) {
      return null;
    }
    return CursorAutoModelReader.toLabel(modelName);
  }

  readResolvedModelName(sessionId: string | undefined): string | null {
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      return null;
    }
    const storePath = this.findStorePath(sessionId);
    if (storePath === null) {
      return null;
    }
    return CursorAutoModelReader.readNewestModelName(storePath);
  }

  private findStorePath(sessionId: string): string | null {
    const workspaces = CursorAutoModelReader.listWorkspaceDirs(this.chatsRoot);
    for (const workspace of workspaces) {
      const candidate = path.join(this.chatsRoot, workspace, sessionId, CursorAutoModelReader.STORE_FILE_NAME);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  private static listWorkspaceDirs(chatsRoot: string): readonly string[] {
    try {
      return fs.readdirSync(chatsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (err) {
      if (err instanceof Error) {
        return [];
      }
      throw err;
    }
  }

  private static readNewestModelName(storePath: string): string | null {
    let db: Database | null = null;
    try {
      db = new Database(storePath, { readonly: true });
      const rows = db.query<{ data: string | null }, [number]>(
        'select cast(data as text) as data from blobs where rowid > (select max(rowid) - ? from blobs) order by rowid desc',
      ).all(CursorAutoModelReader.BLOB_SCAN_ROWS);
      for (const row of rows) {
        const match = CursorAutoModelReader.MODEL_NAME_PATTERN.exec(row.data ?? '');
        if (match?.[1]) {
          return match[1];
        }
      }
      return null;
    } catch (err) {
      if (err instanceof Error) {
        return null;
      }
      throw err;
    } finally {
      db?.close();
    }
  }

  private static toLabel(modelName: string): string {
    const stripped = modelName.startsWith(CursorAutoModelReader.CURSOR_PREFIX)
      ? modelName.slice(CursorAutoModelReader.CURSOR_PREFIX.length)
      : modelName;
    const lower = stripped.toLowerCase();
    for (const [needle, label] of CursorAutoModelReader.FAMILY_LABELS) {
      if (lower.includes(needle)) {
        return label;
      }
    }
    return CursorAutoModelReader.capitalize(stripped.split(/[-_.]/)[0] ?? stripped);
  }

  private static capitalize(word: string): string {
    if (word.length === 0) {
      return word;
    }
    return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
  }

  private static defaultChatsRoot(): string {
    return path.join(os.homedir(), '.cursor', 'chats');
  }
}
