// Sincroniza `tecidos_planejados` (Planejamento) → `modelo_tecidos` tipo "tecido" (Desenvolvimento).
// Extraído na F3.0 (set/2026) de `PlanejamentoDetail.tsx` SEM mudança de comportamento: texto MOVIDO
// como estava (só ganhou `export`). A F3.2 (BOM no Sheet unificado) apaga este arquivo.
import { supabase } from "@/integrations/supabase/client";

/**
 * Sincroniza tecidos_planejados (Planejamento) com modelo_tecidos tipo "tecido" (Desenvolvimento).
 * - Preserva blocos não-tecido (forro/entretela/etc).
 * - Se o artigo de um numero mudou, limpa variantes daquela linha.
 * - Remove tecidos cujo numero não está mais em planejados.
 * - Insere novos com consumo=0.
 */
export async function syncTecidosToDesenvolvimento(modeloId: string, planejados: string[]) {
  const { data: existing, error: eFetch } = await supabase
    .from("modelo_tecidos")
    .select("id, artigo_id, numero, tipo")
    .eq("modelo_id", modeloId)
    .eq("tipo", "tecido");
  if (eFetch) throw eFetch;
  const rows = (existing ?? []) as any[];

  // Casa por ARTIGO (e não por posição): assim REORDENAR ou REMOVER um tecido no
  // Planejamento NÃO apaga as variantes/cores e o consumo já preenchidos no
  // Desenvolvimento — só reposiciona (numero) ou insere/remove o que mudou.
  const usedIds = new Set<string>();
  for (let i = 0; i < planejados.length; i++) {
    const numero = i + 1;
    const artigoId = planejados[i];
    const match = rows.find((r) => r.artigo_id === artigoId && !usedIds.has(r.id));
    if (match) {
      usedIds.add(match.id);
      if (match.numero !== numero) {
        const { error } = await supabase.from("modelo_tecidos").update({ numero }).eq("id", match.id);
        if (error) throw error;
      }
    } else {
      const { error } = await supabase.from("modelo_tecidos").insert({
        modelo_id: modeloId, tipo: "tecido", numero, artigo_id: artigoId,
        consumo: 0, loss_percent: 0, custo_previsto: 0,
      });
      if (error) throw error;
    }
  }

  // Remove só os tecidos cujo artigo NÃO está mais planejado (aí sim apaga as
  // variantes deles).
  const toDelete = rows.filter((r) => !usedIds.has(r.id));
  if (toDelete.length > 0) {
    const ids = toDelete.map((r) => r.id);
    await supabase.from("modelo_tecido_variantes").delete().in("modelo_tecido_id", ids);
    await supabase.from("modelo_tecidos").delete().in("id", ids);
  }
}
