/**
 * Onboarding-interview + analyzed MemberProfile seed for the demo account.
 *
 * This is the surface that turns the demo member from a "first-run" account
 * into a fully onboarded one: it seeds the completed `OnboardingInterview`
 * (~85 days ago), a realistic subset of `OnboardingInterviewAnswer` rows drawn
 * verbatim from instrument v1, and the Claude-analyzed `MemberProfile`. The
 * profile is what flips `isFirstRun` off, fills `/profile`, the dashboard
 * `CoachingAxisCard`, and feeds the coaching "priority-axis" seam.
 *
 * EXACT shapes (verified against the readers, not guessed):
 *   - `MemberProfile.summary`     → string, 100-800 chars (descriptif, FR).
 *       readers: src/app/profile/page.tsx:182, member-profile-viewer-admin.tsx:207
 *   - `MemberProfile.highlights`  → `[{ key, label, evidence: string[] }]`, 3-7.
 *       canonical writer: src/lib/onboarding-interview/batch.ts:715-717
 *       Zod: src/lib/schemas/onboarding-interview.ts:152-202 (key kebab 3-80,
 *       label 3-100, evidence 1-5 items each 1-250 chars).
 *       reader: profile/page.tsx:201-225 (h.key / h.label / evidence string[]).
 *   - `MemberProfile.axesPrioritaires` → `string[]`, 3-5, each 5-200 chars,
 *       FR action-concrete Mark Douglas phrases (NOT short keywords).
 *       reader (display): profile/page.tsx:233 `asStringArray`.
 *       reader (coaching): src/lib/coaching/service.ts:55,85 →
 *         classifyPriorityAxes(coerceAxes(...)) — so the phrases MUST contain the
 *         FR psy-trading vocabulary mapped in src/lib/coaching/priority-axis.ts
 *         ('detach'/'plan'/' regle'/'methode'/'5 verite'/'accept'/'respiration'…)
 *         to drive the 4 mental axes — else the seam is inert.
 *   - `claudeModelVersion` → a REAL slug (KNOWN_CLAUDE_MODEL_SLUGS); a `mock:*`
 *       value makes /profile render "analyse en cours" instead of the profile
 *       (profile/page.tsx:71). We pin 'claude-opus-4-8'.
 *   - `recoveryProtocol` → optional `Json?`. No reader/Zod consumes it yet (the
 *       JITAI feature #17 is not built), so we seed a small, conservative
 *       if-then discipline-only payload matching the schema.prisma doc intent.
 *
 * Idempotent / re-runnable on its own (the test harness calls this directly,
 * without the orchestrator's wipe): we delete this user's MemberProfile FIRST
 * (it has `onDelete: Restrict` toward the interview) then the interview (answers
 * cascade), then recreate the trio. FK-safe.
 */
import { type SeedCtx, WINDOW_DAYS, at, makePrng, pick } from './_shared.js';

// =============================================================================
// Frozen instrument v1 wording — kept inline (verbatim from
// src/lib/onboarding-interview/instrument-v1.ts ITEMS_V1) so this seed module
// stays self-contained (no `server-only` import, runnable under bare tsx).
// questionIndex / questionKey / questionText MUST match the catalog: the batch
// re-derives evidence by questionIndex and the @@unique([interviewId,
// questionIndex]) guards duplicates.
// =============================================================================

interface SeedAnswer {
  readonly questionIndex: number;
  readonly questionKey: string;
  readonly questionText: string;
  readonly answerText: string;
}

const INSTRUMENT_VERSION = 'v1';
/** A real Claude slug (NOT a `mock:` sentinel) so /profile renders the profile. */
const CLAUDE_MODEL_VERSION = 'claude-opus-4-8';

/**
 * 10 answers spanning warmup → core → reflective_close. Each `answerText` is a
 * plausible, honest, NON-clinical free-text response (10-2000 chars). The
 * highlight `evidence[]` below are verbatim substrings of these texts (the
 * production safety gate validates that invariant; we honour it so the seeded
 * profile is internally consistent with its interview).
 */
const ANSWERS: readonly SeedAnswer[] = [
  {
    questionIndex: 0,
    questionKey: 'parcours_origin',
    questionText:
      'Raconte comment tu es arrivé au trading : premier contact, premier compte réel, première fois où tu as su que ça allait devenir sérieux pour toi. 3-5 phrases.',
    answerText:
      "J'ai découvert le trading en 2021 via un ami qui en parlait tout le temps. Premier compte réel à 500€, blow-up en trois semaines parce que je tradais sans plan et sans stop. J'ai repris en 2024 avec une approche beaucoup plus structurée, et c'est là que j'ai su que je voulais en faire quelque chose de sérieux.",
  },
  {
    questionIndex: 2,
    questionKey: 'routines_day',
    questionText:
      'Décris ta journée-type un jour où tu trades. De ton réveil à ton coucher. Sommeil, repas, sport, écran, pas idéal, réel.',
    answerText:
      "Je me lève vers 7h, café, je regarde les news macro pendant trente minutes. Souvent je manque de sommeil les jours de news importantes parce que je me couche tard à refaire mes analyses. Je trade la session de Londres, puis je coupe, sport en fin d'après-midi quand j'y arrive. Le soir je débriefe mes trades, parfois trop longtemps.",
  },
  {
    questionIndex: 3,
    questionKey: 'routines_presession',
    questionText:
      'As-tu un rituel pré-session (les 5-30 min avant ta première analyse) ? Si oui, décris-le étape par étape. Si non, dis-le sans gêne.',
    answerText:
      "Pas vraiment de rituel fixe, et c'est honnêtement un de mes manques. Je relis mes niveaux de la veille, mais je n'ai pas de routine de respiration ni de checklist écrite avant d'ouvrir une position. J'aimerais installer quelque chose de régulier.",
  },
  {
    questionIndex: 5,
    questionKey: 'uncertainty_last_surprise',
    questionText:
      "Décris la dernière fois où le marché a fait l'inverse exact de ce que ton analyse prévoyait. Qu'est-ce que tu as ressenti dans les 5 minutes qui ont suivi ?",
    answerText:
      "La semaine dernière sur l'or, j'étais persuadé d'un rejet et le prix a cassé net à la hausse. Dans les cinq minutes j'ai senti la frustration monter et l'envie de me revenger immédiatement. J'ai du mal à accepter que deux setups identiques peuvent donner deux résultats opposés sans que rien soit cassé dans ma méthode.",
  },
  {
    questionIndex: 7,
    questionKey: 'discipline_plan_written',
    questionText:
      "Écris-tu ton plan AVANT d'entrer (entry + stop + target chiffrés), ou se construit-il pendant le trade ? Sois honnête, pas idéaliste.",
    answerText:
      "J'écris mon entrée et mon stop avant, mais mon target se construit souvent pendant le trade, ce qui est mon vrai point faible. Quand je respecte mes règles à la lettre mes résultats sont bien meilleurs, mais la discipline lâche dès que l'émotion monte.",
  },
  {
    questionIndex: 8,
    questionKey: 'discipline_last10_count',
    questionText:
      'Sur tes 10 derniers trades, combien ont été exécutés à 100% selon ton plan écrit (entrée, stop, target, pas de déplacement) ?',
    answerText:
      "Honnêtement quatre sur dix. Je dévie souvent sur le target, je sors trop tôt par peur que le marché reparte contre moi. C'est exactement là que je perds mon edge.",
  },
  {
    questionIndex: 17,
    questionKey: 'emotion_body_stress',
    questionText:
      'Quand une trade te met en stress (drawdown intra-trade, signal contradictoire), où sens-tu ça dans ton corps ? Quelle est ta première réaction physique : respiration, tension épaules, posture ?',
    answerText:
      "Je sens une tension dans les épaules et la mâchoire, et ma respiration devient courte. J'ai souvent envie de me lever et de marcher. Au moins je le remarque maintenant, ce qui n'était pas le cas avant.",
  },
  {
    questionIndex: 18,
    questionKey: 'emotion_3_losses_thought',
    questionText:
      'Quand tu enchaînes 3 pertes consécutives, quelle est la pensée la plus fréquente qui apparaît : "le marché est cassé", "ma méthode est cassée", "JE suis cassé", autre ?',
    answerText:
      "La pensée qui revient c'est plutôt « je suis nul », donc c'est dirigé contre moi. Je sais intellectuellement que la distribution des gains et pertes est aléatoire, mais sur le moment je le prends personnellement et je veux me refaire tout de suite.",
  },
  {
    questionIndex: 23,
    questionKey: 'triggers_worst_pain',
    questionText:
      "Qu'est-ce qui te fait le plus mal en trading : prendre une perte sur une trade A+, rater un move que tu avais vu, sortir trop tôt d'un gain, ou être contrarian et avoir tort ? Pourquoi cette douleur-là plutôt qu'une autre ?",
    answerText:
      "Ce qui me fait le plus mal c'est sortir trop tôt d'un gain et voir le marché continuer sans moi. Plus que la perte d'argent, c'est le sentiment d'avoir trahi mon propre plan qui me ronge. J'ai besoin de travailler le détachement du résultat.",
  },
  {
    questionIndex: 26,
    questionKey: 'objectifs_proud_12m',
    questionText:
      "Si dans 12 mois tu te regardes trader et que tu es fier de toi, qu'est-ce que tu vois ? Pas un chiffre P&L : un comportement, un état, une posture.",
    answerText:
      "Un trader calme qui exécute son plan sans hésiter, trade après trade. Pas un chiffre, la régularité du geste et le respect de mes règles, même les jours où c'est dur. Une vraie sérénité face à l'incertitude.",
  },
] as const;

/**
 * Highlights — durable traits Claude would infer. `evidence[]` entries are
 * verbatim substrings of the ANSWERS above (matching the production
 * evidence-substring invariant). 4 highlights (within the 3-7 bound).
 */
const HIGHLIGHTS: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly evidence: readonly string[];
}> = [
  {
    key: 'parcours-blow-up-recovery',
    label: 'Parcours blow-up 2021 → retour structuré 2024',
    evidence: [
      'Premier compte réel à 500€, blow-up en trois semaines parce que je tradais sans plan et sans stop.',
      "J'ai repris en 2024 avec une approche beaucoup plus structurée",
    ],
  },
  {
    key: 'gap-plan-vs-execution',
    label: 'Gap exécution du plan (4/10 conformes)',
    evidence: [
      'Honnêtement quatre sur dix. Je dévie souvent sur le target, je sors trop tôt par peur que le marché reparte contre moi.',
    ],
  },
  {
    key: 'awareness-somatique-stress',
    label: 'Awareness corporelle sous stress',
    evidence: [
      'Je sens une tension dans les épaules et la mâchoire, et ma respiration devient courte.',
      "J'ai souvent envie de me lever et de marcher.",
    ],
  },
  {
    key: 'process-focus-objectif',
    label: 'Process-focus aligné Mark Douglas',
    evidence: [
      'Un trader calme qui exécute son plan sans hésiter, trade après trade. Pas un chiffre, la régularité du geste',
    ],
  },
];

/**
 * Axes prioritaires — 3-5 FR action-concrete phrases (5-200 chars each). Chosen
 * so `classifyPriorityAxes` (src/lib/coaching/priority-axis.ts) maps each one to
 * a real mental axis: #1 'detach'+'accept' → ego ; #2 'respiration'+'rituel' →
 * ego/consistency ; #3 'plan'+'methode'+'execution' → discipline ; #4 'regul'
 * 'geste' → consistency. Keeps the coaching seam live, not inert.
 */
const AXES_PRIORITAIRES: readonly string[] = [
  "Travailler le détachement du résultat et l'acceptation de l'incertitude. La peur de voir le marché repartir défait l'edge à chaque sortie anticipée.",
  'Installer un rituel pré-session de respiration de 2 min pour réguler la tension somatique repérée avant chaque entrée.',
  "Consolider l'exécution du plan et le respect de la méthode, tenir entrée, stop ET target sans déplacement, surtout quand l'émotion monte.",
  'Ancrer la régularité du geste comme objectif premier : viser la constance du process répété plutôt que le P&L du jour.',
];

/**
 * Optional if-then recovery protocol (`recoveryProtocol Json?`). No reader
 * consumes it yet; we seed a conservative discipline-only (stop/cooldown/
 * self-talk) payload aligned with the schema.prisma doc + Gollwitzer
 * implementation-intention framing. NEVER market re-entry timing.
 */
const RECOVERY_PROTOCOL = {
  version: 1,
  trigger: 'after_n_consecutive_losses',
  threshold: 3,
  steps: [
    {
      ifSituation: "Si j'enchaîne 3 pertes consécutives",
      thenAction:
        'alors je ferme la plateforme et je fais une pause de 30 minutes (marche + respiration), sans regarder les graphiques.',
    },
    {
      ifSituation: "Si l'envie de me refaire monte",
      thenAction:
        'alors je relis à voix haute mon objectif : « la régularité du geste, pas le P&L du jour ».',
    },
  ],
} as const;

const SUMMARY =
  "Membre revenu au trading en 2024 après un blow-up en 2021, avec un retour nettement plus structuré. Profil orienté process plutôt que résultat, objectif 12 mois centré sur « la régularité du geste », mais tension nette entre l'intention et l'exécution : 4 trades sur 10 conformes au plan, déviation systématique sur le target par peur de voir le marché repartir. Bonne awareness somatique sous stress (épaules, mâchoire, respiration courte), ce qui est un point d'appui. Posture Mark Douglas en construction : la lucidité est là, l'incarnation des règles et l'acceptation de l'incertitude restent à consolider (stade Mechanical).";

export async function seedOnboarding(ctx: SeedCtx): Promise<Record<string, number>> {
  const { db, userId, now, log } = ctx;
  // Dedicated PRNG stream (per the contract) — kept stable so re-runs are
  // deterministic and adding/removing other seeders never shifts this one.
  const rand = makePrng(501);

  // -------------------------------------------------------------------------
  // Idempotency: clear this user's prior onboarding trio FK-safely.
  // MemberProfile.interviewId is `onDelete: Restrict` toward OnboardingInterview,
  // so the profile MUST go first; then the interview (answers cascade on it).
  // -------------------------------------------------------------------------
  await db.memberProfile.deleteMany({ where: { userId } });
  await db.onboardingInterview.deleteMany({ where: { userId } });

  // -------------------------------------------------------------------------
  // 1) OnboardingInterview — completed ~85d started / ~84d completed.
  // -------------------------------------------------------------------------
  // A small, deterministic token spend so the audit/longitudinal counters are
  // non-zero (mirrors a real Claude analysis).
  const totalTokensInput = 6000 + Math.floor(rand() * 2000);
  const totalTokensOutput = 1200 + Math.floor(rand() * 600);

  const interview = await db.onboardingInterview.create({
    data: {
      userId,
      status: 'completed',
      startedAt: at(now, WINDOW_DAYS - 5, 8, 12), // ~85 days ago, morning
      completedAt: at(now, WINDOW_DAYS - 6, 9, 40), // ~84 days ago, next day
      claudeModelVersion: CLAUDE_MODEL_VERSION,
      instrumentVersion: INSTRUMENT_VERSION,
      totalTokensInput,
      totalTokensOutput,
    },
    select: { id: true },
  });

  // -------------------------------------------------------------------------
  // 2) OnboardingInterviewAnswer rows — one per ANSWERS entry, spread across
  //    the two interview days. @@unique([interviewId, questionIndex]) holds.
  // -------------------------------------------------------------------------
  let answersCreated = 0;
  for (const a of ANSWERS) {
    // Warmup (index < 4) landed on day one, the rest on the completion day —
    // jitter the minute via the dedicated PRNG for realistic createdAt order.
    const onFirstDay = a.questionIndex < 4;
    const daysAgo = onFirstDay ? WINDOW_DAYS - 5 : WINDOW_DAYS - 6;
    const utcHour = onFirstDay ? 8 : 9;
    const minute = pick(rand, [5, 14, 22, 31, 38, 47, 53]);
    await db.onboardingInterviewAnswer.create({
      data: {
        interviewId: interview.id,
        userId,
        questionIndex: a.questionIndex,
        questionKey: a.questionKey,
        questionText: a.questionText,
        answerText: a.answerText,
        createdAt: at(now, daysAgo, utcHour, minute),
      },
    });
    answersCreated += 1;
  }

  // -------------------------------------------------------------------------
  // 3) MemberProfile — the analyzed artifact. interviewId FK → created above.
  //    highlights / axesPrioritaires are plain JSON (string[] inside) — Prisma
  //    `Json` columns accept the literal arrays directly. recoveryProtocol is
  //    optional: included here as a valid payload (omit-via-absence if null).
  // -------------------------------------------------------------------------
  await db.memberProfile.create({
    data: {
      userId,
      interviewId: interview.id,
      summary: SUMMARY,
      highlights: HIGHLIGHTS.map((h) => ({
        key: h.key,
        label: h.label,
        evidence: [...h.evidence],
      })),
      axesPrioritaires: [...AXES_PRIORITAIRES],
      recoveryProtocol: {
        version: RECOVERY_PROTOCOL.version,
        trigger: RECOVERY_PROTOCOL.trigger,
        threshold: RECOVERY_PROTOCOL.threshold,
        steps: RECOVERY_PROTOCOL.steps.map((s) => ({
          ifSituation: s.ifSituation,
          thenAction: s.thenAction,
        })),
      },
      claudeModelVersion: CLAUDE_MODEL_VERSION,
      instrumentVersion: INSTRUMENT_VERSION,
      analyzedAt: at(now, WINDOW_DAYS - 6, 20, 15), // analysed the evening it completed
    },
  });

  log(
    `  onboarding: 1 interview (completed) · ${answersCreated} answers · 1 profile (${HIGHLIGHTS.length} highlights, ${AXES_PRIORITAIRES.length} axes)`,
  );

  return {
    onboardingInterviews: 1,
    onboardingAnswers: answersCreated,
    memberProfiles: 1,
  };
}
