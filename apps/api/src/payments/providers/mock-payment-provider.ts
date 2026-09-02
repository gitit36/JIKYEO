import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ChargeInput,
  PaymentProvider,
  PaymentProviderResult,
  RefundInput,
  WebhookEvent,
} from './payment-provider';

/**
 * In-memory mock PG. Development/test only.
 * - `charge` succeeds unless amount === 999_999n (test failure signal).
 * - `refund` and `cancel` succeed if the payment exists and there is enough remaining.
 * - `getStatus` reports the ledger internal state.
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

  async charge(input: ChargeInput): Promise<PaymentProviderResult> {
    const cached = this.idempotency.get(input.idempotencyKey);
    if (cached) return cached;

    if (input.amount === 999_999n) {
      const failed: PaymentProviderResult = {
        providerPaymentKey: `mockfail-${randomUUID()}`,
        status: 'failed',
        failureCode: 'MOCK_INSUFFICIENT_FUNDS',
      };
      this.idempotency.set(input.idempotencyKey, failed);
      return failed;
    }

    const providerPaymentKey = `mockpg-${randomUUID()}`;
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
    return result;
  }

  async refund(input: RefundInput): Promise<PaymentProviderResult> {
    const cached = this.idempotency.get(input.idempotencyKey);
    if (cached) return cached;
    const entry = this.ledger.get(input.providerPaymentKey);
    if (!entry) {
      const failed: PaymentProviderResult = {
        providerPaymentKey: input.providerPaymentKey,
        status: 'failed',
        failureCode: 'PAYMENT_NOT_FOUND',
      };
      this.idempotency.set(input.idempotencyKey, failed);
      return failed;
    }
    const remaining = entry.amountCharged - entry.amountRefunded;
    if (input.amount > remaining) {
      const failed: PaymentProviderResult = {
        providerPaymentKey: input.providerPaymentKey,
        status: 'failed',
        failureCode: 'REFUND_EXCEEDS_REMAINING',
      };
      this.idempotency.set(input.idempotencyKey, failed);
      return failed;
    }
    entry.amountRefunded += input.amount;
    entry.status = entry.amountRefunded === entry.amountCharged ? 'succeeded' : 'partial';
    const result: PaymentProviderResult = {
      providerPaymentKey: input.providerPaymentKey,
      status: entry.status === 'succeeded' ? 'succeeded' : 'partial',
    };
    this.idempotency.set(input.idempotencyKey, result);
    return result;
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
      status:
        entry.amountRefunded === 0n
          ? 'succeeded'
          : entry.amountRefunded === entry.amountCharged
            ? 'succeeded'
            : 'partial',
    };
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
      providerPaymentKey: string;
      type: 'charge' | 'refund' | 'cancel';
      status: 'requested' | 'succeeded' | 'failed' | 'partial';
      amount: string;
    };
    return {
      providerPaymentKey: parsed.providerPaymentKey,
      type: parsed.type,
      status: parsed.status,
      amount: BigInt(parsed.amount),
      raw: parsed,
    };
  }
}
