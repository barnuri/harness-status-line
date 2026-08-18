import { describe, it, expect } from 'bun:test';
import { writeWorkflowActiveState, readWorkflowActiveState } from '../src/shared/workflowActiveState.ts';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const stateDir = path.join(os.homedir(), '.claude', 'workflow-active');

function removeStateFile(sessionId: string): void {
  try {
    fs.unlinkSync(path.join(stateDir, sessionId));
  } catch {
    // already absent
  }
}

describe('writeWorkflowActiveState() / readWorkflowActiveState()', () => {
  it('reads back active:true immediately after writing', () => {
    const sessionId = 'test-workflow-active-write-read';
    writeWorkflowActiveState(sessionId, true, 1000);
    try {
      expect(readWorkflowActiveState(sessionId, 120, 1000)).toBe(true);
    } finally {
      removeStateFile(sessionId);
    }
  });

  it('reads back false when written as inactive', () => {
    const sessionId = 'test-workflow-active-write-inactive';
    writeWorkflowActiveState(sessionId, false, 1000);
    try {
      expect(readWorkflowActiveState(sessionId, 120, 1000)).toBe(false);
    } finally {
      removeStateFile(sessionId);
    }
  });

  it('returns false once the state is older than staleAfterSeconds', () => {
    const sessionId = 'test-workflow-active-stale';
    writeWorkflowActiveState(sessionId, true, 1000);
    try {
      expect(readWorkflowActiveState(sessionId, 120, 1000 + 121)).toBe(false);
    } finally {
      removeStateFile(sessionId);
    }
  });

  it('returns true when exactly at the staleness boundary', () => {
    const sessionId = 'test-workflow-active-boundary';
    writeWorkflowActiveState(sessionId, true, 1000);
    try {
      expect(readWorkflowActiveState(sessionId, 120, 1000 + 120)).toBe(true);
    } finally {
      removeStateFile(sessionId);
    }
  });

  it('returns false when no state file exists for the session', () => {
    expect(readWorkflowActiveState('test-workflow-active-no-file', 120)).toBe(false);
  });

  it('returns false when session id is undefined', () => {
    expect(readWorkflowActiveState(undefined, 120)).toBe(false);
  });

  it('returns false when the state file contains malformed JSON', () => {
    const sessionId = 'test-workflow-active-malformed';
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, sessionId), 'not json', 'utf-8');
    try {
      expect(readWorkflowActiveState(sessionId, 120, 1000)).toBe(false);
    } finally {
      removeStateFile(sessionId);
    }
  });
});
