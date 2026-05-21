# Préparation — Jalon 2 (Journal de trading)

> **STATUT : LIVRÉ ✅** sur `main` local (2026-05-05) — non poussé sur origin.
> Voir la section [Close-out (2026-05-05)](#close-out-2026-05-05) pour le résumé.

## Critère "Done" du J2 (SPEC §15)

> Un membre peut créer un trade complet, voir la liste, ouvrir un trade et voir ses screens.

## Hand-off depuis le Jalon 1

Avant la session J2 (notes finales J1) :

1. ✅ J1 mergé sur `main` (PR #11 mergeCommit `98ac3e1`).
2. ✅ Bump deps appliqué (`5df2417`).
3. ✅ Liste des paires validée par Eliot : 12 paires (forex majeurs + métaux + indices US).
4. ⏳ Cloudflare R2 : **non créé** — Eliot a demandé de coder un stub local en attendant.

## Décisions produit prises pendant la session J2

> Tranchées par Claude en mode autonome après le go d'Eliot ("agis comme tu veux,
> j'ai confiance"). Validées contre SPEC.md + recherche web (TraderSync,
> TradeZella, Van Tharp, Mark Douglas, Edgewonk, BabyPips, MyFxBook).

| #   | Sujet                             | Décision                                                                                | Raison                                                                                                                                  |
| --- | --------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `stopLossPrice` au schéma `Trade` | **Ajouté** (optionnel, recommandé)                                                      | Sans SL, pas de R réalisé exact (sources : TraderSync, TradeZella, Tharp). Avec SL → `realizedR` exact, sinon fallback estimé.          |
| 2   | Source du `realizedR`             | Nouveau champ `realizedRSource` enum (`computed` / `estimated`)                         | Permet d'exclure les samples "estimés" des aggregats expectancy / R-distribution en J6.                                                 |
| 3   | Liste émotions                    | **15 tags FR** (slugs EN), 3 clusters                                                   | 4 peurs Mark Douglas + 8 états + 3 biais. Cap 3/moment, min 1 obligatoire.                                                              |
| 4   | Sessions auto-détectées           | UTC bands (00–07 asia, 07–12 london, 12–16 overlap, 16–21 newyork) + override           | DST géré via offsets ISO Date natifs. Pivot vers `@js-joda` au J6 si analytics réclame plus de précision.                               |
| 5   | Wizard step-count                 | **6 étapes** (pas 7)                                                                    | La sortie est sortie du wizard et vit sur `/journal/[id]/close`. Match l'usage réel ("j'ouvre, je reviens 2h après").                   |
| 6   | State management wizard           | `useState` pur + Framer Motion + localStorage                                           | RHF apporte du bloat pour ce flow ; on garde RHF en deps pour les forms riches futurs.                                                  |
| 7   | Storage abstraction               | `StorageAdapter` interface + 2 impls (local + R2 stub)                                  | API agnostique du backend ; switch en 1 ligne quand R2 keys arrivent.                                                                   |
| 8   | API d'upload                      | **Direct upload via Server-side proxy** (POST `/api/uploads`) plutôt que presigned URLs | Auth + magic-byte + size cap centralisés ; V1 scale (~30 membres) tient sans optim ; presigned URLs ajoutables sans casser l'interface. |
| 9   | AWS SDK                           | **Pas installé en J2**                                                                  | Bloat évité tant que le R2 stub throw. Install + R2 wiring en commit dédié quand keys disponibles.                                      |

## Close-out (2026-05-05)

### Critère "Done" du J2 — non testé en live

**Pas de smoke test live** : le sandbox Claude n'a pas Docker (CLI hors PATH),
donc impossible de démarrer Postgres + dev server pour valider le flow complet
avec une session authentifiée.

Vérifications **statiques** effectuées :

- `pnpm format:check` ✅
- `pnpm --filter @fxmily/web lint` ✅ 0 erreur, 0 warning
- `pnpm --filter @fxmily/web type-check` ✅
- `pnpm --filter @fxmily/web test` ✅ **167 tests verts** (vs 38 fin J1)
- `pnpm --filter @fxmily/web build` ✅ (avec env placeholders prod-style)
- `pnpm audit` ✅ aucune vulnérabilité (prod et all)
- `prisma generate` ✅ — `Trade` + 4 enums présents dans le client typed

**À faire côté Eliot** avant push :

1. `docker compose -f D:/Fxmily/docker-compose.dev.yml up -d`
2. `pnpm --filter @fxmily/web prisma:migrate` (applique `20260505160000_j2_trade`)
3. `pnpm dev` → login admin → `/journal/new` → wizard 6 étapes → upload → `/journal/[id]` → "Clôturer maintenant"
4. Vérifier que `apps/web/.uploads/trades/<userId>/<id>.<ext>` est bien créé.
5. Si OK, `git push origin main`.

### Livrables effectifs (6 commits sur `main`)

```
47e0a07 refactor(j2): apply remaining audit findings (UI / a11y / docs)
6913776 test(j2): add Playwright auth-gate tests + scoped ESLint rule + docs
592836a feat(j2): add wizard UI + journal pages + dashboard CTA
0f6532d feat(j2): add trade service + journal Server Actions
a3e4adc feat(j2): add storage abstraction + upload routes (POST + GET stream)
fb8a73d feat(j2): add Trade data model + trading constants + R-multiple calc
```

42+ fichiers · +5300 lignes.

#### Modèle de données

- Migration `20260505160000_j2_trade` — table `trades` + 4 enums Postgres
  (`TradeDirection`, `TradeSession`, `TradeOutcome`, `RealizedRSource`).
- 3 indexes user-scoped composites (`enteredAt DESC`, `createdAt DESC`,
  `closedAt`) couvrant les 3 queries dominantes (liste chrono, liste
  filtrable, group by status).
- `Trade.notes` est append-only au close (`mergeNotes` extrait dans
  `lib/trades/notes.ts` + 8 tests unit).

#### Constantes & calculs purs (147 tests unit)

- `lib/trading/pairs.ts` — 12 paires + helpers (`isTradingPair`,
  `assetClassOf`, `pricePrecisionOf`).
- `lib/trading/emotions.ts` — 15 tags + clusters + helpers + `EMOTION_MAX_PER_MOMENT`.
- `lib/trading/sessions.ts` — `detectSession()` UTC-hour based, fallback overlap.
- `lib/trading/calculations.ts` — `computeRealizedR()` canonical Van Tharp
  formula avec branches `computed` / `estimated`, clamping `Decimal(6,2)`.
- `lib/schemas/trade.ts` — `tradeOpenSchema`, `tradeCloseSchema`,
  `tradeFullSchema` partagés client / serveur. Re-evaluated date refines
  (pas de `Date.now()` figé au boot).

#### Storage abstraction

- `lib/storage/types.ts` — interface `StorageAdapter`, `ALLOWED_IMAGE_MIME_TYPES`,
  `MAX_SCREENSHOT_BYTES = 8 MiB`, `StorageError` taxonomy.
- `lib/storage/keys.ts` — `generateTradeKey()`, `parseTradeKey()`,
  `sniffImageMime()` inline (JPEG/PNG/WebP). Regex bornée
  `[a-z0-9]{8,40}/[a-zA-Z0-9_-]{12,40}\.(jpg|png|webp)` (ReDoS-safe).
- `lib/storage/local.ts` — write `<UPLOADS_DIR>/trades/{userId}/{nanoid}.{ext}`,
  `path.resolve` + `startsWith(root + sep)` + reject Windows device names
  (CVE-2025-27210), `flag: 'wx'` exclusive write. `turbopackIgnore` directive
  pour ne pas drag tout le repo dans le NFT trace.
- `lib/storage/r2.ts` — stub avec checklist détaillée pour le wiring R2.
- `lib/storage/index.ts` — `selectStorage()` deterministic, warn boot si R2
  partiellement configuré.

#### Routes

- `POST /api/uploads` — multipart, auth + status=active gate, MIME allowlist
  - magic-byte re-check, 8 MiB cap, audit log. Returns 201 `{ key, readUrl }`.
- `GET /api/uploads/[...key]` — auth + ownership check (admin bypass pour J3+),
  `Readable.toWeb()` stream, `Cache-Control: private, max-age=86400, immutable`,
  CSP `default-src 'none'` + `nosniff` pour sandbox les bytes servis.

#### Service layer (`lib/trades/service.ts`)

- `createTrade`, `closeTrade`, `getTradeById`, `listTradesForUser`,
  `countTradesByStatus`, `deleteTrade`. Tout user-scoped (admin layer = J3+).
- `closeTrade` atomique — un seul `findUnique` re-utilise `existing.notes`
  (fix race condition relevée par code-reviewer).
- `SerializedTrade` — vue JSON-safe pour client components (Decimal → string,
  Date → ISO).

#### Server Actions (`app/journal/actions.ts`)

- `createTradeAction`, `closeTradeAction(tradeId)`, `deleteTradeAction`.
- BOLA defence : `keyBelongsTo(screenshotKey, userId)` avant persist.
- Re-throw `NEXT_REDIRECT`, `revalidatePath('/journal')` après mutation.

#### UI components (`components/journal/`)

- `TradeFormWizard` — 6 étapes, Framer Motion + `useReducedMotion`,
  localStorage draft persisté, focus management heading on step change,
  sticky bottom nav avec `safe-area-inset-bottom`.
- `EmotionPicker` — multi-select grouped, cap 3 via `aria-disabled`
  (jamais `disabled` — préserve la tab order), counter live region,
  warning tone à cap.
- `PairAutocomplete` — datalist HTML5 native + visual feedback bordure
  success/warning + soft warning "Paire non reconnue".
- `ScreenshotUploader` — drag & drop, client guard size + MIME, fetch
  `/api/uploads`, preview avec `aspect-ratio` + `loading="lazy"`,
  `notifiedRef` guard StrictMode-safe.
- `CloseTradeForm` — outcome radios avec icône check (anti color-only
  WCAG 1.4.1) + tone par valeur (success/danger/neutral).
- `TradeCard` — list item avec `min-w-0 truncate` (anti-overflow 375px),
  `aria-label` sur les ✓/✗ icons.
- `DeleteTradeButton` — 2-step confirm avec focus-on-confirm.

#### Pages

- `/journal` — list + tabs filter (totaux indépendants du filtre actif).
- `/journal/new` — wizard host.
- `/journal/[id]` — détail avec embedded screenshots, R réalisé responsive.
- `/journal/[id]/close` — formulaire de clôture.

#### Tests

- **167 tests unit Vitest** (vs 38 J1, +129) : trading constants, R calc,
  Zod schemas, storage keys, mergeNotes.
- **Playwright auth-gate tests** : `/journal/*` redirects, `/api/uploads*` 401.
- Full happy-path member (login → create → close → list) attend le seed
  Postgres helper (cross-jalon).

### Audits parallèles : 4 subagents, findings appliqués

- **code-reviewer** (20 findings, sévérités critical→nice) :
  - critical race `closeTrade` notes → `existing.notes` réutilisé in-tx.
  - critical regex jpeg mismatch → harmonisé sur `jpg|png|webp`.
  - high stream cast ABI fragile → import statique + cast simplifié.
  - high `userId` undefined guard → `if (!session?.user?.id)`.
  - high `emotionAfter` min(1) → schéma + UI alignés.
  - medium status active check, Zod date refine, counters separate, Decimal
    !=null cohérence, goToStep keepErrors → tous appliqués.
- **security-auditor** (5 findings) :
  - medium BOLA cross-trade key → `keyBelongsTo` check dans actions.
  - medium rate-limit absent + body-buffer in-memory → documentés J10.
  - low TOCTOU Content-Length, info trustHost en prod, info userId regex
    bornée à `{8,40}` → tous documentés / appliqués selon priorité.
- **accessibility-reviewer** (22 findings WCAG 2.2 AA) :
  - blocker focus management wizard step change → heading focus on transition.
  - blocker RadioGroup tabbable when no value → roving tabindex pattern.
  - blocker aria-valuetext progressbar + slider → ajoutés.
  - blocker outcome color-only differentiation → check icon + tone par
    valeur (`has-[:checked]`).
  - blocker ScreenshotUploader hint not exposed → `aria-describedby`.
  - serious Long/Short + Session radiogroup → `role="radiogroup"`.
  - serious EmotionPicker `disabled` → `aria-disabled` (preserve tab order).
  - serious trade-card icons sans aria-label → labels ajoutés.
  - serious delete-button focus loss → `useEffect` + ref.
- **ui-designer** (12 findings) :
  - 6-segment progress bar, prefers-reduced-motion, safe-area-inset, submit
    hint, EmotionPicker counter warning, PairAutocomplete validation feedback,
    TradeCard truncate, R réalisé responsive — tous appliqués.

### Hors scope J2 — différé

- **R2 wiring** (1–2h de boulot quand keys présentes) :
  `pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner` + impl
  `R2StorageAdapter` (checklist détaillée dans `lib/storage/r2.ts`) +
  CSP `img-src` update.
- **J2.5** : helper Playwright `seed-trade.ts` pour démarrer Postgres,
  seeder un admin + un member + 3 trades de démo, et lancer le happy-path
  complet en CI.
- **J3** : table `TradeAnnotation` (workflow correction admin).
- **J6** : analytics — exclude `realizedRSource = 'estimated'` des
  expectancy / R-distribution.
- **J10** : checklist enrichie (cf. `apps/web/CLAUDE.md` → "TODO J2 → J3+").

### Pour reprendre en J3

1. `/clear` la session courante.
2. Premier message : _"Implémente le Jalon 3 du SPEC.md à `D:\Fxmily\SPEC.md`.
   Espace admin & vue membre. Lis aussi `D:\Fxmily\apps\web\CLAUDE.md`
   (à jour J2) et `D:\Fxmily\CLAUDE.md` avant de commencer."_
3. Pré-requis : push J2 sur `origin/main` validé en local.
