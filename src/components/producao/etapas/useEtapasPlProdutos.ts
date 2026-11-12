import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { buscarTodas } from "@/lib/buscar-todas";
import { comRotuloColecaoLista } from "@/lib/colecao-rotulo";
import type { ModeloPlRow } from "@/lib/pcp-etapas-pl-board";

// Dados do board das Etapas PL (Onda 3, Task 9): (1) os PRODUTOS (`modelos` com `status_etapa_pl` não nulo) e (2) as CONDIÇÕES
// satisfeitas por produto (`avaliar_condicoes_etapas_pl`, SÓ com a chave ligada — desligada o board não bloqueia nada).
// queryKeys `["etapas-pl-cards", tenantId]` / `["etapas-pl-cond", tenantId, ids]`: a loja entra na key (troca de loja refaz a
// leitura); os filtros da tela NÃO (filtra no cliente — digitar na busca não refaz a leitura). A rota invalida os dois por prefixo.
export type CondicoesPorProduto = Record<string, Record<string, boolean>>;

const SELECT_PL =
  "id, ref, nome, colecao, colecoes(nome), lancado, origem, status_etapa_pl, fotos_modelo, desenho_tecnico_url, croqui_url, cad(id, producao_terceirizados(id, ativo, interno, categorias_terceirizado(nome), empresa:empresa_id(nome_fantasia), data_prevista, data_entregue, peca_foto, peca_foto_previsao, peca_foto_data))";

export function useEtapasPlProdutos(ligado: boolean) {
  const tenantId = useActiveTenantId();

  const cardsQ = useQuery({
    queryKey: ["etapas-pl-cards", tenantId],
    enabled: !!tenantId,
    retry: 1,
    queryFn: async () => {
      // [backend F2] buscarTodas: sem `.range` o PostgREST corta em 1.000 linhas sem avisar. Ordem estável e única entre as
      // páginas; erro de qualquer página sobe (nada de quadro pela metade). `colecao` = rótulo (nome do OTB, senão o texto).
      const data = await buscarTodas<ModeloPlRow>((de, ate) =>
        (supabase.from("modelos") as any)
          .select(SELECT_PL)
          .not("status_etapa_pl", "is", null)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(de, ate),
      );
      return comRotuloColecaoLista(data);
    },
  });
  const rows = cardsQ.data;

  const ids = useMemo(() => (rows ?? []).map((m) => m.id).sort(), [rows]);
  const condQ = useQuery({
    queryKey: ["etapas-pl-cond", tenantId, ids],
    enabled: !!tenantId && ligado && ids.length > 0,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("avaliar_condicoes_etapas_pl" as any, { _ids: ids });
      if (error) throw error;
      return (data ?? {}) as CondicoesPorProduto;
    },
  });
  // Sem produtos não há o que avaliar (a query fica desligada e nunca vira `isSuccess`).
  const condicoesProntas = !ligado || ids.length === 0 || condQ.isSuccess;
  const condErro = ligado && condQ.isError;

  return { cardsQ, rows, condQ, condicoesProntas, condErro, tenantId };
}
