const MILLION = 1_000_000;
const THOUSAND = 1_000;
const PAIR_DECIMALS = 2;

/** Compact human-readable token count, e.g. 1500 -> "1.5k", 2_300_000 -> "2.3M". */
export function formatTokenCount(count: number): string {
  if (count >= MILLION) { return `${(count / MILLION).toFixed(1)}M`; }
  if (count >= THOUSAND) { return `${(count / THOUSAND).toFixed(1)}k`; }
  return String(count);
}

/**
 * Used/total token pair scaled to a single unit picked from the total, so the two
 * numbers read as one ratio, e.g. 420_000 of 1_000_000 -> "0.42M/1M".
 */
export function formatTokenPair(used: number, total: number): string {
  if (total <= 0) { return formatTokenCount(used); }
  const divisor = total >= MILLION ? MILLION : total >= THOUSAND ? THOUSAND : 1;
  const unit = divisor === MILLION ? 'M' : divisor === THOUSAND ? 'k' : '';
  return `${scaleToUnit(used, divisor)}${unit}/${scaleToUnit(total, divisor)}${unit}`;
}

function scaleToUnit(count: number, divisor: number): string {
  if (divisor === 1) { return String(Math.round(count)); }
  return trimTrailingZeros((count / divisor).toFixed(PAIR_DECIMALS));
}

function trimTrailingZeros(value: string): string {
  if (!value.includes('.')) { return value; }
  return value.replace(/\.?0+$/, '');
}
