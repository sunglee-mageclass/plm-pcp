import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Botão "Histórico" de cada linha/card das abas de estoque (urgentes R3, T16). `stopPropagation`: a linha de Tecido/Aviamento
 * abre/fecha o detalhe ao clicar — o botão só abre o Sheet do extrato (`ExtratoEstoqueSheet`).
 */
export function HistoricoButton({ onOpen, className }: { onOpen: () => void; className?: string }) {
  return (
    <Button
      type="button"
      size="iconSm"
      variant="ghost"
      aria-label="Histórico"
      title="Histórico"
      className={cn("shrink-0", className)}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
    >
      <History className="h-4 w-4" />
    </Button>
  );
}
