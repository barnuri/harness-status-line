import { join } from 'node:path';
import { SummarizeMod } from '../src/opencode/summarize/summarizeMod.ts';

// The summarize mod for herdr-mods (https://github.com/barnuri/herdr-mods): list this file in its `mods` option.
export default SummarizeMod.definition(join(import.meta.dir, 'view.ts'));
