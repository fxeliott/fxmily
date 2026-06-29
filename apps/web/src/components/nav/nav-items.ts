import {
  BookOpen,
  Brain,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  Clapperboard,
  FileBarChart,
  Gauge,
  GraduationCap,
  HeartPulse,
  Inbox,
  LayoutDashboard,
  Library,
  LineChart,
  type LucideIcon,
  Network,
  ScanSearch,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  UserCircle,
  Users,
  Waves,
} from 'lucide-react';

/**
 * Information architecture for the authenticated app shell (AppShell).
 *
 * V2 refonte J2 — la nav s'organise autour des 4 INTENTIONS DE GUIDAGE plutôt
 * que par type technique : « Ma progression » (où j'en suis / où je vais /
 * objectifs / patterns), « Au quotidien » (les gestes du jour), « Mental &
 * vérité », « Suivi & orga ». Le dashboard redevient un hub d'action épuré ; les
 * surfaces analytiques rétrospectives vivent sous « Ma progression »
 * (/progression, /patterns). Cartographie : 75 routes (membre + admin).
 *
 * Surlignage actif via `isNavItemActive()` (exact, ou préfixe de segment).
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Admin-only — masqué pour les membres. */
  admin?: boolean;
}

export interface NavGroup {
  /** Libellé de groupe (sidebar desktop + drawer). `null` = pas d'entête. */
  label: string | null;
  items: NavItem[];
  admin?: boolean;
}

/** Groupes pour la sidebar desktop + le drawer mobile. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ href: '/dashboard', label: 'Accueil', icon: LayoutDashboard }],
  },
  {
    label: 'Ma progression',
    items: [
      { href: '/progression', label: 'Où j’en suis', icon: Gauge },
      { href: '/objectifs', label: 'Mes objectifs', icon: Target },
      { href: '/patterns', label: 'Patterns', icon: Network },
    ],
  },
  {
    label: 'Au quotidien',
    items: [
      { href: '/checkin', label: 'Check-in', icon: ClipboardCheck },
      { href: '/pre-trade/new', label: 'Pré-trade', icon: ShieldCheck },
      { href: '/track', label: 'Habitudes', icon: Waves },
      { href: '/journal', label: 'Journal', icon: BookOpen },
    ],
  },
  {
    label: 'Mental & vérité',
    items: [
      { href: '/mindset', label: 'Mindset', icon: Brain },
      { href: '/reflect', label: 'Réflexion', icon: Sparkles },
      { href: '/verification', label: 'Vérification', icon: ScanSearch },
      { href: '/library', label: 'Bibliothèque', icon: Library },
    ],
  },
  {
    label: 'Suivi & orga',
    items: [
      { href: '/review', label: 'Revue hebdo', icon: LineChart },
      { href: '/debrief-mensuel', label: 'Débrief mensuel', icon: CalendarRange },
      { href: '/training', label: 'Entraînement', icon: GraduationCap },
      { href: '/calendrier', label: 'Calendrier', icon: CalendarDays },
      { href: '/reunions', label: 'Réunions', icon: Users },
      { href: '/seances', label: 'Séances', icon: Clapperboard },
    ],
  },
  {
    label: 'Compte',
    items: [
      { href: '/profile', label: 'Profil', icon: UserCircle },
      { href: '/guide', label: 'Guide', icon: BookOpen },
      { href: '/account', label: 'Compte', icon: Settings },
    ],
  },
  {
    label: 'Admin',
    admin: true,
    items: [
      { href: '/admin/members', label: 'Membres', icon: Users, admin: true },
      { href: '/admin/access-requests', label: 'Demandes', icon: Inbox, admin: true },
      { href: '/admin/cards', label: 'Fiches Douglas', icon: Library, admin: true },
      { href: '/admin/reunions', label: 'Réunions', icon: CalendarRange, admin: true },
      { href: '/admin/reports', label: 'Rapports', icon: FileBarChart, admin: true },
      { href: '/admin/health', label: 'Santé métier', icon: HeartPulse, admin: true },
      { href: '/admin/system', label: 'Système', icon: Settings, admin: true },
    ],
  },
];

/**
 * Les 4 onglets de la bottom-nav mobile (+ « Menu » rendu par l'AppShell = 5e
 * colonne). « Progression » est promue first-class sur mobile (intention #1).
 */
export const BOTTOM_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Accueil', icon: LayoutDashboard },
  { href: '/checkin', label: 'Check-in', icon: ClipboardCheck },
  { href: '/journal', label: 'Journal', icon: BookOpen },
  { href: '/progression', label: 'Progression', icon: Gauge },
];

/**
 * Un item est actif si le chemin courant l'égale, OU en est un sous-chemin de
 * segment (`/journal` actif sur `/journal/123`), MAIS `/dashboard` reste exact
 * pour ne pas s'allumer partout. Évite le piège substring (`/track` vs
 * `/tracking`) en exigeant une frontière `/`.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === '/dashboard') return false;
  return pathname.startsWith(`${href}/`);
}
