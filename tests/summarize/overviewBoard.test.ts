import { describe, expect, it } from 'bun:test';
import { OverviewBoard } from '../../claude-mods/summarize/hooks/overviewBoard.ts';

describe('OverviewBoard.card', () => {
  it('renders the question heading and the answer paragraph', () => {
    expect(OverviewBoard.card(2, 'Which DB?', 'Postgres.')).toBe('### Q2 — Which DB?\n\n**Answer:** Postgres.\n');
  });
});

describe('OverviewBoard.nextNumber', () => {
  it('is 1 for an empty board', () => {
    expect(OverviewBoard.nextNumber('')).toBe(1);
  });

  it('counts the existing question headings and adds one', () => {
    const text = '> Session: x\n\n## Questions and Answers\n\n### Q1 — A?\n\n**Answer:** a.\n\n---\n\n### Q2 — B?\n\n**Answer:** b.\n';
    expect(OverviewBoard.nextNumber(text)).toBe(3);
  });

  it('ignores headings that are not question cards', () => {
    expect(OverviewBoard.nextNumber('## Verify during implementation\n- tests\n')).toBe(1);
  });
});

describe('OverviewBoard.hasQuestion', () => {
  const text = '### Q1 — Which DB should we use?\n\n**Answer:** Postgres.\n';

  it('finds the question under any number', () => {
    expect(OverviewBoard.hasQuestion(text, 'Which DB should we use?')).toBe(true);
    expect(OverviewBoard.hasQuestion(text.replace('Q1', 'Q7'), 'Which DB should we use?')).toBe(true);
  });

  it('does not match a different question or a partial one', () => {
    expect(OverviewBoard.hasQuestion(text, 'Which DB?')).toBe(false);
    expect(OverviewBoard.hasQuestion(text, 'Which DB should we use? Also?')).toBe(false);
    expect(OverviewBoard.hasQuestion('**Answer:** Which DB should we use?', 'Which DB should we use?')).toBe(false);
  });
});

describe('OverviewBoard.questionLine', () => {
  it('collapses newlines and trims the prompt to one line', () => {
    expect(OverviewBoard.questionLine('  Why\n  does it fail?\n')).toBe('Why does it fail?');
  });

  it('caps the question at 200 characters with an ellipsis', () => {
    const line = OverviewBoard.questionLine(`${'a'.repeat(300)}?`);
    expect(line.length).toBe(200);
    expect(line.endsWith('…')).toBe(true);
  });
});

describe('OverviewBoard.answerSummary', () => {
  it('keeps the first three sentences on one line', () => {
    expect(OverviewBoard.answerSummary('One. Two!\nThree? Four. Five.')).toBe('One. Two! Three?');
  });

  it('keeps a short answer whole', () => {
    expect(OverviewBoard.answerSummary('Use Postgres.')).toBe('Use Postgres.');
  });

  it('caps the answer at 400 characters', () => {
    const line = OverviewBoard.answerSummary(`${'word '.repeat(200)}.`);
    expect(line.length).toBe(400);
    expect(line.endsWith('…')).toBe(true);
  });

  it('says so when the answer is empty', () => {
    expect(OverviewBoard.answerSummary('  \n ')).toBe('(no final answer)');
  });
});
