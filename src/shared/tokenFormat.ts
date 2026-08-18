const MILLION = 1_000_000;
const THOUSAND = 1_000;

/** Compact human-readable token count, e.g. 1500 -> "1.5k", 2_300_000 -> "2.3M". */
export function formatTokenCount(count: number): string {
  if (count >= MILLION) { return `${(count / MILLION).toFixed(1)}M`; }
  if (count >= THOUSAND) { return `${(count / THOUSAND).toFixed(1)}k`; }
  return String(count);
}
