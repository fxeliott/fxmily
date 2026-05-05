import Image from 'next/image';

export default function HomePage() {
  return (
    <main
      role="main"
      className="bg-background flex flex-1 flex-col items-center justify-center px-6 py-20"
    >
      <div className="flex flex-col items-center gap-6">
        <Image
          src="/logo.png"
          alt=""
          width={1920}
          height={1080}
          priority
          sizes="(max-width: 640px) 280px, 420px"
          className="h-auto w-[280px] select-none sm:w-[420px]"
        />
        <div className="flex flex-col items-center gap-3 text-center">
          <h1 className="text-foreground text-5xl font-semibold tracking-tight sm:text-6xl">
            Fxmily
          </h1>
          <p className="text-muted-foreground max-w-xs text-base sm:max-w-sm sm:text-lg">
            Suivi comportemental des membres de la formation.
          </p>
          <span className="border-border text-muted-foreground mt-1 inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs">
            Setup en cours · jalon 0
          </span>
        </div>
      </div>
    </main>
  );
}
