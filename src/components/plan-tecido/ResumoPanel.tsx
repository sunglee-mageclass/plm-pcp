import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";
import { custoMateriaisPrevisto, slotMetros } from "@/lib/plan-tecido/calc";
import { useSituacaoOcs, agruparPorOc } from "@/lib/plan-tecido/useSituacaoOcs";
import { precoInfo } from "@/lib/preco";
import { brl } from "@/lib/format";
import { Lock, ChevronDown, ShoppingCart } from "lucide-react";
import { OcAplicadaPicker } from "@/components/plan-tecido/OcAplicadaPicker";

const nMet = (n: number) => `${Math.round(n)}`;
const dot = (st: "g" | "a" | "n") => (st === "g" ? "bg-emerald-500" : st === "a" ? "bg-amber-500" : "bg-red-400");
const sobraCls = (s: number) => (s < 0 ? "text-red-600" : "text-emerald-600");

function Detalhar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ml-auto flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline">
      detalhar <ChevronDown className="h-3 w-3" />
    </button>
  );
}

export function ResumoPanel({
  arvore, colecaoArvore, colecaoId, slotOcMap, vinculoOcMap = {}, catTecidoNome, onDetalhar,
}: {
  arvore: PtArvore;
  colecaoArvore: PtArvore;
  colecaoId: string;
  slotOcMap: Record<string, string[]>;
  /** OC REAL vinculada no Desenvolvimento por modelo_id (modelo_tecido_oc_links). Fonte da verdade:
   * quando o modelo tem vínculo no Dev, ele vence o hint do plano (que o Dev não atualiza). */
  vinculoOcMap?: Record<string, string[]>;
  catTecidoNome: (id: string) => string | null | undefined;
  onDetalhar: (kind: "comprar" | "oc" | "ocnum", arg?: string) => void;
}) {
  const slots = arvore.subcolecoes.flatMap((sub) => sub.linhas.flatMap((ln) => ln.slots));
  const firstTec = (slot: PtSlot) => slot.materiais.find((m) => m.tipo === "tecido");
  const catsSub = arvore.subcolecoes[0]?.categorias_tecido ?? [];

  const { data: situacao = [] } = useSituacaoOcs(colecaoId);
  const ocs = agruparPorOc(situacao);

  // artigos (tecidos) com FORNECEDOR — base do gating e do status por categoria
  const artigoIds = [...new Set(slots.flatMap((s) => s.materiais).map((m) => m.artigo_id).filter((x): x is string => !!x))].sort();
  const { data: fornecSet = new Set<string>() } = useQuery({
    queryKey: ["plan-tecido-artigo-fornecedor", artigoIds],
    enabled: artigoIds.length > 0,
    queryFn: async () => {
      const rows = ((await supabase.from("artigos").select("id, empresa_id").in("id", artigoIds)).data ?? []) as { id: string; empresa_id: string | null }[];
      return new Set(rows.filter((r) => r.empresa_id).map((r) => r.id));
    },
  });

  const { data: markupMap = {} } = useQuery({
    queryKey: ["plan-tecido-linhas-markup"],
    queryFn: async () => {
      const rows = ((await supabase.from("linhas").select("id, markup")).data ?? []) as { id: string; markup: number | null }[];
      return Object.fromEntries(rows.map((r) => [r.id, Number(r.markup) || 0])) as Record<string, number>;
    },
  });

  // ---- A comprar (encomenda), por CATEGORIA de tecido (subcoleção) ----
  const enc = slots.filter((s) => !(s.usar_estoque ?? false));
  const slotsCat = (cid: string | null) => enc.filter((s) => (s.categoria_tecido_id ?? null) === cid);
  const catTecMetros = (cid: string | null) => slotsCat(cid).reduce((a, s) => a + slotMetros(s, "tecido"), 0);
  const catStatus = (cid: string | null): "g" | "a" | "n" => {
    const ss = slotsCat(cid);
    const comF = ss.filter((s) => { const t = firstTec(s); return !!t?.artigo_id && fornecSet.has(t.artigo_id); });
    return comF.length === 0 ? "n" : comF.length === ss.length ? "g" : "a";
  };
  const totTec = enc.reduce((a, s) => a + slotMetros(s, "tecido"), 0);
  const totForro = enc.reduce((a, s) => a + slotMetros(s, "forro"), 0);
  const semCatMetros = catTecMetros(null);

  // ---- Situação da OC por OC: reservada AO VIVO (demanda dos cards atribuídos, coleção toda) ----
  // OC EFETIVA do slot: o VÍNCULO real do Desenvolvimento (modelo_tecido_oc_links, via vinculoOcMap)
  // vence o hint do plano (slotOcMap) — senão, ao trocar a OC direto no Dev, a Reservada/Sobra ficava
  // defasada (o Dev não atualiza plan_tecido_slot_oc). Slot ainda sem vínculo usa o hint do plano.
  const reservPorOc = new Map<string, number>();
  const nPorOc = new Map<string, number>();
  for (const sub of colecaoArvore.subcolecoes) for (const ln of sub.linhas) for (const slot of ln.slots) {
    if (!slot.id) continue;
    const devOc = slot.modelo_id ? (vinculoOcMap[slot.modelo_id] ?? []) : [];
    const ocIds = devOc.length ? devOc : (slotOcMap[slot.id] ?? []);
    if (!ocIds.length) continue;
    const m = slotMetros(slot);
    for (const ocId of ocIds) { reservPorOc.set(ocId, (reservPorOc.get(ocId) ?? 0) + m); nPorOc.set(ocId, (nPorOc.get(ocId) ?? 0) + 1); }
  }

  // ---- Pendências (subcoleção) ----
  const semCategoria = slots.filter((s) => !s.categoria_tecido_id).length;
  const semTecFornec = slots.filter((s) => { const t = firstTec(s); return !t?.artigo_id || !fornecSet.has(t.artigo_id); }).length;
  const semCard = slots.filter((s) => !s.modelo_id).length;
  const pendAll: [number, string][] = [
    [semCategoria, "sem categoria de tecido"],
    [semTecFornec, "sem tecido / fornecedor"],
    [semCard, "sem card no Planejamento"],
  ];
  const pend = pendAll.filter(([n]) => n > 0);

  // ---- Poder de venda (subcoleção), gated por fornecedor ----
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
        {pend.length ? pend.map(([n, l]) => (
          <div key={l} className="flex items-center justify-between gap-2 border-b px-2 py-1 text-xs last:border-b-0">
            <span className="flex items-center gap-2 text-muted-foreground"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot("a")}`} />{l}</span>
            <b>{n}</b>
          </div>
        )) : (
          <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${dot("g")}`} />Sem pendências</div>
        )}
      </div>

      {/* A comprar (encomenda) — por categoria */}
      <div className="rounded-lg border">
        <div className="flex items-center border-b p-2 font-display text-xs font-semibold">A comprar (encomenda)<Detalhar onClick={() => onDetalhar("comprar")} /></div>
        {catsSub.length === 0 && semCatMetros === 0 ? (
          <div className="p-2 text-[10px] text-muted-foreground">Nenhuma categoria ainda.</div>
        ) : (
          <>
            {catsSub.map((cid) => (
              <div key={cid} className="flex items-center justify-between gap-2 border-b px-2 py-1 text-xs">
                <span className="flex min-w-0 items-center gap-2"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot(catStatus(cid))}`} /><span className="truncate">{catTecidoNome(cid) ?? "?"}</span></span>
                <b className="shrink-0">{nMet(catTecMetros(cid))} m</b>
              </div>
            ))}
            {semCatMetros > 0 && (
              <div className="flex items-center justify-between gap-2 border-b px-2 py-1 text-xs">
                <span className="flex items-center gap-2 text-muted-foreground"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot("n")}`} />Sem categoria</span>
                <b>{nMet(semCatMetros)} m</b>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 px-2 py-1 text-[11px] text-muted-foreground">
              <span>Forros (dentro dos modelos)</span><span>{nMet(totForro)} m</span>
            </div>
            <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5 font-display text-xs font-semibold"><span>Total</span><span>{nMet(totTec + totForro)} m</span></div>
          </>
        )}
      </div>

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

      {/* OCs vinculadas */}
      <div className="rounded-lg border">
        <div className="border-b p-2 font-display text-xs font-semibold">OCs vinculadas</div>
        {ocs.length ? ocs.map((o) => (
          <button key={o.oc_tecido_id} type="button" onClick={() => onDetalhar("ocnum", o.oc_tecido_id)}
            className="flex w-full items-center gap-2 border-b px-2 py-1.5 text-left text-xs hover:bg-muted/50">
            <ShoppingCart className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="shrink-0 font-medium">{o.numero ?? "OC"}</span>
            <span className="truncate text-muted-foreground">{o.tecidos.join(" · ") || "—"}</span>
          </button>
        )) : (
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground">Nenhuma OC vinculada.</div>
        )}
        <OcAplicadaPicker colecaoId={colecaoId} />
      </div>

      {/* Situação da OC — por OC */}
      <div className="rounded-lg border">
        <div className="flex items-center border-b p-2 font-display text-xs font-semibold">Situação da OC — por OC<Detalhar onClick={() => onDetalhar("oc")} /></div>
        {ocs.length ? ocs.map((o) => {
          const reservada = reservPorOc.get(o.oc_tecido_id) ?? 0;
          const sobra = o.pedida - reservada;
          return (
            <div key={o.oc_tecido_id} className="border-b p-2 text-xs last:border-b-0">
              <div className="mb-0.5 flex items-center gap-2">
                <b>{o.numero ?? "OC"}</b>
                <span className="text-[10px] text-muted-foreground">{nPorOc.get(o.oc_tecido_id) ?? 0} modelo(s)</span>
                <Detalhar onClick={() => onDetalhar("ocnum", o.oc_tecido_id)} />
              </div>
              {o.tecidos.length > 0 && <div className="mb-1 truncate text-[10px] text-muted-foreground" title={o.tecidos.join(" · ")}>{o.tecidos.join(" · ")}</div>}
              <div className="flex justify-between text-muted-foreground"><span>Pedida</span><span>{nMet(o.pedida)} m</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Entregue</span><span>{nMet(o.entregue)} m</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Reservada</span><span>{nMet(reservada)} m</span></div>
              {/* Usada: baixa REAL (vermelho) tem prioridade; senão o comprometido = enviado à
                  explosão (laranja). Cinza quando 0. */}
              <div className="flex justify-between text-muted-foreground">
                <span>Usada</span>
                <span className={o.usada > 0 ? "font-medium text-red-600" : o.comprometida > 0 ? "font-medium text-amber-600" : ""}
                      title={o.usada > 0 ? "Baixa real (corte enviado)" : o.comprometida > 0 ? "Comprometido — enviado à explosão" : undefined}>
                  {(o.usada > 0 ? nMet(o.usada) : o.comprometida > 0 ? nMet(o.comprometida) : nMet(0))} m
                </span>
              </div>
              <div className={`mt-0.5 flex justify-between border-t pt-0.5 font-display font-semibold ${sobraCls(sobra)}`}><span>Sobra prevista</span><span>{sobra > 0 ? "+" : ""}{nMet(sobra)} m</span></div>
            </div>
          );
        }) : (
          <div className="p-2 text-[10px] text-muted-foreground">Sem OC ainda — gere um pedido ou vincule uma OC existente.</div>
        )}
        <div className="p-2 text-[9px] leading-tight text-muted-foreground">Reservada = demanda dos cards atribuídos à OC (ao vivo). Entregue/Usada vêm da OC. Sobra prevista = Pedida − Reservada (pode ser negativa).</div>
      </div>
    </div>
  );
}
