import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ScheduleService } from '../commitments/schedule/schedule.service';
import { EvidenceModule } from '../evidence/evidence.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FriendVerifyController } from './friend-verify.controller';
import { FriendVerifyService } from './friend-verify.service';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';
import { SharedCommitmentService } from './shared-commitment.service';
import { SharedCommitmentsController } from './shared-commitments.controller';

@Module({
  imports: [AuthModule, NotificationsModule, EvidenceModule, AuditModule],
  controllers: [FriendsController, SharedCommitmentsController, FriendVerifyController],
  providers: [FriendsService, SharedCommitmentService, FriendVerifyService, ScheduleService],
  exports: [FriendsService, SharedCommitmentService, FriendVerifyService],
})
export class FriendsModule {}
