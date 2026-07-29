import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";
import { custoMateriaisPrevisto, slotMetros } from "@/lib/plan-tecido/calc";
import { useSituacaoOcs, agruparPorOc } from "@/lib/plan-tecido/useSituacaoOcs";
import { precoInfo } from "@/lib/preco";
import { brl } from "@/lib/format";
import { Lock, ChevronDown, ChevronRight, ShoppingCart } from "lucide-react";
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

/** Bloco colapsável do Resumo (o dono quer recolher cada seção). Estado próprio por bloco. */
function Secao({ title, right, defaultOpen = true, children }: { title: string; right?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border">
      <div className="flex items-center border-b p-2 font-display text-xs font-semibold">
        <button type="button" onClick={() => setOpen((o) => !o)} className="mr-1 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" title={open ? "Recolher" : "Expandir"}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <span className="flex-1">{title}</span>
        {right}
      </div>
      {open && children}
    </div>
  );
}

export function ResumoPanel({
  arvore, colecaoArvore, colecaoId, slotOcMap, vinculoOcMap = {}, enviadoCadSet, catTecidoNome, onDetalhar,
}: {
  arvore: PtArvore;
  colecaoArvore: PtArvore;
  colecaoId: string;
  slotOcMap: Record<string, string[]>;
  /** OC REAL vinculada no Desenvolvimento por modelo_id (modelo_tecido_oc_links). Fonte da verdade:
   * quando o modelo tem vínculo no Dev, ele vence o hint do plano (que o Dev não atualiza). */
  vinculoOcMap?: Record<string, string[]>;
  /** modelos já ENVIADOS À EXPLOSÃO (enviado_cad) — p/ a "Usada" comprometida (laranja) AO VIVO. */
  enviadoCadSet?: Set<string>;
  catTecidoNome: (id: string) => string | null | undefined;
  onDetalhar: (kind: "comprar" | "oc" | "ocnum", arg?: string) => void;
}) {
  const slots = arvore.subcolecoes.flatMap((sub) => sub.linhas.flatMap((ln) => ln.slots));
  const firstTec = (slot: PtSlot) => slot.materiais.find((m) => m.tipo === "tecido");
  // categorias = declaradas + as AUTO presentes nos slots (categorização automática) — senão a
  // "A comprar" por categoria some com card auto-categorizado fora de categorias_tecido.
  const catsSub = [...new Set<string>([
    ...(arvore.subcolecoes[0]?.categorias_tecido ?? []),
    ...arvore.subcolecoes.flatMap((s) => s.linhas.flatMap((l) => l.slots)).map((s) => s.categoria_tecido_id).filter((c): c is string => !!c),
  ])];

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
  // PEDIDO (o que já foi encomendado) por categoria de tecido, p/ o dono comparar com o necessário
  // (a seção mostrava só a NECESSIDADE, então seguia "900m a comprar" mesmo após o pedido).
  const catDeArtigo = new Map<string, string>();
  for (const s of slots) { if (!s.categoria_tecido_id) continue; for (const m of s.materiais) if (m.tipo === "tecido" && m.artigo_id) catDeArtigo.set(m.artigo_id, s.categoria_tecido_id); }
  const pedidoPorCat = new Map<string, number>();
  for (const r of situacao) { const cid = catDeArtigo.get(r.artigo_id); if (cid) pedidoPorCat.set(cid, (pedidoPorCat.get(cid) ?? 0) + r.pedida_m); }
  const pedidoCat = (cid: string | null) => (cid ? pedidoPorCat.get(cid) ?? 0 : 0);
  const totPedido = [...pedidoPorCat.values()].reduce((a, b) => a + b, 0);

  // ---- Situação da OC por OC: reservada AO VIVO (demanda dos cards atribuídos, coleção toda) ----
  // OC EFETIVA do slot: o VÍNCULO real do Desenvolvimento (modelo_tecido_oc_links, via vinculoOcMap)
  // vence o hint do plano (slotOcMap) — senão, ao trocar a OC direto no Dev, a Reservada/Sobra ficava
  // defasada (o Dev não atualiza plan_tecido_slot_oc). Slot ainda sem vínculo usa o hint do plano.
  const reservPorOc = new Map<string, number>();
  const nPorOc = new Map<string, number>();
  // COMPROMETIDA (laranja) AO VIVO: reservada dos cards JÁ enviados à explosão (enviado_cad). Computado
  // no front (não pela RPC) p/ atualizar na hora ao enviar ao CAD e usar a MESMA OC efetiva da reservada.
  const comprometidoPorOc = new Map<string, number>();
  for (const sub of colecaoArvore.subcolecoes) for (const ln of sub.linhas) for (const slot of ln.slots) {
    if (!slot.id) continue;
    const devOc = slot.modelo_id ? (vinculoOcMap[slot.modelo_id] ?? []) : [];
    const ocIds = devOc.length ? devOc : (slotOcMap[slot.id] ?? []);
    if (!ocIds.length) continue;
    const m = slotMetros(slot);
    const enviado = !!slot.modelo_id && !!enviadoCadSet?.has(slot.modelo_id);
    for (const ocId of ocIds) {
      reservPorOc.set(ocId, (reservPorOc.get(ocId) ?? 0) + m); nPorOc.set(ocId, (nPorOc.get(ocId) ?? 0) + 1);
      if (enviado) comprometidoPorOc.set(ocId, (comprometidoPorOc.get(ocId) ?? 0) + m);
    }
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
      <Secao title="Pendências p/ planejamento">
        {pend.length ? pend.map(([n, l]) => (
          <div key={l} className="flex items-center justify-between gap-2 border-b px-2 py-1 text-xs last:border-b-0">
            <span className="flex items-center gap-2 text-muted-foreground"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot("a")}`} />{l}</span>
            <b>{n}</b>
          </div>
        )) : (
          <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${dot("g")}`} />Sem pendências</div>
        )}
      </Secao>

      {/* A comprar (encomenda) — por categoria. Mostra NECESSÁRIO e PEDIDO (o que já foi encomendado),
          pra não parecer que ainda há "900m a comprar" depois do pedido. Verde = pedido cobre. */}
      <Secao title="A comprar (encomenda)" right={<Detalhar onClick={() => onDetalhar("comprar")} />}>
        {catsSub.length === 0 && semCatMetros === 0 ? (
          <div className="p-2 text-[10px] text-muted-foreground">Nenhuma categoria ainda.</div>
        ) : (
          <>
            {catsSub.map((cid) => {
              const nec = catTecMetros(cid); const ped = pedidoCat(cid);
              return (
                <div key={cid} className="border-b px-2 py-1 text-xs">
                  <div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot(catStatus(cid))}`} /><span className="truncate">{catTecidoNome(cid) ?? "?"}</span></div>
                  <div className="mt-0.5 flex gap-4 pl-3.5 text-[11px] tabular-nums text-muted-foreground">
                    <span>nec. <b className="text-foreground">{nMet(nec)}</b> m</span>
                    <span className={ped >= nec && nec > 0 ? "text-emerald-600" : ""}>ped. <b>{nMet(ped)}</b> m</span>
                  </div>
                </div>
              );
            })}
            {semCatMetros > 0 && (
              <div className="border-b px-2 py-1 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot("n")}`} />Sem categoria</div>
                <div className="mt-0.5 flex gap-4 pl-3.5 text-[11px] tabular-nums text-muted-foreground"><span>nec. <b className="text-foreground">{nMet(semCatMetros)}</b> m</span><span>ped. <b>{nMet(pedidoCat(null))}</b> m</span></div>
              </div>
            )}
            <div className="flex items-center gap-4 px-2 py-1 text-[11px] text-muted-foreground">
              <span>Forros (dentro dos modelos)</span><span className="tabular-nums">{nMet(totForro)} m</span>
            </div>
            <div className="border-t px-2 py-1.5 font-display text-xs font-semibold">
              <div>Total</div>
              <div className="mt-0.5 flex gap-4 pl-0 text-[11px] tabular-nums font-normal text-muted-foreground">
                <span>nec. <b className="text-foreground">{nMet(totTec + totForro)}</b> m</span>
                <span className={totPedido >= totTec && totTec > 0 ? "text-emerald-600" : ""}>ped. <b>{nMet(totPedido)}</b> m</span>
              </div>
            </div>
          </>
        )}
      </Secao>

      {/* Poder de venda — gated por fornecedor */}
      <Secao title="Poder de venda (previsto)">
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
      </Secao>

      {/* OCs vinculadas */}
      <Secao title="OCs vinculadas">
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
      </Secao>

      {/* Situação da OC — por OC */}
      <Secao title="Situação da OC — por OC" right={<Detalhar onClick={() => onDetalhar("oc")} />}>
        {ocs.length ? ocs.map((o) => {
          const reservada = reservPorOc.get(o.oc_tecido_id) ?? 0;
          const comprometido = comprometidoPorOc.get(o.oc_tecido_id) ?? 0; // enviado à explosão (laranja)
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
                <span className={o.usada > 0 ? "font-medium text-red-600" : comprometido > 0 ? "font-medium text-amber-600" : ""}
                      title={o.usada > 0 ? "Baixa real (corte enviado)" : comprometido > 0 ? "Comprometido — enviado à explosão" : undefined}>
                  {(o.usada > 0 ? nMet(o.usada) : comprometido > 0 ? nMet(comprometido) : nMet(0))} m
                </span>
              </div>
              <div className={`mt-0.5 flex justify-between border-t pt-0.5 font-display font-semibold ${sobraCls(sobra)}`}><span>Sobra prevista</span><span>{sobra > 0 ? "+" : ""}{nMet(sobra)} m</span></div>
            </div>
          );
        }) : (
          <div className="p-2 text-[10px] text-muted-foreground">Sem OC ainda — gere um pedido ou vincule uma OC existente.</div>
        )}
        <div className="p-2 text-[9px] leading-tight text-muted-foreground">Reservada = demanda dos cards atribuídos à OC (ao vivo). Entregue/Usada vêm da OC. Sobra prevista = Pedida − Reservada (pode ser negativa).</div>
      </Secao>
    </div>
  );
}
