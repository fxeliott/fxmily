import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-center justify-center px-6 text-center">
      <div className="text-[11px] font-medium tracking-[0.16em] text-[var(--tr-t-3)] uppercase">
        404
      </div>
      <h1
        className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-[var(--tr-t-1)] sm:text-4xl"
        style={{ fontFamily: 'var(--tr-font-display)' }}
      >
        Cette page n&apos;existe pas.
      </h1>
      <p className="mt-3 max-w-sm text-[15px] text-[var(--tr-t-2)]">
        Le lien que vous avez suivi est peut-être obsolète. Retour à l&apos;accueil ci-dessous.
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex h-11 items-center rounded-lg border border-[var(--tr-b-default)] bg-[var(--tr-bg-1)] px-5 text-sm font-medium text-[var(--tr-t-1)] transition hover:border-[var(--tr-acc)] hover:bg-[var(--tr-bg-2)]"
      >
        Retour au track record
      </Link>
    </main>
  );
}
