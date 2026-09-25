// F3.3 — selos das seções cujo dado mora num componente do Dev reusado SEM modificar (decisão 8): Ajustes na Prova,
// Observações e Produto Relacionado. MESMAS queryKeys e MESMO queryFn dos componentes (cache compartilhado com a MESMA
// forma — a regra "queryKey única por tela" do CLAUDE.md é contra forma diferente na mesma key).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useProvaAbertosCount } from "@/components/desenvolvimento/modelo-detail/ModeloAjustesProvaSection";
import { SeloBadge } from "@/components/planejamento/planejamento-detail/ficha/secoes/SeloBadge";
import { seloObservacoes, seloProva, seloRelacionado } from "@/components/planejamento/planejamento-detail/ficha/selos-secoes";

/** Ajustes na Prova (Dev :2836-2838) — nº de comentários abertos. Decisão do dono 25/set: 0 abertos = sem selo. */
export function SeloProvaBadge({ modeloId }: { modeloId: string }) {
  const selo = seloProva(useProvaAbertosCount(modeloId));
  return selo ? <SeloBadge selo={selo} /> : null;
}

/** Observações — `ModeloObservacoes.tsx:52-65` (key + select + ordem idênticos). */
export function SeloObservacoesBadge({ modeloId }: { modeloId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["modelo-observacoes", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_observacoes" as any)
        .select("id, ordem, descricao, observacao")
        .eq("modelo_id", modeloId)
        .order("ordem")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown[];
    },
  });
  const selo = seloObservacoes(data.length);
  return selo ? <SeloBadge selo={selo} /> : null;
}

/** Produto Relacionado — `ProdutoRelacionadoSetor.tsx:37-43` (key + select idênticos). */
export function SeloRelacionadoBadge({ modeloId }: { modeloId: string }) {
  const { data: conjuntoId = null } = useQuery({
    queryKey: ["modelo-conjunto", modeloId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("modelos") as any).select("conjunto_id").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      return ((data as { conjunto_id?: string | null } | null)?.conjunto_id) ?? null;
    },
  });
  const selo = seloRelacionado(!!conjuntoId);
  return selo ? <SeloBadge selo={selo} /> : null;
}
