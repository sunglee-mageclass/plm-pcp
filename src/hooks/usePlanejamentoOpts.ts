// As 7 listas de opções do Planejamento, extraídas (refactor 2026-08-25) das `useQuery`
// inline de `PlanejamentoPage`. queryKeys e queryFns MANTIDOS byte-a-byte — o cache é
// compartilhado com a página e com o detalhe do card, então preservar as keys evita
// refetch duplo. Comportamento idêntico ao de antes.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOpts, type Opt, type CatOpt, type LinhaOpt } from "@/components/planejamento/modelo-shared";

export function usePlanejamentoOpts() {
  const { data: estilistas = [] } = useQuery({
    queryKey: ["colab-estilistas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("id, nome").eq("tipo", "estilista").order("nome");
      if (error) throw error;
      return (data ?? []) as Opt[];
    },
  });
  const { data: meses = [] } = useOpts("meses", "mes");
  const { data: anos = [] } = useOpts("anos", "ano");
  const { data: grupos = [] } = useOpts("grupos_produto");
  const { data: categorias = [] } = useQuery({
    queryKey: ["opt", "categorias_produto", "com-grupo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_produto").select("id, nome, grupo_id").order("nome");
      if (error) throw error;
      return (data ?? []) as CatOpt[];
    },
  });
  const { data: linhas = [] } = useQuery({
    queryKey: ["opt", "linhas", "com-markup"],
    queryFn: async () => {
      const { data, error } = await supabase.from("linhas").select("id, nome, markup").order("nome");
      if (error) throw error;
      return (data ?? []) as LinhaOpt[];
    },
  });
  const { data: artigos = [] } = useQuery({
    queryKey: ["artigos-planejamento"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("id, nome, unidade_medida, preco_por_metro, categoria_tecido_id, categorias_tecido(nome)")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; unidade_medida: string | null; preco_por_metro: number | null; categoria_tecido_id: string | null; categorias_tecido: { nome: string | null } | null }[];
    },
  });

  return { estilistas, linhas, meses, anos, grupos, categorias, artigos };
}
