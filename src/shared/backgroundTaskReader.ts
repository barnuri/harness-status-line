import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isRecord } from './isRecord.ts';

export type BackgroundKind = 'command' | 'agent' | 'monitor';

export interface BackgroundCounts {
  readonly commands: number;
  readonly agents: number;
  readonly monitors: number;
}

interface OpenItem {
  readonly kind: BackgroundKind;
  // Monitors end at their stated expiry unless a status notice closes them first. Epoch ms.
  readonly expiresAt?: number;
}

interface CacheFile {
  offset: number;
  open: Record<string, OpenItem>;
}

/**
 * Counts the background commands, background agents and monitors a Claude Code session has running.
 * Claude Code writes no hook for these, so the reader follows the transcript: a start is a tool result
 * ("Command running in background", "Async agent launched", "Monitor started"), an end is a
 * `<task-notification>` with the same tool-use id and a `<status>`. The read is incremental and the
 * open set is cached per session, so each 2 s refresh reads only the new transcript lines.
 */
export class BackgroundTaskReader {
  static readonly NONE: BackgroundCounts = { commands: 0, agents: 0, monitors: 0 };
  private static readonly CACHE_DIR = path.join(os.homedir(), '.claude', 'session-background');
  // Caps the work of one refresh. A long transcript catches up over a few refreshes.
  private static readonly MAX_BYTES_PER_READ = 8 * 1024 * 1024;
  private static readonly COMMAND_START = 'Command running in background';
  private static readonly AGENT_START = 'Async agent launched';
  private static readonly MONITOR_START = 'Monitor started';
  private static readonly EXPIRY = /expires in (?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/;

  constructor(private readonly cacheDir: string = BackgroundTaskReader.CACHE_DIR) {}

  read(sessionId: string | undefined, transcriptPath: string | undefined, nowMs: number = Date.now()): BackgroundCounts {
    if (!sessionId || !transcriptPath || sessionId.includes('/')) {
      return BackgroundTaskReader.NONE;
    }
    const cache = this.loadCache(sessionId);
    try {
      const size = fs.statSync(transcriptPath).size;
      if (size < cache.offset) {
        cache.offset = 0;
        cache.open = {};
      }
      this.consume(transcriptPath, cache, size, nowMs);
      this.saveCache(sessionId, cache);
    } catch {
      // No transcript yet, or unreadable: show what the cache last knew.
    }
    return this.count(cache.open, nowMs);
  }

  private consume(transcriptPath: string, cache: CacheFile, size: number, nowMs: number): void {
    const length = Math.min(size - cache.offset, BackgroundTaskReader.MAX_BYTES_PER_READ);
    if (length <= 0) {
      return;
    }
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      fs.readSync(fd, buffer, 0, length, cache.offset);
    } finally {
      fs.closeSync(fd);
    }
    const lastNewline = buffer.lastIndexOf(0x0a);
    if (lastNewline < 0) {
      return;
    }
    // Only complete lines count; a partial last line is read again on the next refresh.
    for (const line of buffer.subarray(0, lastNewline).toString('utf-8').split('\n')) {
      this.applyLine(line, cache, nowMs);
    }
    cache.offset += lastNewline + 1;
  }

  private applyLine(line: string, cache: CacheFile, nowMs: number): void {
    if (!line.includes('tool_result') && !line.includes('task-notification')) {
      return;
    }
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(row)) {
      return;
    }
    if (row['type'] === 'queue-operation') {
      this.applyNotice(row['content'], cache);
      return;
    }
    const content = isRecord(row['message']) ? row['message']['content'] : undefined;
    // The same notice also arrives as a user message whose content is a plain string.
    if (typeof content === 'string') {
      this.applyNotice(content, cache);
      return;
    }
    if (!Array.isArray(content)) {
      return;
    }
    const at = typeof row['timestamp'] === 'string' ? Date.parse(row['timestamp']) : nowMs;
    for (const item of content) {
      if (isRecord(item) && item['type'] === 'tool_result') {
        this.applyStart(item, cache, Number.isNaN(at) ? nowMs : at);
      }
    }
  }

  private applyStart(item: Record<string, unknown>, cache: CacheFile, atMs: number): void {
    const id = item['tool_use_id'];
    const text = this.resultText(item['content']);
    if (typeof id !== 'string' || !text) {
      return;
    }
    // Some results are stored as a serialized array string, so match the marker near the start.
    const head = text.slice(0, 120);
    if (head.includes(BackgroundTaskReader.COMMAND_START)) {
      cache.open[id] = { kind: 'command' };
    } else if (head.includes(BackgroundTaskReader.AGENT_START)) {
      cache.open[id] = { kind: 'agent' };
    } else if (head.includes(BackgroundTaskReader.MONITOR_START)) {
      const expiresAt = this.expiry(text, atMs);
      cache.open[id] = expiresAt === null ? { kind: 'monitor' } : { kind: 'monitor', expiresAt };
    }
  }

  // A status notice ends the task. A monitor's event notice has no status and keeps it open.
  private applyNotice(content: unknown, cache: CacheFile): void {
    if (typeof content !== 'string' || !content.includes('<task-notification>')) {
      return;
    }
    const id = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(content)?.[1];
    if (id && /<status>[^<]+<\/status>/.test(content)) {
      delete cache.open[id];
    }
  }

  private expiry(text: string, startMs: number): number | null {
    const match = BackgroundTaskReader.EXPIRY.exec(text);
    if (!match) {
      return null;
    }
    const [, hours, minutes, seconds] = match;
    const totalSeconds = Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
    return totalSeconds > 0 ? startMs + totalSeconds * 1000 : null;
  }

  private count(open: Record<string, OpenItem>, nowMs: number): BackgroundCounts {
    let commands = 0;
    let agents = 0;
    let monitors = 0;
    for (const item of Object.values(open)) {
      if (item.expiresAt !== undefined && item.expiresAt <= nowMs) {
        continue;
      }
      if (item.kind === 'command') { commands += 1; }
      if (item.kind === 'agent') { agents += 1; }
      if (item.kind === 'monitor') { monitors += 1; }
    }
    return { commands, agents, monitors };
  }

  private cacheFile(sessionId: string): string {
    return path.join(this.cacheDir, `${sessionId}.json`);
  }

  private loadCache(sessionId: string): CacheFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.cacheFile(sessionId), 'utf-8')) as Partial<CacheFile>;
      if (typeof parsed.offset === 'number' && isRecord(parsed.open)) {
        return { offset: parsed.offset, open: parsed.open as Record<string, OpenItem> };
      }
    } catch {
      // No cache yet.
    }
    return { offset: 0, open: {} };
  }

  // Write then rename, so a concurrent refresh never reads a half-written cache.
  private saveCache(sessionId: string, cache: CacheFile): void {
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      const file = this.cacheFile(sessionId);
      const tmp = `${file}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(cache), 'utf-8');
      fs.renameSync(tmp, file);
    } catch {
      // Best-effort: a missing cache only means the next refresh re-reads the transcript.
    }
  }

  private resultText(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      const first = content.find((item) => isRecord(item) && item['type'] === 'text');
      return isRecord(first) && typeof first['text'] === 'string' ? first['text'] : '';
    }
    return '';
  }
}
