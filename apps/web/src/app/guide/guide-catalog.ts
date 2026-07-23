import { BOTTOM_NAV, NAV_GROUPS } from '@/components/nav/nav-items';

/**
 * SSOT du guide d'utilisation — une entrée par surface membre RÉELLE.
 *
 * Le guide (`/guide`) explique l'app pilier par pilier ; ce catalogue est la
 * source de vérité qui garantit qu'AUCUNE surface membre n'est oubliée. Il est
 * verrouillé par `guide-catalog.test.ts` : le test croise `GUIDE_CATALOG` avec
 * les routes membre dérivées de `nav-items.ts` et casse si une future route
 * membre apparaît sans entrée guide.
 *
 * Posture §2 (Mark Douglas) : chaque `blurb` décrit calmement à quoi sert la
 * surface pour le membre — un miroir, jamais un juge ; aucun conseil d'analyse
 * de marché, aucune gamification culpabilisante.
 */
export interface GuideEntry {
  /** Route de la surface membre (identique au `href` de nav-items.ts). */
  href: string;
  /** Libellé court — repris de nav-items.ts. */
  title: string;
  /** 1 phrase FR calme : à quoi sert la surface pour le membre. */
  blurb: string;
  /** Groupe de nav auquel la surface appartient (ordre pédagogique). */
  group: string;
}

/**
 * Toutes les routes membre de la nav, dédupliquées, dérivées de nav-items.ts.
 *
 * Sources : NAV_GROUPS (hors groupes/items `admin`) + BOTTOM_NAV (hors items
 * `admin`). C'est cette dérivation LIVE qui rend le test de couverture
 * auto-actualisé : ajouter une route membre à la nav la fait apparaître ici, et
 * le test exige alors une entrée guide correspondante.
 */
export function memberNavHrefs(): string[] {
  const fromGroups = NAV_GROUPS.filter((group) => !group.admin).flatMap((group) =>
    group.items.filter((item) => !item.admin).map((item) => item.href),
  );
  const fromBottom = BOTTOM_NAV.filter((item) => !item.admin).map((item) => item.href);

  return Array.from(new Set([...fromGroups, ...fromBottom]));
}

/**
 * Catalogue du guide — une entrée par surface membre, dans l'ordre pédagogique
 * des groupes de nav (Accueil → Ma progression → Au quotidien → Mental & vérité
 * → Suivi & orga → Compte).
 */
export const GUIDE_CATALOG: GuideEntry[] = [
  // Accueil
  {
    href: '/dashboard',
    title: 'Accueil',
    blurb:
      'Ton tableau de bord : d’un coup d’œil, ton état du jour, tes gestes à faire et ta progression.',
    group: 'Accueil',
  },

  // Ma progression
  {
    href: '/progression',
    title: 'Où j’en suis',
    blurb: 'Ta vue d’ensemble : tes scores, ta trajectoire et ce qui se solidifie au fil du temps.',
    group: 'Ma progression',
  },
  {
    href: '/classement',
    title: 'Classement',
    blurb: 'Le classement du groupe, pour te situer parmi les autres membres.',
    group: 'Ma progression',
  },
  {
    href: '/objectifs',
    title: 'Mes objectifs',
    blurb:
      'Tes objectifs de process, pour te fixer un cap sur ta discipline, jamais sur des promesses de gains.',
    group: 'Ma progression',
  },
  {
    href: '/patterns',
    title: 'Patterns',
    blurb: 'Les patterns qui reviennent dans ton trading, en bien comme en mal.',
    group: 'Ma progression',
  },

  // Au quotidien
  {
    href: '/checkin',
    title: 'Check-in',
    blurb:
      'Ton check-in du jour : ton état le matin, ton bilan le soir, et ton streak de régularité.',
    group: 'Au quotidien',
  },
  {
    href: '/checkin/history',
    title: 'Historique',
    blurb: 'L’historique de tes check-ins passés, pour relire ton évolution jour après jour.',
    group: 'Au quotidien',
  },
  {
    href: '/pre-trade/new',
    title: 'Pré-trade',
    blurb:
      'Une pause de trente secondes avant d’entrer : ta raison, ton émotion et ton plan, pour trader en conscience.',
    group: 'Au quotidien',
  },
  {
    href: '/track',
    title: 'Habitudes',
    blurb:
      'Le suivi de tes habitudes : sommeil, nutrition, sport, ces piliers qui soutiennent ta pratique.',
    group: 'Au quotidien',
  },
  {
    href: '/journal',
    title: 'Journal',
    blurb:
      'Ton journal de trading : chaque trade avec ton plan, tes émotions et le respect de ton process.',
    group: 'Au quotidien',
  },

  // Mental & vérité
  {
    href: '/mindset',
    title: 'Mindset',
    blurb: 'Tes QCM de mental récurrents, à la manière de Mark Douglas, pour voir où tu en es.',
    group: 'Mental & vérité',
  },
  {
    href: '/reflect',
    title: 'Réflexion',
    blurb: 'Ton espace de réflexion guidée, pour prendre du recul sur ta semaine et sur toi.',
    group: 'Mental & vérité',
  },
  {
    href: '/verification',
    title: 'Vérification',
    blurb:
      'La vérité : ce que tu déclares confronté à ce que tu fais réellement, pour mesurer l’écart sans te juger.',
    group: 'Mental & vérité',
  },
  {
    href: '/library',
    title: 'Bibliothèque',
    blurb:
      'La bibliothèque des fiches Mark Douglas, à lire librement pour travailler ta psychologie.',
    group: 'Mental & vérité',
  },

  // Suivi & orga
  {
    href: '/review',
    title: 'Revue hebdo',
    blurb: 'Ta revue hebdomadaire, pour faire le bilan de la semaine et poser tes leçons.',
    group: 'Suivi & orga',
  },
  {
    href: '/debrief-mensuel',
    title: 'Débrief mensuel',
    blurb: 'Ton débrief mensuel généré avec l’IA, une synthèse de ton mois de pratique.',
    group: 'Suivi & orga',
  },
  {
    href: '/training',
    title: 'Entraînement',
    blurb:
      'Ton journal d’entraînement : tes backtests et ton travail hors marché réel, isolés de tes vrais trades.',
    group: 'Suivi & orga',
  },
  {
    href: '/calendrier',
    title: 'Calendrier',
    blurb:
      'Ton calendrier adaptatif de la semaine, organisé autour de tes disponibilités et de tes créneaux de pratique.',
    group: 'Suivi & orga',
  },
  {
    href: '/reunions',
    title: 'Réunions',
    blurb: 'Tes réunions et ta présence aux créneaux du groupe.',
    group: 'Suivi & orga',
  },
  {
    href: '/seances',
    title: 'Séances',
    blurb: 'Les séances et replays à suivre pour progresser à ton rythme.',
    group: 'Suivi & orga',
  },

  // Compte
  {
    href: '/profile',
    title: 'Profil',
    blurb:
      'Ton profil psychologique et tes axes prioritaires, dressés à partir de ton entretien d’onboarding.',
    group: 'Compte',
  },
  {
    href: '/guide',
    title: 'Guide',
    blurb: 'Ce guide d’utilisation, pilier par pilier, pour ne jamais être perdu dans l’app.',
    group: 'Compte',
  },
  {
    href: '/account',
    title: 'Compte',
    blurb: 'Les réglages de ton compte : notifications, données personnelles et confidentialité.',
    group: 'Compte',
  },
];
