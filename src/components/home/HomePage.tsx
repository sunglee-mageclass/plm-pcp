import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { useSystemIdentity, useApplySystemIdentity } from "@/hooks/useSystemIdentity";
import { Button } from "@/components/ui/button";
import { TecelagemAnimacao, type VarianteTecelagem } from "./TecelagemAnimacao";

/**
 * Home pública (deslogado): a animação de tecelagem (urdume + trama) em loop como pano
 * de fundo, com a marca e o acesso. Compartilha a animação com a tela /auth, então home
 * e login viram uma experiência só.
 */
export function HomePage() {
  const identity = useSystemIdentity();
  useApplySystemIdentity();
  // Comparador TEMPORÁRIO minimalista↔rica (pro dono escolher a vibe). Remover ao decidir.
  const [variante, setVariante] = useState<VarianteTecelagem>("minimal");

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Tecelagem de fundo */}
      <TecelagemAnimacao className="absolute inset-0 h-full w-full" opacity={1} variante={variante} />
      {/* Véu para legibilidade (centro mais limpo, bordas com o tecido aparecendo) */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, var(--background) 0%, color-mix(in oklab, var(--background) 58%, transparent) 50%, transparent 100%)",
        }}
      />

      <main className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow-lg">
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

      {/* Comparador temporário de vibe — canto inferior. */}
      <div className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2">
        <div className="flex items-center gap-1 rounded-full border bg-card/80 p-1 text-xs shadow-sm backdrop-blur">
          {(["minimal", "rica"] as VarianteTecelagem[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVariante(v)}
              className={`rounded-full px-3 py-1 transition-colors ${
                variante === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {v === "minimal" ? "Minimalista" : "Rica"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
