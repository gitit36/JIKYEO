import { Module } from '@nestjs/common';
import { CommitmentsModule } from '../commitments/commitments.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { RecapsModule } from '../recaps/recaps.module';
import { SettlementModule } from '../settlement/settlement.module';
import { JobLeaseService } from './job-lease.service';
import { JobsController } from './jobs.controller';
import { MoneyMaintenanceService } from './money-maintenance.service';

@Module({
  imports: [CommitmentsModule, PaymentsModule, SettlementModule, NotificationsModule, RecapsModule, EvidenceModule],
  controllers: [JobsController],
  providers: [JobLeaseService, MoneyMaintenanceService],
  exports: [JobLeaseService, MoneyMaintenanceService],
})
export class JobsModule {}
