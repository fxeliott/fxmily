import 'server-only';

import type { StorageAdapter, UploadInput } from './types';

/**
 * Cloudflare R2 storage adapter — STUB (J2).
 *
 * Will be wired when Eliot provides the R2 keys (env vars `R2_ACCOUNT_ID`,
 * `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`).
 *
 * Implementation outline (kept here as a checklist, not a TODO sprawl):
 *
 *   1. `pnpm --filter @fxmily/web add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`
 *   2. Construct an `S3Client` against the R2 account-scoped endpoint:
 *        new S3Client({
 *          region: 'auto',
 *          endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
 *          credentials: { accessKeyId: env.R2_ACCESS_KEY_ID!, secretAccessKey: env.R2_SECRET_ACCESS_KEY! },
 *        })
 *   3. `put`: `PutObjectCommand` + send the buffer. Set `ContentType` and
 *      `CacheControl: 'private, max-age=31536000, immutable'`. Object is
 *      private; we never grant public R2 ACLs.
 *   4. `getReadUrl`: prefer a custom-domain redirect if `R2_PUBLIC_URL` is
 *      set with a Cloudflare Access policy; otherwise issue a 15-min
 *      presigned GET URL via `getSignedUrl(client, new GetObjectCommand(...))`.
 *   5. `delete`: `DeleteObjectCommand`.
 *   6. CORS on the bucket: restrict to `https://app.fxmily.com` only.
 *
 * The interface (`StorageAdapter`) is identical to the local adapter so the
 * switch is a single line in `index.ts`. **Until then, this class throws on
 * every call** — it is never instantiated unless `R2_ACCOUNT_ID` is set, see
 * `selectStorage()` in `index.ts`.
 */
export class R2StorageAdapter implements StorageAdapter {
  readonly id = 'r2';

  async put(_input: UploadInput): Promise<{ key: string; readUrl: string }> {
    throw new Error('R2StorageAdapter.put is not implemented yet (waiting for keys).');
  }

  getReadUrl(_key: string): string {
    throw new Error('R2StorageAdapter.getReadUrl is not implemented yet.');
  }

  async delete(_key: string): Promise<void> {
    throw new Error('R2StorageAdapter.delete is not implemented yet.');
  }
}
