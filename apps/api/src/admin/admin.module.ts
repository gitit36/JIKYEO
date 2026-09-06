import { Module } from '@nestjs/common';
import { AppealsModule } from '../appeals/appeals.module';
import { AuditModule } from '../audit/audit.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettlementModule } from '../settlement/settlement.module';
import { AdminAppealsController } from './admin-appeals.controller';
import { AdminGuard } from './admin.guard';
import { AdminMoneyController } from './admin-money.controller';
import { AdminMoneyService } from './admin-money.service';
import { AdminUsersController } from './admin-users.controller';
import { UsersModule } from '../users/users.module';
import { CommitmentsModule } from '../commitments/commitments.module';
import { FriendsModule } from '../friends/friends.module';
import { AdminFriendVerifyController } from './admin-friend-verify.controller';

@Module({
  imports: [PaymentsModule, SettlementModule, AuditModule, AppealsModule, UsersModule, CommitmentsModule, FriendsModule],
  controllers: [AdminMoneyController, AdminAppealsController, AdminUsersController, AdminFriendVerifyController],
  providers: [AdminGuard, AdminMoneyService],
})
export class AdminModule {}
