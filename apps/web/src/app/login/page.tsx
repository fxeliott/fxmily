import Image from 'next/image';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';

import { LoginForm } from './login-form';

export const metadata = {
  title: 'Connexion · Fxmily',
};

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) {
    redirect('/dashboard');
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[var(--background)] px-4 py-10">
      <section className="flex w-full max-w-sm flex-col gap-8">
        <header className="flex flex-col items-center gap-3">
          <Image
            src="/logo.png"
            width={56}
            height={56}
            alt="Fxmily"
            className="rounded-lg"
            priority
          />
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">
            Connexion
          </h1>
          <p className="text-center text-sm text-[var(--muted)]">
            Accède à ton espace de suivi Fxmily.
          </p>
        </header>

        <LoginForm />
      </section>
    </main>
  );
}
