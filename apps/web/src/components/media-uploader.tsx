'use client';

import { Image as ImageIcon, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Spinner } from '@/components/spinner';
import type { UploadKind } from '@/lib/storage/types';
import { cn } from '@/lib/utils';

/**
 * Generic drag-and-drop media uploader (J4).
 *
 * Forked from `<ScreenshotUploader />` (J2) so the trade wizard's UX stays
 * frozen while the admin annotation flow gets a parameterised component.
 *
 * - `kind` drives the storage prefix server-side (trade-* or annotation-*).
 * - For annotation-* kinds, `tradeId` is mirrored into the FormData so the
 *   POST handler can scope the storage path under `annotations/{tradeId}/...`.
 * - `acceptMime` + `maxBytes` are caller-controlled — V1 J4 ships image-only
 *   (8 MiB), but the component is ready for video kinds (J4.5).
 *
 * Server-side validation is the only authority. Client checks here are pure
 * UX (early reject before the POST round-trip).
 */

interface MediaUploaderProps {
  /** Storage kind sent to /api/uploads. Drives audit + key prefix. */
  kind: UploadKind;
  /** Required when `kind` is annotation-*. Identifies the parent trade. */
  tradeId?: string | null | undefined;
  /**
   * J-T3 — required when `kind` is `training-annotation-image`. Identifies
   * the parent backtest; posted as the `trainingTradeId` field (NOT
   * `tradeId`) so the route scopes the key under
   * `training_annotations/{trainingTradeId}/…`. Kept a SEPARATE field from
   * `tradeId` so a training value never travels a real-edge field name
   * (statistical isolation §21.5). J4 call sites pass only `tradeId` and are
   * unaffected.
   */
  trainingTradeId?: string | null | undefined;
  /** Form field name — the resolved key is mirrored into a hidden input. */
  name: string;
  /** Accepted MIME types — also used for the file input `accept` attribute. */
  acceptMime: readonly string[];
  /** Hard cap on file size in bytes. */
  maxBytes: number;
  /** Mirrored into a sibling hidden input — handy when the parent form needs
   * the resolved media type alongside the key (e.g. annotation form). */
  mediaTypeName?: string;
  /** Static value to populate `mediaTypeName`. Must match `kind` semantics. */
  mediaTypeValue?: 'image' | 'video';
  /** Pre-existing key (e.g. when editing). */
  initialKey?: string | null | undefined;
  initialReadUrl?: string | null | undefined;
  /** Disabled state during a parent submission. */
  disabled?: boolean | undefined;
  /** Server-validation error from the parent form. */
  error?: string | undefined;
  /** Headline shown in the empty/idle state. */
  idleLabel?: string;
  /** Hint shown under the headline. Defaults to "MIME · Mo max". */
  hint?: string;
  /** Alt text for the success thumbnail. */
  previewAlt?: string;
  /** Hide the "remove" button when the upload finished. Useful for
   * append-only flows. */
  removable?: boolean;
  /** Notify parent on success/clear — used for wizard step validation. */
  onUploaded?: ((args: { key: string; readUrl: string }) => void) | undefined;
  onCleared?: (() => void) | undefined;
  /** Notify parent of every status transition. Used by the annotation Sheet
   * to block submit while an upload is in flight (otherwise the user can
   * submit between drop and POST completion → annotation row created with
   * mediaKey='' and an orphan file lands 200ms later). */
  onStatusChange?: ((status: 'idle' | 'uploading' | 'success' | 'error') => void) | undefined;
}

interface UploadState {
  key: string | null;
  readUrl: string | null;
  status: 'idle' | 'uploading' | 'success' | 'error';
  message: string | null;
}

function nullable<T>(v: T | null | undefined): T | null {
  return v ?? null;
}

const ERROR_LABELS = {
  unauthorized: 'Session expirée, reconnecte-toi.',
  forbidden: 'Action refusée.',
  invalid_form: 'Formulaire invalide.',
  invalid_kind: 'Type d’upload invalide.',
  invalid_trade_id: 'Trade introuvable.',
  trade_not_found: 'Trade introuvable.',
  invalid_training_trade_id: 'Backtest introuvable.',
  training_trade_not_found: 'Backtest introuvable.',
  missing_file: 'Aucun fichier sélectionné.',
  empty_file: 'Le fichier est vide.',
  too_large: 'Fichier trop lourd.',
  invalid_mime: 'Format non supporté.',
  invalid_bytes: 'Le fichier ne ressemble pas à une vraie image.',
  storage_failed: "Échec de l'enregistrement, réessaie.",
} as const satisfies Record<string, string>;

type ErrorCode = keyof typeof ERROR_LABELS;

function errorLabel(code: string | undefined): string {
  if (code && code in ERROR_LABELS) return ERROR_LABELS[code as ErrorCode];
  return 'Échec de l’envoi.';
}

function bytesToMo(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} Mo max`;
}

export function MediaUploader({
  kind,
  tradeId,
  trainingTradeId,
  name,
  acceptMime,
  maxBytes,
  mediaTypeName,
  mediaTypeValue,
  initialKey,
  initialReadUrl,
  disabled,
  error,
  idleLabel = 'Glisse ou clique pour choisir',
  hint,
  previewAlt = 'Aperçu',
  removable = true,
  onUploaded,
  onCleared,
  onStatusChange,
}: MediaUploaderProps) {
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

  const accept = acceptMime.join(',');
  const resolvedHint = hint ?? `${acceptMime.map(mimeShort).join(' · ')} — ${bytesToMo(maxBytes)}`;

  const upload = useCallback(
    async (file: File) => {
      if (disabled) return;

      if (file.size === 0) {
        setState({ key: null, readUrl: null, status: 'error', message: errorLabel('empty_file') });
        onStatusChange?.('error');
        return;
      }
      if (file.size > maxBytes) {
        setState({
          key: null,
          readUrl: null,
          status: 'error',
          message: `Fichier trop lourd (${bytesToMo(maxBytes)}).`,
        });
        onStatusChange?.('error');
        return;
      }
      if (!acceptMime.includes(file.type)) {
        setState({
          key: null,
          readUrl: null,
          status: 'error',
          message: errorLabel('invalid_mime'),
        });
        onStatusChange?.('error');
        return;
      }

      setState((s) => ({ ...s, status: 'uploading', message: null }));
      onStatusChange?.('uploading');

      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      if (tradeId) fd.append('tradeId', tradeId);
      // J-T3: separate field — a training value never travels `tradeId` (§21.5).
      if (trainingTradeId) fd.append('trainingTradeId', trainingTradeId);

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
          onStatusChange?.('error');
          return;
        }
        setState({
          key: payload.key,
          readUrl: payload.readUrl,
          status: 'success',
          message: null,
        });
        onStatusChange?.('success');
        onUploaded?.({ key: payload.key, readUrl: payload.readUrl });
      } catch (err) {
        console.error('[MediaUploader] fetch failed', err);
        setState({
          key: null,
          readUrl: null,
          status: 'error',
          message: 'Erreur réseau. Réessaie.',
        });
        onStatusChange?.('error');
      }
    },
    [acceptMime, disabled, kind, maxBytes, onUploaded, onStatusChange, tradeId, trainingTradeId],
  );

  const clear = () => {
    setState({ key: null, readUrl: null, status: 'idle', message: null });
    if (inputRef.current) inputRef.current.value = '';
    onCleared?.();
    onStatusChange?.('idle');
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
          'rounded-card group flex min-h-36 cursor-pointer flex-col items-center justify-center gap-3 border border-dashed px-4 py-6 text-center transition-all',
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
          accept={accept}
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
              alt={previewAlt}
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
                {isDragOver ? 'Lâche pour envoyer' : idleLabel}
              </span>
              <span id={hintId} className="t-cap text-[var(--t-4)]">
                {resolvedHint}
              </span>
            </div>
          </>
        )}
      </label>

      {/* Hidden inputs the parent form posts. */}
      <input type="hidden" name={name} value={state.key ?? ''} />
      {mediaTypeName && mediaTypeValue ? (
        <input type="hidden" name={mediaTypeName} value={state.key ? mediaTypeValue : ''} />
      ) : null}

      {showPreview && removable ? (
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          className="rounded-control inline-flex h-11 min-w-[44px] items-center gap-1.5 self-start border border-transparent px-3 text-[12px] text-[var(--t-3)] transition-colors hover:border-[oklch(0.7_0.165_22_/_0.35)] hover:bg-[var(--bad-dim)] hover:text-[var(--bad)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)]"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          Retirer
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

function mimeShort(mime: string): string {
  // image/jpeg → JPEG, image/webp → WEBP …
  const slash = mime.indexOf('/');
  if (slash === -1) return mime.toUpperCase();
  return mime.slice(slash + 1).toUpperCase();
}
