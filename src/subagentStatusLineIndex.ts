#!/usr/bin/env bun
import { SubagentStatusLineRenderer } from './subagentStatusLine.ts';
import { writeWorkflowActiveState } from './shared/workflowActiveState.ts';

class SubagentStatusLineApplication {
  async run(): Promise<void> {
    const raw = await this.readStdin();
    const renderer = new SubagentStatusLineRenderer();
    const input = renderer.parse(raw);
    const rows = renderer.buildRows(input);

    if (input.session_id) {
      writeWorkflowActiveState(input.session_id, renderer.hasActiveWorkflow(input.tasks));
    }

    for (const row of rows) {
      process.stdout.write(`${JSON.stringify(row)}\n`);
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

new SubagentStatusLineApplication().run().catch(err => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`harness-subagent-status-line error: ${message}\n`);
  process.exit(1);
});
