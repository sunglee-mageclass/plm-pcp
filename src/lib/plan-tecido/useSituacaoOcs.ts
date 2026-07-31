import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Uma linha por item de OC (oc × artigo × variante) das OCs da coleção. */
export type SituacaoOcRow = {
  oc_tecido_id: string;
  numero: string | null;
  data_pedido: string | null;
  status: string | null;
  artigo_id: string;
  artigo_nome: string;
  variante_tecido_id: string;
  variante_label: string | null;
  pedida_m: number;
  entregue_m: number;
  usada_m: number;          // pt2 — baixa real no ledger (vermelho)
  comprometida_m: number;   // pt1 — enviado à explosão / uso planejado (laranja)
};

export function useSituacaoOcs(colecaoId: string) {
  return useQuery({
    queryKey: ["plan-tecido-situacao-ocs", colecaoId],
    // a baixa real (usada) e o comprometido do Dev mudam FORA do plano (corte/explosão) → refetcha
    // ao voltar o foco pra não mostrar "usada" defasada.
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data } = await supabase.rpc("plan_tecido_situacao_ocs" as any, { _colecao_id: colecaoId });
      return ((data ?? []) as SituacaoOcRow[]).map((r) => ({
        ...r,
        pedida_m: Number(r.pedida_m) || 0,
        entregue_m: Number(r.entregue_m) || 0,
        usada_m: Number(r.usada_m) || 0,
        comprometida_m: Number(r.comprometida_m) || 0,
      }));
    },
  });
}

/** Agrupa as linhas por OC (para os quadros "Situação da OC — por OC" e "OCs vinculadas"). */
export function agruparPorOc(rows: SituacaoOcRow[]) {
  const map = new Map<string, { oc_tecido_id: string; numero: string | null; status: string | null; tecidos: string[]; pedida: number; entregue: number; usada: number; comprometida: number }>();
  for (const r of rows) {
    let g = map.get(r.oc_tecido_id);
    if (!g) { g = { oc_tecido_id: r.oc_tecido_id, numero: r.numero, status: r.status, tecidos: [], pedida: 0, entregue: 0, usada: 0, comprometida: 0 }; map.set(r.oc_tecido_id, g); }
    g.pedida += r.pedida_m; g.entregue += r.entregue_m; g.usada += r.usada_m; g.comprometida += r.comprometida_m;
    if (r.artigo_nome && !g.tecidos.includes(r.artigo_nome)) g.tecidos.push(r.artigo_nome);
  }
  // tecidos de cada OC em ordem alfabética (dono, jul/2026) — o rótulo e a ordenação das OCs no
  // Resumo se apoiam nisto.
  for (const g of map.values()) g.tecidos.sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));
  return [...map.values()];
}
