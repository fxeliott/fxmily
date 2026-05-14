import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { V18CbtDisclaimerBanner } from '@/components/reflect/cbt-disclaimer-banner';
import { ReflectionWizard } from '@/components/reflect/reflection-wizard';
import { V18Aurora } from '@/components/v18/aurora';
import { V18ThemeScope } from '@/components/v18/theme-scope';

export const dynamic = 'force-dynamic';

/**
 * V1.8 REFLECT — `/reflect/new` host page.
 *
 * Server Component. Mounts the CBT-honesty banner FIRST (sticky-friendly
 * top of page) then the wizard. Posture decision in
 * `docs/jalon-V1.8-decisions.md` — disclaimer non-négociable, impossible
 * à manquer, before the member starts typing.
 */
export default async function NewReflectionPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.status !== 'active') {
    redirect('/login');
  }

  return (
    <V18ThemeScope>
      <V18Aurora />
      <main className="relative mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <nav aria-label="Fil d'Ariane" className="flex items-center gap-2">
          <Link
            href="/reflect"
            className="t-cap rounded-pill inline-flex h-8 items-center gap-1 px-2.5 text-[var(--t-3)] transition-colors hover:bg-[var(--bg-2)] hover:text-[var(--t-1)]"
          >
            ← Réflexions ABCD
          </Link>
        </nav>

        <V18CbtDisclaimerBanner />
        <ReflectionWizard />
      </main>
    </V18ThemeScope>
  );
}
