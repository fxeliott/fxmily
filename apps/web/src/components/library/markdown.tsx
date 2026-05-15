import 'server-only';

import { ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

/**
 * Sanitized markdown renderer for Mark Douglas card paraphrases (J7 + J7.6).
 *
 * Hardening (2026 OWASP / HackerOne best-practice):
 *   - `skipHtml` — drops any raw HTML tag the source may contain.
 *   - `rehype-sanitize` with hardened schema — strips ALL `on*` attributes.
 *   - `urlTransform` — only `http(s)://`, `mailto:` and same-origin links pass.
 *   - `target="_blank"` + `rel="noopener noreferrer"` on every external link.
 *
 * J7.6 polish + a11y :
 *   - `headingOffset` prop : shifts h1/h2/h3 down so this markdown can be
 *     rendered under an existing h2 (e.g. exercises section) without
 *     breaking the document heading hierarchy (a11y H8 fix).
 *   - `dropCap` prop : applies a magazine-style drop-cap to the first
 *     letter of the first paragraph (premium typography). Off by default —
 *     enable on the reader hero only.
 *
 * Used Server-side (RSC). The bundle cost (~30 KB gzip) does NOT ship to the
 * client because we render the parsed HTML in the server component.
 */

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': (defaultSchema.attributes?.['*'] ?? []).filter(
      (attr) => typeof attr === 'string' && !attr.toLowerCase().startsWith('on'),
    ),
    a: [...(defaultSchema.attributes?.a ?? []), 'rel', 'target'],
  },
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (t) =>
      t !== 'script' &&
      t !== 'style' &&
      t !== 'iframe' &&
      t !== 'object' &&
      t !== 'embed' &&
      t !== 'svg' &&
      t !== 'math',
  ),
};

const SAFE_URL_RE = /^(https?:|mailto:|\/)/i;

function safeUrl(url: string | undefined): string {
  if (!url) return '';
  return SAFE_URL_RE.test(url) ? url : '#blocked';
}

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
type HeadingTag = (typeof HEADING_TAGS)[number];
function shiftHeading(tag: HeadingTag, offset: number): HeadingTag {
  const idx = Math.min(HEADING_TAGS.length - 1, HEADING_TAGS.indexOf(tag) + offset);
  return HEADING_TAGS[Math.max(0, idx)] ?? 'h6';
}

interface SafeMarkdownProps {
  source: string;
  /** Tailwind className passed to the wrapper div. */
  className?: string;
  /**
   * Heading level offset (a11y H8 fix). When the markdown is rendered INSIDE
   * a section that already carries h2/h3, pass `headingOffset=2` so source
   * `#` becomes `<h3>` instead of `<h2>`. Default 0 (h1→h2 baseline shift).
   */
  headingOffset?: 0 | 1 | 2 | 3;
  /**
   * J7.6 polish — apply a magazine-style drop-cap on the very first letter
   * of the first paragraph. Use sparingly (one occurrence per page).
   */
  dropCap?: boolean;
}

/**
 * Render trusted-but-still-sanitized markdown. The source is admin-provided
 * (cards seeded by Eliot or written through `/admin/cards`), but we apply
 * defense-in-depth: a leaked admin password shouldn't translate to client XSS.
 */
export function SafeMarkdown({
  source,
  className,
  headingOffset = 0,
  dropCap = false,
}: SafeMarkdownProps) {
  // a11y H8 — shift h1/h2/h3 according to headingOffset. Default 0 means
  // h1 → h2 (page H1 is rendered separately by the parent).
  const baseOffset = 1 + headingOffset;
  const H1 = shiftHeading('h1', baseOffset);
  const H2 = shiftHeading('h2', baseOffset);
  const H3 = shiftHeading('h3', baseOffset);

  // Drop-cap classes on the FIRST `<p>` of the rendered markdown only
  // (`first:` Tailwind variant). Avoids any client-side state.
  const dropCapPClass = dropCap
    ? 'first:first-letter:f-display first:first-letter:float-left first:first-letter:mr-2 first:first-letter:text-[48px] first:first-letter:leading-[0.85] first:first-letter:text-[var(--acc)] first:first-letter:font-bold'
    : '';

  return (
    <div className={className} data-slot="md">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        urlTransform={safeUrl}
        components={{
          a: ({ href, children, ...props }) => (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-acc focus-visible:outline-acc inline-flex items-baseline gap-0.5 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {children}
              <ExternalLink aria-hidden className="h-3 w-3 self-center" strokeWidth={1.75} />
              <span className="sr-only"> (ouvre dans un nouvel onglet)</span>
            </a>
          ),
          h1: ({ children }) => {
            const Tag = H1;
            return <Tag className="mt-6 mb-3 text-lg font-semibold tracking-tight">{children}</Tag>;
          },
          h2: ({ children }) => {
            const Tag = H2;
            return <Tag className="mt-5 mb-2 text-base font-semibold">{children}</Tag>;
          },
          h3: ({ children }) => {
            const Tag = H3;
            return (
              <Tag className="text-muted mt-4 mb-2 text-sm font-semibold tracking-wide uppercase">
                {children}
              </Tag>
            );
          },
          p: ({ children }) => (
            <p className={cn('text-foreground my-3 leading-relaxed', dropCapPClass)}>{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="marker:text-acc my-3 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="marker:text-acc my-3 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => (
            <strong className="text-foreground font-semibold">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children }) => (
            <code className="bg-muted/30 rounded px-1 py-0.5 font-mono text-[12px]">
              {children}
            </code>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-acc/40 text-muted my-3 border-l-2 pl-3 italic">
              {children}
            </blockquote>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
