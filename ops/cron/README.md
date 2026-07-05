# ops/cron — server crons (Hetzner host)

Source of truth for everything the host cron runs:

| File                                                              | Installed at                          | Runs as       | Installed by                            |
| ----------------------------------------------------------------- | ------------------------------------- | ------------- | --------------------------------------- |
| `crontab.fxmily`                                                  | `/etc/cron.d/fxmily-app`              | (table)       | **deploy.yml** via `fxmily-sync-cron`   |
| `fxmily-cron`                                                     | `/usr/local/bin/fxmily-cron`          | `fxmily`      | **deploy.yml** via `fxmily-sync-cron`   |
| `fxmily-sync-cron`                                                | `/usr/local/bin/fxmily-sync-cron`     | `root` (sudo) | **manual root action only** (see below) |
| `fxmily-backup` / `fxmily-caddy-backup` / `fxmily-uploads-backup` | `/usr/local/bin/…`                    | `fxmily`      | **deploy.yml** via `fxmily-sync-cron`   |
| `fxmily-restore-drill`                                            | `/usr/local/bin/fxmily-restore-drill` | `fxmily`      | **deploy.yml** via `fxmily-sync-cron`   |
| `fxmily-autoheal` (repo: `ops/scripts/`)                          | `/usr/local/bin/fxmily-autoheal`      | `root`        | **deploy.yml** via `fxmily-sync-cron`   |

## Automatic convergence (tour 12 → tour 14)

Every healthy deploy stages the crontab + EVERY ops script it references on the
host (`/home/fxmily/cron-sync/`, scp step in `deploy.yml`) and runs
`sudo /usr/local/bin/fxmily-sync-cron`. The sync validates the crontab line
by line (only allowlisted `fxmily`-user commands + the literal root autoheal
line), then installs the crontab, `fxmily-cron`, the three backup scripts, the
restore drill, and the root autoheal — each atomically with timestamped
backups. The installed cron is therefore a pure function of the merged repo —
the class of incident where a cron added in the repo never reaches prod
(2026-07-04, `verification-batch-overdue-alert`) cannot recur.

**Tour 14 (P0-1/P0-2) — the silent-backup gap is closed.** Before tour 14 the
deploy only ever installed `fxmily-cron`; the crontab scheduled
`fxmily-uploads-backup`, `fxmily-caddy-backup` and (root) `fxmily-autoheal` but
those binaries were NEVER installed, so each tick ran a non-existent command and
failed silently — the MT5-proof uploads volume had **no backup at all**. The
sync now converges every referenced script AND runs a post-convergence
`command -v` integrity gate: if the crontab schedules a binary that is neither
staged nor already installed on the host, the sync exits non-zero and the deploy
goes RED instead of hiding the drift.

## Bootstrap / updating the sync script itself

`fxmily-sync-cron` must NEVER be updated through its own sudo path (a script
that can replace itself under sudo is a root escalation). To install or
update it, run as root on the host:

```sh
# from the repo checkout or a scp'd copy:
install -o root -g root -m 0755 fxmily-sync-cron /usr/local/bin/fxmily-sync-cron
printf 'fxmily ALL=(root) NOPASSWD: /usr/local/bin/fxmily-sync-cron\n' > /etc/sudoers.d/fxmily-cron-sync
chmod 0440 /etc/sudoers.d/fxmily-cron-sync
visudo -c
mkdir -p /home/fxmily/cron-sync && chown fxmily:fxmily /home/fxmily/cron-sync
```

Bootstrapped on the host 2026-07-04 (validated end to end: converge no-op,
malicious-line rejection, idempotence).

## Operator action — remove the legacy user-space autoheal (P0-3)

Until tour 14 the autoheal watchdog was installed only in the **`fxmily` user
crontab** (`crontab -u fxmily -l` → `/home/fxmily/bin/fxmily-autoheal`). The
deploy now installs the canonical `root` binary at `/usr/local/bin/fxmily-
autoheal` and the crontab runs it via the root `/etc/cron.d/fxmily-app` line.
The script holds a machine-wide `flock` on `/var/lock/fxmily-autoheal.lock`, so
even if both ran they cannot double-restart a container — but the user crontab
is now redundant and must be removed. After the first tour-14 deploy has merged,
run **once** on the host:

```sh
# inspect what the fxmily user crontab currently schedules:
crontab -u fxmily -l
# if it ONLY contains the autoheal line, drop the whole user crontab:
crontab -r -u fxmily
# otherwise edit it and delete just the fxmily-autoheal line:
crontab -e -u fxmily
```

## Operator action — offsite R2 backups (P0-2, §9-B durability)

The backup + restore-drill scripts are wired but off-site upload stays a
LOCAL-ONLY warning until R2 is configured. To make backups disaster-safe (a
copy that only lives on the same VPS disk is gone the moment the disk dies),
create a Cloudflare R2 bucket + API token (Object Read & Write), then set in
`/etc/fxmily/cron.env` (mode 0600, owner `fxmily`):

```sh
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_BUCKET=fxmily-backups
BACKUP_REQUIRE_OFFSITE=1   # turns a missing off-site target into a HARD failure
```

and configure the `aws` CLI profile `fxmily-backup` with the R2 keys
(`aws configure --profile fxmily-backup`). With `BACKUP_REQUIRE_OFFSITE=1` a
backup that cannot reach R2 exits non-zero (fxmily-backup exit 4), so the
dead-man-switch / healthcheck fires instead of a green cron hiding a
non-durable backup. This is a HOST action only — no code change, no server
edit from CI.

## Operator action — autoheal heartbeat token (P1-4)

`fxmily-autoheal` now POSTs an hourly counts-only heartbeat to
`/api/admin/autoheal/heartbeat` so a dead watchdog surfaces RED on
`/admin/system` + `/api/cron/health` (it was previously mute). Enable it by
adding to `/etc/fxmily/cron.env`:

```sh
# the app URL the watchdog POSTs to (same value the cron wrapper already uses):
APP_URL=https://app.fxmilyapp.com
# reuse the existing admin batch token (the same X-Admin-Token the worker
# watchdog + batch endpoints verify — no new secret to rotate):
AUTOHEAL_ADMIN_TOKEN=<value of ADMIN_BATCH_TOKEN from /etc/fxmily/web.env>
```

Both empty = heartbeat disabled (the watchdog no-ops the POST; the self-healing
restarts still run). A MISSING heartbeat is itself the "watchdog is dead"
signal the board reads (2h+ tolerance, always-on host).

## Monthly restore drill (P1-6, §9-B "proven restores")

`fxmily-restore-drill` runs every Sunday 05:00 Paris but self-gates to the **1st
Sunday of the month**. It decrypts the freshest encrypted pg dump and restores
it into a DISPOSABLE, network-isolated (`--network none`, no published port)
scratch Postgres, then asserts real tables + rows exist (`users`,
`daily_checkins`, `trades`). It NEVER touches prod, NEVER uploads, NEVER deletes
a backup. The verdict is logged to `/var/log/fxmily/cron.log`; set
`HEALTHCHECK_PING_URL_RESTORE` in `cron.env` to fire a dead-man ping on success.
Force an on-demand run with `RESTORE_DRILL_FORCE=1 /usr/local/bin/fxmily-restore-drill`.

## Operator action — persist member uploads (tour 14 data-loss follow-up)

The app resolves its upload root from `UPLOADS_DIR` first, else `<cwd>/.uploads`
(`apps/web/src/lib/storage/local.ts:44`). `web.env` historically set
`UPLOADS_DIR=/opt/fxmily/.uploads`, a path with **no volume mounted on it** — so
MT5 proofs written there lived in the container's ephemeral overlay layer and
were WIPED on every deploy while their DB rows survived (404 on read). Three
moves, all HOST-only, no CI write:

1. **Rescue first.** Proofs uploaded since the last deploy live in the current
   container's overlay at `/opt/fxmily/.uploads`; converging the compose mounts
   the named volume ON TOP of that path and would mask them (DB rows survive,
   reads 404 forever). Copy them into the volume BEFORE the converge:

   ```sh
   docker cp fxmily-web:/opt/fxmily/.uploads/. /tmp/uploads-rescue/ || true
   docker run --rm -v fxmily-uploads:/v -v /tmp/uploads-rescue:/r alpine \
     sh -c 'cp -an /r/. /v/ || true'
   rm -rf /tmp/uploads-rescue
   ```

   `cp -an` never overwrites a file already present in the volume; an empty
   overlay just makes both commands no-ops.

2. `docker-compose.prod.yml` now mounts the `fxmily-uploads` named volume on
   BOTH `/app/.uploads` AND `/opt/fxmily/.uploads`, so the proofs persist
   whatever `UPLOADS_DIR` points at. Converge it on the host:

   ```sh
   cd /opt/fxmily && docker compose -f docker-compose.prod.yml up -d web
   docker inspect fxmily-web \
     --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'
   # expect BOTH: fxmily-uploads -> /app/.uploads AND -> /opt/fxmily/.uploads
   ```

3. Remove the stray `UPLOADS_DIR` line from `/etc/fxmily/web.env` (mode 0600,
   owner `fxmily`) so the app falls back to `/app/.uploads` — the canonical,
   always-mounted path — then recreate `web`. This is the clean fix; the second
   mount above is the belt to that suspenders.

After these moves, the `/admin/system` "Persistance des preuves" card must read
GREEN (persistent volume). Verify no DB-referenced proof 404s: pick a known
`mt5_account_proofs.storage_key` and confirm `/api/uploads/<key>` streams 200.

## Watchers on top

- `cron-watch.yml` polls `/api/cron/health` hourly, self-heals the
  detection-only crons (re-fires the 5 overdue-alert nudges +
  verification-scan when stale), and fails loudly only if still red.
- `/usr/local/bin/fxmily-autoheal` (root, every minute) restarts the
  `fxmily-web` / `fxmily-postgres` container when its Docker HEALTHCHECK goes
  unhealthy, holds a machine-wide lock against double instances, and POSTs an
  hourly heartbeat so the watchdog itself is monitored on `/admin/system`.
- `post-deploy-smoke.sh` runs as the `smoke` job after every healthy deploy
  (public path end-to-end; a failure fails the job, no rollback).
- `/admin/system` renders the full heartbeat board (source of truth:
  `apps/web/src/lib/system/health.ts`).
