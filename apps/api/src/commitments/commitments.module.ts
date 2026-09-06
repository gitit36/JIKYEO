import { Module } from '@nestjs/common';
import { AppealsModule } from '../appeals/appeals.module';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { SafetyModule } from '../safety/safety.module';
import { StakePolicyModule } from '../stake-policy/stake-policy.module';
import { UsersModule } from '../users/users.module';
import { FriendsModule } from '../friends/friends.module';
import { CommitmentService } from './commitment.service';
import { CommitmentsController } from './commitments.controller';
import { QuoteCacheService } from './quote/quote-cache.service';
import { QuoteService } from './quote/quote.service';
import { ScheduleService } from './schedule/schedule.service';
import { CommitmentTemplatesController } from './templates/commitment-templates.controller';
import { TermsService } from './terms.service';

@Module({
  imports: [AuthModule, SafetyModule, UsersModule, StakePolicyModule, PaymentsModule, AppealsModule, FriendsModule],
  controllers: [CommitmentsController, CommitmentTemplatesController],
  providers: [ScheduleService, QuoteService, QuoteCacheService, CommitmentService, TermsService],
  exports: [ScheduleService, QuoteService, QuoteCacheService, CommitmentService, TermsService],
})
export class CommitmentsModule {}
