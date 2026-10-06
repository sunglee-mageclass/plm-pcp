import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { buscarTodas } from "@/lib/buscar-todas";
import { comRotuloColecaoLista } from "@/lib/colecao-rotulo";
import { ETAPAS_DEFAULT, type EtapaCfg } from "@/lib/pcp-etapas";
import { montarCards, montarCardsPecaTeste, type EtapaCard, type ModeloRow, type PecaTesteQuadroItem } from "@/lib/pcp-etapas-kanban";

export type EtapasFiltros = { colecao?: string[]; busca?: string };

// Hook de dados do kanban de Etapas PL: espelha a query de pcp.servicos.index.tsx (mesma
// base — modelos com enviado_cad + cad(enviado_corte)+producao_terceirizados) mas com o embed
// ESTENDIDO (empresa/categoria/grade_detalhe) e a mão de obra passada por `montarCards`
// (achatamento + filtro PL + etapa). queryKey PRÓPRIA — não compartilhar com "producao-terc-list".
// [R9] DUAS fontes: (1) os blocos de serviço (acima; as `pt_*` NÃO são mais lidas) e (2) a coluna "Peça Teste", que vem do CARD do
// produto pelo RPC `peca_teste_quadro` (1 card por produto, mesmo antes da Explosão). Os MESMOS filtros (coleção/busca) valem nas 2;
// produto com card PT "em teste" não repete os blocos.
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
      // [backend F2] buscarTodas: sem `.range` o PostgREST corta em 1.000 linhas sem avisar (cards de Etapas sumiam do quadro). Ordem
      // estável e única (created_at desc, id asc) entre as páginas; erro de qualquer página sobe (não mostra quadro pela metade).
      const data = await buscarTodas<ModeloRow & { colecao?: string | null }>((de, ate) =>
        (supabase.from("modelos") as any)
          .select(
            "id, ref, nome, colecao, colecoes(nome), lancado, origem, fotos_modelo, desenho_tecnico_url, croqui_url, cad(id, enviado_corte, producao_terceirizados(id, ativo, interno, categoria_terceirizado_id, categorias_terceirizado(nome), empresa:empresa_id(nome_fantasia), data_enviado, data_entregue, data_prevista, quantidade_recebida, grade_detalhe, peca_foto, peca_foto_previsao, peca_foto_data))",
          )
          .eq("enviado_cad", true)
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(de, ate),
      );
      // [modularidade R11] `colecao` = rótulo (nome do OTB, senão o texto): o filtro abaixo vê o card só-id.
      return comRotuloColecaoLista(data);
    },
  });

  // [R9] coluna Peça Teste (RPC `peca_teste_quadro`): `[]` sem ver Etapas; 42501 `modulo_desligado: etapas_pl` com o módulo off (a rota
  // já exige o módulo). Erro de carga NÃO vira "coluna vazia": sobe em `ptErro` e o quadro avisa (nada de enganar).
  const {
    data: ptRows = [],
    isLoading: ptLoading,
    isError: ptErro,
    isFetching: ptTentando,
    refetch: ptRecarregar,
  } = useQuery({
    queryKey: ["etapas-peca-teste", tenantId],
    enabled: !!tenantId,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("peca_teste_quadro");
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as PecaTesteQuadroItem[];
    },
  });

  const filtroColecao = filtros.colecao ?? [];
  const passa = (m: { colecao?: string | null; ref?: string | null; nome?: string | null }) => {
    if (filtroColecao.length && !filtroColecao.includes(m.colecao ?? "")) return false;
    if (filtros.busca) {
      const q = filtros.busca.toLowerCase();
      if (!`${m.ref ?? ""} ${m.nome ?? ""}`.toLowerCase().includes(q)) return false;
    }
    return true;
  };
  const filtered = rows.filter(passa);

  // 1 card PT por produto; o produto com PT "em teste" não repete os blocos de serviço (mesmo filtro nas 2 fontes).
  const cardsPT = montarCardsPecaTeste(ptRows.filter(passa), etapas);
  const suprimir = new Set(cardsPT.filter((c) => c.pecaTeste.status === "em_teste").map((c) => c.modeloId));
  const cards: EtapaCard[] = [...cardsPT, ...montarCards(filtered, etapas, suprimir)];

  return {
    cards,
    etapas,
    isLoading: isLoading || ptLoading,
    /** Falha ao ler a coluna Peça Teste (o quadro avisa e oferece "Tentar de novo"). */
    ptErro,
    ptTentando,
    ptRecarregar: () => { void ptRecarregar(); },
  };
}
