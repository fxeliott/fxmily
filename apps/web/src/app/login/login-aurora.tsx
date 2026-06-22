/**
 * LoginAurora — S9.1 "wave wow" premium backplate for the login surface.
 *
 * Server component (zero JS). Pure-decorative aurora mesh + two drifting
 * blue/indigo orbs painted BELOW the form (`-z-10` via the host stacking).
 * `aria-hidden` + `pointer-events:none` so it never blocks focus/selection.
 *
 * Compositor-only: the orbs animate ONLY transform + opacity (`.login-orb-a` /
 * `.login-orb-b` keyframes in globals.css). The drift is neutralised by the
 * global `prefers-reduced-motion` filet AND the explicit guard on `.login-orb-*`.
 * Decorative orbs are dropped under `forced-colors: active` (globals.css block).
 * On mobile only the primary orb renders (`.login-orb-extra` 640px gate) for
 * battery/fps — the visual identity survives while the GPU cost halves.
 */
export function LoginAurora() {
  return (
    <div
      aria-hidden="true"
      className="ds-aurora pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {/* Primary orb — top-right, brand blue. Anchors the glow where the eye
          first lands (the title sits just under it). Sits BEHIND the form, so a
          generous alpha reads as premium depth without ever touching contrast. */}
      <div
        className="login-orb login-orb-a"
        style={{
          top: '-14rem',
          right: '-9rem',
          width: '62vw',
          height: '62vw',
          maxWidth: '560px',
          maxHeight: '560px',
          background: 'radial-gradient(circle, oklch(0.62 0.19 254 / 0.85) 0%, transparent 70%)',
        }}
      />
      {/* Secondary orb — bottom-left, deep indigo. Desktop-only (perf gate). */}
      <div
        className="login-orb login-orb-b login-orb-extra"
        style={{
          bottom: '-15rem',
          left: '-11rem',
          width: '54vw',
          height: '54vw',
          maxWidth: '500px',
          maxHeight: '500px',
          background: 'radial-gradient(circle, oklch(0.5 0.21 262 / 0.7) 0%, transparent 70%)',
        }}
      />
      {/* Tertiary cyan whisper — far edge, faint depth cue. Desktop-only. */}
      <div
        className="login-orb login-orb-a login-orb-extra"
        style={{
          top: '14%',
          left: '-7rem',
          width: '36vw',
          height: '36vw',
          maxWidth: '360px',
          maxHeight: '360px',
          background: 'radial-gradient(circle, oklch(0.7 0.13 217 / 0.4) 0%, transparent 70%)',
          animationDelay: '-12s',
        }}
      />
      {/* S18 — centred soft brand wash behind the card. `surf-grad-soft` is a
          token-driven cool gradient (alpha ≤0.14, flips in light); the radial
          mask keeps it a faint halo around the form so the card stays in vedette
          and contrast is never touched. Static (no animation) = zero added GPU. */}
      <div className="surf-grad-soft absolute top-1/2 left-1/2 h-[70vmin] max-h-[640px] w-[70vmin] max-w-[640px] -translate-x-1/2 -translate-y-1/2 [mask-image:radial-gradient(circle,black,transparent_70%)] opacity-60" />
    </div>
  );
}
