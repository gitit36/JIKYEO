/** Current public policy versions. Accepted CommitmentContract snapshots stay immutable. */
export const POLICY_VERSIONS = {
  terms: 'terms-v2',
  privacy: 'privacy-v1',
  moneyPolicy: 'money-policy-v1',
} as const;

export type MoneyAccessMode = 'disabled' | 'development' | 'review_demo' | 'production';

export interface MoneyAccess {
  mode: MoneyAccessMode;
  moneyEnabled: boolean;
  reviewDemo: boolean;
}

/**
 * Ordinary production cannot treat MockPayment as live MONEY.
 * Review/demo is explicit (`REVIEW_DEMO_MONEY=true` + mock provider only).
 */
export function resolveMoneyAccess(input: {
  nodeEnv: string;
  moneyEnabledEnv?: string;
  paymentProvider?: string;
  reviewDemoMoney?: string;
}): MoneyAccess {
  const provider = input.paymentProvider ?? 'mock';
  const liveProvider = provider === 'kr_pg' || provider === 'kcp';
  const reviewDemo = input.reviewDemoMoney === 'true' && !liveProvider;
  if (reviewDemo) {
    return { mode: 'review_demo', moneyEnabled: true, reviewDemo: true };
  }
  if (input.nodeEnv === 'production') {
    if (input.moneyEnabledEnv === 'true' && liveProvider) {
      return { mode: 'production', moneyEnabled: true, reviewDemo: false };
    }
    return { mode: 'disabled', moneyEnabled: false, reviewDemo: false };
  }
  const enabled = input.moneyEnabledEnv !== 'false';
  return { mode: enabled ? 'development' : 'disabled', moneyEnabled: enabled, reviewDemo: false };
}

/** Photo is mock-Vision only until a real provider is wired. */
export function photoEnabled(input: { nodeEnv: string; verificationProvider?: string }): boolean {
  if (input.verificationProvider === 'vision') return true;
  return input.nodeEnv !== 'production';
}

export function mvpMatrix(input: {
  nodeEnv: string;
  moneyEnabledEnv?: string;
  paymentProvider?: string;
  reviewDemoMoney?: string;
  verificationProvider?: string;
}) {
  const money = resolveMoneyAccess(input);
  const photo = photoEnabled(input);
  return {
    moneyMode: money.mode,
    moneyEnabled: money.moneyEnabled,
    reviewDemo: money.reviewDemo,
    methods: {
      photo,
      gps: true,
      timer: true,
      self: true,
      friend: true,
    },
    features: {
      self: true,
      social: true,
      friends: true,
      sharedCommitments: true,
      friendVerify: true,
      appeal: true,
      history: true,
      weeklyRecap: true,
      gps: true,
      focusTimer: true,
      selfVerify: true,
      localNotifications: true,
    },
    deferred: [
      'public_feed',
      'chat',
      'followers',
      'leaderboards',
      'pooled_money',
      'real_vision',
      'admin_web_ui',
      'real_apns',
      'subscription',
    ],
    policyVersions: POLICY_VERSIONS,
  };
}
