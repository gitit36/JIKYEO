export type PushSendResult =
  | 'succeeded'
  | 'temporary_failure'
  | 'invalid_token'
  | 'permanent_failure'
  | 'not_configured';

export interface PushSendInput {
  deviceToken: string;
  title: string;
  body: string;
  deepLink: string;
  category: string;
  environment: 'sandbox' | 'production';
}

export class LostPushResponseError extends Error {
  constructor() {
    super('PUSH_RESPONSE_LOST');
    this.name = 'LostPushResponseError';
  }
}

export abstract class PushProvider {
  abstract readonly name: string;
  abstract send(input: PushSendInput): Promise<PushSendResult>;
}
