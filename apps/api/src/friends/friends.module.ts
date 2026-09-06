import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ScheduleService } from '../commitments/schedule/schedule.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { SharedCommitmentService } from './shared-commitment.service';
import { SharedCommitmentsController } from './shared-commitments.controller';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [FriendsController, SharedCommitmentsController],
  providers: [FriendsService, SharedCommitmentService, ScheduleService],
  exports: [FriendsService, SharedCommitmentService],
})
export class FriendsModule {}
