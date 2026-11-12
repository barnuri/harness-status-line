import { ConfigManager } from '../configManager.ts';
import { StatusParser } from '../statusParser.ts';
import { SpendEnricher } from '../shared/spendEnricher.ts';
import { UsageSnapshotReader } from '../shared/usageSnapshot.ts';
import { OpencodeHubEnricher } from './hubEnricher.ts';
import { OpencodeStatusSource } from './statusSource.ts';
import type { OpencodeStatusInput } from '../types.ts';

/**
 * Builds the opencode status segments in a fresh process, like Claude Code runs its status-line command:
 * stdin is the `OpencodeStatusInput` JSON, stdout is the `Segment[]` JSON. The TUI plugin only spawns this,
 * so edits to anything under it apply on the next rebuild without restarting opencode.
 */
async function main(): Promise<void> {
  const input = JSON.parse(await Bun.stdin.text()) as OpencodeStatusInput;
  const nowMs = Date.now();
  const base = new SpendEnricher().apply(new OpencodeStatusSource().build(input, new UsageSnapshotReader().read(nowMs)), nowMs);
  const hub = new OpencodeHubEnricher();
  const status = hub.applies(input) ? await hub.apply(input, base) : base;
  process.stdout.write(JSON.stringify(new StatusParser().buildSegments(status, new ConfigManager().load())));
}

main().catch((err: unknown) => {
  process.stderr.write(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
