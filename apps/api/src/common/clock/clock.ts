import { Injectable } from '@nestjs/common';

/**
 * Time source. Never call `new Date()` in domain code directly — inject `Clock`.
 *
 * SRD §4: "server 수신시간을 authoritative time으로 사용".
 * SRD §4: "device time만으로 deadline 판정 금지".
 */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

/** Test-only clock. Not registered by default. */
export class FrozenClock extends Clock {
  constructor(private current: Date) {
    super();
  }
  now(): Date {
    return this.current;
  }
  set(d: Date): void {
    this.current = d;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
