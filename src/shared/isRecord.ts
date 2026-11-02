// True for a non-null, non-array object, so parsed JSON can be indexed by string key.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
