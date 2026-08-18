import { describe, it, expect } from 'bun:test';
import { SubagentStatusLineRenderer } from '../src/subagentStatusLine.ts';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const renderer = new SubagentStatusLineRenderer();
const slugDir = path.join(os.homedir(), '.claude', 'session-slugs');

function writeSlugFile(sessionId: string, slug: string): void {
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, sessionId), slug + '\n', 'utf-8');
}

function removeSlugFile(sessionId: string): void {
  try {
    fs.unlinkSync(path.join(slugDir, sessionId));
  } catch {
    // already absent
  }
}

// ────────────────────────────────────────────────────────
// parse()
// ────────────────────────────────────────────────────────

describe('SubagentStatusLineRenderer.parse()', () => {
  it('returns empty object for empty string', () => {
    expect(renderer.parse('')).toEqual({});
  });

  it('returns empty object for invalid JSON', () => {
    expect(renderer.parse('{not json}')).toEqual({});
  });

  it('parses valid JSON', () => {
    expect(renderer.parse('{"session_id": "abc"}')).toEqual({ session_id: 'abc' });
  });
});

// ────────────────────────────────────────────────────────
// buildRows()
// ────────────────────────────────────────────────────────

describe('SubagentStatusLineRenderer.buildRows()', () => {
  it('returns an empty array when tasks is absent', () => {
    expect(renderer.buildRows({})).toEqual([]);
  });

  it('returns an empty array when tasks is empty', () => {
    expect(renderer.buildRows({ tasks: [] })).toEqual([]);
  });

  it('includes the session slug in each row when a slug file exists', () => {
    const sessionId = 'test-subagent-slug-session';
    writeSlugFile(sessionId, '2026-08-16-effort-status-line');
    try {
      const rows = renderer.buildRows({
        session_id: sessionId,
        tasks: [{ id: 't1', name: 'bug-hunter', description: 'scan for bugs' }],
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe('t1');
      expect(rows[0]?.content).toContain('🏷 2026-08-16-effort-status-line');
    } finally {
      removeSlugFile(sessionId);
    }
  });

  it('omits the slug segment when no slug file exists for the session', () => {
    const rows = renderer.buildRows({
      session_id: 'test-subagent-no-slug',
      tasks: [{ id: 't1', name: 'bug-hunter' }],
    });
    expect(rows[0]?.content).not.toContain('🏷');
  });

  it('omits the slug segment when session_id is absent', () => {
    const rows = renderer.buildRows({ tasks: [{ id: 't1', name: 'bug-hunter' }] });
    expect(rows[0]?.content).not.toContain('🏷');
  });

  it('includes the string effort level', () => {
    const rows = renderer.buildRows({ tasks: [{ id: 't1', name: 'x', effort: 'high' }] });
    expect(rows[0]?.content).toContain('high');
  });

  it('formats a numeric effort budget', () => {
    const rows = renderer.buildRows({ tasks: [{ id: 't1', name: 'x', effort: 12_000 }] });
    expect(rows[0]?.content).toContain('12.0k effort');
  });

  it('formats tokenCount with contextWindowSize as a percentage', () => {
    const rows = renderer.buildRows({
      tasks: [{ id: 't1', name: 'x', tokenCount: 50_000, contextWindowSize: 200_000 }],
    });
    expect(rows[0]?.content).toContain('50.0k (25%)');
  });

  it('formats tokenCount alone when contextWindowSize is absent', () => {
    const rows = renderer.buildRows({ tasks: [{ id: 't1', name: 'x', tokenCount: 1500 }] });
    expect(rows[0]?.content).toContain('1.5k');
  });

  it('omits parts whose source field is absent', () => {
    const rows = renderer.buildRows({ tasks: [{ id: 't1' }] });
    expect(rows[0]?.content).toBe('');
  });

  it('builds one row per task, each keyed by its own id', () => {
    const rows = renderer.buildRows({
      tasks: [
        { id: 't1', name: 'first' },
        { id: 't2', name: 'second' },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: 't1', content: 'first' });
    expect(rows[1]).toEqual({ id: 't2', content: 'second' });
  });

  it('truncates content longer than columns with an ellipsis', () => {
    const rows = renderer.buildRows({
      columns: 10,
      tasks: [{ id: 't1', name: 'a very long task name that overflows' }],
    });
    expect(rows[0]?.content).toHaveLength(10);
    expect(rows[0]?.content.endsWith('…')).toBe(true);
  });

  it('does not truncate content that fits within columns', () => {
    const rows = renderer.buildRows({ columns: 80, tasks: [{ id: 't1', name: 'short' }] });
    expect(rows[0]?.content).toBe('short');
  });

  it('truncates without splitting a surrogate pair (e.g. the slug emoji)', () => {
    // With this exact name/slug/columns combination, a naive UTF-16-code-unit slice
    // cuts directly between the slug icon's surrogate pair (verified against the
    // pre-fix implementation), so this deterministically catches a regression.
    const sessionId = 'test-subagent-truncate-surrogate';
    writeSlugFile(sessionId, 'a-fairly-long-session-slug-name');
    try {
      const rows = renderer.buildRows({
        session_id: sessionId,
        columns: 55,
        tasks: [{ id: 't1', name: 'a very long task name that overflows the row width' }],
      });
      const content = rows[0]?.content ?? '';
      expect(content.isWellFormed()).toBe(true);
      expect(content.endsWith('…')).toBe(true);
    } finally {
      removeSlugFile(sessionId);
    }
  });
});

// ────────────────────────────────────────────────────────
// hasActiveWorkflow()
// ────────────────────────────────────────────────────────

describe('SubagentStatusLineRenderer.hasActiveWorkflow()', () => {
  it('returns false when tasks is undefined', () => {
    expect(renderer.hasActiveWorkflow(undefined)).toBe(false);
  });

  it('returns false when no task has a workflow type', () => {
    expect(renderer.hasActiveWorkflow([{ id: 't1', type: 'agent' }])).toBe(false);
  });

  it('returns true when a task type contains "workflow" (case-insensitive)', () => {
    expect(renderer.hasActiveWorkflow([{ id: 't1', type: 'Workflow' }])).toBe(true);
  });

  it('returns true when at least one of several tasks is a workflow type', () => {
    expect(renderer.hasActiveWorkflow([{ id: 't1', type: 'agent' }, { id: 't2', type: 'workflow_agent' }])).toBe(true);
  });

  it('returns false when task.type is absent', () => {
    expect(renderer.hasActiveWorkflow([{ id: 't1' }])).toBe(false);
  });
});
