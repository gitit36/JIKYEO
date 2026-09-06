import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { AppealService } from './appeal.service';
import { SubmitAppealDto } from './dto/submit-appeal.dto';

@ApiTags('appeals')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class AppealsController {
  constructor(private readonly appeals: AppealService) {}

  @Post('occurrences/:occurrenceId/appeals')
  @HttpCode(200)
  submit(
    @Req() req: AuthedRequest,
    @Param('occurrenceId') occurrenceId: string,
    @Body() dto: SubmitAppealDto,
  ) {
    return this.appeals.submit(req.userId, occurrenceId, {
      reasonCategory: dto.reasonCategory,
      explanation: dto.explanation,
    });
  }

  @Get('occurrences/:occurrenceId/appeal')
  getForOccurrence(@Req() req: AuthedRequest, @Param('occurrenceId') occurrenceId: string) {
    return this.appeals.getOwned(req.userId, occurrenceId);
  }

  @Get('appeals/:id')
  getOne(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.appeals.getOwnedById(req.userId, id);
  }
}
