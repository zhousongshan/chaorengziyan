export interface RegenerationSubmissionIdentity {
  taskId: string;
  unitId: string;
  sourceAssetId: string;
}

interface SubmissionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const storagePrefix = "image-regeneration-idempotency";

export class RegenerationSubmissionStore {
  private readonly memory = new Map<string, string>();

  public constructor(
    private readonly storage: SubmissionStorage | null,
    private readonly createIdempotencyKey: () => string = () => crypto.randomUUID()
  ) {}

  public getOrCreate(identity: RegenerationSubmissionIdentity): string {
    const storageKey = submissionStorageKey(identity);
    const existing = this.memory.get(storageKey) ?? this.read(storageKey);
    if (existing) {
      this.memory.set(storageKey, existing);
      return existing;
    }
    const created = this.createIdempotencyKey();
    this.memory.set(storageKey, created);
    this.write(storageKey, created);
    return created;
  }

  public clear(identity: RegenerationSubmissionIdentity): void {
    const storageKey = submissionStorageKey(identity);
    this.memory.delete(storageKey);
    try {
      this.storage?.removeItem(storageKey);
    } catch {
      // In-memory state still keeps the current page consistent when browser storage is unavailable.
    }
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value);
    } catch {
      // The in-memory fallback still prevents duplicate submission during this page lifetime.
    }
  }
}

export function createBrowserRegenerationSubmissionStore(): RegenerationSubmissionStore {
  try {
    return new RegenerationSubmissionStore(
      typeof window === "undefined" ? null : window.sessionStorage
    );
  } catch {
    return new RegenerationSubmissionStore(null);
  }
}

export function shouldRetainRegenerationSubmission(error: unknown): boolean {
  const status = readHttpStatus(error);
  return status === undefined || status >= 500;
}

function submissionStorageKey(identity: RegenerationSubmissionIdentity): string {
  return [storagePrefix, identity.taskId, identity.unitId, identity.sourceAssetId].join(":");
}

function readHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) return undefined;
  const status = error.status;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}
