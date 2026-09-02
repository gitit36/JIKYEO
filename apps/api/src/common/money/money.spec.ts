import { Money, MoneyError } from './money';

describe('Money', () => {
  it('rejects negative or non-integer amounts', () => {
    expect(() => Money.fromNumber(-1)).toThrow(MoneyError);
    expect(() => Money.fromNumber(1.5)).toThrow(MoneyError);
    expect(() => Money.fromNumber(Number.NaN)).toThrow(MoneyError);
  });

  it('does exact bigint arithmetic', () => {
    expect(Money.mul(5_000n, 3)).toBe(15_000n);
    expect(Money.add(10_000n, 5_000n)).toBe(15_000n);
    expect(Money.sub(15_000n, 5_000n)).toBe(10_000n);
  });

  it('formats KRW', () => {
    expect(Money.formatKrw(0n)).toBe('0원');
    expect(Money.formatKrw(1_000n)).toBe('1,000원');
    expect(Money.formatKrw(15_000n)).toBe('15,000원');
    expect(Money.formatKrw(1_234_567n)).toBe('1,234,567원');
  });
});
