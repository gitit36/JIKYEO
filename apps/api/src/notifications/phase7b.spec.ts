import { generateKeyPairSync } from 'node:crypto';
import { FrozenClock } from '../common/clock/clock';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/app-config';
import { InMemoryMoneyDb } from '../payments/testing/in-memory-money-db';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { ApnsAuth } from './providers/apns-auth';
import { ApnsPushProvider } from './providers/apns-push-provider';
import { ApnsHttpRequest } from './providers/apns-transport';
import { MockPushProvider } from './providers/mock-push-provider';
import { apnsHost, resolvePushProviderChoice } from './providers/push-provider-choice';
import { PUSH_COPY, assertGenericLockScreen } from './push-copy';

const USER = 'u1';
const SECRET = 'dev-only-push-token-encryption-secret';
const NOW = new Date('2026-09-14T00:10:00Z');

function testPem(): string {
  return generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
    type: 'pkcs8', format: 'pem',
  }).toString();
}

function cfg(extra: Record<string, string> = {}) {
  return new AppConfig({
    get: (k: string) => ({
      PUSH_TOKEN_ENCRYPTION_SECRET: SECRET,
      JWT_SECRET: 'jwt-secret-value',
      QUOTE_SIGNING_SECRET: 'quote-secret-value',
      ...extra,
    }[k]),
  } as ConfigService);
}

function make(push = new MockPushProvider()) {
  const db = new InMemoryMoneyDb();
  const notifications = new NotificationService(db as unknown as PrismaService, new FrozenClock(NOW), cfg(), push);
  return { db, push, notifications };
}

describe('Phase 7B — APNs provider', () => {
  it('selects APNs in production and MockPush only outside production', () => {
    expect(resolvePushProviderChoice({ nodeEnv: 'production', pushProvider: 'mock' })).toBe('apns');
    expect(resolvePushProviderChoice({ nodeEnv: 'test', pushProvider: 'mock' })).toBe('mock');
    expect(resolvePushProviderChoice({ nodeEnv: 'development', pushProvider: 'apns' })).toBe('apns');
  });

  it('routes sandbox tokens to sandbox APNs and production tokens to production APNs', async () => {
    const calls: ApnsHttpRequest[] = [];
    const pem = testPem();
    const provider = new ApnsPushProvider(
      cfg({ APNS_TEAM_ID: 'TEAM1', APNS_KEY_ID: 'KEY01', APNS_PRIVATE_KEY: pem, APNS_TOPIC: 'com.jikyeo.app' }),
    ).useTransport(async (req) => {
      calls.push(req);
      return { status: 200 };
    });
    await provider.send({
      deviceToken: 'tok-sand', title: 't', body: 'b', deepLink: 'jikyeo://today',
      category: 'deadline_reminder', environment: 'sandbox',
    });
    await provider.send({
      deviceToken: 'tok-prod', title: 't', body: 'b', deepLink: 'jikyeo://today',
      category: 'deadline_reminder', environment: 'production',
    });
    expect(calls[0].host).toBe(apnsHost('sandbox'));
    expect(calls[1].host).toBe(apnsHost('production'));
    expect(calls[0].host).not.toBe(calls[1].host);
    expect(calls[0].path).toBe('/3/device/tok-sand');
    expect(calls[1].path).toBe('/3/device/tok-prod');
  });

  it('duplicate registration is idempotent and multiple devices stay active', async () => {
    const { db, notifications } = make();
    await db.user.create({ data: { id: USER, status: 'active' } });
    const a = await notifications.registerDevice(USER, 'token-dev-aaaa', 'sandbox');
    const again = await notifications.registerDevice(USER, 'token-dev-aaaa', 'sandbox');
    expect(again.tokenHash).toBe(a.tokenHash);
    expect(db.deviceToken.rows).toHaveLength(1);
    await notifications.registerDevice(USER, 'token-dev-bbbb', 'production');
    expect(db.deviceToken.rows.filter((r) => r.active)).toHaveLength(2);
  });

  it('invalid APNs token is revoked; transient retries without a new outbox row; permanent stops', async () => {
    const calls: ApnsHttpRequest[] = [];
    const pem = testPem();
    let status = 410;
    let reason = 'Unregistered';
    const provider = new ApnsPushProvider(
      cfg({ APNS_TEAM_ID: 'TEAM1', APNS_KEY_ID: 'KEY01', APNS_PRIVATE_KEY: pem }),
    ).useTransport(async (req) => {
      calls.push(req);
      return { status, reason };
    });
    const { db, notifications } = make(provider as any);
    await db.user.create({ data: { id: USER, status: 'active' } });
    await notifications.registerDevice(USER, 'token-dead-0001', 'sandbox');
    await notifications.enqueue({
      userId: USER, category: 'deadline_reminder', dedupeKey: 'deadline:o1', deepLink: 'jikyeo://today',
    });
    await notifications.processOutbox();
    expect(db.deviceToken.rows[0].active).toBe(false);
    expect(db.notificationOutbox.rows).toHaveLength(1);
    expect(db.notificationOutbox.rows[0].status).toBe('failed');
    const next = db.notificationOutbox.rows[0].nextAttemptAt as Date;
    expect(next.getUTCFullYear()).toBe(2099);

    status = 429;
    reason = 'TooManyRequests';
    await notifications.registerDevice(USER, 'token-live-0002', 'sandbox');
    await notifications.enqueue({
      userId: USER, category: 'appeal', dedupeKey: 'appeal_decided:a1', deepLink: 'jikyeo://appeals/a1',
    });
    await notifications.processOutbox();
    expect(db.notificationOutbox.rows.find((r) => r.dedupeKey === 'appeal_decided:a1')!.status).toBe('failed');
    expect(db.notificationOutbox.rows.filter((r) => r.dedupeKey === 'appeal_decided:a1')).toHaveLength(1);

    status = 400;
    reason = 'BadTopic';
    await notifications.enqueue({
      userId: USER, category: 'refund', dedupeKey: 'refund_completed:p1', deepLink: 'jikyeo://history',
    });
    await notifications.processOutbox();
    const perm = db.notificationOutbox.rows.find((r) => r.dedupeKey === 'refund_completed:p1')!;
    expect(perm.status).toBe('failed');
    expect(perm.lastError).toBe('permanent_failure');
    expect((perm.nextAttemptAt as Date).getUTCFullYear()).toBe(2099);
  });

  it('preferences still suppress delivery; domain enqueue succeeds when APNs fails', async () => {
    const pem = testPem();
    const provider = new ApnsPushProvider(
      cfg({ APNS_TEAM_ID: 'TEAM1', APNS_KEY_ID: 'KEY01', APNS_PRIVATE_KEY: pem }),
    ).useTransport(async () => { throw new Error('network'); });
    const { db, notifications } = make(provider as any);
    await db.user.create({ data: { id: USER, status: 'active' } });
    await notifications.registerDevice(USER, 'token-pref-0001', 'sandbox');
    await notifications.setPreferences(USER, { social: false });
    const created = await notifications.enqueue({
      userId: USER, category: 'friend_verify_request', dedupeKey: 'friend_verify_request:x',
      deepLink: 'jikyeo://friends',
    });
    expect(created.created).toBe(true);
    await notifications.processOutbox();
    expect(db.notificationOutbox.rows[0].lastError).toBe('opted_out');
    expect(db.notificationOutbox.rows[0].status).toBe('sent');

    await notifications.setPreferences(USER, { social: true });
    const again = await notifications.enqueue({
      userId: USER, category: 'friend_verify_approved', dedupeKey: 'friend_verify_approved:x',
      deepLink: 'jikyeo://today',
    });
    expect(again.created).toBe(true);
    await notifications.processOutbox();
    expect(db.notificationOutbox.rows.find((r) => r.dedupeKey === 'friend_verify_approved:x')!.status).toBe('failed');
    expect(db.notificationOutbox.rows.find((r) => r.dedupeKey === 'friend_verify_approved:x')!.lastError).toBe('temporary_failure');
  });

  it('APNs payload stays generic and deep links are not an auth grant', async () => {
    const calls: ApnsHttpRequest[] = [];
    const pem = testPem();
    const provider = new ApnsPushProvider(
      cfg({ APNS_TEAM_ID: 'TEAM1', APNS_KEY_ID: 'KEY01', APNS_PRIVATE_KEY: pem }),
    ).useTransport(async (req) => { calls.push(req); return { status: 200 }; });
    const { db, notifications } = make(provider as any);
    await db.user.create({ data: { id: USER, status: 'active' } });
    await db.user.create({ data: { id: 'u2', status: 'active' } });
    await notifications.registerDevice(USER, 'token-safe-0001', 'sandbox');
    await notifications.enqueue({
      userId: USER, category: 'appeal', dedupeKey: 'appeal_decided:not-yours',
      deepLink: 'jikyeo://appeals/other-user-appeal',
    });
    await notifications.processOutbox();
    const body = JSON.parse(calls[0].body) as { aps: { alert: { title: string; body: string } }; deeplink: string };
    assertGenericLockScreen(body.aps.alert.title, body.aps.alert.body);
    expect(JSON.stringify(body)).not.toMatch(/원|₩|KRW|ledger|lat|lng|evidence/i);
    expect(body.deeplink).toBe('jikyeo://appeals/other-user-appeal');
    expect(db.deviceToken.rows.filter((r) => r.userId === 'u2')).toHaveLength(0);
    for (const c of Object.values(PUSH_COPY)) assertGenericLockScreen(c.title, c.body);
  });

  it('logout/unregister disables the token; missing credentials never claim delivery', async () => {
    const { db, notifications } = make();
    await db.user.create({ data: { id: USER, status: 'active' } });
    await notifications.registerDevice(USER, 'token-out-0001', 'sandbox');
    await notifications.unregisterDevice(USER, 'token-out-0001');
    expect(db.deviceToken.rows[0].active).toBe(false);

    const bare = new ApnsPushProvider(cfg());
    const result = await bare.send({
      deviceToken: 'tok', title: 't', body: 'b', deepLink: 'jikyeo://today',
      category: 'deadline_reminder', environment: 'sandbox',
    });
    expect(result).toBe('not_configured');
    const { db: db2, notifications: n2 } = make(bare as any);
    await db2.user.create({ data: { id: USER, status: 'active' } });
    await n2.registerDevice(USER, 'token-miss-0001', 'production');
    await n2.enqueue({
      userId: USER, category: 'weekly_recap', dedupeKey: 'recap:u1:w', deepLink: 'jikyeo://recap/2026-09-07',
    });
    await n2.processOutbox();
    expect(db2.notificationOutbox.rows[0].status).toBe('failed');
    expect(db2.notificationOutbox.rows[0].lastError).toBe('not_configured');
    expect(db2.notificationOutbox.rows[0].status).not.toBe('sent');
  });

  it('reuses provider JWT and does not expose it on the payload', async () => {
    const pem = testPem();
    const auth = new ApnsAuth('TEAM1', 'KEY01', pem, () => 1_000_000);
    const a = await auth.token();
    const b = await Promise.all([auth.token(), auth.token()]);
    expect(b[0]).toBe(a);
    expect(b[1]).toBe(a);
    const calls: ApnsHttpRequest[] = [];
    const provider = new ApnsPushProvider(
      cfg({ APNS_TEAM_ID: 'TEAM1', APNS_KEY_ID: 'KEY01', APNS_PRIVATE_KEY: pem }),
    ).useTransport(async (req) => { calls.push(req); return { status: 200 }; });
    await provider.send({
      deviceToken: 'tok', title: PUSH_COPY.deadline_reminder.title, body: PUSH_COPY.deadline_reminder.body,
      deepLink: 'jikyeo://today', category: 'deadline_reminder', environment: 'sandbox',
    });
    expect(calls[0].body).not.toContain(calls[0].authorization.slice(7, 20));
    expect(JSON.parse(calls[0].body).aps.alert.title).toBe(PUSH_COPY.deadline_reminder.title);
  });
});
