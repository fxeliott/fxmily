# Runbook — Zero-cost deployment (Phase N)

> Préparé 2026-05-09 en réponse à la contrainte Eliot "pas de coût
> supplémentaire et en API". Path alternatif au runbook Hetzner.
> **Coût total V1 : 0 €/mois, 0 € de CB engagée.**

> ⚠️ **AVERTISSEMENT CRITIQUE — Clause non-commerciale Vercel Hobby**
>
> Recherche 2026-05-09 (researcher subagent + sources Vercel officielles) :
> Vercel Hobby plan ToS interdit explicitement _"any deploy for the purpose
> of financial gain of anyone involved"_. La **formation Fxmily étant payante**,
> l'app de suivi cohorte en est un sous-produit commercial — risque réel
> de **suspension du compte** sans préavis si Vercel détecte l'usage.
>
> Sources :
>
> - [Vercel Hobby plan doc](https://vercel.com/docs/plans/hobby)
> - [Vercel Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines)
>
> **3 options pour contourner le risque** :
>
> 1. **Vercel Pro $20/mo** — clause levée, prod-grade (mais 240 €/an > Hetzner 70 €/an, NON OPTIMAL)
> 2. **Contact Vercel Support** avant de déployer — décrire le contexte (cohorte interne 30 users, app pas facturée directement, formation hors-app) et obtenir une autorisation écrite. Lent (~3-5 jours), incertain.
> 3. **Pivot vers Hetzner CX22** (Path A, ~5€/mois) — pas de clause commerciale, prod-grade. Recommandé.
>
> Le path Vercel ci-dessous reste **techniquement valide pour un proof-of-concept
> ou une démo non-cohorte**. À ne PAS utiliser tel quel pour la cohorte
> formation payante sans validation Vercel Support.

## Stack

| Composant      | Service                          | Free tier                            | CB requise ?   |
| -------------- | -------------------------------- | ------------------------------------ | -------------- |
| Hosting        | **Vercel Hobby**                 | 100 GB bw/mo, 100h compute           | ❌ non         |
| Postgres       | **Neon free tier**               | 0.5 GB DB, autosuspend               | ❌ non         |
| Domain         | `fxmily.vercel.app` (sub-domain) | gratuit perpétuel                    | ❌ non         |
| Cron           | **GitHub Actions scheduled**     | 2000 min/mo public, illimité private | ❌ non         |
| Email          | **Resend free**                  | 3000 emails/mo                       | ❌ non         |
| Storage médias | **Vercel Blob**                  | 1 GB free                            | ❌ non         |
| Monitoring     | **Sentry free**                  | 5000 events/mo                       | ❌ non         |
| **Total V1**   |                                  |                                      | **0 € / 0 CB** |

## Pré-requis Eliot manuel (~10 min, 0 CB)

1. **Vercel** : <https://vercel.com/signup> (GitHub OAuth) → Hobby plan.
2. **Neon** : <https://neon.tech/signup> → free tier → create project `fxmily-prod`. Copy the `DATABASE_URL` (with `?sslmode=require`).
3. **Sentry** : <https://sentry.io/signup/> → projet `fxmily-web` → DSN + auth token.
4. **Resend** : <https://resend.com/signup> → API key (rest like before).
5. **iPhone iOS 18.4+** for push real-device test (cf. `runbook-prod-smoke-test.md` §9).

> ⚠️ Sans domaine custom, **Resend ne peut envoyer qu'à l'email du compte propriétaire** (Eliot). Acceptable pour V1 cohort 30 :
>
> - Eliot reçoit le digest hebdo (J8) ✓
> - Les invitations members partent depuis `onboarding@resend.dev` (le sender de test Resend, livré à n'importe quelle inbox)
> - Pour livrer à des invités custom plus tard, ajouter un domaine vérifié → revient au path Hetzner ou plan payant.

## Tokens à récupérer

| GitHub secret                                                             | Valeur                                                   |
| ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `VERCEL_TOKEN`                                                            | `vercel.com → Account → Tokens` (full access)            |
| `VERCEL_ORG_ID`                                                           | après `vercel link` (cf. ci-dessous)                     |
| `VERCEL_PROJECT_ID`                                                       | après `vercel link`                                      |
| `DATABASE_URL`                                                            | Neon connection string                                   |
| `AUTH_SECRET`                                                             | `openssl rand -base64 32`                                |
| `CRON_SECRET`                                                             | `openssl rand -hex 24`                                   |
| `RESEND_API_KEY`                                                          | Resend dashboard                                         |
| `RESEND_FROM`                                                             | `Fxmily <onboarding@resend.dev>` (V1 sans domain custom) |
| `SENTRY_DSN`                                                              | Sentry → Project → Client Keys                           |
| `NEXT_PUBLIC_SENTRY_DSN`                                                  | mirror of `SENTRY_DSN`                                   |
| `SENTRY_AUTH_TOKEN`                                                       | Sentry → Settings → Auth Tokens                          |
| `SENTRY_ORG` / `SENTRY_PROJECT`                                           | `fxmily` / `fxmily-web`                                  |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `npx web-push generate-vapid-keys`                       |
| `VAPID_SUBJECT`                                                           | `mailto:eliot@example.com` (any working email)           |

| GitHub variable | Valeur                                                   |
| --------------- | -------------------------------------------------------- |
| `APP_URL`       | `https://fxmily.vercel.app` (rempli après le 1er deploy) |

## Bootstrap (~10 min)

```bash
# 1. Local Vercel link (one-time)
cd apps/web
pnpm dlx vercel@latest login                    # browser auth
pnpm dlx vercel@latest link                     # créer le projet, lien
# → écrit `apps/web/.vercel/project.json` avec orgId + projectId

# 2. Note les IDs
cat .vercel/project.json
# {"orgId": "team_xxx", "projectId": "prj_yyy"}

# 3. Pose les secrets GitHub via le script Phase L (couvre les 13 secrets + 1 variable)
# Crée tokens.local.env (cf. tokens.local.env.example) puis :
bash ops/scripts/pose-github-secrets.sh tokens.local.env

# 4. Trigger le 1er deploy
gh workflow run deploy-vercel.yml -R fxeliott/fxmily

# 5. Vérifie le deploy
gh run list -R fxeliott/fxmily --workflow=deploy-vercel.yml --limit=1
```

## Cron jobs

7 workflows GitHub Actions remplacent le cron systemd Hetzner :

| Workflow                            | Schedule                         | Route                                |
| ----------------------------------- | -------------------------------- | ------------------------------------ |
| `cron-checkin-reminders.yml`        | `0,15,30,45 6-10,19-23 * * *`    | `/api/cron/checkin-reminders`        |
| `cron-recompute-scores.yml`         | `0 2 * * *`                      | `/api/cron/recompute-scores`         |
| `cron-dispatch-douglas.yml`         | `0 0,6,12,18 * * *`              | `/api/cron/dispatch-douglas`         |
| `cron-weekly-reports.yml`           | `0 21 * * 0`                     | `/api/cron/weekly-reports`           |
| `cron-dispatch-notifications.yml`   | `*/5 * * * *` (vs `*/2` Hetzner) | `/api/cron/dispatch-notifications`   |
| `cron-purge-deleted.yml`            | `0 3 * * *`                      | `/api/cron/purge-deleted`            |
| `cron-purge-push-subscriptions.yml` | `0 5 * * 0`                      | `/api/cron/purge-push-subscriptions` |

Trade-off : GitHub Actions cron min granularité = 5 min (vs Hetzner systemd 1 min). Le dispatcher J9 atomic claim + retry budget absorbe la latence dégradée (~3 min plus de latence en p99).

## Observability gardée

`cron-watch.yml` (Phase J) continue à curl `/api/cron/health` chaque heure et ouvrir une issue auto si statut red. `/admin/system` page Server Component reste dispo.

## Limites du path zéro-coût

| Limite                              | Impact                                                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vercel Hobby = "non-commercial use" | OK pour V1 cohort privée formation. À monitorer si Eliot facture la formation directement via l'app (V2 Stripe → upgrade Vercel Pro 20 €/mois ou pivot Hetzner). |
| Neon 0.5 GB DB                      | Suffit ~30k trades + 30k checkins. Auto-suspend après 5 min inactivité = cold start 1-3 s sur la 1ère requête (acceptable pour cohort 30).                       |
| Resend owner-only                   | Les invités reçoivent les emails depuis `onboarding@resend.dev` (inbox spam parfois — à valider iCloud spam folder).                                             |
| GH Actions cron 5 min               | Push notifications latence légèrement dégradée.                                                                                                                  |
| Vercel Blob 1 GB                    | ~100 trades avec 2 screenshots × 5MB ≈ 1GB → cap atteint à ~100 trades, à monitorer.                                                                             |
| Pas de SSH custom                   | Pas d'accès host filesystem (logs Vercel via dashboard uniquement).                                                                                              |

## Migration vers Hetzner (V1.5 si V1 succès)

Le path Hetzner reste documenté dans `docs/runbook-hetzner-deploy.md`.
Migration : exporter Neon DB (`pg_dump`), provisionner CX22 via
`ops/scripts/bootstrap-fxmily.sh`, importer dump, switch DNS A record.

Le code reste identique entre les 2 paths — seule la config infra change.

## Quick troubleshooting

| Symptôme                                     | Cause                                     | Fix                                      |
| -------------------------------------------- | ----------------------------------------- | ---------------------------------------- |
| `Vercel deploy → 500`                        | DATABASE_URL Neon stale après autosuspend | Wake-up via 1ère requête, retry deploy   |
| Cron `429 rate_limited`                      | Token bucket cron limiter saturé          | Wait `Retry-After`                       |
| Resend `403 forbidden`                       | Recipient ≠ owner email                   | Cf. limite ci-dessus                     |
| `Vercel 500 — `cannot find module 'argon2'`` | Native binding pas tracé                  | Use `@node-rs/argon2` (déjà notre choix) |

## Commandes Vercel CLI utiles

```bash
vercel logs --follow                          # logs runtime
vercel env ls                                 # list env vars
vercel rollback                               # rollback to previous
vercel inspect <deployment-url>               # detail
```

## Cleanup

Pas de cleanup nécessaire — Vercel + Neon free tier auto-suspend si inactif.
Pour fermer définitivement : Vercel Dashboard → Project → Settings → Delete +
Neon Console → Project → Settings → Delete.
