'use client';

import { Camera, Check, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Avatar } from '@/components/ui/avatar';

/**
 * `<AvatarSettings>` — member profile-photo control (`/account/photo` +
 * onboarding). Uploads to `POST /api/account/avatar` (multipart) and removes via
 * `DELETE`; the server sniffs, normalizes to a square WebP and persists
 * `user.avatarKey`, which the leaderboard reads live. Optimistic preview via an
 * object URL, honest inline error mapping, `router.refresh()` after a mutation
 * so the server-rendered face updates. Reduced-motion-safe (spinner is the only
 * motion, `motion-reduce:animate-none`).
 */

const MAX_BYTES = 8 * 1024 * 1024;

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
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const shown = preview ?? url;

  function reset(): void {
    setError(null);
    setSaved(false);
  }

  async function upload(file: File): Promise<void> {
    if (inFlight) return; // re-entry guard: no concurrent stale-overwriting upload
    reset();
    if (file.size > MAX_BYTES) {
      setError('Photo trop lourde (8 Mo maximum). Choisis une image plus légère.');
      return;
    }
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
        setError(data.message ?? "L'envoi a échoué, réessaie avec une autre image.");
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
              disabled={busy}
              className="rounded-control inline-flex h-10 items-center gap-2 border border-[var(--b-acc)] bg-[var(--acc-dim)] px-3.5 text-[13px] font-medium text-[var(--acc-hi)] transition hover:bg-[var(--acc-dim-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] disabled:opacity-60"
            >
              {busy ? (
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
                disabled={busy}
                className="rounded-control inline-flex h-10 items-center gap-2 border border-[var(--b-default)] bg-[var(--bg-1)] px-3.5 text-[13px] font-medium text-[var(--t-2)] transition hover:border-[var(--b-danger)] hover:text-[var(--bad)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--acc)] disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Retirer
              </button>
            ) : null}
          </div>
          <p className="text-[11px] text-[var(--t-4)]">
            JPG, PNG, WebP, GIF ou AVIF. 8 Mo maximum.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        className="sr-only"
        aria-label="Choisir une photo de profil"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          // Reset so re-picking the same file fires onChange again.
          e.target.value = '';
        }}
      />

      <div aria-live="polite" className="min-h-5">
        {saved && !busy ? (
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
