import Image from 'next/image';

export default function HomePage() {
  return (
    <main className="bg-background flex flex-1 flex-col items-center justify-center px-6 py-20">
      <div className="flex flex-col items-center gap-10">
        <Image
          src="/logo.svg"
          alt="Fxmily"
          width={120}
          height={168}
          priority
          className="select-none"
        />
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-foreground text-5xl font-bold tracking-tight sm:text-6xl">Fxmily</h1>
          <p className="text-muted-foreground max-w-md text-base sm:text-lg">
            Suivi comportemental des membres de la formation.
            <br />
            <span className="text-muted text-sm">Setup en cours — jalon 0</span>
          </p>
        </div>
      </div>
    </main>
  );
}
