import { Injectable } from '@nestjs/common';
import {
  ChargeInput,
  PaymentProvider,
  PaymentProviderResult,
  RefundInput,
  WebhookEvent,
} from './payment-provider';

/**
 * Placeholder for the eventual Korean PG integration.
 * DO NOT hardcode credentials or endpoints here. Wire once a PG is chosen
 * (토스페이먼츠 / 포트원 / 카카오페이 / KG이니시스 등).
 */
@Injectable()
export class KoreanPgPaymentProvider extends PaymentProvider {
  readonly name = 'kr_pg';

  async charge(_input: ChargeInput): Promise<PaymentProviderResult> {
    throw new Error('KoreanPgPaymentProvider is not implemented for MVP');
  }

  async refund(_input: RefundInput): Promise<PaymentProviderResult> {
    throw new Error('KoreanPgPaymentProvider is not implemented for MVP');
  }

  async cancel(_input: RefundInput): Promise<PaymentProviderResult> {
    throw new Error('KoreanPgPaymentProvider is not implemented for MVP');
  }

  async getStatus(_providerPaymentKey: string): Promise<PaymentProviderResult> {
    throw new Error('KoreanPgPaymentProvider is not implemented for MVP');
  }

  async verifyWebhook(
    _rawBody: string,
    _headers: Record<string, string | string[] | undefined>,
  ): Promise<WebhookEvent> {
    throw new Error('KoreanPgPaymentProvider is not implemented for MVP');
  }
}
