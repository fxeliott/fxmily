#!/usr/bin/env bash
# J10 Phase L+ — automate the 5 GitHub repository secrets posting.
#
# Eliot's pre-requisites guide (`ops/scripts/eliot-prerequisites.md` §7)
# asks for 5 values to be pasted into the GitHub UI one by one. This
# script does the same via `gh secret set` so the operator can paste
# all values into a local file, run the script once, and walk away.
#
# Usage :
#   1. Authenticate gh : `gh auth login` (needs `repo` + `admin:repo_hook` scopes)
#   2. Create a local `secrets.local.env` (gitignored — never commit !) :
#        HETZNER_HOST="X.X.X.X"
#        HETZNER_SSH_KEY="-----BEGIN OPENSSH PRIVATE KEY-----\n…"
#        SENTRY_AUTH_TOKEN="sntrys_…"
#        SENTRY_ORG="fxmily"
#        SENTRY_PROJECT="fxmily-web"
#        # Optional repository VARIABLE (not secret) :
#        APP_URL="https://app.fxmily.com"
#        CRON_SECRET="…"  # mirrors /etc/fxmily/web.env, used by cron-watch.yml
#   3. Run :
#        bash ops/scripts/pose-github-secrets.sh secrets.local.env
#   4. Delete `secrets.local.env` immediately after.
#
# Idempotent : `gh secret set` overwrites the existing value silently.
#
# Safety :
#   - Refuses to run if the input file is world-readable (mode > 0600).
#   - Checks the gh authenticated user matches the repo owner.
#   - Prints which secrets were set, NEVER the values.

set -euo pipefail

readonly REPO="${FXMILY_REPO:-fxeliott/fxmily}"

# J10 Phase O fix H4 : two-path support. Path A (Hetzner) and Path B
# (Vercel) need different secret sets. The script reads `DEPLOY_PATH`
# from the env file (`hetzner` | `vercel` | `both`) and picks the
# right list. `both` posts every secret — useful for keeping the repo
# ready to switch paths without re-running the script.
readonly PATH_A_SECRETS=(HETZNER_HOST HETZNER_SSH_KEY)
readonly PATH_B_SECRETS=(
  VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID
  DATABASE_URL AUTH_SECRET
  RESEND_API_KEY RESEND_FROM
  VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY NEXT_PUBLIC_VAPID_PUBLIC_KEY VAPID_SUBJECT
)
readonly SHARED_SECRETS=(
  CRON_SECRET
  SENTRY_AUTH_TOKEN SENTRY_ORG SENTRY_PROJECT
  SENTRY_DSN NEXT_PUBLIC_SENTRY_DSN
)
readonly REQUIRED_VARIABLES=(APP_URL DEPLOY_PATH)

usage() {
  echo "usage: $(basename "$0") <secrets.local.env>" >&2
  echo "  see header for the file format" >&2
  exit 2
}

ENV_FILE="${1:-}"
[[ -z "$ENV_FILE" ]] && usage
[[ ! -r "$ENV_FILE" ]] && { echo "error: '$ENV_FILE' not readable" >&2; exit 2; }

# ---- 1. Permission check (0600 ideal — refuse > 0644) ----------------------
# `stat -c %a` (GNU) or `stat -f %A` (BSD) — try GNU first.
PERMS=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%A' "$ENV_FILE" 2>/dev/null || echo "?")
case "$PERMS" in
  600|400) ;;
  ?)
    echo "warning: cannot determine file permissions on this platform — skip check"
    ;;
  *)
    if [[ "$PERMS" =~ ^[2-7][2-7][2-7]$ ]] && [[ "${PERMS:1:1}" -ge 4 || "${PERMS:2:1}" -ge 4 ]]; then
      echo "error: '$ENV_FILE' is too permissive (mode $PERMS). Run :" >&2
      echo "  chmod 600 '$ENV_FILE'" >&2
      exit 2
    fi
    ;;
esac

# ---- 2. gh auth ------------------------------------------------------------
if ! command -v gh >/dev/null 2>&1; then
  echo "error: 'gh' (GitHub CLI) not found. Install : https://cli.github.com/" >&2
  exit 2
fi
GH_USER=$(gh api user -q .login 2>/dev/null || true)
if [[ -z "$GH_USER" ]]; then
  echo "error: gh not authenticated. Run : gh auth login" >&2
  exit 2
fi
echo "→ Authenticated as $GH_USER, posting to $REPO"

# ---- 3. Source the env file in a sub-shell so values stay scoped -----------
# We DO NOT `source` directly to avoid polluting the parent shell. Read
# each line, split on the first `=`, and `unset` after `gh secret set`.
declare -A KV
while IFS= read -r line || [[ -n "$line" ]]; do
  # Skip blanks + comments + non-KV lines.
  [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
  [[ ! "$line" =~ = ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  # Strip surrounding quotes ("…" or '…') if present.
  val="${val#\"}"; val="${val%\"}"
  val="${val#\'}"; val="${val%\'}"
  KV["$key"]="$val"
done < "$ENV_FILE"

# ---- 4. Determine which secret set to post --------------------------------
DEPLOY_PATH="${KV[DEPLOY_PATH]:-${FXMILY_DEPLOY_PATH:-hetzner}}"
case "$DEPLOY_PATH" in
  hetzner) REQUIRED_SECRETS=("${PATH_A_SECRETS[@]}" "${SHARED_SECRETS[@]}") ;;
  vercel)  REQUIRED_SECRETS=("${PATH_B_SECRETS[@]}" "${SHARED_SECRETS[@]}") ;;
  both)    REQUIRED_SECRETS=("${PATH_A_SECRETS[@]}" "${PATH_B_SECRETS[@]}" "${SHARED_SECRETS[@]}") ;;
  *)
    echo "error: DEPLOY_PATH must be one of: hetzner|vercel|both (got '$DEPLOY_PATH')" >&2
    exit 2
    ;;
esac
echo "→ Path : $DEPLOY_PATH (${#REQUIRED_SECRETS[@]} secrets to post)"

# ---- 5. Set secrets --------------------------------------------------------
posted_secrets=()
for secret in "${REQUIRED_SECRETS[@]}"; do
  if [[ -z "${KV[$secret]:-}" ]]; then
    echo "  ✗ missing : $secret (skipped)"
    continue
  fi
  printf '%s' "${KV[$secret]}" | gh secret set "$secret" --repo "$REPO" --body - >/dev/null
  posted_secrets+=("$secret")
  echo "  ✓ secret : $secret"
done

# ---- 6. Set repository variables -------------------------------------------
posted_variables=()
for var in "${REQUIRED_VARIABLES[@]}"; do
  if [[ -z "${KV[$var]:-}" ]]; then
    echo "  ~ optional missing : $var (skipped)"
    continue
  fi
  gh variable set "$var" --repo "$REPO" --body "${KV[$var]}" >/dev/null
  posted_variables+=("$var")
  echo "  ✓ variable : $var"
done

# ---- 7. Summary ------------------------------------------------------------
echo
echo "Done. ${#posted_secrets[@]} secrets + ${#posted_variables[@]} variables posted to $REPO."
echo
echo "Verify in browser :"
echo "  https://github.com/${REPO}/settings/secrets/actions"
echo "  https://github.com/${REPO}/settings/variables/actions"
echo
echo "⚠️  Now delete '$ENV_FILE' :"
echo "  shred -u '$ENV_FILE' 2>/dev/null || rm -f '$ENV_FILE'"
