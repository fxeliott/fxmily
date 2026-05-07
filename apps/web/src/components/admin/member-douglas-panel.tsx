import { Activity, BookOpen, Eye, EyeOff, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import Link from 'next/link';

import { CATEGORY_ICON, CATEGORY_LABEL, CATEGORY_TONE } from '@/components/library/category-meta';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Pill } from '@/components/ui/pill';
import type { MemberDeliveryAggregate } from '@/lib/admin/cards-service';
import type { SerializedDelivery } from '@/lib/cards/types';

interface MemberDouglasPanelProps {
  deliveries: SerializedDelivery[];
  stats: MemberDeliveryAggregate;
}

const DT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Admin view of one member's Mark Douglas activity (J7, SPEC §7.7).
 *
 * Shows aggregate stats + chronological deliveries timeline. Read-only —
 * admin can see what's been pushed, when it was seen, and how the member
 * felt. No edit affordances at this stage; future J7.5 may add manual
 * delivery (admin pushes a card on demand).
 */
export function MemberDouglasPanel({ deliveries, stats }: MemberDouglasPanelProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card className="p-4">
          <p className="text-muted text-[11px] uppercase tracking-wide">Reçues</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{stats.total}</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted text-[11px] uppercase tracking-wide">Non lues</p>
          <p
            className={
              'mt-1 text-xl font-semibold tabular-nums ' +
              (stats.unread > 0 ? 'text-warn' : 'text-muted')
            }
          >
            {stats.unread}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-muted text-[11px] uppercase tracking-wide">Utiles</p>
          <p className="text-acc mt-1 text-xl font-semibold tabular-nums">{stats.helpful}</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted text-[11px] uppercase tracking-wide">Pas utiles</p>
          <p className="text-warn mt-1 text-xl font-semibold tabular-nums">{stats.notHelpful}</p>
        </Card>
        <Card className="p-4">
          <p className="text-muted text-[11px] uppercase tracking-wide">Ignorées</p>
          <p className="text-muted mt-1 text-xl font-semibold tabular-nums">{stats.dismissed}</p>
        </Card>
      </div>

      {/* Timeline */}
      {deliveries.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={Activity}
            headline="Aucune fiche reçue pour l'instant"
            lead="Le système n'a pas encore détecté de pattern qui justifie de pousser une fiche à ce membre. Quand un trigger matchera (3 pertes, FOMO, etc.), la fiche apparaîtra ici."
            tip="Tu peux toujours parcourir la bibliothèque pour voir ce que le membre verra une fois éligible."
          />
        </Card>
      ) : (
        <Card className="p-0">
          <header className="border-border flex items-center justify-between border-b px-5 py-4">
            <div className="flex items-center gap-2">
              <BookOpen className="text-acc h-4 w-4" aria-hidden />
              <h2 className="text-sm font-semibold">Timeline des fiches reçues</h2>
              <Pill tone="mute">{deliveries.length}</Pill>
            </div>
          </header>
          <ul className="flex flex-col">
            {deliveries.map((d) => {
              const Icon = CATEGORY_ICON[d.cardCategory];
              const tone = CATEGORY_TONE[d.cardCategory];
              const helpfulPill =
                d.helpful === true ? (
                  <Pill tone="acc">
                    <ThumbsUp className="h-3 w-3" />
                    Utile
                  </Pill>
                ) : d.helpful === false ? (
                  <Pill tone="warn">
                    <ThumbsDown className="h-3 w-3" />
                    Pas utile
                  </Pill>
                ) : null;
              return (
                <li
                  key={d.id}
                  className="border-border flex flex-col gap-2 border-b px-5 py-4 last:border-b-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className="text-acc h-3.5 w-3.5" aria-hidden />
                    <Pill tone={tone}>{CATEGORY_LABEL[d.cardCategory]}</Pill>
                    {d.seenAt ? (
                      <Pill tone="mute">
                        <Eye className="h-3 w-3" />
                        Lue
                      </Pill>
                    ) : (
                      <Pill tone="warn" dot="live">
                        Non lue
                      </Pill>
                    )}
                    {d.dismissedAt && (
                      <Pill tone="mute">
                        <X className="h-3 w-3" />
                        Ignorée
                      </Pill>
                    )}
                    {helpfulPill}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Link
                      href={`/library/${d.cardSlug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-acc text-base font-semibold leading-snug"
                    >
                      {d.cardTitle}
                    </Link>
                    <span className="text-muted text-xs">
                      <EyeOff className="mr-1 inline h-3 w-3" aria-hidden />
                      {DT.format(new Date(d.createdAt))}
                    </span>
                  </div>
                  <p className="text-muted text-xs">
                    Trigger : <span className="text-foreground/80">{d.triggeredBy}</span>
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
