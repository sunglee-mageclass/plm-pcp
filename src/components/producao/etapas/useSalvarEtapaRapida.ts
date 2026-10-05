import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EtapaCard } from "@/lib/pcp-etapas-kanban";
import {
  montarPayloadEdicaoRapida,
  ServicoSumiuError,
  type CampoRapido,
} from "@/lib/servicos-payload";

// Campos editáveis pela edição rápida do card (Task 4). `pt_aprovacao` grava Aprovar/Reprovar
// (reprovar faz o card sumir do quadro — `montarCards` exclui — no próximo fetch de "etapas-cards").
export type { CampoRapido };

/**
 * Grava UM campo de UM bloco de `producao_terceirizados` via `salvar_terceirizados`, em sync com o sheet do PCP.
 *
 * ⚠️ `salvar_terceirizados` é ESTADO COMPLETO do CAD: apaga todo serviço do CAD que não vier em `_blocos` e grava TODAS as
 * colunas de cada bloco (inclusive `nf_saida`/`nf_entrada`/`peca_foto`/`peca_foto_data`). Mandar só o bloco do card
 * (como era até out/2026) apagava os OUTROS serviços do CAD e zerava NF/peça-foto a cada data/aprovação editada no card.
 *
 * Agora: relê TODAS as linhas do CAD (`select("*")`) e o `observacoes_molde` do CAD, e monta o payload pela MESMA função do
 * sheet (`montarPayloadEdicaoRapida` → `blocoDeLinha`/`blocoParaPayload`, src/lib/servicos-payload.ts) com só o campo
 * alterado. `_rev_base` leva o `rev` lido de cada bloco: se outra pessoa salvou no meio, o servidor recusa (P0409) e a pessoa
 * vê a mensagem de conflito (sem retry automático — nada é gravado; o quadro é relido).
 */
export function useSalvarEtapaRapida() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      card,
      campo,
      valor,
    }: {
      card: EtapaCard;
      campo: CampoRapido;
      valor: string | null;
    }) => {
      const [{ data: linhas, error: fetchError }, { data: cadRow, error: cadError }] =
        await Promise.all([
          supabase.from("producao_terceirizados").select("*").eq("cad_id", card.cadId),
          supabase.from("cad").select("observacoes_molde").eq("id", card.cadId).single(),
        ]);
      if (fetchError) throw fetchError;
      if (cadError) throw cadError;

      const { _blocos, _rev_base } = montarPayloadEdicaoRapida({
        linhas: (linhas ?? []) as Record<string, unknown>[],
        blocoId: card.blocoId,
        campo,
        valor,
      });

      const { error } = await supabase.rpc("salvar_terceirizados" as any, {
        _cad_id: card.cadId,
        _blocos,
        // A RPC grava `cad.observacoes_molde` incondicionalmente: repassa o valor lido agora (null apagaria a observação).
        _observacoes_molde:
          (cadRow as { observacoes_molde: string | null } | null)?.observacoes_molde ?? null,
        _rev_base,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // Sync com os dois surfaces: o quadro de Etapas e a lista/sheet do PCP Serviços.
      qc.invalidateQueries({ queryKey: ["etapas-cards"] });
      qc.invalidateQueries({ queryKey: ["producao-terc-list"] });
    },
    onError: (e: unknown) => {
      // Conflito (P0409) ou serviço excluído: a mensagem diz que o quadro foi atualizado — relê.
      if ((e as { code?: string } | null)?.code === "P0409" || e instanceof ServicoSumiuError)
        qc.invalidateQueries({ queryKey: ["etapas-cards"] });
    },
  });
}
