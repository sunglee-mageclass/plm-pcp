import type { PtArvore } from "@/lib/plan-tecido/types";
import { necessidadePorTecido, custoMateriaisPrevisto } from "@/lib/plan-tecido/calc";
import { precoInfo } from "@/lib/preco";
import { brl } from "@/lib/format";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";

function NecBlock({ titulo, nec }: { titulo: string; nec: ReturnType<typeof necessidadePorTecido> }) {
  const total = nec.reduce((s, t) => s + t.totalMetros, 0);
  return (
    <div className="rounded-lg border">
      <div className="border-b p-2 font-display text-xs font-semibold">{titulo}</div>
      {nec.length === 0 ? (
        <div className="p-2 text-[10px] text-muted-foreground">Nenhum item.</div>
      ) : (
        <>
          {nec.map((t) => (
            <div key={t.artigo_id} className="border-b p-2 text-xs">
              <div className="mb-1 font-medium">
                {t.artigo_nome}{t.unidade_medida === "kg" ? <span className="ml-1 text-muted-foreground">kg no pedido</span> : null}
              </div>
              {t.variantes.map((v) => (
                <div key={v.variante_tecido_id} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1">
                    <VarianteSwatch nome={v.cor_nome ?? v.label} />
                    <span className="truncate">{v.label || "—"}</span>
                  </span>
                  <b className="shrink-0">{v.metros.toFixed(0)} m</b>
                </div>
              ))}
            </div>
          ))}
          <div className="flex justify-between p-2 font-display text-xs font-semibold">
            <span>Total</span><span>{total.toFixed(0)} m</span>
          </div>
        </>
      )}
    </div>
  );
}

export function ResumoPanel({ arvore }: { arvore: PtArvore }) {
  const necComprar = necessidadePorTecido(arvore, (s) => !(s.usar_estoque ?? false));
  const necEstoque = necessidadePorTecido(arvore, (s) => !!(s.usar_estoque ?? false));
  const temEstoque = necEstoque.some((t) => t.totalMetros > 0);

  // poder de venda previsto = Σ (preço efetivo × grade_total) por slot
  let pv = 0;
  for (const sub of arvore.subcolecoes) for (const ln of sub.linhas) for (const slot of ln.slots) {
    const tec1 = slot.materiais.find((m) => m.tipo === "tecido" && m.numero === 1);
    const grade = (tec1?.variantes ?? []).reduce((s, v) => s + (v.grade_total || 0), 0);
    const custo = custoMateriaisPrevisto(slot) + (Number(slot.custo_terceirizados_previsto) || 0);
    pv += precoInfo(custo, 0, slot.preco_venda ?? null).efetivo * grade;
  }

  return (
    <div className="space-y-2">
      <NecBlock titulo="A comprar (encomenda)" nec={necComprar} />
      {temEstoque && <NecBlock titulo="Usar do estoque" nec={necEstoque} />}
      <div className="rounded-lg border">
        <div className="border-b p-2 font-display text-xs font-semibold">Poder de venda (previsto)</div>
        <div className="flex justify-between p-2 text-xs"><span>Σ preço × grade</span><b>{brl(pv)}</b></div>
      </div>
    </div>
  );
}
