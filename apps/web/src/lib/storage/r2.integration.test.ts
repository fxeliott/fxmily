import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  deleteObjectFromR2,
  headObjectFromR2,
  openR2ReadStream,
  putObjectToR2,
  resetR2ClientForTests,
} from './r2';

/**
 * J1 R2 — env-gated INTEGRATION test (exigence 6d "1 test d'intégration gaté par env").
 *
 * Unlike `r2.test.ts` (which mocks `@aws-sdk/client-s3` and `@/lib/env` to pin
 * request wiring), this file drives the REAL S3 client against a REAL bucket to
 * prove the adapter actually round-trips bytes. It is SKIPPED by default
 * everywhere — CI, local `pnpm test`, pre-commit — via `describe.runIf`, so the
 * socle gates stay green with zero infra. It runs ONLY when `R2_INTEGRATION=1`.
 *
 * Run it against a local MinIO (S3-compatible, dev creds are NON-secrets):
 *
 *   docker run -d --name fxmily-minio -p 9000:9000 \
 *     -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
 *     minio/minio server /data
 *   docker exec fxmily-minio mc alias set local http://localhost:9000 minioadmin minioadmin
 *   docker exec fxmily-minio mc mb --ignore-existing local/fxmily-test
 *
 *   R2_INTEGRATION=1 \
 *   R2_ENDPOINT=http://localhost:9000 \
 *   R2_ACCOUNT_ID=test \
 *   R2_ACCESS_KEY_ID=minioadmin \
 *   R2_SECRET_ACCESS_KEY=minioadmin \
 *   R2_BUCKET=fxmily-test \
 *   pnpm --filter @fxmily/web exec vitest run src/lib/storage/r2.integration.test.ts
 *
 * `R2_ENDPOINT` reroutes the SAME code path (forcePathStyle) to MinIO; against
 * real Cloudflare R2 drop `R2_ENDPOINT` and supply the four real R2_* creds via
 * env — the bucket bytes stay private (prod secrets are NEVER read/committed).
 *
 * NOTE: no `@aws-sdk/client-s3` / `@/lib/env` mock here — the point is the real
 * client reading real env. The gate means importing this file is harmless when
 * R2 is unconfigured (env's all-or-none R2 refine treats "none set" as valid).
 */

const RUN_INTEGRATION = process.env.R2_INTEGRATION === '1';

// Valid storage key shape: trades/{cuid 8-40}/{nanoid 12-40}.{jpg|png|webp}.
// Static (no Date/random literals — the test-suite guardrail rejects future
// absolute dates; a stable key is idempotent since PUT overwrites + we DELETE).
const KEY = 'trades/user1234abcd/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg';
// Distinctive JFIF-ish header so a byte mismatch is obvious; MinIO/R2 store the
// raw bytes verbatim regardless of content.
const BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const CONTENT_TYPE = 'image/jpeg';

async function readAll(stream: ReadableStream): Promise<Uint8Array> {
  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe.runIf(RUN_INTEGRATION)('R2 adapter — real bucket integration (R2_INTEGRATION=1)', () => {
  beforeAll(() => {
    // Drop any cached client so the real env (MinIO endpoint / R2 creds) is read.
    resetR2ClientForTests();
  });

  afterAll(async () => {
    // Best-effort cleanup so a mid-cycle failure never leaves a stray object.
    try {
      await deleteObjectFromR2(KEY);
    } catch {
      // already deleted by the happy path — ignore.
    }
  });

  it('round-trips a full put → head → get(compare bytes) → delete → head(not_found) cycle', async () => {
    // PUT — upload the object.
    await expect(putObjectToR2(KEY, BYTES, CONTENT_TYPE)).resolves.toBeUndefined();

    // HEAD — the object exists with the right size + content-type.
    const head = await headObjectFromR2(KEY);
    expect(head.size).toBe(BYTES.length);
    expect(head.contentType).toBe(CONTENT_TYPE);

    // GET — stream the object back and compare the bytes exactly.
    const read = await openR2ReadStream(KEY);
    expect(read.size).toBe(BYTES.length);
    expect(read.ext).toBe('jpg');
    const roundTripped = await readAll(read.stream);
    expect(Array.from(roundTripped)).toEqual(Array.from(BYTES));

    // DELETE — remove the object.
    await expect(deleteObjectFromR2(KEY)).resolves.toBeUndefined();

    // HEAD again — the object is now gone (mapped to StorageError not_found).
    await expect(headObjectFromR2(KEY)).rejects.toMatchObject({
      name: 'StorageError',
      code: 'not_found',
    });
  });
});
