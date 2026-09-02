import type { SubagentStatusLineInput, SubagentRowOutput, SubagentTask } from './types.ts';
import { formatTokenCount } from './shared/tokenFormat.ts';
import { resolveSessionSlug } from './shared/sessionSlug.ts';

export class SubagentStatusLineRenderer {
  private static readonly SLUG_ICON = '🏷 ';
  private static readonly SEPARATOR = ' · ';
  private static readonly TRUNCATION_SUFFIX = '…';
  private static readonly COST_ICON = '💵 ';
  private static readonly DOLLAR_DECIMALS = 2;

  parse(raw: string): SubagentStatusLineInput {
    if (!raw.trim()) {
      return {};
    }
    try {
      return JSON.parse(raw) as SubagentStatusLineInput;
    } catch {
      return {};
    }
  }

  hasActiveWorkflow(tasks: SubagentStatusLineInput['tasks']): boolean {
    if (!tasks) {
      return false;
    }
    return tasks.some(task => typeof task.type === 'string' && task.type.toLowerCase().includes('workflow'));
  }

  buildRows(input: SubagentStatusLineInput): SubagentRowOutput[] {
    const tasks = input.tasks;
    if (!tasks || tasks.length === 0) {
      return [];
    }

    const slug = resolveSessionSlug(input.session_id);
    const columns = input.columns;

    return tasks.map(task => ({
      id: task.id,
      content: this.buildRowContent(task, slug, columns),
    }));
  }

  private buildRowContent(task: SubagentTask, slug: string | null, columns: number | undefined): string {
    const parts: string[] = [];
    if (task.name) { parts.push(task.name); }
    if (task.description) { parts.push(task.description); }

    const effort = this.formatEffort(task.effort);
    if (effort) { parts.push(effort); }

    const tokens = this.formatTokens(task.tokenCount, task.contextWindowSize);
    if (tokens) { parts.push(tokens); }

    const cost = this.formatCost(task.costUsd);
    if (cost) { parts.push(cost); }

    if (slug) { parts.push(`${SubagentStatusLineRenderer.SLUG_ICON}${slug}`); }

    const content = parts.join(SubagentStatusLineRenderer.SEPARATOR);
    return this.truncate(content, columns);
  }

  private formatEffort(effort: SubagentTask['effort']): string | null {
    if (effort === undefined) { return null; }
    if (typeof effort === 'number') { return `${formatTokenCount(effort)} effort`; }
    return effort;
  }

  private formatTokens(tokenCount: number | undefined, contextWindowSize: number | undefined): string | null {
    if (typeof tokenCount !== 'number') { return null; }
    if (typeof contextWindowSize === 'number' && contextWindowSize > 0) {
      const percent = Math.round((tokenCount / contextWindowSize) * 100);
      return `${formatTokenCount(tokenCount)} (${percent}%)`;
    }
    return formatTokenCount(tokenCount);
  }

  private formatCost(costUsd: number | undefined): string | null {
    if (typeof costUsd !== 'number' || !Number.isFinite(costUsd)) { return null; }
    return `${SubagentStatusLineRenderer.COST_ICON}$${costUsd.toFixed(SubagentStatusLineRenderer.DOLLAR_DECIMALS)}`;
  }

  private truncate(content: string, columns: number | undefined): string {
    if (typeof columns !== 'number' || columns <= 0) {
      return content;
    }
    const codePoints = Array.from(content);
    if (codePoints.length <= columns) {
      return content;
    }
    const suffix = SubagentStatusLineRenderer.TRUNCATION_SUFFIX;
    return codePoints.slice(0, Math.max(0, columns - suffix.length)).join('') + suffix;
  }
}
