import { Injectable } from '@nestjs/common';
import { LostPushResponseError, PushProvider, PushSendInput, PushSendResult } from './push-provider';

@Injectable()
export class MockPushProvider extends PushProvider {
  readonly name = 'mock';
  readonly sends: PushSendInput[] = [];
  failNext: PushSendResult | 'lost' | null = null;

  async send(input: PushSendInput): Promise<PushSendResult> {
    this.sends.push({ ...input });
    const next = this.failNext;
    this.failNext = null;
    if (next === 'lost') throw new LostPushResponseError();
    if (next === 'temporary_failure' || next === 'invalid_token') return next;
    return 'succeeded';
  }
}
