import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecapController } from './recap.controller';
import { RecapService } from './recap.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [RecapController],
  providers: [RecapService],
  exports: [RecapService],
})
export class RecapsModule {}
