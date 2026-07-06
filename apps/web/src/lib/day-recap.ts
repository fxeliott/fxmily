/**
 * Tour 16 — DAY RECAP. Le récapitulatif factuel de la journée, agrégé au wrap
 * du soir. Il répond au besoin « qu'est-ce que j'ai vraiment fait aujourd'hui »
 * d'un coup d'œil, juste après avoir enregistré le check-in du soir.
 *
 * Ce module est PUR (aucun `server-only`, aucun accès DB, aucun appel IA) : il
 * REÇOIT en paramètres les données déjà chargées par l'appelant (la page de
 * confirmation post-wrap) et retourne une structure d'affichage testable en
 * isolation. C'est la contrepartie plus riche du `buildDayWrap` de
 * `lib/coaching/checkin-echo.ts` : là où `buildDayWrap` produit UNE phrase
 * fusionnée dans l'écho réflexif, ce module produit des COMPTEURS + des faits
 * clés structurés pour une carte dédiée.
 *
 * DÉTERMINISTE, ZÉRO IA : chaque libellé est une copie FR FIXE sélectionnée par
 * des règles sur des enums/booleans/nombres (nombre de trades, outcome,
 * exitReason, plan respecté, off-day, micro-objectif). Aucun blob IA n'est
 * exposé → pas de bannière AI Act (précédent : trade-echo.ts / checkin-echo.ts).
 *
 * POSTURE §2 / §31.2 / Mark Douglas : on MIROITE les faits de la journée, jamais
 * un verdict, jamais un compte à rebours. Le rouge est réservé aux OUTCOMES de
 * trade (une perte est une perte, on la nomme) ; le reste reste calme (accent
 * ou neutre). Un écart déclaré (plan non tenu, intention non tenue) est une
 * DONNÉE de process, pas un reproche. Copie française, ponctuation simple,
 * jamais de tiret cadratin (règle de copie Eliott).
 *
 * NULL PASSTHROUGH : un self-report absent (null) ne fabrique JAMAIS un fait.
 * Une journée sans trade et sans self-report reste une « journée bouclée »
 * neutre, pas un vide anxiogène.
 */

import { EXIT_REASON_LABELS } from '@/lib/trading/exit-reasons';
import type { TradeExitReasonSlug } from '@/lib/schemas/trade';

/**
 * Les 5 valeurs de `TradeExitReason`. On réutilise le slug canonique
 * `TradeExitReasonSlug` (source unique avec l'enum + le formulaire de clôture)
 * plutôt qu'une union dupliquée. C'est un `import type` PUR (effacé au runtime),
 * donc la pureté « testable sans DB » du module est préservée : `schemas/trade`
 * n'entre pas dans le graphe runtime.
 */
export type DayRecapExitReason = TradeExitReasonSlug;

/** Les 3 issues possibles d'un trade clôturé (`TradeOutcome` prisma). */
export type DayRecapOutcome = 'win' | 'loss' | 'break_even';

/**
 * La forme minimale d'un trade dont le récap a besoin. L'appelant projette ses
 * lignes Prisma sur cette forme (jamais l'inverse) — le module ne connaît que
 * ce qu'il lit. Un trade encore OUVERT a `outcome = null`.
 */
export interface DayRecapTrade {
  /** Issue à la clôture, ou null si le trade est encore ouvert. */
  readonly outcome: DayRecapOutcome | null;
  /** Nature factuelle de la sortie, ou null (legacy / non répondu / ouvert). */
  readonly exitReason: DayRecapExitReason | null;
}

/**
 * Les entrées du module : tout ce que la journée a produit, déjà chargé par
 * l'appelant. Chaque champ est optionnel au sens sémantique (null = silence),
 * jamais deviné.
 */
export interface DayRecapInput {
  /** Trades JOURNALISÉS sur le jour civil local du membre (entrés aujourd'hui). */
  readonly trades: readonly DayRecapTrade[];
  /** Le jour est-il un jour off (week-end couvert OU jour off déclaré) ? */
  readonly isOffDay: boolean;
  /** Plan de trading respecté aujourd'hui (soir). Tri-état ; null = non répondu. */
  readonly planRespectedToday: boolean | null;
  /** Intention du matin tenue ? Tri-état ; null = pas d'intention / non répondu. */
  readonly intentionKept: boolean | null;
  /** Formation suivie aujourd'hui ? Tri-état ; null = non répondu. */
  readonly formationFollowed: boolean | null;
  /**
   * Le micro-objectif mental OUVERT du membre, s'il en a un (titre curé,
   * déterministe). null = aucune boucle ouverte. On n'affiche QUE son titre :
   * un rappel doux de ce sur quoi il s'est engagé, jamais un jugement.
   */
  readonly openMicroObjectiveTitle: string | null;
  /**
   * Nombre de CORRECTIONS admin non encore lues sur les trades DU JOUR (écarts
   * relevés par le coach). L'app n'a pas de service d'écart jour-scopé : ce
   * compte est agrégé au call-site en croisant `countUnseenAnnotationsByTrade`
   * avec les trades du jour. On invite calmement à les relire, sans les
   * détailler ici (§31.2 : un pont vers le journal, jamais un reproche).
   * Défaut 0 (aucune correction en attente).
   */
  readonly unseenCorrectionsToday?: number;
}

/** Un compteur factuel affiché en tête de carte (valeur + libellé). */
export interface DayRecapCounter {
  readonly value: number;
  /** Libellé au singulier — l'accord au pluriel est géré à l'affichage. */
  readonly label: string;
}

/** Une ligne de fait clé : un libellé + une tonalité d'accent calme. */
export interface DayRecapFact {
  readonly text: string;
  /**
   * Pilote l'accent de la ligne. 'loss' est le SEUL rouge autorisé (outcome de
   * trade). 'held' = vert calme (process tenu), 'watch' = accent (écart de
   * process, jamais rouge), 'neutral' = sans accent.
   */
  readonly tone: 'held' | 'watch' | 'loss' | 'neutral';
}

/** Le récapitulatif complet, prêt à être rendu par `DayRecapCard`. */
export interface DayRecap {
  /** Titre de la carte (varie selon jour off / jour normal). */
  readonly title: string;
  /** 0 à 2 compteurs (trades ; wins) — omis quand il n'y a pas de trade. */
  readonly counters: readonly DayRecapCounter[];
  /** Faits clés de la journée (process, formation, sorties notables). */
  readonly facts: readonly DayRecapFact[];
  /** Rappel doux du micro-objectif ouvert, ou null. */
  readonly microObjectiveTitle: string | null;
  /** Phrase de clôture calme (jamais performance). */
  readonly closer: string;
}

/**
 * Construit le récapitulatif de journée à partir des faits fournis. PUR : aucune
 * I/O, entièrement déterminé par `input`. Sûr à appeler côté serveur comme dans
 * un test unitaire.
 *
 * Règles :
 *  - Jour off : la carte reste factuelle et légère (le off ne compte pas dans le
 *    streak, on ne pousse rien). On mentionne quand même les trades s'il y en a
 *    (un membre peut trader un jour off ; ça compte toujours).
 *  - Compteurs : nombre de trades journalisés, et nombre de trades gagnants
 *    (seulement s'il y a au moins un trade CLÔTURÉ — sinon le « 0 gagnant » sur
 *    des trades tous ouverts serait trompeur).
 *  - Faits : plan / intention / formation (self-reports), et UNE sortie notable
 *    (une perte, ou à défaut la première sortie hors plan) — jamais une liste à
 *    rallonge, on garde la carte courte.
 */
export function buildDayRecap(input: DayRecapInput): DayRecap {
  const tradeCount = input.trades.length;
  const closedTrades = input.trades.filter((t) => t.outcome !== null);
  const wins = closedTrades.filter((t) => t.outcome === 'win').length;
  const losses = closedTrades.filter((t) => t.outcome === 'loss').length;

  const counters: DayRecapCounter[] = [];
  if (tradeCount > 0) {
    counters.push({ value: tradeCount, label: 'trade journalisé' });
    // On n'affiche le compteur de gains que si au moins un trade est clôturé :
    // « 0 gagnant » sur des trades tous encore ouverts serait un faux signal.
    if (closedTrades.length > 0) {
      counters.push({ value: wins, label: 'gagnant' });
    }
  }

  const facts: DayRecapFact[] = [];

  // Process (self-reports du soir). Null passthrough : un fait n'apparaît que
  // lorsqu'il est explicitement connu. Un `false` est un écart déclaré (accent,
  // jamais rouge), un `true` un process tenu (vert calme).
  if (input.planRespectedToday === true) {
    facts.push({ text: 'Plan de trading respecté.', tone: 'held' });
  } else if (input.planRespectedToday === false) {
    facts.push({ text: 'Plan à retravailler, tu l’as noté.', tone: 'watch' });
  }

  if (input.intentionKept === true) {
    facts.push({ text: 'Intention du matin tenue.', tone: 'held' });
  } else if (input.intentionKept === false) {
    facts.push({ text: 'Intention du matin à revoir, sans te juger.', tone: 'watch' });
  }

  if (input.formationFollowed === true) {
    facts.push({ text: 'Formation suivie aujourd’hui.', tone: 'held' });
  }

  // UNE sortie notable, au plus. Priorité à une perte (le seul rouge autorisé,
  // outcome de trade), à défaut la première sortie hors plan (accent, une donnée
  // de process). Une journée sans trade ou sans sortie notable n'en montre aucune.
  const notableExit = pickNotableExit(input.trades);
  if (notableExit) facts.push(notableExit);

  // Corrections admin non lues sur les trades du jour (écarts relevés par le
  // coach). Un pont doux vers le journal, jamais un reproche (§31.2) — on
  // annonce le nombre, on n'affiche pas le contenu ici.
  const corrections = input.unseenCorrectionsToday ?? 0;
  if (corrections > 0) {
    facts.push({
      text:
        corrections === 1
          ? 'Une correction de ton coach à relire dans ton journal.'
          : `${corrections} corrections de ton coach à relire dans ton journal.`,
      tone: 'watch',
    });
  }

  const title = input.isOffDay ? 'Jour off, bouclé' : 'Ta journée, bouclée';
  const closer = buildCloser(input, tradeCount, losses);

  return {
    title,
    counters,
    facts,
    microObjectiveTitle: input.openMicroObjectiveTitle,
    closer,
  };
}

/**
 * Choisit LA sortie notable à mettre en avant, ou null. Une perte l'emporte
 * (nommer une perte, avec sa nature de sortie si connue, est le geste
 * d'honnêteté de la méthode) ; à défaut une sortie manuelle avant la cible (un
 * écart de process factuel). Rien d'autre n'est « notable » (un TP ou un BE est
 * déjà porté par le compteur de gains).
 */
function pickNotableExit(trades: readonly DayRecapTrade[]): DayRecapFact | null {
  const loss = trades.find((t) => t.outcome === 'loss');
  if (loss) {
    // Réutilise le libellé partagé (EXIT_REASON_LABELS, source unique avec le
    // formulaire de clôture et le détail de trade) plutôt qu'un doublon local.
    const reason = loss.exitReason ? ` (${EXIT_REASON_LABELS[loss.exitReason]})` : '';
    return { text: `Une perte encaissée${reason}, elle fait partie du jeu.`, tone: 'loss' };
  }
  const earlyManual = trades.find((t) => t.exitReason === 'manual_before_target');
  if (earlyManual) {
    return {
      text: 'Une sortie manuelle avant la cible, une donnée pour demain.',
      tone: 'watch',
    };
  }
  return null;
}

/**
 * La phrase de clôture. Une journée « de process » (plan ET intention tenus)
 * est nommée comme telle (répétable, c'est ce qui construit la constance) ; sinon
 * une clôture neutre qui remet à zéro pour demain. Un jour off ferme sur le repos.
 */
function buildCloser(input: DayRecapInput, tradeCount: number, losses: number): string {
  if (input.isOffDay && tradeCount === 0) {
    return 'Journée de repos. Se poser fait aussi partie du process.';
  }
  const held = input.planRespectedToday === true && input.intentionKept === true;
  if (held) {
    return 'Une journée de process. On repart demain matin.';
  }
  if (losses > 0) {
    return 'Journée bouclée. Une perte est une donnée, pas un verdict. On repart demain.';
  }
  return 'Journée bouclée. On repart à zéro demain matin.';
}
