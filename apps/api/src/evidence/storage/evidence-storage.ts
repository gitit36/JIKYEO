/**
 * Evidence object-storage abstraction.
 *
 * MVP production uses S3-compatible storage via presigned uploads; dev/test
 * uses a local in-memory implementation. Handlers only see storage keys —
 * they never touch bytes directly, so the mock is safe for verification-flow
 * unit tests without any network I/O.
 */
export interface EvidenceUploadTicket {
  /** Storage key the client will PUT the object to. Also written to Evidence.storage_key. */
  storageKey: string;
  /** Presigned URL for direct upload. `null` in dev when writes are not required. */
  uploadUrl: string | null;
  /** UTC time after which `uploadUrl` is no longer usable. */
  expiresAt: Date;
  /** Optional required Content-Type. */
  contentType?: string;
}

export abstract class EvidenceStorage {
  abstract issueUploadTicket(input: {
    userId: string;
    occurrenceId: string;
    contentType?: string;
    extension?: string;
  }): Promise<EvidenceUploadTicket>;

  /** Optional integrity check used by tests / real S3 head-object. */
  abstract exists(storageKey: string): Promise<boolean>;

  /** Permanently remove the raw object. Must be idempotent if the key is already gone. */
  abstract delete(storageKey: string): Promise<void>;
}
