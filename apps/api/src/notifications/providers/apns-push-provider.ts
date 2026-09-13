import { Injectable, Optional } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { ApnsAuth } from './apns-auth';
import { ApnsTransport, ApnsHttpRequest, http2ApnsTransport } from './apns-transport';
import { apnsHost } from './push-provider-choice';
import { PushProvider, PushSendInput, PushSendResult } from './push-provider';

const INVALID = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);
const PERMANENT = new Set([
  'BadTopic',
  'BadCertificate',
  'InvalidProviderToken',
  'Forbidden',
  'MethodNotAllowed',
  'PayloadTooLarge',
  'BadExpirationDate',
  'BadPriority',
  'BadCollapseId',
  'MissingTopic',
  'ExpiredProviderToken',
]);

@Injectable()
export class ApnsPushProvider extends PushProvider {
  readonly name = 'apns';
  private auth: ApnsAuth | null = null;
  private transport: ApnsTransport = http2ApnsTransport;

  constructor(@Optional() private readonly cfg?: AppConfig) {
    super();
    const creds = cfg?.apns;
    if (creds) this.auth = new ApnsAuth(creds.teamId, creds.keyId, creds.privateKey);
  }

  /** Test hook. Production always uses HTTP/2. */
  useTransport(transport: ApnsTransport): this {
    this.transport = transport;
    return this;
  }

  async send(input: PushSendInput): Promise<PushSendResult> {
    const creds = this.cfg?.apns;
    if (!creds || !this.auth) return 'not_configured';
    const jwt = await this.auth.token();
    const req: ApnsHttpRequest = {
      host: apnsHost(input.environment),
      path: `/3/device/${input.deviceToken}`,
      authorization: `bearer ${jwt}`,
      topic: creds.topic,
      body: JSON.stringify({
        aps: { alert: { title: input.title, body: input.body }, sound: 'default' },
        deeplink: input.deepLink,
        category: input.category,
      }),
    };
    try {
      const res = await this.transport(req);
      if (res.status === 200) return 'succeeded';
      if (res.status === 410 || INVALID.has(res.reason ?? '')) return 'invalid_token';
      if (res.status === 400 && INVALID.has(res.reason ?? '')) return 'invalid_token';
      if (res.status === 403 || res.status === 400 || PERMANENT.has(res.reason ?? '')) {
        return 'permanent_failure';
      }
      if (res.status === 429 || res.status >= 500) return 'temporary_failure';
      return 'temporary_failure';
    } catch {
      return 'temporary_failure';
    }
  }
}
