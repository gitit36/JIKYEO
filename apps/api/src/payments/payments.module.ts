import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StakePolicyModule } from '../stake-policy/stake-policy.module';
import { UsersModule } from '../users/users.module';
import { AppConfig } from '../config/app-config';
import { LedgerService } from './ledger.service';
import { MoneyStatusService } from './money-status.service';
import { PaymentService } from './payment.service';
import { PaymentsController, PaymentWebhookController } from './payments.controller';
import { KoreanPgPaymentProvider } from './providers/kr-pg-payment-provider.stub';
import { MockPaymentProvider } from './providers/mock-payment-provider';
import { PaymentProvider } from './providers/payment-provider';

@Module({
  imports: [AuthModule, StakePolicyModule, UsersModule],
  controllers: [PaymentsController, PaymentWebhookController],
  providers: [
    LedgerService,
    PaymentService,
    MoneyStatusService,
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
  exports: [LedgerService, PaymentService, MoneyStatusService, PaymentProvider],
})
export class PaymentsModule {}
