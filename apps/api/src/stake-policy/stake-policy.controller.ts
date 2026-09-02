import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { StakePolicyService } from './stake-policy.service';

@ApiTags('stake-policy')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('stake-policy')
export class StakePolicyController {
  constructor(private readonly svc: StakePolicyService) {}

  @Get()
  async mine(@Req() req: AuthedRequest): Promise<unknown> {
    return this.svc.forUser(req.userId);
  }
}
