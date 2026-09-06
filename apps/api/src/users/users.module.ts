import { Module } from '@nestjs/common';
import { MoneyGateService } from './money-gate.service';
import { UsersService } from './users.service';

@Module({
  providers: [UsersService, MoneyGateService],
  exports: [UsersService, MoneyGateService],
})
export class UsersModule {}
