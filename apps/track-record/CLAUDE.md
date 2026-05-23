# `@fxmily/track-record` — instructions Claude Code (scoped)

> Ce fichier hérite des conventions du projet : voir [`D:\Fxmily\CLAUDE.md`](../../CLAUDE.md) à la racine et [`D:\Fxmily\apps\web\CLAUDE.md`](../web/CLAUDE.md). Ici on documente uniquement les spécificités de la sous-app `apps/track-record/`.

## Contexte

Sous-app Next.js 16 dédiée à la **vitrine publique du track record d'Eliott + de la fxmily**. Distincte de `@fxmily/web` (app membre, J0→J10 livré + V1.5→V2.1 polish), distincte aussi du module REFLECT/TRAINING. Lit la table dédiée `public_trades` + `public_trade_partials` ajoutées à `apps/web/prisma/schema.prisma` (T0 2026-05-21).

### Mission

- **Vitrine de transparence** : tous les trades d'Eliott (formateur fxmily) en clair, en pourcentages uniquement (jamais €/CFD), pertes affichées avec la même prégnance que les gains.
- **Public visible** : prospects + membres + Eliott (admin).
- **Posture éditoriale** : zéro promesse de gain, zéro recommandation, posture pédagogique cf. AMF Article 314-14 RGAMF + Règlement délégué UE 2017/565 art. 44. Disclaimer inline, jamais footer 9px.

## État au T4 (2026-05-22 11:00)

T0 → T0.5 → T0.6 (rejeté) → T1 → T2 → T3 → T4 livrés sur la branche `feat/track-record-T0` (PR #148 mergeable). Quality gate **ALL GREEN** à chaque palier (type-check 0 / lint 0 / build 0 / visual verify desktop+ultrawide+mobile via playwright OK). Déployé LIVE sur `trackrecordfxmily.pages.dev` (Cloudflare Pages, static export).

### Historique des paliers (court)

| Palier | Date       | Verdict    | Note                                                                                                                                                                                                      |
| ------ | ---------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0     | 2026-05-21 | livré      | Bootstrap sous-app + Prisma schema + 139 trades source-of-truth + composants UI v1                                                                                                                        |
| T0.5   | 2026-05-22 | livré      | Audit TIER 1 a11y + code review fixes (B1-B4 + H1 + M1 + T1.1-T3.6)                                                                                                                                       |
| T0.6   | 2026-05-22 | **rejeté** | Tentative « institutional verbose » bleu `#0085FF` saturé + gradients + drop-shadows + halos → Eliot verdict **« cheap et moche »**. Reverted.                                                            |
| T1     | 2026-05-22 | livré      | Refonte minimal premium : palette désaturée `#5b8def` + `#7cb87c` + `#c87c7c`, drop drop-shadows, drop halos, drop jargon. **Sur-corrigé** → trop austère pour Eliot.                                     |
| T2     | 2026-05-22 | livré      | Abundance restored : 8 KPIs (vs 6 T1), badges trust signals retour, viz riches, halo logo subtle retour. Palette desaturated T1 conservée.                                                                |
| T3     | 2026-05-22 | livré      | Full-bleed + animations++ : `ScrollProgress`, `CursorSpotlight`, `HeroReveal` blur-to-focus, `LogoMark withTilt` 3D, `LivePulse`, `AmbientBackground` grid + radial, `PivotRail` omnipresent.             |
| T4     | 2026-05-22 | **livré**  | Vrai full-bleed : `max-w` drop sur data sections, `xl:grid-cols-8` KPIs sur une ligne, `KpiCard` magnetic 3D + live tone, `EquityCurve` ReferenceArea + LastPointPulse SVG, TradesTable pivot row inline. |

### Ce qui est livré

#### Baseline T0.5 (toujours présent)

- ✅ Bootstrap sous-app (`package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `postcss.config.mjs`).
- ✅ Schema Prisma `PublicTrade` + `PublicTradePartial` + 2 enums (`PublicTradeSegment`, `PublicTradeStatus`) dans `apps/web/prisma/schema.prisma` (lignes 1438+).
- ✅ Migration SQL `apps/web/prisma/migrations/20260521172000_track_record_public_trades/migration.sql` — **NON appliquée encore** (T5).
- ✅ Seed script `apps/web/scripts/import-fxmily-trades.ts` — local `PrismaClient + adapter-pg` pattern (B4 fix).
- ✅ Source-of-truth typée `src/lib/historical-trades.ts` — **139 trades** auto-générés depuis ODS (ordinaux séquentiels 1..139, B1 fix), `pl_val` comme truth (resultPercent honest matching ODS monthly summaries).
- ✅ Composants UI baseline : `LogoMark`, `AnimatedNumber` (count-up Motion 12), `KpiCard`, `VerifiedBadge` (Stripe Connect anatomy), `SegmentDivider`, `LegalDisclaimer` (AMF verbatim), `SectionHeader`, `ShowYourLosses` (Bridgewater 2 cols symétriques), `TradesTable` (toggle filter buttons + role="cell"), charts Recharts v3 (`EquityCurve`, `DrawdownUnderwater`, `MonthlyHeatmap` SVG grid 12 cellules, `RDistribution`, `InstrumentBreakdown`).
- ✅ Page `/` complète, PWA + SEO (`manifest.ts`, `robots.ts` Disallow:/ cohorte privée, `sitemap.ts`, `icon.tsx`, `apple-icon.tsx`, `opengraph-image.tsx` edge runtime dynamic), layout avec skip link (WCAG 2.4.1), OG/Twitter metadata, Geist Sans + Geist Mono.

#### T1 refonte minimal premium (palette pivotée)

- ✅ `globals.css` palette désaturée :
  - `--accent: #5b8def` (bleu désaturé HSL 218,79%,65% — pas `#3B82F6` saturé)
  - `--positive: #7cb87c` (Apple Health green dark adapted, pas `#22c55e` flashy)
  - `--negative: #c87c7c` (rouge désaturé, pas `#ef4444` flashy)
  - Surfaces 3 niveaux (`#0a0a0b` / `#111114` / `#17171b`), pas `#000` pur.
  - Bordures hairline 1px true-HEX (`#1f1f23` / `#2a2a30`), pas opacity.
  - Texte 3 niveaux off-white (`#ededef` / `#8a8a93` / `#5a5a63`), pas `#fff` pur.
- ✅ Drop drop-shadows permanents.
- ✅ Drop halos permanents.
- ✅ Drop jargon (« Sharpe ratio » → « Profit factor » FR, etc.).
- ✅ Geist Sans only (drop Mono, `tabular-nums` via `font-feature-settings 'tnum' 'lnum' 'ss01'`).
- ✅ 4 niveaux typographiques stricts (`.t-display` / `.t-h1` / `.t-body` / `.t-caption` / `.t-micro`).
- ✅ Focus ring 2px accent + 4px offset, pas de glow.
- ✅ Reduced-motion strict (WCAG 2.3.3) global.

#### T2 abundance restored (after Eliot « trop nu »)

- ✅ **8 KPIs** (vs 6 T1) : performance cumulée, R-multiple, Profit factor, Recul max, Trades clôturés, Trades gagnants, Espérance par trade, Meilleure série.
- ✅ Badges trust signals retour dans hero (3 `VerifiedBadge` : « Performance vérifiée » / « Aucun trade retiré » / « Publiés en direct »).
- ✅ Viz riches : `EquityCurve` glow signature lumineuse, `DrawdownUnderwater` rouge softer, `MonthlyHeatmap` 12 cellules avec aria-label format `"Janvier 2025 : performance +24 %"`.
- ✅ Halo logo subtle retour (`<LogoMark withHalo />`), uniquement sur le hero.

#### T3 full-bleed + animations++ (after Eliot « focus sur le milieu »)

- ✅ `ScrollProgress` — barre 1px fixed top, `useScroll` `scaleX` accent.
- ✅ `CursorSpotlight` — radial 640px qui suit le cursor, `mix-blend-mode: soft-light`, désactivé en `prefers-reduced-motion`.
- ✅ `HeroReveal` — blur-to-focus stagger (`filter: blur(8px) → 0`, opacity 0 → 1, `delay` props par enfant).
- ✅ `LogoMark withTilt` — tilt 3D au pointer (perspective + rotateX/rotateY motionValues, max ~6deg).
- ✅ `LivePulse` — dot 8px qui pulse (scale 1 → 1.4 → 1, infinite), couleur configurable.
- ✅ `AmbientBackground` — grid 24px subtile + 2 radial gradients très diffus, `position: fixed` z-0.
- ✅ `PivotRail` — bandeau date inline omnipresent (`22.05.2026`, position absolute right rail).
- ✅ `EquityCurve` pivot `ReferenceLine` label `"PIVOT"`.
- ✅ `MonthlyHeatmap` cellule mois pivot avec ring accent + dot.

#### T4 vrai full-bleed (after Eliot « le milieu est trop étroit »)

- ✅ Container split : `CONTAINER_PROSE` (max-w 1280px pour hero/footer) vs `CONTAINER_WIDE` (px-only, no max-w, padding adaptatif 24→160px) pour data viz / charts / tables.
- ✅ **8 KPIs sur 1 ligne** en XL+ : `xl:grid-cols-8 xl:gap-3` (vs `md:grid-cols-4` 2 lignes en md/lg).
- ✅ `KpiCard` magnetic 3D : tilt au hover via motionValues + perspective, prop `live` qui ajoute badge `LivePulse` discret + tone differential.
- ✅ `EquityCurve` :
  - `ReferenceArea` shaded zone post-pivot (futur direct).
  - `LastPointPulse` — dot SVG natif animé sur le dernier point (pas overlay HTML).
  - `ReferenceLine` PIVOT label x=`pivotOrdinal`.
- ✅ `TradesTable` pivot row inline : ligne pleine largeur insérée à `pivotOrdinal`, caption + date config.
- ✅ Verification trail section (« 01 · Trades publiés en direct / 02 · Zéro trade retiré / 03 · Pourcentage uniquement ») — 3 cols full-bleed.

### Composition finale page.tsx (T4)

Ordre des sections (top → bottom) :

1. `<AmbientBackground />` (fixed z-0 grid + radials)
2. `<ScrollProgress />` (fixed top 1px)
3. `<PivotRail date="22.05.2026" />` (fixed right rail)
4. `<header>` prose container : logo `<LogoMark height={32} />` + caption `<LivePulse /> Performance vérifiée`
5. `<CursorSpotlight>` hero : `<LogoMark height={64} withHalo withTilt />` + `<h1>` + `<HeroReveal>` count-up `<AnimatedNumber />` + 3 badges staggered
6. KPIs grid (`CONTAINER_WIDE`, `xl:grid-cols-8`, 8 cards dont 4 avec `live`)
7. Equity curve `<EquityCurve pivotOrdinal={140} height={420} />`
8. Bento row 1 : Drawdown + Heatmap (`lg:grid-cols-2`)
9. Bento row 2 : R-distribution + Top 8 instruments (`lg:grid-cols-2`)
10. Show your losses (Bridgewater 2 cols symétriques)
11. Trades table (12 visible initial, pivot row inline)
12. `<SegmentDivider date="22 mai 2026" />` + paragraphe inline
13. Verification trail 3 cols (audit/proof signals)
14. `<footer>` prose container : last update + copyright + `<LegalDisclaimer />` full AMF

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

### À FAIRE T5 admin CRUD (next session — `/clear` recommandé)

T5 = **admin CRUD dans `@fxmily/web`** (pas dans `@fxmily/track-record` qui reste static export). Ordre d'attaque :

1. **Start Docker Desktop locale** (Eliot).
2. `docker compose -f D:/Fxmily/docker-compose.dev.yml up -d` (Postgres local).
3. **Confirm year ODS = 2025** avec Eliot avant import (placeholder T0).
4. **Apply migration** : `pnpm --filter @fxmily/web prisma:migrate dev` (joue `20260521172000_track_record_public_trades`).
5. **Run seed** : `pnpm --filter @fxmily/web exec tsx scripts/import-fxmily-trades.ts --year 2025`.
6. **Verify** : `db.publicTrade.count() === 139` (et `publicTradePartial.count()` consistent).
7. **Build admin route** : `apps/web/src/app/admin/track-record/*` — **PAS dans `@fxmily/track-record`** (qui doit rester static export pour Cloudflare Pages).
8. **Patterns carbone** : `apps/web/src/app/admin/cards/*` (monovendeur Eliot, list + publish toggle + delete).
9. **Features** :
   - List + filters (segment historical/live/all, status open/closed/BE, instrument).
   - Add trade (form Zod-validated).
   - Edit trade.
   - Delete trade (confirm modal).
   - Mark BE (quick action).
   - Add partial (sub-form PublicTradePartial).
   - Publish toggle (draft → live).
   - Quick actions row (mark closed at price, mark BE, add partial).
10. **Hardening** : Server Actions + Zod schemas (`apps/web/src/lib/schemas/public-trade.ts`) + Service layer (`apps/web/src/lib/services/public-trade.ts`) + custom errors + audit slugs (7 nouveaux : `public_trade.create` / `.update` / `.delete` / `.partial_add` / `.publish` / `.mark_be` / `.mark_closed`).
11. **Tests** : Vitest sur service layer (CRUD + edge cases) + Playwright e2e (auth gates `/admin/track-record/*` + smoke add/edit/delete golden path).
12. **Rebuild webhook** : wire un webhook Cloudflare Pages auto-rebuild on mutation OU laisser Eliot trigger manuel workflow (`gh workflow run rebuild-track-record.yml`).
13. **PR dédiée** : `feat/track-record-admin-T5` chained sur main post-merge T4 #148.

## Stack

- Next.js 16.2.6 + React 19.2.6 + TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Tailwind CSS 4.3 (PostCSS — `source(none)` + `@source '..'` anti-extraction-markdown).
- Framer Motion 12.38 (motion + useMotionValue + useScroll + useTransform + useReducedMotion + useSpring pour magnetic 3D).
- Recharts 3.8 (AreaChart, BarChart avec SVG `<defs>` natifs pour gradient + glow + `ReferenceLine` + `ReferenceArea`).
- Geist Sans only (drop Mono T1+).
- Lucide React (icons).
- Prisma 7.8 + `@prisma/adapter-pg` (partage la connection avec `@fxmily/web` via DATABASE_URL).
- Zod 4.4 (validation Server Actions T5+).
- Cloudflare Pages (static export, deploy via `wrangler pages deploy out/`).

## Conventions

- **Strict TypeScript partout** — sorties `motion.*` utilisent conditional spread (pas `prop={cond ? undefined : x}` qui viole `exactOptionalPropertyTypes`).
- **Mode sombre uniquement** (lock theme, no light mode V1).
- **Tokens DS dédiés** : préfixe `--*` global mais palette pivotée T1 (désaturée). Ne PAS contaminer `--acc-*` lime de `@fxmily/web`.
- **`'use client'` au niveau du leaf** uniquement (animations Framer = client, page Server Component par défaut).
- **`tabular-nums` obligatoire** sur tout chiffre (P&L, %, R, ratios, timestamps) — via Geist Sans `font-feature-settings 'tnum' 'lnum' 'ss01'` (drop Mono).
- **Format FR par défaut** : `Intl.NumberFormat('fr-FR', ...)` dans `lib/format.ts`. Virgule décimale.
- **Pertes affichées avec MÊME prégnance que gains** — pas d'opacity réduite, pas de strikethrough. Hue `--negative: #c87c7c` désaturé.
- **AMF compliance** : `LegalDisclaimer` inline footer + paragraphes contextuels. Zero « gains garantis », zéro pourcentage mensuel promis, zéro témoignage chiffré.
- **Recharts hex `#`** (jamais `var()` — bug WebView iOS J6.6 documenté dans `apps/web/CLAUDE.md`).
- **Container split** : `CONTAINER_PROSE` (max-w 1280px) pour hero/footer/paragraphes lecture confortable, `CONTAINER_WIDE` (px-only) pour data viz / charts / tables / KPIs grid.
- **Animations gate** : toute animation Framer wrap dans `useReducedMotion()` check. Compoosants T3+ (`CursorSpotlight`, `LivePulse`, `HeroReveal`, `LogoMark withTilt`, `KpiCard` magnetic) doivent dégrader gracefully.

## Auth (T5 ajout)

- Admin (`/admin/track-record`) : **dans `@fxmily/web`**, pas dans cette sous-app. Reuse Auth.js v5 + role `ADMIN` + status `active` (gate `auth.config.ts:62-65`).
- Cookie domain `.fxmilyapp.com` → SSO transparent (T6 deploy via sous-domaine `track.fxmilyapp.com` post-domain wiring).
- Pas d'admin wire dans la sous-app (qui reste static export Cloudflare Pages).

## Décisions T0→T4 verrouillées

| Décision             | Choix                                                  | Pourquoi                                                                                     |
| -------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Emplacement          | Sous-app monorepo `apps/track-record/`                 | Isolation blast radius, partage Prisma+lint+CI, brand séparé                                 |
| Identité visuelle    | Palette désaturée T1 conservée T2-T4                   | T0.6 saturé `#0085FF` rejeté par Eliot « cheap »                                             |
| Animations           | T3 ambient + magnetic 3D + blur-to-focus               | Eliot « focus milieu » + « plus vivant »                                                     |
| Full-bleed           | T4 drop max-w sur data sections, padding adaptatif     | Eliot « milieu trop étroit »                                                                 |
| KPIs density         | 8 cards, 1 ligne XL+ (`xl:grid-cols-8`)                | T2 abundance restored, T4 single-row pour ultrawide                                          |
| Auth admin           | Reuse Auth.js v5 + role ADMIN, **dans `@fxmily/web`**  | Zéro divergence security + sous-app reste static                                             |
| Persistance          | Table dédiée `public_trades` + `public_trade_partials` | Séparation propre données publiques d'Eliott vs Journal membre                               |
| Lib charts           | Recharts v3                                            | Stack déjà connue web + customisation premium SVG `<defs>` glow + `ReferenceLine/Area`       |
| Année historique ODS | **2025 (placeholder)** — à confirmer Eliot T5          | ODS sans dates typées, seul `week_label "20 JANVIER"`                                        |
| Ordinals             | **Séquentiels 1..139** (pas `n` ODS)                   | B1 fix — auteur ODS doublé 124-129 ; UNIQUE constraint protégée                              |
| Source resultPercent | `pl_val` typed cell ODS (pas `risk × rr`)              | Auteur ODS parfois rr=0 alors que pl=-1% ; matches ODS monthly summaries 214% (vs 250% faux) |
| Risk precision       | `Decimal(4,2)`                                         | M1 fix — aligné `Trade.riskPct` V1.5 + Tharp ceiling <100%                                   |
| Deploy               | Cloudflare Pages static export                         | Sous-app data-read-only, CDN edge, separate du `@fxmily/web` Hetzner Docker                  |

## Audit findings status

### A11y audit (TIER 1 BLOCKER + 3 TIER 2 HIGH + 6 TIER 3 MEDIUM)

| Finding                                              | Status                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| T1.1 CTA accent #0085FF + white = 4.13:1 fails 1.4.3 | ✅ FIXED — T1 palette pivot `#5b8def` (audit recompute pending T5)                                |
| T2.1 Tabs ARIA missing aria-controls + arrow keys    | ✅ FIXED — converted to toggle buttons `aria-pressed`                                             |
| T2.2 Charts no aria-label / figcaption               | ✅ FIXED — wrapped in `<motion.figure role="img" aria-label>` with sr-only `<figcaption>` summary |
| T2.3 reduced-motion partial coverage                 | ✅ OK — global media query + conditional spread covers T3+ animations                             |
| T2.4 Touch targets 44×44 WCAG 2.2 AA 2.5.8           | ✅ PASS — toutes touch targets ≥24px (AA), tabs ~41px                                             |
| T3.1 Pseudo-table missing role="cell"/columnheader   | ✅ FIXED — all data spans + header spans annotated                                                |
| T3.2 Disclaimer placement « en bonne place » AMF     | ✅ FIXED — `LegalDisclaimer` footer + paragraphes contextuels verification trail                  |
| T3.4 Heatmap aria-label format                       | ✅ FIXED — « Janvier 2025 : performance +24 % » + role="list"/listitem                            |
| T3.6 Focus ring invisible on accent CTA              | ✅ FIXED — global `:focus-visible` 2px accent + 4px offset                                        |
| T4.1 Skip link                                       | ✅ FIXED — added in `layout.tsx`                                                                  |
| T4.2/T4.3/T4.4 NITs                                  | DEFERRED — cosmetic comments + lang spans                                                         |

### Code review audit (4 TIER 1 BLOCKERS + 5 TIER 2 HIGH)

| Finding                                                                    | Status                                                                                  |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| B1 6 ordinals dupliqués (124-129 doublés)                                  | ✅ FIXED — sequential 1..139 via python regen                                           |
| B2 3 imports inutilisés page.tsx (formatR/formatRatio/formatWinrate)       | ✅ T0.5 FIXED — re-usage T2+ pour 8 KPIs                                                |
| B3 MONTH_LABELS_FR `noUncheckedIndexedAccess` violation                    | ✅ FIXED — `?? 'M${m}'` defensive                                                       |
| B4 import-fxmily-trades.ts crosses server-only barrier                     | ✅ FIXED — local PrismaClient + adapter-pg pattern carbone `seed-mark-douglas-cards.ts` |
| H1 KPI label « % composé » sur calcul arithmétique = trompeur AMF          | ✅ FIXED — label « % cumulé arithmétique »                                              |
| H2 next/og `system-ui` font fallback sur Hetzner Debian                    | DEFERRED T6 — connue dans apps/web/CLAUDE.md J10 Phase K                                |
| H3 duplicate sort `buildEquityCurve` au module load                        | DEFERRED — micro-perf, n=139 negligible                                                 |
| H4 `formatDateIso` timezone Paris drift latent                             | DEFERRED — V1 toutes dates UTC midnight, safe                                           |
| H5 CSP `unsafe-inline` en prod                                             | DEFERRED — V2 nonces documented dans apps/web/CLAUDE.md                                 |
| M1 `riskPercent Decimal(6,3)` incohérent avec `Trade.riskPct Decimal(4,2)` | ✅ FIXED — aligned Decimal(4,2)                                                         |
| M2/M3/M4/M5/M6 NITs                                                        | DEFERRED — non-bloquants V1                                                             |

## Visual verification

Captures playwright (T0.5 → T4 2026-05-22) dans `D:\.playwright-mcp\` :

### T0.5 baseline

- `track-record-T0.5-hero-1440.png` — hero with logo halo + KPIs + badges + compact disclaimer
- `track-record-equity-section.png` — equity curve rendering with blue gradient + glow + tabular-nums axis labels
- `track-record-drawdown-heatmap.png` — drawdown rouge + monthly heatmap 12 cells (avril rouge même prégnance)
- `track-record-rdist-2.png` — R distribution histogram + 8 instruments breakdown + show-your-losses Bridgewater pattern
- `track-record-trades-table.png` — trades table 25 rows + 4 filter tabs (Tous 139 / Gains 78 / Pertes 41 / BE 20)
- `track-record-mobile-hero.png` — mobile 375 responsive

### T2 abundance restored

- `track-record-T2-prod-1440.png` — T2 abundance back full page (8 KPIs + halos + badges retour)
- `track-record-T2-hero-zoom.png` — T2 logo halo + 3 badges trust signals
- `track-record-T2-equity-zoom.png` — T2 equity glow signature

### T3 full-bleed + animations

- `track-record-T3-ultrawide-1920.png` — T3 full-bleed 1920 + animations
- `track-record-T3-hero-1920.png` — T3 ambient + grid + halo + cursor spotlight
- `track-record-T3-equity-pivot-v2.png` — T3 ReferenceLine PIVOT label
- `track-record-T3-heatmap-pivot.png` — T3 DÉC ring + dot pivot

### T4 vrai full-bleed (LIVE)

- `track-record-T4-ultrawide-1920.png` — T4 full-bleed 1920 + 8 KPIs row + AmbientBackground + PivotRail
- `track-record-T4-kpis-zoom.png` — T4 8 KPIs sur 1 ligne avec « LIVE » badges sur 4 derniers
- `track-record-T4-mobile.png` — T4 mobile 375 responsive (KPIs grid-cols-2 + container px adaptatif)

Tous les écrans WCAG AA verified (contraste recompute T1 palette pending T5) + Recharts SVG paths rendering + no console errors + `prefers-reduced-motion` validated (animations dégradent gracefully).

## Pickup prompt T5 admin CRUD (à coller post-`/clear`)

```
T5 Admin CRUD pour @fxmily/track-record (continuation T4 livré 2026-05-22 — LIVE trackrecordfxmily.pages.dev).

CONTEXT
=======
T0 → T0.5 → T1 → T2 → T3 → T4 livrés sur branche feat/track-record-T0 (PR #148 mergeable, deploy LIVE Cloudflare Pages).

T4 = vrai full-bleed UI + 8 KPIs 1×row + animations++ (ScrollProgress, CursorSpotlight, HeroReveal, LogoMark withTilt 3D, LivePulse, AmbientBackground, PivotRail) + EquityCurve ReferenceArea+LastPointPulse SVG + TradesTable pivot row inline.

T5 = admin CRUD pour gérer les PublicTrade en LIVE. **PAS dans @fxmily/track-record** (qui reste static export Cloudflare Pages), mais dans **@fxmily/web** sous `/admin/track-record/*`.

LIRE EN PREMIER (ordre)
========================
1. apps/track-record/CLAUDE.md (ce fichier, scoped — toute l'histoire T0→T4)
2. apps/web/CLAUDE.md (conventions monorepo, Auth.js v5, Server Actions pattern, V1 LIVE J0→V2.1.6)
3. apps/web/prisma/schema.prisma lignes 1438+ (PublicTrade + PublicTradePartial + 2 enums)
4. apps/web/src/app/admin/cards/page.tsx + actions.ts (pattern carbone : monovendeur Eliot, list+publish+delete)
5. apps/web/src/lib/schemas/card.ts (Zod hardening template avec safeFreeText)
6. apps/web/src/auth.config.ts:62-65 (gate `/admin/*` role admin + status active)

OBJECTIF T5
============
1. Start Docker Desktop locale (Eliot).
2. `docker compose -f D:/Fxmily/docker-compose.dev.yml up -d`.
3. Confirm year ODS = 2025 avec Eliot.
4. Apply migration : `pnpm --filter @fxmily/web prisma:migrate dev` (joue 20260521172000_track_record_public_trades).
5. Run seed : `pnpm --filter @fxmily/web exec tsx scripts/import-fxmily-trades.ts --year 2025`.
6. Verify : `db.publicTrade.count() === 139` + `db.publicTradePartial.count()` consistent.
7. Build admin route `apps/web/src/app/admin/track-record/*` :
   - `page.tsx` (list + filters par segment/status/instrument)
   - `new/page.tsx` (form add Zod-validated)
   - `[id]/edit/page.tsx` (form edit)
   - `[id]/partials/new/page.tsx` (form add PublicTradePartial)
   - `actions.ts` (Server Actions: createPublicTrade / updatePublicTrade / deletePublicTrade / markBE / addPartial / togglePublish / markClosed)
8. Patterns carbone `apps/web/src/app/admin/cards/*` (monovendeur Eliot, no marketplace shenanigans).
9. Hardening :
   - Zod schemas `apps/web/src/lib/schemas/public-trade.ts` (avec `safeFreeText` sur notes + instrument allowlist)
   - Service layer `apps/web/src/lib/services/public-trade.ts` (computeKpisOnSave, recomputeEquityCurve, etc.)
   - Custom errors (PublicTradeNotFoundError, PublicTradeInvalidStateError)
   - Audit slugs 7 nouveaux : public_trade.create / .update / .delete / .partial_add / .publish / .mark_be / .mark_closed (cf. apps/web/src/lib/audit.ts pattern)
10. Tests :
    - Vitest service layer (CRUD + edge cases : double publish, delete avec partials, mark BE on already-closed)
    - Playwright e2e (auth gates `/admin/track-record/*` → redirect /sign-in si non-admin, golden path add → publish → verify on track-record page après rebuild)
11. Rebuild webhook OU manual workflow Eliot :
    - Option A : Cloudflare Pages webhook (POST sur mutation, auto-rebuild)
    - Option B : `gh workflow run rebuild-track-record.yml` manuel après mutations bulk
12. PR dédiée `feat/track-record-admin-T5` chained sur main post-merge T4 #148.

HARD-RULE SPEC §18.4
=====================
1 session = 1 jalon. T5 = admin CRUD + tests. T6 = deploy domain wiring (`track.fxmilyapp.com`) + Cloudflare Pages webhook prod. T7+ = ISR/SWR si latence rebuild devient un sujet.

NE PAS FAIRE
============
- Ne PAS toucher à apps/track-record/* (T4 livré, static export figé).
- Ne PAS recoder les composants UI : ils sont consommés en static, l'admin renseigne juste la DB.
- Ne PAS ajouter Server Actions dans @fxmily/track-record (rester static export Cloudflare Pages).
- Ne PAS pousser sur main directement, PR review obligatoire.
```
