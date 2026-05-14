import { AlertTriangle, Phone } from 'lucide-react';

import { CRISIS_RESOURCES_FR } from '@/lib/safety/crisis-detection';

interface V18CrisisBannerProps {
  /** Crisis severity surfaced via URL query (`?crisis=high|medium`). */
  level: 'high' | 'medium';
}

/**
 * V1.8 REFLECT — non-blocking crisis routing banner.
 *
 * Surfaced when the Server Action's `detectCrisis(corpus)` returned
 * HIGH or MEDIUM and persisted the row (Q4=A decision — never silent
 * skip on member input). The redirect carries the level via
 * `?crisis=high|medium` ; the landing page reads the URL state and
 * mounts this banner above the recent-reviews timeline.
 *
 * Posture (researcher 2026, FR mental-health resources) :
 *   - Tone calm, not alarmist. The member has just submitted free-text.
 *   - List 3 FR resources, all 24/7, all free (3114 + SOS Amitié +
 *     Suicide Écoute).
 *   - `tel:` links use formal digit-only format (iOS Safari + Android).
 *   - NO anthropomorphisation of the AI. NO "Claude détecte". Frame as
 *     "Si tu traverses un moment difficile" — neutral, non-judgmental.
 *   - HIGH and MEDIUM share the same resources but HIGH gets stronger
 *     copy and a tone ring (warn for medium, bad for high).
 *
 * RGPD §16 / SPEC §16 — zero data leaked (no userId, no labels). Pure
 * static content based on `level` prop.
 */
export function V18CrisisBanner({ level }: V18CrisisBannerProps) {
  const isHigh = level === 'high';
  return (
    <div
      role="alert"
      aria-live="polite"
      data-slot="v18-crisis-banner"
      data-level={level}
      className="rounded-card-lg relative overflow-hidden border p-5"
      style={{
        background: isHigh
          ? 'linear-gradient(135deg, oklch(0.21 0.06 22 / 0.55) 0%, oklch(0.13 0.028 254 / 0.92) 60%)'
          : 'linear-gradient(135deg, oklch(0.18 0.07 80 / 0.4) 0%, oklch(0.13 0.028 254 / 0.92) 70%)',
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
            Ta revue a été enregistrée. Ces lignes d&apos;écoute sont gratuites, confidentielles et
            disponibles 24/7. Appeler quelqu&apos;un, c&apos;est aussi une discipline
            d&apos;exécution.
          </p>

          <ul className="mt-4 space-y-2.5">
            {CRISIS_RESOURCES_FR.map((r) => (
              <li key={r.phone} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <a
                  href={`tel:${r.phone}`}
                  className="rounded-pill inline-flex min-h-11 items-center gap-2 px-3.5 py-2 text-[13px] font-semibold transition-[background-color,box-shadow] duration-150"
                  style={{
                    color: 'oklch(0.95 0.01 247)',
                    background: 'oklch(0.62 0.19 254 / 0.18)',
                    border: '1px solid oklch(0.62 0.19 254 / 0.42)',
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
