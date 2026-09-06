import { Module, forwardRef } from '@nestjs/common';
import { FriendsModule } from '../friends/friends.module';
import { VerificationOrchestrator } from '../verification/verification-orchestrator.service';
import { VerificationModule } from '../verification/verification.module';
import { DeadlineService, HealthMonitor } from './deadline.service';

@Module({
  imports: [VerificationModule, forwardRef(() => FriendsModule)],
  providers: [DeadlineService, HealthMonitor, VerificationOrchestrator],
  exports: [DeadlineService, HealthMonitor],
})
export class DeadlineModule {}
