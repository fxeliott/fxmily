# Eliot — pré-requis manuels J10 (étape par étape, ~30 min)

Ce guide regroupe les **7 actions manuelles** que je ne peux pas automatiser
pour toi (cartes bancaires, validations interactives, device physique).
Une fois fait, lance simplement `provision-hetzner.sh` puis `setup-host.sh`
et tout le reste est automatisé.

> ⚠️ **Budget caps avant tout** : configure des budget alerts AVANT
> d'enregistrer une carte bancaire sur les services payants ci-dessous.
> Cf. memory `contraintes_financieres` (incident Gemini avril 2026,
> 95 € abusés via key leak).

---

## 1. Cloudflare Registrar — Achat de `fxmily.com` (~10 €/an)

1. Connecte-toi sur <https://dash.cloudflare.com/?to=/:account/registrar>.
2. Onglet **Register** → search `fxmily.com`.
3. Si dispo, achète. Sinon teste les alternatives `fxmily.app`, `fxmily.fr`,
   `fxmily.io` (et reviens me dire — j'adapte les configs).
4. **Auto-renew ON** par défaut (laisser).
5. **Privacy proxy** automatique chez Cloudflare (bonus RGPD).

✅ Done quand : `fxmily.com` apparait dans ta liste de domaines Cloudflare.

## 2. Hetzner Cloud — Création projet + token (gratuit jusqu'au boot)

1. Inscription sur <https://accounts.hetzner.com/signUp> si pas déjà fait.
   Carte bancaire requise — **pas facturé tant qu'aucune ressource n'est
   créée**.
2. Dans Hetzner Cloud Console → **New Project** → nom `Fxmily`.
3. Project → Security → **API Tokens** → **Generate API Token** :
   - Permission: **Read & Write**.
   - Description: `cli-provisioning`.
   - **Copie la valeur immédiatement** (elle ne sera plus affichée).
4. Project → Security → **SSH Keys** → **Add SSH Key** :
   - Colle le contenu de `~/.ssh/id_ed25519.pub` (ou
     `%USERPROFILE%\.ssh\id_ed25519.pub` sur Windows).
   - Name: `eliot-laptop`.

✅ Done quand : tu as le token API + SSH key uploadée.

## 3. Sentry — Création du projet (gratuit Plan Free 5000 errors/mois)

1. Inscription sur <https://sentry.io/signup/> (free tier).
2. **Create Project** → platform `Next.js` → name `fxmily-web`.
3. Note le **DSN** (`https://<key>@<orgid>.ingest.<region>.sentry.io/<projectid>`).
4. Settings → **Auth Tokens** → **Create New Token** :
   - Scopes: `project:read`, `project:write`, `project:releases`.
   - Description: `fxmily-ci-source-maps`.
   - Note la valeur.

✅ Done quand : tu as DSN + auth token + org slug + project slug
(`fxmily` + `fxmily-web`).

## 4. Resend — Domain `fxmily.com` (gratuit Free tier 3000 emails/mois)

⚠️ Cette étape exige que `fxmily.com` soit acheté (étape 1).

1. <https://resend.com/domains> → **Add Domain** → `fxmily.com`.
2. Resend affiche **3 TXT records** à coller dans Cloudflare DNS :
   - SPF: `v=spf1 include:_spf.resend.com ~all`
   - DKIM: `resend._domainkey` → long valeur
   - DMARC: `_dmarc` → `v=DMARC1; p=quarantine; rua=mailto:eliot@fxmily.com`
3. Cloudflare Dashboard → `fxmily.com` → DNS → **Add record** pour les 3.
4. **Wait ~24 h** pour la propagation. Vérifie avec
   `bash ops/scripts/verify-dns.sh fxmily.com app.fxmily.com`.
5. Resend Console → bouton **Verify** quand tout passe vert.

✅ Done quand : Resend affiche `Verified` à côté de `fxmily.com`.

## 5. iPhone Safari 18.4+ — Préparé pour le push test

1. Mets à jour ton iPhone vers iOS 18.4 minimum (Settings → General → Software
   Update).
2. Aucune action en plus avant la Phase F étape 9 — tu utiliseras Safari
   classique pour Add-to-Home-Screen.

## 6. Mot de passe admin Fxmily rotaté

L'incident sec post-J8 polish (docs/jalon-9-prep.md) recommande de rotationner
le mdp admin **avant** la 1ère invitation prod.

```bash
# Sur ta machine, génère un mdp fort :
openssl rand -base64 24
# Copie-le, change le mdp admin Fxmily via /admin/profile une fois loggé.
```

## 7. GitHub Secrets — Pose les valeurs dans `fxeliott/fxmily`

<https://github.com/fxeliott/fxmily/settings/secrets/actions> → **New
repository secret** pour chacun :

| Name                | Value                                               |
| ------------------- | --------------------------------------------------- |
| `HETZNER_HOST`      | IPv4 publique du CX22 (étape 2 + provision-hetzner) |
| `HETZNER_SSH_KEY`   | Clé privée `~/.ssh/id_ed25519` content              |
| `SENTRY_AUTH_TOKEN` | Token de l'étape 3                                  |
| `SENTRY_ORG`        | Org slug Sentry (e.g. `fxmily`)                     |
| `SENTRY_PROJECT`    | Project slug (e.g. `fxmily-web`)                    |

⚠️ **Ne JAMAIS** colle ces valeurs dans une session Claude Code (cf. memory
`contraintes_financieres` + incident Resend key leak avril 2026).

✅ Done quand : 5 secrets visibles dans la liste GitHub.

**Automation (recommandé)** : au lieu de cliquer 5 fois dans l'UI GitHub,
utilise le script `ops/scripts/pose-github-secrets.sh` :

```bash
# Crée un fichier local protégé (NEVER committer)
cat > /tmp/secrets.local.env <<'EOF'
HETZNER_HOST="<IP-Hetzner>"
HETZNER_SSH_KEY="$(cat ~/.ssh/id_ed25519)"
SENTRY_AUTH_TOKEN="<token>"
SENTRY_ORG="fxmily"
SENTRY_PROJECT="fxmily-web"
APP_URL="https://app.fxmily.com"
CRON_SECRET="<même valeur que /etc/fxmily/web.env>"
EOF
chmod 600 /tmp/secrets.local.env

# Authentifie gh (si pas déjà fait)
gh auth login

# Lance l'automation
bash ops/scripts/pose-github-secrets.sh /tmp/secrets.local.env

# Détruis le fichier secrets après
shred -u /tmp/secrets.local.env
```

Le script vérifie que le fichier est en mode 0600/0400, valide
l'authentification gh, puis pose les 5 secrets + 1 variable
(`APP_URL`) en idempotent. Refuse de runner si gh non auth ou si
fichier monde-readable.

---

## Ensuite — automation prend le relais

```bash
# 1. Provisionner la VM Hetzner (idempotent)
export HCLOUD_TOKEN="<token étape 2>"
bash ops/scripts/provision-hetzner.sh
# → Note l'IP affichée à la fin.

# 2. Configure le host (run depuis ta machine, ssh transparent)
scp ops/scripts/setup-host.sh root@<IP>:/root/
ssh root@<IP> 'bash /root/setup-host.sh'

# 3. Cloudflare DNS — ajoute manuellement (Console) :
#    A app → <IP-Hetzner>  (Proxied=NO)

# 4. Vérifie les DNS Resend (peut prendre 24h)
bash ops/scripts/verify-dns.sh fxmily.com app.fxmily.com

# 5. Premier déploiement automatique
gh workflow run deploy.yml -R fxeliott/fxmily

# 6. Smoke automatisé
export APP_URL=https://app.fxmily.com
export CRON_SECRET=<de /etc/fxmily/web.env>
bash ops/scripts/post-deploy-smoke.sh

# 7. Smoke manuel (4 steps restants — voir runbook-prod-smoke-test.md §9-12)
```

---

## Récap : 7 actions × ~3-5 min = 30 min total

Toutes les autres tâches J10 (4-5 jours selon SPEC §15 estimation) sont
déjà livrées sur la branche `claude/j10-prod-deploy` (PR #35). Tu n'as
qu'à exécuter ces 7 étapes + lancer les 6 commandes ci-dessus.

🤖 Tout le code, ops, audit, hardening, tests, runbooks ont été générés
en autonomie totale par Claude Opus 4.7 (1M context) en mode pleine
puissance — l'effort manuel d'Eliot est volontairement réduit au minimum
incompressible (carte bancaire, validation Resend, device iPhone).
