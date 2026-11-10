import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PtArvore } from "@/lib/plan-tecido/types";
import { variantesNovasDoRascunho, type EstoqueVarianteRpc } from "@/lib/plan-tecido/calc";

/** Variantes do rascunho FORA da cobertura do servidor (card/cor ainda não salvos no plano) + o EST REAL delas
 *  (RPC existente `plan_tecido_estoque`). Fonte ÚNICA p/ Modo Plano e Resumo comum — MESMA queryKey ⇒ MESMO formato
 *  de dado (cache compartilhado). `coberturaServidor` undefined (prévia carregando) ⇒ nenhuma "nova" (senão TODA variante pareceria nova). */
export function useEstoqueCorNova(
  coberturaServidor: readonly { variante_tecido_id?: string | null }[] | null | undefined,
  arvore: PtArvore,
  reprovadoSet: ReadonlySet<string> | undefined,
) {
  const novasVariantes = useMemo(() => {
    if (!coberturaServidor) return [];
    return variantesNovasDoRascunho(arvore, reprovadoSet, new Set(coberturaServidor.map((c) => c.variante_tecido_id).filter((x): x is string => !!x)));
  }, [coberturaServidor, arvore, reprovadoSet]);
  const novasIds = useMemo(() => novasVariantes.map((n) => n.variante_tecido_id).sort(), [novasVariantes]);
  const { data: extra } = useQuery({
    queryKey: ["plan-tecido-estoque-extra", novasIds], // RPC tenant-wide: sem colecaoId (só duplicaria cache)
    enabled: novasIds.length > 0,
    placeholderData: keepPreviousData, // ao entrar a 2ª cor nova, mantém o EST da anterior (sem piscar em 0)
    queryFn: async () => {
      const { data: estData, error: estErr } = await supabase.rpc("plan_tecido_estoque" as any, { _variante_ids: novasIds });
      if (estErr) throw estErr; // não engolir erro: senão vira "EST 0" silencioso
      const estoque = (estData ?? []) as EstoqueVarianteRpc[];
      // artigo REAL de cada cor nova (a variante recém-adicionada no card não traz `variante_artigo_id`; substituto cairia no artigo errado)
      const { data: artsData, error: artsErr } = await supabase.from("variantes_tecido").select("id, artigo_id").in("id", novasIds);
      if (artsErr) throw artsErr;
      const arts = (artsData ?? []) as { id: string; artigo_id: string }[];
      return { estoque, artigoDe: Object.fromEntries(arts.map((a) => [a.id, a.artigo_id])) as Record<string, string> };
    },
  });
  return { novasVariantes, extra };
}
