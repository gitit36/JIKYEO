/** High-value MVP funnel events. Payloads must stay non-sensitive. */
export const ANALYTICS_EVENTS = [
  'onboarding_completed',
  'commitment_created',
  'commitment_activated',
  'verification_submitted',
  'verification_pass',
  'verification_uncertain',
  'verification_fail',
  'appeal_opened',
  'friend_added',
  'shared_commitment_joined',
  'friend_verify_requested',
  'commitment_success',
  'commitment_fail',
  'money_review_started',
  'money_demo_contract_created',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export interface AnalyticsSink {
  track(event: string, props: Record<string, string>): void;
}

const BANNED = /lat|lng|gps|coord|evidence|photo|storage|appeal|reason|explanation|payment|token|friend|email|note/i;

export function sanitizeAnalyticsProps(props: Record<string, unknown> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (BANNED.test(key)) continue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue;
    const text = String(value);
    if (/^-?\d+\.\d+$/.test(text) && Math.abs(Number(text)) <= 180) continue;
    out[key] = text.slice(0, 32);
  }
  return out;
}

export const noopAnalytics: AnalyticsSink = { track() { /* no-op */ } };

/** Fire-and-forget. Domain success must not depend on delivery. */
export function safeTrack(
  sink: AnalyticsSink,
  event: string,
  props: Record<string, unknown> = {},
): void {
  try {
    sink.track(event, sanitizeAnalyticsProps(props));
  } catch {
    // ignore
  }
}
