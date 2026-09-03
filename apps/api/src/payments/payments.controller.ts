import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { MoneyStatusService } from './money-status.service';
import { PaymentService } from './payment.service';

export class PayCommitmentDto {
  /** Dev/test only: force the mock PG to decline. Ignored by real providers. */
  @IsOptional()
  @IsIn(['charge_fail'])
  simulate?: 'charge_fail';
}

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentService,
    private readonly money: MoneyStatusService,
  ) {}

  /**
   * Charge the upfront max-loss for a payment_pending MONEY commitment.
   * Idempotent per commitment. On success: Stake funded, commitment
   * `signature_pending`. Activation happens only at `/sign`.
   */
  @Post('commitments/:id/pay')
  @HttpCode(200)
  async pay(@Req() req: AuthedRequest, @Param('id') id: string, @Body() dto: PayCommitmentDto): Promise<unknown> {
    const payment = await this.payments.chargeUpfront(req.userId, id, { simulate: dto?.simulate });
    const money = await this.money.forCommitment(id);
    return { payment, money };
  }

  @Get('commitments/:id/money')
  async moneyStatus(@Req() req: AuthedRequest, @Param('id') id: string): Promise<unknown> {
    return { money: await this.money.forOwnedCommitment(req.userId, id) };
  }

  @Get('payments/:id')
  async getOne(@Req() req: AuthedRequest, @Param('id') id: string): Promise<unknown> {
    return this.payments.getOwned(req.userId, id);
  }
}

/**
 * Inbound PG webhooks. No bearer auth — authenticity comes from the
 * provider signature verified inside PaymentService.handleWebhook.
 *
 * NOTE for real PG wiring: HMAC verification needs the exact raw body.
 * Register a raw-body parser for this route at that time; the mock
 * provider only checks the `x-mock-signature` header.
 */
@ApiTags('payments')
@Controller('webhooks')
export class PaymentWebhookController {
  constructor(private readonly payments: PaymentService) {}

  @Post('payment')
  @HttpCode(200)
  async payment(
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<unknown> {
    return this.payments.handleWebhook(JSON.stringify(body ?? {}), headers);
  }
}
