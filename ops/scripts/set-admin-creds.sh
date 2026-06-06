#!/usr/bin/env bash
# set-admin-creds.sh — pose email + mot de passe de l'unique admin en prod,
# EN UNE opération atomique.
#
# Remplace l'ancien rotate-admin-password.sh (RETIRÉ) qui était cassé :
# (1) son passage du mdp via heredoc SSH ne recevait rien (`read NEW_PWD`) ;
# (2) son hash `node -e` DANS le conteneur standalone échouait ("Cannot find
# module @node-rs/argon2" — deps natives tracées par Next non résolubles
# depuis un bare eval).
#
# Approche ici (robuste + plus sûre) :
#   - Le mot de passe est tapé en LOCAL (caché) et hashé en LOCAL via le
#     @node-rs/argon2 du repo (mêmes params qu'app `lib/auth/password.ts`).
#     => le mot de passe EN CLAIR ne quitte JAMAIS la machine. Jamais en argv.
#   - Seul le HASH part en prod, encodé base64 (le hash contient des `$` qui
#     casseraient le quoting shell ; base64 = transport neutre), reconstruit
#     côté Postgres par convert_from(decode(...,'base64'),'utf8').
#   - role='admin' (1 seul admin).
#
# host + email sont des ARGUMENTS REQUIS — aucun défaut hardcodé (repo PUBLIC :
# ne jamais committer d'alias SSH / d'email réel ici).
#
# Usage :
#   bash ops/scripts/set-admin-creds.sh <user@host> <admin-email>            (interactif, prompt caché)
#   echo -n "MdpFort12+" | bash ops/scripts/set-admin-creds.sh <user@host> <admin-email>   (piped)
#
# Le mot de passe NE doit JAMAIS apparaître en argv (ps aux le révèle).
set -euo pipefail

HOST="${1:-}"
NEW_EMAIL="${2:-}"
COMPOSE="/opt/fxmily/docker-compose.prod.yml"

usage() {
  cat <<EOF
usage: $(basename "$0") <user@host> <admin-email>

  Pose l'email + le mot de passe de l'unique admin (role='admin') en prod,
  en une opération atomique, via SSH + docker compose exec + psql.

  - Le mot de passe est lu depuis STDIN (pipe) ou un prompt caché (read -s),
    hashé en LOCAL (argon2id, memoryCost 19456 / timeCost 2 / parallelism 1,
    aligné lib/auth/password.ts OWASP 2024) — il ne quitte jamais la machine.
  - Seul le hash (base64) part en prod. role='admin' = 1 seul admin.

  Pré-requis : SSH access <user@host> + stack docker compose up à
  /opt/fxmily/docker-compose.prod.yml + 'pnpm install' dans le repo (argon2).
EOF
  exit 2
}

[[ -z "$HOST" || -z "$NEW_EMAIL" || "${1:-}" == "-h" || "${1:-}" == "--help" ]] && usage

# Validation email (defense-in-depth : empêche un argument malformé de casser
# le littéral SQL inline ci-dessous — l'opérateur est de confiance mais 0 typo).
[[ "$NEW_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || {
  echo "✗ Email invalide : '$NEW_EMAIL'" >&2; exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$(cd "$SCRIPT_DIR/../.." && pwd)/apps/web"
[[ -d "$WEB/node_modules/@node-rs/argon2" ]] || {
  echo "✗ @node-rs/argon2 introuvable dans $WEB/node_modules — lance d'abord 'pnpm install' dans le repo." >&2
  exit 1
}

# --- mot de passe (caché interactif, ou pipé) ---
if [[ -t 0 ]]; then
  read -rsp "Nouveau mot de passe admin (>=12 chars, jamais affiché) : " PW; echo ""
  read -rsp "Confirme : " PW2; echo ""
  [[ "$PW" != "$PW2" ]] && { echo "✗ Confirmation différente." >&2; exit 1; }
else
  PW="$(cat)"
fi
[[ ${#PW} -lt 12 ]] && { echo "✗ Mot de passe < 12 caractères (refusé)." >&2; exit 1; }

# --- hash LOCAL (argon2id), mdp via stdin (jamais argv/env) ---
HASH="$(printf '%s' "$PW" | ( cd "$WEB" && node -e 'const a=require("@node-rs/argon2");let d="";process.stdin.on("data",c=>{d+=c});process.stdin.on("end",()=>{process.stdout.write(a.hashSync(d.replace(/[\r\n]+$/,""),{memoryCost:19456,timeCost:2,parallelism:1,algorithm:2}))})' ) )"
unset PW PW2 2>/dev/null || true
[[ "$HASH" =~ ^\$argon2id\$ ]] || { echo "✗ Hash local invalide (obtenu: ${HASH:0:20}…)." >&2; exit 1; }
HB64="$(printf '%s' "$HASH" | base64 | tr -d '\n')"

# --- UPDATE prod : email + password_hash (décodé du base64) sur l'unique admin ---
# Littéraux SQL inline (PAS de psql -v / :'var' : l'interpolation ne survit pas
# au transport ssh+docker). Sûr : $HB64 = base64 (charset [A-Za-z0-9+/=], aucune
# quote simple) => impossible de casser le littéral SQL. $NEW_EMAIL est validé
# par le regex ci-dessus (pas de quote simple). role='admin' = 1 seul admin.
echo "→ UPDATE admin (email='$NEW_EMAIL') en prod via psql sur $HOST..."
SQL_UPDATE="UPDATE users SET email='$NEW_EMAIL', password_hash=convert_from(decode('$HB64','base64'),'utf8'), updated_at=NOW() WHERE role='admin' RETURNING id;"
RES="$(ssh "$HOST" "docker compose -f $COMPOSE exec -T postgres psql -U fxmily -d fxmily -tA -c \"$SQL_UPDATE\"" 2>&1)" || true

echo "RESULT: $RES"
if [[ -z "$RES" || "$RES" == *ERROR* ]]; then
  echo "✗ Échec — l'admin n'a PAS été modifié (voir ci-dessus)." >&2
  exit 1
fi

# --- audit row (best-effort, non bloquant) ---
ssh "$HOST" "docker compose -f $COMPOSE exec -T postgres psql -U fxmily -d fxmily -c \"INSERT INTO audit_logs (id, user_id, action, metadata, created_at) SELECT gen_random_uuid(), id, 'admin.credentials.updated', jsonb_build_object('by','set-admin-creds.sh','ranAt',NOW()::text), NOW() FROM users WHERE email='$NEW_EMAIL' AND role='admin';\"" >/dev/null 2>&1 || true

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Admin : email='$NEW_EMAIL' + mot de passe mis à jour (user id: $RES)"
echo "═══════════════════════════════════════════"
echo "→ Login : https://app.fxmilyapp.com/login  (email=$NEW_EMAIL)"
echo "→ Mets ton gestionnaire de mots de passe à jour MAINTENANT."
