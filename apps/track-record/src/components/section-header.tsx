import type { ReactNode } from 'react';

interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
}

export function SectionHeader({ eyebrow, title, description }: SectionHeaderProps) {
  return (
    <header className="mb-6">
      {eyebrow && (
        <div className="mb-2 text-[11px] font-medium tracking-[0.08em] text-[var(--tr-t-3)] uppercase">
          {eyebrow}
        </div>
      )}
      <h2
        className="text-2xl leading-tight font-semibold tracking-[-0.01em] text-[var(--tr-t-1)] sm:text-[1.75rem]"
        style={{ fontFamily: 'var(--tr-font-display)' }}
      >
        {title}
      </h2>
      {description && (
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--tr-t-2)] sm:text-[15px]">
          {description}
        </p>
      )}
    </header>
  );
}
