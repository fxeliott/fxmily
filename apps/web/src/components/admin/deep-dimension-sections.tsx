import { GraduationCap, ListChecks, MessageSquare, Radar } from 'lucide-react';

import {
  axesStructuredSchema,
  coachingToneSchema,
  learningStageSchema,
  weakSignalsSchema,
  type MemberProfileAxisStructured,
  type MemberProfileCoachingTone,
  type MemberProfileLearningStage,
  type MemberProfileWeakSignal,
} from '@/lib/schemas/onboarding-interview';

/**
 * J-E inc.3 — the 4 deep-AI dimension section renderers, extracted from
 * `member-profile-viewer-admin.tsx` so ONE renderer serves BOTH surfaces the
 * schema promised to treat identically (`member-profile-monthly-snapshot.ts`
 * header): the onboarding `MemberProfile` baseline AND each monthly
 * re-profiling snapshot on the admin trajectory. Same shape (the monthly
 * output re-uses the onboarding sub-schemas verbatim), so the same Zod
 * `safeParse` + the same French labels + the same evidence idiom apply.
 *
 * Each section takes the RAW `unknown` field (Prisma `Json?`, `null` on
 * legacy/partial rows) and defends itself: `safeParse` never throws and the
 * section degrades to `null` when the field is absent/garbage.
 *
 * `idPrefix` namespaces the heading `id` / `aria-labelledby` so the sections
 * can render MANY times on one page (once per month on the trajectory) without
 * colliding element ids. The onboarding viewer passes `"profile-admin"` to keep
 * its historical ids (`profile-admin-tone-heading`, ...) byte-identical.
 *
 * `headingLevel` keeps a valid document outline: the onboarding viewer renders
 * these as top-level `h2` sections (default), while the trajectory nests them
 * under a per-month `h3`, so they drop to `h4` (no descending-order violation).
 *
 * Posture §J / §16 — descriptif comportemental, jamais clinique (enforced AT
 * prompt/persist by the safety gate + Zod `.strict()`). `weakSignals` is
 * ADMIN-ONLY by design (schema): calm tone only, never an alert.
 */

export type DimensionHeadingLevel = 'h2' | 'h3' | 'h4';

// No `.t-h4` utility exists (globals.css stops at t-h3); an h4 heading reuses
// the smallest heading size so the visual weight tracks the nesting depth.
const HEADING_CLASS: Record<DimensionHeadingLevel, string> = {
  h2: 't-h2',
  h3: 't-h3',
  h4: 't-h3',
};

// The 4 deep-AI dimensions arrive as `unknown`. Parse defensively with the same
// Zod schemas used at write time: safeParse never throws on null/garbage and
// returns a clean empty result, so each section degrades to nothing.
export function asCoachingTone(raw: unknown): MemberProfileCoachingTone | null {
  const parsed = coachingToneSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function asLearningStage(raw: unknown): MemberProfileLearningStage | null {
  const parsed = learningStageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function asAxesStructured(raw: unknown): MemberProfileAxisStructured[] {
  const parsed = axesStructuredSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

export function asWeakSignals(raw: unknown): MemberProfileWeakSignal[] {
  const parsed = weakSignalsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

// Enum -> French label maps (no em-dash per Eliott's copy rule). Descriptive
// only, never clinical, never anthropomorphized ("l'IA pense" banned).
const REGISTER_LABEL: Record<MemberProfileCoachingTone['register'], string> = {
  direct: 'Direct',
  pedagogique: 'Pédagogique',
  socratique: 'Socratique',
};

const STAGE_LABEL: Record<MemberProfileLearningStage['stage'], string> = {
  mechanical: 'Mécanique',
  subjective: 'Subjectif',
  intuitive: 'Intuitif',
};

/** Verbatim member citations rendered as a quoted list (shared idiom). */
export function EvidenceList({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5 border-l-2 border-[var(--b-acc)] pl-3">
      {items.map((e, ei) => (
        <li
          key={ei}
          className="t-cap text-[var(--t-2)] italic before:mr-2 before:content-['«'] after:ml-2 after:content-['»']"
        >
          {e}
        </li>
      ))}
    </ul>
  );
}

/** Small accent icon chip reused across the dimension section headers. */
export function DimensionIcon({ icon: Icon }: { icon: typeof MessageSquare }) {
  return (
    <div
      aria-hidden="true"
      className="rounded-pill mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border"
      style={{ background: 'var(--acc-dim)', borderColor: 'var(--b-acc)', color: 'var(--acc)' }}
    >
      <Icon className="h-4 w-4" strokeWidth={2.2} />
    </div>
  );
}

/** Icon + level-correct heading + descriptive subtitle (shared by all sections). */
function DimensionSectionHeader({
  icon,
  headingId,
  headingLevel,
  title,
  subtitle,
}: {
  icon: typeof MessageSquare;
  headingId: string;
  headingLevel: DimensionHeadingLevel;
  title: string;
  subtitle: string;
}) {
  const Heading = headingLevel;
  return (
    <div className="flex items-start gap-3">
      <DimensionIcon icon={icon} />
      <div className="min-w-0 flex-1">
        <Heading id={headingId} className={`${HEADING_CLASS[headingLevel]} text-[var(--t-1)]`}>
          {title}
        </Heading>
        <p className="t-cap mt-1 text-[var(--t-3)]">{subtitle}</p>
      </div>
    </div>
  );
}

/** Shared accent pill used to surface the enum value (register / stage). */
function DimensionPill({ children }: { children: string }) {
  return (
    <span className="rounded-pill inline-flex w-fit items-center border border-[var(--b-acc)] bg-[var(--acc-dim)] px-2.5 py-1 text-[11px] font-semibold text-[var(--acc)]">
      {children}
    </span>
  );
}

interface DimensionSectionProps {
  raw: unknown;
  idPrefix: string;
  headingLevel?: DimensionHeadingLevel;
}

/** Registre de coaching suggéré (coachingTone). */
export function CoachingToneSection({ raw, idPrefix, headingLevel = 'h2' }: DimensionSectionProps) {
  const tone = asCoachingTone(raw);
  if (!tone) return null;
  return (
    <section
      className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-2)] p-6"
      aria-labelledby={`${idPrefix}-tone-heading`}
    >
      <DimensionSectionHeader
        icon={MessageSquare}
        headingId={`${idPrefix}-tone-heading`}
        headingLevel={headingLevel}
        title="Registre de coaching suggéré"
        subtitle="Le style d'accompagnement le mieux adapté à ce membre."
      />
      <DimensionPill>{REGISTER_LABEL[tone.register]}</DimensionPill>
      <p className="t-body leading-relaxed text-[var(--t-2)]">{tone.rationale}</p>
      <EvidenceList items={tone.evidence} />
    </section>
  );
}

/** Stade d'apprentissage Mark Douglas (learningStage). */
export function LearningStageSection({
  raw,
  idPrefix,
  headingLevel = 'h2',
}: DimensionSectionProps) {
  const stage = asLearningStage(raw);
  if (!stage) return null;
  return (
    <section
      className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-2)] p-6"
      aria-labelledby={`${idPrefix}-stage-heading`}
    >
      <DimensionSectionHeader
        icon={GraduationCap}
        headingId={`${idPrefix}-stage-heading`}
        headingLevel={headingLevel}
        title="Stade d'apprentissage"
        subtitle="Grille Mark Douglas (The Disciplined Trader) : mécanique, subjectif, intuitif."
      />
      <DimensionPill>{STAGE_LABEL[stage.stage]}</DimensionPill>
      <p className="t-body leading-relaxed text-[var(--t-2)]">{stage.rationale}</p>
      <EvidenceList items={stage.evidence} />
    </section>
  );
}

/** Axes prioritaires structurés (axesStructured), classés par urgence. */
export function AxesStructuredSection({
  raw,
  idPrefix,
  headingLevel = 'h2',
}: DimensionSectionProps) {
  const axes = asAxesStructured(raw);
  if (axes.length === 0) return null;
  const sorted = [...axes].sort((a, b) => a.priority - b.priority);
  return (
    <section
      className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-2)] p-6"
      aria-labelledby={`${idPrefix}-axes-structured-heading`}
    >
      <DimensionSectionHeader
        icon={ListChecks}
        headingId={`${idPrefix}-axes-structured-heading`}
        headingLevel={headingLevel}
        title="Axes prioritaires structurés"
        subtitle="Classés par urgence (1 = le plus prioritaire), avec la citation qui les fonde."
      />
      <ol className="flex flex-col gap-4">
        {sorted.map((axis, i) => (
          <li key={i} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="rounded-pill mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border border-[var(--b-acc)] bg-[var(--acc-dim)] font-mono text-[11px] font-semibold text-[var(--acc)]"
            >
              {axis.priority}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="t-body text-[var(--t-1)]">{axis.axis}</p>
              <EvidenceList items={axis.evidence} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Signaux faibles à observer (weakSignals). ADMIN-ONLY par design (schema :
 * non anxiogène côté membre). Ton calme uniquement, jamais d'alerte : ce sont
 * des patterns latents à surveiller.
 */
export function WeakSignalsSection({ raw, idPrefix, headingLevel = 'h2' }: DimensionSectionProps) {
  const signals = asWeakSignals(raw);
  if (signals.length === 0) return null;
  return (
    <section
      className="rounded-card-lg flex flex-col gap-4 border border-[var(--b-default)] bg-[var(--bg-2)] p-6"
      aria-labelledby={`${idPrefix}-weak-signals-heading`}
    >
      <DimensionSectionHeader
        icon={Radar}
        headingId={`${idPrefix}-weak-signals-heading`}
        headingLevel={headingLevel}
        title="Signaux faibles à observer"
        subtitle="Patterns latents à surveiller côté coaching. Pour ton usage admin, sans dramatiser."
      />
      <ul className="flex flex-col gap-4">
        {signals.map((s, i) => (
          <li key={i} className="flex flex-col gap-2">
            <p className="t-body text-[var(--t-1)]">{s.signal}</p>
            <EvidenceList items={s.evidence} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Convenience wrapper rendering all 4 deep-dimension sections in canonical
 * order (coaching tone → learning stage → structured axes → weak signals).
 * Used by the monthly trajectory panel (a contiguous 4-dim block per month).
 * The onboarding viewer does NOT use this wrapper: it interleaves the
 * onboarding-only `axesPrioritaires` string list between the stage and the
 * structured axes, so it composes the 4 sections individually.
 */
export function DeepDimensionSections({
  coachingTone,
  learningStage,
  axesStructured,
  weakSignals,
  idPrefix,
  headingLevel = 'h2',
}: {
  coachingTone: unknown;
  learningStage: unknown;
  axesStructured: unknown;
  weakSignals: unknown;
  idPrefix: string;
  headingLevel?: DimensionHeadingLevel;
}) {
  return (
    <>
      <CoachingToneSection raw={coachingTone} idPrefix={idPrefix} headingLevel={headingLevel} />
      <LearningStageSection raw={learningStage} idPrefix={idPrefix} headingLevel={headingLevel} />
      <AxesStructuredSection raw={axesStructured} idPrefix={idPrefix} headingLevel={headingLevel} />
      <WeakSignalsSection raw={weakSignals} idPrefix={idPrefix} headingLevel={headingLevel} />
    </>
  );
}
