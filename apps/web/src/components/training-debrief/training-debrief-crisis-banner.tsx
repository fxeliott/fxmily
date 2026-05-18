import { AlertTriangle, Phone } from 'lucide-react';

import { CRISIS_RESOURCES_FR } from '@/lib/safety/crisis-detection';

interface TrainingDebriefCrisisBannerProps {
  /** Crisis severity surfaced via URL query (`?crisis=high|medium`). */
  level: 'high' | 'medium';
}

/**
 * V1.3 — TrainingDebrief non-blocking crisis routing banner (SPEC §23.4).
 *
 * Faithful mirror of REFLECT's `<V18CrisisBanner>` (same role/aria, same
 * shared FR resources, same WCAG fixes) re-skinned to the cyan DS-v2 training
 * identity (§21.7 — never `.v18-theme`; the training surface owns its own
 * components, like J-T2/J-T3, no cross-import from `components/review/`).
 *
 * Posture (unchanged from REFLECT canon):
 *   - Tone calm, not alarmist. Member just submitted reflective free-text.
 *   - 3 FR resources, all 24/7, all free (3114 + SOS Amitié + Suicide Écoute).
 *   - NO AI anthropomorphisation ("Claude détecte" forbidden) — framed as
 *     "Si tu traverses un moment difficile", neutral, non-judgmental.
 *   - HIGH/MEDIUM share resources; HIGH gets the stronger `bad` ring, MEDIUM
 *     the `warn` ring (universal safety colours, NOT the cyan identity —
 *     severity must read the same everywhere). Only the neutral `tel:` CTA
 *     accent is cyan, for training-surface coherence.
 *
 * RGPD §16 / SPEC §16 — zero data leaked (no userId, no labels). Pure static
 * content based on `level`.
 */
export function TrainingDebriefCrisisBanner({ level }: TrainingDebriefCrisisBannerProps) {
  const isHigh = level === 'high';
  return (
    <div
      role="alert"
      aria-live="polite"
      data-slot="training-debrief-crisis-banner"
      data-level={level}
      className="rounded-card-lg relative overflow-hidden border p-5"
      style={{
        background: isHigh
          ? 'linear-gradient(135deg, oklch(0.21 0.06 22 / 0.55) 0%, oklch(0.12 0.02 240 / 0.92) 60%)'
          : 'linear-gradient(135deg, oklch(0.18 0.07 80 / 0.4) 0%, oklch(0.12 0.02 240 / 0.92) 70%)',
        borderColor: isHigh ? 'oklch(0.7 0.165 22 / 0.45)' : 'oklch(0.834 0.158 80 / 0.45)',
        boxShadow: isHigh
          ? '0 12px 32px -8px oklch(0.7 0.165 22 / 0.2), 0 0 0 1px oklch(0.7 0.165 22 / 0.18)'
          : '0 12px 32px -8px oklch(0.834 0.158 80 / 0.18), 0 0 0 1px oklch(0.834 0.158 80 / 0.16)',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="rounded-pill flex h-10 w-10 shrink-0 items-center justify-center"
          style={{
            background: isHigh ? 'oklch(0.7 0.165 22 / 0.18)' : 'oklch(0.834 0.158 80 / 0.18)',
            color: isHigh ? 'oklch(0.785 0.121 19)' : 'oklch(0.875 0.14 84)',
          }}
        >
          <AlertTriangle aria-hidden="true" size={20} strokeWidth={2.2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="t-eyebrow text-[var(--t-2)]">Ressources d&apos;écoute</p>
          <h2 className="t-h2 mt-1 text-[var(--t-1)]">
            Si tu traverses un moment difficile, tu n&apos;es pas seul·e.
          </h2>
          <p className="t-body mt-2 text-[var(--t-2)]">
            Ton débrief a été enregistré. Ces lignes d&apos;écoute sont gratuites, confidentielles
            et disponibles 24/7. Appeler quelqu&apos;un, c&apos;est aussi une discipline
            d&apos;exécution.
          </p>

          <ul className="mt-4 space-y-2.5">
            {CRISIS_RESOURCES_FR.map((r) => (
              <li key={r.phone} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <a
                  href={`tel:${r.phone}`}
                  className="rounded-pill inline-flex min-h-11 items-center gap-2 px-3.5 py-2 text-[13px] font-semibold transition-[background-color,box-shadow] duration-150 hover:bg-[oklch(0.789_0.139_217_/_0.32)]"
                  style={{
                    color: 'oklch(0.97 0.02 210)',
                    background: 'oklch(0.789 0.139 217 / 0.22)',
                    // WCAG 1.4.11 Non-text Contrast — 0.85 alpha border so the
                    // CTA boundary clears ≥ 3:1 on the banner gradient. The
                    // 3 FR tel: CTAs are the vital path (carbon REFLECT B4).
                    border: '1px solid oklch(0.789 0.139 217 / 0.85)',
                  }}
                  aria-label={`Appeler ${r.name}, ${r.description}, ${r.hours}`}
                >
                  <Phone aria-hidden="true" size={14} strokeWidth={2.2} />
                  <span className="font-mono tracking-wide">{r.name}</span>
                </a>
                <span className="t-body text-[var(--t-2)]">{r.description}</span>
                <span className="t-cap text-[var(--t-3)]">· {r.hours}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
