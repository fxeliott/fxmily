# /verification-batch — S3 vision MT5 (5ᵉ pipeline batch local)

Lance l'analyse vision des preuves MT5 en attente (`ocrStatus=pending`) :
extraction des positions + détection des comptes, via `claude --print` local
(abonnement Max, $0 marginal), carbon des 4 autres batchs.

## Pré-flight (obligatoire avant de lancer)

1. Vérifie le token : `[[ ${#FXMILY_VERIFICATION_ADMIN_BATCH_TOKEN} -ge 32 ]] && echo OK`
   - S'il manque : demander à Eliot de l'exporter (il matche
     `VERIFICATION_ADMIN_BATCH_TOKEN` dans `/etc/fxmily/web.env` sur Hetzner).
2. `claude --version` (binaire officiel présent) et `jq --version`.
3. Annonce le nombre de preuves en attente via un dry-run :
   `bash ops/scripts/verification-batch-local.sh --dry-run`
4. Attends la confirmation d'Eliot avant le run réel (human-in-the-loop,
   mitigation ban-risk §5.4 — JAMAIS de cron sur ce script).

## Run

```bash
bash ops/scripts/verification-batch-local.sh
```

Options : `--max-proofs N` (cohorte partielle) · `--skip-sleep` (tests
UNIQUEMENT — le jitter 60-120s est la mitigation ban-risk) · `--dry-run`.

## Ce que fait le pipeline

1. **Pull** : métadonnées des preuves pending (PAS les images).
2. **Par preuve** : download de l'image (GET token-gated) → `claude --print
--allowedTools Read` lit le PNG local → JSON strict (compte + positions).
3. **Persist** : gates serveur (active-user → ownership → Zod strict →
   crisis → AMF → pin modèle) → résolution du compte par login MT5 (dédup
   « combien de comptes ») → insert des positions (dédup ticket/heuristique)
   → preuve `done` → `User.detectedAccountCount` rafraîchi.

`{"error":"not_mt5_history"}` (image hors-sujet) → la preuve passe `failed`
(le membre voit « Lecture impossible »). Une erreur claude/parse laisse la
preuve `pending` (re-tentée au run suivant).

## Validation post-run

- Le summary `{persisted, skipped, errors, total}` doit avoir `errors: 0`.
- Chaque preuve persistée émet un audit `verification.proof.analyzed`
  (PII-free : counts + ids + confidence + modèle).
- En cas de `skipped` inattendu : `verification.batch.skipped` porte la
  raison canonique dans l'audit log.
