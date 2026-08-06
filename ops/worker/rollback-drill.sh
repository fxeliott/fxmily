#!/usr/bin/env bash
#
# ops/worker/rollback-drill.sh — J9 "Done quand" #4: «rollback documenté ET TESTÉ
# À BLANC». Exercises install → re-install → --check → --uninstall → --uninstall
# → --check-must-refuse → re-install, inside a throwaway container.
#
# WHY A CONTAINER. `--uninstall` is the one rollback gesture that had never been
# run, and the only machine it could be run on is the one now serving every
# member's AI generation. Testing it there is not caution, it is a gamble. So it
# gets a faithful copy instead: same OS family, same paths, same unprivileged
# user, same files, same installer — and the copy is destroyed afterwards.
#
# WHAT IS REAL AND WHAT IS SUBSTITUTED. A drill that hides its stubs proves less
# than it claims, so it says both out loud:
#   REAL      install-worker-vps.sh itself, both wrappers, crontab.fxmily-worker,
#             the 7 batch scripts, every permission / CR / row assertion, and the
#             uninstall path under test.
#   SUBSTITUTED
#             · the `claude` CLI — the installer only calls `--version` during
#               install and never authenticates, so this weakens no assertion
#               made here ;
#             · the six tokens in web.env — only their LENGTH is checked ;
#             · the 25 app cron rows, which are the CANARY: the installer
#               promises never to touch /etc/cron.d/fxmily-app, and this drill
#               compares its sha256 before, after install, after uninstall and
#               after the full cycle.
#
# WHAT IT DOES NOT PROVE. It does not prove the rollback on the real host: no
# drill can, short of running it there. It proves that the installer's file set,
# its idempotence, its refusal after removal and its promise about the app cron
# hold on a faithful copy. Those are the parts a human would otherwise assert
# from reading.
#
# ALSO NOT COVERED, and worth knowing before you trust a green run: `--uninstall`
# does NOT revert the `FXMILY_WORKER_DRY_RUN` line it appended to
# /etc/fxmily/cron.env. That is harmless (the line is inert once the wrappers are
# gone) but it means "uninstalled" and "pristine" are not the same state.
#
# Usage — from a machine with Docker, at the repo root:
#   bash ops/worker/rollback-drill.sh
#
# Exit code: 0 iff every assertion passed, INCLUDING the falsification control
# that proves the canary assertion is able to go red.

set -uo pipefail

# ---------------------------------------------------------------------------
# Outer half — runs on the operator's machine, builds the fixture, calls Docker.
# ---------------------------------------------------------------------------
if [ ! -d /src ]; then
  command -v docker >/dev/null 2>&1 || {
    echo "docker is required: this drill runs the installer as root in a throwaway container." >&2
    exit 2
  }
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  STAGE="${TMPDIR:-/tmp}/fxmily-rollback-drill"
  mkdir -p "$STAGE/repo"
  # `git archive`, not `cp -a`: it exports exactly what is COMMITTED, so the
  # drill can never accidentally pass thanks to an uncommitted local edit — and
  # it leaves node_modules and every other multi-gigabyte artefact behind.
  git -C "$REPO_ROOT" archive --format=tar HEAD ops .gitattributes | tar -x -C "$STAGE/repo" || {
    echo "git archive failed — is $REPO_ROOT a git checkout?" >&2
    exit 2
  }
  cp "${BASH_SOURCE[0]}" "$STAGE/drill.sh"
  echo "fixture staged in $STAGE (exported from HEAD, not from the working tree)"
  # Docker wants a path its DAEMON can resolve. Under Git Bash on Windows the
  # shell's `/tmp/...` is a POSIX illusion over `C:\Users\…\AppData\Local\Temp`,
  # and MSYS additionally rewrites anything that looks like a path inside the
  # argument — so `-v /tmp/x:/src:ro` arrives mangled and the mount silently
  # binds the wrong thing. `cygpath -w` gives the real path; MSYS_NO_PATHCONV
  # stops the rewrite. Both are inert everywhere else, and MSYS_NO_PATHCONV is
  # scoped to this one command on purpose: exporting it globally broke corepack
  # in this repo on 2026-08-04.
  HOSTPATH="$STAGE"
  if command -v cygpath >/dev/null 2>&1; then HOSTPATH="$(cygpath -w "$STAGE")"; fi
  # `tr -d '\r'` because this file may sit on a Windows checkout with CRLF, and
  # a CR in a shebang line is a fatal, silent failure inside the container —
  # the very class of bug the installer itself guards against.
  exec env MSYS_NO_PATHCONV=1 docker run --rm \
    -v "${HOSTPATH}/repo:/src:ro" \
    -v "${HOSTPATH}:/drill:ro" \
    node:22-bookworm-slim \
    bash -c 'set -e
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -qq >/dev/null 2>&1
      apt-get install -y -qq jq curl git tzdata >/dev/null 2>&1
      tr -d "\r" < /drill/drill.sh > /d.sh
      bash /d.sh'
fi

# ---------------------------------------------------------------------------
# Inner half — runs as root inside the container.
# ---------------------------------------------------------------------------
FAILED=0
ok() { printf '  [OK]   %s\n' "$*"; }
bad() {
  printf '  [FAIL] %s\n' "$*"
  FAILED=1
}
hdr() { printf '\n=== %s ===\n' "$*"; }

CRON_WORKER=/etc/cron.d/fxmily-worker
CRON_APP=/etc/cron.d/fxmily-app
BIN_W=/usr/local/bin/fxmily-worker
BIN_D=/usr/local/bin/fxmily-worker-watchdog
LOGROT=/etc/logrotate.d/fxmily-worker
FX=/home/fxmily
INSTALLER="$FX/worker/ops/worker/install-worker-vps.sh"

hdr "0 · Fixture"
ln -sf /usr/share/zoneinfo/Europe/Paris /etc/localtime
echo "Europe/Paris" >/etc/timezone
[ "$(cat /etc/timezone)" = "Europe/Paris" ] && ok "host timezone Europe/Paris" || bad "timezone fixture failed"

useradd -m -s /bin/bash fxmily 2>/dev/null || true
id fxmily >/dev/null 2>&1 && ok "user fxmily exists" || bad "useradd failed"

mkdir -p "$FX/worker"
cp -a /src/. "$FX/worker/"
cd "$FX/worker" || exit 2
git init -q . && git config user.email drill@example.invalid && git config user.name drill
git add -A && git commit -qm "drill fixture"
chown -R fxmily:fxmily "$FX/worker"
[ -d "$FX/worker/.git" ] && ok "dedicated checkout at $FX/worker" || bad "checkout fixture failed"

mkdir -p "$FX/.npm-global/bin"
printf '#!/bin/sh\n[ "$1" = "--version" ] && echo "2.1.220 (Claude Code)"\nexit 0\n' >"$FX/.npm-global/bin/claude"
chmod 755 "$FX/.npm-global/bin/claude"
chown -R fxmily:fxmily "$FX/.npm-global"

mkdir -p /etc/fxmily
{
  echo "ADMIN_BATCH_TOKEN=drill0000000000000000000000000000000000001"
  echo "MONTHLY_ADMIN_BATCH_TOKEN=drill0000000000000000000000000000000002"
  echo "CALENDAR_ADMIN_BATCH_TOKEN=drill000000000000000000000000000000003"
  echo "VERIFICATION_ADMIN_BATCH_TOKEN=drill00000000000000000000000000004"
  echo "PROFILE_ADMIN_BATCH_TOKEN=drill0000000000000000000000000000000005"
  echo "SEANCES_ADMIN_BATCH_TOKEN=drill0000000000000000000000000000000006"
} >/etc/fxmily/web.env
chmod 600 /etc/fxmily/web.env
: >/etc/fxmily/cron.env

mkdir -p /etc/cron.d
for i in $(seq 1 25); do echo "*/5 * * * * root /bin/true # app-row-$i"; done >"$CRON_APP"
APP_SHA_0="$(sha256sum "$CRON_APP" | cut -d' ' -f1)"
ok "canary /etc/cron.d/fxmily-app seeded with 25 rows"

hdr "1 · install"
bash "$INSTALLER" 2>&1 | sed 's/^/  | /'
INSTALL_RC="${PIPESTATUS[0]}"
[ "$INSTALL_RC" -eq 0 ] && ok "installer exit 0" || bad "installer exit $INSTALL_RC"
for f in "$CRON_WORKER" "$BIN_W" "$BIN_D" "$LOGROT"; do
  [ -e "$f" ] && ok "installed $f" || bad "MISSING after install: $f"
done
ROWS="$(grep -cE '^[0-9*]' "$CRON_WORKER" 2>/dev/null || echo 0)"
[ "$ROWS" -eq 8 ] && ok "8 schedule rows" || bad "$ROWS schedule rows, expected 8"
CR="$(tr -cd '\r' <"$CRON_WORKER" | wc -c)"
[ "$CR" -eq 0 ] && ok "0 CR byte in the schedule" || bad "$CR CR bytes"
[ "$(sha256sum "$CRON_APP" | cut -d' ' -f1)" = "$APP_SHA_0" ] &&
  ok "canary byte-identical after install" || bad "THE INSTALLER TOUCHED $CRON_APP"
grep -q '^FXMILY_WORKER_DRY_RUN=1' /etc/fxmily/cron.env &&
  ok "observation window armed (DRY_RUN=1)" || bad "observation window NOT armed"

hdr "2 · install again (idempotence)"
bash "$INSTALLER" >/tmp/reinstall.log 2>&1
RC2=$?
[ "$RC2" -eq 0 ] && ok "second install exit 0" || bad "second install exit $RC2"
[ "$(grep -cE '^[0-9*]' "$CRON_WORKER")" -eq 8 ] && ok "still 8 rows (no duplication)" || bad "rows duplicated"
[ "$(grep -c '^FXMILY_WORKER_DRY_RUN=' /etc/fxmily/cron.env)" -eq 1 ] &&
  ok "DRY_RUN line not duplicated" || bad "DRY_RUN line appended twice"

hdr "3 · --check"
bash "$INSTALLER" --check >/tmp/check.log 2>&1
RC3=$?
[ "$RC3" -eq 0 ] && ok "--check exit 0 on a healthy install" || bad "--check exit $RC3"

hdr "4 · --uninstall (THE GESTURE UNDER TEST)"
bash "$INSTALLER" --uninstall 2>&1 | sed 's/^/  | /'
RC4="${PIPESTATUS[0]}"
[ "$RC4" -eq 0 ] && ok "uninstall exit 0" || bad "uninstall exit $RC4"
for f in "$CRON_WORKER" "$BIN_W" "$BIN_D" "$LOGROT"; do
  [ ! -e "$f" ] && ok "removed $f" || bad "STILL PRESENT after uninstall: $f"
done
# The four things the uninstall banner PROMISES to keep. A rollback that took
# the tokens or the Claude session with it would turn a one-command return to
# the PC into a re-provisioning.
for f in "$FX/worker/.git" "$FX/worker/ops/worker/worker.env" "$FX/.npm-global/bin/claude"; do
  [ -e "$f" ] && ok "kept $f" || bad "DESTROYED by uninstall: $f"
done
[ "$(sha256sum "$CRON_APP" | cut -d' ' -f1)" = "$APP_SHA_0" ] &&
  ok "canary byte-identical after uninstall" || bad "UNINSTALL TOUCHED $CRON_APP"

hdr "5 · --uninstall twice (idempotence)"
bash "$INSTALLER" --uninstall >/tmp/uninstall2.log 2>&1
RC5=$?
[ "$RC5" -eq 0 ] && ok "second uninstall exit 0 (nothing left to remove)" || bad "second uninstall exit $RC5"

hdr "6 · --check must now REFUSE (a gate that passes on a removed install is worthless)"
bash "$INSTALLER" --check >/tmp/check-after.log 2>&1
RC6=$?
[ "$RC6" -ne 0 ] && ok "--check exit $RC6 after uninstall (correctly refuses)" ||
  bad "--check STILL PASSES with the worker uninstalled — the gate proves nothing"

hdr "7 · re-install (the rollback is reversible)"
bash "$INSTALLER" >/tmp/reinstall2.log 2>&1
RC7=$?
[ "$RC7" -eq 0 ] && ok "re-install exit 0" || bad "re-install exit $RC7"
for f in "$CRON_WORKER" "$BIN_W" "$BIN_D" "$LOGROT"; do
  [ -e "$f" ] && ok "restored $f" || bad "NOT restored: $f"
done
[ "$(sha256sum "$CRON_APP" | cut -d' ' -f1)" = "$APP_SHA_0" ] &&
  ok "canary byte-identical after the full cycle" || bad "canary changed across the cycle"

hdr "8 · FALSIFICATION — the canary assertion must be able to go red"
# Without this, "canary byte-identical" could be green because the comparison is
# broken rather than because the file is untouched. Four green comparisons above
# are worth exactly as much as this one red.
echo "# an unrelated writer touched this" >>"$CRON_APP"
if [ "$(sha256sum "$CRON_APP" | cut -d' ' -f1)" = "$APP_SHA_0" ]; then
  bad "the canary assertion cannot detect a modification — it proves nothing"
else
  ok "canary assertion goes red when the file is modified (so its green means something)"
fi

hdr "VERDICT"
[ "$FAILED" -eq 0 ] && echo "DRILL PASSED" || echo "DRILL FAILED"
exit "$FAILED"
