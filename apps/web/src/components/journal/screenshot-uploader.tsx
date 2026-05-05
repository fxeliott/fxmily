'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Spinner } from '@/components/spinner';
import { ALLOWED_IMAGE_MIME_TYPES, MAX_SCREENSHOT_BYTES } from '@/lib/storage/types';
import type { ScreenshotKind } from '@/lib/storage/types';

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
  // wizard step validation passes without a useless re-upload.
  useEffect(() => {
    if (initialKey && initialReadUrl && onUploaded) {
      onUploaded({ key: initialKey, readUrl: initialReadUrl });
    }
    // intentionally empty deps — this is a one-shot mount sync.
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
        className={[
          'focus-within:border-accent group flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
          isDragOver ? 'border-accent bg-accent/10' : 'hover:border-accent border-[var(--border)]',
          disabled ? 'cursor-not-allowed opacity-60' : '',
        ].join(' ')}
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
            <Spinner size={20} label="Envoi en cours" />
            <span className="text-muted text-sm">Envoi en cours…</span>
          </>
        ) : showPreview ? (
          <div className="flex w-full flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={state.readUrl ?? ''}
              alt={kind === 'trade-entry' ? 'Capture avant entrée' : 'Capture après sortie'}
              loading="lazy"
              className="aspect-[16/9] max-h-44 w-auto rounded-md border border-[var(--border)] object-contain"
            />
            <span className="text-muted text-xs">Cliquer pour remplacer.</span>
          </div>
        ) : (
          <>
            <span className="text-foreground text-sm font-medium">
              Glisse une image ici ou clique pour choisir
            </span>
            <span id={hintId} className="text-muted text-xs">
              JPG, PNG ou WebP — 8 Mo max
            </span>
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
          className="text-muted hover:text-foreground focus-visible:outline-accent inline-flex min-h-11 items-center self-start rounded-md px-1 py-2 text-xs underline underline-offset-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Retirer la capture
        </button>
      ) : null}

      {message ? (
        <p id={errorId} role="alert" className="text-danger text-xs">
          {message}
        </p>
      ) : null}
    </div>
  );
}
