import { Module } from '@nestjs/common';
import { AppealsModule } from '../appeals/appeals.module';
import { AuditModule } from '../audit/audit.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettlementModule } from '../settlement/settlement.module';
import { AdminAppealsController } from './admin-appeals.controller';
import { AdminGuard } from './admin.guard';
import { AdminMoneyController } from './admin-money.controller';
import { AdminMoneyService } from './admin-money.service';
import { AdminUsersController } from './admin-users.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [PaymentsModule, SettlementModule, AuditModule, AppealsModule, UsersModule],
  controllers: [AdminMoneyController, AdminAppealsController, AdminUsersController],
  providers: [AdminGuard, AdminMoneyService],
})
export class AdminModule {}
