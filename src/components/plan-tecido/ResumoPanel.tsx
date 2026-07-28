import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";
import { necessidadePorTecido, custoMateriaisPrevisto } from "@/lib/plan-tecido/calc";
import { precoInfo } from "@/lib/preco";
import { brl } from "@/lib/format";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { Lock } from "lucide-react";

type SituacaoRow = { variante_tecido_id: string; pedida_m: number; recebida_m: number };
type SituacaoMap = Record<string, SituacaoRow>;

/** Bloco "A comprar" simples (usado por "Usar do estoque"): só necessidade por tecido/variante. */
function NecBlock({ titulo, nec }: { titulo: string; nec: ReturnType<typeof necessidadePorTecido> }) {
  const totalNec = nec.reduce((s, t) => s + t.totalMetros, 0);
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
                <div key={v.variante_tecido_id} className="mb-1 flex items-center justify-between gap-2 last:mb-0">
                  <span className="flex min-w-0 items-center gap-1">
                    <VarianteSwatch nome={v.cor_nome ?? v.label} />
                    <span className="truncate">{v.label || "—"}</span>
                  </span>
                  <b className="shrink-0">{v.metros.toFixed(0)} m</b>
                </div>
              ))}
            </div>
          ))}
          <div className="p-2 font-display text-xs font-semibold">
            <div className="flex justify-between"><span>Total</span><span>{totalNec.toFixed(0)} m</span></div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Situação do tecido — COLEÇÃO inteira (OC é coleção-scoped, não subcoleção).
 * Por tecido→variante: reservada (necessidade do plano, cresce conforme os cards / reflete o CAD),
 * pedida e recebida (Σ das OCs desta coleção) e SOBRA PREVISTA = pedida − reservada.
 * A sobra pode ser NEGATIVA (ainda planejando: reservou mais do que pediu → falta pedir).
 */
function SituacaoBlock({ nec, situ }: { nec: ReturnType<typeof necessidadePorTecido>; situ: SituacaoMap }) {
  let tReserv = 0, tPed = 0, tReceb = 0;
  for (const t of nec) for (const v of t.variantes) {
    tReserv += v.metros;
    tPed += situ[v.variante_tecido_id]?.pedida_m ?? 0;
    tReceb += situ[v.variante_tecido_id]?.recebida_m ?? 0;
  }
  const tSobra = tPed - tReserv;
  const sobraCls = (s: number) => (s < 0 ? "text-red-600" : "text-emerald-600");
  const sinal = (s: number) => (s > 0 ? "+" : "") + s.toFixed(0);
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between border-b p-2">
        <span className="font-display text-xs font-semibold">Situação do tecido</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">coleção</span>
      </div>
      {nec.length === 0 ? (
        <div className="p-2 text-[10px] text-muted-foreground">Nenhum tecido a encomendar.</div>
      ) : (
        <>
          {nec.map((t) => (
            <div key={t.artigo_id} className="border-b p-2 text-xs">
              <div className="mb-1 font-medium">
                {t.artigo_nome}{t.unidade_medida === "kg" ? <span className="ml-1 text-muted-foreground">kg no pedido</span> : null}
              </div>
              {t.variantes.map((v) => {
                const s = situ[v.variante_tecido_id];
                const pedida = s?.pedida_m ?? 0;
                const recebida = s?.recebida_m ?? 0;
                const sobra = pedida - v.metros;
                return (
                  <div key={v.variante_tecido_id} className="mb-1.5 last:mb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1">
                        <VarianteSwatch nome={v.cor_nome ?? v.label} />
                        <span className="truncate">{v.label || "—"}</span>
                      </span>
                      <b className={`shrink-0 ${sobraCls(sobra)}`}>{sinal(sobra)} m</b>
                    </div>
                    <div className="flex flex-wrap gap-x-2 pl-4 text-[10px] text-muted-foreground">
                      <span>reservada {v.metros.toFixed(0)}</span>
                      <span>pedida {pedida.toFixed(0)}</span>
                      <span>recebida {recebida.toFixed(0)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          <div className="space-y-0.5 p-2 text-xs">
            <div className="flex justify-between text-muted-foreground"><span>Reservada (plano)</span><span>{tReserv.toFixed(0)} m</span></div>
            <div className="flex justify-between text-muted-foreground"><span>Pedida · recebida</span><span>{tPed.toFixed(0)} · {tReceb.toFixed(0)} m</span></div>
            <div className={`flex justify-between font-display font-semibold ${sobraCls(tSobra)}`}><span>Sobra prevista</span><span>{sinal(tSobra)} m</span></div>
          </div>
        </>
      )}
    </div>
  );
}

export function ResumoPanel({ arvore, colecaoArvore, colecaoId }: { arvore: PtArvore; colecaoArvore: PtArvore; colecaoId: string }) {
  const slots = arvore.subcolecoes.flatMap((sub) => sub.linhas.flatMap((ln) => ln.slots));
  const firstTec = (slot: PtSlot) => slot.materiais.find((m) => m.tipo === "tecido");

  const necEstoque = necessidadePorTecido(arvore, (s) => !!(s.usar_estoque ?? false));
  const temEstoque = necEstoque.some((t) => t.totalMetros > 0);

  // Situação do tecido — COLEÇÃO inteira (reservada = nec do plano; encomenda apenas)
  const necColecao = necessidadePorTecido(colecaoArvore, (s) => !(s.usar_estoque ?? false));
  const { data: situMap = {} } = useQuery({
    queryKey: ["plan-tecido-situacao-ocs", colecaoId],
    queryFn: async () => {
      const { data } = await supabase.rpc("plan_tecido_situacao_ocs" as any, { _colecao_id: colecaoId });
      const map: SituacaoMap = {};
      for (const r of (data ?? []) as SituacaoRow[]) map[r.variante_tecido_id] = { variante_tecido_id: r.variante_tecido_id, pedida_m: Number(r.pedida_m) || 0, recebida_m: Number(r.recebida_m) || 0 };
      return map;
    },
  });

  // quais artigos (tecidos) têm FORNECEDOR (artigos.empresa_id) — base do gating por fornecedor
  const artigoIds = [...new Set(slots.flatMap((s) => s.materiais).map((m) => m.artigo_id).filter((x): x is string => !!x))].sort();
  const { data: fornecSet = new Set<string>() } = useQuery({
    queryKey: ["plan-tecido-artigo-fornecedor", artigoIds],
    enabled: artigoIds.length > 0,
    queryFn: async () => {
      const rows = ((await supabase.from("artigos").select("id, empresa_id").in("id", artigoIds)).data ?? []) as { id: string; empresa_id: string | null }[];
      return new Set(rows.filter((r) => r.empresa_id).map((r) => r.id));
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

  // Pendências (computáveis a partir da árvore + fornecedor)
  const semCategoria = slots.filter((s) => !s.categoria_tecido_id).length;
  const semTecido = slots.filter((s) => !s.materiais.some((m) => m.tipo === "tecido" && m.artigo_id)).length;
  const semFornecedor = slots.filter((s) => { const t = firstTec(s); return !!t?.artigo_id && !fornecSet.has(t.artigo_id); }).length;
  const pendenciasRaw: [number, string][] = [
    [semCategoria, "sem categoria de tecido"],
    [semTecido, "sem tecido escolhido"],
    [semFornecedor, "tecido sem fornecedor"],
  ];
  const pendencias = pendenciasRaw.filter(([n]) => n > 0);

  // Poder de venda GATED por fornecedor: só conta o realizado (tecido com fornecedor)
  const comFornec = (slot: PtSlot) => { const t = firstTec(slot); return !!t?.artigo_id && fornecSet.has(t.artigo_id); };
  let pv = 0; let nComFornec = 0;
  for (const slot of slots) {
    if (!comFornec(slot)) continue;
    nComFornec++;
    const tec1 = firstTec(slot);
    const grade = (tec1?.variantes ?? []).reduce((s, v) => s + (v.grade_total || 0), 0);
    const cs = (slot.custo_simulado ?? {}) as { materiais?: number };
    const custo = custoMateriaisPrevisto(slot) + (Number(cs.materiais) || 0) + (Number(slot.custo_terceirizados_previsto) || 0);
    const markup = slot.linha_id ? (markupMap[slot.linha_id] ?? 0) : 0;
    pv += precoInfo(custo, markup, slot.preco_venda ?? null).efetivo * grade;
  }

  return (
    <div className="space-y-2">
      {/* Pendências */}
      <div className="rounded-lg border">
        <div className="border-b p-2 font-display text-xs font-semibold">Pendências p/ planejamento</div>
        {pendencias.length ? pendencias.map(([n, l]) => (
          <div key={l} className="flex items-center justify-between gap-2 border-b px-2 py-1 text-xs last:border-b-0">
            <span className="flex items-center gap-2 text-muted-foreground"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />{l}</span>
            <b>{n}</b>
          </div>
        )) : (
          <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Sem pendências</div>
        )}
      </div>
      <SituacaoBlock nec={necColecao} situ={situMap} />
      {temEstoque && <NecBlock titulo="Usar do estoque" nec={necEstoque} />}
      {/* Poder de venda — gated por fornecedor */}
      <div className="rounded-lg border">
        <div className="border-b p-2 font-display text-xs font-semibold">Poder de venda (previsto)</div>
        {nComFornec > 0 ? (
          <div className="p-2">
            <div className="flex justify-between text-xs"><span>Σ preço × grade</span><b>{brl(pv)}</b></div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">{nComFornec} de {slots.length} modelos com fornecedor</div>
          </div>
        ) : (
          <div className="flex items-start gap-1.5 p-2 text-[11px] text-amber-700">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />Preço e poder de venda aparecem quando um tecido tiver fornecedor.
          </div>
        )}
      </div>
    </div>
  );
}
