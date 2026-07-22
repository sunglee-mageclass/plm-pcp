import type { PtArvore } from "@/lib/plan-tecido/types";
import { necessidadePorTecido } from "@/lib/plan-tecido/calc";

export function ResumoPanel({ arvore }: { arvore: PtArvore }) {
  const nec = necessidadePorTecido(arvore);
  const total = nec.reduce((s, t) => s + t.totalMetros, 0);
  return (
    <div className="rounded-lg border">
      <div className="border-b p-2 font-display text-sm font-semibold">Necessidade de tecido (m)</div>
      {nec.map((t) => (
        <div key={t.artigo_id} className="border-b p-2 text-xs">
          <div className="mb-1 font-medium">{t.artigo_nome}</div>
          {t.variantes.map((v) => (<div key={v.variante_tecido_id} className="flex justify-between"><span>{v.label}</span><b>{v.metros.toFixed(0)} m</b></div>))}
        </div>
      ))}
      <div className="flex justify-between p-2 font-display text-sm font-semibold"><span>Total</span><span>{total.toFixed(0)} m</span></div>
    </div>
  );
}
