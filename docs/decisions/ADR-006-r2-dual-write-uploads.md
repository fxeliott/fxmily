# ADR-006 — R2 dual-write for member uploads (offsite media redundancy)

- **Status**: Accepted
- **Date**: 2026-07-12
- **Deciders**: Eliot (product), Claude (implementation)
- **Related**: SPEC §4 (stack — Cloudflare R2), `docs/decisions/ADR-001..005`, J1 milestone (`R2 uploads offsite`)

## Context

All member media — trade screenshots, MT5 proof screenshots, avatars, admin annotation
media, training/backtest captures — live on a **single Docker volume** on the prod host
(`UPLOADS_DIR`), written by `LocalStorageAdapter` and served by the auth-gated
`/api/uploads/[...key]` route.

Three weaknesses motivated this ADR:

1. **Single point of failure.** A dead host or a lost volume destroys every member
   upload created since the last nightly backup.
2. **Backup window.** The nightly `fxmily-uploads-backup` cron syncs the volume to R2
   once a day — up to ~24h of uploads are unprotected at any time.
3. **The R2 adapter was a stub that threw on every call**, yet `selectStorage()` would
   have selected it as a PURE R2 backend the moment the four `R2_*` env vars appeared —
   provisioning the bucket would have instantly broken every upload (unimplemented
   `put`) and every read (`501 remote_read_not_wired`).

Constraints: prod scale is ~30 members (low write volume), reads must stay auth-gated
(BOLA checks per key prefix), a mirror outage must never block a member-facing upload,
and the repo is public (no secrets, host details or real endpoints in code).

## Decision

1. **Dual-write, local primary.** `selectStorage()` returns a `DualWriteStorageAdapter`
   (`id: 'dual'`) whenever R2 is fully configured. The local disk write stays the
   PRIMARY store — it must succeed or the upload fails. The R2 mirror of the SAME key
   is **awaited but caught**: a mirror failure never fails the request. Every mirror
   outcome is journaled (`storage.r2_mirror.succeeded|failed`, PII-free
   `{key, stage}`) and failures additionally raise `reportWarning('storage.r2_mirror', …)`
   so a sustained drift reaches Sentry.
2. **Reads: local first, R2 fallback.** The two streaming GET handlers
   (`/api/uploads/[...key]` and `/api/admin/verification-batch/proof-image`) try
   `openLocalReadStream` first; on `StorageError('not_found')` with R2 configured they
   fall back to `openR2ReadStream` (GetObject → web stream). This replaces the two
   hardcoded 501 responses and makes the mirror an actual recovery path: killing a
   local file no longer 404s as long as the mirror holds the object.
3. **`getReadUrl` stays the local route.** URLs keep pointing at
   `/api/uploads/${key}` so every read keeps flowing through session auth + per-prefix
   ownership checks. `R2_PUBLIC_URL` remains an opt-in escape hatch for a
   custom-domain setup behind an access policy — not used in V1.
4. **Key generation is shared.** The per-kind key dispatch (previously an inline
   ternary in `LocalStorageAdapter.put`) is extracted to
   `generateKeyForUpload(kind, pathOwner, mime)` in `lib/storage/keys.ts` so local and
   R2 adapters cannot drift on prefixes (§21.5 isolation preserved by construction).
5. **One-shot migration** of the existing volume via
   `ops/scripts/migrate-uploads-to-r2.sh` (host-side, `aws s3 sync` with the CLI
   already provisioned for backups): supports `--dry-run`, compares local vs remote
   object counts, and verifies a random sample by **downloading and comparing SHA-256**
   (never ETag — multipart uploads break the MD5 equivalence). Idempotent: re-running
   syncs only the delta.
6. **Observability surface.** `getOffsiteMirrorHealth()` in `lib/system/health.ts`
   (custom event-driven probe, NOT a cron heartbeat expectation) reads the latest
   `storage.r2_mirror.*` audit row: `not_configured` when R2 env is absent, `red` when
   the last event is a failure, `green` otherwise. `/admin/system` renders a dedicated
   card cloned from the disk-status pattern.

### New environment variable

- `R2_ENDPOINT` (optional, URL) — S3 endpoint override for dev/test (e.g. MinIO).
  When absent, the endpoint derives from `R2_ACCOUNT_ID`
  (`https://<account>.r2.cloudflarestorage.com`). Prod does not set it.

## Alternatives rejected

- **Pure R2 backend** (the stub's original plan): turns every upload/read into a
  network dependency, adds egress latency on the hot read path, and a Cloudflare
  outage would take down screenshots entirely. The local volume already works — the
  problem is redundancy, not the backend.
- **Fire-and-forget mirror** (`void putObjectToR2(...)`): silent losses; an unawaited
  rejection is exactly the class of failure that never reaches logs. Awaited-but-caught
  costs one round-trip on a low-volume write path and guarantees the failure journal.
- **ETag comparison for migration verification**: R2/S3 ETags are only MD5 for
  single-part uploads; `aws s3 sync`/multipart breaks the equivalence silently.
  Download + SHA-256 compare on a sample is unambiguous.
- **Cron heartbeat expectation for the probe**: the mirror is event-driven (fires on
  uploads, which can legitimately be days apart) — a heartbeat expectation would
  false-alarm on every quiet week. The custom-probe pattern
  (`getUploadsPersistenceHealth`) fits; the neutral state is explicit.

## Consequences

- Uploads gain offsite redundancy at write time; the nightly volume backup remains as
  defense-in-depth (and covers files written before this ADR until the migration runs).
- A mirror outage degrades to "local-only + red card + Sentry warning" — never a
  member-facing error.
- `StorageAdapter.id` gains the `'dual'` variant; audit metadata `adapter: 'dual'`
  now appears on upload slugs.
- Prod activation requires Eliot to provision the media bucket + credentials in
  `/etc/fxmily/web.env` (four `R2_*` vars) and restart the web container; until then
  behaviour is byte-identical to local-only.
