import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ChargeInput,
  LostProviderResponseError,
  PaymentProvider,
  PaymentProviderResult,
  RefundInput,
  WebhookEvent,
} from './payment-provider';

/**
 * In-memory mock PG. Development/test only.
 *
 * Failure signals (so the full lifecycle can be exercised end-to-end):
 * - `charge`  fails when `amount === 999_999n` or `metadata.simulate === 'charge_fail'`.
 * - `refund`  fails when the payment is unknown, the amount exceeds the
 *             remaining balance, or `reason` contains `simulate:refund_fail`.
 *             A refund failure is *transient*: a retry with a new idempotency
 *             key succeeds, which lets tests prove refund-retry idempotency.
 * - `verifyWebhook` accepts any payload with header `x-mock-signature: valid`.
 *
 * Real Korean PG providers implement the same interface and are swapped via config.
 */
@Injectable()
export class MockPaymentProvider extends PaymentProvider {
  readonly name = 'mock';
  private readonly logger = new Logger('MockPaymentProvider');

  private readonly ledger = new Map<
    string,
    { amountCharged: bigint; amountRefunded: bigint; status: 'succeeded' | 'failed' | 'partial' }
  >();
  private readonly idempotency = new Map<string, PaymentProviderResult>();
  /** Number of provider calls, for tests asserting "no duplicate charge". */
  readonly calls = { charge: 0, refund: 0 };
  /** Test hook: the next refund call fails transiently (MOCK_PG_TIMEOUT). */
  failNextRefund = false;
  /** Test hook: next charge/refund succeeds at the PG then drops the HTTP response. */
  loseNextCharge = false;
  loseNextRefund = false;

  async charge(input: ChargeInput): Promise<PaymentProviderResult> {
    const cached = this.idempotency.get(input.idempotencyKey);
    if (cached) return cached;
    this.calls.charge += 1;

    if (input.amount === 999_999n || input.metadata?.simulate === 'charge_fail') {
      const failed: PaymentProviderResult = {
        providerPaymentKey: `mockfail-${randomUUID()}`,
        status: 'failed',
        failureCode: 'MOCK_CARD_DECLINED',
      };
      this.idempotency.set(input.idempotencyKey, failed);
      return failed;
    }

    const providerPaymentKey = `mockpg-${input.idempotencyKey}`;
    this.ledger.set(providerPaymentKey, {
      amountCharged: input.amount,
      amountRefunded: 0n,
      status: 'succeeded',
    });
    const result: PaymentProviderResult = {
      providerPaymentKey,
      status: 'succeeded',
    };
    this.idempotency.set(input.idempotencyKey, result);
    if (this.loseNextCharge || input.metadata?.simulate === 'charge_lost') {
      this.loseNextCharge = false;
      throw new LostProviderResponseError(providerPaymentKey);
    }
    return result;
  }

  async refund(input: RefundInput): Promise<PaymentProviderResult> {
    const cached = this.idempotency.get(input.idempotencyKey);
    if (cached) return cached;
    this.calls.refund += 1;
    const entry = this.ledger.get(input.providerPaymentKey);
    if (!entry) {
      return this.remember(input.idempotencyKey, {
        providerPaymentKey: input.providerPaymentKey,
        status: 'failed',
        failureCode: 'PAYMENT_NOT_FOUND',
      });
    }
    if (input.reason.includes('simulate:refund_fail') || this.failNextRefund) {
      this.failNextRefund = false;
      return this.remember(input.idempotencyKey, {
        providerPaymentKey: input.providerPaymentKey,
        status: 'failed',
        failureCode: 'MOCK_PG_TIMEOUT',
      });
    }
    const remaining = entry.amountCharged - entry.amountRefunded;
    if (input.amount > remaining) {
      return this.remember(input.idempotencyKey, {
        providerPaymentKey: input.providerPaymentKey,
        status: 'failed',
        failureCode: 'REFUND_EXCEEDS_REMAINING',
      });
    }
    entry.amountRefunded += input.amount;
    entry.status = entry.amountRefunded === entry.amountCharged ? 'succeeded' : 'partial';
    const ok = this.remember(input.idempotencyKey, {
      providerPaymentKey: input.providerPaymentKey,
      status: 'succeeded',
    });
    if (this.loseNextRefund || input.reason.includes('simulate:refund_lost')) {
      this.loseNextRefund = false;
      throw new LostProviderResponseError(input.providerPaymentKey);
    }
    return ok;
  }

  async cancel(input: RefundInput): Promise<PaymentProviderResult> {
    return this.refund(input);
  }

  async getStatus(providerPaymentKey: string): Promise<PaymentProviderResult> {
    const entry = this.ledger.get(providerPaymentKey);
    if (!entry) {
      return { providerPaymentKey, status: 'failed', failureCode: 'NOT_FOUND' };
    }
    return {
      providerPaymentKey,
      status: entry.amountRefunded > 0n && entry.amountRefunded < entry.amountCharged ? 'partial' : 'succeeded',
      raw: { amountCharged: entry.amountCharged.toString(), amountRefunded: entry.amountRefunded.toString() },
    };
  }

  /** Test/dev helper: how much the mock PG still holds for a charge. */
  remainingFor(providerPaymentKey: string): bigint | null {
    const entry = this.ledger.get(providerPaymentKey);
    return entry ? entry.amountCharged - entry.amountRefunded : null;
  }

  async verifyWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<WebhookEvent> {
    const sig = headers['x-mock-signature'];
    if (sig !== 'valid') {
      throw new Error('invalid mock webhook signature');
    }
    const parsed = JSON.parse(rawBody) as {
      eventId?: string;
      providerPaymentKey: string;
      type: 'charge' | 'refund' | 'cancel';
      status: 'requested' | 'succeeded' | 'failed' | 'partial';
      amount: string;
    };
    if (!parsed.eventId || !parsed.providerPaymentKey || !parsed.type || !parsed.status) {
      throw new Error('malformed mock webhook payload');
    }
    return {
      eventId: parsed.eventId,
      providerPaymentKey: parsed.providerPaymentKey,
      type: parsed.type,
      status: parsed.status,
      amount: BigInt(parsed.amount ?? '0'),
      raw: parsed,
    };
  }

  private remember(key: string, result: PaymentProviderResult): PaymentProviderResult {
    this.idempotency.set(key, result);
    return result;
  }
}
