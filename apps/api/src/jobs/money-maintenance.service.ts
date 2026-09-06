import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../config/app-config';
import { CommitmentService } from '../commitments/commitment.service';
import { PaymentService } from '../payments/payment.service';
import { SettlementService } from '../settlement/settlement.service';
import { JobLeaseService } from './job-lease.service';

export interface MaintenanceReport {
  skipped: boolean;
  expired: number;
  settled: number;
  reconciled: number;
}

@Injectable()
export class MoneyMaintenanceService {
  private readonly logger = new Logger('MoneyMaintenance');

  constructor(
    private readonly lease: JobLeaseService,
    private readonly commitments: CommitmentService,
    private readonly settlement: SettlementService,
    private readonly payments: PaymentService,
    private readonly cfg: AppConfig,
  ) {}

  /**
   * Expires overdue signatures, settles/retries refunds, reconciles unknown
   * payments. Safe under overlapping callers via JobLease.
   */
  async run(): Promise<MaintenanceReport> {
    const holder = randomUUID();
    const got = await this.lease.acquire('money_maintenance', holder);
    if (!got) return { skipped: true, expired: 0, settled: 0, reconciled: 0 };
    try {
      const { expired } = await this.commitments.expireOverdue();
      const sweep = await this.settlement.sweep();
      // sweep already calls reconcileStale; run once more for in-window unknowns.
      const recon = await this.payments.reconcileStale(0);
      return {
        skipped: false,
        expired,
        settled: sweep.completed,
        reconciled: recon.resolved,
      };
    } finally {
      await this.lease.release('money_maintenance', holder);
    }
  }

  onModuleInit(): void {
    if (this.cfg.nodeEnv === 'test') return;
    setInterval(() => {
      this.run().catch((e) => this.logger.error('maintenance failed', (e as Error)?.stack));
    }, 60_000).unref?.();
  }
}
