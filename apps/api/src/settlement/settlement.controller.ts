import { Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { ForbiddenError, NotFoundError } from '../common/errors/domain-errors';
import { PrismaService } from '../prisma/prisma.service';
import { SettlementService } from './settlement.service';

@ApiTags('settlements')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class SettlementController {
  constructor(
    private readonly settlement: SettlementService,
    private readonly prisma: PrismaService,
  ) {}

  /** Per-occurrence settlement rows for the caller's MONEY commitments. */
  @Get('settlements')
  async mine(@Req() req: AuthedRequest): Promise<unknown> {
    const rows = await this.prisma.settlement.findMany({
      where: { occurrence: { commitment: { userId: req.userId } } },
      include: { occurrence: { select: { commitmentId: true, sequenceNo: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((s) => ({
      settlementId: s.id,
      commitmentId: s.occurrence.commitmentId,
      occurrenceId: s.occurrenceId,
      sequenceNo: s.occurrence.sequenceNo,
      result: s.result,
      amountKrw: s.amount.toString(),
      status: s.status,
      processedAt: s.processedAt?.toISOString() ?? null,
    }));
  }

  /**
   * Owner-triggered settlement pass. Idempotent: settles any newly-final
   * occurrences, closes the commitment if everything is final, and (re)tries
   * the aggregate refund. Used by the app after a verdict and as the
   * "환불 지연 → 다시 시도" action.
   */
  @Post('commitments/:id/settle')
  @HttpCode(200)
  async settle(@Req() req: AuthedRequest, @Param('id') id: string): Promise<unknown> {
    await this.assertOwner(req.userId, id);
    return this.settlement.settleCommitment(id);
  }

  private async assertOwner(userId: string, commitmentId: string): Promise<void> {
    const c = await this.prisma.commitment.findUnique({ where: { id: commitmentId }, select: { userId: true } });
    if (!c) throw new NotFoundError('Commitment not found');
    if (c.userId !== userId) throw new ForbiddenError();
  }
}
