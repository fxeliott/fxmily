/**
 * Compact AMF disclaimer — surfacé dans le hero (au-dessus des chiffres).
 * Patch a11y T3.2 audit : disclaimer doit être "en bonne place" pas footer.
 *
 * Pattern : Pill avec lien d'ancre vers le disclaimer complet (#legal).
 */
export function CompactDisclaimer() {
  return (
    <a
      href="#legal"
      className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[11px] leading-none font-medium tracking-[0.02em] transition-colors hover:border-[color-mix(in_oklab,var(--tr-warn),transparent_40%)]"
      style={{
        background: 'var(--tr-warn-bg)',
        borderColor: 'rgba(242, 116, 0, 0.32)',
        color: 'var(--tr-warn)',
      }}
    >
      <span aria-hidden>⚠</span>
      <span>Performances passées ne préjugent pas des performances futures</span>
    </a>
  );
}
