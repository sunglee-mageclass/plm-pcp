import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { ETAPAS_DEFAULT, type EtapaCfg } from "@/lib/pcp-etapas";
import { montarCards, type ModeloRow } from "@/lib/pcp-etapas-kanban";

export type EtapasFiltros = { colecao?: string[]; busca?: string };

// Hook de dados do kanban de Etapas PL: espelha a query de pcp.servicos.index.tsx (mesma
// base — modelos com enviado_cad + cad(enviado_corte)+producao_terceirizados) mas com o embed
// ESTENDIDO (empresa/categoria/pt_*/grade_detalhe) e a mão de obra passada por `montarCards`
// (achatamento + filtro PL + etapa). queryKey PRÓPRIA — não compartilhar com "producao-terc-list".
// ⚠️ `tenantId` entra na key (isolamento multi-tenant — troca de loja no TenantSwitcher tem
// que refazer o fetch, senão o cache serve dado da loja anterior; padrão de useFichaData.ts
// `["ft-tamanhos", tenantId]`), e os filtros vão ACHATADOS (primitivos), não o objeto cru.
export function useEtapasCards(filtros: EtapasFiltros = {}) {
  const tenantId = useActiveTenantId();

  const { data: etapas = ETAPAS_DEFAULT } = useQuery({
    queryKey: ["tenant_config", "pcp_etapas", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_config")
        .select("pcp_etapas")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      const raw = (data as any)?.pcp_etapas;
      return Array.isArray(raw) && raw.length ? (raw as EtapaCfg[]) : ETAPAS_DEFAULT;
    },
    staleTime: 5 * 60_000,
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: [
      "etapas-cards",
      tenantId,
      (filtros.colecao ?? []).join(","),
      filtros.busca ?? null,
    ],
    queryFn: async () => {
      const { data, error } = await (supabase.from("modelos") as any)
        .select(
          "id, ref, nome, colecao, fotos_modelo, desenho_tecnico_url, croqui_url, cad(id, enviado_corte, producao_terceirizados(id, ativo, interno, categoria_terceirizado_id, categorias_terceirizado(nome), empresa:empresa_id(nome_fantasia), pt_data_saida, pt_data_entrada, pt_aprovacao, data_enviado, data_entregue, quantidade_recebida, grade_detalhe))",
        )
        .eq("enviado_cad", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as (ModeloRow & { colecao?: string | null })[];
    },
  });

  const filtered = rows.filter((m) => {
    if (filtros.colecao?.length && !filtros.colecao.includes(m.colecao ?? "")) return false;
    if (filtros.busca) {
      const q = filtros.busca.toLowerCase();
      if (!`${m.ref ?? ""} ${m.nome ?? ""}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const cards = montarCards(filtered, etapas);

  return { cards, etapas, isLoading };
}
