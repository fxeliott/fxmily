# ADR-001 — Scoring constants are pragmatic heuristics, not empirically validated

- **Status** : Accepted (2026-05-09)
- **Context window** : Phase V/W of Jalon 10 + pre-V1 cohort observation
- **Authors** : Claude Code (J10 Phase ω session) + Eliot Pena (review pending)
- **Supersedes** : —
- **Superseded by** : reopen post-V1 cohort (30+ members × 3 months) — see "Trigger for re-evaluation" below

---

## Context

The four behavioral score dimensions defined in [SPEC §7.11](../SPEC.md) are
combinations of weighted sub-scores. Several of those sub-scores require
mapping a continuous quantity (R-multiple expectancy, mood standard deviation,
profit factor, drawdown depth) onto a 0–100 scale via a `FULL_SCALE` constant.

The four constants currently in use (Phase V/W calibration, commits `a968a20`

- `905d659`) are:

| Constant                | File                                                                                | Value | Maps to score 100 when             |
| ----------------------- | ----------------------------------------------------------------------------------- | ----- | ---------------------------------- |
| `EXPECTANCY_FULL_SCALE` | [consistency.ts:83](../../apps/web/src/lib/scoring/consistency.ts)                  | `1`   | expectancy ≥ 1 R / trade           |
| `STDDEV_FULL_SCALE`     | [emotional-stability.ts:107](../../apps/web/src/lib/scoring/emotional-stability.ts) | `4`   | mood-stddev ≤ 0 (lower=better)     |
| `PF_FULL_SCALE`         | consistency.ts:85                                                                   | `3`   | profit factor ≥ 3                  |
| `DD_FULL_SCALE`         | consistency.ts:87                                                                   | `15`  | max drawdown ≥ 15 R (lower=better) |

The Phase V audit (2026-05-09 trading-expert subagent) established that the
**previous** values (`EXPECTANCY=3`, `STDDEV=8`) were qualitatively too lenient
or too strict for retail FX/index traders. The change to `EXPECTANCY=1` +
`STDDEV=4` aligned the per-trader output range with a defensible monotonic
shape. The audit cited:

- Van Tharp (_Trade Your Way to Financial Freedom_, ch.7) — "0.5 R / trade is
  excellent for a sustained 30-trade window".
- Brett Steenbarger (_Daily Trading Coach_) — "top-decile discretionary pros
  sustain 0.3–0.6 R / trade".

**However** : a deep-research pass on 2026-05-09 (web research subagent
covering SSRN, Journal of Behavioral Finance, peer-reviewed retail trading
literature 2020–2026, see citations below) confirms that **no published
empirical study quantifies these specific calibration values** for behavioral
scoring of retail traders.

The qualitative claims (Tharp's "0.5 R is excellent", Steenbarger's "0.3–0.6
R top decile") are themselves the synthesis of decades of practitioner
experience but they have not been reproduced as a controlled study with
sample size + confidence intervals. The constants we picked are a defensible
projection of those claims onto a 0–100 scale, not measurements.

This ADR exists so future maintainers (and Eliot post-cohort) understand that
**these constants are pragmatic heuristics calibrated to qualitative
expert claims, not measurements**. They will need re-validation against the
real cohort distribution once Fxmily has 30+ members × 3+ months of data.

---

## Decision

We **accept** the current values (`EXPECTANCY_FULL_SCALE=1`, `STDDEV=4`,
`PF=3`, `DD=15`) for V1 ship and the first cohort observation window.

We **commit** to:

1. **Document the heuristic nature** of these constants directly in the
   source comments (already done in commits `a968a20`).
2. **Capture per-member component values** in `BehavioralScore.components`
   JSON (already done — see schema.prisma `BehavioralScore` model).
3. **Re-evaluate against real-world distribution** once we have ≥30 active
   members × ≥3 months of `BehavioralScore` snapshots. The trigger is a
   monthly check of the percentile distribution: if 80%+ of the cohort
   scores < 30 on a dimension, the constant is too strict; if 80%+ scores
   > 70, it's too lenient.
4. **Never claim empirical backing** in user-facing copy. The dashboard
   already says "score relatif au cadre Mark Douglas / Tharp / Steenbarger,
   à interpréter en tendance" — this language is correct and stays.
5. **Record any future calibration change as a new ADR** that supersedes
   this one. The new ADR must cite the cohort-derived percentile data that
   triggered the change (no more pure literature calibration).

---

## Consequences

### Positive

- Transparency for Eliot + future maintainers: nobody pretends these
  constants have CI 95 % bounds. The behavioral score is decision support,
  not measurement.
- Decoupled from any specific study: when peer-reviewed empirical data does
  emerge, we incorporate it via a new ADR (no breaking change to the
  dashboard interpretation).
- Re-calibration trigger is mechanical (cohort percentile distribution) so
  the decision to revisit doesn't depend on Eliot remembering.

### Negative

- A statistically literate user might (rightly) point out that the dashboard
  scores are not validated. We accept this tradeoff because the cohort is
  closed (no public claims) and the disclaimer is in place.
- The first 30 members are effectively the calibration cohort — their
  experience may shift after re-calibration. Mitigation : `windowDays`
  field on `BehavioralScore` already supports per-snapshot lineage so
  historical scores can be replayed under new constants offline.

### Neutral

- The `WeeklyReport` IA prompt already includes the 4 scores as raw numbers
  without claiming statistical significance — Claude Sonnet 4.6 outputs
  qualitative coaching suggestions that don't depend on precise calibration.

---

## Alternatives considered

### A. Leave constants undocumented (status quo pre-Phase V)

**Rejected** because the Phase V audit revealed the previous values were
miscalibrated and the source code had no canonical record of why. Future
maintainers (or post-`/clear` Claude sessions) need to know the lineage.

### B. Defer all scoring to V2 with empirical calibration

**Rejected** because :

- It would block V1 ship of the dashboard widget (J6 critical-path).
- The dashboard provides real value as decision support even without
  calibration certainty.
- We'd lose the cohort-derived data that we'll need _for_ the calibration
  in V2.

### C. Use external benchmarks (Sharpe ratio, Sortino, Calmar)

**Rejected** because :

- Those metrics are designed for institutional fund evaluation, not
  individual retail trader behavioral feedback.
- Sharpe assumes a return distribution and a risk-free rate that don't
  apply on a 30-trade window.
- The 4 dimensions Fxmily measures (discipline, emotional stability,
  consistency, engagement) have no canonical institutional analog.

### D. Self-calibrate per trader (relative scoring)

**Rejected for V1** because :

- A new member would have no baseline → score undefined for the first
  30 days. UX-hostile.
- Defeats the cross-member coaching value (Eliot can't compare members).
- Reasonable for V2 once we have a credible cohort distribution to
  bootstrap from.

---

## Trigger for re-evaluation

Re-open this ADR (and write its successor) when **any** of the following
fires:

1. **Cohort percentile drift** : any monthly percentile check shows 80%+
   members scoring < 30 or > 70 on a single dimension.
2. **Peer-reviewed empirical study published** post 2026-05 with calibration
   values for any of the four dimensions on retail trader cohorts.
3. **User complaint pattern** : ≥5 distinct members raise the same
   "my score doesn't match my real performance" objection in 30 days.
4. **V2 launch with cohort > 100 members** : trigger a full re-calibration
   pass with the now-credible distribution.

---

## Sources cited (recherche web 2026-05-09)

- Van Tharp Institute — _Tharp Think Trading Concepts_ — <https://vantharpinstitute.com/tharp-think-trading-concepts/>
- _Trade Your Way to Financial Freedom_ (Van Tharp, 2007 ed.) — chapter 7 (expectancy formulas)
- _Daily Trading Coach_ (Brett Steenbarger, 2009) — synthesized at <https://www.ebc.com/forex/brett-n-steenbarger>
- _Trading Psychology 2.0_ summary — <https://bookmap.com/blog/trading-psychology-2-0-summary>
- P&L Ledger — _Expectancy & R-multiples plain-English guide_ — <https://www.pnlledger.com/expectancy-r-multiples-the-plain-english-guide/>
- _Trader Hub System Development Using Van K. Tharp Expectancy Theory_ (Malaysian Journal of Computing, 2020) — most rigorous published replication, no 2021–2026 follow-up — <https://www.researchgate.net/publication/343523622>

**Crucially** : SSRN + Google Scholar searches (2024–2026) for "behavioral
scoring retail trader" + "trading psychology metric calibration" returned
zero peer-reviewed studies validating any of the four `FULL_SCALE` values
on a retail trader cohort. The literature is qualitative.
