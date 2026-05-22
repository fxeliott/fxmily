# `@fxmily/track-record` — instructions Claude Code (scoped)

> Ce fichier hérite des conventions du projet : voir [`D:\Fxmily\CLAUDE.md`](../../CLAUDE.md) à la racine et [`D:\Fxmily\apps\web\CLAUDE.md`](../web/CLAUDE.md). Ici on documente uniquement les spécificités de la sous-app `apps/track-record/`.

## Contexte

Sous-app Next.js 16 dédiée à la **vitrine publique du track record d'Eliott + de la fxmily**. Distincte de `@fxmily/web` (app membre, J0→J10 livré + V1.5→V2.1 polish), distincte aussi du module REFLECT/TRAINING. Lit la table dédiée `public_trades` + `public_trade_partials` ajoutées à `apps/web/prisma/schema.prisma` (T0 2026-05-21).

### Mission

- **Vitrine de transparence** : tous les trades d'Eliott (formateur fxmily) en clair, en pourcentages uniquement (jamais €/CFD), pertes affichées avec la même prégnance que les gains.
- **Public visible** : prospects + membres + Eliott (admin).
- **Posture éditoriale** : zéro promesse de gain, zéro recommandation, posture pédagogique cf. AMF Article 314-14 RGAMF + Règlement délégué UE 2017/565 art. 44. Disclaimer inline, jamais footer 9px.

## État au T0.5 (2026-05-22)

T0 + T0.5 livrés sur la branche `feat/track-record-T0`. Quality gate **ALL GREEN** (type-check 0 / lint 0 / build 0 / visual verify desktop+mobile via playwright OK).

### Ce qui est livré

- ✅ Bootstrap sous-app (`package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`).
- ✅ Design tokens noir+bleu "Deep Ink + Lumen Blue" dans `src/app/globals.css` (`--tr-*` namespace, palette WCAG AA verified).
- ✅ Schema Prisma `PublicTrade` + `PublicTradePartial` + 2 enums (`PublicTradeSegment`, `PublicTradeStatus`) dans `apps/web/prisma/schema.prisma` (lignes 1438+).
- ✅ Migration SQL `apps/web/prisma/migrations/20260521172000_track_record_public_trades/migration.sql` — **NON appliquée encore** (T1).
- ✅ Seed script `apps/web/scripts/import-fxmily-trades.ts` — local `PrismaClient + adapter-pg` pattern (B4 fix).
- ✅ Source-of-truth typée `src/lib/historical-trades.ts` — **139 trades** auto-générés depuis ODS (ordinaux séquentiels 1..139, B1 fix), `pl_val` comme truth (resultPercent honest matching ODS monthly summaries).
- ✅ Composants UI : `LogoMark` (halo bleu pointer-reactive), `AnimatedNumber` (count-up Motion 12), `KpiCard` (stagger reveal), `VerifiedBadge` (Stripe Connect anatomy), `SegmentDivider`, `LegalDisclaimer` (AMF verbatim), `CompactDisclaimer` (T3.2 fix — hero pill), `SectionHeader`, `ShowYourLosses` (Bridgewater 2 cols symétriques), `TradesTable` (toggle filter buttons T2.1 fix + role="cell" T3.1).
- ✅ Charts Recharts v3 : `EquityCurve` (AreaChart bleu glow), `DrawdownUnderwater` (AreaChart rouge softer inversé), `MonthlyHeatmap` (SVG grid 12 cellules avec role="list"), `RDistribution` (BarChart histogramme 0.5R), `InstrumentBreakdown` (bar horizontale). Tous wrapped en `<motion.figure role="img" aria-label>` avec sr-only `<figcaption>` summary (T2.2 fix).
- ✅ Page `/` complète : hero + 8 KPIs hero + compact disclaimer pill + equity curve + drawdown+heatmap row + R-dist+instruments row + show-your-losses + trades table 25 visible + AMF disclaimer full + segment divider + footer.
- ✅ PWA + SEO : `manifest.ts`, `robots.ts` (Disallow:/ T0 cohorte privée), `sitemap.ts`, `icon.tsx`, `apple-icon.tsx`, `opengraph-image.tsx` (edge runtime dynamic).
- ✅ Layout avec skip link (WCAG 2.4.1), OG/Twitter metadata, Geist Sans+Mono.

### KPIs honnêtes (data computed from HISTORICAL_TRADES, not hardcoded)

| Métrique                           | Valeur                                                 | Ground truth ODS                                               |
| ---------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------- |
| Total trades                       | 139                                                    | ✓                                                              |
| Closed (computed R)                | 136                                                    | ✓                                                              |
| Wins                               | 78 (57.4% sur closed-BE-excluded = 78/(78+41) = 65.5%) | ✓                                                              |
| Losses                             | 41                                                     | ✓                                                              |
| BE                                 | 17                                                     | ✓                                                              |
| Result cumulé % (sum arithmétique) | +215.80 %                                              | ODS sum 214.30 % (Δ 1.5% rounding pl_val typed-cell precision) |
| R cumulé                           | +182.00 R                                              | derived                                                        |
| Profit factor                      | 5.55                                                   | credible (vs faux 18.81 avant `pl_val` fix)                    |
| Max drawdown                       | -18.00 %                                               | observed                                                       |
| Best streak                        | observed                                               | ✓                                                              |
| Distinct instruments               | 27 (post-fix typos AUDNZDD→AUDNZD, NZDACD→NZDCAD)      | ✓                                                              |

### À FAIRE T1 (next session — `/clear` recommandé entre)

1. **Eliot installe les nouvelles deps** : `pnpm install` à la racine ✓ déjà fait T0.5
2. **Confirm year ODS** : 2025 par défaut dans le seed — confirmer avec Eliot avant import
3. **Apply migration** : `pnpm --filter @fxmily/web prisma:migrate dev` (DB locale)
4. **Run seed** : `pnpm --filter @fxmily/web exec tsx scripts/import-fxmily-trades.ts --dry-run --year 2025` puis sans `--dry-run`
5. **Wire page.tsx pour lire depuis Prisma** (Server Component `force-dynamic`) — remplacer `HISTORICAL_TRADES` const par `db.publicTrade.findMany({ orderBy: { ordinal: 'asc' } })`
6. **Filtre URL `?segment=historical|live|all`** pour T1 admin testing
7. **Tests Vitest** sur `lib/metrics.ts` (computeKpis, groupByMonth, bucketByR, etc.)

## Stack

- Next.js 16.2.6 + React 19.2.6 + TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Tailwind CSS 4.3 (PostCSS — `source(none)` + `@source '..'` anti-extraction-markdown).
- Framer Motion 12.38 (motion + useMotionValue + useScroll + useTransform + useReducedMotion).
- Recharts 3.8 (AreaChart, BarChart avec SVG `<defs>` natifs pour gradient + glow).
- Geist Sans + Geist Mono (display + mono).
- Lucide React (icons).
- Prisma 7.8 + `@prisma/adapter-pg` (partage la connection avec `@fxmily/web` via DATABASE_URL).
- Zod 4.4 (validation Server Actions T2+).

## Conventions

- **Strict TypeScript partout** — sorties `motion.*` utilisent conditional spread (pas `prop={cond ? undefined : x}` qui viole `exactOptionalPropertyTypes`).
- **Mode sombre uniquement** (lock theme, no light mode V1).
- **Tokens DS dédiés** : préfixe `--tr-*` (track-record). Ne PAS contaminer `--acc-*` lime de `@fxmily/web`.
- **`'use client'` au niveau du leaf** uniquement (animations Framer = client, le reste reste Server Component par défaut).
- **`tabular-nums` obligatoire** sur tout chiffre (P&L, %, R, ratios, timestamps).
- **Format FR par défaut** : `Intl.NumberFormat('fr-FR', ...)` dans `lib/format.ts`. Virgule décimale.
- **Pertes affichées avec MÊME prégnance que gains** — pas d'opacity réduite, pas de strikethrough. Hue `--tr-loss` (= softer `#F46B7D`, pas red brut).
- **AMF compliance** : LegalDisclaimer inline + CompactDisclaimer hero pill. Zero "gains garantis", zéro pourcentage mensuel promis, zéro témoignage chiffré.
- **Recharts hex `C`** (jamais `var()` — bug WebView iOS J6.6 documenté dans `apps/web/CLAUDE.md`).

## Auth (T2 ajout)

- Admin (`/admin`) : reuse Auth.js v5 + role `ADMIN` de `@fxmily/web`.
- Cookie domain `.fxmilyapp.com` → SSO transparent (T3 deploy via sous-domaine `track.fxmilyapp.com`).
- Pas d'admin wire T0/T0.5.

## Décisions T0/T0.5 verrouillées

| Décision             | Choix                                                  | Pourquoi                                                                                     |
| -------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Emplacement          | Sous-app monorepo `apps/track-record/`                 | Isolation blast radius, partage Prisma+lint+CI, brand séparé                                 |
| Identité visuelle    | Variation noir+bleu propre, logo fxmily commun         | Validé Eliot Q2                                                                              |
| Auth admin           | Reuse Auth.js v5 + role ADMIN (T2)                     | Zéro divergence security                                                                     |
| Persistance          | Table dédiée `public_trades` + `public_trade_partials` | Séparation propre données publiques d'Eliott vs Journal membre                               |
| Lib charts           | Recharts v3 (fallback lightweight-charts v5)           | Stack déjà connue web + customisation premium SVG `<defs>` glow                              |
| Année historique ODS | **2025 (placeholder)** — à confirmer Eliot             | ODS sans dates typées, seul `week_label "20 JANVIER"`                                        |
| Ordinals             | **Séquentiels 1..139** (pas `n` ODS)                   | B1 fix — auteur ODS doublé 124-129 ; UNIQUE constraint protégée                              |
| Source resultPercent | `pl_val` typed cell ODS (pas `risk × rr`)              | Auteur ODS parfois rr=0 alors que pl=-1% ; matches ODS monthly summaries 214% (vs 250% faux) |
| Risk precision       | `Decimal(4,2)`                                         | M1 fix — aligné `Trade.riskPct` V1.5 + Tharp ceiling <100%                                   |
| Accent CTA           | `#0070D9` (5.21:1 white text)                          | T1.1 a11y fix — WCAG 1.4.3 AA                                                                |

## Audit findings status

### A11y audit (TIER 1 BLOCKER + 3 TIER 2 HIGH + 6 TIER 3 MEDIUM)

| Finding                                              | Status                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| T1.1 CTA accent #0085FF + white = 4.13:1 fails 1.4.3 | ✅ FIXED — `--tr-acc: #0070D9`                                                                    |
| T2.1 Tabs ARIA missing aria-controls + arrow keys    | ✅ FIXED — converted to toggle buttons `aria-pressed`                                             |
| T2.2 Charts no aria-label / figcaption               | ✅ FIXED — wrapped in `<motion.figure role="img" aria-label>` with sr-only `<figcaption>` summary |
| T2.3 reduced-motion partial coverage                 | ✅ OK — global media query + conditional spread covers it                                         |
| T2.4 Touch targets 44×44 WCAG 2.2 AA 2.5.8           | ✅ PASS — toutes touch targets ≥24px (AA), tabs ~41px                                             |
| T3.1 Pseudo-table missing role="cell"/columnheader   | ✅ FIXED — all data spans + header spans annotated                                                |
| T3.2 Disclaimer placement "en bonne place" AMF       | ✅ FIXED — CompactDisclaimer in hero + #legal anchor                                              |
| T3.4 Heatmap aria-label format                       | ✅ FIXED — "Janvier 2025 : performance +24 %" + role="list"/listitem                              |
| T3.6 Focus ring invisible on accent CTA              | ✅ FIXED — `.tr-cta:focus-visible` white ring override                                            |
| T4.1 Skip link                                       | ✅ FIXED — already added in `layout.tsx`                                                          |
| T4.2/T4.3/T4.4 NITs                                  | DEFERRED — cosmetic comments + lang spans                                                         |

### Code review audit (4 TIER 1 BLOCKERS + 5 TIER 2 HIGH)

| Finding                                                                    | Status                                                                                  |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| B1 6 ordinals dupliqués (124-129 doublés)                                  | ✅ FIXED — sequential 1..139 via python regen                                           |
| B2 3 imports inutilisés page.tsx (formatR/formatRatio/formatWinrate)       | ✅ FIXED — drop                                                                         |
| B3 MONTH_LABELS_FR `noUncheckedIndexedAccess` violation                    | ✅ FIXED — `?? 'M${m}'` defensive                                                       |
| B4 import-fxmily-trades.ts crosses server-only barrier                     | ✅ FIXED — local PrismaClient + adapter-pg pattern carbone `seed-mark-douglas-cards.ts` |
| H1 KPI label "% composé" sur calcul arithmétique = trompeur AMF            | ✅ FIXED — label "% cumulé arithmétique"                                                |
| H2 next/og `system-ui` font fallback sur Hetzner Debian                    | DEFERRED T3 — connue dans apps/web/CLAUDE.md J10 Phase K                                |
| H3 duplicate sort `buildEquityCurve` au module load                        | DEFERRED — micro-perf, n=139 negligible                                                 |
| H4 `formatDateIso` timezone Paris drift latent                             | DEFERRED — V1 toutes dates UTC midnight, safe                                           |
| H5 CSP `unsafe-inline` en prod                                             | DEFERRED — V2 nonces documented dans apps/web/CLAUDE.md                                 |
| M1 `riskPercent Decimal(6,3)` incohérent avec `Trade.riskPct Decimal(4,2)` | ✅ FIXED — aligned Decimal(4,2)                                                         |
| M2/M3/M4/M5/M6 NITs                                                        | DEFERRED — non-bloquants V1                                                             |

## Visual verification

Capture playwright desktop 1440×900 + mobile 375×667 (T0.5 2026-05-22) :

- `.playwright-mcp/track-record-T0.5-hero-1440.png` — hero with logo halo + KPIs + badges + compact disclaimer
- `.playwright-mcp/track-record-equity-section.png` — equity curve rendering with blue gradient + glow + tabular-nums axis labels
- `.playwright-mcp/track-record-drawdown-heatmap.png` — drawdown rouge + monthly heatmap 12 cells (avril rouge même prégnance)
- `.playwright-mcp/track-record-rdist-2.png` — R distribution histogram + 8 instruments breakdown + show-your-losses Bridgewater pattern
- `.playwright-mcp/track-record-trades-table.png` — trades table 25 rows + 4 filter tabs (Tous 139 / Gains 78 / Pertes 41 / BE 20)
- `.playwright-mcp/track-record-mobile-hero.png` — mobile 375 responsive

Tous les écrans WCAG AA verified (contraste calculé) + Recharts SVG paths rendering + no console errors.

## Pickup prompt T1 (à coller post-`/clear`)

```
T1 du track record fxmily (continuation T0.5 livré 2026-05-22).

Lis :
1. apps/track-record/CLAUDE.md (ce fichier)
2. apps/web/CLAUDE.md (conventions monorepo)
3. apps/web/prisma/schema.prisma (lignes 1438+ pour PublicTrade)
4. apps/track-record/src/lib/historical-trades.ts (139 trades source-of-truth)

Objectif T1 :
- Confirmer year ODS avec Eliot (placeholder 2025)
- Apply migration `20260521172000_track_record_public_trades` en local
- Run seed `apps/web/scripts/import-fxmily-trades.ts --year YYYY`
- Wire `/page.tsx` pour lire depuis Prisma (Server Component force-dynamic) — remplace HISTORICAL_TRADES const par db.publicTrade.findMany
- Ajout filtre URL `?segment=historical|live|all`
- Tests Vitest sur lib/metrics.ts (computeKpis, groupByMonth, bucketByR, bestTrades, worstTrades)
- Smoke E2E Playwright auth gates + render

Hard-rule SPEC §18.4 : 1 session = 1 jalon. T1 = lecture DB + tests + filtres. T2 = admin CRUD. T3 = deploy.
```
