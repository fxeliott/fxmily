# Eliot — pré-requis manuels J10

Deux paths au choix selon ta tolérance coût :

| Path              | Coût                            | Où                  | Quand choisir                                            |
| ----------------- | ------------------------------- | ------------------- | -------------------------------------------------------- |
| **A — Hetzner**   | ~5-15 €/mois + ~10 €/an domaine | `app.fxmilyapp.com` | Si tu acceptes ~70 €/an documenté SPEC §16 + budget caps |
| **B — Zero-cost** | **0 € / 0 CB**                  | `fxmily.vercel.app` | Si "pas de coût supplémentaire" strict (Phase N pivot)   |

Les deux paths livrent le même code Fxmily V1 SPEC §15 J10. Seule la
config infra diffère. Migration A↔B reste possible (export/import DB

- switch DNS).

* **Path A** : continue ci-dessous (Phase M scripts).
* **Path B** : voir [`docs/zero-cost-deployment.md`](../../docs/zero-cost-deployment.md).

Phase M (2026-05-09) a réduit le manuel de **30 → 10 min** via les scripts
`bootstrap-fxmily.sh` + `cloudflare-dns-setup.sh` + `resend-domain-add.sh`

- `pose-github-secrets.sh` qui automatisent toute la partie API.

> ⚠️ **Budget caps avant tout** (Path A uniquement) : configure les
> budget alerts AVANT d'enregistrer une carte bancaire — incident Gemini
> avril 2026 (95 € abusés via key leak, memory `contraintes_financieres`).
> Path B (Vercel/Neon free) = aucun engagement CB, donc pas de risque
> overage par construction.

---

## Manuel incompressible (~10 min total)

### 1. Cloudflare — Achat `fxmilyapp.com` (~10 €/an, 3 min)

> ⚠️ Cloudflare Registrar **n'a pas d'API publique pour l'achat de domaine**.
> Cette étape reste manuelle.

1. Account Cloudflare créé + CB enregistrée → **Account → Billing → Budget alert ≤ 30 €/mois**
2. Dashboard → **Registrar** → search `fxmilyapp.com` → buy → **auto-renew ON**
3. Profile → **API Tokens** → Create Token → "Edit zone DNS" template,
   scope = `fxmilyapp.com` Zone → note la valeur

### 2. Hetzner Cloud — Compte + token + SSH key (~3 min)

1. <https://accounts.hetzner.com/signUp> → ajoute CB
2. **Project → Settings → Billing → Spending alert ≤ 20 €/mois**
   (CX22 = ~5 €/mois, large marge)
3. Project → Security → **API Tokens** → "Read & Write" → note la valeur
4. Project → Security → **SSH Keys** → upload `~/.ssh/id_ed25519.pub` (name=`eliot-laptop`)

### 3. Sentry — Projet Next.js (~2 min, pas de CB requise)

1. <https://sentry.io/signup/> (free tier 5000 events/mo)
2. Settings → **Spend Caps → ON** (hard cap free tier)
3. Create Project → platform `Next.js` → name `fxmily-web`
4. Note le **DSN** (`https://<key>@<orgid>.ingest.<region>.sentry.io/<projectid>`)
5. Settings → **Auth Tokens** → Create → scopes `project:write` + `project:releases` → note la valeur

### 4. Resend — Compte + API key (~1 min, pas de CB requise)

1. <https://resend.com/signup> (free tier 3000 emails/mo)
2. Dashboard → **API Keys** → Create → permissions `domains:write` + `emails:send` → note la valeur

### 5. iPhone Safari 18.4+ (~1 min)

Mets à jour iOS sur ton iPhone (Settings → General → Software Update).
Sera utilisé Phase F step 9 pour valider le push real-device.

---

## Automation — TOUT le reste via `bootstrap-fxmily.sh` (~5 min)

```bash
# 1. Crée le fichier tokens.local.env (gitignored par défaut)
cp ops/scripts/tokens.local.env.example tokens.local.env
$EDITOR tokens.local.env  # remplis les 7 valeurs notées ci-dessus
chmod 600 tokens.local.env

# 2. Authentifie GitHub CLI (si pas déjà fait)
gh auth login

# 3. Lance le mega-script (avec confirmation budget caps)
bash ops/scripts/bootstrap-fxmily.sh tokens.local.env

# Le script enchaîne :
#   - Step 1 : provision-hetzner.sh (idempotent, demande confirmation avant `hcloud server create`)
#   - Step 2 : resend-domain-add.sh fxmilyapp.com (add domain + fetch DKIM)
#   - Step 3 : cloudflare-dns-setup.sh fxmilyapp.com (5 records via API)
#   - Step 4 : pose-github-secrets.sh (5 secrets + 2 variables via gh CLI)
#   - Step 5 : prints next-step instructions

# 4. Setup le host Hetzner (~5 min)
scp ops/scripts/setup-host.sh root@<IP>:/root/
ssh root@<IP> 'bash /root/setup-host.sh'

# 5. Wait ~24h DNS propagation, puis :
bash ops/scripts/verify-dns.sh fxmilyapp.com app.fxmilyapp.com
RESEND_API_KEY=$(grep RESEND_API_KEY tokens.local.env | cut -d= -f2-) \
  bash ops/scripts/resend-domain-add.sh fxmilyapp.com --verify-only

# 6. Trigger le 1er deploy
gh workflow run deploy.yml -R fxeliott/fxmily

# 7. Smoke automatisé (8/12 checks)
APP_URL=https://app.fxmilyapp.com \
  CRON_SECRET=$(grep CRON_SECRET tokens.local.env | cut -d= -f2-) \
  bash ops/scripts/post-deploy-smoke.sh

# 8. Smoke manuel (4 steps restants — UI + iPhone)
# Voir docs/runbook-prod-smoke-test.md §9-12

# 9. Cleanup
shred -u tokens.local.env
```

---

## Sécurité

- **Tokens jamais loggés** : tous les scripts utilisent `curl -H "Authorization: Bearer …" --silent --show-error`. Pas de `set -x` activé. Aucun `echo $TOKEN` nulle part.
- **Mode 0600 enforced** : `bootstrap-fxmily.sh` refuse de runner si `tokens.local.env` est world-readable (mode > 0644).
- **`.gitignore`** : `tokens.local.env` + `*.local.env` exclus globalement (cf. ligne 18-21 de `.gitignore`).
- **Budget caps obligatoires** : `bootstrap-fxmily.sh` demande confirmation explicite des 4 caps avant la première action engageant la CB.
- **Repo privé** : tout vit dans `fxeliott/fxmily` privé. PR #35 non-public.

## Coûts attendus V1 (cf. SPEC §16)

| Service                                          | Coût                   |
| ------------------------------------------------ | ---------------------- |
| Hetzner CX22                                     | ~5 €/mois              |
| Cloudflare R2 (10 Go free)                       | 0 €/mois               |
| Resend (3000 emails free)                        | 0 €/mois               |
| Sentry (5000 events free)                        | 0 €/mois               |
| Cloudflare Registrar                             | ~10 €/an               |
| Anthropic Claude API (rapports hebdo, optionnel) | ~5-10 €/mois si activé |
| **Total V1**                                     | **~5-15 €/mois**       |

Avec les budget caps à 20 € (Hetzner) + 30 € (Cloudflare) + 0 € (Sentry/Resend hard cap free) → **plafond max ~50 €/mois absolu**, marge x3 sur le coût attendu.

---

## Récap : ~10 min manuel + ~5 min de script

L'effort manuel d'Eliot est volontairement réduit au strict incompressible :

- 4 inscriptions de comptes (Cloudflare, Hetzner, Sentry, Resend) → ne peut pas être scripté (formulaires web + email validation)
- Achat domaine Cloudflare → pas d'API publique
- iOS update → device physique

Tout le reste (DNS, domain verify, GitHub secrets, provisioning, deploy) est
chaîné dans `bootstrap-fxmily.sh`.
