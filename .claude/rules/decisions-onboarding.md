---
paths:
  - 'apps/web/src/app/onboarding/**'
  - 'apps/web/src/components/onboarding/**'
  - 'apps/web/src/lib/onboarding/**'
---

# Decisions verrouillees — onboarding

Extrait de `apps/web/CLAUDE.md` le 2026-08-04. Ces decisions sont OPPOSABLES :
ce sont des landmines anti-regression, pas de l historique. Le frontmatter
`paths:` ci-dessus les charge uniquement quand on touche les fichiers concernes
— sans lui, elles seraient chargees a chaque lancement et la scission
n economiserait rien. Contexte complet du jalon : `docs/web/jalons-history.md`.

## V2.4 Phase B — Wizard frontend onboarding interview membre (livré 2026-05-28, PR [#191](https://github.com/fxeliott/fxmily/pull/191) `35c7321`)

### Décisions verrouillées Round 3 audit hardcore (NON-litigable)

1. **DS-v2 lime neutre** (PAS V18 REFLECT blue+black)
2. **SPA single-URL `/onboarding/interview/new`** state interne (carbone V1.5 mindset)
3. **Progress segmentée par phase** + estimation JS-mesurée + mobile 9 min cap STRICT
4. **localStorage per-question + prompt explicite resume**
5. **Crisis routing PERSIST QUAND MÊME** Q4=A V1.8 carbone + banner FR
6. **Injection warning persist anyway** + audit + Sentry warning calme
7. **`/profile` standalone première classe**
8. **EU AI Act 50(1) bannière inline** `/profile`

## V2.4 — Onboarding safety hardening (livré 2026-05-29, PR [#198](https://github.com/fxeliott/fxmily/pull/198) `3a8e071`)

### Décisions verrouillées (NE PAS re-casser)

- **Le bloc distress NE crée PAS de gap crise** (verdict security-auditor) : la **Couche A input-side** (`service.ts:199` `detectCrisis(input.answerText)`) est INDÉPENDANTE et INTOUCHÉE — elle fire sur le texte brut membre AVANT Claude, déclenche bannière FR (3114/SOS Amitié/Suicide Écoute) + escalade admin. C'est elle qui protège le membre. La Couche B output-side (gate 4) devient best-effort mais n'a jamais été la couche primaire. **NE JAMAIS supposer que le bloc distress couvre la détection de crise — c'est la couche input qui sauve.**
- **`canonicalizeBatchErrorCategory()` = frontière PII §16** : le champ `error` est fourni par le laptop (non fiable, cf. Gate 1-2 forged-userId). Sa valeur brute reste dans l'audit INTERNE Postgres ; seule la catégorie bornée (`claude_exit` / `invalid_json_response` / `unknown`) part vers Sentry (sink EXTERNE). **NE PAS re-propager `entry.error` brut vers `reportWarning`.**
- **Over-refusal Opus 4.8 NON vérifié** : les chiffres `0,36%/0,31%/0,40%` (« Table 4.1.2.A ») d'anciennes notes **n'ont PAS pu être vérifiés** (system card = PDF 244p > limite fetch 10MB). NON inscrits dans l'ADR (calibrated refusal). Posture monitor-at-dry-run maintenue. **Ne PAS les re-traiter comme fait acquis.**
- **Prompt servi par prod via `/pull`** → un changement de `ONBOARDING_INTERVIEW_SYSTEM_PROMPT` ne prend effet sur le batch réel qu'après deploy prod.
