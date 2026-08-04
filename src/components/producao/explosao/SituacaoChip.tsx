// Chip de Situação da Explosão — usado na lista (entrada-saida.explosao.index.tsx) e no
// detalhe (ExplosaoDetail.tsx), sobre a MESMA regra `situacaoExplosao` (src/lib/explosao.ts).
import { AlertTriangle, Check, Clock } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { ExplosaoSituacao } from "@/lib/explosao";

export function SituacaoChip({
  situacao,
  className,
}: {
  situacao: ExplosaoSituacao;
  className?: string;
}) {
  if (situacao === "aguardando") {
    return (
      <StatusBadge tone="warning" className={className}>
        <Clock className="h-3 w-3 mr-1" />
        Aguardando
      </StatusBadge>
    );
  }
  if (situacao === "faltou_estoque") {
    return (
      <StatusBadge tone="danger" className={className}>
        <AlertTriangle className="h-3 w-3 mr-1" />
        Faltou estoque
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="success" className={className}>
      <Check className="h-3 w-3 mr-1" />
      Enviado
    </StatusBadge>
  );
}
