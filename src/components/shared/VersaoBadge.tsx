import { Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Badge de "versão de reposição" — aparece quando versao > 1 (original = v1 sem badge).
 * Usado no Planejamento, Desenvolvimento e etapas de Produção para identificar reposições.
 */
export function VersaoBadge({ versao, className }: { versao?: number | null; className?: string }) {
  if (!versao || versao <= 1) return null;
  return (
    <Badge
      variant="outline"
      title={`Versão de reposição (v${versao})`}
      className={`gap-0.5 border-amber-500 text-amber-600 shrink-0 ${className ?? ""}`}
    >
      <Repeat className="h-3 w-3" /> v{versao}
    </Badge>
  );
}
