# ADR-002 — V2 calibration recommendations from prop-firm empirical data 2024-2026

- **Status** : Proposed (2026-05-09) — to be Accepted in V2 after observing the V1 cohort distribution for ≥3 months.
- **Supersedes** : nothing yet — V1 keeps the [ADR-001](ADR-001-scoring-constants-pragmatic-heuristics.md) values.
- **Authors** : Claude Code (J10 Phase ω deep-research subagent on retail trading psychology + prop-firm 2024-2026 disclosed statistics) + Eliot Pena (review pending).

---

## Context

[ADR-001](ADR-001-scoring-constants-pragmatic-heuristics.md) accepted the four
`FULL_SCALE` scoring constants as pragmatic heuristics without empirical
backing. The deep-research pass on 2026-05-09 did not find peer-reviewed
2024-2026 papers validating those exact values, BUT it surfaced
**prop-firm disclosed cohort statistics** (TopStep, FTMO, FunderPro,
Earn2Trade, The Funded Trader) that bound the realistic distribution
better than the ADR-001 calibration suggests.

This ADR records the V2 calibration recommendation for when the trigger
fires (cohort percentile drift, peer-reviewed publication, ≥5 user
complaints, V2 launch with 100+ members).

---

## Findings (2024-2026 prop-firm empirical, not peer-reviewed)

| Source                                          | Stat                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| TopStep 2024                                    | 16.86 % of Trading Tests pass to PRO (single-phase).                                  |
| FTMO 2024 (estimated, not officially disclosed) | 10–12 % combined Challenge + Verification.                                            |
| Earn2Trade 2024                                 | 10.42 % verified.                                                                     |
| The Funded Trader (March 2025)                  | 5–10 % pass, ~20 % of funded receive a payout.                                        |
| Standard caps (industry)                        | 5 % daily DD, **10 % overall DD**.                                                    |
| Failure mode dominant (FunderPro 2025 analysis) | ~70 % of failures come from loss-limit hits (DD or daily loss), not strategy failure. |

Combined with research on mood/sleep variability (Palmer 2024 meta-analysis,
npj Digital Medicine 2,115-intern wearable cohort, MDPI Sensors 2024):

- **Healthy adult mood-stddev on a 1-10 scale ≈ 1.0 to 1.5.** A stddev of
  4 would be quasi-pathological in clinical terms (= SD ≈ 1.3 on a
  normalized z-distribution). Subjective sleep self-reports do NOT
  predict objective sleep, but objective measures DO predict executive
  function (Windmill et al. 2024 / Sci Reports).

---

## V2 calibration recommendations

| Constant                | V1 (ADR-001) | V2 proposed     | Empirical anchor                                    |
| ----------------------- | ------------ | --------------- | --------------------------------------------------- |
| `STDDEV_FULL_SCALE`     | 4            | **2.5**         | Healthy mood stddev 1.0-1.5; 2.5 marks dérégulation |
| `EXPECTANCY_FULL_SCALE` | 1 R          | **1 R** ✅ keep | No 2024-2026 study contradicts the Tharp anchor     |
| `PF_FULL_SCALE`         | 3            | **2.5**         | PF=3 often overfit; 2.5 is excellent realistic      |
| `DD_FULL_SCALE`         | 15 R         | **10 R**        | Aligned with prop-firm 10 % equity overall DD cap   |

The V2 changes are **monotone-preserving** (a strict trader who scored
85 under V1 will score similar under V2; a sloppy trader who scored 35
will score lower under V2 because the bar moved). UX impact: V1 cohort
that re-baselines at V2 will see numerically lower scores **on the
emotional-stability and consistency dimensions**, matching the harder
empirical reality.

---

## Decision (proposed)

When V2 fires (cohort observation triggers per ADR-001 §"Trigger for
re-evaluation"), apply the four V2 values in a single migration commit.
At the same time:

1. **Replay all historical `BehavioralScore` snapshots offline** under
   V2 constants, persist them in a new column `componentsV2` (or
   versioned `BehavioralScore` rows), so the dashboard can show both
   V1-historical and V2-current trends without losing context.
2. **Add a transparency banner** on the dashboard (week of V2 ship):
   "Your scores have been recalibrated against prop-firm empirical
   data. See [transparency docs](#)." Link to a public ADR-002 page.
3. **Update [ADR-001 §Trigger for re-evaluation](ADR-001-scoring-constants-pragmatic-heuristics.md#trigger-for-re-evaluation)**
   with a back-link to ADR-002.

---

## Sources cited

- [TopStep 2024 pass rate](https://www.topstep.com/funded-account-statistics/)
- [FunderPro 2025 prop-firm pass rate analysis](https://funderpro.com/blog/prop-trading-pass-rates-in-2025-what-the-data-really-shows/)
- [QuantVPS 2026 prop-firm statistics](https://www.quantvps.com/blog/prop-firm-statistics)
- [TraderSecondBrain 2026 — FTMO vs Topstep](https://traderssecondbrain.com/guides/ftmo-vs-topstep)
- [Palmer et al. 2024 — Sleep loss + emotion meta-analysis (PsycNet)](https://psycnet.apa.org/record/2024-34959-001)
- [npj Digital Medicine — Sleep variability & depression cohort 2,115 interns](https://www.nature.com/articles/s41746-021-00400-z)
- [Sensors 2024 systematic review — Daily mood/affect monitoring](https://www.mdpi.com/1424-8220/24/14/4701)
- [Windmill et al. 2024 — Subjective vs objective sleep (Scientific Reports)](https://www.nature.com/articles/s41598-024-80683-w)
- [Pakhrudin et al. 2020 — Trader Hub System with Tharp expectancy (Malaysian Journal of Computing)](https://www.researchgate.net/publication/343523622)

**Honesty disclaimer** : these recommended values are still heuristics
anchored on prop-firm disclosed numbers (which themselves are marketing-
adjacent, not peer-reviewed). A formal calibration would require the V2
trigger condition to fire (cohort distribution drift) before any change.
This ADR exists to **document the candidate values and their rationale**
so the V2 decision is not re-litigated from scratch.
