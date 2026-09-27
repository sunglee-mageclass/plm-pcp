// Integração — dados da tela (TanStack Query) e o Salvar com as dependências REAIS. RPCs novas por `as any` (types.ts não é
// regerado nesta frente). queryKeys POR LOJA (trocar de loja não reaproveita cache — lição P-57).
import { useEffect } from "react";
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { BUCKET, uploadFile } from "@/components/planejamento/modelo-shared";
import { chaveEntradaPrevia, lerPrevia, type PreviaSkus } from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import { filtrosParaRpc, lerLista, type Filtros, type ListaIntegracao, type Situacao } from "@/lib/integracao/produtos";
import type { Rascunho } from "@/lib/integracao/rascunho";
import { entradaSkus, salvarIntegracao, type DepsSalvar, type ResultadoSalvar } from "./salvar-integracao";

export const chaveLista = (tenantId: string) => ["integracao-lista", tenantId] as const;
export const chaveConfig = (tenantId: string) => ["integracao-config", tenantId] as const;
export const chaveEstado = (tenantId: string) => ["integracao-estado", tenantId] as const;
export const chaveLog = (tenantId: string) => ["integracao-log", tenantId] as const;

export function useIntegracaoLista(situacao: Situacao, filtros: Filtros, pagina: number) {
  const tenantId = useActiveTenantId();
  const f = filtrosParaRpc(filtros);
  return useQuery({
    queryKey: [...chaveLista(tenantId), situacao, f, pagina],
    enabled: !!tenantId,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ListaIntegracao> => {
      const { data, error } = await supabase.rpc("integracao_listar" as any, { _situacao: situacao, _filtros: f, _pagina: pagina });
      if (error) throw error;
      return lerLista(data);
    },
  });
}

/** Edição alheia (card, Dev, outra aba) nos produtos DA PÁGINA chega por Realtime em `modelos` → a lista relê e o merge
 *  3-vias roda na aba. Filtra pelos ids da página (N2 do G-plano do plano: `integracao_listar` pode levar ~segundos — não
 *  reler a cada save de qualquer produto da loja). Página = 50 ids (o filtro `in` do Realtime aceita até 100). */
export function useIntegracaoAoVivo(ids: string[]): void {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  const chaveIds = [...ids].sort().join(",");
  useEffect(() => {
    if (!tenantId || chaveIds === "") return;
    let h = 0;
    for (let i = 0; i < chaveIds.length; i++) h = (h * 31 + chaveIds.charCodeAt(i)) | 0;
    const topico = `integracao-lista:${tenantId}:${(h >>> 0).toString(36)}`;
    const velho = supabase.getChannels().find((c) => c.topic === `realtime:${topico}`);
    if (velho) void supabase.removeChannel(velho);
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = supabase.channel(topico);
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table: "modelos", filter: `id=in.(${chaveIds})` }, () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void qc.invalidateQueries({ queryKey: chaveLista(tenantId) }), 800);
    });
    ch.subscribe();
    return () => {
      if (t) clearTimeout(t);
      void supabase.removeChannel(ch);
    };
  }, [tenantId, chaveIds, qc]);
}

export type ConfigIntegracao = {
  campos: string[]; layout: string[]; rev: number;
  api: { limite_por_minuto: number; max_por_pagina: number; validade_foto_dias: number; bloqueio_tentativas: number } | null;
};
export function useIntegracaoConfig() {
  const tenantId = useActiveTenantId();
  return useQuery({
    queryKey: chaveConfig(tenantId),
    enabled: !!tenantId,
    queryFn: async (): Promise<ConfigIntegracao> => {
      const { data, error } = await supabase.rpc("integracao_config_ler" as any);
      if (error) throw error;
      const o = (data ?? {}) as Partial<ConfigIntegracao>;
      return { campos: o.campos ?? [], layout: o.layout ?? [], rev: Number(o.rev ?? 0), api: o.api ?? null };
    },
  });
}

/** Prévia dos SKUs digitados (a MESMA RPC da seção Códigos, só leitura) — 1 consulta por produto com SKU "a gravar".
 *  T11: só entram rascunhos com `tamanhoTipo` conhecido (letra/numero) — um rascunho legado com `tamanhoTipo: null`
 *  nunca monta `entradaSkus` (que exigiria fabricar "letra"/"numero" do nada); a falta "Tamanho em" já bloqueia esse
 *  produto na tela antes de o usuário conseguir digitar um SKU pra valer (mesma régua de `salvarIntegracao`). */
export function usePreviasSkus(rascunhos: Rascunho[], ativo: boolean): Record<string, PreviaSkus | undefined> {
  const comSku = rascunhos.filter((r) => r.tamanhoTipo !== null && Object.keys(r.skus.manuais).length > 0);
  const qs = useQueries({
    queries: comSku.map((r) => {
      const e = entradaSkus(r);
      const chave = chaveEntradaPrevia({ ref: e.ref, tamanhoTipo: e.tamanhoTipo, aGravar: r.skus, virgem: false });
      return {
        queryKey: ["integracao-sku-previa", r.modeloId, chave],
        enabled: ativo,
        placeholderData: keepPreviousData,
        queryFn: async (): Promise<PreviaSkus> => {
          const { data, error } = await supabase.rpc("skus_previa" as any, {
            _modelo_id: r.modeloId, _ref: e.ref, _tamanho_tipo: e.tamanhoTipo, _manuais: e.manuais, _modo: e.modo,
          });
          if (error) throw error;
          return lerPrevia(data, chave);
        },
      };
    }),
  });
  return Object.fromEntries(comSku.map((r, i) => [r.modeloId, qs[i]?.data]));
}

export const depsSupabase: DepsSalvar = {
  subirFoto: (file) => uploadFile(file, "fotos_modelo"),
  apagarFotos: async (caminhos) => {
    await supabase.storage.from(BUCKET).remove(caminhos);
  },
  salvar: async (itens) => {
    const { data, error } = await supabase.rpc("integracao_salvar" as any, { _itens: itens });
    if (error) throw error;
    const o = (data ?? {}) as { salvos?: number; revs?: Record<string, number> };
    return { salvos: Number(o.salvos ?? 0), revs: o.revs ?? {} };
  },
  previaSkus: async (modeloId, e) => {
    const { data, error } = await supabase.rpc("skus_previa" as any, {
      _modelo_id: modeloId, _ref: e.ref, _tamanho_tipo: e.tamanhoTipo, _manuais: e.manuais, _modo: e.modo,
    });
    if (error) throw error;
    return lerPrevia(data, "salvar");
  },
  aplicarSkus: async (modeloId, a) => {
    const { data, error } = await supabase.rpc("aplicar_skus_modelo" as any, {
      _modelo_id: modeloId, _manuais: a.manuais, _modo: a.modo, _assinatura: a.assinatura,
    });
    if (error) throw error;
    return data;
  },
};

/** Tudo que mostra dado do produto relê (mão dupla: card, Dev, PA/PI, selos). */
export function invalidarIntegracao(qc: QueryClient, tenantId: string, ids: string[] = []): void {
  for (const k of [chaveLista(tenantId), chaveEstado(tenantId), chaveLog(tenantId)]) void qc.invalidateQueries({ queryKey: k });
  for (const k of ["modelos-planejamento", "modelos-desenvolvimento", "produtos-acabados", "plan-custo-unit"]) {
    void qc.invalidateQueries({ queryKey: [k] });
  }
  for (const id of ids) {
    void qc.invalidateQueries({ queryKey: ["modelo", id] });
    void qc.invalidateQueries({ queryKey: ["plan-skus", id] });
    void qc.invalidateQueries({ queryKey: ["integracao-sku-previa", id] });
  }
}

export function useSalvarIntegracao() {
  const tenantId = useActiveTenantId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rascunhos: Rascunho[]): Promise<ResultadoSalvar> => salvarIntegracao(rascunhos, depsSupabase),
    onSettled: (_d, _e, rascunhos) => invalidarIntegracao(qc, tenantId, rascunhos.map((r) => r.modeloId)),
  });
}
