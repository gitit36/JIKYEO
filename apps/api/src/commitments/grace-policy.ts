export type ContractStrictnessMode = 'perfect' | 'realistic' | 'flexible';

/** Server-authoritative V1 grace fixture. Not client-overridable. */
export function allowedFailCount(mode: ContractStrictnessMode, totalOccurrences: number): number {
  const n = totalOccurrences;
  if (mode === 'perfect') return 0;
  if (mode === 'realistic') {
    if (n <= 3) return 0;
    if (n <= 14) return 1;
    return Math.min(3, Math.ceil(n * 0.1));
  }
  if (n <= 3) return 0;
  if (n <= 7) return 1;
  if (n <= 14) return 2;
  return Math.min(5, Math.ceil(n * 0.15));
}

export function parseStrictness(raw: unknown): ContractStrictnessMode {
  if (raw === 'perfect' || raw === 'realistic' || raw === 'flexible') return raw;
  return 'realistic';
}
