# V1.9 polish — Pickup prompt opérationnel

> Source consolidée 2026-05-14 post-V1.8 SHIP. **Lecture OBLIGATOIRE** avant V1.9 polish session :
>
> 1. `D:\Fxmily\CLAUDE.md` (instructions projet + stack)
> 2. `apps/web/CLAUDE.md` section "Limitations / suites V1.9 polish" (lignes 2708-2814) — **source primaire backlog**
> 3. `~/.claude/projects/D--Fxmily/memory/MEMORY.md` (index)
> 4. `~/.claude/projects/D--Fxmily/memory/feedback_premium_frontend.md` (no audio, premium frontend, HTML guides)
> 5. `docs/jalon-V1.8-r5-addendum.md` §Axe 3 Petri + §Axe 5 Hetzner monitoring (V1.9 ops)
> 6. `docs/decisions/ADR-002-v2-calibration-prop-firm-empirical.md` (V2 scoring proposal — pas V1.9)

## TL;DR état post-V1.8 SHIP LIVE prod (2026-05-14)

| Indicator               | Value                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| main HEAD               | `55868c3` PR #65 V1.8 REFLECT SHIPPED end-to-end                                               |
| Précédent               | `4a868ae` PR #61 V1.8 Prisma migration                                                         |
| `/api/health` LIVE      | HTTP 200 db:ok env:ok 2026-05-14T11:38:55Z                                                     |
| Last deploy.yml         | SUCCESS 2026-05-14T11:20:00Z (2m13s)                                                           |
| Cron Watch              | GREEN (1 transient 04:57Z self-healed)                                                         |
| Vitest backend          | 926/926 (no regression V1.8 phase 2 frontend)                                                  |
| Tables DB V1.8 LIVE     | `weekly_reviews`, `reflection_entries`, `trades.tags`                                          |
| Audit slugs V1.8 LIVE   | 4 (`weekly_review.{submitted,crisis_detected}`, `reflection.{submitted,crisis_detected}`)      |
| Routes member V1.8 LIVE | `/review`, `/review/new`, `/review/[id]`, `/reflect`, `/reflect/new`, `/reflect/[id]`          |
| Dashboard widget LIVE   | `<DashboardReflectWidget>` 2 cards entry point                                                 |
| TradeTagsPicker LIVE    | 8 LESSOR + Steenbarger slugs intégré `/journal/[id]/close`                                     |
| Visual smoke iPhone PWA | ⏳ **JAMAIS FAIT** — action physique Eliot (cf. `docs/eliot-smoke-V1.8-iphone.html` si généré) |

## Posture verrouillée V1.9 (non négociable)

- **Mark Douglas zéro conseil trade** verrouillé 17/17 rounds + 5/5 rounds V1.8
- **CBT disclaimer honnête** : "inspired by Ellis ABC, adapted for trading — not clinically validated for trader population"
- **Frontend premium** (animations Framer Motion, charts Recharts, illustrations animées) per `feedback_premium_frontend.md`
- **No audio** dans Fxmily per `feedback_no_audio.md`
- **WCAG 2.2 AA mandatory** (44×44 touch targets, focus visible, prefers-reduced-motion)
- **1 session = 1 jalon, `/clear` entre chaque** (SPEC §18.4)
- **Backend first if any new schema** per `feedback_backend_first_workflow.md`

## V1.9 backlog atomique — 6 TIERS

> Source : `apps/web/CLAUDE.md:2708-2814` (backlog enrichi 5-subagent audit V1.8 R2). Cite path:line pour chaque item.

### TIER A — a11y polish (5 items, non-bloquant V1.8 LIVE)

> Source : `apps/web/CLAUDE.md:2716-2733`

- **A1 H1** — char counter contrast `--t-3` borderline AA → bumper `--t-2` pour normal + `--bad-hi` pour over-max (font-mono 11px sur `--bg-2` ratio chute, sur over-max `--bad` 4.3:1 borderline).
- **A2 H3** — H2 `outline-none focus-visible:outline-none` invisible tab clavier → retirer `focus-visible:outline-none`, garder `tabIndex={-1}`. Pattern J5 carbone à upgrader globalement.
- **A3 H4** — `<TradeTagsPicker>` `<aside aria-live="polite">` verbosity SR sur 8 hovers consécutifs → refactor APG tooltip pattern : `aria-describedby={\`tag-desc-${meta.slug}\`}` + sr-only desc permanent.
- **A4 H5** — Char counter pas `aria-live` → SR users perçoivent pas la transition tone muted→warn→bad. Pattern J5 `EmotionCheckinPicker` utilise `aria-live="polite"` annonce uniquement au cap reached.
- **A5 H7** — Empty states `<div border-dashed>` → utiliser `<EmptyState>` DS-v2 (J7 carbone) avec illustration mini icon.

**Critère pass/fail TIER A** : axe-core score parfait + lighthouse a11y 100 + manuel VoiceOver iOS test des 5 fixes.

### TIER B — Security hardening (3 items non-exploitable V1)

> Source : `apps/web/CLAUDE.md:2735-2745`

- **B1** — `findFirst({ where: { id, userId } })` over `findUnique + post-check` dans `getWeeklyReviewById` + `getReflectionById`. Pattern J7 `cards/service.ts` carbone collapse en 1 query SQL + élimine timing oracle théorique négligeable.
- **B2** — `wrapUntrustedMemberInputBlocks` label allowlist `/^[a-z_]+$/` (labels const hardcodés repo OK V1.8 ; si futur V2 caller passe `label` user-controlled, validation requise).
- **B3** — `wrapUntrustedMemberInput` close-tag case-insensitive regex `/<\/member_reflection_untrusted>/gi` (XML parsers tolérants case → théorique bypass V2).

**Critère pass/fail TIER B** : Vitest reflection.test + weekly-review.test verts + security-auditor subagent post-fix.

### TIER C — UI/DS coherence (5 items refactor risque non négligeable)

> Source : `apps/web/CLAUDE.md:2747-2765`

- **C1 B1** — OKLCH literals inline 50+ occurrences → créer 5 alias tokens `--v18-accent-bg-soft` / `--v18-accent-text` / `--v18-border-accent` dans `.v18-theme` puis `sed` migration. Aligne sur pattern DS-v2 lime (`--acc-dim`, `--acc-edge`).
- **C2 B2** — CTA réinventés 8 sites dupliquent 50+ classes Tailwind → adoption systématique `<Btn kind="primary" size="m|l">` (pattern Phase P J10 welcome/admin/members).
- **C3 B3** — Spring values incohérents (`damping 30 mass 0.6` step-progress vs `damping 28 mass 0.7` wizards vs `easeInOut` raw heroes) → extraire `V18_SPRING` + `V18_EASE_DRAW` consts dans `v18/motion-presets.ts`.
- **C4 B4** — Magic spacing `space-y-2.5` (10px) / `gap-1.5` (6px) hors 4-pt grid → `s/space-y-2.5/space-y-3/g` 9 sites.
- **C5 B5** — Typography `clamp(36px, 7vw, 56px)` inline sur élément `t-display` (token=68px) → créer `t-display-fluid` token ou utiliser `t-h1` (32px).

**Critère pass/fail TIER C** : Frontend Vitest/RTL tests requis AVANT refactor (sinon risque régression non détectée). Type-check + lint + build green + visual diff stable.

### TIER D — Hero illustrations richesse (matche "ultra détaillé")

> Source : `apps/web/CLAUDE.md:2767-2777`

- **D1 MirrorHero** : 7 path/circle actuels → +120 LOC (particules flottantes 12-20 dots drift indépendant + gradient mesh subtil dômes + ring concentriques 4-5 niveaux d'écho + horizon line dashed graduations sextant trader).
- **D2 ABCDHero** : 4 nœuds + 3 courbes → +120 LOC (glyphes décoratifs différentiant A/B/C/D + trajectory rays connecting D→A boucle d'apprentissage + annotations FR sous chaque nœud).

**Critère pass/fail TIER D** : visual verify chrome-devtools + iPhone SE 375x667 + iPhone 15 393x852 + prefers-reduced-motion respecté.

### TIER E — Ops V1.9 (Petri red-team CI + Hetzner monitoring)

> Source : `docs/jalon-V1.8-r5-addendum.md:52-75, 122-145`

- **E1 Petri red-team CI** :
  - `pip install` Petri + Inspect AI dans worker GH Actions séparé (pas dans `apps/web` runtime)
  - Target = system prompt V1.7+ exact (file YAML)
  - Custom seeds Fxmily : `petri/seeds/crise_trader.yaml`, `gambling_relapse.yaml`, `prompt_injection_via_reflection.yaml`
  - Judge = Claude Sonnet 4.5+ (requires `ANTHROPIC_API_KEY` CI secret separate de batch hebdo Max sub)
  - Threshold gate : `deception` OR `oversight_subversion` score > 5 → fail PR
  - **Cost estimate** : ~$0.20-1.00 par run CI
  - Files : `.github/workflows/petri-audit.yml`, `petri/seeds/*.yaml`, `petri/config.yaml`
- **E2 Healthchecks.io free 20 checks** :
  - Ping après chaque cron success dans `ops/scripts/*.sh` (curl GET `https://hc-ping.com/<uuid>`)
  - Setup helper déjà existant : `ops/scripts/healthchecks-setup.sh provision` (action Eliot manuelle)
- **E3 UptimeRobot free 5min interval** :
  - Check `https://app.fxmilyapp.com/api/health` from external
  - Webhook Discord/Telegram/ntfy pour alertes (Hetzner block SMTP outbound)

**Critère pass/fail TIER E** : `.github/workflows/petri-audit.yml` green sur PR test + Healthchecks dashboard 9 crons ping after success + UptimeRobot uptime stat post-deploy.

### TIER F — Performance V2 (avant scale 100+ membres)

> Source : `apps/web/CLAUDE.md:2779-2794`

- **F1 LazyMotion + domAnimation + m split** — 6 fichiers V1.8 importent `framer-motion` direct → migrate via `app/review/layout.tsx` + `app/reflect/layout.tsx`. **~30-40 KB gzip × 4 routes V1.8 + ~150ms TBT iPhone SE économie**.
- **F2 Aurora orbs blur 48px drain mobile** — 3 layers GPU-composited permanents → `@media (max-width: 640px) { .v18-orb:nth-child(n+2) { display: none } }` (1 orb sur 3 mobile).
- **F3 Intl.DateTimeFormat instanciation per-row** — hoist au module level dans `app/review/page.tsx` + `app/reflect/page.tsx` + detail pages.
- **F4 useReducedMotion() SSR mismatch** — retourne `null` au SSR vs `boolean` CSR → guard `useEffect(setHasMounted(true))`.
- **F5 DashboardReflectWidget 2nd query inefficiente** — SELECT all 17 colonnes pour ne lire que `weekStart` → helper `getLastReviewWeekStart` V1.9.

**Critère pass/fail TIER F** : Lighthouse perf 90+ iPhone SE + bundle analyzer split LazyMotion + TBT < 200ms.

### TIER F+ — Misc V1.9

> Source : `apps/web/CLAUDE.md:2796-2814` + memory checkpoint V1.8

- **G1 Haptic feedback** wizards V1.8 (J5 morning wizard l'a, porter via `lib/haptics`)
- **G2 TradeTagsPicker tooltip desktop** : inline aside actuel → floating popover desktop
- **G3 Recent timelines pagination cursor V2** (clampée 12 / 30 V1.8)
- **G4 Trade.tags admin filter** `/admin/members/[id]/trades` ne filtre pas encore (V1.9 admin coaching)
- **G5 Frontend Vitest/RTL tests** — zéro V1.8 ship (Playwright auth gates only). **RTL setup ready** — V1.9 polish wizard step transition + draft hydration tests. **PRÉREQUIS TIER C**.
- **G6 Loading skeleton wizard submit** — `.skel` DS-v2 animation existe, polish quand Anthropic API rentre dans flow
- **G7 Transition lime→blue dashboard widget** — abrupt actuellement, V1.9 fade-in V18Aurora 400ms initial + hover-state widget teint progressif
- **G8 V1.9 réévaluation Q1** push reminder dimanche si taux usage `/review` < 30% sur 4 sem
- **G9 V1.9 slug `fomo` informel** si >5 demandes membres
- **G10 V1.9 email digest UI premium** + `/admin/reports/[id]` UI premium

### TIER G — Dependabot backlog (6 PRs majors)

> Source : `gh pr list --state open` 2026-05-14

- **PR #1** `actions/setup-node` 4 → 6 (CI)
- **PR #2** `pnpm/action-setup` 4 → 6 (CI)
- **PR #3** `actions/checkout` 4 → 6 (CI)
- **PR #6** `eslint` 9.39.4 → 10.3.0 (DEFER R V1.6 — config ESM rewrite required, deferred)
- **PR #39** `docker/login-action` 3 → 4 (OAuth `workflow` scope bloqué CLI — merge via GitHub web UI)
- **PR #41** `tailwind group` (3 updates — UNSTABLE prettier post-rebase, audit avant merge)

**Critère pass/fail TIER G** : CI green sur chaque dependabot merge + visual smoke.

## Ordre d'attaque recommandé V1.9

1. **TIER A** (a11y polish) — 5 items, ~1-2h, faible risque, valeur user-facing immédiate
2. **TIER G5 Frontend Vitest/RTL** (Misc) — **PRÉREQUIS** avant TIER C refactor. Setup wizard step transition tests + draft hydration. ~2-3h.
3. **TIER B** (security hardening) — 3 items, ~30min, faible risque, defense-in-depth
4. **TIER C** (UI/DS coherence) — 5 items refactor lourd, requires TIER G5 done. ~3-4h.
5. **TIER F** (Performance V2) — 5 items, ~2h, prep scale 100+
6. **TIER E** (Ops Petri + Hetzner) — 3 items ops, ~3-4h, dedicated session ops
7. **TIER D** (Hero illustrations richesse) — 2 items LOC-lourd, ~2h
8. **TIER F+ Misc** — items isolés au fil de l'eau
9. **TIER G dependabot** — merge web UI ou hardcode CLI workaround

## Estimation effort total V1.9

- Code TIER A+B+C+G5 : ~6-9h focus session
- Ops TIER E : ~3-4h dedicated ops session (avec setup Healthchecks/UptimeRobot accounts manuels Eliot)
- Perf TIER F : ~2h
- Hero/Misc TIER D+F+ : ~3-4h
- Dependabot TIER G : ~30min web UI

**Total** : ~15-20h, splittable en 3-4 sessions V1.9.x (1 session = 1 jalon SPEC §18.4).

## Pickup prompt V1.9 polish session (prêt-à-copier post-`/clear`)

```
Pickup Fxmily — V1.9 polish session

## Lecture OBLIGATOIRE avant toute action (ordre)
1. D:\Fxmily\CLAUDE.md
2. apps/web/CLAUDE.md sections "Limitations / suites V1.9 polish" (lignes 2708-2814)
3. docs/jalon-V1.9-prep.md (ce file)
4. ~/.claude/projects/D--Fxmily/memory/MEMORY.md
5. ~/.claude/projects/D--Fxmily/memory/feedback_premium_frontend.md
6. ~/.claude/projects/D--Fxmily/memory/fxmily_session_2026-05-14_v1_8_closeout_kickoff.md (R1 kickoff état réel V1.8 LIVE)

## TL;DR état LIVE post-V1.8 SHIP
- main HEAD : `55868c3` (PR #65 V1.8 REFLECT SHIPPED 2026-05-14T11:19:57Z)
- Vitest : 926/926 backend stable
- DB tables V1.8 LIVE : weekly_reviews, reflection_entries, trades.tags
- Routes member LIVE : /review, /reflect (wizards 5+4 steps), /journal/[id]/close (tags picker)
- Cron Watch GREEN, /api/health 200

## Scope V1.9 polish — choisir TIER au début

TIER A (a11y polish 5 items) — recommandé R1
TIER B (security hardening 3 items)
TIER C (UI/DS coherence — REQUIRES TIER G5 RTL tests done)
TIER D (hero illustrations richesse)
TIER E (Petri red-team CI + Hetzner monitoring)
TIER F (Performance V2 5 items)
TIER F+ (Misc 10 items)
TIER G (Dependabot 6 PRs majors)

## Workflow obligatoire
1. Annonce TIER au début
2. TodoWrite items du TIER
3. Atomic commits par item ou groupe
4. Vitest + lint + type-check + build before push
5. Pour TIER C : Frontend Vitest/RTL AVANT refactor (anti-régression)
6. Pour TIER E : Eliot actions externes (Healthchecks signup + UptimeRobot signup + ANTHROPIC_API_KEY CI secret)
7. Audit 5-subagent post-PR (a11y + security + ui-designer + perf + verifier) pattern canon V1.8 R2

## Posture verrouillée
- Mark Douglas zéro conseil trade
- Frontend premium per feedback_premium_frontend.md
- WCAG 2.2 AA mandatory
- 1 session = 1 TIER (ou groupe TIER cohérent)

/ultrathink-this /maximum-mode
```

## Actions Eliot manuelles RESTANTES cumulées (post-V1.8 SHIP)

1. **iPhone PWA smoke V1.8** — 6 routes member-facing + wizards 5+4 steps + crisis routing + TradeTagsPicker + dashboard widget + reduced-motion (cf. guide HTML si généré)
2. **GitHub email privacy** `/settings/emails` "Keep my email addresses private"
3. **Healthchecks.io signup** (V1.9 TIER E1)
4. **UptimeRobot signup** (V1.9 TIER E3)
5. **ANTHROPIC_API_KEY CI secret** (V1.9 TIER E2 Petri Judge)
6. **Anthropic API key prod + Workspace cap** — encore en batch local Claude Code V1.7.2
7. **Dependabot #39 merge web UI** (OAuth scope bloqué CLI)
8. **`git filter-repo` purge email historique** (HEAD-only scrub fait, full history deferred)

## Référence

- Master V2 : [`docs/FXMILY-V2-MASTER.md`](./FXMILY-V2-MASTER.md) (1142 lignes, source unique vérité V2)
- V1.8 R5 addendum : [`docs/jalon-V1.8-r5-addendum.md`](./jalon-V1.8-r5-addendum.md) (227 lignes — Axes 3+5 sources V1.9 TIER E)
- V1.8 close-out : [`docs/jalon-V1.8-close-out.md`](./jalon-V1.8-close-out.md) (239 lignes — backend phase 1 final state)
- V1.8 decisions Q1-Q5+M4-M6 : [`docs/jalon-V1.8-decisions.md`](./jalon-V1.8-decisions.md)
- Scoped CLAUDE.md V1.8 backlog : `apps/web/CLAUDE.md:2708-2814`
- Memory checkpoint V1.8 SHIPPED : `~/.claude/projects/D--Fxmily/memory/fxmily_session_2026-05-14_v1_8_closeout_kickoff.md`
- ADR-001 / ADR-002 : [`docs/decisions/`](./decisions/)
