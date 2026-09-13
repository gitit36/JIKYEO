import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { AppConfig } from '../config/app-config';
import { ApnsPushProvider } from './providers/apns-push-provider';
import { MockPushProvider } from './providers/mock-push-provider';
import { resolvePushProviderChoice } from './providers/push-provider-choice';
import { PushProvider } from './providers/push-provider';

@Module({
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    MockPushProvider,
    ApnsPushProvider,
    {
      provide: PushProvider,
      inject: [AppConfig, MockPushProvider, ApnsPushProvider],
      useFactory: (
        cfg: AppConfig,
        mock: MockPushProvider,
        apns: ApnsPushProvider,
      ): PushProvider =>
        resolvePushProviderChoice({ nodeEnv: cfg.nodeEnv, pushProvider: cfg.pushProvider }) === 'apns'
          ? apns
          : mock,
    },
  ],
  exports: [NotificationService, PushProvider, MockPushProvider],
})
export class NotificationsModule {}
