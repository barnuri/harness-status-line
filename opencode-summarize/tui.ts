import { SummarizePlugin } from '../src/opencode/summarize/summarizePlugin.ts';
import type { SummarizeContext } from '../src/opencode/summarize/summarizeContext.ts';

export default {
  id: 'summarize',
  setup(context: SummarizeContext): (() => void) | undefined {
    try {
      return new SummarizePlugin(context).register();
    } catch {
      /* never throw into the TUI — a broken recap must not take opencode down */
      return undefined;
    }
  },
};
