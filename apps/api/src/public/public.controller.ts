import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppConfig } from '../config/app-config';
import { mvpMatrix, POLICY_VERSIONS } from './mvp-scope';

@ApiTags('public')
@Controller('public')
export class PublicController {
  constructor(private readonly cfg: AppConfig) {}

  @Get('mvp')
  mvp() {
    return mvpMatrix({
      nodeEnv: this.cfg.nodeEnv,
      moneyEnabledEnv: this.cfg.moneyEnabledRaw,
      paymentProvider: this.cfg.paymentProvider,
      reviewDemoMoney: this.cfg.reviewDemoMoneyRaw,
      verificationProvider: this.cfg.verificationProvider,
    });
  }

  @Get('policy')
  policy() {
    return { current: POLICY_VERSIONS };
  }
}
