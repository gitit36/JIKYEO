import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { StakePolicyController } from './stake-policy.controller';
import { DEFAULT_STAKE_POLICY_CONFIG, STAKE_POLICY_CONFIG, StakePolicyService } from './stake-policy.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [StakePolicyController],
  providers: [
    StakePolicyService,
    { provide: STAKE_POLICY_CONFIG, useValue: DEFAULT_STAKE_POLICY_CONFIG },
  ],
  exports: [StakePolicyService],
})
export class StakePolicyModule {}
