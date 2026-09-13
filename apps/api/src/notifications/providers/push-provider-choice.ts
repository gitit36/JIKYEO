export type PushProviderChoice = 'mock' | 'apns';

/** Production never uses MockPush as a live delivery path. */
export function resolvePushProviderChoice(input: {
  nodeEnv: string;
  pushProvider?: string;
}): PushProviderChoice {
  if (input.nodeEnv === 'production') return 'apns';
  return input.pushProvider === 'apns' ? 'apns' : 'mock';
}

export function apnsHost(environment: 'sandbox' | 'production'): string {
  return environment === 'production' ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
}
