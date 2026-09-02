import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from './clock/clock';
import { IdempotencyService } from './idempotency/idempotency.service';
import { Locker } from './locker/locker';

@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    IdempotencyService,
    Locker,
  ],
  exports: [Clock, IdempotencyService, Locker],
})
export class CommonModule {}
