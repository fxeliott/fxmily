import 'server-only';

import { ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

/**
 * Sanitized markdown renderer for Mark Douglas card paraphrases (J7).
 *
 * Hardening (2026 OWASP / HackerOne best-practice):
 *   - `skipHtml` — drops any raw HTML tag the source may contain.
 *   - `rehype-sanitize` with hardened schema — strips ALL `on*` attributes
 *     even on the tags we allow.
 *   - `urlTransform` — only `http(s)://`, `mailto:` and same-origin links pass.
 *     `javascript:`, `data:`, `vbscript:` etc. are replaced with `#blocked`.
 *   - `target="_blank"` + `rel="noopener noreferrer"` on every external link.
 *
 * Used Server-side (RSC). The bundle cost (~30 KB gzip) does NOT ship to the
 * client because we render the parsed HTML in the server component.
 *
 * Reference research (web search 2026-05-07):
 *   - Strapi React Markdown Complete Guide
 *   - HackerOne "Secure Markdown Rendering in React"
 *   - react-markdown maintainers — `skipHtml` is the strictest mode
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
  // Belt-and-braces: explicitly disallow dangerous tags even though `skipHtml`
  // already removes them.
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

interface SafeMarkdownProps {
  source: string;
  /** Tailwind className passed to the wrapper div. */
  className?: string;
}

/**
 * Render trusted-but-still-sanitized markdown. The source is admin-provided
 * (cards seeded by Eliot or written through `/admin/cards`), but we apply
 * defense-in-depth: a leaked admin password shouldn't translate to client XSS.
 */
export function SafeMarkdown({ source, className }: SafeMarkdownProps) {
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
          h1: ({ children }) => (
            <h2 className="mb-3 mt-6 text-lg font-semibold tracking-tight">{children}</h2>
          ),
          h2: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold">{children}</h3>,
          h3: ({ children }) => (
            <h4 className="text-muted mb-2 mt-4 text-sm font-semibold uppercase tracking-wide">
              {children}
            </h4>
          ),
          p: ({ children }) => <p className="text-foreground my-3 leading-relaxed">{children}</p>,
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
