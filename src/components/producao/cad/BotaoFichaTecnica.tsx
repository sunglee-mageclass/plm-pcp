import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTamanhoVinculadoInsumos } from "@/hooks/useTamanhoVinculadoInsumos";

/**
 * Botão "Ficha Técnica" do PCP › Serviços (imprime a `FichaTecnica` montada na própria tela, sem passar pelo `PrintFicha`).
 * urg R1: a ficha só imprime com os tamanhos vinculados dos insumos já lidos — senão o insumo vinculado sairia com a
 * quantidade da grade inteira. Enquanto carrega o botão fica desabilitado; se a leitura falhar aparece o erro com
 * "Tentar de novo" (nunca imprime sozinho ao recuperar: só no clique).
 */
export function BotaoFichaTecnica({ onImprimir, disabled }: { onImprimir: () => void; disabled?: boolean }) {
  const { data, isError, isFetching, refetch } = useTamanhoVinculadoInsumos();
  const erro = isError && data === undefined;
  return (
    <>
      {erro && (
        <span role="alert" className="hidden md:inline-flex items-center gap-2 text-xs text-destructive">
          Não foi possível carregar os dados.
          <Button type="button" variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? "Tentando…" : "Tentar de novo"}
          </Button>
        </span>
      )}
      <Button
        variant="outline"
        className="hidden md:inline-flex"
        onClick={onImprimir}
        disabled={disabled || data === undefined}
        title={data === undefined && !erro ? "Carregando os dados da ficha…" : undefined}
      >
        <FileText className="h-4 w-4 mr-2" /> Ficha Técnica
      </Button>
    </>
  );
}
