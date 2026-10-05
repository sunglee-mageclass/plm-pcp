import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

/** [backend F2.2 / R7] Motivo mostrado (e usado no title) enquanto o modo OC/Rolo da loja nao foi lido. */
export const MOTIVO_MODO_DESCONHECIDO = "Aguarde: o modo de trabalho da loja (OC/Rolo) ainda não foi carregado.";

/**
 * Botoes de acao do rodape da OC de Tecido (Marcar/Desmarcar Recebido + Salvar). Salvar e Marcar Recebido DECIDEM por rolos x OC
 * conforme o modo da loja: ate `modoPronto` ficam desabilitados (com motivo visivel e, se a 1a carga falhou, "Tentar de novo").
 */
export function OcAcoesSalvar({
  modoPronto,
  modoErro,
  recarregarModo,
  salvando,
  canShowRecebimento,
  somenteLeituraRecebimento,
  desmarcando,
  onSalvar,
  onMarcarRecebido,
  onDesmarcarRecebido,
}: {
  modoPronto: boolean;
  modoErro: boolean;
  recarregarModo: () => void;
  salvando: boolean;
  canShowRecebimento: boolean;
  somenteLeituraRecebimento: boolean;
  desmarcando: boolean;
  onSalvar: () => void;
  onMarcarRecebido: () => void;
  onDesmarcarRecebido: () => void;
}) {
  const motivoModo = modoPronto ? null : MOTIVO_MODO_DESCONHECIDO;
  return (
    <div className="ml-auto flex gap-2">
      {canShowRecebimento &&
        // Botão que alterna: marca quando encomendado, desmarca quando recebido.
        (somenteLeituraRecebimento ? (
          <Button variant="outline" onClick={onDesmarcarRecebido} disabled={desmarcando}>
            Desmarcar Recebido
          </Button>
        ) : (
          <Button variant="outline" onClick={onMarcarRecebido} disabled={salvando || !modoPronto} title={motivoModo ?? undefined}>
            Marcar Recebido
          </Button>
        ))}
      {motivoModo && (
        <span className="self-center text-xs text-muted-foreground" role="status">
          {modoErro ? "Não foi possível carregar o modo de trabalho da loja (OC/Rolo)." : "Carregando o modo de trabalho da loja…"}
          {modoErro && (
            <button type="button" className="ml-1 underline underline-offset-2" onClick={recarregarModo}>
              Tentar de novo
            </button>
          )}
        </span>
      )}
      <Button onClick={onSalvar} disabled={salvando || !modoPronto} title={motivoModo ?? undefined}>
        <Check className="h-4 w-4 mr-1" />
        Salvar
      </Button>
    </div>
  );
}
