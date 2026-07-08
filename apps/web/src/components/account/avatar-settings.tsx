'use client';

import { Camera, Check, Loader2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Avatar } from '@/components/ui/avatar';
import { convertHeicToJpeg, isHeicFile } from '@/lib/uploads/heic.client';

import { AvatarCropEditor } from './avatar-crop-editor';

/**
 * `<AvatarSettings>` — member profile-photo control (`/account/photo` +
 * onboarding). The member picks ANY image, frames it (position + zoom) in the
 * `<AvatarCropEditor>`, which exports a clean 512² WebP blob; that blob is
 * uploaded to `POST /api/account/avatar` (multipart) and removed via `DELETE`.
 * The server re-sniffs + re-normalizes as a defense-in-depth gate and persists
 * `user.avatarKey`, which the leaderboard reads live. Routing every upload
 * through the canvas editor is ALSO the "tout type de fichier" solution — any
 * format the browser renders becomes a canonical WebP before it leaves the
 * device. Optimistic preview, honest inline error mapping, `router.refresh()`
 * after a mutation so the server-rendered face updates. Reduced-motion-safe.
 */

/** Generous raw-input ceiling — the editor re-encodes to a tiny WebP, so this
 *  only guards against a browser-choking decode of an absurdly large file. */
const INPUT_MAX_BYTES = 40 * 1024 * 1024;

interface AvatarSettingsProps {
  initialUrl: string | null;
  initials: string;
  firstName: string;
}

type ApiError = { error?: string; message?: string };

export function AvatarSettings({
  initialUrl,
  initials,
  firstName,
}: AvatarSettingsProps): React.ReactElement {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // In-flight covers the ACTUAL network request (upload/delete). `pending`
  // (useTransition) is only true during the trailing router.refresh(), so
  // deriving `busy` from it alone left the fetch — the slow part, an 8 MB image
  // normalized to WebP server-side — with no spinner and a still-enabled button,
  // allowing a stale-overwriting double-submit. `inFlight` closes both.
  const [inFlight, setInFlight] = useState(false);
  // Object URL of the image currently framed in the crop/zoom editor (null = the
  // normal controls are shown). Every upload goes through the editor. We own the
  // blob's whole lifetime here — created in `openEditor`, revoked in
  // `closeEditor` — never in render or a passive effect (React discourages
  // createObjectURL during render, and a revoke effect would fire on Strict
  // Mode's simulated unmount and kill the live blob).
  const [editing, setEditing] = useState<string | null>(null);
  // True while an iPhone HEIC photo is being decoded to JPEG on-device (lazy
  // libheif WASM). It gates the picker button and shows a spinner so the ~1-3 s
  // conversion never looks frozen or double-fires.
  const [converting, setConverting] = useState(false);
  const editingUrlRef = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const shown = preview ?? url;

  function reset(): void {
    setError(null);
    setSaved(false);
  }

  /** Revoke the framed image's object URL (if any) and close the editor. */
  function closeEditor(): void {
    if (editingUrlRef.current) {
      URL.revokeObjectURL(editingUrlRef.current);
      editingUrlRef.current = null;
    }
    setEditing(null);
  }

  /** Open the crop/zoom editor for a freshly picked file (after a sanity cap).
   *  iPhone HEIC/HEIF is transparently converted to JPEG first so the browser
   *  can actually display it in the editor. */
  async function openEditor(file: File): Promise<void> {
    reset();
    if (file.size > INPUT_MAX_BYTES) {
      setError('Fichier trop lourd (40 Mo maximum). Choisis une image plus légère.');
      return;
    }
    let framed = file;
    try {
      if (await isHeicFile(file)) {
        // Browsers (except Safari) can't decode HEIC in <img>/<canvas>, so the
        // crop editor would fail. Convert on-device first; the ~3 MB libheif
        // WASM is lazy-loaded ONLY here, only for HEIC picks.
        setConverting(true);
        framed = await convertHeicToJpeg(file);
      }
    } catch {
      setConverting(false);
      setError(
        'Cette photo iPhone (HEIC) n’a pas pu être convertie. Réessaie, ou exporte-la en JPEG (Réglages > Appareil photo > Le plus compatible).',
      );
      return;
    }
    setConverting(false);
    if (editingUrlRef.current) URL.revokeObjectURL(editingUrlRef.current);
    const nextUrl = URL.createObjectURL(framed);
    editingUrlRef.current = nextUrl;
    setEditing(nextUrl);
  }

  /** The editor produced a framed WebP blob — upload it. */
  function onCropConfirm(blob: Blob): void {
    closeEditor();
    const framed = new File([blob], 'avatar.webp', { type: blob.type || 'image/webp' });
    void upload(framed);
  }

  /** The browser could not decode the picked file (e.g. HEIC on desktop Chrome). */
  function onCropDecodeError(): void {
    closeEditor();
    setError(
      'Ce fichier n’a pas pu être affiché. Sur iPhone, exporte la photo en JPEG (Réglages > Appareil photo > Le plus compatible), ou choisis un JPG, PNG ou WebP.',
    );
  }

  // Safety net: revoke a still-open framed URL if the component unmounts mid-edit.
  useEffect(() => {
    return () => {
      if (editingUrlRef.current) URL.revokeObjectURL(editingUrlRef.current);
    };
  }, []);

  async function upload(file: File): Promise<void> {
    if (inFlight) return; // re-entry guard: no concurrent stale-overwriting upload
    reset();
    // Optimistic local preview while the request is in flight.
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    setInFlight(true);

    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch('/api/account/avatar', { method: 'POST', body });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiError;
        setPreview(null);
        setError(data.message ?? 'L’envoi a échoué, réessaie avec une autre image.');
        return;
      }
      const data = (await res.json()) as { readUrl: string };
      setUrl(data.readUrl);
      setPreview(null);
      setSaved(true);
      startTransition(() => router.refresh());
    } catch {
      setPreview(null);
      setError('Connexion interrompue, réessaie.');
    } finally {
      setInFlight(false);
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function remove(): Promise<void> {
    if (inFlight) return; // re-entry guard
    reset();
    setInFlight(true);
    try {
      const res = await fetch('/api/account/avatar', { method: 'DELETE' });
      if (!res.ok) {
        setError('La suppression a échoué, réessaie.');
        return;
      }
      setUrl(null);
      setPreview(null);
      setSaved(true);
      startTransition(() => router.refresh());
    } catch {
      setError('Connexion interrompue, réessaie.');
    } finally {
      setInFlight(false);
    }
  }

  // Cover BOTH the network request (inFlight) and the trailing refresh (pending)
  // so the spinner + disabled state span the whole mutation, not just the tail.
  const busy = inFlight || pending;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <Avatar url={shown} initials={initials} firstName={firstName} size={88} />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy || converting || editing !== null}
              className="rounded-control inline-flex h-10 items-center gap-2 border border-[var(--b-acc)] bg-[var(--acc-dim)] px-3.5 text-[13px] font-medium text-[var(--acc-hi)] transition hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] disabled:opacity-60"
            >
              {busy || converting ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Camera className="h-4 w-4" aria-hidden="true" />
              )}
              {url ? 'Changer la photo' : 'Ajouter une photo'}
            </button>
            {url ? (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy || converting || editing !== null}
                className="rounded-control inline-flex h-10 items-center gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] px-3.5 text-[13px] font-medium text-[var(--t-2)] transition hover:border-[var(--b-danger)] hover:text-[var(--bad)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Retirer
              </button>
            ) : null}
          </div>
          <p className="text-[11px] text-[var(--t-4)]">
            Tout type d&apos;image (photo iPhone comprise). Tu la cadres avant l&apos;envoi.
          </p>
        </div>
      </div>

      {editing ? (
        <div className="rounded-card border border-[var(--b-default)] bg-[var(--bg-1)] p-4">
          <AvatarCropEditor
            previewUrl={editing}
            busy={busy}
            onCancel={closeEditor}
            onConfirm={onCropConfirm}
            onDecodeError={onCropDecodeError}
          />
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        // Explicit `.heic,.heif` in addition to `image/*`: some OS file pickers
        // grey out HEIC under a bare `image/*` because the platform has no
        // registered MIME for it, so the member literally can't select their
        // iPhone photo without the extension hint.
        accept="image/*,.heic,.heif"
        className="sr-only"
        aria-label="Choisir une photo de profil"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openEditor(file);
          // Reset so re-picking the same file fires onChange again.
          e.target.value = '';
        }}
      />

      <div aria-live="polite" className="min-h-5">
        {converting ? (
          <p className="inline-flex items-center gap-1.5 text-[13px] text-[var(--t-3)]">
            <Loader2
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            Conversion de la photo iPhone en cours…
          </p>
        ) : saved && !busy ? (
          <p className="inline-flex items-center gap-1.5 text-[13px] text-[var(--ok)]">
            <Check className="h-4 w-4" aria-hidden="true" />
            Photo enregistrée. Elle apparaît dans le classement.
          </p>
        ) : null}
      </div>
      {error !== null ? (
        <p role="alert" className="text-[13px] text-[var(--bad)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
