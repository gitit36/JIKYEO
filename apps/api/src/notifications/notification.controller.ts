import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthGuard, AuthedRequest } from '../auth/auth.guard';
import { NotificationService } from './notification.service';

class RegisterDeviceDto {
  @IsString() @MinLength(8) token!: string;
  @IsIn(['sandbox', 'production']) environment!: 'sandbox' | 'production';
}

class UnregisterDeviceDto {
  @IsString() @MinLength(8) token!: string;
}

class NotificationPrefsDto {
  @IsOptional() @IsBoolean() deadlineReminder?: boolean;
  @IsOptional() @IsBoolean() signatureExpiry?: boolean;
  @IsOptional() @IsBoolean() refund?: boolean;
  @IsOptional() @IsBoolean() appeal?: boolean;
  @IsOptional() @IsBoolean() weeklyRecap?: boolean;
}

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller()
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Post('devices/tokens')
  @HttpCode(200)
  register(@Req() req: AuthedRequest, @Body() dto: RegisterDeviceDto) {
    return this.notifications.registerDevice(req.userId, dto.token, dto.environment);
  }

  @Post('devices/tokens/unregister')
  @HttpCode(200)
  unregister(@Req() req: AuthedRequest, @Body() dto: UnregisterDeviceDto) {
    return this.notifications.unregisterDevice(req.userId, dto.token);
  }

  @Get('notifications/preferences')
  prefs(@Req() req: AuthedRequest) {
    return this.notifications.getPreferences(req.userId);
  }

  @Post('notifications/preferences')
  @HttpCode(200)
  setPrefs(@Req() req: AuthedRequest, @Body() dto: NotificationPrefsDto) {
    return this.notifications.setPreferences(req.userId, dto);
  }
}
