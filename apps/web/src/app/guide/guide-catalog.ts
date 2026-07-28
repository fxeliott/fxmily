import { Smartphone, type LucideIcon } from 'lucide-react';

import { BOTTOM_NAV, NAV_GROUPS } from '@/components/nav/nav-items';

/**
 * SSOT du guide d'utilisation — une entrée par surface membre RÉELLE.
 *
 * Le guide (`/guide`) explique l'app pilier par pilier ; ce catalogue est la
 * source de vérité qui garantit qu'AUCUNE surface membre n'est oubliée. Il est
 * verrouillé par `guide-catalog.test.ts`, sous DEUX angles indépendants :
 *
 *   1. la nav — croisement avec les routes membre dérivées de `nav-items.ts` ;
 *   2. la RÉALITÉ — parcours de l'arbre `src/app` : chaque `page.tsx` non-admin
 *      doit être expliquée par une entrée (elle-même, une descendante, ou un
 *      préfixe déclaré dans `covers`) ou figurer dans `GUIDE_ROUTE_EXEMPTIONS`
 *      avec sa raison.
 *
 * L'angle 2 existe parce que l'angle 1 seul mesurait la nav, pas l'app : une
 * route membre réelle absente de la nav laissait un trou dans le guide que le
 * test vert ne voyait pas. C'était exactement le cas de `/install`, créée au J8
 * et liée depuis ce guide, invisible pour l'ancien garde.
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
  /**
   * 1 phrase FR calme : QUAND s'en servir. Le « à quoi ça sert » ne suffit pas —
   * un membre perdu ne sait pas seulement à quoi sert un écran, il ne sait pas
   * à quel moment de sa journée ou de sa semaine il est censé l'ouvrir. Jamais
   * une échéance ni une pression (posture §2) : un repère, pas un compte à rebours.
   */
  when: string;
  /** Groupe de nav auquel la surface appartient (ordre pédagogique). */
  group: string;
  /**
   * Préfixes de routes que cette entrée explique DÉJÀ, quand le chemin réel ne
   * descend pas de `href`.
   *
   * Le garde de couverture (`guide-catalog.test.ts`) parcourt l'arbre de routes
   * RÉEL et exige que chaque page membre soit expliquée par une entrée. La règle
   * de descendance couvre les cas évidents (`/journal/new` sous `/journal`), mais
   * certaines surfaces vivent ailleurs que sous leur parent pédagogique — le
   * questionnaire hebdo est en `/calendar/...` alors que la page est `/calendrier`.
   * Les déclarer ici est un choix explicite et relu, pas un trou silencieux.
   */
  covers?: readonly string[];
  /**
   * Icône de la surface — À NE RENSEIGNER QUE pour une entrée absente de la nav.
   *
   * Le repère visuel d'une surface est déjà défini une fois, dans `nav-items.ts` :
   * c'est le glyphe que le membre voit dans la sidebar et la bottom-nav. Le guide
   * le RÉUTILISE (voir {@link guideEntryIcon}) au lieu d'en choisir un second, pour
   * qu'une carte du sommaire et l'entrée de nav correspondante ne puissent jamais
   * montrer deux symboles différents pour le même écran.
   *
   * Ce champ n'existe donc que pour les surfaces qui n'ont pas d'entrée de nav —
   * aujourd'hui `/install`. Le renseigner sur une entrée qui EST dans la nav
   * dupliquerait la source de vérité : `guide-catalog.test.ts` le refuse.
   */
  icon?: LucideIcon;
}

/**
 * Pages non-admin qui n'ont DÉLIBÉRÉMENT pas d'entrée guide, chacune avec sa raison.
 *
 * Contrepartie de l'exhaustivité : le garde exige qu'une page membre soit
 * expliquée OU exemptée ici. Une exemption est une décision qu'on lit, pas un
 * oubli qu'on ne voit pas. Le garde vérifie aussi qu'aucune exemption ne pointe
 * vers une route disparue, pour que cette liste ne pourrisse pas en silence.
 */
export const GUIDE_ROUTE_EXEMPTIONS: Readonly<Record<string, string>> = {
  '/': 'Splash publique : redirige, ne se visite pas.',
  '/login': 'Surface publique pré-authentification.',
  '/forgot-password': 'Surface publique pré-authentification.',
  '/reset-password': 'Surface publique pré-authentification.',
  '/rejoindre': 'Page publique de candidature, hors app membre.',
  '/legal/mentions': 'Page légale, atteinte par le footer.',
  '/legal/privacy': 'Page légale, atteinte par le footer.',
  '/legal/terms': 'Page légale, atteinte par le footer.',
  '/legal/ai-disclosure': 'Page légale, atteinte par le footer.',
  '/onboarding/welcome': 'Parcours d’entrée à usage unique, guidé de bout en bout.',
  '/onboarding/photo': 'Parcours d’entrée à usage unique, guidé de bout en bout.',
  '/onboarding/interview': 'Parcours d’entrée à usage unique, guidé de bout en bout.',
  '/onboarding/interview/new': 'Parcours d’entrée à usage unique, guidé de bout en bout.',
  '/onboarding/interview/complete': 'Parcours d’entrée à usage unique, guidé de bout en bout.',
  '/offline': 'Page système affichée par le service worker quand le réseau tombe.',
  '/design': 'Page de référence du design system, pas une surface membre.',
};

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
 * Le glyphe de chaque route membre, tel que la nav le montre déjà.
 *
 * Dérivé LIVE de `nav-items.ts` : changer l'icône d'un écran dans la nav change
 * aussi sa vignette dans le guide, sans qu'on ait à y penser. C'est la version
 * non-périssable du « repère visuel par entrée » : une capture d'écran serait un
 * instantané qui se périme en silence à la première refonte de l'écran, alors
 * qu'un glyphe SSOT reste vrai par construction.
 */
export function navIconByHref(): Map<string, LucideIcon> {
  const entries = new Map<string, LucideIcon>();
  for (const group of NAV_GROUPS) {
    if (group.admin) continue;
    for (const item of group.items) {
      if (item.admin) continue;
      entries.set(item.href, item.icon);
    }
  }
  for (const item of BOTTOM_NAV) {
    if (item.admin) continue;
    if (!entries.has(item.href)) entries.set(item.href, item.icon);
  }
  return entries;
}

/**
 * L'icône à afficher pour une entrée : celle de la nav si la surface y figure,
 * sinon celle que l'entrée déclare elle-même.
 *
 * Retourne `null` quand aucune des deux n'existe — le rendu doit alors dégrader
 * proprement plutôt qu'inventer un glyphe, et `guide-catalog.test.ts` casse pour
 * signaler qu'une entrée est arrivée sans repère visuel.
 */
export function guideEntryIcon(entry: GuideEntry): LucideIcon | null {
  return navIconByHref().get(entry.href) ?? entry.icon ?? null;
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
    when: 'Chaque jour en ouvrant l’app : c’est ton point de départ, tout part de là.',
    group: 'Accueil',
    // Le relevé de process (`/tracking/<instrument>`) n'est proposé que depuis le
    // plan du jour de l'accueil — c'est donc l'accueil qui l'explique.
    covers: ['/tracking'],
  },

  // Ma progression
  {
    href: '/progression',
    title: 'Où j’en suis',
    blurb: 'Ta vue d’ensemble : tes scores, ta trajectoire et ce qui se solidifie au fil du temps.',
    when: 'Une fois par semaine environ, pour regarder la tendance plutôt que la journée.',
    group: 'Ma progression',
  },
  {
    href: '/classement',
    title: 'Classement',
    blurb: 'Le classement du groupe, pour te situer parmi les autres membres.',
    when: 'Quand tu veux te situer dans le groupe : un repère, pas une course.',
    group: 'Ma progression',
  },
  {
    href: '/objectifs',
    title: 'Mes objectifs',
    blurb:
      'Tes objectifs de process, pour te fixer un cap sur ta discipline, jamais sur des promesses de gains.',
    when: 'Au début d’un cycle, puis à chaque revue hebdo pour ajuster ton cap.',
    group: 'Ma progression',
  },
  {
    href: '/patterns',
    title: 'Patterns',
    blurb: 'Les patterns qui reviennent dans ton trading, en bien comme en mal.',
    when: 'Après quelques semaines de journal, quand il y a assez de matière pour voir des retours.',
    group: 'Ma progression',
  },

  // Au quotidien
  {
    href: '/checkin',
    title: 'Check-in',
    blurb:
      'Ton check-in du jour : ton état le matin, ton bilan le soir, et ton streak de régularité.',
    when: 'Deux fois par jour : le matin avant d’ouvrir le marché, le soir au moment du bilan.',
    group: 'Au quotidien',
  },
  {
    href: '/checkin/history',
    title: 'Historique',
    blurb: 'L’historique de tes check-ins passés, pour relire ton évolution jour après jour.',
    when: 'Quand tu veux relire une période, ou comprendre un trou dans ta régularité.',
    group: 'Au quotidien',
  },
  {
    href: '/pre-trade/new',
    title: 'Pré-trade',
    blurb:
      'Une pause de trente secondes avant d’entrer : ta raison, ton émotion et ton plan, pour trader en conscience.',
    when: 'Juste avant d’entrer en position, à chaud : c’est là que ça change quelque chose.',
    group: 'Au quotidien',
    // La page de confirmation de la pause vit sous `/pre-trade/done/<id>`, hors de
    // la descendance de `/pre-trade/new`.
    covers: ['/pre-trade/done'],
  },
  {
    href: '/track',
    title: 'Habitudes',
    blurb:
      'Le suivi de tes habitudes : sommeil, nutrition, sport, ces piliers qui soutiennent ta pratique.',
    when: 'Chaque soir, en même temps que ton bilan : quelques secondes par habitude.',
    group: 'Au quotidien',
  },
  {
    href: '/journal',
    title: 'Journal',
    blurb:
      'Ton journal de trading : chaque trade avec ton plan, tes émotions et le respect de ton process.',
    when: 'À chaque trade : une fois à l’ouverture, une fois à la clôture.',
    group: 'Au quotidien',
  },

  // Mental & vérité
  {
    href: '/mindset',
    title: 'Mindset',
    blurb: 'Tes QCM de mental récurrents, à la manière de Mark Douglas, pour voir où tu en es.',
    when: 'Quand un QCM t’est proposé : quelques minutes, au calme, à ton rythme.',
    group: 'Mental & vérité',
  },
  {
    href: '/reflect',
    title: 'Réflexion',
    blurb: 'Ton espace de réflexion guidée, pour prendre du recul sur ta semaine et sur toi.',
    when: 'Quand tu as besoin de poser quelque chose par écrit, sans format imposé.',
    group: 'Mental & vérité',
  },
  {
    href: '/verification',
    title: 'Vérification',
    blurb:
      'La vérité : ce que tu déclares confronté à ce que tu fais réellement, pour mesurer l’écart sans te juger.',
    when: 'Après quelques semaines de données, quand l’écart déclaré/réel devient mesurable.',
    group: 'Mental & vérité',
  },
  {
    href: '/library',
    title: 'Bibliothèque',
    blurb:
      'La bibliothèque des fiches Mark Douglas, à lire librement pour travailler ta psychologie.',
    when: 'Quand tu bloques sur un point de mental, ou simplement pour lire une fiche au calme.',
    group: 'Mental & vérité',
  },

  // Suivi & orga
  {
    href: '/review',
    title: 'Revue hebdo',
    blurb: 'Ta revue hebdomadaire, pour faire le bilan de la semaine et poser tes leçons.',
    when: 'Une fois par semaine, quand la semaine est finie et que tu peux la relire.',
    group: 'Suivi & orga',
  },
  {
    href: '/debrief-mensuel',
    title: 'Débrief mensuel',
    blurb: 'Ton débrief mensuel généré avec l’IA, une synthèse de ton mois de pratique.',
    when: 'Une fois par mois, quand le mois est terminé et qu’il y a de quoi synthétiser.',
    group: 'Suivi & orga',
  },
  {
    href: '/training',
    title: 'Entraînement',
    blurb:
      'Ton journal d’entraînement : tes backtests et ton travail hors marché réel, isolés de tes vrais trades.',
    when: 'À chaque session de backtest ou de travail hors marché réel.',
    group: 'Suivi & orga',
  },
  {
    href: '/calendrier',
    title: 'Calendrier',
    blurb:
      'Ton calendrier adaptatif de la semaine, organisé autour de tes disponibilités et de tes créneaux de pratique.',
    when: 'En début de semaine, pour poser tes créneaux avant que la semaine ne les pose pour toi.',
    group: 'Suivi & orga',
    // Le questionnaire hebdo qui alimente le calendrier vit sous `/calendar/...`
    // (chemin anglais historique), pas sous `/calendrier`.
    covers: ['/calendar/questionnaire'],
  },
  {
    href: '/reunions',
    title: 'Réunions',
    blurb: 'Tes réunions et ta présence aux créneaux du groupe.',
    when: 'Avant un créneau du groupe pour t’y préparer, après pour marquer ta présence.',
    group: 'Suivi & orga',
  },
  {
    href: '/seances',
    title: 'Séances',
    blurb: 'Les séances et replays à suivre pour progresser à ton rythme.',
    when: 'Quand tu veux suivre une séance, ou rattraper celle que tu as manquée.',
    group: 'Suivi & orga',
  },

  // Compte
  {
    href: '/profile',
    title: 'Profil',
    blurb:
      'Ton profil psychologique et tes axes prioritaires, dressés à partir de ton entretien d’onboarding.',
    when: 'Après ton entretien d’entrée, puis quand tu veux relire tes axes de travail.',
    group: 'Compte',
  },
  {
    href: '/guide',
    title: 'Guide',
    blurb: 'Ce guide d’utilisation, pilier par pilier, pour ne jamais être perdu dans l’app.',
    when: 'Dès que tu te demandes où trouver quelque chose, ou à quoi sert un écran.',
    group: 'Compte',
  },
  {
    href: '/install',
    title: 'Installer l’app',
    blurb:
      'Les étapes pour poser Fxmily sur ton écran d’accueil, avec le parcours exact de ton téléphone ou de ton navigateur.',
    when: 'Une seule fois, au début, et obligatoire sur iPhone pour recevoir les notifications.',
    group: 'Compte',
    // Seule entrée du catalogue absente de la nav : elle déclare donc son propre
    // glyphe. Le même `Smartphone` que la carte « Sur ton téléphone » plus bas.
    icon: Smartphone,
  },
  {
    href: '/account',
    title: 'Compte',
    blurb: 'Les réglages de ton compte : notifications, données personnelles et confidentialité.',
    when: 'Quand tu veux régler tes notifications, ton fuseau horaire ou tes données.',
    group: 'Compte',
  },
];
