import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useSystemIdentity, useApplySystemIdentity } from "@/hooks/useSystemIdentity";
import { Button } from "@/components/ui/button";
import { TecelagemAnimacao } from "./TecelagemAnimacao";

/**
 * Home pública (deslogado): a animação de tecelagem (urdume + trama) em loop como pano
 * de fundo, com a marca e o acesso. Compartilha a animação com a tela /auth, então home
 * e login viram uma experiência só.
 */
export function HomePage() {
  const identity = useSystemIdentity();
  useApplySystemIdentity();

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background dark:[--color-foreground:var(--sidebar-foreground)] dark:[--color-primary:var(--home-hero-primary)]">
      {/* Tecelagem de fundo */}
      <TecelagemAnimacao className="absolute inset-0 h-full w-full" opacity={1} />
      {/* Véu para legibilidade (centro mais limpo, bordas com o tecido aparecendo) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, var(--background) 0%, color-mix(in oklab, var(--background) 58%, transparent) 50%, transparent 100%)",
        }}
      />

      <main className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <div className={cn(
          "mb-6 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl shadow-lg",
          identity.logoSignedUrl ? "border bg-background p-1.5" : "bg-primary text-primary-foreground",
        )}>
          {identity.logoSignedUrl ? (
            <img src={identity.logoSignedUrl} alt={identity.nome_sistema} className="h-full w-full object-contain" />
          ) : (
            <span className="font-display text-2xl font-bold">
              {(identity.nome_sistema || "SI").slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>

        <h1 className="font-display text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
          {identity.nome_sistema}
        </h1>
        {identity.subtitulo && (
          <p className="mt-3 max-w-md text-base text-muted-foreground sm:text-lg">
            {identity.subtitulo}
          </p>
        )}

        <div className="mt-9">
          <Button asChild size="lg" className="px-8 shadow-md">
            <Link to="/auth">
              Entrar <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
