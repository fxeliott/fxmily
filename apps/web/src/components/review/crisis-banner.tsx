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
  // Severity reads the same everywhere — universal safety colours via tokens
  // that flip in light/dark (carbone `OnboardingCrisisBanner`). `--bad` for
  // HIGH, `--warn` for MEDIUM ; NEVER the v18 accent (severity ≠ identity).
  const toneVar = isHigh ? '--bad' : '--warn';
  return (
    <div
      role="alert"
      aria-live="polite"
      data-slot="v18-crisis-banner"
      data-level={level}
      className="rounded-card-lg relative overflow-hidden border p-5"
      style={{
        background: 'var(--bg-2)',
        borderColor: `var(${toneVar})`,
        boxShadow: `0 12px 32px -8px var(${toneVar}-dim-2, var(--bg-3)), 0 0 0 1px var(${toneVar}-dim, var(--b-default))`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="rounded-pill flex h-10 w-10 shrink-0 items-center justify-center border"
          style={{
            background: 'var(--bg-3)',
            borderColor: `var(${toneVar})`,
            color: `var(${toneVar})`,
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
                  className="rounded-pill inline-flex min-h-11 items-center gap-2 bg-[var(--acc-btn)] px-3.5 py-2 text-[13px] font-semibold text-[var(--acc-fg)] shadow-[var(--sh-btn-pri)] transition-[background-color,box-shadow] duration-150 hover:bg-[var(--acc-btn-hover)] focus-visible:ring-2 focus-visible:ring-[var(--acc)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] focus-visible:outline-none"
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
