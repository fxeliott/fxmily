#!/usr/bin/env bash
# migrate-uploads-to-r2.sh — one-shot backfill of HISTORICAL member uploads
# from the local Docker volume to the Cloudflare R2 media bucket (ADR-006 §5).
#
# WHAT : `aws s3 sync` of the uploads volume content to s3://$R2_BUCKET so the
#        files written BEFORE the dual-write adapter shipped get their offsite
#        mirror. Keys are preserved verbatim (proofs/..., avatars/..., ...) —
#        exactly what the app's R2 adapter writes; no rename, no transform.
# WHEN : once, right after the media bucket + the four R2_* variables land in
#        /etc/fxmily/web.env (ADR-006 "Consequences"). Re-running is safe and
#        cheap: sync only transfers the delta (idempotent by construction).
# WHERE: on the PROD HOST, by hand — NOT inside a container. The host already
#        has the aws CLI provisioned for the nightly pg/caddy/uploads backups.
#
# CREDENTIALS — use the MEDIA bucket variables (the R2_* vars from
# /etc/fxmily/web.env), NOT the backup credentials from /etc/fxmily/cron.env:
# those belong to the `fxmily-backup` aws profile and point at the BACKUP
# bucket. This script reads everything from the environment, hardcodes
# nothing, and never touches the backup profile:
#   R2_ACCESS_KEY_ID       required
#   R2_SECRET_ACCESS_KEY   required
#   R2_BUCKET              required — the MEDIA bucket name
#   R2_ACCOUNT_ID          required unless R2_ENDPOINT is set (endpoint then
#                          derives as https://<account>.r2.cloudflarestorage.com)
#   R2_ENDPOINT            optional S3 endpoint override (dev/MinIO; prod unset)
#   UPLOADS_VOLUME         optional, docker volume holding the uploads
#                          (default: fxmily-uploads)
#   MIGRATE_SRC_DIR        optional, host path of the uploads root; bypasses
#                          `docker volume inspect`. NOTE: the app's UPLOADS_DIR
#                          (/app/.uploads) is a CONTAINER path and is
#                          deliberately ignored here.
#
# Usage (as root — docker + volume mountpoint access needed):
#   set -a; source /etc/fxmily/web.env; set +a   # or export the R2_* vars by hand
#   bash ops/scripts/migrate-uploads-to-r2.sh                 # DRY-RUN (default)
#   bash ops/scripts/migrate-uploads-to-r2.sh --execute       # real sync + verify
#   bash ops/scripts/migrate-uploads-to-r2.sh --execute --sample 25
#
# Flags:
#   --dry-run      explicit no-op mode (also the DEFAULT): lists what would be
#                  uploaded, changes nothing remote
#   --execute      perform the sync, then verify (counts + SHA-256 sample)
#   --sample N     random files to hash-verify after the sync (default 10)
#   -h | --help    print this header
#
# Exit codes:
#   0  success (dry-run listed the delta, or execute + all verifications green)
#   1  usage error / missing environment
#   2  preflight failure (tool missing, source dir or bucket unreachable)
#   3  `aws s3 sync` failed
#   4  post-sync count mismatch (remote < local)
#   5  SHA-256 sample verification mismatch
set -euo pipefail

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
print_help() { awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; }

EXECUTE=false
SAMPLE_SIZE=10
while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) EXECUTE=true; shift ;;
    --dry-run) EXECUTE=false; shift ;;
    --sample)
      if [[ $# -lt 2 || ! "$2" =~ ^[1-9][0-9]*$ ]]; then
        echo "[ERROR] --sample needs a positive integer" >&2; exit 1
      fi
      SAMPLE_SIZE="$2"; shift 2 ;;
    -h|--help) print_help; exit 0 ;;
    *) echo "[ERROR] Unknown arg: $1 (see --help)" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Environment — names per ADR-006; every sensitive value comes from the env
# ---------------------------------------------------------------------------
missing=0
for name in R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  if [[ -z "${!name:-}" ]]; then
    echo "[FATAL] $name is not set — load the media-bucket vars (e.g. from /etc/fxmily/web.env) first." >&2
    missing=1
  fi
done
if [[ -z "${R2_ENDPOINT:-}" && -z "${R2_ACCOUNT_ID:-}" ]]; then
  echo "[FATAL] set R2_ENDPOINT or R2_ACCOUNT_ID (the endpoint derives from the account id)." >&2
  missing=1
fi
[[ "$missing" -eq 0 ]] || exit 1

# Endpoint derivation mirrors apps/web/src/lib/storage/r2.ts (ADR-006, "New
# environment variable"): explicit override wins, else account-id derived.
ENDPOINT="${R2_ENDPOINT:-https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com}"

# Map the app's R2 credentials onto the aws CLI. Environment credentials take
# precedence over any configured profile, so the nightly-backup profile
# (`fxmily-backup`) is never used nor modified by this script.
export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-auto}" # R2 convention

# ---------------------------------------------------------------------------
# Source directory — host-side path of the uploads volume
# ---------------------------------------------------------------------------
# The app's UPLOADS_DIR points INSIDE the container (/app/.uploads); the same
# bytes live on the host at the volume mountpoint. `docker volume inspect` is
# the supported way to resolve it (no /var/lib/docker/... hardcoding).
UPLOADS_VOLUME="${UPLOADS_VOLUME:-fxmily-uploads}"
if [[ -n "${MIGRATE_SRC_DIR:-}" ]]; then
  SRC_DIR="$MIGRATE_SRC_DIR"
else
  if ! command -v docker >/dev/null 2>&1; then
    echo "[FATAL] docker not found and MIGRATE_SRC_DIR not set — run on the prod host." >&2
    exit 2
  fi
  if ! SRC_DIR="$(docker volume inspect -f '{{ .Mountpoint }}' "$UPLOADS_VOLUME" 2>/dev/null)"; then
    echo "[FATAL] docker volume '$UPLOADS_VOLUME' not found (set UPLOADS_VOLUME or MIGRATE_SRC_DIR)." >&2
    exit 2
  fi
fi
if [[ ! -d "$SRC_DIR" ]]; then
  echo "[FATAL] source dir '$SRC_DIR' is not a readable directory (root is needed to read volume mountpoints)." >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Preflight — tools + read-only bucket reachability
# ---------------------------------------------------------------------------
for tool in aws find shuf sha256sum; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "[FATAL] '$tool' not found on the host." >&2
    exit 2
  fi
done

# Read-only probe: fail loudly on bad credentials / wrong bucket BEFORE any
# transfer is attempted — in dry-run mode too.
if ! aws s3api head-bucket --bucket "$R2_BUCKET" --endpoint-url "$ENDPOINT" >/dev/null 2>&1; then
  echo "[FATAL] cannot reach bucket '$R2_BUCKET' at $ENDPOINT — check the MEDIA bucket credentials (web.env vars, NOT the cron.env backup ones)." >&2
  exit 2
fi

LOCAL_COUNT="$(find "$SRC_DIR" -type f | wc -l | tr -d '[:space:]')"

MODE_LABEL="DRY-RUN (default — nothing is uploaded)"
[[ "$EXECUTE" == true ]] && MODE_LABEL="EXECUTE (real sync)"
echo "════════════════════════════════════════════════════════════════"
echo " Fxmily — migrate historical uploads to R2 (ADR-006 §5)"
echo "   source dir : $SRC_DIR"
echo "   bucket     : s3://$R2_BUCKET"
echo "   endpoint   : $ENDPOINT"
echo "   local files: $LOCAL_COUNT"
echo "   mode       : $MODE_LABEL"
echo "   sample     : $SAMPLE_SIZE file(s) (execute mode only)"
echo "════════════════════════════════════════════════════════════════"
echo ""

if [[ "$LOCAL_COUNT" -eq 0 ]]; then
  echo "Nothing to migrate: the uploads volume holds no files."
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Sync — delta-only, hence idempotent: a re-run transfers only new files
# ---------------------------------------------------------------------------
echo "── aws s3 sync ──"
SYNC_ARGS=(s3 sync "$SRC_DIR" "s3://$R2_BUCKET" --endpoint-url "$ENDPOINT" --no-progress)
[[ "$EXECUTE" == true ]] || SYNC_ARGS+=(--dryrun)
if ! aws "${SYNC_ARGS[@]}"; then
  echo "[FATAL] aws s3 sync failed — nothing verified. Fix and re-run (safe: delta-only)." >&2
  exit 3
fi
echo ""

# `aws s3 ls` can exit 1 on an empty listing; head-bucket above already proved
# reachability, so an empty result here really means zero objects.
remote_object_count() {
  aws s3 ls "s3://$R2_BUCKET" --recursive --endpoint-url "$ENDPOINT" | wc -l | tr -d '[:space:]' || true
}

if [[ "$EXECUTE" != true ]]; then
  REMOTE_COUNT="$(remote_object_count)"
  echo "DRY-RUN complete. Nothing was uploaded."
  echo "  local files          : $LOCAL_COUNT"
  echo "  remote objects (now) : $REMOTE_COUNT"
  echo "Re-run with --execute to perform the sync + count and SHA-256 verification."
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. Verification 1/2 — object counts, local vs remote
# ---------------------------------------------------------------------------
echo "── verification 1/2: object counts ──"
REMOTE_COUNT="$(remote_object_count)"
COUNTS_OK=true
if (( REMOTE_COUNT < LOCAL_COUNT )); then
  COUNTS_OK=false
  echo "  [MISMATCH] local=$LOCAL_COUNT remote=$REMOTE_COUNT — remote is missing objects."
  echo "             (Members uploading during the sync can drift the counts; re-run --execute.)"
elif (( REMOTE_COUNT > LOCAL_COUNT )); then
  echo "  [OK+] local=$LOCAL_COUNT remote=$REMOTE_COUNT — remote holds extra objects."
  echo "        Expected when the dual-write mirror ran before this migration and some"
  echo "        local files were purged since; every local file is still covered."
else
  echo "  [OK] local=$LOCAL_COUNT remote=$REMOTE_COUNT"
fi
echo ""

# ---------------------------------------------------------------------------
# 3. Verification 2/2 — download a random sample back, compare SHA-256
# ---------------------------------------------------------------------------
# NEVER verify via ETag comparison instead: S3/R2 ETags equal an MD5 only for
# single-part uploads — `aws s3 sync` switches to multipart above its part
# threshold and the ETag silently stops being a content hash (ADR-006,
# "Alternatives rejected"). Download + sha256sum is unambiguous.
echo "── verification 2/2: SHA-256 on up to $SAMPLE_SIZE random file(s) ──"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# NUL-delimited end to end so unusual filenames cannot break the sampling
# (keys are server-issued and shell-safe, but stay robust by construction).
mapfile -d '' SAMPLE_FILES < <(find "$SRC_DIR" -type f -print0 | shuf -z -n "$SAMPLE_SIZE")
SAMPLE_OK=true
ok_count=0
fail_count=0
for local_file in "${SAMPLE_FILES[@]}"; do
  key="${local_file#"$SRC_DIR"/}"
  remote_copy="$TMP_DIR/sample.bin"
  if ! aws s3 cp "s3://$R2_BUCKET/$key" "$remote_copy" --endpoint-url "$ENDPOINT" --no-progress >/dev/null; then
    echo "  [FAIL] $key — could not download from R2 (missing remotely?)"
    SAMPLE_OK=false
    fail_count=$((fail_count + 1))
    continue
  fi
  local_sha="$(sha256sum "$local_file" | awk '{print $1}')"
  remote_sha="$(sha256sum "$remote_copy" | awk '{print $1}')"
  rm -f "$remote_copy"
  if [[ "$local_sha" == "$remote_sha" ]]; then
    echo "  [OK]   $key"
    ok_count=$((ok_count + 1))
  else
    echo "  [FAIL] $key — SHA-256 differs (local=$local_sha remote=$remote_sha)"
    SAMPLE_OK=false
    fail_count=$((fail_count + 1))
  fi
done
echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "════════════════════════════════════════════════════════════════"
echo " Summary"
echo "   local files    : $LOCAL_COUNT"
echo "   remote objects : $REMOTE_COUNT"
echo "   counts         : $([[ "$COUNTS_OK" == true ]] && echo 'OK' || echo 'MISMATCH')"
echo "   sample SHA-256 : $ok_count OK / $fail_count FAIL (of ${#SAMPLE_FILES[@]} sampled)"
echo "════════════════════════════════════════════════════════════════"

if [[ "$COUNTS_OK" != true ]]; then
  echo "[FATAL] count mismatch — remote is missing objects; re-run --execute." >&2
  exit 4
fi
if [[ "$SAMPLE_OK" != true ]]; then
  echo "[FATAL] sample verification failed — investigate the keys above before trusting the mirror." >&2
  exit 5
fi
echo "✓ Migration verified. Historical uploads are mirrored on R2."
