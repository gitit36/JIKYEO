import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { FriendVerifyService } from './friend-verify.service';
import { FriendsService } from './friends.service';
import { SharedCommitmentService } from './shared-commitment.service';

@ApiTags('friends')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class FriendsController {
  constructor(
    private readonly friends: FriendsService,
    private readonly shared: SharedCommitmentService,
    private readonly friendVerify: FriendVerifyService,
  ) {}

  @Get('me/invite-code')
  inviteCode(@Req() req: AuthedRequest) {
    return this.friends.inviteCode(req.userId);
  }

  @Get('friends')
  list(@Req() req: AuthedRequest) {
    return this.friends.listAccepted(req.userId);
  }

  @Get('friends/requests')
  requests(@Req() req: AuthedRequest) {
    return this.friends.listIncoming(req.userId);
  }

  @Get('friends/home')
  async home(@Req() req: AuthedRequest) {
    const home = await this.shared.home(req.userId);
    return { ...home, reviewQueue: await this.friendVerify.inbox(req.userId) };
  }

  @Post('friends/invite')
  @HttpCode(200)
  invite(@Req() req: AuthedRequest, @Body() body: { inviteCode?: string }) {
    return this.friends.invite(req.userId, body?.inviteCode ?? '');
  }

  @Post('friends/:id/accept')
  @HttpCode(200)
  accept(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.friends.accept(req.userId, id);
  }

  @Post('friends/:id/decline')
  @HttpCode(200)
  decline(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.friends.decline(req.userId, id);
  }

  @Delete('friends/:id')
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    const r = await this.friends.remove(req.userId, id);
    if (r.friendUserId) await this.friendVerify.revokePair(req.userId, r.friendUserId);
    return r;
  }

  @Post('friends/:id/block')
  @HttpCode(200)
  async block(@Req() req: AuthedRequest, @Param('id') id: string) {
    const r = await this.friends.block(req.userId, id);
    await this.friendVerify.revokePair(req.userId, r.friendUserId);
    return r;
  }

  @Get('social/commitments/:id')
  socialView(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.shared.socialCommitmentView(req.userId, id);
  }
}
