#!/usr/bin/env bash
# ops/scripts/fix-crlf-prod.sh — defensive CRLF stripper for Hetzner prod files.
#
# Why this exists :
#   On 2026-05-11 we discovered that `/etc/cron.d/fxmily-app` was deployed
#   with CRLF line endings (Git checkout on Windows converts LF→CRLF by
#   default unless `.gitattributes` overrides it). The Debian/Ubuntu cron
#   daemon SILENTLY ignores crontab files with CR characters embedded
#   (the username field becomes `fxmily\r` which doesn't match any system
#   user → line rejected with NO log output). Result : ALL Fxmily crons
#   were skipped from prod launch (2026-05-10 16:43 UTC) until the fix at
#   2026-05-11 12:28 UTC — meaning ~20h of NO automatic :
#     - backup pg_dump daily (02:30 UTC slot missed)
#     - dispatch-notifications every 2 min
#     - recompute-scores daily 02:00 UTC
#     - dispatch-douglas every 6h
#     - weekly-reports Sunday 21:00 UTC
#     - purge-deleted, purge-push-subscriptions, purge-audit-log
#     - cron-watch self-monitoring
#
# Same issue also bit `/usr/local/bin/fxmily-backup` and `/usr/local/bin/fxmily-cron`
# wrappers (shebang `#!/usr/bin/env bash\r` → kernel can't load `bash\r`).
#
# Root cause : Git's `core.autocrlf` defaults to `true` on Windows installs.
# Our `.gitattributes` (added 2026-05-10) forces LF on shell/yaml/Caddy/Docker,
# but defensive scripts should still strip CRLF post-SCP just in case.
#
# Usage (run as root on the Hetzner host) :
#   bash fix-crlf-prod.sh
#
# Or remote from local :
#   scp -i ~/.ssh/id_rsa_hetzner ops/scripts/fix-crlf-prod.sh root@<host>:/tmp/
#   ssh -i ~/.ssh/id_rsa_hetzner root@<host> 'bash /tmp/fix-crlf-prod.sh && rm /tmp/fix-crlf-prod.sh'
#
# Exit codes :
#   0 — all targets clean (no CRLF detected, no change made) OR fixes applied
#   1 — invariant violation (target missing, perms wrong, post-fix verify failed)

set -euo pipefail

TARGETS=(
  /etc/cron.d/fxmily-app
  /usr/local/bin/fxmily-backup
  /usr/local/bin/fxmily-cron
)

# Files where we ALSO need to make sure the script header (`#!/...`) doesn't
# inherit a `\r` after `bash`. The cron daemon and `/usr/bin/env` both reject
# the trailing CR silently.
EXECUTABLES=(
  /usr/local/bin/fxmily-backup
  /usr/local/bin/fxmily-cron
)

ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }
log() { echo "[$(ts)] [fix-crlf-prod] $*"; }

if [[ "$EUID" -ne 0 ]]; then
  log "ERROR: must run as root (read+write on /etc/cron.d and /usr/local/bin)"
  exit 1
fi

ANY_FIXED=0

for target in "${TARGETS[@]}"; do
  if [[ ! -f "$target" ]]; then
    log "WARN: $target not present (skipping)"
    continue
  fi
  cr_count=$(grep -c $'\r' "$target" || true)
  if [[ "$cr_count" -gt 0 ]]; then
    log "FOUND $cr_count CR chars in $target — stripping…"
    # Save perms before edit
    orig_perms=$(stat -c '%a' "$target")
    orig_owner=$(stat -c '%U:%G' "$target")
    # Strip CR in-place via tmp file (preserves inode + permissions on most FS)
    tr -d '\r' < "$target" > "${target}.lf.tmp"
    mv "${target}.lf.tmp" "$target"
    chmod "$orig_perms" "$target"
    chown "$orig_owner" "$target"
    # Verify
    post_cr=$(grep -c $'\r' "$target" || true)
    if [[ "$post_cr" -ne 0 ]]; then
      log "ERROR: $target still has $post_cr CR chars after fix"
      exit 1
    fi
    log "FIXED $target (perms $orig_perms, owner $orig_owner)"
    ANY_FIXED=1
  else
    log "OK $target (no CRLF)"
  fi
done

# Sanity : verify executable shebangs don't have `\r` trailing `bash`
for exe in "${EXECUTABLES[@]}"; do
  if [[ -f "$exe" ]]; then
    first_line=$(head -1 "$exe" | od -An -c | tr -d ' ')
    if [[ "$first_line" == *'\r'* ]]; then
      log "ERROR: $exe still has CR in shebang after fix"
      exit 1
    fi
  fi
done

# If we fixed the crontab, force cron daemon to re-read it. cron(8) polls
# /etc/cron.d/ ~every minute via stat — touching the file or restarting works.
# `systemctl restart cron` is the most reliable way (reload is not supported
# on Debian/Ubuntu cron unit).
if [[ "$ANY_FIXED" -eq 1 ]] && [[ -f /etc/cron.d/fxmily-app ]]; then
  log "Restarting cron daemon to pick up clean crontab…"
  systemctl restart cron
  sleep 2
  systemctl is-active cron >/dev/null || { log "ERROR: cron failed to restart"; exit 1; }
  log "cron daemon restarted OK"
fi

log "done (any_fixed=$ANY_FIXED)"
exit 0
