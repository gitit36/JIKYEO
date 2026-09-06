import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettlementModule } from '../settlement/settlement.module';
import { AdminGuard } from './admin.guard';
import { AdminMoneyController } from './admin-money.controller';
import { AdminMoneyService } from './admin-money.service';

@Module({
  imports: [PaymentsModule, SettlementModule, AuditModule],
  controllers: [AdminMoneyController],
  providers: [AdminGuard, AdminMoneyService],
})
export class AdminModule {}
