// Preço anterior e Título por versão (I1 da revisão front, fix round 1): a RPC `modelos_versao_anterior` falhou e NÃO há dado
// em cache — mostra a falha com "Tentar de novo" (padrão P-57 da casa: erro de carga nunca vira um "carregando" eterno).
// Usado no Sheet do Planejamento (Título, Preço anterior) e na Integração › Produtos (faixa acima da tabela).
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TEXTO_FALHA_VERSAO_ANTERIOR } from "@/lib/versao-anterior";

export function FalhaVersaoAnterior({
  onTentar,
  texto = TEXTO_FALHA_VERSAO_ANTERIOR,
  className,
}: {
  onTentar: () => void;
  texto?: string;
  className?: string;
}) {
  return (
    <span
      role="alert"
      className={cn("inline-flex flex-wrap items-center gap-1 text-xs text-destructive", className)}
    >
      {texto}
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        onClick={onTentar}
      >
        Tentar de novo
      </Button>
    </span>
  );
}
