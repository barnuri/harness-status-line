#!/usr/bin/env bun
/**
 * Generates an HTML preview page for the harness-status-line.
 * Usage: bun run scripts/preview.ts [--out path/to/out.html]
 * Writes a self-contained HTML file with all demo scenarios.
 */

import { StatusParser } from '../src/statusParser.ts';
import { StatusRenderer } from '../src/statusRenderer.ts';
import { ConfigManager } from '../src/configManager.ts';
import * as fs from 'fs';
import * as path from 'path';

const NOW_SECS = Math.floor(Date.now() / 1000);
const RESET_DAILY = NOW_SECS + 4 * 3600;
const RESET_WEEKLY = NOW_SECS + 3 * 86400 + 12 * 3600;

const SCENARIOS: Array<{ title: string; input: object; width?: number }> = [
  {
    title: 'Healthy — all quotas green',
    input: {
      cwd: '/Users/barnu/projects/my-cool-app',
      model: { id: 'claude-sonnet-4-6', display_name: 'Sonnet 4.6' },
      context_window: { used_percentage: 22, total_input_tokens: 44000, context_window_size: 200000 },
      rate_limits: {
        five_hour: { used_percentage: 20, resets_at: RESET_DAILY },
        seven_day: { used_percentage: 12, resets_at: RESET_WEEKLY },
      },
    },
  },
  {
    title: 'Warning — context at 65%',
    input: {
      cwd: '/Users/barnu/projects/my-cool-app',
      model: { id: 'claude-sonnet-4-6', display_name: 'Sonnet 4.6' },
      context_window: { used_percentage: 65, total_input_tokens: 130000, context_window_size: 200000 },
      rate_limits: {
        five_hour: { used_percentage: 58, resets_at: RESET_DAILY },
        seven_day: { used_percentage: 28, resets_at: RESET_WEEKLY },
      },
    },
  },
  {
    title: 'Critical — nearly exhausted',
    input: {
      cwd: '/Users/barnu/projects/my-cool-app',
      model: { id: 'claude-haiku-4-5-20251001', display_name: 'Haiku 4.5' },
      context_window: { used_percentage: 94, total_input_tokens: 188000, context_window_size: 200000 },
      rate_limits: {
        five_hour: { used_percentage: 88, resets_at: RESET_DAILY },
        seven_day: { used_percentage: 70, resets_at: RESET_WEEKLY },
      },
    },
  },
  {
    title: 'Wrapping — narrow terminal (80 cols)',
    input: {
      cwd: '/Users/barnu/projects/my-cool-app',
      model: { id: 'claude-sonnet-4-6', display_name: 'Sonnet 4.6' },
      context_window: { used_percentage: 42, total_input_tokens: 84000, context_window_size: 200000 },
      rate_limits: {
        five_hour: { used_percentage: 40, resets_at: RESET_DAILY },
        seven_day: { used_percentage: 20, resets_at: RESET_WEEKLY },
      },
    },
    width: 80,
  },
];

class PreviewGenerator {
  private readonly parser = new StatusParser();
  private readonly renderer = new StatusRenderer();
  private readonly config = ConfigManager.DEFAULT_CONFIG;

  generate(): string {
    const scenarios = SCENARIOS.map(s => this.renderScenario(s));
    return this.buildHtml(scenarios);
  }

  private renderScenario(scenario: { title: string; input: object; width?: number }): string {
    const status = this.parser.parse(JSON.stringify(scenario.input));
    const segments = this.parser.buildSegments(status, this.config);
    const ansiOutput = this.renderer.render(segments, scenario.width ?? 0, this.config);
    const htmlLines = ansiOutput.split('\n').map(line => this.ansiToHtml(line));
    return `
      <div class="scenario">
        <div class="scenario-title">${this.escape(scenario.title)}</div>
        <div class="terminal">
          ${htmlLines.map(l => `<div class="term-line">${l}</div>`).join('\n          ')}
        </div>
      </div>`;
  }

  private ansiToHtml(line: string): string {
    let html = '';
    let fg = '';
    let bg = '';
    let bold = false;
    let openSpan = false;

    const closeSpan = () => {
      if (openSpan) { html += '</span>'; openSpan = false; }
    };

    const parts = line.split(/\x1b\[([0-9;]*)m/);

    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        const text = parts[i] ?? '';
        if (text) {
          closeSpan();
          const styles: string[] = [];
          if (bg) styles.push(`background:${bg}`);
          if (fg) styles.push(`color:${fg}`);
          if (bold) styles.push('font-weight:bold');
          if (styles.length) {
            html += `<span style="${styles.join(';')}">`;
            openSpan = true;
          }
          html += this.escape(text);
        }
      } else {
        const code = parts[i] ?? '';
        if (code === '0' || code === '') {
          fg = ''; bg = ''; bold = false;
        } else {
          const nums = code.split(';').map(Number);
          if (nums[0] === 1) {
            bold = true;
          } else if (nums[0] === 38 && nums[1] === 2 && nums.length >= 5) {
            fg = `rgb(${nums[2]},${nums[3]},${nums[4]})`;
          } else if (nums[0] === 48 && nums[1] === 2 && nums.length >= 5) {
            bg = `rgb(${nums[2]},${nums[3]},${nums[4]})`;
          }
        }
      }
    }

    closeSpan();
    return html || '&nbsp;';
  }

  private buildHtml(scenarios: string[]): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>harness-status-line preview</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #282a36;
      font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace;
      font-size: 14px;
      padding: 32px;
      color: #f8f8f2;
    }
    h1 {
      color: #bd93f9;
      font-size: 18px;
      margin-bottom: 28px;
      letter-spacing: 0.5px;
    }
    .scenario {
      margin-bottom: 28px;
    }
    .scenario-title {
      color: #6272a4;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }
    .terminal {
      background: #21222c;
      border-radius: 8px;
      padding: 12px 16px;
      border: 1px solid #44475a;
      display: inline-block;
      min-width: 500px;
    }
    .term-line {
      line-height: 1.8;
      white-space: pre;
    }
  </style>
</head>
<body>
  <h1>harness-status-line</h1>
  ${scenarios.join('\n  ')}
</body>
</html>`;
  }

  private escape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

const outArg = process.argv.indexOf('--out');
const outPath = outArg !== -1 ? (process.argv[outArg + 1] ?? 'docs/preview.html') : 'docs/preview.html';

const generator = new PreviewGenerator();
const html = generator.generate();
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, 'utf-8');
console.log(`Preview written to: ${outPath}`);
