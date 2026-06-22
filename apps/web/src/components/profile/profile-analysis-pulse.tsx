/**
 * ProfileAnalysisPulse — DS-v3 signature illustration for the `/profile`
 * "Analyse en cours" state.
 *
 * Server component (zero JS). A calm set of concentric breathing rings around a
 * luminous brand core, evoking "réflexion en cours" without ANY timer, progress
 * bar, or countdown (Mark Douglas / anti-Black-Hat §2 — descriptif, jamais
 * anxiogène). It is the visual antidote to the previous flat static icon.
 *
 * Performance / a11y discipline (frontend-elite):
 *   - COMPOSITOR-ONLY: only `transform` (scale) + `opacity` are animated. The
 *     ring radii / stroke / fill never change → no SVG repaint.
 *   - `transform-box: fill-box; transform-origin: center` so each ring scales
 *     from its own centre, not the viewport corner (SVG default `0 0`).
 *   - Breathing is slow + symmetric (8s, 0%/100% identical) → seamless loop with
 *     no perceived start/end, calibrated on real breath cadence, not a 1–2s
 *     "loading" throb.
 *   - Staggered delays (0.5s) + decreasing opacity → an organic ripple in depth.
 *   - `prefers-reduced-motion`: double-guarded — the global filet neutralises the
 *     loop, and the local rule pins the rings to a calm resting state (scale 1,
 *     posed, no residual frame leak).
 *   - `forced-colors`: the decorative blur/glow disappears cleanly in High
 *     Contrast (no broken box-shadow artefact).
 *   - `aria-hidden` + `pointer-events:none` — purely decorative, never focusable.
 */
export function ProfileAnalysisPulse() {
  return (
    <div
      aria-hidden="true"
      className="profile-pulse pointer-events-none relative grid h-12 w-12 shrink-0 place-items-center"
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <radialGradient id="profilePulseCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--acc-hi)" stopOpacity={0.9} />
            <stop offset="55%" stopColor="var(--acc)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="var(--acc)" stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* Concentric breathing rings — same keyframe, staggered + fading. */}
        <circle className="profile-pulse-ring" cx="50" cy="50" r="44" />
        <circle className="profile-pulse-ring" cx="50" cy="50" r="33" />
        <circle className="profile-pulse-ring" cx="50" cy="50" r="22" />

        {/* Soft brand core that breathes in counter-phase. */}
        <circle
          className="profile-pulse-core"
          cx="50"
          cy="50"
          r="15"
          fill="url(#profilePulseCore)"
        />
      </svg>

      {/* Crisp central dot (DS accent) — posed, never animated. */}
      <span className="relative h-2 w-2 rounded-full bg-[var(--acc-hi)]" />

      <style>{`
        .profile-pulse-ring {
          fill: none;
          stroke: var(--acc);
          stroke-width: 1.6;
          transform-box: fill-box;
          transform-origin: center;
          animation: profilePulseBreathe 8s var(--e-smooth) infinite;
        }
        .profile-pulse-ring:nth-of-type(1) { opacity: 0.32; animation-delay: 0s; }
        .profile-pulse-ring:nth-of-type(2) { opacity: 0.55; animation-delay: 0.5s; }
        .profile-pulse-ring:nth-of-type(3) { opacity: 0.8; animation-delay: 1s; }
        .profile-pulse-core {
          transform-box: fill-box;
          transform-origin: center;
          animation: profilePulseCore 8s var(--e-smooth) infinite;
        }
        @keyframes profilePulseBreathe {
          0%, 100% { transform: scale(0.86); }
          50% { transform: scale(1.12); }
        }
        @keyframes profilePulseCore {
          0%, 100% { transform: scale(0.92); opacity: 0.7; }
          50% { transform: scale(1.06); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .profile-pulse-ring,
          .profile-pulse-core {
            animation: none;
            transform: scale(1);
          }
          .profile-pulse-ring { opacity: 0.5; }
          .profile-pulse-core { opacity: 0.85; }
        }
        @media (forced-colors: active) {
          .profile-pulse-core { display: none; }
        }
      `}</style>
    </div>
  );
}
