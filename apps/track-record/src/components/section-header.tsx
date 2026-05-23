import type { ReactNode } from 'react';

interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
}

/**
 * Section header T2 — eyebrow (caption) + H1 + description.
 * Aligné gauche, espacement généreux. Pas de séparateur visuel sous.
 */
export function SectionHeader({ eyebrow, title, description }: SectionHeaderProps) {
  return (
    <header className="mb-8">
      {eyebrow && <div className="t-caption mb-3">{eyebrow}</div>}
      <h2 className="t-h1 text-[var(--text)]">{title}</h2>
      {description && (
        <p className="t-body mt-3 max-w-2xl text-[var(--text-muted)]">{description}</p>
      )}
    </header>
  );
}
