import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OccurrencesController } from './occurrences.controller';
import { TodayService } from './today.service';

@Module({
  imports: [AuthModule],
  controllers: [OccurrencesController],
  providers: [TodayService],
  exports: [TodayService],
})
export class OccurrencesModule {}
