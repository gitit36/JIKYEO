import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Clock } from '../common/clock/clock';
import { MoneyGateService } from '../users/money-gate.service';
import { AdminGuard } from './admin.guard';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly gate: MoneyGateService,
    private readonly clock: Clock,
  ) {}

  @Post(':id/age')
  @HttpCode(200)
  async setAge(
    @Param('id') id: string,
    @Body() body: { status?: 'verified_adult' | 'underage' },
  ) {
    const status = body?.status === 'underage' ? 'underage' : 'verified_adult';
    await this.gate.setAgeFixture(id, status, this.clock.now());
    return { userId: id, ageVerificationStatus: status };
  }
}
