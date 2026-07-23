import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NumberInput } from "@/components/shared/NumberInput";
import { precoInfo } from "@/lib/preco";
import { brl } from "@/lib/format";
import { AlertTriangle } from "lucide-react";
import type { PtSlot } from "@/lib/plan-tecido/types";
import { custoMateriaisPrevisto } from "@/lib/plan-tecido/calc";

export function CustoSection({ slot, onChange }: { slot: PtSlot; onChange: (s: PtSlot) => void }) {
  // markup vem da LINHA do modelo (linhas.markup) — necessário p/ o preço sugerido
  const { data: markupMap = {} } = useQuery({
    queryKey: ["plan-tecido-linhas-markup"],
    queryFn: async () => {
      const rows = ((await supabase.from("linhas").select("id, markup")).data ?? []) as { id: string; markup: number | null }[];
      return Object.fromEntries(rows.map((r) => [r.id, Number(r.markup) || 0])) as Record<string, number>;
    },
  });
  const markup = slot.linha_id ? (markupMap[slot.linha_id] ?? 0) : 0;

  const materiais = custoMateriaisPrevisto(slot);
  const maoObra = Number(slot.custo_terceirizados_previsto) || 0;
  const custoTotal = materiais + maoObra;
  const pi = precoInfo(custoTotal, markup, slot.preco_venda ?? null);

  const RO = ({ label, value }: { label: string; value: string }) => (
    <div><div className="text-[10px] text-muted-foreground">{label}</div><div className="rounded-md border bg-muted px-2 py-1 text-right text-xs text-muted-foreground">{value}</div></div>
  );

  return (
    <div className="p-2">
      <div className="mb-2 flex items-start gap-1 rounded-md border border-warning bg-warning/10 p-2 text-[10px]">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" /> Estimativa — não é o custo/preço real (esses vêm do BOM/CAD). Guardado no plano; não sobrescreve o modelo.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <RO label="Materiais (tecido/forro)" value={brl(materiais)} />
        <div><div className="text-[10px] text-muted-foreground">Mão de obra prevista</div>
          <NumberInput className="h-7 w-full text-right" value={maoObra} onChange={(e) => onChange({ ...slot, custo_terceirizados_previsto: Number(e.target.value) || 0 })} /></div>
        <RO label="Custo total" value={brl(custoTotal)} />
        <RO label="Markup (linha)" value={markup > 0 ? `${markup.toFixed(2)}×` : "—"} />
        <RO label="Preço sugerido" value={pi.sugerido > 0 ? brl(pi.sugerido) : "—"} />
        <div><div className="text-[10px] text-muted-foreground">Preço p/ venda</div>
          <NumberInput className="h-7 w-full text-right" value={slot.preco_venda ?? 0} onChange={(e) => onChange({ ...slot, preco_venda: Number(e.target.value) || 0 })} /></div>
      </div>
      {markup <= 0 && (
        <div className="mt-1 text-[9px] text-muted-foreground">Sem markup na linha do modelo → preço sugerido indisponível; use o preço p/ venda.</div>
      )}
    </div>
  );
}
