# Runbook — Cron `recompute-scores` (Hetzner)

Wires the J6 nightly behavioral-score recompute on the production Hetzner box.

## What it does

`POST /api/cron/recompute-scores` calls `recomputeAllActiveMembers()` which
iterates every `User.status = 'active'`, recomputes the 4 behavioral scores
over the rolling 30-day window anchored to **yesterday-local in each user's
timezone**, and `upsert`s a `BehavioralScore` row keyed on `(userId, date)`.

Idempotent — running twice for the same local-day overwrites the snapshot
rather than stacking duplicates.

## Why 02:00 UTC

- Deep in the off-hours window for every supported timezone (V1 = `Europe/Paris`,
  03:00 winter / 04:00 summer local).
- Service computes "yesterday-local" by default (the snapshot is stable, today
  is partial — see `lib/scoring/service.ts`).

## Crontab entry (Hetzner)

Append to `/etc/cron.d/fxmily-app` on the production host (root-owned, `0644`):

```cron
# m h dom mon dow user command
0 2 * * *  fxmily  /usr/local/bin/fxmily-cron recompute-scores >> /var/log/fxmily/cron.log 2>&1
```

Where `/usr/local/bin/fxmily-cron` is a small wrapper script:

```bash
#!/usr/bin/env bash
# /usr/local/bin/fxmily-cron — invoke a Fxmily cron endpoint with the secret.
# Used by /etc/cron.d/fxmily-app.
set -euo pipefail

ENDPOINT="${1:-}"
if [[ -z "$ENDPOINT" ]]; then
  echo "usage: fxmily-cron <endpoint>" >&2
  exit 2
fi

# Source the secrets (mode 0600, owner=fxmily).
. /etc/fxmily/cron.env

curl -fsS \
  --max-time 600 \
  --retry 0 \
  -X POST \
  -H "X-Cron-Secret: ${CRON_SECRET}" \
  -H "User-Agent: fxmily-cron/1.0" \
  "https://app.fxmilyapp.com/api/cron/${ENDPOINT}"
```

`/etc/fxmily/cron.env` (mode `0600`, owner `fxmily`):

```bash
CRON_SECRET=<the-same-secret-as-the-Next.js-app-CRON_SECRET>
```

## Health check

The endpoint always returns JSON with the run summary (counts only, no PII):

```json
{
  "ok": true,
  "computed": 27,
  "skipped": 0,
  "errors": 0,
  "ranAt": "2026-05-08T02:00:01.234Z"
}
```

The same payload is captured in `audit_logs` with `action =
'cron.recompute_scores.scan'` (1 row per run — heartbeat). Query:

```sql
SELECT
  metadata->>'computed' AS computed,
  metadata->>'errors' AS errors,
  created_at
FROM audit_logs
WHERE action = 'cron.recompute_scores.scan'
ORDER BY created_at DESC
LIMIT 14;
```

## Expected response codes

| Scenario                               | Status                | What                                       |
| -------------------------------------- | --------------------- | ------------------------------------------ |
| Secret matches, healthy                | `200`                 | Run completed, JSON summary                |
| `CRON_SECRET` env var not set          | `503`                 | Service refuses to run                     |
| Wrong / missing `X-Cron-Secret` header | `401`                 | Defense-in-depth (constant-time compare)   |
| Token bucket tripped (5 burst, 1/min)  | `429` + `Retry-After` | Brute-force / DoS oracle protection        |
| GET request                            | `405`                 | POST-only                                  |
| Internal exception                     | `500`                 | JSON `{ ok: false, error: 'scan_failed' }` |

## Manual run (debugging)

From the Hetzner host:

```bash
sudo -u fxmily /usr/local/bin/fxmily-cron recompute-scores
```

From a developer machine pointing at the local dev server (worktree):

```bash
curl -X POST -H "X-Cron-Secret: $CRON_SECRET" \
  http://localhost:3000/api/cron/recompute-scores
```

## Backfill

To recompute snapshots for every active user at a specific past local-day,
run the following Node one-shot on the host (DATABASE_URL pointing at prod):

```bash
sudo -u fxmily /usr/local/bin/fxmily-recompute-asof 2026-05-01
```

Where `fxmily-recompute-asof` is a small script (TODO V2 — backfill DR-only,
not shipped V1) that calls `recomputeAllActiveMembers(new Date('2026-05-01...'))`
in-process. The cron route's `?at=ISO` debug knob is intentionally
double-gated against prod (`NODE_ENV !== 'production'` AND
`AUTH_URL !== 'https://...'`).

## Observability

- **Per-run heartbeat**: `audit_logs` row `cron.recompute_scores.scan`.
- **Per-user errors**: `console.error('[scoring] recompute failed:', err)` in
  the service — Sentry captures them via `instrumentation.ts onRequestError`
  and `reportError()` helper (câblé J10 Phase B, commit `ba026e0`).
- **Latency budget**: at 30 active members × 4 dimensions × 30-day window,
  one run takes ≈1–3s on a CX22. Bump to a CX32 if it grows past 10s
  (a sustained recompute cost > 0.1% of a CX22 wall-clock month is a smell).

## Rotation of `CRON_SECRET`

1. Generate a new secret: `openssl rand -hex 24` (≥48 chars).
2. Update `apps/web/.env` on the prod host (`CRON_SECRET=<new>`).
3. Restart the Next.js process (`systemctl restart fxmily-app`).
4. Update `/etc/fxmily/cron.env` with the same value.
5. Test the next cron run via the manual command above.

The secret is **never logged** — `console.error` paths only emit the secret
length / SHA-256 prefix when present. Rotation is safe at any time;
mismatched secrets just produce 401s in the cron log until both ends agree.

## Failure modes & remediation

| Symptom                         | Cause                           | Fix                                                       |
| ------------------------------- | ------------------------------- | --------------------------------------------------------- |
| All cron runs return 503        | `CRON_SECRET` not in app env    | Add to `apps/web/.env`, restart app                       |
| All cron runs return 401        | Secret mismatch app vs cron.env | Re-sync both files                                        |
| `errors` count > 0 in heartbeat | Per-user exception              | Inspect Sentry / app logs for the user IDs                |
| `computed` count drops to 0     | All members suspended/deleted   | Check `users.status` distribution                         |
| Cron fires but no row updated   | DB lock / transaction abort     | Check Postgres logs, may need pg_isready check before run |

## V2 TODO (post-V1)

- Add Prometheus / Grafana counter for `computed` / `errors` (au-delà de
  l'observability `/admin/system` + cron-watch GH Actions livrée J10
  Phase J).
- Backfill script `fxmily-recompute-asof` (currently a TODO above) — pour
  DR / replay scenarios uniquement.

## ✅ Câblé J10

- Sentry capture côté serveur via `instrumentation.ts` + `reportError()`
  helper (Phase B, commit `ba026e0`).
- `flushSentry(2000)` appelé dans 7 cron catches avant return (Phase J
  round 3, commit `f5ba4a9`).
- `/admin/system` cohort snapshot + per-cron heartbeat status pill
  (Phase J observability, commit `4d9381c`).
- `cron-watch.yml` scheduled hourly, auto-issue si red, auto-close si
  green (Phase J observability).
