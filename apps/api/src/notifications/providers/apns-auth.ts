import { createPrivateKey, createSign } from 'node:crypto';

const REFRESH_AFTER_SECONDS = 50 * 60;

export class ApnsAuth {
  private cached: { jwt: string; mintedAt: number } | null = null;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly teamId: string,
    private readonly keyId: string,
    private readonly privateKeyPem: string,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async token(): Promise<string> {
    const now = this.now();
    if (this.cached && now - this.cached.mintedAt < REFRESH_AFTER_SECONDS) {
      return this.cached.jwt;
    }
    if (this.inflight) return this.inflight;
    this.inflight = Promise.resolve(this.mint(now)).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private mint(iat: number): string {
    const header = b64url(JSON.stringify({ alg: 'ES256', kid: this.keyId }));
    const payload = b64url(JSON.stringify({ iss: this.teamId, iat }));
    const signer = createSign('SHA256');
    signer.update(`${header}.${payload}`);
    signer.end();
    const key = createPrivateKey(normalizePem(this.privateKeyPem));
    const sig = signer.sign({ key, dsaEncoding: 'ieee-p1363' });
    const jwt = `${header}.${payload}.${sig.toString('base64url')}`;
    this.cached = { jwt, mintedAt: iat };
    return jwt;
  }
}

function normalizePem(raw: string): string {
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url');
}
