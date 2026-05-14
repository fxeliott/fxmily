/**
 * V1.8 REFLECT — Aurora background layer.
 *
 * Two responsibilities:
 *   1. Radial-gradient backplate (handled by `.v18-aurora` CSS class — blue +
 *      cyan + violet halo on slate-950 base, no JS).
 *   2. 3 SVG orb blurs drifting on a 22 s loop — pure CSS animation, no
 *      Framer Motion (saves bundle on landing pages). `prefers-reduced-motion`
 *      kills the animation via the global `*` rule in globals.css.
 *
 * All decorative — `aria-hidden="true"` + `pointer-events: none`. Doesn't
 * block content selection or focus traversal.
 *
 * Performance : orbs are absolute-positioned single-layer blurs on the GPU
 * compositor. No layout thrash, no repaints. Tested on iPhone SE 11 (60 fps).
 */
export function V18Aurora() {
  return (
    <>
      <div className="v18-aurora absolute inset-0 -z-10" aria-hidden="true" />
      <div className="absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div
          className="v18-orb"
          style={{
            top: '-12%',
            left: '-8%',
            width: '38vw',
            height: '38vw',
            maxWidth: '420px',
            maxHeight: '420px',
            background: 'radial-gradient(circle, oklch(0.62 0.19 254 / 0.55) 0%, transparent 70%)',
            animationDelay: '0s',
          }}
        />
        <div
          className="v18-orb"
          style={{
            bottom: '-10%',
            right: '-6%',
            width: '32vw',
            height: '32vw',
            maxWidth: '360px',
            maxHeight: '360px',
            background: 'radial-gradient(circle, oklch(0.5 0.21 262 / 0.45) 0%, transparent 70%)',
            animationDelay: '-7s',
          }}
        />
        <div
          className="v18-orb"
          style={{
            top: '40%',
            right: '12%',
            width: '20vw',
            height: '20vw',
            maxWidth: '220px',
            maxHeight: '220px',
            background: 'radial-gradient(circle, oklch(0.7 0.13 217 / 0.32) 0%, transparent 70%)',
            animationDelay: '-14s',
          }}
        />
      </div>
    </>
  );
}
