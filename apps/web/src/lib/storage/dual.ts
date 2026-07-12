import 'server-only';

import { logAudit } from '@/lib/auth/audit';
import { reportWarning } from '@/lib/observability';

import { LocalStorageAdapter } from './local';
import { deleteObjectFromR2, putObjectToR2 } from './r2';
import type { StorageAdapter, UploadInput } from './types';

/**
 * Dual-write storage adapter (J1 — offsite media redundancy, ADR-006).
 *
 * Local disk is the PRIMARY store: a put only succeeds if the local write
 * succeeds, and reads/URLs keep flowing through the local adapter + the
 * auth-gated route. R2 is the offsite MIRROR of the SAME key — awaited but
 * caught, so a mirror outage NEVER blocks a member-facing upload or delete.
 *
 * Every mirror outcome is journaled (`storage.r2_mirror.succeeded|failed`,
 * PII-free `{key, stage}`) — `getOffsiteMirrorHealth()` reads the latest
 * event to surface offsite health on /admin/system, and failures also raise
 * a Sentry warning so a sustained drift is visible without opening the board.
 */
export class DualWriteStorageAdapter implements StorageAdapter {
  readonly id = 'dual';

  private readonly local = new LocalStorageAdapter();

  async put(input: UploadInput): Promise<{ key: string; readUrl: string }> {
    // Primary write — MUST succeed (any throw propagates to the caller).
    const result = await this.local.put(input);
    await this.mirror('put', result.key, () =>
      putObjectToR2(result.key, input.bytes, input.contentType),
    );
    return result;
  }

  getReadUrl(key: string): string {
    return this.local.getReadUrl(key);
  }

  async delete(key: string): Promise<void> {
    await this.local.delete(key);
    await this.mirror('delete', key, () => deleteObjectFromR2(key));
  }

  /**
   * Awaited-but-caught mirror call. The audit journal is PII-free: metadata
   * carries only `{key, stage}` — the error itself goes to Sentry as a
   * warning (message only), never into the audit row.
   */
  private async mirror(
    stage: 'put' | 'delete',
    key: string,
    operation: () => Promise<void>,
  ): Promise<void> {
    try {
      await operation();
      await logAudit({ action: 'storage.r2_mirror.succeeded', metadata: { key, stage } });
    } catch (err) {
      reportWarning('storage.r2_mirror', `mirror_${stage}_failed`, {
        key,
        message: err instanceof Error ? err.message : String(err),
      });
      await logAudit({ action: 'storage.r2_mirror.failed', metadata: { key, stage } });
    }
  }
}
