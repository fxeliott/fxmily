#!/usr/bin/env bash
# 2026-08-04 — Bases Postgres jetables (repro de bug, vérification, shadow).
#
# POURQUOI CE SCRIPT EXISTE
#   Chaque session qui reproduisait un bug créait sa base à la main
#   (fxmily_j8_e2e, fxmily_shadow_ar, fxmily_repro_strictmode, …) et ne la
#   nettoyait jamais : 15 bases orphelines / 155 Mo au 2026-08-04, sans qu'aucune
#   ne soit référencée nulle part. Le problème n'était pas la place occupée
#   (le volume Docker vit sur D:, où il reste des téraoctets) mais l'ambiguïté :
#   plus personne ne savait laquelle était vivante.
#
# LA CONVENTION
#   Toute base jetable s'appelle `fxmily_tmp_<slug>`. Rien d'autre.
#   À partir de là le nettoyage devient un geste, pas une enquête.
#
# SÛRETÉ
#   Le chemin destructeur n'accepte QUE des noms qui matchent
#   ^fxmily_tmp_[a-z0-9_]+$ — la base de dev `fxmily` ne peut pas être
#   sélectionnée, même en forçant. `drop` est en dry-run par défaut :
#   il faut `--yes` pour qu'une suppression ait réellement lieu.
#
# Usage :
#   bash ops/scripts/db-tmp.sh list
#   bash ops/scripts/db-tmp.sh doctor
#   bash ops/scripts/db-tmp.sh create <slug>
#   bash ops/scripts/db-tmp.sh drop <slug>            # dry-run
#   bash ops/scripts/db-tmp.sh drop <slug> --yes      # exécute
#   bash ops/scripts/db-tmp.sh drop --all --yes

set -euo pipefail

readonly CONTAINER="${FXMILY_PG_CONTAINER:-fxmily-postgres-dev}"
readonly PG_USER="${FXMILY_PG_USER:-fxmily}"
readonly MAIN_DB="fxmily"
readonly TMP_PREFIX="fxmily_tmp_"
readonly TMP_RE="^fxmily_tmp_[a-z0-9_]+$"

usage() {
  cat <<EOF
usage: $(basename "$0") <commande>

  list                    liste les bases ${TMP_PREFIX}* avec leur taille
  doctor                  signale les bases hors convention (ni ${MAIN_DB}, ni ${TMP_PREFIX}*)
  create <slug>           crée ${TMP_PREFIX}<slug> et affiche la marche à suivre
  drop <slug> [--yes]     supprime ${TMP_PREFIX}<slug>   (sans --yes : dry-run)
  drop --all [--yes]      supprime toutes les ${TMP_PREFIX}*  (sans --yes : dry-run)

  Variables : FXMILY_PG_CONTAINER (défaut ${CONTAINER}), FXMILY_PG_USER (défaut ${PG_USER}).

  La base de dev « ${MAIN_DB} » ne peut jamais être ciblée : le nom doit matcher
  ${TMP_RE}.
EOF
  exit 2
}

die() { echo "error: $*" >&2; exit 1; }

require_container() {
  command -v docker >/dev/null || die "docker introuvable"
  # Comparaison exacte sur la liste des noms plutôt que `--filter name=…` :
  # la syntaxe d'ancrage a changé entre versions de Docker (`^/nom$` ne matche
  # plus rien en 29.x, où le préfixe `/` a disparu), et un filtre non ancré
  # matcherait un conteneur dont le nom ne fait que CONTENIR le nôtre.
  docker ps --format '{{.Names}}' | grep -qx "$CONTAINER" \
    || die "conteneur '$CONTAINER' non démarré (docker compose -f docker-compose.dev.yml up -d)"
}

# Pas de `-i` : `docker exec -i` lit stdin, et un appel placé dans un
# `while read` en aspire l'entrée — la boucle s'arrête alors après un seul
# tour (bug observé : `doctor` ne listait qu'une base sur quinze).
psql_() { docker exec "$CONTAINER" psql -U "$PG_USER" -d postgres -tAc "$1"; }

# Garde-fou central : refuse tout nom qui n'est pas une base jetable.
assert_tmp_name() {
  local db="$1"
  [[ "$db" == "$MAIN_DB" ]] && die "refus : '$db' est la base de dev, jamais supprimable par ce script"
  [[ "$db" =~ $TMP_RE ]] || die "refus : '$db' ne matche pas $TMP_RE"
}

list_tmp_dbs() {
  psql_ "SELECT datname FROM pg_database WHERE datname LIKE '${TMP_PREFIX}%' ORDER BY datname;"
}

# Nom et taille sont ramenés par UNE requête : une boucle qui interrogeait
# Postgres à chaque tour était à la fois lente et fragile (cf. psql_).
cmd_list() {
  require_container
  local rows
  rows=$(psql_ "SELECT '  ' || rpad(datname::text, 34) || pg_size_pretty(pg_database_size(datname))
                FROM pg_database WHERE datname LIKE '${TMP_PREFIX}%' ORDER BY datname;")
  if [ -z "$rows" ]; then echo "  (aucune base ${TMP_PREFIX}*)"; else echo "$rows"; fi
  return 0
}

# Détecteur d'accumulation : toute base projet qui n'est ni la base de dev,
# ni une base jetable conforme, est signalée. C'est ce qui empêche la dérive
# de recommencer en silence.
cmd_doctor() {
  require_container
  local off
  off=$(psql_ "SELECT '    ' || rpad(datname::text, 34) || pg_size_pretty(pg_database_size(datname))
               FROM pg_database
               WHERE datname NOT IN ('postgres','template0','template1','${MAIN_DB}')
                 AND datname NOT LIKE '${TMP_PREFIX}%'
               ORDER BY datname;")
  if [ -z "$off" ]; then
    echo "  OK — aucune base hors convention."
    return 0
  fi
  echo "  Bases HORS CONVENTION (à renommer en ${TMP_PREFIX}* ou à supprimer) :"
  echo "$off"
  echo
  echo "  Ces bases ont été créées hors convention : ce script ne peut pas les"
  echo "  supprimer (par construction). Traite-les à la main, une fois."
  return 1
}

cmd_create() {
  local slug="${1:-}"
  [ -z "$slug" ] && usage
  local db="${TMP_PREFIX}${slug}"
  assert_tmp_name "$db"
  require_container

  if [ -n "$(psql_ "SELECT 1 FROM pg_database WHERE datname='$db';")" ]; then
    echo "  '$db' existe déjà."
  else
    psql_ "CREATE DATABASE \"$db\";" >/dev/null
    echo "  '$db' créée."
  fi

  cat <<EOF

  Pour la peupler (reprend les identifiants de ton .env, ne les recopie nulle part) :

    cd apps/web
    DATABASE_URL="\$(sed -n 's/^DATABASE_URL=//p' .env | sed 's|/[^/?]*\(?.*\)\?$|/$db\1|')" \\
      pnpm exec prisma migrate deploy

  Puis, quand tu as fini :

    bash ops/scripts/db-tmp.sh drop $slug --yes
EOF
}

cmd_drop() {
  local target="${1:-}" confirm="${2:-}"
  [ -z "$target" ] && usage
  require_container

  local dbs=()
  if [ "$target" = "--all" ]; then
    while read -r db; do [ -n "$db" ] && dbs+=("$db"); done < <(list_tmp_dbs)
  else
    dbs=("${TMP_PREFIX}${target#"$TMP_PREFIX"}")
  fi

  if [ "${#dbs[@]}" -eq 0 ]; then
    echo "  (aucune base ${TMP_PREFIX}* à supprimer)"
    return 0
  fi

  # Le garde s'applique à CHAQUE nom, y compris ceux venus de --all.
  for db in "${dbs[@]}"; do assert_tmp_name "$db"; done

  if [ "$confirm" != "--yes" ]; then
    echo "  DRY-RUN — seraient supprimées (${#dbs[@]}) :"
    for db in "${dbs[@]}"; do
      printf '    %-34s %s\n' "$db" "$(psql_ "SELECT COALESCE(pg_size_pretty(pg_database_size('$db')),'absente');" 2>/dev/null || echo 'absente')"
    done
    echo "  Relance avec --yes pour exécuter."
    return 0
  fi

  for db in "${dbs[@]}"; do
    psql_ "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);" >/dev/null
    echo "  supprimée : $db"
  done
}

main() {
  case "${1:-}" in
    list)   shift; cmd_list "$@" ;;
    doctor) shift; cmd_doctor "$@" ;;
    create) shift; cmd_create "$@" ;;
    drop)   shift; cmd_drop "$@" ;;
    -h | --help | "") usage ;;
    *) die "commande inconnue : $1" ;;
  esac
}

main "$@"
