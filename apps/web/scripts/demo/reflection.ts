/**
 * REFLECT module of the demo dataset: the member-facing introspection layer —
 * weekly reviews (Sunday recap), Ellis ABCD cognitive reflections, and the
 * versioned weekly mindset self-assessment (QCM athlète).
 *
 * Story arc (coherent with the rest of the demo): a member who started the
 * window anxious / result-attached and grew, week over week, into a calm,
 * process-driven trader. Review texts, reflection reframes and mindset Likert
 * answers all trend upward across the window so `/review`, `/reflect` and
 * `/mindset` (radar + per-dimension trends) render an improving curve.
 *
 * Read paths respected (shapes verified, not guessed):
 *   - `/review`            → `listMyRecentReviews` (weekly_reviews).
 *   - `/reflect`           → `listRecentReflections` (last 30 d, [date desc,
 *                            createdAt desc]).
 *   - `/mindset`           → `loadMindsetDashboardData` → `computeMindsetProfile`
 *                            / `buildMindsetTrend` over `responses`.
 *
 * `MindsetCheck.responses` shape is THE contract: a flat `{ itemId: 1..5 }`
 * map keyed by the frozen instrument's 12 item ids (`d1_i1`…`d6_i2`), each an
 * INTEGER in [1, 5]. The pure aggregator ignores any non-integer / out-of-range
 * value (scoring that dimension `null`), so we emit only clean integers.
 *
 * Idempotent + re-runnable:
 *   - WeeklyReview / MindsetCheck → upsert on their `(userId, weekStart)` unique.
 *   - ReflectionEntry has NO unique → we `deleteMany({ userId })` first, then
 *     create, so a re-run never duplicates the timeline.
 *
 * Determinism: a dedicated `makePrng(801)` stream so adding/removing other
 * seeders never shifts these rows.
 */
import {
  CURRENT_MINDSET_INSTRUMENT,
  CURRENT_MINDSET_INSTRUMENT_VERSION,
} from '../../src/lib/mindset/instrument.js';

import {
  type SeedCtx,
  at,
  clampInt,
  dbDate,
  makePrng,
  mondayOf,
  pick,
  progress,
  WINDOW_DAYS,
} from './_shared.js';

// =============================================================================
// Content pools — evolving, process-oriented (never P&L, posture Mark Douglas)
// =============================================================================

/** Weekly-review copy, picked by maturity tier so the journal reads as growth. */
const REVIEW_EARLY = {
  biggestWin: [
    "J'ai tenu mon stop sur le trade de mardi alors que tout me poussait à l'élargir.",
    "J'ai réussi à fermer ma plateforme après deux pertes au lieu de vouloir me refaire.",
    "J'ai noté chaque trade dans le journal, même les moches.",
  ],
  biggestMistake: [
    "J'ai sauté ma checklist pré-trade jeudi à l'ouverture de Londres, et je suis entré sur un setup B.",
    "Après une perte mercredi, j'ai doublé la taille pour me refaire, exactement ce que je m'étais interdit.",
    "J'ai regardé mon P&L flottant toutes les cinq minutes au lieu de regarder le marché.",
  ],
  bestPractice: [
    "Quand j'ai respecté ma routine du matin, mes décisions de la journée ont été plus calmes.",
    "Écrire mon intention avant la séance m'a aidé à ne pas dévier.",
    null,
  ],
  lessonLearned: [
    'Le revenge-trading ne répare rien. Il ajoute une deuxième erreur à la première.',
    "Un setup B pris par impatience coûte plus cher qu'un setup A manqué.",
    "Mon problème n'est pas l'analyse, c'est l'exécution sous émotion.",
  ],
  nextWeekFocus: [
    'Une seule règle : pas de trade sans checklist validée à 100 %.',
    'Fermer la plateforme après deux pertes, sans exception.',
    'Écrire mon intention chaque matin avant la première bougie.',
  ],
} as const;

const REVIEW_MID = {
  biggestWin: [
    "J'ai laissé courir un trade jusqu'au TP sans toucher au stop, conformément au plan.",
    "J'ai passé une journée entière sans regarder mon P&L flottant.",
    "J'ai accepté de ne pas trader mardi : aucune condition réunie, donc rien.",
  ],
  biggestMistake: [
    "J'ai déplacé mon stop au seuil de rentabilité trop tôt par peur, et je me suis fait sortir avant le mouvement.",
    "J'ai pris un trade de corrélation en pensant doubler mon edge. C'était juste doubler mon risque.",
    "J'ai laissé la frustration d'un lundi raté déborder sur mes décisions de mardi.",
  ],
  bestPractice: [
    "Penser en séries de trades plutôt qu'au résultat isolé a vraiment désamorcé ma peur de perdre.",
    "Ma revue du soir est devenue automatique. C'est elle qui m'a fait repérer le pattern.",
    "J'ai relu mes règles avant chaque séance ; ça ancre la discipline.",
  ],
  lessonLearned: [
    "Bouger un stop par peur, c'est laisser l'émotion exécuter le trade à ma place.",
    'Mon edge se joue sur 50 trades, pas sur celui que je suis en train de regarder.',
    "La patience n'est pas de l'inaction : attendre ses conditions EST le trade.",
  ],
  nextWeekFocus: [
    'Ne plus jamais déplacer un stop sans raison écrite dans le plan.',
    'Continuer à raisonner en séries : noter le R, pas le ressenti.',
    'Limiter à un seul instrument par séance pour rester concentré.',
  ],
} as const;

const REVIEW_LATE = {
  biggestWin: [
    "J'ai exécuté toute la semaine exactement comme mon plan le prévoyait, zéro déviation.",
    "Une perte sèche lundi n'a rien changé à ma manière de trader le reste de la semaine.",
    "J'ai dit non à trois setups B sans la moindre frustration : juste pas mes conditions.",
  ],
  biggestMistake: [
    'Une seule entorse : un trade pris dix minutes avant une news, par habitude plus que par décision.',
    "J'ai légèrement augmenté ma taille après trois gains d'affilée, un reste de surconfiance à surveiller.",
    "J'ai écourté ma revue du soir jeudi parce que la journée avait été calme.",
  ],
  bestPractice: [
    'Séparer ma valeur personnelle du résultat du trade est devenu naturel : je peux reconnaître une erreur sans me juger.',
    "Mon calme post-perte vient d'une chose : je sais que mon edge est statistique, pas magique.",
    'Revenir au calme avant de reprendre, systématiquement, a supprimé le tilt de ma semaine.',
  ],
  lessonLearned: [
    "La discipline n'est plus un effort, c'est devenu l'état par défaut, et ça change tout.",
    'La surconfiance après une série de gains est aussi dangereuse que la peur après une perte.',
    "Le marché ne me doit rien ; mon travail est de bien exécuter, pas d'avoir raison.",
  ],
  nextWeekFocus: [
    'Garder le cap : process identique, pas de nouveauté, juste de la régularité.',
    'Surveiller la taille après une série de gains. La confiance ne doit pas gonfler le risque.',
    'Tenir la revue du soir même les jours calmes, sans exception.',
  ],
} as const;

/**
 * Ellis ABCD reflection templates by maturity tier. A=triggerEvent,
 * B=beliefAuto, C=consequence, D=disputation. Each field comfortably exceeds
 * the 10-char floor and stays well under the 2000-char cap.
 */
interface AbcdTemplate {
  readonly triggerEvent: string;
  readonly beliefAuto: string;
  readonly consequence: string;
  readonly disputation: string;
}

const ABCD_EARLY: readonly AbcdTemplate[] = [
  {
    triggerEvent: "J'ai pris une perte sur EURUSD dès le premier trade de la journée.",
    beliefAuto: "« Je suis nul, je vais encore tout perdre aujourd'hui. »",
    consequence: "Boule au ventre, j'ai voulu reprendre immédiatement pour me refaire.",
    disputation:
      'Une perte ne dit rien de ma valeur ni de ma journée. Mon plan prévoit des trades perdants ; un seul résultat ne définit pas mon edge.',
  },
  {
    triggerEvent: "J'ai vu le marché partir sans moi juste après avoir hésité à entrer.",
    beliefAuto: "« J'ai raté LE move, je dois rentrer maintenant ou je vais le regretter. »",
    consequence: 'FOMO intense, je suis entré en retard, hors plan, et je me suis fait sortir.',
    disputation:
      "Il y aura d'autres setups. Courir après un mouvement déjà parti, ce n'est pas trader, c'est réagir à la peur de rater.",
  },
  {
    triggerEvent:
      'Mon stop a été touché à quelques pips près avant que le marché reparte dans mon sens.',
    beliefAuto: "« Le marché est contre moi, c'est injuste. »",
    consequence:
      "Colère, j'ai serré mon prochain stop par dépit et je me suis fait sortir encore plus vite.",
    disputation:
      "Le marché n'a pas d'intention. Un stop touché est le coût normal de mon edge ; le placer correctement est ma seule responsabilité.",
  },
  {
    triggerEvent: "Après deux pertes d'affilée, j'ai regardé mon solde du compte.",
    beliefAuto: "« Je dois récupérer cet argent aujourd'hui. »",
    consequence:
      "J'ai augmenté ma taille sur le trade suivant, complètement hors gestion de risque.",
    disputation:
      "Le compte n'a pas de mémoire de la journée. Mon risque par trade est fixe précisément pour que deux pertes ne dictent pas la troisième.",
  },
];

const ABCD_MID: readonly AbcdTemplate[] = [
  {
    triggerEvent: "Un trade gagnant que j'avais bien analysé s'est retourné juste avant le TP.",
    beliefAuto: "« J'aurais dû sécuriser, je suis trop gourmand. »",
    consequence: "Déçu, j'ai été tenté de déplacer mes stops trop tôt sur les trades suivants.",
    disputation:
      "Laisser courir selon le plan reste la bonne décision même quand l'issue est défavorable. Je juge le process, pas le résultat d'un trade isolé.",
  },
  {
    triggerEvent: "Je n'ai trouvé aucun setup valable pendant toute la séance de Londres.",
    beliefAuto: "« Une journée sans trade, c'est une journée perdue. »",
    consequence: 'Ennui et envie de forcer une entrée juste pour « faire quelque chose ».',
    disputation:
      "Ne pas trader quand mes conditions ne sont pas réunies EST une décision de pro. La patience fait partie de l'edge, pas contre lui.",
  },
  {
    triggerEvent: "J'ai vu un autre trader poster un gros gain pendant ma séance.",
    beliefAuto: '« Je suis en retard, mon approche est trop lente. »',
    consequence: "J'ai voulu prendre plus de risque pour « rattraper », loin de mon plan.",
    disputation:
      "Je trade mon système, pas celui des autres. Comparer mon process à un résultat isolé d'autrui est une mesure qui n'a aucun sens.",
  },
];

const ABCD_LATE: readonly AbcdTemplate[] = [
  {
    triggerEvent:
      "Après trois trades gagnants d'affilée, j'ai senti monter l'envie d'augmenter la taille.",
    beliefAuto: '« Je suis en feu, je peux me permettre de pousser. »',
    consequence: "Légère euphorie ; j'ai noté la pulsion avant qu'elle ne devienne une décision.",
    disputation:
      'Une série de gains ne change pas la probabilité du prochain trade. Garder ma taille fixe protège mon edge de ma propre confiance.',
  },
  {
    triggerEvent: "J'ai pris une perte sur un trade parfaitement exécuté selon mon plan.",
    beliefAuto: "« C'est frustrant, mais c'est juste un trade. »",
    consequence: "Calme presque immédiat ; j'ai fermé proprement et repris ma routine.",
    disputation:
      "Une perte sur un bon process est une dépense prévue, pas une erreur. Mon travail est l'exécution ; le résultat appartient aux probabilités.",
  },
  {
    triggerEvent: "Une news a fait bouger le marché violemment alors que j'étais en position.",
    beliefAuto: '« Reste sur le plan, le stop fait son travail. »',
    consequence: 'Tension brève, vite régulée par ma respiration ; aucune décision impulsive.',
    disputation:
      'Je ne peux pas contrôler la volatilité, seulement ma réaction. Mon stop a été placé pour ce scénario exact ; je le laisse faire.',
  },
];

// =============================================================================
// Mindset — versioned QCM (responses: { itemId: 1..5 }, 12 items)
// =============================================================================

/**
 * Build a `responses` map for the frozen instrument: one INTEGER Likert value
 * in [1, 5] per item id, drifting upward with `p` (0 = oldest → 1 = newest).
 * Each item's base sits a bit below the dimension target so two items of the
 * same dimension don't read identically (small per-item jitter from the PRNG).
 */
function buildMindsetResponses(rand: () => number, p: number): Record<string, number> {
  const responses: Record<string, number> = {};
  // Target mean climbs ~2.4 → ~4.4 across the window; +/- per-item jitter keeps
  // each answer an honest, slightly noisy integer (never out of range).
  const target = 2.4 + p * 2.0;
  for (const item of CURRENT_MINDSET_INSTRUMENT.items) {
    const jitter = rand() < 0.5 ? -1 : rand() < 0.5 ? 0 : 1;
    responses[item.id] = clampInt(target + jitter, 1, 5);
  }
  return responses;
}

// =============================================================================
// Seeder
// =============================================================================

export async function seedReflection(ctx: SeedCtx): Promise<Record<string, number>> {
  const { db, userId, now, log } = ctx;
  const rand = makePrng(801);

  // ---------------------------------------------------------------------------
  // Weekly reviews — 7 consecutive weeks (this week back to 6 weeks ago).
  // weekStart = Monday (@db.Date), weekEnd = Monday + 6 days (Sunday).
  // submittedAt = the following Sunday evening (real instant), within window.
  // Texts evolve across tiers: early (anxious) → mid → late (disciplined).
  // ---------------------------------------------------------------------------
  const REVIEW_WEEKS = 7;
  let reviews = 0;

  for (let weeksAgo = REVIEW_WEEKS - 1; weeksAgo >= 0; weeksAgo--) {
    // 0 (oldest review week) → 1 (this week).
    const p = (REVIEW_WEEKS - 1 - weeksAgo) / (REVIEW_WEEKS - 1);
    const tier = p < 0.34 ? REVIEW_EARLY : p < 0.7 ? REVIEW_MID : REVIEW_LATE;

    const weekStart = mondayOf(now, weeksAgo);
    const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000);

    // submittedAt: Sunday (= weekEnd) around 19:00 UTC. For the current week,
    // weekEnd may be in the future → clamp to "now" so the instant stays past.
    const sundayDaysAgo = weeksAgo * 7 - 6; // weekEnd is 6 days after the Monday
    const submittedAt =
      sundayDaysAgo <= 0 ? now : at(now, sundayDaysAgo, 19, 10 + Math.floor(rand() * 40));

    const bestPractice = pick(rand, tier.bestPractice);

    await db.weeklyReview.upsert({
      where: { userId_weekStart: { userId, weekStart } },
      create: {
        userId,
        weekStart,
        weekEnd,
        biggestWin: pick(rand, tier.biggestWin),
        biggestMistake: pick(rand, tier.biggestMistake),
        bestPractice,
        lessonLearned: pick(rand, tier.lessonLearned),
        nextWeekFocus: pick(rand, tier.nextWeekFocus),
        submittedAt,
      },
      update: {
        weekEnd,
        biggestWin: pick(rand, tier.biggestWin),
        biggestMistake: pick(rand, tier.biggestMistake),
        bestPractice,
        lessonLearned: pick(rand, tier.lessonLearned),
        nextWeekFocus: pick(rand, tier.nextWeekFocus),
        submittedAt,
      },
    });
    reviews++;
  }

  // ---------------------------------------------------------------------------
  // Mindset checks — 6 consecutive weeks, responses trending upward.
  // weekStart = Monday (@db.Date); responses = { itemId: 1..5 } over 12 items.
  // The CURRENT week's check (weeksAgo=0) lights up the "déjà fait" prefill on
  // /mindset (`currentWeek` match) and is the latest profile / radar.
  // ---------------------------------------------------------------------------
  const MINDSET_WEEKS = 6;
  let mindsetChecks = 0;

  for (let weeksAgo = MINDSET_WEEKS - 1; weeksAgo >= 0; weeksAgo--) {
    const p = (MINDSET_WEEKS - 1 - weeksAgo) / (MINDSET_WEEKS - 1);
    const weekStart = mondayOf(now, weeksAgo);
    const responses = buildMindsetResponses(rand, p);

    await db.mindsetCheck.upsert({
      where: { userId_weekStart: { userId, weekStart } },
      create: {
        userId,
        weekStart,
        instrumentVersion: CURRENT_MINDSET_INSTRUMENT_VERSION,
        responses,
      },
      update: {
        instrumentVersion: CURRENT_MINDSET_INSTRUMENT_VERSION,
        responses,
      },
    });
    mindsetChecks++;
  }

  // ---------------------------------------------------------------------------
  // Reflection entries — ABCD, spread across the window (more in the recent
  // 30 days so the /reflect timeline is populated). No DB unique → wipe-first
  // for re-runnability, then create. createdAt set to the reflection evening so
  // the [date desc, createdAt desc] ordering is meaningful.
  // ---------------------------------------------------------------------------
  await db.reflectionEntry.deleteMany({ where: { userId } });

  // Day offsets (daysAgo) chosen so most land within the last 30 days (the
  // /reflect window) while a few older ones show history. 10 entries total.
  const REFLECTION_DAYS_AGO = [1, 3, 6, 9, 13, 17, 22, 27, 34, 41] as const;
  let reflections = 0;

  for (const daysAgo of REFLECTION_DAYS_AGO) {
    const p = progress(daysAgo, WINDOW_DAYS); // 0 (old) → 1 (today)
    const pool = p < 0.34 ? ABCD_EARLY : p < 0.7 ? ABCD_MID : ABCD_LATE;
    const tpl = pick(rand, pool);

    const date = dbDate(now, daysAgo); // @db.Date (UTC-midnight, Europe/Paris civil date)
    // Reflections are written in the evening, after the trading session.
    const createdAt = at(now, daysAgo, 18, Math.floor(rand() * 60));

    await db.reflectionEntry.create({
      data: {
        userId,
        date,
        triggerEvent: tpl.triggerEvent,
        beliefAuto: tpl.beliefAuto,
        consequence: tpl.consequence,
        disputation: tpl.disputation,
        createdAt,
      },
    });
    reflections++;
  }

  log(
    `  reflect: ${reviews} weekly reviews, ${mindsetChecks} mindset checks, ${reflections} ABCD reflections`,
  );

  return { weeklyReviews: reviews, mindsetChecks, reflections };
}
