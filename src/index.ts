#!/usr/bin/env bun
import * as path from 'path';
import * as os from 'os';
import { StatusParser } from './statusParser.ts';
import { StatusRenderer } from './statusRenderer.ts';
import { SetupWizard } from './setupWizard.ts';
import { UpdateChecker } from './updateChecker.ts';
import { ConfigManager } from './configManager.ts';
import { ConfigCli } from './configCli.ts';

class Application {
  async run(): Promise<void> {
    const args = process.argv.slice(2);

    if (args.includes('--noop')) {
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
    const status = parser.parse(raw);
    const segments = parser.buildSegments(status, config);

    const terminalWidth = this.resolveTerminalWidth();
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
