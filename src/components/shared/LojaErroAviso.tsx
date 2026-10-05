import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";

/**
 * [backend F1] A 1ª carga da loja ativa (ou dos módulos dela) FALHOU, depois dos retries do React Query. Em vez de tratar a
 * loja como "sem módulos opcionais" (DEFAULTS) e mostrar "Módulo desligado", a tela explica e oferece "Tentar de novo".
 * Falha de REFETCH com dado guardado nunca chega aqui (o hook mantém o último valor bom).
 */
export function LojaErroAviso({ onTentarDeNovo }: { onTentarDeNovo: () => void }) {
  return (
    <div role="alert" className="container mx-auto flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6">
      <EmptyState
        icon={WifiOff}
        title="Não foi possível carregar a sua loja"
        description="Verifique a conexão e tente de novo."
        className="max-w-lg"
      />
      <Button type="button" onClick={onTentarDeNovo}>
        Tentar de novo
      </Button>
    </div>
  );
}
