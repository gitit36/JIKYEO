import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { ValidationError } from '../common/errors/domain-errors';
import { FriendVerifyService } from './friend-verify.service';

@ApiTags('friend-verify')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class FriendVerifyController {
  constructor(private readonly verify: FriendVerifyService) {}

  @Get('friend-verifications')
  inbox(@Req() req: AuthedRequest) {
    return this.verify.inbox(req.userId);
  }

  @Get('occurrences/:id/friend-verification')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.verify.get(req.userId, id);
  }

  @Post('occurrences/:id/friend-verification')
  @HttpCode(200)
  act(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() body: { action?: 'request' | 'approve' | 'reject' },
  ) {
    const action = body?.action ?? 'request';
    if (action === 'request') return this.verify.request(req.userId, id);
    if (action === 'approve' || action === 'reject') {
      return this.verify.decide(req.userId, id, action === 'approve' ? 'approved' : 'rejected');
    }
    throw new ValidationError('action required');
  }
}
