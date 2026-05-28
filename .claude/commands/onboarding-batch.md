# /onboarding-batch

Trigger manuel du batch local Claude Max pour analyser les `OnboardingInterview` complétés et générer les `MemberProfile` correspondants (V2.4 Phase A.2, Session β M3 directive).

**Pattern carbone** : `/sunday-batch` V1.7.2 (weekly-report local batch).

## Pré-requis

1. **Working tree clean** sur la branche `main` (ou la branche feature Phase A.2).
2. **Env var `FXMILY_ADMIN_TOKEN`** exportée dans le shell — 32+ chars, doit matcher `ADMIN_BATCH_TOKEN` dans `/etc/fxmily/web.env` sur Hetzner :

   ```bash
   export FXMILY_ADMIN_TOKEN=$(ssh fxmily@hetzner-dieu "sudo cat /etc/fxmily/web.env" | grep '^ADMIN_BATCH_TOKEN=' | cut -d= -f2-)
   ```

3. **`claude --version`** retourne le CLI officiel Anthropic (PAS un wrapper tiers).
4. **`jq` + `curl`** installés (Git Bash sur Windows OK).

## Workflow (~30-45 min pour 30 membres)

### Étape 1 — Pre-flight check

Avant de lancer, vérifier l'état :

```bash
# Vérifier le token
echo "Token length: ${#FXMILY_ADMIN_TOKEN}"
test ${#FXMILY_ADMIN_TOKEN} -ge 32 || { echo "Token trop court"; exit 1; }

# Tester la connectivité + auth /pull
curl -sS -X POST \
  -H "X-Admin-Token: $FXMILY_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  https://app.fxmilyapp.com/api/admin/onboarding-batch/pull \
  | jq '.entries | length'
```

Si retour `0` → pas d'interviews à analyser, abandon clean.
Si retour `N > 0` → procéder.

### Étape 2 — Annonce le plan à Eliot

> "Je vais traiter N interviews complétés. Estimation ~N × 90s = M minutes. Lance ?"

Attendre confirmation explicite Eliot avant de lancer le script.

### Étape 3 — Lance le script en foreground

```bash
cd /d/Fxmily
bash ops/scripts/onboarding-batch-local.sh
```

Monitore l'output. Pour chaque membre :

- Sleep jittered 60-120s annoncé
- `claude --print` invoqué
- Response captured ou error logged

### Étape 4 — Validation post-run

Le script imprime un summary `{persisted, skipped, errors, total}`. Vérifier que :

- `persisted` ≈ `total` (idéalement 100%, accepter <5% errors)
- `skipped` = 0 (sinon investiguer raisons via `/admin/audit-log?action=onboarding.batch.*`)
- `errors` = 0 (sinon investiguer logs Claude + Sentry)

### Étape 5 — Smoke test admin

Aller sur `/admin/members/[id]?tab=profil` (Phase C future) pour vérifier que les `MemberProfile` rows ont été créés. Pour V1 backend-only : vérifier via Prisma Studio ou requête SQL :

```sql
SELECT m.user_id, m.summary, m.analyzed_at, m.claude_model_version
FROM member_profiles m
ORDER BY m.analyzed_at DESC
LIMIT 10;
```

## Options du script

```bash
# Dry-run (pull only, no claude, no persist) — smoke-test Phase B+ readiness
bash ops/scripts/onboarding-batch-local.sh --dry-run

# Test avec 1 seul membre
bash ops/scripts/onboarding-batch-local.sh --max-members 1

# Tests rapides sans jittered sleep (ATTENTION : ne pas en prod, ban-risk)
bash ops/scripts/onboarding-batch-local.sh --max-members 2 --skip-sleep
```

## Ban-risk mitigation (9 règles carbone V1.7)

Le script intègre par construction :

1. Eliot's machine (ton IP, ton fingerprint, ton Max account)
2. 60-120s RANDOM jittered sleeps (configurable via `RANDOM`)
3. One `claude --print` per membre = fresh context
4. Snapshots pseudonymisés V1.5.2 (server-side, label `member-XXXXXXXX`)
5. System prompt + JSON schema dans l'enveloppe ← repo (no on-device tamper)
6. Only official `claude` binary (pre-flight check `claude --version`)
7. Human-in-the-loop manual trigger (pas de cron schedule)
8. Server double-net validation (Zod strict + safety gate 6 layers)
9. Audit log `onboarding.batch.*` PII-free counts only

**NE PAS** :

- Lancer plusieurs runs parallèles
- Skipper les sleeps (`--skip-sleep` est pour tests UNIQUEMENT)
- Modifier le system prompt ou JSON schema localement (ils voyagent via l'enveloppe pour cette raison)
- Stocker `FXMILY_ADMIN_TOKEN` dans un fichier — uniquement export shell

## Failure modes & recovery

| Symptôme                    | Diagnostic                                    | Recovery                                                                  |
| --------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| `HTTP 401` pull/persist     | Token mismatch GitHub ↔ Hetzner               | `ssh fxmily@hetzner-dieu "sudo cat /etc/fxmily/web.env"                   | grep ADMIN_BATCH_TOKEN` puis re-export |
| `HTTP 503` persist          | `ADMIN_BATCH_TOKEN` non set sur prod          | SSH + ajouter à `/etc/fxmily/web.env` + restart web container             |
| `HTTP 429`                  | Rate-limit atteint (10 burst / 5 min)         | Attendre 5 min ou lancer ailleurs                                         |
| `claude_exit_N`             | Claude --print échec (network / quota Max)    | Re-run même cohort → idempotent côté serveur (pull filtre déjà-analyzed)  |
| `invalid_json_response`     | Claude a généré du texte non-JSON             | Inspecter `$WORK_DIR/response-$i.err` puis re-run                         |
| Persist `errors > 0`        | Bug Prisma upsert ou DB hiccup                | Inspecter Sentry `onboarding-interview.batch` scope                       |
| `crisis_detected` audit row | Claude a généré du contenu HIGH/MEDIUM crisis | Review manuel + appeler le membre (3114 + SOS Amitié + Suicide Écoute)    |
| `amf_violation` audit row   | Claude a généré du contenu AMF/CIF            | Inspecter la response brute + re-run (rare avec system prompt + few-shot) |
| `evidence_invalid`          | Claude a halluciné des citations              | Re-run — Claude doit citer verbatim les answerTexts                       |

## Audit slugs séquence

Le batch émet (PII-free) :

- `onboarding.batch.pulled` × 1 (envelope)
- `onboarding.batch.skipped` × N (errors entries / inactive user / interview mismatch / crisis / clinical)
- `onboarding.batch.invalid_output` × N (Zod fail)
- `onboarding.batch.crisis_detected` × N (HIGH/MEDIUM mirror V1.7.1)
- `onboarding.batch.amf_violation` × N (AMF regex post-gen)
- `onboarding.batch.evidence_invalid` × N (substring NFC fail)
- `onboarding.batch.persist_failed` × N (Prisma exception)
- `member_profile.analyzed` × N (success per-entry)
- `onboarding.batch.persisted` × 1 (summary)

Query Sentry tag `scope:onboarding-interview.batch.*` pour cross-référence.

## Quand utiliser ce slash command

- **Après une cohorte d'onboarding** : ~30 nouveaux membres ont complété leur entretien V2.4 → lance le batch pour générer leurs `MemberProfile`.
- **Re-run safe** : la pull filtre déjà-analyzed (`MemberProfile.interviewId` exists), donc re-lancer plusieurs fois est idempotent.
- **PAS** sur cron schedule. Manuel only — ban-risk mitigation rule #7.
