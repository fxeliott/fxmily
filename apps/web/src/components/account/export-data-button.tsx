'use client';

import { Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Btn } from '@/components/ui/btn';

/**
 * `<ExportDataButton>` — the submit control inside the `/account/data` export
 * `<form action="/api/account/data/export" method="POST">` (Tour 16).
 *
 * The form stays a vanilla native POST (RGPD portability, no-JS accessible):
 * this button is JUST a `type="submit"`, so with JS disabled it still submits
 * and downloads. With JS, the POST triggers a file download WITHOUT a page
 * navigation, so React state is never reset by a route change. We therefore:
 *   - flip to a pending state on submit (disable + swap label) to stop a
 *     double-tap kicking off a second export;
 *   - re-arm after ~5s via `setTimeout`, since no navigation will do it for us.
 * The timer is cleared on unmount to avoid a state update on a gone component.
 */
export function ExportDataButton(): React.ReactElement {
  const [pending, setPending] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleClick = (): void => {
    setPending(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    // The download replaces no route, so nothing else resets the button.
    timerRef.current = setTimeout(() => setPending(false), 5000);
  };

  return (
    <Btn
      type="submit"
      kind="primary"
      size="l"
      loading={pending}
      onClick={handleClick}
      aria-label="Télécharger l’export JSON de mes données"
    >
      {pending ? (
        'Préparation de l’export...'
      ) : (
        <>
          <Download aria-hidden="true" className="h-4 w-4" />
          Télécharger l&apos;export JSON
        </>
      )}
    </Btn>
  );
}
