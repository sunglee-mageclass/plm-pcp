import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RequirePermission } from "@/components/RequirePermission";
import { IntegracaoPage } from "@/components/integracao/IntegracaoPage";
import { AvisoComputador } from "@/components/integracao/AvisoComputador";
import { useIsMobile } from "@/hooks/use-mobile";

export function PaginaIntegracao() {
  const estreitaAoVivo = useIsMobile();
  // Fix round 1 (task-17-18-review.md Minor 3): a decisão "estreita ou não" é travada no PRIMEIRO valor visto — só
  // ele decide se a IntegracaoPage chega a montar. Um resize/rotação DEPOIS de já ter montado em tela larga (ex.:
  // iPad mini virado pra retrato, ~744px, ou a janela do desktop redimensionada) NUNCA desmonta a página: isso
  // jogaria fora rascunhos não salvos de Produtos/Campos/API sem passar pelo `useUnsavedGuard`. Só o valor de
  // ENTRADA decide a montagem; depois de montada em tela larga, um estreitamento posterior não muda nada na tela
  // (fica montada, silenciosamente) — sem texto novo (fix round 2, Minor 1: o global exige textos verbatim do
  // plano; "Tela estreita — a Integração funciona melhor num computador." nunca foi aprovado pelo dono).
  const [estreitaNaEntrada] = useState(estreitaAoVivo);
  if (estreitaNaEntrada) return <AvisoComputador />;
  return <IntegracaoPage />;
}

export const Route = createFileRoute("/_authenticated/integracao")({
  component: () => (
    <RequirePermission page="integracao">
      <PaginaIntegracao />
    </RequirePermission>
  ),
});
