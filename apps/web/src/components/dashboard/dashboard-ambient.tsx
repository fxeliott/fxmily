/**
 * DashboardAmbient — DS-v3 (J3) ambient mesh layer for /dashboard.
 *
 * Pure decorative backplate painted ON TOP of the host `<main>` solid
 * background but BELOW the content (`-z-10`), so the glassmorphism 2.0
 * panels above blur this mesh + orbs through their frosted surface.
 *
 * Server component (zero JS). `aria-hidden` + `pointer-events:none` so
 * it never blocks selection or focus traversal. The orb drift is killed
 * by the global `prefers-reduced-motion` rule (globals.css). On mobile
 * only the first orb renders (`.ds-orb` 640px gate) for battery/fps.
 *
 * Orbs are positioned in the hero zone (top, rem-based) on purpose — the
 * dashboard is a long scroll, so anchoring the glow near the masthead
 * keeps the depth cue where the eye lands first, fading down the page.
 *
 * `tone` defaults to `'blue'` (the app-wide :root accent — dashboard, mindset,
 * etc. render byte-identically). `tone="cyan"` retints the mesh + orbs for the
 * §21.7 training-debrief "Mode entraînement" surface, keeping the live/backtest
 * line visually distinct (Mark Douglas discipline) without a separate component.
 */
export function DashboardAmbient({ tone = 'blue' }: { tone?: 'blue' | 'cyan' }) {
  const isCyan = tone === 'cyan';
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div className={`${isCyan ? 'ds-aurora-cy' : 'ds-aurora'} absolute inset-0`} />
      <div
        className="ds-orb"
        style={{
          top: '-3rem',
          left: '-4rem',
          width: '44vw',
          height: '44vw',
          maxWidth: '460px',
          maxHeight: '460px',
          background: isCyan
            ? 'radial-gradient(circle, oklch(0.789 0.139 217 / 0.42) 0%, transparent 70%)'
            : 'radial-gradient(circle, oklch(0.62 0.19 254 / 0.5) 0%, transparent 70%)',
          animationDelay: '0s',
        }}
      />
      <div
        className="ds-orb ds-orb-extra"
        style={{
          top: '6rem',
          right: '-5rem',
          width: '34vw',
          height: '34vw',
          maxWidth: '360px',
          maxHeight: '360px',
          background: isCyan
            ? 'radial-gradient(circle, oklch(0.703 0.145 218 / 0.34) 0%, transparent 70%)'
            : 'radial-gradient(circle, oklch(0.5 0.21 262 / 0.42) 0%, transparent 70%)',
          animationDelay: '-9s',
        }}
      />
    </div>
  );
}
