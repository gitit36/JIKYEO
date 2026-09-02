import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SafetyModule } from '../safety/safety.module';
import { StakePolicyModule } from '../stake-policy/stake-policy.module';
import { UsersModule } from '../users/users.module';
import { CommitmentService } from './commitment.service';
import { CommitmentsController } from './commitments.controller';
import { QuoteCacheService } from './quote/quote-cache.service';
import { QuoteService } from './quote/quote.service';
import { ScheduleService } from './schedule/schedule.service';
import { CommitmentTemplatesController } from './templates/commitment-templates.controller';

@Module({
  imports: [AuthModule, SafetyModule, UsersModule, StakePolicyModule],
  controllers: [CommitmentsController, CommitmentTemplatesController],
  providers: [ScheduleService, QuoteService, QuoteCacheService, CommitmentService],
  exports: [ScheduleService, QuoteService, QuoteCacheService, CommitmentService],
})
export class CommitmentsModule {}
