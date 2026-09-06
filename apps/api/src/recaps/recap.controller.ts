import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { RecapService } from './recap.service';

@ApiTags('recaps')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('recaps')
export class RecapController {
  constructor(private readonly recaps: RecapService) {}

  @Get('latest')
  latest(@Req() req: AuthedRequest) {
    return this.recaps.latestFor(req.userId);
  }

  @Get(':localWeekStart')
  getOne(@Req() req: AuthedRequest, @Param('localWeekStart') localWeekStart: string) {
    return this.recaps.getOwned(req.userId, localWeekStart);
  }
}
