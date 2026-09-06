import { Module } from '@nestjs/common';
import { CommitmentsModule } from '../commitments/commitments.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettlementModule } from '../settlement/settlement.module';
import { JobLeaseService } from './job-lease.service';
import { JobsController } from './jobs.controller';
import { MoneyMaintenanceService } from './money-maintenance.service';

@Module({
  imports: [CommitmentsModule, PaymentsModule, SettlementModule],
  controllers: [JobsController],
  providers: [JobLeaseService, MoneyMaintenanceService],
  exports: [JobLeaseService, MoneyMaintenanceService],
})
export class JobsModule {}
