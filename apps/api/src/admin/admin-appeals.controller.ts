import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppealService } from '../appeals/appeal.service';
import { ApproveAppealDto, RejectAppealDto } from '../appeals/dto/decide-appeal.dto';
import { AdminGuard } from './admin.guard';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin/appeals')
export class AdminAppealsController {
  constructor(private readonly appeals: AppealService) {}

  @Get()
  pending() {
    return this.appeals.listPending();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.appeals.adminDetail(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string, @Body() dto: ApproveAppealDto) {
    return this.appeals.approve(id, dto.correctedResult, null, dto.simulate);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id') id: string, @Body() dto: RejectAppealDto) {
    return this.appeals.reject(id, dto.reason, null);
  }
}
