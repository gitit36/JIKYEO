import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InternalJobGuard } from './internal-job.guard';
import { MoneyMaintenanceService } from './money-maintenance.service';

@ApiTags('internal-jobs')
@UseGuards(InternalJobGuard)
@Controller('internal/jobs')
export class JobsController {
  constructor(private readonly maintenance: MoneyMaintenanceService) {}

  @Post('money-maintenance')
  @HttpCode(200)
  async moneyMaintenance() {
    return this.maintenance.run();
  }
}
