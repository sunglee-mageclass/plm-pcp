import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { semAcento } from "@/lib/busca";

/**
 * Busca de lista de COLEÇÕES que casa por nome da COLEÇÃO **ou** por nome de uma SUBCOLEÇÃO que ela
 * contém (decisão do dono: buscar uma subcoleção traz a coleção que a tem). Compartilhado pelas 3
 * telas que listam coleções: OTB, Plan. Tecido e Produto Acabado.
 *
 * Carrega TODAS as subcoleções do tenant uma vez (query leve, cacheada) → mapa colecao_id → nomes.
 * `matchColecao(colecaoId, colecaoNome, termo)` = true se o termo (sem acento, minúsculo) está no
 * nome da coleção ou em algum nome de subcoleção dela. Termo vazio = sempre true (não filtra).
 */
export function useBuscaColecaoSub() {
  const { data: subs = [] } = useQuery({
    queryKey: ["busca-colecao-subs"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () =>
      ((await supabase.from("colecao_subcolecoes" as any).select("colecao_id, nome")).data ?? []) as unknown as { colecao_id: string; nome: string }[],
  });

  // colecao_id → string única com os nomes das subcoleções (já sem acento/minúsculo) p/ o includes.
  const subsPorColecao = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of subs) {
      if (!s.colecao_id || !s.nome) continue;
      const prev = m.get(s.colecao_id) ?? "";
      m.set(s.colecao_id, `${prev} ${semAcento(s.nome.toLowerCase())}`);
    }
    return m;
  }, [subs]);

  const matchColecao = useMemo(() => (colecaoId: string, colecaoNome: string, termo: string): boolean => {
    const q = semAcento(termo.trim().toLowerCase());
    if (!q) return true;
    if (semAcento((colecaoNome ?? "").toLowerCase()).includes(q)) return true;
    return (subsPorColecao.get(colecaoId) ?? "").includes(q);
  }, [subsPorColecao]);

  return { matchColecao };
}
