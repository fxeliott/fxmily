#!/usr/bin/env bash
# Phase T (2026-05-09) — Rotate admin password en prod sans saisie
# manuelle DB. Hash via argon2id côté serveur dans un container temporaire.
#
# Le mot de passe est lu depuis STDIN (echo -n "..." | bash ops/...) ou
# depuis un secure-prompt (read -s) si TTY interactif.
#
# Usage :
#   echo -n "MonNouveauMdpFort12+" | bash ops/scripts/rotate-admin-password.sh \
#     fxmily@hetzner-dieu eliot@fxmilyapp.com
#
#   ou (interactive) :
#   bash ops/scripts/rotate-admin-password.sh fxmily@hetzner-dieu eliot@fxmilyapp.com
#
# Le mot de passe NE doit JAMAIS apparaître en argv (ps aux le révèle).

set -euo pipefail

readonly TARGET="${1:-}"
readonly ADMIN_EMAIL="${2:-}"

usage() {
  cat <<EOF
usage: $(basename "$0") <user@host> <admin-email>

  Rotate l'admin password en prod via SSH + docker exec.
  Le password est lu depuis STDIN (pipe) ou prompt interactif (read -s).
  Argon2id (memoryCost: 19456, timeCost: 2, parallelism: 1) — paramètres
  alignés avec lib/auth/password.ts (OWASP 2024).

  Audit row 'admin.password.rotated' émise après l'UPDATE.

  Pré-requis : SSH access fxmily@host + docker compose stack up à
  /opt/fxmily/docker-compose.prod.yml.
EOF
  exit 2
}

[[ -z "$TARGET" || -z "$ADMIN_EMAIL" || "$1" == "-h" || "$1" == "--help" ]] && usage

# Lire le password
if [[ -t 0 ]]; then
  read -r -s -p "Nouveau password admin (≥12 chars, jamais montré) : " NEW_PWD
  echo ""
  read -r -s -p "Confirmer : " NEW_PWD2
  echo ""
  [[ "$NEW_PWD" != "$NEW_PWD2" ]] && { echo "✗ Confirmation différente." >&2; exit 1; }
else
  NEW_PWD="$(cat)"
fi

# Validation locale
[[ ${#NEW_PWD} -lt 12 ]] && { echo "✗ Password < 12 chars (refused)." >&2; exit 1; }
case "${NEW_PWD,,}" in
  password|password1|123456789012|qwertyuiop12|azertyuiop12|fxmilyfxmily)
    echo "✗ Password dans la denylist commune." >&2; exit 1
    ;;
esac

echo ""
echo "→ Hashing password via argon2 dans un container Node sur $TARGET..."
HASH="$(ssh "$TARGET" bash -s <<'__SSH__' 2>/dev/null
read NEW_PWD
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T web \
  node -e "
const argon2 = require('@node-rs/argon2');
process.stdin.once('data', (b) => {
  const pwd = b.toString().replace(/\\n$/, '');
  console.log(argon2.hashSync(pwd, {
    memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2,
  }));
});
" <<< "$NEW_PWD"
__SSH__
)"

if [[ -z "$HASH" || ! "$HASH" =~ ^\$argon2id\$ ]]; then
  echo "✗ Hash failed (résultat invalide)." >&2
  exit 1
fi

echo "  ✓ Hash généré (argon2id, ${#HASH} chars)"

# Update DB
echo ""
echo "→ UPDATE users SET passwordHash=… WHERE email=$ADMIN_EMAIL"
SQL_RESULT="$(ssh "$TARGET" bash -s <<__SSH__ 2>&1
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \\
  psql -U fxmily -d fxmily -tA -c "
    UPDATE users
       SET password_hash = '$HASH',
           updated_at = NOW()
     WHERE email = '$ADMIN_EMAIL'
       AND role = 'admin'
    RETURNING id;
  "
__SSH__
)"

if [[ -z "$SQL_RESULT" || "$SQL_RESULT" == *"ERROR"* ]]; then
  echo "✗ UPDATE failed → $SQL_RESULT" >&2
  exit 1
fi

echo "  ✓ Password updated for user $SQL_RESULT"

# Audit
echo ""
echo "→ Inserting audit row 'admin.password.rotated'..."
ssh "$TARGET" bash -s >/dev/null 2>&1 <<__SSH__
docker compose -f /opt/fxmily/docker-compose.prod.yml exec -T postgres \\
  psql -U fxmily -d fxmily -c "
    INSERT INTO audit_logs (id, user_id, action, metadata, created_at)
    SELECT gen_random_uuid(), id, 'admin.password.rotated',
           jsonb_build_object('rotatedBy', 'rotate-admin-password.sh', 'ranAt', NOW()::text),
           NOW()
    FROM users WHERE email = '$ADMIN_EMAIL' AND role = 'admin';
  "
__SSH__

echo "  ✓ Audit logged"

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Admin password rotated for $ADMIN_EMAIL"
echo "═══════════════════════════════════════════"
echo ""
echo "→ Test : login sur https://app.fxmilyapp.com avec le nouveau password."
echo "→ Si tu utilises un password manager, mets-le à jour MAINTENANT."
echo ""
echo "  Le nouveau hash n'apparaît dans aucun log côté script ; il est"
echo "  uniquement dans la DB. Le password en clair n'a jamais été stocké."
