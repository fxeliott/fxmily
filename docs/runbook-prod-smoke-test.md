# Runbook — Première invitation prod (Phase F du J10)

> **Critère SPEC §15 J10 verbatim** :
>
> > "L'app est en prod sur app.fxmily.com, Eliot peut s'inviter et tester end-to-end."

Ce runbook est la **checklist 12 steps** à exécuter une fois que les
phases A → E du J10 sont déployées sur Hetzner. Phase E (`deploy.yml`)
peut être déclenchée manuellement avant le smoke (re-pull la dernière
image sans nouveau commit).

## Pré-requis (à confirmer avant d'attaquer)

- [ ] Hetzner CX22 provisionné, IP DNS-routable.
- [ ] `fxmily.com` acheté (Cloudflare Registrar) + DNS posé (A `app`,
      MX Resend, TXT SPF/DKIM/DMARC).
- [ ] Resend Console → Domain `fxmily.com` **verified** (les 3 TXT
      propagés depuis 24h+).
- [ ] Sentry projet `fxmily-web` créé, DSN configuré dans
      `/etc/fxmily/web.env` (et `NEXT_PUBLIC_SENTRY_DSN` mirror).
- [ ] iPhone Safari 18.4+ disponible (Web Push real-device test).
- [ ] `/etc/fxmily/web.env` contient `WEEKLY_REPORT_RECIPIENT=
    eliot@fxmily.com` ET `RESEND_FROM=Fxmily <noreply@fxmily.com>` ET
      `VAPID_SUBJECT=mailto:eliot@fxmily.com` (alignement post-domain
      verify).
- [ ] Mot de passe admin **rotaté post-J8 polish** (incident sec docs/
      jalon-9-prep.md → 2026-05-08 rotation Resend + admin pw).
- [ ] [`runbook-hetzner-deploy.md`](runbook-hetzner-deploy.md) §7
      executé (healthcheck app + 1 cron manuel + 1 backup manuel passent).

## Checklist 12 steps end-to-end

### 1. Login admin sur app.fxmily.com

- Ouvrir <https://app.fxmily.com/login> sur Chrome desktop.
- Email + mdp admin (rotaté post-J8 polish).
- Doit redirect vers `/admin` (pas `/dashboard` — l'admin n'est pas
  membre).
- ⚠️ Si 401 : `/var/log/caddy/fxmily.log` + `journalctl -u fxmily-web` .

### 2. Inviter eliott.pena@icloud.com (compte test)

- `/admin/invite` → entrer `eliott.pena@icloud.com`.
- Submit → message "invitation envoyée" attendu.
- **Audit attendu** : row `invitation.created` dans `audit_logs`.

### 3. Recevoir l'email Resend dans iCloud

- Inbox de `eliott.pena@icloud.com` → email "Tu es invité sur Fxmily".
- Vérifier headers : `From: Fxmily <noreply@fxmily.com>`,
  `DKIM=pass`, `SPF=pass`, `DMARC=pass` (cliquer "Show original" ou
  équivalent iCloud).
- Cliquer le lien → ouvre `https://app.fxmily.com/onboarding/welcome?token=...`.

### 4. Onboarding → mdp test ≥14 chars → /dashboard

- Choisir prénom/nom + mot de passe **réel** ≥14 chars (pas le admin).
- Submit → redirect `/dashboard`.
- **Vérifier UI rendu** : pas d'erreur Sentry, page hydrate sans flash,
  cookie banner visible (premier visit) → dismiss.

### 5. /journal/new → wizard 6 étapes → trade créé

- `/journal/new` → wizard (Setup → Plan → Risk → Confirm Open → ...).
- Saisir 1 trade simple : EURUSD long, 0.50 R risk, plannedRR=2.
- "Confirmer" → redirect `/journal/<id>`.
- **DB row** : `SELECT id FROM trades ORDER BY created_at DESC LIMIT 1`.

### 6. /checkin/morning → wizard → DB row

- Le matin (heure locale), `/checkin/morning` → wizard sleep/mood/
  intention → submit.
- **DB row** : `SELECT id FROM daily_checkins WHERE slot='morning'
 ORDER BY created_at DESC LIMIT 1`.

### 7. /dashboard → score widget render

- Retour `/dashboard` → score widget rendu avec **insufficient_data**
  (normal sans 30j d'historique).
- Pas de stack trace dans Sentry (le path "no data" doit être propre).

### 8. /library → 50 fiches Mark Douglas affichées

- `/library` → grid de fiches.
- Filtrer par catégorie → fonctionne.
- Cliquer 1 fiche → `/library/<slug>` → Hero + contenu rendu.

### 9. iPhone Safari → Add to Home Screen → push

> Ce step est l'**unique** validation real-device de J9 — exigée par
> SPEC §15 J9 + Apple Declarative Web Push (Safari 18.4+).

- Sur iPhone : Safari → `https://app.fxmily.com` → login compte test.
- Bouton Partage → "Sur l'écran d'accueil".
- Lancer Fxmily depuis l'icône Home (mode standalone iOS PWA).
- `/account/notifications` → toggle "Activer les notifications".
- Permission iOS → Autoriser.
- Côté serveur : déclencher manuellement
  ```bash
  curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
    https://app.fxmily.com/api/cron/dispatch-notifications
  ```
- iPhone lock screen → push reçu (titre + body cohérents avec la fiche
  Mark Douglas envoyée).

### 10. Email digest (J8 weekly report manuel)

- En attendant le dimanche 21:00 UTC : trigger manuel.
  ```bash
  curl -fsS -X POST -H "X-Cron-Secret: $CRON_SECRET" \
    "https://app.fxmily.com/api/cron/weekly-reports?dryRun=false"
  ```
- Inbox iCloud → email "Rapport hebdo · <member-label>" reçu.
- Vérifier la posture (pas de conseil de trade, exécution +
  psychologie uniquement).

### 11. /account/data → JSON download → integrity check

- Dans Fxmily prod : `/account/data` → liste des sections + counts.
- Cliquer "Télécharger l'export JSON".
- Le fichier `fxmily-data-<id>-2026-MM-DD.json` arrive dans Downloads.
- `jq '.user, .trades | length, .dailyCheckins | length' < ...json` →
  match les counts du dashboard.
- **Audit** : row `account.data.exported` dans `audit_logs`.

### 12. Sentry test → erreur arrive en dashboard

- Dans Sentry Dashboard → projet `fxmily-web` → "Issues" doit être vide.
- Trigger une erreur de test côté server (depuis ssh fxmily) :
  ```bash
  curl -X GET https://app.fxmily.com/api/cron/recompute-scores
  # → 405 method_not_allowed (pas une vraie erreur)
  curl -X POST -H "X-Cron-Secret: bad" \
    https://app.fxmily.com/api/cron/recompute-scores
  # → 401 unauthorized (pas une vraie erreur — silence côté Sentry)
  ```
- Pour un vrai test : trigger une exception via une feature flag interne
  (V2). En V1, on accepte que le dashboard soit silencieux jusqu'à
  ce qu'une vraie erreur frappe — ce qui est l'objectif.

## Done ?

Si les 12 boîtes sont cochées :

- ✅ SPEC §15 J10 "Done quand" satisfait.
- Mettre `apps/web/CLAUDE.md` à jour avec la section "J10 — close-out".
- Annoncer dans `MEMORY.md` (memory project) que V1 est ship.
- Décider V2 : Capacitor ? Stripe billing ? Multi-admin ? — cf.
  `docs/jalon-10-prep.md` §11 (non-scope V1).

## Rollback (si l'un des 12 cassent)

Si bug bloquant, le `deploy.yml` du job `ssh-deploy` peut redéployer
l'image SHA précédente :

```bash
# Sur Hetzner
ssh fxmily@<IP>
cd /opt/fxmily
# Identifier le SHA précédent dans `docker images`
docker images ghcr.io/fxeliott/fxmily --format "{{.Tag}}\t{{.CreatedSince}}"
# Roll back
export FXMILY_IMAGE=ghcr.io/fxeliott/fxmily:<previous-sha>
docker compose -f docker-compose.prod.yml up -d web
```

Ou via GitHub Actions : `workflow_dispatch` sur `deploy.yml` après avoir
revert le commit fautif sur `main`.
