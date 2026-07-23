import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ArtigoTec = { id: string; nome: string; unidade_medida: string | null; rendimento: number | null; categoria_tecido_id: string | null };

/**
 * Classifica os artigos em tecido / forro / entretela pela CATEGORIA (mesma regra do
 * Desenvolvimento): forro = tem categoria "Forro"; entretela = "Entretela"; tecido = o resto.
 * Não existe "papel" manual — a categoria do artigo é a fonte da verdade.
 */
export function useArtigosTecido() {
  const { data: artigos = [] } = useQuery({
    queryKey: ["plan-tecido-artigos-all"],
    queryFn: async () =>
      ((await supabase.from("artigos").select("id, nome, unidade_medida, rendimento, categoria_tecido_id").order("nome")).data ?? []) as ArtigoTec[],
  });
  const { data: links = [] } = useQuery({
    queryKey: ["plan-tecido-artigo-cat-links"],
    queryFn: async () =>
      ((await supabase.from("artigo_categorias_tecido").select("artigo_id, categoria_tecido_id")).data ?? []) as { artigo_id: string; categoria_tecido_id: string }[],
  });
  const { data: cats = [] } = useQuery({
    queryKey: ["plan-tecido-cats-tecido"],
    queryFn: async () =>
      ((await supabase.from("categorias_tecido").select("id, nome")).data ?? []) as { id: string; nome: string }[],
  });

  return useMemo(() => {
    const catNome = new Map(cats.map((c) => [c.id, c.nome]));
    const artigoMap = new Map(artigos.map((a) => [a.id, a]));
    const catsByArtigo = new Map<string, Set<string>>();
    for (const l of links) {
      const s = catsByArtigo.get(l.artigo_id) ?? new Set<string>();
      s.add(l.categoria_tecido_id);
      catsByArtigo.set(l.artigo_id, s);
    }
    const catsDoArtigo = (id: string) => {
      const s = new Set(catsByArtigo.get(id) ?? []);
      const singular = artigoMap.get(id)?.categoria_tecido_id;
      if (singular) s.add(singular);
      return s;
    };
    const catIdsPorNome = (nome: string) =>
      new Set(cats.filter((c) => c.nome.trim().toLowerCase() === nome.toLowerCase()).map((c) => c.id));
    const forroCats = catIdsPorNome("forro");
    const entreCats = catIdsPorNome("entretela");
    const temAlgum = (id: string, set: Set<string>) => { for (const c of catsDoArtigo(id)) if (set.has(c)) return true; return false; };

    const forroIds = new Set(artigos.filter((a) => temAlgum(a.id, forroCats)).map((a) => a.id));
    const entretelaIds = new Set(artigos.filter((a) => temAlgum(a.id, entreCats)).map((a) => a.id));
    const tecidoArtigos = artigos.filter((a) => !forroIds.has(a.id) && !entretelaIds.has(a.id));
    const forroArtigos = artigos.filter((a) => forroIds.has(a.id));

    const categoriaNomeDe = (id: string) => {
      const c = artigoMap.get(id)?.categoria_tecido_id;
      return c ? (catNome.get(c) ?? null) : null;
    };
    // lista de artigos para um "papel" do plano (tecido/forro)
    const artigosDoPapel = (papel: string) => (papel === "forro" ? forroArtigos : tecidoArtigos);

    return { artigos, artigoMap, tecidoArtigos, forroArtigos, forroIds, entretelaIds, categoriaNomeDe, artigosDoPapel };
  }, [artigos, links, cats]);
}
