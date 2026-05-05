import Image from 'next/image';

export default function HomePage() {
  return (
    <main
      role="main"
      className="bg-background flex flex-1 flex-col items-center justify-center px-6 py-20"
    >
      <div className="flex flex-col items-center gap-7">
        <Image
          src="/logo.svg"
          alt=""
          width={96}
          height={134}
          priority
          className="select-none sm:[height:168px] sm:[width:120px]"
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
