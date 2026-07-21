import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { makeEmptyBlocks, type TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import type { ModeloParaCopia } from "./importar-copia";

export function useModeloParaCopia(modeloId: string | null) {
  return useQuery<ModeloParaCopia>({
    queryKey: ["modelo-para-copia", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const [m, tec, avi, etq, gra, obs] = await Promise.all([
        supabase.from("modelos").select("observacoes_tecnicas, custos_adicionais, proporcoes").eq("id", modeloId!).single(),
        supabase.from("modelo_tecidos").select("id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto, modelo_tecido_variantes(variante_tecido_id, ordem, multiplicador)").eq("modelo_id", modeloId!),
        supabase.from("modelo_aviamentos").select("aviamento_id, consumo, loss_percent, custo_previsto").eq("modelo_id", modeloId!).order("numero"),
        supabase.from("modelo_etiquetas" as any).select("etiqueta_id, cor_id, consumo, loss_percent, custo_previsto").eq("modelo_id", modeloId!).order("numero"),
        supabase.from("modelo_grades").select("variante_numero, grades, grade_total").eq("modelo_id", modeloId!),
        supabase.from("modelo_observacoes" as any).select("ordem, descricao, observacao").eq("modelo_id", modeloId!).order("ordem"),
      ]);
      const blocks = makeEmptyBlocks();
      for (const t of (tec.data ?? []) as any[]) {
        const b = blocks.find((x) => x.tipo === t.tipo && x.numero === t.numero);
        if (!b) continue;
        b.artigo_id = t.artigo_id ?? null;
        b.consumo = Number(t.consumo ?? 0);
        b.loss_percent = Number(t.loss_percent ?? 0);
        b.custo_previsto = Number(t.custo_previsto ?? 0);
        const vs = [...(t.modelo_tecido_variantes ?? [])].sort((a: any, c: any) => (a.ordem ?? 0) - (c.ordem ?? 0));
        for (const v of vs) {
          const i = (v.ordem ?? 1) - 1;
          if (i >= 0 && i < b.variantes.length) { b.variantes[i] = v.variante_tecido_id ?? null; b.multiplicadores[i] = Number(v.multiplicador ?? 1) || 1; }
        }
        // artigoIdsExtra é derivado das variantes pelo card ao recompor; na origem fica vazio.
        b.artigoIdsExtra = [];
      }
      return {
        observacoes_tecnicas: (m.data as any)?.observacoes_tecnicas ?? "",
        custos_adicionais: ((m.data as any)?.custos_adicionais ?? []) as { descricao: string; valor: number }[],
        proporcoes: ((m.data as any)?.proporcoes ?? {}) as Record<string, number>,
        blocks,
        aviamentos: ((avi.data ?? []) as any[]).map((r) => ({ aviamento_id: r.aviamento_id, consumo: Number(r.consumo ?? 0), loss_percent: Number(r.loss_percent ?? 0), custo_previsto: Number(r.custo_previsto ?? 0) })),
        etiquetas: ((etq.data ?? []) as any[]).map((r) => ({ etiqueta_id: r.etiqueta_id, cor_id: r.cor_id ?? null, consumo: Number(r.consumo ?? 0), loss_percent: Number(r.loss_percent ?? 0), custo_previsto: Number(r.custo_previsto ?? 0) })),
        grades: ((gra.data ?? []) as any[]).map((g) => ({ variante_numero: g.variante_numero, grades: (g.grades ?? {}) as Record<string, number>, grade_total: Number(g.grade_total ?? 0) })),
        obsBlocoLinhas: ((obs.data ?? []) as any[]).map((o) => ({ ordem: o.ordem ?? null, descricao: o.descricao ?? null, observacao: o.observacao ?? null })),
      };
    },
  });
}
