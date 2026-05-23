/**
 * Ambient background — radial gradient bleu très diffus + grid dotted subtle.
 *
 * Fixe en position absolute derrière le content, pointer-events-none,
 * z-index négatif pour ne pas interférer avec interaction. Subtle, jamais
 * tape-à-l'œil.
 *
 * Layers :
 *  - Radial gradient bleu accent au centre haut (signature lumineuse premium)
 *  - Grid dotted ultra-subtil (espacement 28px, opacity 0.04)
 */
export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* Radial glow bleu signature lumineuse — center top hero area */}
      <div
        className="absolute inset-x-0 top-[-30vh] h-[80vh]"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 40%, rgba(91, 141, 239, 0.10) 0%, rgba(91, 141, 239, 0.04) 35%, transparent 70%)',
        }}
      />
      {/* Grid dotted subtle — full viewport */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(91, 141, 239, 0.045) 1px, transparent 0)',
          backgroundSize: '28px 28px',
        }}
      />
      {/* Bottom fade — keeps focus on top */}
      <div
        className="absolute inset-x-0 bottom-0 h-[40vh]"
        style={{
          background: 'linear-gradient(to bottom, transparent 0%, var(--bg) 80%)',
        }}
      />
    </div>
  );
}
