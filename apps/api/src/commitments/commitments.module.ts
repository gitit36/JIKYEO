import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SafetyModule } from '../safety/safety.module';
import { CommitmentsController } from './commitments.controller';
import { QuoteService } from './quote/quote.service';
import { ScheduleService } from './schedule/schedule.service';
import { CommitmentTemplatesController } from './templates/commitment-templates.controller';

@Module({
  imports: [AuthModule, SafetyModule],
  controllers: [CommitmentsController, CommitmentTemplatesController],
  providers: [ScheduleService, QuoteService],
  exports: [ScheduleService, QuoteService],
})
export class CommitmentsModule {}
