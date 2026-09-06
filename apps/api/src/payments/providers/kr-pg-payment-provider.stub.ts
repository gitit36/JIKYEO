import { Injectable } from '@nestjs/common';
import {
  ChargeInput,
  PaymentProvider,
  PaymentProviderResult,
  RefundInput,
  WebhookEvent,
} from './payment-provider';

/**
 * NHN KCP adapter placeholder. KakaoPay/cards are methods, not providers.
 * No network calls or production credentials in this phase.
 */
@Injectable()
export class KoreanPgPaymentProvider extends PaymentProvider {
  readonly name = 'kcp';

  async charge(_input: ChargeInput): Promise<PaymentProviderResult> {
    throw new Error('KCP provider is not implemented');
  }

  async refund(_input: RefundInput): Promise<PaymentProviderResult> {
    throw new Error('KCP provider is not implemented');
  }

  async cancel(_input: RefundInput): Promise<PaymentProviderResult> {
    throw new Error('KCP provider is not implemented');
  }

  async getStatus(_providerPaymentKey: string): Promise<PaymentProviderResult> {
    throw new Error('KCP provider is not implemented');
  }

  async verifyWebhook(
    _rawBody: string,
    _headers: Record<string, string | string[] | undefined>,
  ): Promise<WebhookEvent> {
    throw new Error('KCP provider is not implemented');
  }
}
