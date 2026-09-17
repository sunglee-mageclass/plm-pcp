import type { ReactNode } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { OcResumoCores } from "./OcResumoCores";
import type { SituacaoOcRow } from "@/lib/plan-tecido/useSituacaoOcs";

// Popover de HOVER (desktop) sobre o gatilho de uma OC: mostra a tabela Cor · Pedido · Reserva · Sobra
// daquela OC (set/2026) — SEM a lista de modelos (só os números). Reusa `OcResumoCores`, a mesma tabela
// do dialog. Usado no card travado (OCs do Dev) e na seção "OCs vinculadas" do resumo. O CLIQUE no
// gatilho (abrir o dialog completo) é responsabilidade do próprio `children` — este componente só
// adiciona o preview no hover. `children` precisa aceitar ref/props (ex. um <button>/<span>).
export function OcHoverResumo({ situacaoRows, ocId, children }: { situacaoRows: SituacaoOcRow[]; ocId: string; children: ReactNode }) {
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      {/* hidden no mobile (sem hover) — lá o clique abre o dialog completo, que já traz a tabela. */}
      <HoverCardContent align="start" className="hidden w-auto p-0 md:block">
        <OcResumoCores situacaoRows={situacaoRows} ocId={ocId} compact />
      </HoverCardContent>
    </HoverCard>
  );
}
