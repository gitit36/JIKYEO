import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { AppealService } from './appeal.service';
import { AppealsController } from './appeals.controller';

@Module({
  imports: [AuthModule, PaymentsModule, AuditModule, NotificationsModule],
  controllers: [AppealsController],
  providers: [AppealService],
  exports: [AppealService],
})
export class AppealsModule {}
