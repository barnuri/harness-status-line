#!/usr/bin/env bun
import * as path from 'path';
import * as os from 'os';
import { StatusParser } from './statusParser.ts';
import { StatusRenderer } from './statusRenderer.ts';
import { SetupWizard } from './setupWizard.ts';
import { UpdateChecker } from './updateChecker.ts';
import { ConfigManager } from './configManager.ts';
import { ConfigCli } from './configCli.ts';
import { CursorStatusEnricher } from './shared/cursorStatusEnricher.ts';
import { CopilotQuotaEnricher } from './shared/copilotQuotaEnricher.ts';
import { LlmHubEnricher } from './shared/llmHubEnricher.ts';
import { ClaudeUsageClient } from './shared/claudeUsageClient.ts';
import { ClaudeUsageRefresher } from './shared/claudeUsageRefresher.ts';
import { SpendEnricher } from './shared/spendEnricher.ts';
import { SpendLedger } from './shared/spendLedger.ts';
import { PayloadClassifier } from './shared/payloadClassifier.ts';
import type { StatusJSON } from './types.ts';

class Application {
  async run(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.includes('--noop')) {
      return;
    }

    if (args.includes(ClaudeUsageRefresher.COMMAND_FLAG)) {
      const ledger = new SpendLedger();
      try {
        await new ClaudeUsageClient(undefined, ledger).refresh();
      } finally {
        ledger.releaseApiRefresh();
      }
      return;
    }

    if (args[0] === 'config') {
      new ConfigCli().run(args.slice(1));
      return;
    }

    if (args.includes('--setup') || args.includes('--config') || process.stdin.isTTY) {
      await new SetupWizard().run();
      return;
    }

    const config = new ConfigManager().load();
    const raw = await this.readStdin();
    if (process.env['CLAUDE_STATUS_DEBUG']) {
      const debugPath = path.join(os.homedir(), '.claude', 'status-debug.json');
      void Bun.write(debugPath, raw).catch((err: unknown) => {
        if (err instanceof Error) { process.stderr.write(`[debug] write failed: ${err.message}\n`); }
      });
    }
    const parser = new StatusParser();
    const parsed = parser.parse(raw);
    const status = await this.enrich(parsed);
    const segments = parser.buildSegments(status, config);

    const payloadWidth = status.render_width_chars;
    const terminalWidth =
      typeof payloadWidth === 'number' && payloadWidth > 0
        ? Math.floor(payloadWidth)
        : this.resolveTerminalWidth();
    const output = new StatusRenderer().render(segments, terminalWidth, config);

    if (output) {
      process.stdout.write(output + '\n');
    }

    new UpdateChecker().checkAndUpdateInBackground();
  }

  private resolveTerminalWidth(): number {
    if (process.stdout.columns) {
      return process.stdout.columns;
    }
    const envCols = parseInt(process.env['COLUMNS'] ?? '', 10);
    return isNaN(envCols) ? 120 : envCols;
  }

  // Each enricher builds stores and clients, so build only the one this harness needs.
  private async enrich(status: StatusJSON): Promise<StatusJSON> {
    switch (new PayloadClassifier().classify(status)) {
      case 'cursor':
        return new CursorStatusEnricher().apply(status);
      case 'copilot-cli':
        return new CopilotQuotaEnricher().apply(status);
      case 'claude-hub':
        return new LlmHubEnricher().apply(status);
      case 'claude':
        return new SpendEnricher().apply(status);
    }
  }

  private async readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
}

new Application().run().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`harness-status-line error: ${message}\n`);
  process.exit(1);
});
