import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { CommitmentService } from './commitment.service';
import { CreateCommitmentDraftDto } from './dto/create-commitment.dto';
import { QuoteRequestDto } from './dto/schedule.dto';
import { QuoteService } from './quote/quote.service';

@ApiTags('commitments')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('commitments')
export class CommitmentsController {
  constructor(
    private readonly quote: QuoteService,
    private readonly commitment: CommitmentService,
  ) {}

  @Post('quote')
  @HttpCode(200)
  async computeQuote(@Req() req: AuthedRequest, @Body() dto: QuoteRequestDto): Promise<unknown> {
    const q = await this.quote.compute({
      userId: req.userId,
      schedule: dto.schedule.toDomain(),
      stakePerOccurrenceKrw: dto.stakePerOccurrenceKrw,
      timezone: dto.timezone,
    });
    return {
      quoteId: q.quoteId,
      occurrenceCount: q.occurrenceCount,
      stakePerOccurrence: q.stakePerOccurrence.toString(),
      maxLoss: q.maxLoss.toString(),
      currency: q.currency,
      quoteExpiresAt: q.quoteExpiresAt.toISOString(),
    };
  }

  @Post()
  async create(@Req() req: AuthedRequest, @Body() dto: CreateCommitmentDraftDto): Promise<unknown> {
    return this.commitment.createAndActivate(req.userId, dto);
  }

  @Get()
  async listMine(@Req() req: AuthedRequest): Promise<unknown> {
    return this.commitment.getOwnedList(req.userId);
  }

  @Get(':id')
  async getOne(@Req() req: AuthedRequest, @Param('id') id: string): Promise<unknown> {
    return this.commitment.getOwnedDetail(req.userId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async cancel(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.commitment.cancel(req.userId, id);
  }
}
