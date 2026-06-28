/**
 * AI reports for the demo account — the two persisted Claude syntheses every
 * member/admin reporting surface reads:
 *
 *   - `WeeklyReport` (admin digest, `/admin`): ~5 recent civil weeks. Each is
 *     the Sonnet weekly recap with a `summary`, `risks`/`recommendations`
 *     (string[]), a `patterns` OBJECT (emotion/sleep/session/discipline), cost
 *     tracking + the "sent to admin" dispatch stamp.
 *   - `MonthlyDebrief` (member, `/debrief-mensuel` + dashboard nudge): the last
 *     3 civil months. Dual-section synthesis (progression / réel / entraînement)
 *     with a `patterns` OBJECT (monthOverMonth/realTrend/trainingRhythm/
 *     disciplineTrend). The OLDEST debriefs are already read (`seenAt` set) and
 *     the MOST RECENT is unread (`seenAt = null`) so the `MonthlyDebriefWidget`
 *     dashboard nudge lights up ("ton débrief est prêt").
 *
 * Shapes are pinned to the persisted Zod contracts (`lib/schemas/weekly-report`
 * + `lib/schemas/monthly-debrief`): `risks`/`recommendations` are `string[]`
 * (each 20–300 chars) and `patterns` is a flat object of OPTIONAL ≤400-char
 * strings — never an array. The read edges (`monthly-debrief/service.ts`,
 * `weekly-report/service.ts`) narrow these JSON columns to exactly those types.
 *
 * Both writes UPSERT on their `@@unique` ([userId, weekStart] / [userId,
 * monthStart]) so a re-run is idempotent and never duplicates. The story trends
 * upward across the window (mirror of `core.ts`): an improving, calmer trader.
 *
 * `claudeModel = 'claude-code-local'` is the canonical batch-local Max value —
 * the reader maps it to "Claude — subscription locale" (0€ marginal, kept for
 * traceability). `costEur` is a Prisma `Decimal` fed a plain number; the token
 * counts are `Int`.
 */
import {
  type SeedCtx,
  makePrng,
  mondayOf,
  firstOfMonth,
  lastOfMonth,
  at,
  pick,
  round,
  clampInt,
} from './_shared.js';

// =============================================================================
// Content pools — coherent, French, calm Mark Douglas posture (no market advice,
// process/behaviour only). Every item is ≥20 chars (the Zod `safeItemSchema`
// floor) and ≤300 (its ceiling); pattern values stay ≤400.
// =============================================================================

const WEEKLY_SUMMARIES = [
  'Semaine disciplinée : le membre a respecté son plan sur la majorité des trades et coupé ses pertes sans hésiter. Le journal montre une régularité de check-ins en hausse et une gestion du risque resserrée autour de 1 % par position.',
  'Bonne tenue émotionnelle cette semaine. Quelques entrées un peu précipitées en session de Londres, mais aucune position vengeresse après une perte. Le respect du stop progresse et les routines du matin sont presque systématiques.',
  'Semaine de consolidation : moins de trades, plus de sélectivité. Le membre a privilégié les setups A et passé son tour sur les configurations douteuses. La constance des bilans du soir reste le point fort du moment.',
  'Le membre traverse une phase calme et mesurée. Le respect du plan est élevé, le sizing est constant, et les émotions déclarées restent majoritairement sereines. Un léger relâchement sur l’analyse de marché du matin à surveiller.',
  'Excellente semaine côté process : plan respecté, stop tenu, aucune sur-exposition. Le membre verbalise mieux ses intentions du matin et les confronte à son exécution le soir. La progression de discipline est nette sur le mois.',
  'Semaine contrastée : un bon début puis deux journées plus nerveuses en fin de semaine. Le membre a néanmoins gardé son sizing sous contrôle et n’a pas cherché à se refaire. Les bilans du soir restent honnêtes et complets.',
];

const WEEKLY_RISKS = [
  'Quelques entrées anticipées en début de session, avant la confirmation du plan : à recadrer pour éviter le FOMO récurrent.',
  'Deux journées sans bilan du soir cette semaine : la régularité des check-ins reste fragile en fin de semaine.',
  'Légère tendance à augmenter la taille après une série gagnante : surveiller le sizing pour qu’il reste constant.',
  'L’analyse de marché du matin a été sautée à deux reprises : la routine de préparation s’est relâchée.',
  'Une position gardée un peu trop longtemps malgré l’invalidation du plan : travailler la sortie mécanique au stop.',
];

const WEEKLY_RECOS = [
  'Continuer à n’entrer qu’après validation complète du plan : la patience reste le meilleur filtre cette semaine.',
  'Reprendre le bilan du soir chaque jour, même bref : c’est l’habitude qui ancre le mieux la discipline acquise.',
  'Fixer un sizing maximum à l’avance et s’y tenir, indépendamment du résultat des trades précédents.',
  'Garder la routine d’analyse du matin systématique : elle conditionne la qualité des entrées du reste de la journée.',
  'Verbaliser l’intention du matin et la relire au moment d’exécuter : cela réduit les écarts plan / action.',
];

/// Weekly `patterns` — the OBJECT shape persisted by `weeklyReportPatternsSchema`
/// ({ emotionPerf?, sleepPerf?, sessionFocus?, disciplineTrend? }, each ≤400).
const WEEKLY_PATTERN_SETS: Array<{
  emotionPerf?: string;
  sleepPerf?: string;
  sessionFocus?: string;
  disciplineTrend?: string;
}> = [
  {
    emotionPerf: 'Calme : 71 % de plans respectés vs 48 % quand FOMO déclaré, sur 11 trades.',
    sessionFocus: '64 % des trades en session de Londres cette semaine.',
    disciplineTrend: 'Respect du plan 78 % (vs 69 % la semaine précédente).',
  },
  {
    sleepPerf: 'Nuits < 6 h → respect du stop en baisse, sur 4 journées concernées.',
    sessionFocus: 'Répartition équilibrée Londres / New York cette semaine.',
    disciplineTrend: 'Respect du plan 82 % (vs 78 % la semaine précédente).',
  },
  {
    emotionPerf: 'Sérénité déclarée corrélée à une sélectivité plus forte des setups A.',
    disciplineTrend: 'Respect du plan 85 % (vs 82 % la semaine précédente).',
  },
  {
    emotionPerf: 'Aucune position vengeresse cette semaine, même après les pertes.',
    sleepPerf: 'Sommeil médian 7 h : stabilité émotionnelle plus marquée.',
    sessionFocus: '58 % des trades en session de New York.',
    disciplineTrend: 'Respect du plan 88 % (vs 85 % la semaine précédente).',
  },
  {
    sessionFocus: '70 % des trades concentrés sur l’overlap Londres / New York.',
    disciplineTrend: 'Respect du plan 90 % (vs 88 % la semaine précédente).',
  },
];

// -----------------------------------------------------------------------------
// Monthly debrief content
// -----------------------------------------------------------------------------

const MONTHLY_PROGRESSION = [
  'Ce mois marque une vraie consolidation de tes habitudes. Ta discipline mesurée passe de 64 % à 78 % de plans respectés, et tes bilans du soir sont devenus quasi quotidiens. Tu réagis plus calmement aux pertes : le réflexe de te refaire a presque disparu. Le chemin reste celui d’un process tenu jour après jour, pas d’un résultat — et c’est exactement ce que montrent tes données.',
  'Tu prends de la hauteur. Sur ce mois, ta stabilité émotionnelle progresse et tes entrées sont plus sélectives : moins de trades, mais mieux préparés. Tu verbalises tes intentions le matin et les confrontes le soir, ce qui réduit l’écart entre ton plan et ton exécution. La régularité que tu installes est la fondation la plus solide de ta progression.',
  'Mois de maturité : ta gestion du risque est désormais constante autour de 1 % par position, et tu passes ton tour sur les configurations douteuses sans frustration. Les scores comportementaux confirment la tendance — discipline et constance montent ensemble. Continue d’ancrer ces routines : c’est leur répétition, pas leur intensité, qui construit ton edge.',
];

const MONTHLY_REAL = [
  'Côté trading réel, le mois est solide sur le plan du comportement : tu as coupé tes pertes au stop sans hésiter et respecté ton sizing même après les séries perdantes. Ton R moyen reste positif sur les trades clôturés, mais l’essentiel est ailleurs : tu as exécuté ton plan, pas tes émotions. Quelques entrées un peu rapides en session de Londres restent le point à lisser.',
  'Sur le réel, ta sélectivité a payé : tu as privilégié les setups de qualité A et évité les prises de position impulsives. Le respect du plan grimpe et tes pertes sont restées petites et maîtrisées. Le travail du mois prochain porte sur la constance de ta préparation du matin, qui conditionne la qualité de tes entrées.',
  'Ton trading réel reflète un trader plus posé : aucune position vengeresse ce mois, un risque tenu, et des sorties mécaniques au stop. Le P&L comportemental est sain — ce sont tes décisions qui s’améliorent, pas seulement les résultats. Garde ce cadre : il transforme la chance en process répétable.',
];

const MONTHLY_TRAINING = [
  'Côté entraînement, ta pratique est régulière : tu as enchaîné plusieurs sessions de backtest ce mois, en gardant un rythme constant sans forcer. C’est exactement l’usage attendu du mode entraînement — répéter le geste, ancrer la lecture, sans pression de résultat. Ta dernière session remonte à quelques jours seulement : la pratique reste vivante.',
  'Ton entraînement progresse en régularité. Tu reviens sur le backtest plusieurs fois par semaine, ce qui installe la mécanique de décision sans enjeu réel. Continue à espacer raisonnablement tes sessions : c’est la constance, pas le volume brut, qui transfère le mieux vers ton exécution réelle.',
  'La pratique d’entraînement est bien installée ce mois : sessions régulières, rythme tenu, aucune coupure longue. Tu utilises l’environnement protégé pour répéter sans pression — c’est le rôle exact de cet espace, isolé de ton edge réel. Garde ce réflexe d’y revenir quand tu veux tester un geste à froid.',
];

const MONTHLY_RISKS = [
  'La préparation du matin reste irrégulière en fin de mois : quelques journées sans analyse avant les premières entrées.',
  'Une légère tendance à entrer plus tôt en session de Londres, avant la confirmation complète du plan, à recadrer.',
  'Le rythme des bilans du soir faiblit le week-end : c’est la régularité globale qui en pâtit sur la durée.',
];

const MONTHLY_RECOS = [
  'Ancrer la routine d’analyse du matin chaque jour de trading : elle conditionne la qualité de toutes tes entrées suivantes.',
  'Maintenir un sizing maximum fixé à l’avance et constant, indépendamment des résultats de la veille.',
  'Poursuivre les bilans du soir sans interruption, même brefs : c’est l’habitude qui consolide le mieux ta discipline.',
  'Continuer à n’entrer qu’après validation complète du plan : ta patience est devenue ton meilleur filtre ce mois.',
];

/// Monthly `patterns` — the OBJECT persisted by `monthlyDebriefPatternsSchema`
/// ({ monthOverMonth?, realTrend?, trainingRhythm?, disciplineTrend? }, ≤400).
const MONTHLY_PATTERN_SETS: Array<{
  monthOverMonth?: string;
  realTrend?: string;
  trainingRhythm?: string;
  disciplineTrend?: string;
}> = [
  {
    monthOverMonth: 'Discipline 64 % → 78 % de plans respectés sur le mois.',
    realTrend: 'Aucune position vengeresse après une perte ce mois.',
    trainingRhythm: 'Pratique d’entraînement régulière, plusieurs sessions par semaine.',
    disciplineTrend: 'Respect du plan 78 % (vs 69 % le mois précédent).',
  },
  {
    monthOverMonth: 'Stabilité émotionnelle 67 % → 79 %, constance en hausse.',
    realTrend: 'Sélectivité accrue : davantage de setups A, moins d’entrées impulsives.',
    trainingRhythm: 'Rythme d’entraînement soutenu, dernière session il y a quelques jours.',
    disciplineTrend: 'Respect du plan 82 % (vs 78 % le mois précédent).',
  },
  {
    monthOverMonth: 'Constance 71 % → 84 % : routines mieux ancrées sur la durée.',
    realTrend: 'Risque tenu à ~1 % par position, sorties mécaniques au stop.',
    trainingRhythm: 'Pratique régulière sans coupure longue ce mois.',
    disciplineTrend: 'Respect du plan 88 % (vs 82 % le mois précédent).',
  },
];

// =============================================================================
// Cost helpers — plausible batch-local Claude Max usage (0€ marginal, kept for
// traceability/audit). Tokens are `Int`; `costEur` is a `Decimal` (number ok).
// =============================================================================

function weeklyCost(rand: () => number): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costEur: number;
} {
  const inputTokens = clampInt(9000 + rand() * 4000, 0, 2_000_000);
  const outputTokens = clampInt(700 + rand() * 500, 0, 50_000);
  const cacheReadTokens = clampInt(rand() * 6000, 0, 2_000_000);
  const cacheCreateTokens = clampInt(rand() * 2000, 0, 2_000_000);
  // Indicative sub-cent figure (6-dec precision). Local Max ⇒ ~0€, kept for audit.
  const costEur = round(0.01 + rand() * 0.02, 6);
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens, costEur };
}

function monthlyCost(rand: () => number): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  costEur: number;
} {
  const inputTokens = clampInt(28000 + rand() * 9000, 0, 2_000_000);
  const outputTokens = clampInt(1500 + rand() * 800, 0, 50_000);
  const cacheReadTokens = clampInt(rand() * 14000, 0, 2_000_000);
  const cacheCreateTokens = clampInt(rand() * 5000, 0, 2_000_000);
  const costEur = round(0.03 + rand() * 0.04, 6);
  return { inputTokens, outputTokens, cacheReadTokens, cacheCreateTokens, costEur };
}

const CLAUDE_MODEL = 'claude-code-local';

// =============================================================================
// Seeder
// =============================================================================

export async function seedReports(ctx: SeedCtx): Promise<Record<string, number>> {
  const { db, userId, now } = ctx;
  // Dedicated PRNG stream (per `core.ts` convention) — stable, isolated.
  const rand = makePrng(901);

  // ---------------------------------------------------------------------------
  // Weekly reports (admin digest) — ~5 most recent COMPLETE civil weeks.
  // Skip the current in-progress week (weeksAgo 0); start at the last full week.
  // ---------------------------------------------------------------------------
  const WEEKLY_COUNT = 5;
  let weekly = 0;

  for (let i = 0; i < WEEKLY_COUNT; i++) {
    const weeksAgo = i + 1; // 1 = last complete week … WEEKLY_COUNT = oldest
    const weekStart = mondayOf(now, weeksAgo); // @db.Date Monday
    const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000); // Sunday @db.Date

    // Newest first in the pools (index 0 = freshest week).
    const summary = WEEKLY_SUMMARIES[i] ?? pick(rand, WEEKLY_SUMMARIES);
    const patterns = WEEKLY_PATTERN_SETS[i] ?? pick(rand, WEEKLY_PATTERN_SETS);

    // 2–3 risks + 2–3 recommendations, deterministically picked (distinct).
    const risks = pickDistinct(rand, WEEKLY_RISKS, 2 + clampInt(rand() * 1.4, 0, 1));
    const recommendations = pickDistinct(rand, WEEKLY_RECOS, 2 + clampInt(rand() * 1.4, 0, 1));

    const cost = weeklyCost(rand);
    // The admin digest was dispatched a couple of days after the week closed.
    const generatedAt = at(now, weeksAgo * 7 - 8, 6, 15); // Monday after the week, ~06:15 UTC
    const sentToAdminAt = new Date(generatedAt.getTime() + 30 * 60_000);

    await db.weeklyReport.upsert({
      where: { userId_weekStart: { userId, weekStart } },
      create: {
        userId,
        weekStart,
        weekEnd,
        generatedAt,
        summary,
        risks,
        recommendations,
        patterns,
        claudeModel: CLAUDE_MODEL,
        inputTokens: cost.inputTokens,
        outputTokens: cost.outputTokens,
        cacheReadTokens: cost.cacheReadTokens,
        cacheCreateTokens: cost.cacheCreateTokens,
        costEur: cost.costEur,
        sentToAdminAt,
        sentToAdminEmail: 'eliott@fxmily.local',
        emailMessageId: `demo-weekly-${weeksAgo}@resend`,
      },
      // Idempotent: never overwrite an existing demo row on re-run.
      update: {},
    });
    weekly++;
  }

  // ---------------------------------------------------------------------------
  // Monthly debriefs (member) — the last 3 COMPLETE civil months. The OLDEST
  // are already read (`seenAt` set → quiet); the MOST RECENT is unread
  // (`seenAt = null`) so the dashboard `MonthlyDebriefWidget` nudge lights up.
  // ---------------------------------------------------------------------------
  const MONTHLY_COUNT = 3;
  let monthly = 0;

  for (let i = 0; i < MONTHLY_COUNT; i++) {
    const monthsAgo = i + 1; // 1 = last complete month … MONTHLY_COUNT = oldest
    const monthStart = firstOfMonth(now, monthsAgo); // @db.Date 1st
    const monthEnd = lastOfMonth(now, monthsAgo); // @db.Date last calendar day

    // Pools are newest-first (index 0 = most recent month).
    const progressionNarrative = MONTHLY_PROGRESSION[i] ?? pick(rand, MONTHLY_PROGRESSION);
    const summaryReal = MONTHLY_REAL[i] ?? pick(rand, MONTHLY_REAL);
    const summaryTraining = MONTHLY_TRAINING[i] ?? pick(rand, MONTHLY_TRAINING);
    const patterns = MONTHLY_PATTERN_SETS[i] ?? pick(rand, MONTHLY_PATTERN_SETS);

    const risks = pickDistinct(rand, MONTHLY_RISKS, 1 + clampInt(rand() * 1.4, 0, 1));
    const recommendations = pickDistinct(rand, MONTHLY_RECOS, 2 + clampInt(rand() * 1.4, 0, 1));

    const cost = monthlyCost(rand);
    // Generated on the 1st of the FOLLOWING month (monthsAgo - 1 boundary).
    const followingMonthFirst = firstOfMonth(now, monthsAgo - 1);
    const generatedAt = new Date(followingMonthFirst.getTime() + 7 * 3_600_000); // ~07:00 UTC

    // The most recent debrief (i === 0) stays UNREAD (seenAt null) → nudge on.
    const isNewest = i === 0;
    const sentToMemberAt = new Date(generatedAt.getTime() + 20 * 60_000);
    const pushEnqueuedAt = new Date(generatedAt.getTime() + 5 * 60_000);
    const seenAt = isNewest
      ? null
      : new Date(generatedAt.getTime() + (3 + clampInt(rand() * 3, 0, 3)) * 3_600_000);

    await db.monthlyDebrief.upsert({
      where: { userId_monthStart: { userId, monthStart } },
      create: {
        userId,
        monthStart,
        monthEnd,
        generatedAt,
        progressionNarrative,
        summaryReal,
        summaryTraining,
        risks,
        recommendations,
        patterns,
        claudeModel: CLAUDE_MODEL,
        inputTokens: cost.inputTokens,
        outputTokens: cost.outputTokens,
        cacheReadTokens: cost.cacheReadTokens,
        cacheCreateTokens: cost.cacheCreateTokens,
        costEur: cost.costEur,
        sentToMemberAt,
        sentToMemberEmail: 'demo@fxmily.local',
        pushEnqueuedAt,
        // `seenAt` omitted when null (exactOptionalPropertyTypes-safe: the
        // column is nullable with no default, so an absent key persists NULL).
        ...(seenAt ? { seenAt } : {}),
      },
      update: {},
    });
    monthly++;
  }

  ctx.log(
    `  AI reports: ${weekly} weekly (admin) + ${monthly} monthly debriefs (newest unread → dashboard nudge)`,
  );
  return { weeklyReports: weekly, monthlyDebriefs: monthly };
}

// =============================================================================
// Local helper — deterministically pick `n` DISTINCT items from a pool.
// =============================================================================

function pickDistinct<T>(rand: () => number, pool: readonly T[], n: number): T[] {
  const count = Math.min(n, pool.length);
  const remaining = [...pool];
  const out: T[] = [];
  for (let k = 0; k < count; k++) {
    const idx = Math.floor(rand() * remaining.length);
    const item = remaining[idx];
    if (item === undefined) break; // unreachable (idx in range) — strict-TS guard
    out.push(item);
    remaining.splice(idx, 1);
  }
  return out;
}
