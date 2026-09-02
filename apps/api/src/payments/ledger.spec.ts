import { LedgerEntryType } from '@prisma/client';
import { LedgerService } from './ledger.service';

/**
 * Mandatory financial test case (from product brief).
 *
 * Commitment: 3 occurrences × 5,000 KRW = 15,000 KRW upfront.
 * Results:    PASS, FAIL, PASS.
 * Expected:   10,000 refundable, 5,000 forfeited, total = 15,000, no imbalance.
 *
 * Then: the FAIL is appealed and overturned.
 * Expected:   15,000 refundable, 0 forfeited, no imbalance.
 *
 * We use a lightweight in-memory Prisma stub so this test is a fast unit test
 * that pins the ledger contract even before the database is set up.
 */

interface Row {
  id: string;
  commitmentId: string;
  occurrenceId: string | null;
  entryType: LedgerEntryType;
  amount: bigint;
  idempotencyKey: string;
}

class InMemoryLedgerDb {
  rows: Row[] = [];

  paymentLedger = {
    findUnique: async ({ where }: { where: { idempotencyKey: string } }): Promise<Row | null> => {
      return this.rows.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null;
    },
    create: async ({ data }: { data: Omit<Row, 'id'> }): Promise<Row> => {
      const row: Row = { id: `row_${this.rows.length + 1}`, ...data };
      this.rows.push(row);
      return row;
    },
    findMany: async ({
      where,
      select: _select,
    }: {
      where: { commitmentId: string };
      select: { entryType: true; amount: true };
    }): Promise<Pick<Row, 'entryType' | 'amount'>[]> => {
      return this.rows
        .filter((r) => r.commitmentId === where.commitmentId)
        .map((r) => ({ entryType: r.entryType, amount: r.amount }));
    },
  };
}

describe('LedgerService (financial invariant)', () => {
  const COMMITMENT = 'c-1';
  const USER = 'u-1';

  it('handles PASS/FAIL/PASS then appeal-reversal without imbalance', async () => {
    const db = new InMemoryLedgerDb();
    const ledger = new LedgerService(db as unknown as never);

    // Upfront charge: 15,000 KRW deposit.
    await ledger.append({
      userId: USER,
      commitmentId: COMMITMENT,
      entryType: 'deposit',
      amount: 15_000n,
      idempotencyKey: 'dep:1',
    });

    // Occurrence 1: PASS → refund earned 5,000.
    await ledger.append({
      userId: USER,
      commitmentId: COMMITMENT,
      occurrenceId: 'o-1',
      entryType: 'refund_earned',
      amount: 5_000n,
      idempotencyKey: 'earn:o-1',
    });

    // Occurrence 2: FAIL → forfeit 5,000.
    await ledger.append({
      userId: USER,
      commitmentId: COMMITMENT,
      occurrenceId: 'o-2',
      entryType: 'forfeit',
      amount: 5_000n,
      idempotencyKey: 'forf:o-2',
    });

    // Occurrence 3: PASS → refund earned 5,000.
    await ledger.append({
      userId: USER,
      commitmentId: COMMITMENT,
      occurrenceId: 'o-3',
      entryType: 'refund_earned',
      amount: 5_000n,
      idempotencyKey: 'earn:o-3',
    });

    const midTotals = await ledger.totalsForCommitment(COMMITMENT);
    expect(midTotals.deposit).toBe(15_000n);
    expect(midTotals.refundEarned).toBe(10_000n);
    expect(midTotals.forfeit).toBe(5_000n);
    expect(midTotals.refundPaid).toBe(0n);
    expect(midTotals.reversal).toBe(0n);
    expect(ledger.refundableRemaining(midTotals)).toBe(10_000n);

    // End-of-commitment: pay the refund out.
    await ledger.append({
      userId: USER,
      commitmentId: COMMITMENT,
      entryType: 'refund_paid',
      amount: 10_000n,
      idempotencyKey: 'paid:1',
    });

    const settled = await ledger.totalsForCommitment(COMMITMENT);
    expect(ledger.refundableRemaining(settled)).toBe(0n);
    expect(settled.deposit).toBe(15_000n);
    expect(settled.forfeit).toBe(5_000n);
    expect(settled.refundPaid).toBe(10_000n);
    // deposit === forfeit + refund_paid
    expect(ledger.isBalanced(settled)).toBe(true);

    // ---- Appeal reversal: overturn FAIL on o-2 ----
    // Book a `reversal` for the previously forfeited 5,000.
    await ledger.append({
      userId: USER,
      commitmentId: COMMITMENT,
      occurrenceId: 'o-2',
      entryType: 'reversal',
      amount: 5_000n,
      idempotencyKey: 'rev:o-2',
    });
    // Pay the additional refund of 5,000.
    await ledger.append({
      userId: USER,
      commitmentId: COMMITMENT,
      entryType: 'refund_paid',
      amount: 5_000n,
      idempotencyKey: 'paid:2',
    });
    // Net out the forfeit by booking a compensating negative-signed entry via a
    // second reversal? No — in this ledger the semantics are:
    //   refundable = refund_earned + reversal
    //   paid       = refund_paid
    //   forfeit    = forfeit
    // Invariant at rest: deposit == forfeit + refund_paid IF no outstanding reversals.
    // When a reversal is booked and paid, the net forfeit becomes forfeit − reversal.
    const finalTotals = await ledger.totalsForCommitment(COMMITMENT);
    expect(finalTotals.deposit).toBe(15_000n);
    expect(finalTotals.refundPaid).toBe(15_000n);
    expect(finalTotals.forfeit).toBe(5_000n);
    expect(finalTotals.reversal).toBe(5_000n);
    expect(ledger.refundableRemaining(finalTotals)).toBe(0n);
    // Net forfeit = forfeit − reversal = 0
    expect(finalTotals.forfeit - finalTotals.reversal).toBe(0n);
    // Total accounting: deposit == (forfeit − reversal) + refund_paid
    expect(finalTotals.deposit).toBe(
      finalTotals.forfeit - finalTotals.reversal + finalTotals.refundPaid,
    );
  });

  it('is idempotent on identical idempotency keys', async () => {
    const db = new InMemoryLedgerDb();
    const ledger = new LedgerService(db as unknown as never);
    await ledger.append({
      userId: USER,
      commitmentId: COMMITMENT,
      entryType: 'deposit',
      amount: 15_000n,
      idempotencyKey: 'dep:1',
    });
    await ledger.append({
      userId: USER,
      commitmentId: COMMITMENT,
      entryType: 'deposit',
      amount: 15_000n,
      idempotencyKey: 'dep:1',
    });
    const totals = await ledger.totalsForCommitment(COMMITMENT);
    expect(totals.deposit).toBe(15_000n);
  });
});
