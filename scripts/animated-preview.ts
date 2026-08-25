#!/usr/bin/env bun
/**
 * Generates an animated HTML preview (CSS keyframe animation cycling through scenarios).
 * Usage: bun run scripts/animated-preview.ts [--out path/to/out.html]
 */

import { StatusParser } from '../src/statusParser.ts';
import { StatusRenderer } from '../src/statusRenderer.ts';
import { ConfigManager } from '../src/configManager.ts';
import * as fs from 'fs';
import * as path from 'path';

const NOW_SECS = Math.floor(Date.now() / 1000);
const RESET_DAILY = NOW_SECS + 4 * 3600;
const RESET_WEEKLY = NOW_SECS + 3 * 86400 + 12 * 3600;

const FRAMES: Array<{ label: string; input: object }> = [
  {
    label: 'Healthy session',
    input: {
      cwd: '/projects/my-app',
      model: { id: 'claude-sonnet-4-6', display_name: 'Sonnet 4.6' },
      context_window: { used_percentage: 22, total_input_tokens: 44000, context_window_size: 200000 },
      rate_limits: {
        five_hour: { used_percentage: 20, resets_at: RESET_DAILY },
        seven_day: { used_percentage: 12, resets_at: RESET_WEEKLY },
      },
    },
  },
  {
    label: 'Context growing',
    input: {
      cwd: '/projects/my-app',
      model: { id: 'claude-sonnet-4-6', display_name: 'Sonnet 4.6' },
      context_window: { used_percentage: 55, total_input_tokens: 110000, context_window_size: 200000 },
      rate_limits: {
        five_hour: { used_percentage: 42, resets_at: RESET_DAILY },
        seven_day: { used_percentage: 28, resets_at: RESET_WEEKLY },
      },
    },
  },
  {
    label: 'Context warning',
    input: {
      cwd: '/projects/my-app',
      model: { id: 'claude-opus-4-8', display_name: 'Opus 4.8' },
      context_window: { used_percentage: 71, total_input_tokens: 142000, context_window_size: 200000 },
      rate_limits: {
        five_hour: { used_percentage: 58, resets_at: RESET_DAILY },
        seven_day: { used_percentage: 35, resets_at: RESET_WEEKLY },
      },
    },
  },
  {
    label: 'Critical — act now',
    input: {
      cwd: '/projects/my-app',
      model: { id: 'claude-haiku-4-5-20251001', display_name: 'Haiku 4.5' },
      context_window: { used_percentage: 94, total_input_tokens: 188000, context_window_size: 200000 },
      rate_limits: {
        five_hour: { used_percentage: 88, resets_at: RESET_DAILY },
        seven_day: { used_percentage: 70, resets_at: RESET_WEEKLY },
      },
    },
  },
];

const FRAME_DURATION_S = 2.5;

class AnimatedPreviewGenerator {
  private readonly parser = new StatusParser();
  private readonly renderer = new StatusRenderer();
  private readonly config = ConfigManager.DEFAULT_CONFIG;

  generate(): string {
    const renderedFrames = FRAMES.map(f => ({
      label: f.label,
      html: this.renderFrame(f.input),
    }));

    const total = renderedFrames.length;
    const totalDuration = total * FRAME_DURATION_S;

    const keyframes = renderedFrames.map((_, i) => {
      const s = (i / total) * 100;
      const fi = s + (100 / total) * 0.1;
      const fo = ((i + 1) / total) * 100 - (100 / total) * 0.1;
      const e = ((i + 1) / total) * 100;
      return `  @keyframes f${i} {
    0%          { opacity:0 }
    ${s.toFixed(2)}%   { opacity:0 }
    ${fi.toFixed(2)}%  { opacity:1 }
    ${fo.toFixed(2)}%  { opacity:1 }
    ${e.toFixed(2)}%   { opacity:0 }
    100%        { opacity:0 }
  }`;
    }).join('\n');

    const frameDivs = renderedFrames.map((f, i) => {
      const lines = f.html.split('\n').map(l => `        <div class="term-line">${l}</div>`).join('\n');
      return `    <div class="frame" style="animation:f${i} ${totalDuration}s linear infinite">
      <div class="label">${this.escape(f.label)}</div>
      <div class="terminal">
${lines}
      </div>
    </div>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>harness-status-line</title>
<style>
* { box-sizing:border-box; margin:0; padding:0 }
body {
  background:#282a36;
  font-family:'JetBrains Mono','Cascadia Code','Fira Code',monospace;
  font-size:14px;
  padding:36px 40px;
  color:#f8f8f2;
  width:800px;
}
h1 { color:#bd93f9; font-size:16px; margin-bottom:24px; letter-spacing:.5px }
.stage { position:relative; height:100px }
.frame { position:absolute; top:0; left:0; width:100%; opacity:0 }
.label { color:#6272a4; font-size:11px; text-transform:uppercase; letter-spacing:1px; margin-bottom:8px }
.terminal {
  background:#21222c;
  border-radius:8px;
  padding:10px 16px;
  border:1px solid #44475a;
  display:inline-block;
  min-width:600px;
}
.term-line { line-height:1.9; white-space:pre }
${keyframes}
</style>
</head>
<body>
<h1>harness-status-line</h1>
<div class="stage">
${frameDivs}
</div>
</body>
</html>`;
  }

  private renderFrame(input: object): string {
    const status = this.parser.parse(JSON.stringify(input));
    const segments = this.parser.buildSegments(status, this.config);
    const ansiOutput = this.renderer.render(segments, 0, this.config);
    return ansiOutput.split('\n').map(line => this.ansiToHtml(line)).join('\n');
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
          if (bg) { styles.push(`background:${bg}`); }
          if (fg) { styles.push(`color:${fg}`); }
          if (bold) { styles.push('font-weight:bold'); }
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

  private escape(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

const outArg = process.argv.indexOf('--out');
const outPath = outArg !== -1 ? (process.argv[outArg + 1] ?? 'docs/animated.html') : 'docs/animated.html';

const generator = new AnimatedPreviewGenerator();
const html = generator.generate();
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, 'utf-8');
console.log(`Animated preview written to: ${outPath}`);
