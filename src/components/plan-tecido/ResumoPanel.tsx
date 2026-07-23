import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PtArvore } from "@/lib/plan-tecido/types";
import { necessidadePorTecido, custoMateriaisPrevisto } from "@/lib/plan-tecido/calc";
import { precoInfo } from "@/lib/preco";
import { brl } from "@/lib/format";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { PaletaColecao } from "./PaletaColecao";

type EstoqueRow = { variante_tecido_id: string; fisico: number; a_receber: number; reservado: number; previsto: number };
type EstoqueMap = Record<string, EstoqueRow>;
type CoberturaMap = Record<string, number>; // variante → coberto_m (informativo)
type OcDetalhe = { numero_pedido: string | null; coberto_m: number };
type CoberturaOcMap = Record<string, OcDetalhe[]>; // variante → [{OC, metros}]

function NecBlock({
  titulo,
  nec,
  estoque,
  cobertura,
  coberturaOcs,
}: {
  titulo: string;
  nec: ReturnType<typeof necessidadePorTecido>;
  estoque?: EstoqueMap; // quando presente, mostra a conta (estoque / a receber / falta)
  cobertura?: CoberturaMap; // "coberto por estas OCs" (só informativo — não muda a falta)
  coberturaOcs?: CoberturaOcMap; // detalhe: de qual OC vem a cobertura (#1)
}) {
  const totalNec = nec.reduce((s, t) => s + t.totalMetros, 0);
  // conta agregada (informativa; o "a comprar" = necessidade cheia = totalNec, mostrado como "Total")
  let totalReceber = 0, totalCoberto = 0;
  if (estoque) {
    for (const t of nec) for (const v of t.variantes) {
      const e = estoque[v.variante_tecido_id];
      totalReceber += e?.a_receber ?? 0;
      if (cobertura) totalCoberto += Math.min(v.metros, cobertura[v.variante_tecido_id] ?? 0);
    }
  }
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
              {t.variantes.map((v) => {
                const e = estoque?.[v.variante_tecido_id];
                return (
                  <div key={v.variante_tecido_id} className="mb-1 last:mb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1">
                        <VarianteSwatch nome={v.cor_nome ?? v.label} />
                        <span className="truncate">{v.label || "—"}</span>
                      </span>
                      <b className="shrink-0">{v.metros.toFixed(0)} m</b>
                    </div>
                    {estoque && (
                      <div className="flex flex-wrap gap-x-2 pl-4 text-[10px] text-muted-foreground">
                        <span>estoque {(e?.fisico ?? 0).toFixed(0)} m</span>
                        <span>a receber {(e?.a_receber ?? 0).toFixed(0)} m</span>
                        {cobertura && (cobertura[v.variante_tecido_id] ?? 0) > 0 && (
                          <span className="text-sky-700">coberto por OC {(cobertura[v.variante_tecido_id] ?? 0).toFixed(0)} m</span>
                        )}
                      </div>
                    )}
                    {coberturaOcs && (coberturaOcs[v.variante_tecido_id]?.length ?? 0) > 0 && (
                      <div className="pl-4 text-[10px] text-sky-700/80">
                        {coberturaOcs[v.variante_tecido_id].map((o, i) => (
                          <span key={i}>{i > 0 ? " · " : ""}{o.numero_pedido || "OC"}: {o.coberto_m.toFixed(0)} m</span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="space-y-0.5 p-2 font-display text-xs font-semibold">
            <div className="flex justify-between"><span>Total</span><span>{totalNec.toFixed(0)} m</span></div>
            {estoque && (
              <>
                <div className="flex justify-between font-normal text-muted-foreground"><span>Já encomendado (a receber)</span><span>{totalReceber.toFixed(0)} m</span></div>
                {cobertura && totalCoberto > 0 && (
                  <div className="flex justify-between font-normal text-sky-700"><span>Coberto por OCs aplicadas</span><span>{totalCoberto.toFixed(0)} m</span></div>
                )}
              </>
            )}
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

  // variantes do bloco "a comprar" → busca a conta de estoque (físico/a receber/reservado/previsto)
  const varIds = [...new Set(necComprar.flatMap((t) => t.variantes.map((v) => v.variante_tecido_id)))].sort();
  const { data: estoqueMap = {} } = useQuery({
    queryKey: ["plan-tecido-estoque", varIds],
    enabled: varIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.rpc("plan_tecido_estoque" as any, { _variante_ids: varIds });
      const map: EstoqueMap = {};
      for (const r of (data ?? []) as EstoqueRow[]) map[r.variante_tecido_id] = r;
      return map;
    },
  });

  // "coberto por estas OCs" (Fase C, atribuição) — informativo, não altera a falta
  const { data: coberturaMap = {} } = useQuery({
    queryKey: ["plan-tecido-cobertura", arvore.colecao_id],
    enabled: !!arvore.colecao_id,
    queryFn: async () => {
      const { data } = await supabase.rpc("plan_tecido_cobertura" as any, { _colecao_id: arvore.colecao_id });
      const map: CoberturaMap = {};
      for (const r of (data ?? []) as { variante_tecido_id: string; coberto_m: number }[]) map[r.variante_tecido_id] = Number(r.coberto_m) || 0;
      return map;
    },
  });

  // detalhe: de qual OC vem a cobertura (#1)
  const { data: coberturaOcsMap = {} } = useQuery({
    queryKey: ["plan-tecido-cobertura-ocs", arvore.colecao_id],
    enabled: !!arvore.colecao_id,
    queryFn: async () => {
      const { data } = await supabase.rpc("plan_tecido_cobertura_ocs" as any, { _colecao_id: arvore.colecao_id });
      const map: CoberturaOcMap = {};
      for (const r of (data ?? []) as { variante_tecido_id: string; numero_pedido: string | null; coberto_m: number }[]) {
        (map[r.variante_tecido_id] ??= []).push({ numero_pedido: r.numero_pedido, coberto_m: Number(r.coberto_m) || 0 });
      }
      return map;
    },
  });

  // markup por linha (linhas.markup) — p/ o preço sugerido no efetivo
  const { data: markupMap = {} } = useQuery({
    queryKey: ["plan-tecido-linhas-markup"],
    queryFn: async () => {
      const rows = ((await supabase.from("linhas").select("id, markup")).data ?? []) as { id: string; markup: number | null }[];
      return Object.fromEntries(rows.map((r) => [r.id, Number(r.markup) || 0])) as Record<string, number>;
    },
  });

  // poder de venda previsto = Σ (preço efetivo × grade_total) por slot
  // efetivo = preço p/ venda (se houver) OU preço sugerido (custo × markup da linha, arredondado)
  let pv = 0;
  for (const sub of arvore.subcolecoes) for (const ln of sub.linhas) for (const slot of ln.slots) {
    const tec1 = slot.materiais.find((m) => m.tipo === "tecido" && m.numero === 1);
    const grade = (tec1?.variantes ?? []).reduce((s, v) => s + (v.grade_total || 0), 0);
    const cs = (slot.custo_simulado ?? {}) as { materiais?: number };
    const custo = custoMateriaisPrevisto(slot) + (Number(cs.materiais) || 0) + (Number(slot.custo_terceirizados_previsto) || 0);
    const markup = slot.linha_id ? (markupMap[slot.linha_id] ?? 0) : 0;
    pv += precoInfo(custo, markup, slot.preco_venda ?? null).efetivo * grade;
  }

  return (
    <div className="space-y-2">
      {arvore.colecao_id && <PaletaColecao colecaoId={arvore.colecao_id} />}
      <NecBlock
        titulo="A comprar (encomenda)"
        nec={necComprar}
        estoque={estoqueMap}
        cobertura={coberturaMap}
        coberturaOcs={coberturaOcsMap}
      />
      {temEstoque && <NecBlock titulo="Usar do estoque" nec={necEstoque} />}
      <div className="rounded-lg border">
        <div className="border-b p-2 font-display text-xs font-semibold">Poder de venda (previsto)</div>
        <div className="flex justify-between p-2 text-xs"><span>Σ preço × grade</span><b>{brl(pv)}</b></div>
      </div>
    </div>
  );
}
