# Démo account seed

Seeds a fully populated demo member — **`demo@fxmily.local`** — so every member
surface (dashboard, progression, patterns, objectifs, coaching, vérification,
training, calendrier, reports…) renders with real, evolving, multi-day data.

## Run

From `D:\Fxmily` (PowerShell):

```powershell
$env:DATABASE_URL = "postgresql://fxmily:fxmily_dev@localhost:5432/fxmily?schema=public"
pnpm --filter @fxmily/web exec tsx scripts/seed-demo.ts
```

Prerequisite: Mark Douglas cards must already be seeded
(`scripts/seed-mark-douglas-cards.ts`) — the coaching module references published
cards by slug/category.

## Login

|          |                             |
| -------- | --------------------------- |
| email    | `demo@fxmily.local`         |
| password | `DemoFxmily2026!`           |
| url      | http://localhost:3000/login |

## What it does

- **Idempotent**: wipes and re-creates **only** `demo@fxmily.local` (the User
  cascade removes all its rows). Real members are never touched. Re-running
  produces byte-identical data (single seeded `mulberry32` PRNG).
- **Self-contained** (Pattern A): needs only `DATABASE_URL`. It instantiates its
  own `PrismaClient` + `PrismaPg` adapter and hashes the password with argon2 —
  no `AUTH_SECRET` / `server-only` coupling. Because the scoring/triggers
  services are `server-only` (unloadable under `tsx`), the derived rows
  (behavioral scores, constancy scores, deliveries…) are written directly, the
  same proven approach as `scripts/seed-objectives-demo.ts`.
- **Evolving**: every time-series trends gently upward across a 90-day window
  (`progress()` ramp) so the demo tells a coherent story — a member who started
  undisciplined and grew into a calm, process-driven trader.

## Structure

| File              | Seeds                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `_shared.ts`      | PRNG, date helpers (`@db.Date` / `DateTime`), content pools, `SeedCtx`                                       |
| `core.ts`         | trades, daily check-ins, behavioral scores, habit logs                                                       |
| `onboarding.ts`   | onboarding interview + answers + member profile (axes)                                                       |
| `coaching.ts`     | alerts, Mark Douglas deliveries/favorites, micro-objectives                                                  |
| `verification.ts` | broker accounts, MT5 proofs, extracted positions, discrepancies, score events, constancy scores              |
| `reflection.ts`   | weekly reviews, mindset checks, ABCD reflections                                                             |
| `reports.ts`      | weekly reports, monthly debriefs                                                                             |
| `practice.ts`     | training sessions/trades/debriefs, meetings, attendance                                                      |
| `daily-extras.ts` | pre-trade checks, tracking entries (`process-fidelity`), schedule, weekly questionnaires, adaptive calendars |

## Production (isolated, real-member-safe)

`Meeting` rows are **global** (not user-scoped). To keep the demo from touching
anything but its own account, set **`DEMO_SEED_GLOBAL_MEETINGS=false`** when
running against a shared/prod DB: the practice module then **never creates**
global meetings — it only declares the demo member's attendance on meetings that
_already_ exist. Everything else the seed writes is user-scoped and removed by
the `demo@fxmily.local` cascade, so re-running never affects real members.

Prod is seeded via the manual GitHub Actions workflow **`.github/workflows/seed-demo.yml`**
(`Actions → Seed demo account → Run workflow`, or `gh workflow run seed-demo.yml`).
It SSHes to the host and runs this seed (with the prod-safe flag) inside a
one-shot container on the `fxmily-internal` network, against the prod
`DATABASE_URL`. Login is then the same everywhere: `demo@fxmily.local` /
`DemoFxmily2026!`.
