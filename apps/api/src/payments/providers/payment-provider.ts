/**
 * PaymentProvider abstraction.
 *
 * Selected production PG is NHN KCP. KakaoPay and cards are payment methods
 * behind KCP, not separate providers. MVP ships `MockPaymentProvider`.
 * Real KCP credentials and network calls are not implemented in this phase.
 *
 * All amounts are integer KRW (`bigint`).
 * All calls MUST be idempotent on `idempotencyKey`.
 */
export interface ChargeInput {
  idempotencyKey: string;
  userId: string;
  stakeId: string;
  amount: bigint;
  currency: 'KRW';
  description: string;
  metadata?: Record<string, string>;
}

export interface RefundInput {
  idempotencyKey: string;
  providerPaymentKey: string;
  amount: bigint; // partial or full
  reason: string;
}

export type PaymentProviderStatus = 'requested' | 'succeeded' | 'failed' | 'partial';

export interface PaymentProviderResult {
  providerPaymentKey: string;
  status: PaymentProviderStatus;
  failureCode?: string;
  /** CARD / KAKAOPAY / BANK — method behind the provider, never a second PG. */
  paymentMethod?: string;
  raw?: unknown;
}

export interface WebhookEvent {
  /** Provider-assigned delivery id. `(provider, eventId)` is unique → dedupe. */
  eventId: string;
  providerPaymentKey: string;
  type: 'charge' | 'refund' | 'cancel';
  status: PaymentProviderStatus;
  amount: bigint;
  raw: unknown;
}

/**
 * The PG accepted the operation but the HTTP response was lost.
 * `providerPaymentKey` is the stable external identity — retries MUST
 * reuse it (via the same idempotencyKey) rather than opening a new charge.
 */
export class LostProviderResponseError extends Error {
  constructor(readonly providerPaymentKey: string) {
    super('PROVIDER_RESPONSE_LOST');
    this.name = 'LostProviderResponseError';
  }
}

export abstract class PaymentProvider {
  abstract readonly name: string;

  abstract charge(input: ChargeInput): Promise<PaymentProviderResult>;

  abstract refund(input: RefundInput): Promise<PaymentProviderResult>;

  abstract cancel(input: RefundInput): Promise<PaymentProviderResult>;

  abstract getStatus(providerPaymentKey: string): Promise<PaymentProviderResult>;

  /** Verify webhook payload (signature/HMAC). Must throw on invalid signatures. */
  abstract verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<WebhookEvent>;
}
