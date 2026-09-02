import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { TodayService } from './today.service';

class TodayQuery {
  @IsOptional()
  @IsString()
  timezone?: string;
}

@ApiTags('occurrences')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('occurrences')
export class OccurrencesController {
  constructor(private readonly todayService: TodayService) {}

  @Get('today')
  today(@Req() req: AuthedRequest, @Query() q: TodayQuery): Promise<unknown> {
    return this.todayService.forUser(req.userId, q.timezone ?? 'Asia/Seoul').then((s) => ({
      atRiskKrw: s.atRiskKrw,
      moneyCount: s.moneyCount,
      count: s.count,
      items: s.items.map((i) => ({
        ...i,
        windowStartAt: i.windowStartAt.toISOString(),
        deadlineAt: i.deadlineAt.toISOString(),
      })),
    }));
  }
}
