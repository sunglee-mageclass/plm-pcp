// Preço anterior e Título por VERSÃO (P-146..P-159) — a versão anterior de cada card, lida da RPC `modelos_versao_anterior`
// (fonte única no SQL; `src/lib/versao-anterior.ts` só compõe). Usada pelo Sheet do Planejamento (1 id, só v2+) e pela
// Integração › Produtos (os ids da lista, ≤ 500). queryKey "versao-anterior" + loja + ids ordenados; o realtime
// (`realtime-invalidation-map.ts`, tabela `modelos`) invalida por prefixo — a anterior pode ser repreçada/renomeada por outra
// pessoa. Banco velho (RPC ainda não existe, PGRST202) = sem anterior para todos (a regra de hoje).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import {
  mapaVersaoAnterior,
  type LinhaVersaoAnteriorRpc,
  type VersaoAnteriorInfo,
} from "@/lib/versao-anterior";

/** Teto da RPC (P0001 'versao_anterior: limite de 500 ids' acima disso). */
export const LIMITE_VERSAO_ANTERIOR = 500;

export function useVersaoAnterior(
  ids: readonly string[],
  enabled = true,
): {
  mapa: Map<string, VersaoAnteriorInfo>;
  carregando: boolean;
  erro: boolean;
} {
  const tenantId = useActiveTenantId();
  const chave = useMemo(() => [...new Set(ids.filter(Boolean))].sort().join(","), [ids]);
  const lista = useMemo(() => (chave === "" ? [] : chave.split(",")), [chave]);
  const ativo = enabled && !!tenantId && lista.length > 0;
  const q = useQuery({
    queryKey: ["versao-anterior", tenantId, ...lista],
    enabled: ativo,
    staleTime: 10_000,
    retry: false,
    queryFn: async (): Promise<LinhaVersaoAnteriorRpc[]> => {
      const out: LinhaVersaoAnteriorRpc[] = [];
      for (let i = 0; i < lista.length; i += LIMITE_VERSAO_ANTERIOR) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await supabase.rpc("modelos_versao_anterior" as any, {
          _modelo_ids: lista.slice(i, i + LIMITE_VERSAO_ANTERIOR),
        });
        if (error) {
          if ((error as { code?: string }).code === "PGRST202") return []; // banco velho: regra de hoje
          throw error;
        }
        out.push(...((data ?? []) as LinhaVersaoAnteriorRpc[]));
      }
      return out;
    },
  });
  const mapa = useMemo(() => mapaVersaoAnterior(q.data ?? []), [q.data]);
  return { mapa, carregando: ativo && q.isLoading, erro: ativo && q.isError };
}
