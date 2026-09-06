import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminGuard } from './admin.guard';
import { AdminMoneyService, MoneyCaseKind } from './admin-money.service';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin/money')
export class AdminMoneyController {
  constructor(private readonly admin: AdminMoneyService) {}

  @Get('accounting')
  async accounting() {
    return this.admin.accountingSummary();
  }

  @Get('cases')
  async list(@Query('kind') kind?: MoneyCaseKind) {
    return this.admin.list(kind);
  }

  @Get('cases/:id')
  async one(@Param('id') id: string) {
    return this.admin.inspect(id);
  }

  @Post('cases/:id/retry')
  @HttpCode(200)
  async retry(@Param('id') id: string) {
    return this.admin.retry(id, null);
  }

  @Post('cases/:id/reconcile')
  @HttpCode(200)
  async reconcile(@Param('id') id: string) {
    return this.admin.reconcile(id, null);
  }
}
