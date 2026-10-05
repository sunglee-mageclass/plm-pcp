// urg R2 T12 — lista "Insumos padrão" da loja + catálogo de insumos, para o "+ Novo" e o "Criar vários cards".
// queryKey PRÓPRIA (CLAUDE.md: key única por tela), com a loja. `tenant_config.insumos_padrao` e o catálogo saem JUNTOS: a normalização
// precisa dos dois (órfão = insumo que não está no catálogo da loja). Erro de REDE lança no queryFn (a tela trava o Salvar com
// "Tentar de novo" — P-57); valor cru ruim NÃO é erro (a normalização ignora item a item).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import type { EtiquetaInfo, Opt } from "@/components/desenvolvimento/modelo-detail/types";
import { normalizarInsumosPadraoParaCard, type InsumoPadraoLinha } from "@/lib/insumos-iniciais";

type Carga = { raw: unknown; etiquetas: EtiquetaInfo[] };
const SEM_ETIQUETAS: EtiquetaInfo[] = [];
const SEM_LINHAS: InsumoPadraoLinha[] = [];

export function useInsumosPadrao(enabled: boolean) {
  const tenantId = useActiveTenantId();
  const q = useQuery({
    queryKey: ["planejamento-insumos-padrao", tenantId],
    enabled: enabled && !!tenantId,
    queryFn: async (): Promise<Carga> => {
      // Colunas novas fora do types.ts → cast (CLAUDE.md).
      const [cfg, etq] = await Promise.all([
        (supabase.from("tenant_config") as any)
          .select("insumos_padrao")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        supabase
          .from("etiquetas" as any)
          .select(
            "id, nome, formato_tamanho, preco, tamanho_vinculado, variantes_etiqueta(cor_id, preco, tamanho, cor:cor_id(nome))",
          )
          .order("nome"),
      ]);
      if (cfg.error) throw cfg.error;
      if (etq.error) throw etq.error;
      const etiquetas = ((etq.data ?? []) as any[]).map((e) => ({
        id: e.id,
        nome: e.nome,
        formato_tamanho: e.formato_tamanho ?? "ambos",
        preco: e.preco,
        tamanho_vinculado: e.tamanho_vinculado ?? null,
        variantes: (e.variantes_etiqueta ?? []).map((v: any) => ({
          cor_id: v.cor_id,
          cor_nome: v.cor?.nome ?? null,
          preco: v.preco,
          tamanho: v.tamanho ?? null,
        })),
      })) as EtiquetaInfo[];
      return { raw: cfg.data?.insumos_padrao ?? null, etiquetas };
    },
  });
  const etiquetas = q.data?.etiquetas ?? SEM_ETIQUETAS;
  const etiquetaMap = useMemo(
    () => Object.fromEntries(etiquetas.map((e) => [e.id, e])) as Record<string, EtiquetaInfo>,
    [etiquetas],
  );
  const etiquetaOpts = useMemo<Opt[]>(
    () => etiquetas.map((e) => ({ id: e.id, nome: e.nome })),
    [etiquetas],
  );
  const normalizada = useMemo(
    () =>
      q.data
        ? normalizarInsumosPadraoParaCard(q.data.raw, etiquetaMap)
        : { linhas: SEM_LINHAS, orfaos: 0 },
    [q.data, etiquetaMap],
  );
  return {
    /** Linhas válidas da lista da loja (já filtradas pelo catálogo, ≤ 20). */
    linhas: normalizada.linhas,
    orfaos: normalizada.orfaos,
    etiquetaMap,
    etiquetaOpts,
    /** true só enquanto a 1ª carga não terminou (query habilitada). */
    carregando: enabled && (!tenantId || q.isPending),
    /** Erro de rede/servidor ao carregar (trava o Salvar; "Tentar de novo" = `refetch`). */
    erro: q.isError,
    carregado: !!q.data,
    tentarDeNovo: () => {
      void q.refetch();
    },
  };
}
