#!/bin/sh
# Fxmily production entrypoint.
#
# Heals the uploads directory ownership + routing, then drops privileges. We
# start as root ONLY to fix the mount(s), then exec the server as the
# unprivileged `fxmily` user (uid 1001) via setpriv (util-linux, already in the
# image). Net runtime user is unchanged; no manual host `chown` is ever required.
#
# --- Why this exists (runtime-proven root cause) -----------------------------
# Two independent facts combine into an `/api/uploads` 500:
#
#  1. The `fxmily-uploads` named volume (docker-compose.prod.yml) is mounted at
#     `/app/.uploads` and can be ROOT-owned (it pre-dates the image's S10
#     `chown /app/.uploads`, or carries root-owned SUBDIRS — `proofs/`, legacy
#     `trades/`/`annotations/`/`training/` media from before uid 1001). Docker
#     never re-initialises a non-empty volume, so a non-root app EACCESes on the
#     first write. The recursive chown below heals the whole tree.
#
#  2. `web.env` sets `UPLOADS_DIR=/opt/fxmily/.uploads`, but the HOST compose
#     file predates the Tour-14 second mount and the deploy pipeline NEVER syncs
#     docker-compose.prod.yml to the host (deploy.yml only scp's cron scripts).
#     So on prod that path is NOT a mounted volume: `LocalStorageAdapter` does
#     `fs.mkdir('/opt/fxmily/.uploads/proofs/{userId}', {recursive:true})`, which
#     walks up to the non-existent `/opt/fxmily` and tries to create it under the
#     root-owned `/opt` as uid 1001 -> `EACCES` on `mkdir /opt/fxmily`
#     (runtime-captured: syscall=mkdir path=/opt/fxmily uid=1001). Even if it
#     could write, the bytes would live in the ephemeral overlay and be WIPED on
#     every deploy (data-loss on the S3 anti-lie proofs).
#
# We can fix neither the host compose nor web.env from the image, so we route
# `UPLOADS_DIR` INTO the real persistent volume with a symlink: writes land in
# `/app/.uploads` (mounted, durable) while the app still honours its configured
# path. Self-healing, no host change. If the host compose is later fixed to mount
# the volume at `UPLOADS_DIR` too, that path exists as a real directory and we
# just chown it instead (both mounts are the same volume — no conflict).
set -e

# 1. Canonical persistent volume — always present (created by the Dockerfile,
#    mounted by compose). Recursive chown so pre-existing root-owned subdirs
#    become writable by uid 1001.
mkdir -p /app/.uploads
chown -R fxmily:fxmily /app/.uploads 2>/dev/null || true

# 2. UPLOADS_DIR routing — normalise BEFORE using (adversarial-review fixes):
#
#    a. ABSENT/blank (P1): the app's fallback is `<cwd>/.uploads`, and the Next
#       standalone server does `process.chdir(__dirname)` so cwd is
#       `/app/apps/web`, NOT `/app` — the fallback would land at
#       `/app/apps/web/.uploads`, OUTSIDE both volume mounts: writes succeed
#       (uid 1001 owns /app) but live in the ephemeral overlay and are wiped on
#       the next deploy. Silent data-loss. So an unset/blank UPLOADS_DIR is
#       pinned to the persistent volume here (env survives `exec setpriv`).
#    b. TRAILING SLASH (P2): `ln -sfn target "$UD/"` is rejected by symlink(2)
#       (ENOENT) when the path does not exist yet — with `set -e` that would
#       crash-loop the container. Strip trailing slashes first (also restores
#       the `/app/.uploads/` == canonical skip).
#    c. RELATIVE PATH (P2): the shell would resolve it against /app while
#       Node's `path.resolve` resolves against /app/apps/web — two different
#       places, symlink useless, writes silently ephemeral. Force absolute or
#       fall back to the canonical volume.
UD="${UPLOADS_DIR:-}"
while [ "${UD%/}" != "$UD" ]; do UD="${UD%/}"; done
case "$UD" in
  /*) ;; # absolute — keep
  '')
    echo '[entrypoint] UPLOADS_DIR unset/blank -> pinning to /app/.uploads (persistent volume)'
    UD='/app/.uploads'
    ;;
  *)
    echo "[entrypoint] UPLOADS_DIR is not absolute ('$UD') -> falling back to /app/.uploads" >&2
    UD='/app/.uploads'
    ;;
esac
export UPLOADS_DIR="$UD"

if [ "$UD" != "/app/.uploads" ]; then
  if [ -d "$UD" ] && [ ! -L "$UD" ]; then
    # Already a real directory (a proper mount of the volume once the host
    # compose is fixed, or a stray ephemeral dir) — just make it writable.
    chown -R fxmily:fxmily "$UD" 2>/dev/null || true
  else
    # Absent (current prod) or already our symlink -> (re)point it at the real
    # persistent volume. `ln -sfn` repoints an existing symlink without
    # dereferencing it, and replaces a stray file; the real-dir case above never
    # reaches here so we never nest a link inside a directory.
    mkdir -p "$(dirname "$UD")"
    ln -sfn /app/.uploads "$UD"
  fi
fi

exec setpriv --reuid=fxmily --regid=fxmily --init-groups "$@"
