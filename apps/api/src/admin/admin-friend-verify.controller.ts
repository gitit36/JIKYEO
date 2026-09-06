import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FriendVerifyService } from '../friends/friend-verify.service';
import { AdminGuard } from './admin.guard';

@ApiTags('admin')
@UseGuards(AdminGuard)
@Controller('admin/friend-verifications')
export class AdminFriendVerifyController {
  constructor(private readonly verify: FriendVerifyService) {}

  @Get()
  list() {
    return this.verify.adminList();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.verify.adminDetail(id);
  }
}
