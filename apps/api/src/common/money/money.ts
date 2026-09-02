/**
 * Money in JIKYEO is **integer Korean won (KRW)**, represented as `bigint`.
 *
 * Rules:
 * - Never use `number` for money. `number` cannot safely represent > 2^53 and
 *   accumulates rounding errors under arithmetic.
 * - Never use `float`.
 * - Never mix currencies (MVP is KRW-only).
 * - Money is created and validated at the boundaries; internally you may pass
 *   `bigint` directly, but always through `Money` helpers when parsing input.
 */

export type Currency = 'KRW';
export const KRW: Currency = 'KRW';

export class MoneyError extends Error {}

export const Money = {
  zero(): bigint {
    return 0n;
  },

  /** Parse a user-supplied non-negative integer amount. */
  fromNumber(n: number): bigint {
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new MoneyError(`Money must be an integer, got: ${n}`);
    }
    if (n < 0) {
      throw new MoneyError(`Money must be non-negative, got: ${n}`);
    }
    return BigInt(n);
  },

  fromString(s: string): bigint {
    if (!/^\d+$/.test(s)) {
      throw new MoneyError(`Money string must be digits only, got: ${s}`);
    }
    return BigInt(s);
  },

  add(a: bigint, b: bigint): bigint {
    return a + b;
  },

  sub(a: bigint, b: bigint): bigint {
    return a - b;
  },

  mul(a: bigint, n: number): bigint {
    if (!Number.isInteger(n) || n < 0) {
      throw new MoneyError(`Money multiplier must be non-negative integer, got: ${n}`);
    }
    return a * BigInt(n);
  },

  eq(a: bigint, b: bigint): boolean {
    return a === b;
  },

  gte(a: bigint, b: bigint): boolean {
    return a >= b;
  },

  lte(a: bigint, b: bigint): boolean {
    return a <= b;
  },

  /** Formats KRW with thousands separator, e.g. `formatKrw(15000n) === "15,000원"`. */
  formatKrw(a: bigint): string {
    const s = a.toString();
    const withCommas = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${withCommas}원`;
  },
};
