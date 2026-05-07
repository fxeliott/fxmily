import {
  Brain,
  Compass,
  Dice5,
  Eye,
  Flame,
  Heart,
  Hourglass,
  Repeat,
  ShieldCheck,
  Sparkles,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

import type { DouglasCategory } from '@/generated/prisma/enums';

/**
 * Catégorie → label FR + icône lucide.
 * Centralisé ici pour réutilisation entre `/library`, `/admin/cards` et le
 * dashboard timeline.
 */

export const CATEGORY_LABEL: Record<DouglasCategory, string> = {
  acceptance: 'Acceptation',
  tilt: 'Tilt',
  discipline: 'Discipline',
  ego: 'Ego',
  probabilities: 'Probabilités',
  confidence: 'Confiance',
  patience: 'Patience',
  consistency: 'Consistance',
  fear: 'Peur',
  loss: 'Perte',
  process: 'Processus',
};

export const CATEGORY_ICON: Record<DouglasCategory, LucideIcon> = {
  acceptance: Heart,
  tilt: Flame,
  discipline: ShieldCheck,
  ego: Eye,
  probabilities: Dice5,
  confidence: Sparkles,
  patience: Hourglass,
  consistency: Repeat,
  fear: Brain,
  loss: Compass,
  process: Workflow,
};

/** Tone Pill par catégorie (cohérence visuelle dans le catalogue). */
export const CATEGORY_TONE: Record<DouglasCategory, 'mute' | 'acc' | 'cy' | 'warn' | 'bad'> = {
  acceptance: 'cy',
  tilt: 'bad',
  discipline: 'acc',
  ego: 'mute',
  probabilities: 'cy',
  confidence: 'acc',
  patience: 'mute',
  consistency: 'acc',
  fear: 'warn',
  loss: 'warn',
  process: 'mute',
};
