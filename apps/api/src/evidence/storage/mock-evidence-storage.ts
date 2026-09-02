import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Clock } from '../../common/clock/clock';
import { EvidenceStorage, EvidenceUploadTicket } from './evidence-storage';

/**
 * In-memory mock. Real deployments wire in an S3EvidenceStorage that
 * generates presigned PUT URLs against the S3 bucket configured in
 * AppConfig.
 *
 * For MVP dev on iOS Simulator the client posts the photo bytes to the
 * returned `uploadUrl` (which points at a local dev endpoint), but the
 * verification pipeline only needs the storage key and hash.
 */
@Injectable()
export class MockEvidenceStorage extends EvidenceStorage {
  private readonly keys = new Set<string>();

  constructor(private readonly clock: Clock) {
    super();
  }

  async issueUploadTicket(input: {
    userId: string;
    occurrenceId: string;
    contentType?: string;
    extension?: string;
  }): Promise<EvidenceUploadTicket> {
    const ext = input.extension ?? 'jpg';
    const rand = randomBytes(8).toString('hex');
    const storageKey = `evidence/${input.userId}/${input.occurrenceId}/${rand}.${ext}`;
    this.keys.add(storageKey);
    const expiresAt = new Date(this.clock.now().getTime() + 5 * 60 * 1000);
    return {
      storageKey,
      uploadUrl: `mock://evidence/${storageKey}`,
      expiresAt,
      contentType: input.contentType,
    };
  }

  async exists(storageKey: string): Promise<boolean> {
    return this.keys.has(storageKey);
  }

  /** Test-only helper. */
  markUploaded(storageKey: string): void {
    this.keys.add(storageKey);
  }
}
