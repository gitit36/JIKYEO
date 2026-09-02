import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { LedgerService } from './ledger.service';
import { KoreanPgPaymentProvider } from './providers/kr-pg-payment-provider.stub';
import { MockPaymentProvider } from './providers/mock-payment-provider';
import { PaymentProvider } from './providers/payment-provider';

@Module({
  providers: [
    LedgerService,
    MockPaymentProvider,
    KoreanPgPaymentProvider,
    {
      provide: PaymentProvider,
      inject: [AppConfig, MockPaymentProvider, KoreanPgPaymentProvider],
      useFactory: (
        cfg: AppConfig,
        mock: MockPaymentProvider,
        kr: KoreanPgPaymentProvider,
      ): PaymentProvider => {
        switch (cfg.paymentProvider) {
          case 'kr_pg':
            return kr;
          case 'mock':
          default:
            return mock;
        }
      },
    },
  ],
  exports: [LedgerService, PaymentProvider],
})
export class PaymentsModule {}
