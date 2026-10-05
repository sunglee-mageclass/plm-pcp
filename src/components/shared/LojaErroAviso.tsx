import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";

/**
 * [backend F1] A 1ª carga da loja ativa (ou dos módulos dela) FALHOU, depois do retry do React Query. Em vez de tratar a
 * loja como "sem módulos opcionais" (DEFAULTS) e mostrar "Módulo desligado", a tela explica e oferece "Tentar de novo".
 * `tentando` = a nova tentativa está em andamento: o aviso FICA na tela com o botão desabilitado ("Tentando…") em vez de sumir
 * para o branco. Falha de REFETCH com dado guardado nunca chega aqui (o hook mantém o último valor bom).
 * O texto não afirma que é a rede (pode ser sessão expirada etc.).
 */
export function LojaErroAviso({ onTentarDeNovo, tentando = false }: { onTentarDeNovo: () => void; tentando?: boolean }) {
  return (
    <div role="alert" className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6">
      <EmptyState
        icon={WifiOff}
        title="Não foi possível carregar a sua loja"
        description="Tente de novo. Se continuar, verifique a conexão ou entre outra vez."
        className="max-w-lg"
      />
      <Button type="button" onClick={onTentarDeNovo} disabled={tentando}>
        {tentando ? "Tentando…" : "Tentar de novo"}
      </Button>
    </div>
  );
}
