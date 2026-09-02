import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { QuoteRequestDto } from './dto/schedule.dto';
import { QuoteService } from './quote/quote.service';

@ApiTags('commitments')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('commitments')
export class CommitmentsController {
  constructor(private readonly quote: QuoteService) {}

  @Post('quote')
  computeQuote(@Body() dto: QuoteRequestDto): unknown {
    const q = this.quote.compute({
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
}
