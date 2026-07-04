# ops/cron — server crons (Hetzner host)

Source of truth for everything the host cron runs:

| File                                                              | Installed at                      | Runs as       | Installed by                            |
| ----------------------------------------------------------------- | --------------------------------- | ------------- | --------------------------------------- |
| `crontab.fxmily`                                                  | `/etc/cron.d/fxmily-app`          | (table)       | **deploy.yml** via `fxmily-sync-cron`   |
| `fxmily-cron`                                                     | `/usr/local/bin/fxmily-cron`      | `fxmily`      | **deploy.yml** via `fxmily-sync-cron`   |
| `fxmily-sync-cron`                                                | `/usr/local/bin/fxmily-sync-cron` | `root` (sudo) | **manual root action only** (see below) |
| `fxmily-backup` / `fxmily-caddy-backup` / `fxmily-uploads-backup` | `/usr/local/bin/…`                | `fxmily`      | manual (provisioning)                   |

## Automatic convergence (tour 12)

Every healthy deploy stages `crontab.fxmily` + `fxmily-cron` on the host
(`/home/fxmily/cron-sync/`, scp step in `deploy.yml`) and runs
`sudo /usr/local/bin/fxmily-sync-cron`. The sync validates the crontab line
by line (only allowlisted `fxmily`-user commands + the literal root autoheal
line), then installs both files atomically with timestamped backups. The
installed cron is therefore a pure function of the merged repo — the class of
incident where a cron added in the repo never reaches prod (2026-07-04,
`verification-batch-overdue-alert`) cannot recur.

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

## Watchers on top

- `cron-watch.yml` polls `/api/cron/health` hourly, self-heals the
  detection-only crons (re-fires the 5 overdue-alert nudges +
  verification-scan when stale), and fails loudly only if still red.
- `/usr/local/bin/fxmily-autoheal` (root, every minute) restarts the
  `fxmily-web` container when its Docker HEALTHCHECK goes unhealthy.
- `/admin/system` renders the full heartbeat board (source of truth:
  `apps/web/src/lib/system/health.ts`).
