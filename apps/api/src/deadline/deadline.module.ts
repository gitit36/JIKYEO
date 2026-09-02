import { Module } from '@nestjs/common';
import { VerificationOrchestrator } from '../verification/verification-orchestrator.service';
import { VerificationModule } from '../verification/verification.module';
import { DeadlineService, HealthMonitor } from './deadline.service';

@Module({
  imports: [VerificationModule],
  providers: [DeadlineService, HealthMonitor, VerificationOrchestrator],
  exports: [DeadlineService, HealthMonitor],
})
export class DeadlineModule {}
