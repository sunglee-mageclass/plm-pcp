import { NumberInput } from "@/components/shared/NumberInput";
import { precoInfo } from "@/lib/preco";
import { brl } from "@/lib/format";
import { AlertTriangle } from "lucide-react";
import type { PtSlot } from "@/lib/plan-tecido/types";
import { custoMateriaisPrevisto } from "@/lib/plan-tecido/calc";

export function CustoSection({ slot, onChange }: { slot: PtSlot; onChange: (s: PtSlot) => void }) {
  const materiais = custoMateriaisPrevisto(slot);
  const maoObra = Number(slot.custo_terceirizados_previsto) || 0;
  const custoTotal = materiais + maoObra;
  const pi = precoInfo(custoTotal, 0 /* markup da linha entra quando o slot tiver linha_id resolvida */, slot.preco_venda ?? null);

  const RO = ({ label, value }: { label: string; value: string }) => (
    <div><div className="text-[10px] text-muted-foreground">{label}</div><div className="rounded-md border bg-muted px-2 py-1 text-right text-xs text-muted-foreground">{value}</div></div>
  );

  return (
    <div className="p-2">
      <div className="mb-2 flex items-start gap-1 rounded-md border border-warning bg-warning/10 p-2 text-[10px]">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" /> Estimativa — não é o custo/preço real (esses vêm do BOM/CAD). Guardado no plano; não sobrescreve o modelo.
      </div>
      <div className="grid grid-cols-2 gap-2">
        <RO label="Materiais previstos" value={brl(materiais)} />
        <div><div className="text-[10px] text-muted-foreground">Mão de obra prevista</div>
          <NumberInput className="h-7 w-full text-right" value={maoObra} onChange={(e) => onChange({ ...slot, custo_terceirizados_previsto: Number(e.target.value) || 0 })} /></div>
        <RO label="Custo total" value={brl(custoTotal)} />
        <RO label="Preço sugerido" value={brl(pi.sugerido)} />
        <div className="col-span-2"><div className="text-[10px] text-muted-foreground">Preço p/ venda</div>
          <NumberInput className="h-7 w-full text-right" value={slot.preco_venda ?? 0} onChange={(e) => onChange({ ...slot, preco_venda: Number(e.target.value) || 0 })} /></div>
      </div>
    </div>
  );
}
