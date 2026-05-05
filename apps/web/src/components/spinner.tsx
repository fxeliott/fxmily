/**
 * Tiny inline-SVG spinner used inside pending submit buttons.
 *
 * Uses Tailwind's `animate-spin` (a 1s linear infinite rotation). Honors
 * `prefers-reduced-motion: reduce` via the global override in globals.css
 * (animations are clamped to 0.01ms there, so the spinner appears static
 * for users who disabled motion — acceptable degradation).
 */

interface SpinnerProps {
  /** Size in CSS pixels. Defaults to 16 (matches text-sm leading). */
  size?: number;
  /** ARIA label; pass `null` to mark as decorative (default). */
  label?: string | null;
  className?: string;
}

export function Spinner({ size = 16, label = null, className }: SpinnerProps) {
  const ariaProps = label
    ? { role: 'status' as const, 'aria-label': label }
    : { 'aria-hidden': true };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`animate-spin ${className ?? ''}`}
      {...ariaProps}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
