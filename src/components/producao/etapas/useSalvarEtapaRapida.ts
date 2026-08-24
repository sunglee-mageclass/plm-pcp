import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { EtapaCard } from "@/lib/pcp-etapas-kanban";

// Campos editáveis pela edição rápida do card (Task 4). `pt_aprovacao` grava Aprovar/Reprovar
// (reprovar faz o card sumir do quadro — `montarCards` exclui — no próximo fetch de "etapas-cards").
export type CampoRapido = "pt_data_saida" | "pt_data_entrada" | "pt_aprovacao" | "data_enviado";

/**
 * Grava UM campo de UM bloco de `producao_terceirizados` via `salvar_terceirizados`,
 * em sync com o sheet do PCP (mesma RPC, mesma tabela).
 *
 * ⚠️ SEGURANÇA DO PAYLOAD: `EtapaCard.bloco` (fonte: `montarCards`, `src/lib/pcp-etapas-kanban.ts`)
 * só carrega os campos que alimentam `etapaDoBloco` — NÃO carrega `interno`, `empresa_id`,
 * `representante_id`, `colaborador_id`, `preco_metro_unidade`, `quantidade_enviada/defeito`,
 * `desconto_total`, `multa_total`, `numero_parcelas`, `data_prevista`, `observacao`,
 * `aviamentos_enviados`, `tecidos_enviados`, `detalhado` nem `rev`. `salvar_terceirizados` faz
 * UPDATE SET de TODOS esses campos a partir do objeto do bloco (não faz merge parcial no
 * servidor — ver `pcp.servicos.$modeloId.tsx` `_blocos` e a migration
 * `20260821130000_salvar_terceirizados_pt.sql`): mandar um bloco reconstruído só do `EtapaCard`
 * ZERARIA os campos ausentes (ex.: apagaria `empresa_id`, `aviamentos_enviados` etc.).
 *
 * Por isso o caminho SEGURO escolhido é RE-FETCH: antes de salvar, busca a linha COMPLETA
 * (`select("*")`) de `producao_terceirizados` por `blocoId`, aplica só o campo alterado por cima
 * (merge no cliente), e manda esse objeto completo pro `_blocos` — nenhum campo fica de fora.
 * `_rev_base` viaja com o `rev` que acabou de vir do re-fetch (leitura fresca → trava otimista
 * não gera falso-positivo de conflito).
 *
 * `_observacoes_molde` (parâmetro da RPC, grava em `cad.observacoes_molde`) também é
 * RE-LIDO fresco (`cad` por `card.cadId`) e repassado sem alteração — a RPC faz
 * `UPDATE cad SET observacoes_molde = NULLIF(_observacoes_molde,'')` incondicionalmente;
 * mandar `null` aqui apagaria a observação do molde a cada quick-save do card.
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
      const [{ data: row, error: fetchError }, { data: cadRow, error: cadError }] = await Promise.all([
        supabase.from("producao_terceirizados").select("*").eq("id", card.blocoId).single(),
        supabase.from("cad").select("observacoes_molde").eq("id", card.cadId).single(),
      ]);
      if (fetchError) throw fetchError;
      if (cadError) throw cadError;
      const r = row as Record<string, unknown>;

      const bloco = {
        id: r.id,
        categoria_terceirizado_id: r.categoria_terceirizado_id,
        interno: r.interno,
        empresa_id: r.empresa_id,
        representante_id: r.representante_id,
        colaborador_id: r.colaborador_id,
        ativo: r.ativo,
        preco_metro_unidade: r.preco_metro_unidade,
        quantidade_enviada: r.quantidade_enviada,
        quantidade_recebida: r.quantidade_recebida,
        quantidade_defeito: r.quantidade_defeito,
        desconto_total: r.desconto_total,
        multa_total: r.multa_total,
        numero_parcelas: r.numero_parcelas,
        data_enviado: r.data_enviado,
        data_prevista: r.data_prevista,
        data_entregue: r.data_entregue,
        observacao: r.observacao,
        aviamentos_enviados: r.aviamentos_enviados,
        tecidos_enviados: r.tecidos_enviados,
        detalhado: r.detalhado,
        grade_detalhe: r.grade_detalhe,
        pt_data_saida: r.pt_data_saida,
        pt_data_entrada: r.pt_data_entrada,
        pt_aprovacao: r.pt_aprovacao,
        // sobrescreve por cima da linha fresca com o campo alterado pela edição rápida
        [campo]: valor,
      };

      const _rev_base = { [card.blocoId]: (r.rev as number | undefined) ?? 0 };

      const { error } = await supabase.rpc("salvar_terceirizados" as any, {
        _cad_id: card.cadId,
        _blocos: [bloco],
        _observacoes_molde: (cadRow as { observacoes_molde: string | null } | null)?.observacoes_molde ?? null,
        _rev_base,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // Sync com os dois surfaces: o quadro de Etapas e a lista/sheet do PCP Serviços.
      qc.invalidateQueries({ queryKey: ["etapas-cards"] });
      qc.invalidateQueries({ queryKey: ["producao-terc-list"] });
    },
  });
}
