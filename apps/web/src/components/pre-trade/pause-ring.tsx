/**
 * PauseRing — DS-v3 decorative "breathing" glyph for `/pre-trade/new`.
 *
 * ADR-003 §"miroir, pas barrière" : the pre-trade circuit breaker is a
 * 30-second pause to LOOK, never a countdown or a gate. This glyph makes
 * that pause felt without coercion — 3 concentric `--acc` rings that
 * breathe slowly (a continuous oscillation, NO start/end, NO timer arc,
 * NO progress fill) around a calm central heart. Posture §2 + Mark Douglas
 * anti-Black-Hat: calm and descriptive, never anxiogène.
 *
 * Server component (zero JS). Purely decorative → `aria-hidden` +
 * `pointer-events:none`, never in the a11y tree, never focus-trappable.
 *
 * Compositor-only: every animated property is `transform` (scale) or
 * `opacity`. `transform-box: fill-box; transform-origin: center;` so each
 * SVG circle scales about ITS OWN centre (default SVG origin is the
 * viewport 0,0 corner). The rings share one symmetric keyframe
 * (0%/100% identical → seamless loop, ~6s ease) with staggered delays +
 * decreasing opacity for an organic ripple in depth — never a 1–2s pulse
 * (that reads as a "loading spinner / AI-slop", not a breath).
 *
 * reduced-motion: keyframes are DOUBLE-guarded (local `@media` here, on
 * top of the global filet in globals.css) → rings FREEZE in a calm resting
 * pose (scale 1, posed opacity), never a frozen mid-pulse.
 * forced-colors: the decorative blur glow is dropped (no broken halo in
 * Windows High Contrast).
 */
export function PauseRing({ className }: { className?: string }) {
  return (
    <div
      className={className}
      aria-hidden="true"
      style={{ pointerEvents: 'none' }}
      data-slot="pause-ring"
    >
      <style>{pauseRingCss}</style>
      <svg viewBox="0 0 96 96" width="100%" height="100%" role="presentation" focusable="false">
        {/* Soft outer bloom — opacity-only, sits behind the rings. */}
        <circle className="pr-glow" cx="48" cy="48" r="30" fill="var(--acc)" opacity="0.1" />

        {/* 3 concentric breathing rings — staggered, decreasing opacity. */}
        <circle
          className="pr-ring pr-ring-1"
          cx="48"
          cy="48"
          r="30"
          fill="none"
          stroke="var(--acc)"
          strokeWidth="1.25"
        />
        <circle
          className="pr-ring pr-ring-2"
          cx="48"
          cy="48"
          r="21"
          fill="none"
          stroke="var(--acc)"
          strokeWidth="1.5"
        />
        <circle
          className="pr-ring pr-ring-3"
          cx="48"
          cy="48"
          r="12"
          fill="none"
          stroke="var(--acc-hi)"
          strokeWidth="1.75"
        />

        {/* Calm central heart — a soft steady core, breathes very gently. */}
        <circle className="pr-core" cx="48" cy="48" r="4.5" fill="var(--acc)" />
        <circle className="pr-core-dot" cx="48" cy="48" r="1.75" fill="var(--acc-fg)" />
      </svg>
    </div>
  );
}

/**
 * Scoped CSS — kept local to the component (globals.css untouched). All
 * animated properties are compositor-only (transform / opacity). The
 * symmetric 0%/100% keyframe gives a seamless loop with no perceived
 * start or end.
 */
const pauseRingCss = `
[data-slot='pause-ring'] svg circle {
  transform-box: fill-box;
  transform-origin: center;
}
[data-slot='pause-ring'] .pr-ring {
  animation: prBreathe 6.5s var(--e-smooth) infinite;
}
[data-slot='pause-ring'] .pr-ring-1 { opacity: 0.9; animation-delay: 0s; }
[data-slot='pause-ring'] .pr-ring-2 { opacity: 0.6; animation-delay: 0.45s; }
[data-slot='pause-ring'] .pr-ring-3 { opacity: 0.4; animation-delay: 0.9s; }
[data-slot='pause-ring'] .pr-glow {
  animation: prGlow 6.5s var(--e-smooth) infinite;
}
[data-slot='pause-ring'] .pr-core {
  animation: prCore 6.5s var(--e-smooth) infinite;
}
@keyframes prBreathe {
  0%, 100% { transform: scale(0.86); }
  50% { transform: scale(1.12); }
}
@keyframes prGlow {
  0%, 100% { opacity: 0.06; transform: scale(0.9); }
  50% { opacity: 0.14; transform: scale(1.1); }
}
@keyframes prCore {
  0%, 100% { transform: scale(0.92); }
  50% { transform: scale(1.08); }
}
/* DOUBLE-GUARD reduced-motion - freeze at a calm resting pose, not mid-pulse. */
@media (prefers-reduced-motion: reduce) {
  [data-slot='pause-ring'] .pr-ring,
  [data-slot='pause-ring'] .pr-glow,
  [data-slot='pause-ring'] .pr-core {
    animation: none;
    transform: scale(1);
  }
  [data-slot='pause-ring'] .pr-ring-1 { opacity: 0.85; }
  [data-slot='pause-ring'] .pr-ring-2 { opacity: 0.55; }
  [data-slot='pause-ring'] .pr-ring-3 { opacity: 0.4; }
  [data-slot='pause-ring'] .pr-glow { opacity: 0.1; }
}
/* forced-colors - drop the decorative soft bloom (no broken halo). */
@media (forced-colors: active) {
  [data-slot='pause-ring'] .pr-glow { display: none; }
}
`;
