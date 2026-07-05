#!/usr/bin/env bash
# purge-legacy-media.sh — Tour 13 « screen policy » one-shot cleanup.
#
# Retires the media that the new policy no longer keeps:
#   - LEGACY journal / training / annotation screenshots (the upload kinds were
#     closed in `/api/uploads` — only `mt5-proof` survives). Their files are
#     deleted and their DB key columns nulled.
#   - VERIFICATION proofs that already reached a TERMINAL state (ocr_status
#     done / failed) but whose file was not yet purged (e.g. uploaded before the
#     at-analysis purge shipped). Their file is deleted and `file_purged_at` is
#     stamped. Proofs still `pending` are LEFT untouched (their file is needed
#     for the imminent analysis).
#
# Verification screens are « traités à la volée, jamais conservés » — going
# forward the purge happens at analysis time in lib/verification/batch.ts; this
# script sweeps the pre-policy backlog once.
#
# RUNS ON THE PROD HOST. Files live in the `fxmily-uploads` docker volume mounted
# at /app/.uploads inside the `fxmily-web` container (docker-compose.prod.yml).
# DB access goes through the `postgres` service. Storage paths are derived from
# the same UPLOADS_DIR the app uses (falls back to /app/.uploads).
#
# SAFETY:
#   - DRY-RUN by default: prints an exhaustive inventory (count + bytes per
#     prefix) and changes NOTHING. Pass --execute to actually delete + update.
#   - Every SQL UPDATE is scoped by the exact key columns; proofs are scoped to
#     terminal states only. No cascade, no row deletion — only file bytes go and
#     the key columns are nulled (the rows + their extracted data survive).
#
# Usage:
#   bash ops/scripts/purge-legacy-media.sh              # dry-run (default)
#   bash ops/scripts/purge-legacy-media.sh --execute    # perform the purge
#
# Env overrides (rarely needed):
#   FXMILY_COMPOSE   path to the prod compose file (default /opt/fxmily/docker-compose.prod.yml)
#   FXMILY_WEB_CT    web container name  (default fxmily-web)
set -euo pipefail

EXECUTE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --execute) EXECUTE=true; shift ;;
    -h|--help)
      sed -n '2,45p' "$0"; exit 0 ;;
    *) echo "[ERROR] Unknown arg: $1 (use --execute or --help)" >&2; exit 1 ;;
  esac
done

readonly COMPOSE="${FXMILY_COMPOSE:-/opt/fxmily/docker-compose.prod.yml}"
readonly WEB_CT="${FXMILY_WEB_CT:-fxmily-web}"

# Legacy storage prefixes closed by the screen policy (mirror lib/storage/keys.ts).
readonly LEGACY_PREFIXES=(trades training annotations training_annotations)

# --- Pre-flight -------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "[FATAL] docker not found — run this on the prod host." >&2
  exit 1
fi
if [[ ! -f "$COMPOSE" ]]; then
  echo "[FATAL] compose file not found at $COMPOSE (set FXMILY_COMPOSE)." >&2
  exit 1
fi
if ! docker inspect "$WEB_CT" >/dev/null 2>&1; then
  echo "[FATAL] web container '$WEB_CT' not running (set FXMILY_WEB_CT)." >&2
  exit 1
fi

# psql helper — `-T` (no TTY), tuples-only + unaligned for scriptable scalars.
# `</dev/null` is load-bearing: without it, `docker compose exec` keeps stdin
# attached and psql SWALLOWS the rest of the script when it is streamed
# (`ssh host 'bash -s' < script`), silently truncating the run at this line.
psql_scalar() {
  docker compose -f "$COMPOSE" exec -T postgres \
    psql -U fxmily -d fxmily -tA -c "$1" </dev/null
}
psql_run() {
  docker compose -f "$COMPOSE" exec -T postgres \
    psql -U fxmily -d fxmily -c "$1" </dev/null
}

# Resolve the uploads root the app writes to (UPLOADS_DIR override or default).
UPLOADS_ROOT="$(docker exec "$WEB_CT" sh -c 'printf "%s" "${UPLOADS_DIR:-/app/.uploads}"')"
if [[ -z "$UPLOADS_ROOT" ]]; then
  echo "[FATAL] could not resolve uploads root inside $WEB_CT." >&2
  exit 1
fi

echo "════════════════════════════════════════════════════════════════"
echo " Fxmily — purge legacy media (Tour 13 screen policy)"
echo "   compose      : $COMPOSE"
echo "   web container: $WEB_CT"
echo "   uploads root : $UPLOADS_ROOT"
echo "   mode         : $([[ "$EXECUTE" == true ]] && echo 'EXECUTE (deletes!)' || echo 'DRY-RUN (no change)')"
echo "════════════════════════════════════════════════════════════════"
echo ""

# --- 1. Filesystem inventory per legacy prefix ------------------------------
# `du -sb` on each prefix dir (absent dir → 0). `find -type f | wc -l` for count.
echo "── Filesystem (legacy screenshot/annotation prefixes) ──"
fs_total_bytes=0
fs_total_files=0
for prefix in "${LEGACY_PREFIXES[@]}"; do
  dir="$UPLOADS_ROOT/$prefix"
  read -r count bytes < <(docker exec "$WEB_CT" sh -c '
    d="$1"
    if [ -d "$d" ]; then
      c=$(find "$d" -type f 2>/dev/null | wc -l)
      b=$(find "$d" -type f -printf "%s\n" 2>/dev/null | awk "{s+=\$1} END {print s+0}")
      # Trailing \n is load-bearing: `read` exits 1 on EOF without a final
      # newline, which kills the script under `set -e` before any output.
      printf "%s %s\n" "${c:-0}" "${b:-0}"
    else
      printf "0 0\n"
    fi
  ' _ "$dir")
  printf "  %-22s %8s files   %14s bytes\n" "$prefix/" "$count" "$bytes"
  fs_total_files=$((fs_total_files + count))
  fs_total_bytes=$((fs_total_bytes + bytes))
done
printf "  %-22s %8s files   %14s bytes\n" "TOTAL" "$fs_total_files" "$fs_total_bytes"
echo ""

# --- 2. Terminal proofs whose file is not yet purged ------------------------
echo "── Verification proofs (terminal, file not yet purged) ──"
PROOFS_TERMINAL_UNPURGED="$(psql_scalar "
  SELECT count(*) FROM mt5_account_proofs
  WHERE ocr_status IN ('done','failed') AND file_purged_at IS NULL;
")"
echo "  done/failed with file_purged_at IS NULL : ${PROOFS_TERMINAL_UNPURGED:-0}"
echo ""

# --- 3. DB rows still pointing at legacy media (nulled on --execute) --------
echo "── DB key columns pointing at legacy media ──"
TRADES_ENTRY="$(psql_scalar "SELECT count(*) FROM trades WHERE screenshot_entry_key IS NOT NULL;")"
TRADES_EXIT="$(psql_scalar "SELECT count(*) FROM trades WHERE screenshot_exit_key IS NOT NULL;")"
TRAINING_ENTRY="$(psql_scalar "SELECT count(*) FROM training_trades WHERE entry_screenshot_key IS NOT NULL;")"
TRADE_ANNOT="$(psql_scalar "SELECT count(*) FROM trade_annotations WHERE media_key IS NOT NULL;")"
TRAINING_ANNOT="$(psql_scalar "SELECT count(*) FROM training_annotations WHERE media_key IS NOT NULL;")"
printf "  %-40s %8s\n" "trades.screenshot_entry_key"     "${TRADES_ENTRY:-0}"
printf "  %-40s %8s\n" "trades.screenshot_exit_key"      "${TRADES_EXIT:-0}"
printf "  %-40s %8s\n" "training_trades.entry_screenshot_key" "${TRAINING_ENTRY:-0}"
printf "  %-40s %8s\n" "trade_annotations.media_key"     "${TRADE_ANNOT:-0}"
printf "  %-40s %8s\n" "training_annotations.media_key"  "${TRAINING_ANNOT:-0}"
echo ""

if [[ "$EXECUTE" != true ]]; then
  echo "DRY-RUN complete. Nothing was changed."
  echo "Re-run with --execute to delete the files above and null the DB columns."
  exit 0
fi

# =============================================================================
# EXECUTE — irreversible. Files first (a delete blip leaves a nulled row whose
# file the next run still lists), then the DB in one transaction.
# =============================================================================
echo "── EXECUTE: deleting legacy files ──"
for prefix in "${LEGACY_PREFIXES[@]}"; do
  dir="$UPLOADS_ROOT/$prefix"
  # `rm -rf` the whole prefix dir: every file under it is legacy by construction
  # (the prefix maps 1:1 to a closed upload kind). Absent dir → no-op.
  docker exec "$WEB_CT" sh -c 'd="$1"; [ -d "$d" ] && rm -rf "$d" || true' _ "$dir"
  echo "  removed $dir (if present)"
done
echo ""

echo "── EXECUTE: deleting terminal proof files (done/failed, not purged) ──"
# Stream each terminal-unpurged proof's file_key, delete the file, then stamp
# file_purged_at in bulk below. Keys are `proofs/{userId}/{nanoid}.{ext}` — safe,
# server-issued, no shell metachars (alnum + / . - _).
mapfile -t PURGE_KEYS < <(psql_scalar "
  SELECT file_key FROM mt5_account_proofs
  WHERE ocr_status IN ('done','failed') AND file_purged_at IS NULL;
")
purged_files=0
for key in "${PURGE_KEYS[@]}"; do
  [[ -z "$key" ]] && continue
  # Defense: only touch keys under the proofs/ prefix (never an arbitrary path).
  case "$key" in
    proofs/*) ;;
    *) echo "  [SKIP] unexpected key shape: $key" >&2; continue ;;
  esac
  docker exec "$WEB_CT" sh -c 'f="$1/$2"; rm -f "$f" || true' _ "$UPLOADS_ROOT" "$key"
  purged_files=$((purged_files + 1))
done
echo "  deleted $purged_files terminal proof file(s)"
echo ""

echo "── EXECUTE: updating DB (single transaction) ──"
psql_run "
BEGIN;
  UPDATE trades              SET screenshot_entry_key = NULL WHERE screenshot_entry_key IS NOT NULL;
  UPDATE trades              SET screenshot_exit_key  = NULL WHERE screenshot_exit_key  IS NOT NULL;
  UPDATE training_trades     SET entry_screenshot_key = NULL WHERE entry_screenshot_key IS NOT NULL;
  UPDATE trade_annotations   SET media_key = NULL, media_type = NULL WHERE media_key IS NOT NULL;
  UPDATE training_annotations SET media_key = NULL, media_type = NULL WHERE media_key IS NOT NULL;
  UPDATE mt5_account_proofs  SET file_purged_at = NOW()
    WHERE ocr_status IN ('done','failed') AND file_purged_at IS NULL;
COMMIT;
"
echo ""
echo "✓ Purge complete."
echo "  Legacy screenshot/annotation files removed + key columns nulled."
echo "  Terminal proof files removed + file_purged_at stamped."
