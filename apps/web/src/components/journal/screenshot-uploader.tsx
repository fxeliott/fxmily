'use client';

import { Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Spinner } from '@/components/spinner';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_SCREENSHOT_BYTES } from '@/lib/storage/types';
import type { ScreenshotKind } from '@/lib/storage/types';
import { cn } from '@/lib/utils';

interface ScreenshotUploaderProps {
  /** Storage kind — drives audit metadata and future routing. */
  kind: ScreenshotKind;
  /** Form field name — the resolved key is mirrored into a hidden input. */
  name: string;
  /** Pre-existing key (e.g. when editing a trade). */
  initialKey?: string | null | undefined;
  /** Initial display URL (e.g. `getReadUrl(initialKey)`). */
  initialReadUrl?: string | null | undefined;
  /** Disabled state during a parent submission. */
  disabled?: boolean | undefined;
  /** Server-validation error from the parent form. */
  error?: string | undefined;
  /** Notify parent of state changes — useful for wizard step validation. */
  onUploaded?: ((args: { key: string; readUrl: string }) => void) | undefined;
  onCleared?: (() => void) | undefined;
}

interface UploadState {
  key: string | null;
  readUrl: string | null;
  /** 'idle' | 'uploading' | 'success' | 'error' */
  status: 'idle' | 'uploading' | 'success' | 'error';
  /** Inline error message — translated into FR. */
  message: string | null;
}

function nullable<T>(v: T | null | undefined): T | null {
  return v ?? null;
}

const ERROR_LABELS = {
  unauthorized: 'Session expirée, reconnecte-toi.',
  invalid_form: 'Formulaire invalide.',
  invalid_kind: 'Type de capture invalide.',
  missing_file: 'Aucun fichier sélectionné.',
  empty_file: 'Le fichier est vide.',
  too_large: 'Image trop lourde (8 Mo max).',
  invalid_mime: 'Format non supporté. Utilise JPG, PNG ou WebP.',
  invalid_bytes: 'Le fichier ne ressemble pas à une vraie image.',
  storage_failed: "Échec de l'enregistrement, réessaie.",
} as const satisfies Record<string, string>;

type ErrorCode = keyof typeof ERROR_LABELS;

function errorLabel(code: string | undefined): string {
  if (code && code in ERROR_LABELS) return ERROR_LABELS[code as ErrorCode];
  return 'Échec de l’envoi.';
}

const ACCEPT = ALLOWED_IMAGE_MIME_TYPES.join(',');

/**
 * Drag-and-drop screenshot uploader (J2, SPEC §7.3).
 *
 * - Accepts JPG / PNG / WebP up to 8 MiB.
 * - Validates client-side before fetching `/api/uploads` (size + MIME hint;
 *   the server re-validates with magic-byte sniffing).
 * - Renders a thumbnail preview after success.
 * - Mirrors the resolved key into a hidden `<input>` so the parent form
 *   can submit it directly.
 *
 * The component is framework-agnostic (no RHF dependency); the parent wires
 * `onUploaded` / `onCleared` for wizard-step validation.
 */
export function ScreenshotUploader({
  kind,
  name,
  initialKey,
  initialReadUrl,
  disabled,
  error,
  onUploaded,
  onCleared,
}: ScreenshotUploaderProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({
    key: nullable(initialKey),
    readUrl: nullable(initialReadUrl),
    status: initialKey ? 'success' : 'idle',
    message: null,
  });
  const [isDragOver, setIsDragOver] = useState(false);

  // Notify parent on first mount if we already had an initialKey, so the
  // wizard step validation passes without a useless re-upload. The
  // `notifiedRef` guard ensures we don't fire twice in StrictMode dev nor
  // re-fire if the parent re-renders us with a new (unmemoised) callback.
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (notifiedRef.current) return;
    if (initialKey && initialReadUrl && onUploaded) {
      notifiedRef.current = true;
      onUploaded({ key: initialKey, readUrl: initialReadUrl });
    }
    // intentionally empty deps — one-shot mount sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upload = useCallback(
    async (file: File) => {
      if (disabled) return;

      // Client-side guards — server re-validates regardless.
      if (file.size === 0) {
        setState({
          key: null,
          readUrl: null,
          status: 'error',
          message: errorLabel('empty_file'),
        });
        return;
      }
      if (file.size > MAX_SCREENSHOT_BYTES) {
        setState({
          key: null,
          readUrl: null,
          status: 'error',
          message: errorLabel('too_large'),
        });
        return;
      }
      if (!(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
        setState({
          key: null,
          readUrl: null,
          status: 'error',
          message: errorLabel('invalid_mime'),
        });
        return;
      }

      setState((s) => ({ ...s, status: 'uploading', message: null }));

      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);

      try {
        const res = await fetch('/api/uploads', { method: 'POST', body: fd });
        const payload = (await res.json().catch(() => ({}))) as {
          key?: string;
          readUrl?: string;
          error?: string;
        };
        if (!res.ok || !payload.key || !payload.readUrl) {
          setState({
            key: null,
            readUrl: null,
            status: 'error',
            message: errorLabel(payload.error),
          });
          return;
        }
        setState({
          key: payload.key,
          readUrl: payload.readUrl,
          status: 'success',
          message: null,
        });
        onUploaded?.({ key: payload.key, readUrl: payload.readUrl });
      } catch (err) {
        console.error('[ScreenshotUploader] fetch failed', err);
        setState({
          key: null,
          readUrl: null,
          status: 'error',
          message: 'Erreur réseau. Réessaie.',
        });
      }
    },
    [disabled, kind, onUploaded],
  );

  const clear = () => {
    setState({ key: null, readUrl: null, status: 'idle', message: null });
    if (inputRef.current) inputRef.current.value = '';
    onCleared?.();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void upload(file);
  };

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void upload(file);
  };

  const showPreview = state.status === 'success' && state.readUrl;
  const message = state.message ?? error ?? null;

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-card group flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 border border-dashed px-4 py-6 text-center transition-all',
          'focus-within:border-[var(--acc)] focus-within:bg-[var(--acc-dim-2)] focus-within:shadow-[0_0_0_4px_oklch(0.879_0.231_130_/_0.18)]',
          isDragOver
            ? 'border-[var(--acc)] bg-[var(--acc-dim)] shadow-[0_0_24px_-4px_oklch(0.879_0.231_130_/_0.45)]'
            : 'border-[var(--b-strong)] bg-[var(--bg-1)] hover:border-[var(--b-acc)] hover:bg-[var(--bg-2)]',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={onFileChange}
          disabled={disabled || state.status === 'uploading'}
          aria-invalid={message ? 'true' : undefined}
          aria-describedby={[hintId, message ? errorId : null].filter(Boolean).join(' ')}
        />

        {state.status === 'uploading' ? (
          <>
            <div className="grid h-12 w-12 place-items-center rounded-full border border-[var(--b-acc)] bg-[var(--acc-dim)] text-[var(--acc)]">
              <Spinner size={20} label="Envoi en cours" />
            </div>
            <span className="t-body text-[var(--t-2)]">Envoi en cours…</span>
            <span className="t-cap text-[var(--t-4)]">
              Validation magic-byte serveur après upload
            </span>
          </>
        ) : showPreview ? (
          <div className="flex w-full flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={state.readUrl ?? ''}
              alt={kind === 'trade-entry' ? 'Capture avant entrée' : 'Capture après sortie'}
              loading="lazy"
              className="rounded-card aspect-[16/9] max-h-44 w-auto border border-[var(--b-default)] object-contain shadow-[var(--sh-card)]"
            />
            <span className="t-cap inline-flex items-center gap-1 text-[var(--t-4)]">
              <ImageIcon className="h-3 w-3" strokeWidth={1.75} />
              Cliquer pour remplacer
            </span>
          </div>
        ) : (
          <>
            <div
              className={cn(
                'grid h-12 w-12 place-items-center rounded-full border transition-all',
                isDragOver
                  ? 'border-[var(--b-acc-strong)] bg-[var(--acc-dim)] text-[var(--acc)]'
                  : 'border-[var(--b-default)] bg-[var(--bg-2)] text-[var(--t-3)]',
              )}
            >
              <Upload className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="flex flex-col items-center gap-1">
              <span className="t-h3 text-[var(--t-1)]">
                {isDragOver ? 'Lâche pour envoyer' : 'Glisse ou clique pour choisir'}
              </span>
              <span id={hintId} className="t-cap text-[var(--t-4)]">
                JPG · PNG · WebP — 8 Mo max
              </span>
            </div>
          </>
        )}
      </label>

      {/* Hidden input mirroring the storage key — the parent form posts this. */}
      <input type="hidden" name={name} value={state.key ?? ''} />

      {showPreview ? (
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          className="rounded-control inline-flex h-9 items-center gap-1.5 self-start border border-transparent px-2 text-[11px] text-[var(--t-3)] transition-colors hover:border-[oklch(0.7_0.165_22_/_0.35)] hover:bg-[var(--bad-dim)] hover:text-[var(--bad)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          Retirer la capture
        </button>
      ) : null}

      {message ? (
        <p
          id={errorId}
          role="alert"
          className="inline-flex items-center gap-1.5 text-[11px] text-[var(--bad)]"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
