#!/bin/sh
# Fxmily production entrypoint.
#
# Self-heals the uploads volume ownership, then drops privileges. The
# `fxmily-uploads` named volume (docker-compose.prod.yml) can be ROOT-owned when
# it pre-dates the image's `chown /app/.uploads` (S10) or was first initialised
# from the historical `UPLOADS_DIR=/opt/fxmily/.uploads` mount the image never
# created. Docker does NOT re-initialise a non-empty volume, so a root-owned one
# makes the non-root app (uid 1001) EACCES on the first write →
# `LocalStorageAdapter.put` throws → /api/uploads answers `storage_failed`.
# Runtime-proven. Chowning the mount root is enough: the proof write path
# `mkdir -p proofs/{userId}` then creates fxmily-owned subdirs.
#
# We start as root ONLY to chown the mount(s), then exec the server as the
# unprivileged `fxmily` user via setpriv (util-linux, already in the image). Net
# runtime user is unchanged (1001); no manual host `chown` is ever required.
set -e

for d in /app/.uploads /opt/fxmily/.uploads; do
  if [ -d "$d" ]; then
    chown fxmily:fxmily "$d" 2>/dev/null || true
  fi
done

exec setpriv --reuid=fxmily --regid=fxmily --init-groups "$@"
