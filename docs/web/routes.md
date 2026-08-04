# Routes connues — `apps/web`

Sorti de `apps/web/CLAUDE.md` le 2026-08-04 (inventaire derivable du code, pas une instruction).

## Routes connues (à compléter par jalon)

| Route                                  | Méthode  | Fichier                                                | Statut                                                                        |
| -------------------------------------- | -------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `/`                                    | GET      | `src/app/page.tsx`                                     | J0 — splash placeholder                                                       |
| `/api/health`                          | GET      | `src/app/api/health/route.ts`                          | J0 — env + DB ping                                                            |
| `/api/auth/[...nextauth]`              | GET/POST | `src/app/api/auth/[...nextauth]/route.ts`              | J1 — Auth.js v5 handlers (Node)                                               |
| `/login`                               | GET/POST | `src/app/login/{page,login-form,actions}.tsx`          | J1 — Credentials login                                                        |
| `/onboarding/welcome?token=…`          | GET/POST | `src/app/onboarding/welcome/*`                         | J1 — invitation consume + autologin                                           |
| `/admin/invite`                        | GET/POST | `src/app/admin/invite/*`                               | J1 — admin-only invite form                                                   |
| `/dashboard`                           | GET      | `src/app/dashboard/page.tsx`                           | J1 — landing post-login (links to journal)                                    |
| `/journal`                             | GET      | `src/app/journal/page.tsx`                             | J2 — list, status filter (all/open/closed)                                    |
| `/journal/new`                         | GET      | `src/app/journal/new/page.tsx`                         | J2 — wizard mobile-first 6 étapes                                             |
| `/journal/[id]`                        | GET      | `src/app/journal/[id]/page.tsx`                        | J2 — détail + delete + close CTA                                              |
| `/journal/[id]/close`                  | GET/POST | `src/app/journal/[id]/close/page.tsx`                  | J2 — formulaire de clôture                                                    |
| `/api/uploads`                         | POST     | `src/app/api/uploads/route.ts`                         | J2 — multipart, magic-byte, audit                                             |
| `/api/uploads/[...key]`                | GET      | `src/app/api/uploads/[...key]/route.ts`                | J2 — stream local FS (dev), R2 redirect (prod)                                |
| `/admin/members`                       | GET      | `src/app/admin/members/page.tsx`                       | J3 — admin-only members list                                                  |
| `/admin/members/[id]`                  | GET      | `src/app/admin/members/[id]/page.tsx`                  | J3 — overview + trades tab (?tab=trades)                                      |
| `/admin/members/[id]/trades/[tradeId]` | GET      | `src/app/admin/members/[id]/trades/[tradeId]/page.tsx` | J3 — admin-scoped trade detail; J4 — annotate + delete actions                |
| `/checkin`                             | GET      | `src/app/checkin/page.tsx`                             | J5 — landing : streak + status matin/soir                                     |
| `/checkin/morning`                     | GET      | `src/app/checkin/morning/page.tsx`                     | J5 — wizard 5 étapes (sleep → routine → body → mind → intention)              |
| `/checkin/evening`                     | GET      | `src/app/checkin/evening/page.tsx`                     | J5 — wizard 5 étapes (discipline → hydratation → stress → mental → réflexion) |
| `/api/cron/checkin-reminders`          | POST     | `src/app/api/cron/checkin-reminders/route.ts`          | J5 — scan reminders (X-Cron-Secret gate)                                      |
| `/api/cron/recompute-scores`           | POST     | `src/app/api/cron/recompute-scores/route.ts`           | J6 — nightly recompute behavioral scores (X-Cron-Secret gate, `0 2 * * *`)    |
