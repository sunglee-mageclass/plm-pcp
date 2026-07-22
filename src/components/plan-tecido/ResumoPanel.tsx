import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { PtArvore } from "@/lib/plan-tecido/types";
import { necessidadePorTecido } from "@/lib/plan-tecido/calc";
import { precoInfo } from "@/lib/preco";
import { brl } from "@/lib/format";

export function ResumoPanel({ arvore }: { arvore: PtArvore }) {
  const [usarEstoque, setUsarEstoque] = useState(false);
  const nec = necessidadePorTecido(arvore);
  const total = nec.reduce((s, t) => s + t.totalMetros, 0);
  // poder de venda previsto = Σ (preço efetivo × grade_total) por slot
  let pv = 0;
  for (const sub of arvore.subcolecoes) for (const ln of sub.linhas) for (const slot of ln.slots) {
    const tec1 = slot.materiais.find((m) => m.tipo === "tecido" && m.numero === 1);
    const grade = (tec1?.variantes ?? []).reduce((s, v) => s + (v.grade_total || 0), 0);
    const cs = (slot.custo_simulado ?? {}) as { materiais?: number };
    const custo = (Number(cs.materiais) || 0) + (Number(slot.custo_terceirizados_previsto) || 0);
    pv += precoInfo(custo, 0, slot.preco_venda ?? null).efetivo * grade;
  }
  return (
    <div className="space-y-2">
      <div className="rounded-lg border">
        <div className="border-b p-2 font-display text-xs font-semibold">Situação de compra</div>
        <div className="p-2 text-xs">
          <label className="flex items-center gap-2"><Checkbox checked={usarEstoque} onCheckedChange={(v) => setUsarEstoque(!!v)} className="h-4 w-4" /> Usar estoque existente</label>
          <p className="mt-1 text-[10px] text-muted-foreground">Padrão: OCs destinadas à coleção → necessidade cheia. (abatimento por estoque: Task futura / Fase B)</p>
        </div>
      </div>
      <div className="rounded-lg border">
        <div className="border-b p-2 font-display text-xs font-semibold">Necessidade de tecido (m)</div>
        {nec.map((t) => (
          <div key={t.artigo_id} className="border-b p-2 text-xs">
            <div className="mb-1 font-medium">{t.artigo_nome}{t.unidade_medida === "kg" ? <span className="ml-1 text-muted-foreground">kg no pedido</span> : null}</div>
            {t.variantes.map((v) => (<div key={v.variante_tecido_id} className="flex justify-between"><span>{v.label}</span><b>{v.metros.toFixed(0)} m</b></div>))}
          </div>
        ))}
        <div className="flex justify-between p-2 font-display text-xs font-semibold"><span>Total</span><span>{total.toFixed(0)} m</span></div>
      </div>
      <div className="rounded-lg border">
        <div className="border-b p-2 font-display text-xs font-semibold">Poder de venda (previsto)</div>
        <div className="flex justify-between p-2 text-xs"><span>Σ preço × grade</span><b>{brl(pv)}</b></div>
      </div>
    </div>
  );
}
