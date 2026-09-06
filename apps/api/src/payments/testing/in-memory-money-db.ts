/**
 * Minimal in-memory Prisma stand-in for the money path
 * (Commitment / Stake / Occurrence / Payment / PaymentLedger / Settlement /
 * PaymentWebhookEvent). Supports the subset of the Prisma query surface used
 * by PaymentService, SettlementService, LedgerService and MoneyStatusService,
 * including unique-constraint violations (`P2002`) so idempotency guards are
 * exercised for real.
 *
 * Test-only. Not used by production code.
 */

type Row = Record<string, any>;

function matchesValue(actual: any, cond: any): boolean {
  if (cond === null || cond === undefined) return actual === cond;
  if (cond instanceof Date) return actual instanceof Date && actual.getTime() === cond.getTime();
  if (typeof cond === 'object' && !Array.isArray(cond)) {
    if ('in' in cond) return (cond.in as any[]).includes(actual);
    if ('notIn' in cond) return !(cond.notIn as any[]).includes(actual);
    if ('not' in cond) return !matchesValue(actual, cond.not);
    if ('lt' in cond) return actual < cond.lt;
    if ('lte' in cond) return actual <= cond.lte;
    if ('gt' in cond) return actual > cond.gt;
    if ('gte' in cond) return actual >= cond.gte;
    if ('startsWith' in cond) return typeof actual === 'string' && actual.startsWith(cond.startsWith);
    return false;
  }
  return actual === cond;
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => matchesValue(row[k], v));
}

function sortBy(rows: Row[], orderBy: Row | Row[] | undefined): Row[] {
  if (!orderBy) return rows;
  const [[key, dir]] = Object.entries(Array.isArray(orderBy) ? orderBy[0] : orderBy);
  return [...rows].sort((a, b) => {
    const av = a[key] instanceof Date ? a[key].getTime() : a[key];
    const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
    if (av === bv) return 0;
    const cmp = av < bv ? -1 : 1;
    return dir === 'desc' ? -cmp : cmp;
  });
}

function p2002(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

class Table {
  rows: Row[] = [];
  private seq = 0;
  constructor(
    private readonly name: string,
    private readonly uniques: string[][] = [],
    private readonly hooks: { include?: (row: Row, include: Row) => Row } = {},
  ) {}

  private assertUnique(data: Row, ignoreId?: string): void {
    for (const cols of this.uniques) {
      const dup = this.rows.find(
        (r) => r.id !== ignoreId && cols.every((c) => r[c] !== undefined && r[c] === data[c]),
      );
      if (dup) throw p2002();
    }
  }

  private withInclude(row: Row | null, args: Row): Row | null {
    if (!row) return null;
    if (args?.include && this.hooks.include) return this.hooks.include({ ...row }, args.include);
    if (args?.select) {
      const out: Row = {};
      for (const [k, v] of Object.entries(args.select)) {
        if (!v) continue;
        if (k === 'stake' && this.hooks.include) out[k] = this.hooks.include({ ...row }, { stake: true }).stake;
        else out[k] = row[k];
      }
      return out;
    }
    return { ...row };
  }

  async create(args: { data: Row; select?: Row }): Promise<Row> {
    this.assertUnique(args.data);
    this.seq += 1;
    const row: Row = {
      id: args.data.id ?? `${this.name}_${this.seq}`,
      createdAt: new Date(2026, 0, 1, 0, 0, this.seq),
      ...args.data,
    };
    this.rows.push(row);
    return this.withInclude(row, args)!;
  }

  async createMany(args: { data: Row[] }): Promise<{ count: number }> {
    for (const d of args.data) await this.create({ data: d });
    return { count: args.data.length };
  }

  async findUnique(args: { where: Row; include?: Row; select?: Row }): Promise<Row | null> {
    return this.withInclude(this.rows.find((r) => matches(r, args.where)) ?? null, args);
  }

  async findFirst(args: { where?: Row; orderBy?: Row; include?: Row }): Promise<Row | null> {
    return this.withInclude(sortBy(this.rows.filter((r) => matches(r, args?.where)), args?.orderBy)[0] ?? null, args ?? {});
  }

  async count(args: { where?: Row } = {}): Promise<number> {
    return this.rows.filter((r) => matches(r, args.where)).length;
  }

  async findMany(args: { where?: Row; orderBy?: Row; include?: Row; select?: Row; take?: number } = {}): Promise<Row[]> {
    let out = sortBy(this.rows.filter((r) => matches(r, args.where)), args.orderBy);
    if (args.take) out = out.slice(0, args.take);
    return out.map((r) => this.withInclude(r, args)!);
  }

  async aggregate(args: { where?: Row; _sum?: Row }): Promise<{ _sum: Row }> {
    const rows = this.rows.filter((r) => matches(r, args.where));
    const _sum: Row = {};
    for (const field of Object.keys(args._sum ?? {})) {
      _sum[field] = rows.reduce((acc: bigint, r) => acc + BigInt(r[field] ?? 0), 0n);
    }
    return { _sum };
  }

  async update(args: { where: Row; data: Row }): Promise<Row> {
    const row = this.rows.find((r) => matches(r, args.where));
    if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
    this.assertUnique({ ...row, ...args.data }, row.id);
    Object.assign(row, args.data);
    return { ...row };
  }

  async deleteMany(args: { where: Row }): Promise<{ count: number }> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !matches(r, args.where));
    return { count: before - this.rows.length };
  }

  async updateMany(args: { where: Row; data: Row }): Promise<{ count: number }> {
    let count = 0;
    for (const row of this.rows) {
      if (matches(row, args.where)) {
        Object.assign(row, args.data);
        count += 1;
      }
    }
    return { count };
  }
}

export class InMemoryMoneyDb {
  private txTail: Promise<unknown> = Promise.resolve();

  async $executeRaw(): Promise<number> { return 0; }
  async $executeRawUnsafe(): Promise<number> { return 0; }

  /** Serialise transactions so concurrent cap/charge tests cannot race the reservation insert. */
  async $transaction<T>(fn: (tx: InMemoryMoneyDb) => Promise<T>): Promise<T> {
    const run = this.txTail.then(() => fn(this));
    this.txTail = run.then(() => undefined, () => undefined);
    return run;
  }

  readonly stake = new Table('stake', [['commitmentId']]);
  readonly occurrence = new Table('occ', [['commitmentId', 'sequenceNo']], {
    include: (row, include) => {
      if (include.commitment) {
        const c = this.commitment.rows.find((x) => x.id === row.commitmentId);
        row.commitment = c
          ? (include.commitment.select
            ? Object.fromEntries(Object.entries(include.commitment.select).filter(([, v]) => v).map(([k]) => [k, (c as Row)[k]]))
            : { ...c })
          : null;
        if (include.commitment.include?.stake && row.commitment) {
          row.commitment.stake = this.stake.rows.find((s) => s.commitmentId === row.commitmentId) ?? null;
        }
      }
      if (include.appeal) {
        row.appeal = this.appeal.rows.find((a) => a.occurrenceId === row.id) ?? null;
      }
      return row;
    },
  });
  readonly payment = new Table('pay', [['idempotencyKey']]);
  readonly paymentLedger = new Table('led', [['idempotencyKey']]);
  readonly settlement = new Table('set', [['idempotencyKey']]);
  readonly paymentWebhookEvent = new Table('whk', [['provider', 'eventId']]);
  readonly jobLease = new Table('lease', [['name']]);
  readonly auditLog = new Table('aud');
  readonly appeal = new Table('apl', [['occurrenceId']], {
    include: (row, include) => {
      if (include.occurrence) {
        const occ = this.occurrence.rows.find((o) => o.id === row.occurrenceId);
        if (occ) {
          row.occurrence = { ...occ };
          const occInc = include.occurrence.include;
          if (occInc?.commitment) {
            const c = this.commitment.rows.find((x) => x.id === occ.commitmentId);
            row.occurrence.commitment = c ? { ...c } : null;
          }
        } else {
          row.occurrence = null;
        }
      }
      return row;
    },
  });
  readonly evidence = new Table('evd');
  readonly verificationResult = new Table('vrs');
  readonly commitment = new Table('cmt', [], {
    include: (row, include) => {
      if (include.stake) row.stake = this.stake.rows.find((s) => s.commitmentId === row.id) ?? null;
      if (include.occurrences) {
        row.occurrences = this.occurrence.rows
          .filter((o) => o.commitmentId === row.id)
          .sort((a, b) => a.sequenceNo - b.sequenceNo)
          .map((o) => ({ ...o }));
      }
      return row;
    },
  });

  // ------------------------------------------------------------- fixtures

  /**
   * Seed a MONEY commitment in `payment_pending` with a pending Stake and
   * `count` scheduled occurrences of `perOccurrence` KRW each.
   */
  async seedMoneyCommitment(opts: {
    id: string;
    userId: string;
    perOccurrence: bigint;
    count: number;
    status?: 'payment_pending' | 'signature_pending' | 'active';
  }): Promise<void> {
    const maxLoss = opts.perOccurrence * BigInt(opts.count);
    await this.commitment.create({
      data: {
        id: opts.id,
        userId: opts.userId,
        title: '헬스장 가기',
        enforcementMode: 'money',
        status: opts.status ?? 'payment_pending',
        maxLossAmount: maxLoss,
        currency: 'KRW',
        signatureCompleted: false,
        signedAt: null,
      },
    });
    await this.stake.create({
      data: {
        id: `stake_${opts.id}`,
        commitmentId: opts.id,
        perOccurrenceAmount: opts.perOccurrence,
        maxTotalAmount: maxLoss,
        currency: 'KRW',
        settlementMode: 'end_of_commitment',
        recipientType: 'platform',
        status: 'pending',
      },
    });
    for (let i = 0; i < opts.count; i += 1) {
      await this.occurrence.create({
        data: {
          id: `${opts.id}_o${i + 1}`,
          commitmentId: opts.id,
          sequenceNo: i + 1,
          status: 'scheduled',
          stakeAmount: opts.perOccurrence,
        },
      });
    }
  }

  async seedSelfCommitment(opts: { id: string; userId: string; count: number }): Promise<void> {
    await this.commitment.create({
      data: {
        id: opts.id,
        userId: opts.userId,
        title: '매일 60분 공부하기',
        enforcementMode: 'self',
        status: 'active',
        maxLossAmount: null,
        currency: null,
        signatureCompleted: true,
      },
    });
    for (let i = 0; i < opts.count; i += 1) {
      await this.occurrence.create({
        data: { id: `${opts.id}_o${i + 1}`, commitmentId: opts.id, sequenceNo: i + 1, status: 'scheduled', stakeAmount: null },
      });
    }
  }

  async setOccurrenceStatus(occurrenceId: string, status: string, decidedAt?: Date): Promise<void> {
    const final = status === 'pass' || status === 'fail' || status === 'void';
    await this.occurrence.update({
      where: { id: occurrenceId },
      data: { status, decidedAt: decidedAt ?? (final ? new Date() : null) },
    });
  }

  async activateSigned(commitmentId: string): Promise<void> {
    await this.commitment.update({
      where: { id: commitmentId },
      data: { status: 'active', signatureCompleted: true, signedAt: new Date(2026, 0, 1) },
    });
  }
}
