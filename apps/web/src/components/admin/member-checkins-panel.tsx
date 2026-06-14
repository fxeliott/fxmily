import { Check, Moon, Sun, X } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { checkinEmotionLabel } from '@/lib/checkin/emotions';
import type { SerializedCheckin } from '@/lib/checkin/service';

/**
 * S7 §22-23 — admin read-only daily check-ins panel (« TOUT tracker pour
 * l'admin »). Server-rendered, zero mutation, calm factual copy (carbon of
 * the other admin panels). Closes the previously-dead `?tab=checkins` link.
 *
 * SPEC §2 posture: a check-in carries NO market content — `intention` is a
 * one-line mindset note, the booleans (`marketAnalysisDone`, `planRespected
 * Today`, `hedgeRespectedToday`, `formationFollowed`) are declarative
 * discipline ACTS (that it happened, never what was analysed/studied).
 */

const DAY_FMT = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Paris',
});

interface MemberCheckinsPanelProps {
  checkins: SerializedCheckin[];
}

interface DayGroup {
  date: string;
  morning: SerializedCheckin | null;
  evening: SerializedCheckin | null;
}

function groupByDay(checkins: SerializedCheckin[]): DayGroup[] {
  const byDate = new Map<string, DayGroup>();
  for (const c of checkins) {
    let group = byDate.get(c.date);
    if (!group) {
      group = { date: c.date, morning: null, evening: null };
      byDate.set(c.date, group);
    }
    if (c.slot === 'morning') group.morning = c;
    else group.evening = c;
  }
  // Insertion order already follows the loader's `date desc` ordering.
  return Array.from(byDate.values());
}

export function MemberCheckinsPanel({ checkins }: MemberCheckinsPanelProps) {
  if (checkins.length === 0) {
    return (
      <Card className="p-6 text-center">
        <p className="t-body text-[var(--t-3)]">Ce membre n&apos;a encore rempli aucun check-in.</p>
        <p className="t-cap mt-1 text-[var(--t-4)]">
          Les check-ins matin / soir apparaîtront ici dès qu&apos;il en remplira un.
        </p>
      </Card>
    );
  }

  const days = groupByDay(checkins);

  return (
    <div className="flex flex-col gap-3">
      <p className="t-cap text-[var(--t-4)]">
        {days.length} jour{days.length > 1 ? 's' : ''} avec check-in · {checkins.length} entrée
        {checkins.length > 1 ? 's' : ''} (30 derniers jours)
      </p>

      {days.map((day) => (
        <Card key={day.date} className="flex flex-col gap-4 p-4">
          <h2 className="t-h3 flex items-center gap-2 text-[var(--t-1)] capitalize">
            {DAY_FMT.format(new Date(`${day.date}T12:00:00Z`))}
            <span className="ml-auto flex items-center gap-1.5">
              <Pill tone={day.morning ? 'ok' : 'mute'}>
                <Sun className="h-2.5 w-2.5" strokeWidth={2} />
                Matin
              </Pill>
              <Pill tone={day.evening ? 'ok' : 'mute'}>
                <Moon className="h-2.5 w-2.5" strokeWidth={2} />
                Soir
              </Pill>
            </span>
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <SlotBlock title="Matin" icon={<Sun className="h-3.5 w-3.5" strokeWidth={1.75} />}>
              {day.morning ? (
                <MorningFields c={day.morning} />
              ) : (
                <p className="t-cap text-[var(--t-4)]">Non rempli.</p>
              )}
            </SlotBlock>
            <SlotBlock title="Soir" icon={<Moon className="h-3.5 w-3.5" strokeWidth={1.75} />}>
              {day.evening ? (
                <EveningFields c={day.evening} />
              ) : (
                <p className="t-cap text-[var(--t-4)]">Non rempli.</p>
              )}
            </SlotBlock>
          </div>
        </Card>
      ))}
    </div>
  );
}

function SlotBlock({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="t-eyebrow flex items-center gap-1.5 text-[var(--t-3)]">
        {icon}
        {title}
      </h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function MorningFields({ c }: { c: SerializedCheckin }) {
  return (
    <>
      <Field
        label="Sommeil"
        value={
          c.sleepHours !== null
            ? `${c.sleepHours} h${c.sleepQuality !== null ? ` · qualité ${c.sleepQuality}/10` : ''}`
            : null
        }
      />
      <Field label="Humeur" value={c.moodScore !== null ? `${c.moodScore}/10` : null} />
      <TriState label="Analyse de marché faite" value={c.marketAnalysisDone} />
      <TriState label="Routine matinale" value={c.morningRoutineCompleted} />
      <Field
        label="Méditation"
        value={c.meditationMin !== null ? `${c.meditationMin} min` : null}
      />
      <Field
        label="Sport"
        value={
          c.sportType
            ? `${c.sportType}${c.sportDurationMin !== null ? ` · ${c.sportDurationMin} min` : ''}`
            : null
        }
      />
      <TextField label="Intention" value={c.intention} />
      <Emotions tags={c.emotionTags} />
    </>
  );
}

function EveningFields({ c }: { c: SerializedCheckin }) {
  return (
    <>
      <TriState label="Plan respecté" value={c.planRespectedToday} />
      <TriState label="Hedge respecté" value={c.hedgeRespectedToday} />
      <TriState label="Formation suivie" value={c.formationFollowed} />
      <Field label="Humeur" value={c.moodScore !== null ? `${c.moodScore}/10` : null} />
      <Field label="Stress" value={c.stressScore !== null ? `${c.stressScore}/10` : null} />
      <Field
        label="Hydratation"
        value={
          c.waterLiters !== null || c.caffeineMl !== null
            ? [
                c.waterLiters !== null ? `${c.waterLiters} L eau` : null,
                c.caffeineMl !== null ? `${c.caffeineMl} mL caféine` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : null
        }
      />
      {c.gratitudeItems.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <span className="t-cap text-[var(--t-4)]">Gratitude</span>
          <ul className="t-body flex list-disc flex-col gap-0.5 pl-4 break-words text-[var(--t-2)]">
            {c.gratitudeItems.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <Emotions tags={c.emotionTags} />
      <TextField label="Note" value={c.journalNote} />
    </>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="t-cap text-[var(--t-4)]">{label}</span>
      <span className="t-body text-right text-[var(--t-2)] tabular-nums">{value}</span>
    </div>
  );
}

function TextField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="t-cap text-[var(--t-4)]">{label}</span>
      <p className="t-body break-words whitespace-pre-wrap text-[var(--t-2)]">{value}</p>
    </div>
  );
}

/** Tri-state boolean: true → ✓ Oui, false → ✗ Non, null → not rendered. */
function TriState({ label, value }: { label: string; value: boolean | null }) {
  if (value === null) return null;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="t-cap text-[var(--t-4)]">{label}</span>
      {value ? (
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ok)]">
          <Check className="h-3 w-3" strokeWidth={2.25} aria-hidden />
          Oui
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--warn)]">
          <X className="h-3 w-3" strokeWidth={2.25} aria-hidden />
          Non
        </span>
      )}
    </div>
  );
}

function Emotions({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="t-cap text-[var(--t-4)]">Émotions</span>
      <div className="flex flex-wrap gap-1">
        {tags.map((slug) => (
          <Pill key={slug} tone="mute">
            {checkinEmotionLabel(slug)}
          </Pill>
        ))}
      </div>
    </div>
  );
}
