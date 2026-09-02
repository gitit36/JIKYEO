import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { NotFoundError } from '../common/errors/domain-errors';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitEvidenceDto } from './dto/submit-evidence.dto';
import { EvidenceService } from './evidence.service';
import { FocusTimerService } from './focus-timer.service';

class UploadTicketQuery {
  @IsOptional() @IsString() contentType?: string;
}

class TimerHeartbeatDto {
  @IsOptional() backgroundEvents?: number;
}

class TimerFinishDto {
  @IsOptional() terminated?: boolean;
}

/**
 * `POST /v1/occurrences/:id/evidence` and its ancillary endpoints.
 * The service returns the PersistedResult which the iOS client renders
 * on the result screen without needing a separate GET.
 */
@ApiTags('evidence')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class EvidenceController {
  constructor(
    private readonly evidence: EvidenceService,
    private readonly timers: FocusTimerService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('occurrences/:id/evidence/upload-url')
  async uploadUrl(
    @Req() req: AuthedRequest,
    @Param('id') occurrenceId: string,
    @Query() q: UploadTicketQuery,
  ): Promise<unknown> {
    const t = await this.evidence.issueUploadTicket(req.userId, occurrenceId, q.contentType);
    return { ...t, expiresAt: t.expiresAt.toISOString() };
  }

  @Post('occurrences/:id/evidence')
  @HttpCode(200)
  async submit(
    @Req() req: AuthedRequest,
    @Param('id') occurrenceId: string,
    @Body() dto: SubmitEvidenceDto,
  ): Promise<unknown> {
    return this.evidence.submit(req.userId, occurrenceId, dto);
  }

  @Get('occurrences/:id/result')
  async result(
    @Req() req: AuthedRequest,
    @Param('id') occurrenceId: string,
  ): Promise<unknown> {
    const row = await this.prisma.occurrence.findUnique({
      where: { id: occurrenceId },
      include: {
        commitment: { select: { userId: true, enforcementMode: true, title: true } },
        verificationResults: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!row || row.commitment.userId !== req.userId) {
      throw new NotFoundError('Occurrence not found');
    }
    const latest = row.verificationResults[0];
    return {
      occurrenceId: row.id,
      status: row.status,
      enforcementMode: row.commitment.enforcementMode,
      commitmentTitle: row.commitment.title,
      stakeKrw: row.stakeAmount?.toString() ?? null,
      result: latest?.result ?? null,
      reasonCode: latest?.reasonCode ?? null,
      userMessage: latest?.userMessage ?? null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
    };
  }

  @Post('occurrences/:id/timer/start')
  @HttpCode(200)
  async timerStart(
    @Req() req: AuthedRequest,
    @Param('id') occurrenceId: string,
  ): Promise<unknown> {
    return this.timers.start(req.userId, occurrenceId);
  }

  @Post('timer/sessions/:sessionId/heartbeat')
  @HttpCode(200)
  async timerHeartbeat(
    @Req() req: AuthedRequest,
    @Param('sessionId') sessionId: string,
    @Body() body: TimerHeartbeatDto,
  ): Promise<unknown> {
    return this.timers.heartbeat(req.userId, sessionId, body.backgroundEvents);
  }

  @Post('timer/sessions/:sessionId/finish')
  @HttpCode(200)
  async timerFinish(
    @Req() req: AuthedRequest,
    @Param('sessionId') sessionId: string,
    @Body() body: TimerFinishDto,
  ): Promise<unknown> {
    return this.timers.finish(req.userId, sessionId, { terminated: body.terminated });
  }
}
