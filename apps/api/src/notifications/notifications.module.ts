import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { MockPushProvider } from './providers/mock-push-provider';
import { PushProvider } from './providers/push-provider';

@Module({
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    MockPushProvider,
    { provide: PushProvider, useExisting: MockPushProvider },
  ],
  exports: [NotificationService, PushProvider, MockPushProvider],
})
export class NotificationsModule {}
