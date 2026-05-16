import { Brain, Coffee, Dumbbell, Moon, UtensilsCrossed } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { HabitKind } from '@/lib/schemas/habit-log';

/**
 * V2.1 TRACK — single source of truth for the 5 habit pillars
 * (kind / FR label / lucide icon / per-kind wizard route).
 *
 * Extracted from `<HabitKindPicker>` (V2.1.4) so the picker (Server
 * Component) and the global `<LogExpressFab>` (Client Component) share
 * ONE definition — no duplicated kind/label/icon/href arrays (anti-dup
 * rule, CLAUDE.md). Pure data, no JSX, no `'use client'`, no server-only
 * import → safe to import from either runtime.
 */

export interface HabitKindEntry {
  kind: HabitKind;
  label: string;
  Icon: LucideIcon;
  href: string;
}

export const HABIT_KIND_ENTRIES: readonly HabitKindEntry[] = [
  { kind: 'sleep', label: 'Sommeil', Icon: Moon, href: '/track/sleep/new' },
  { kind: 'nutrition', label: 'Nutrition', Icon: UtensilsCrossed, href: '/track/nutrition/new' },
  { kind: 'caffeine', label: 'Café', Icon: Coffee, href: '/track/caffeine/new' },
  { kind: 'sport', label: 'Sport', Icon: Dumbbell, href: '/track/sport/new' },
  { kind: 'meditation', label: 'Méditation', Icon: Brain, href: '/track/meditation/new' },
];
