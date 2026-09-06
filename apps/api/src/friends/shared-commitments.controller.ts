import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { ScheduleDto } from '../commitments/dto/schedule.dto';
import { SharedCommitmentService } from './shared-commitment.service';

@ApiTags('shared-commitments')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('shared-commitments')
export class SharedCommitmentsController {
  constructor(private readonly shared: SharedCommitmentService) {}

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: {
    title?: string;
    category?: string;
    timezone?: string;
    schedule?: ScheduleDto;
    inviteeUserIds?: string[];
  }) {
    const schedule = Object.assign(new ScheduleDto(), body.schedule);
    return this.shared.create(req.userId, {
      title: body.title ?? '',
      category: (body.category ?? 'custom') as never,
      timezone: body.timezone ?? 'Asia/Seoul',
      schedule: schedule.toDomain(),
      inviteeUserIds: body.inviteeUserIds,
    });
  }

  @Get(':id')
  detail(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.shared.detail(req.userId, id);
  }

  @Post(':id/invite')
  @HttpCode(200)
  invite(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { inviteeUserIds?: string[] }) {
    return this.shared.inviteMore(req.userId, id, body?.inviteeUserIds ?? []);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.shared.acceptInvite(req.userId, id);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.shared.declineInvite(req.userId, id);
  }

  @Post(':id/leave')
  @HttpCode(200)
  leave(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.shared.leave(req.userId, id);
  }
}
