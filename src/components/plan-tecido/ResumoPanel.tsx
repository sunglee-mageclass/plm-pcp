import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";
import { custoMateriaisPrevisto, slotMetros, detalheOc, fmtMetros, contabilizarOc, necessidadePorTecido, rateioDeficitSub, aComprarVivoPorArtigo, necVivoPorVariante } from "@/lib/plan-tecido/calc";
import { useSituacaoOcs, agruparPorOc } from "@/lib/plan-tecido/useSituacaoOcs";
import type { PreviaRpc } from "@/components/plan-tecido/FazerPedidoWizard";
import { precoInfo } from "@/lib/preco";
import { brl } from "@/lib/format";
import { Lock, ChevronDown, ChevronRight, ShoppingCart, X } from "lucide-react";
import { OcAplicadaPicker } from "@/components/plan-tecido/OcAplicadaPicker";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const nMet = fmtMetros;
const dot = (st: "g" | "a" | "n") => (st === "g" ? "bg-emerald-500" : st === "a" ? "bg-amber-500" : "bg-red-400");
const sobraCls = (s: number) => (s < 0 ? "text-red-600" : "text-emerald-700");

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
        {/* título DENTRO do botão: expandir/recolher clicando no nome também (dono ago/2026) */}
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-1 rounded p-0.5 text-left hover:bg-muted" title={open ? "Recolher" : "Expandir"}>
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </button>
        {right}
      </div>
      {open && children}
    </div>
  );
}

/** Grupo POR TECIDO dentro de "Situação da OC — por OC" (dono ago/2026, mesmo idioma de accordion
 *  do "por nome" do canvas — chevron + rótulo). Diferenças de propósito: (1) o HEADER INTEIRO é
 *  clicável (não só o ícone) com `min-h-11` (44px) — toque confortável no mobile, onde o chevron
 *  sozinho do canvas é pequeno demais pro dedo; (2) aqui o open/closed é lido por PRESENÇA na Set
 *  de abertos (não de recolhidos) — grupo ausente = fechado por padrão, sem precisar semear nada
 *  (o canvas semeia `lanesRecolhidas` num useEffect pq ele guarda o COLAPSADO; aqui invertemos o
 *  sentido de propósito pra "Set vazio" já significar "tudo recolhido", pedido do dono). */
function GrupoTecidoOc({ tecido, count, open, onToggle, children }: { tecido: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-11 w-full items-center gap-2 px-2 py-2 text-left text-xs font-medium hover:bg-muted/50"
        title={open ? "Recolher" : "Expandir"}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate" title={tecido}>{tecido}</span>
        <span className="shrink-0 rounded-full border px-1.5 text-[10px] font-normal text-muted-foreground">{count} OC{count === 1 ? "" : "s"}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

export function ResumoPanel({
  arvore, colecaoArvore, colecaoId, slotOcMap, vinculoOcMap = {}, enviadoCadSet, catTecidoNome, onDetalhar, temRascunho = false,
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
  /** Há edição de rascunho não salva influenciando os números vivos (necessidade/"a comprar")? Só
   *  acende uma indicação leve (ponto âmbar + title) — o valor já é vivo de qualquer forma. */
  temRascunho?: boolean;
}) {
  const slots = arvore.subcolecoes.flatMap((sub) => sub.linhas.flatMap((ln) => ln.slots));
  const firstTec = (slot: PtSlot) => slot.materiais.find((m) => m.tipo === "tecido");
  // categorias = declaradas + as AUTO presentes nos slots (categorização automática) — senão a
  // "A comprar" por categoria some com card auto-categorizado fora de categorias_tecido.
  const catsSub = [...new Set<string>([
    ...(arvore.subcolecoes[0]?.categorias_tecido ?? []),
    ...arvore.subcolecoes.flatMap((s) => s.linhas.flatMap((l) => l.slots)).map((s) => s.categoria_tecido_id).filter((c): c is string => !!c),
  ])].sort((a, b) => (catTecidoNome(a) ?? "").localeCompare(catTecidoNome(b) ?? "", "pt-BR", { sensitivity: "base" })); // "A comprar" por categoria em ordem alfabética (dono)

  const { data: situacao = [] } = useSituacaoOcs(colecaoId);
  // OCs (vinculadas + Situação) em ordem ALFABÉTICA pelo tecido (dono, jul/2026); os tecidos de
  // cada OC já vêm ordenados de `agruparPorOc`. Ordena pelo 1º tecido, depois pelo número da OC.
  const cmpPt = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });
  const ocs = agruparPorOc(situacao).sort((a, b) =>
    cmpPt(a.tecidos[0] ?? "￿", b.tecidos[0] ?? "￿") || cmpPt(a.numero ?? "", b.numero ?? ""));
  // "Situação da OC" agrupada POR TECIDO (dono ago/2026): usa o mesmo 1º tecido já usado pra
  // ordenar `ocs` acima — uma OC com vários tecidos entra só no grupo do seu 1º (evita duplicá-la
  // em vários grupos). Map preserva a ordem de inserção → grupos saem na MESMA ordem alfabética
  // de `ocs`, sem precisar re-ordenar.
  const gruposTecidoOcMap = new Map<string, typeof ocs>();
  for (const o of ocs) {
    const tecido = o.tecidos[0] ?? "Sem tecido";
    (gruposTecidoOcMap.get(tecido) ?? gruposTecidoOcMap.set(tecido, []).get(tecido)!).push(o);
  }
  const gruposTecidoOc = [...gruposTecidoOcMap.entries()].map(([tecido, itens]) => ({ tecido, itens }));

  // "A comprar" EXATO = déficit da MESMA conta do "Fazer pedido" (necessidade − cobertura das OCs
  // vinculadas). Lê o plano SALVO no servidor; invalidado no salvar/pedido. (queryKey própria —
  // ninguém mais usa; o botão chama a RPC imperativamente.)
  const { data: previa } = useQuery({
    queryKey: ["plan-tecido-previa", colecaoId],
    refetchOnWindowFocus: true, // estoque/OCs mudam fora do plano → "a comprar" fresco ao voltar
    queryFn: async () => ((await supabase.rpc("plan_tecido_previa_pedido" as any, { _colecao_id: colecaoId })).data ?? null) as PreviaRpc | null,
  });

  // OCs APLICADAS (vinculadas à mão) — só essas dá pra desvincular por-OC aqui (1 clique). As GERADAS
  // pelo "Fazer pedido" são reais e saem no "Desfazer pedido" (global). ⚠️ MESMA queryKey do
  // OcAplicadaPicker → PRECISA do MESMO formato (array de ids), senão o cache compartilhado devolve o
  // shape do outro e `.has()`/`.includes()` quebra (bug de queryKey compartilhada — ver CLAUDE.md).
  const qc = useQueryClient();
  const { data: aplicadas = [] } = useQuery<string[]>({
    queryKey: ["plan-tecido-oc-aplicada", colecaoId],
    queryFn: async () => (((await supabase.from("plan_tecido_oc_aplicada" as any).select("oc_tecido_id").eq("colecao_id", colecaoId)).data ?? []) as unknown as { oc_tecido_id: string }[]).map((r) => r.oc_tecido_id),
  });
  // OCs GERADAS pelo "Fazer pedido" (plan_tecido_ocs). Com a união das 3 fontes na situação
  // (auditoria jul/2026), a lista também traz OCs de vínculo do Dev/atalho do card — o rótulo
  // "gerada" no else-branch mentia pra elas. Distinção honesta: gerada | aplicada | vínculo.
  const { data: geradas = [] } = useQuery<string[]>({
    queryKey: ["plan-tecido-ocs-geradas", colecaoId],
    queryFn: async () => (((await supabase.from("plan_tecido_ocs" as any).select("oc_tecido_id").eq("colecao_id", colecaoId)).data ?? []) as unknown as { oc_tecido_id: string }[]).map((r) => r.oc_tecido_id),
  });
  // Desvincular mexe no "a comprar" da coleção inteira → AlertDialog curto (padrão do sistema
  // p/ ação sensível; laudo jul/2026 — reversível, mas confirmação evita o clique acidental).
  const [desvincularAlvo, setDesvincularAlvo] = useState<{ id: string; numero: string | null } | null>(null);
  // Grupos de "Situação da OC" abertos (por tecido) — ausente da Set = FECHADO. Nasce vazia de
  // propósito: default RECOLHIDO (dono ago/2026), estado só de sessão (sem persistência; cada
  // visita à tela começa com tudo fechado, e tecidos novos entram fechados sem precisar semear).
  const [tecidosAbertos, setTecidosAbertos] = useState<Set<string>>(new Set());
  const toggleTecidoOc = (tecido: string) => setTecidosAbertos((prev) => {
    const next = new Set(prev);
    next.has(tecido) ? next.delete(tecido) : next.add(tecido);
    return next;
  });
  const desvincularAplicada = useMutation({
    mutationFn: async (ocId: string) => {
      const restantes = aplicadas.filter((id) => id !== ocId);
      const { error } = await supabase.rpc("plan_tecido_set_oc_aplicada" as any, { _colecao_id: colecaoId, _oc_ids: restantes });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OC desvinculada.");
      qc.invalidateQueries({ queryKey: ["plan-tecido-oc-aplicada", colecaoId] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-oc-aplicada-lista", colecaoId] }); // pool do SlotOcHint (senão o card fica defasado)
      qc.invalidateQueries({ queryKey: ["plan-tecido-situacao-ocs", colecaoId] });
      qc.invalidateQueries({ queryKey: ["plan-tecido-previa", colecaoId] }); // cobertura mudou → "a comprar" muda
    },
    onError: (e) => toast.error(mensagemErro(e, "Não foi possível desvincular.")),
  });

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

  // MO por serviço por modelo (Σ modelo_servico_mo.valor) — fonte ÚNICA da MO no poder de venda,
  // a mesma do card/Desenvolvimento (substitui o antigo slot.custo_terceirizados_previsto, inerte).
  // Slot sem modelo → 0. Mascarado p/ quem não vê custos → total null → 0.
  const moModeloIds = [...new Set(slots.map((s) => s.modelo_id).filter((x): x is string => !!x))].sort();
  const { data: moTotalMap = {} } = useQuery({
    queryKey: ["plan-tecido-resumo-mo", moModeloIds],
    enabled: moModeloIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelo_mo_resumo" as any, { _ids: moModeloIds });
      if (error) throw error;
      const map: Record<string, number> = {};
      for (const [id, v] of Object.entries((data ?? {}) as Record<string, { total: number | null }>)) map[id] = Number(v?.total) || 0;
      return map;
    },
  });
  const maoObraSlot = (slot: PtSlot) => (slot.modelo_id ? (moTotalMap[slot.modelo_id] ?? 0) : 0);

  // ---- A comprar (necessidade), por CATEGORIA de tecido (subcoleção) ----
  // Régua única (dono 17/ago/2026, flag usar_estoque APOSENTADO): TODO card entra na necessidade;
  // a cobertura por vínculo é quem abate o "a comprar" (no servidor). Espelha o
  // _plan_tecido_nec_variante_core (que também deixou de filtrar usar_estoque).
  const enc = slots;
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
  // A COMPRAR da SUBCOLEÇÃO (decisão do dono, auditoria jul/2026): o déficit é da COLEÇÃO
  // (necessidade − cobertura) — exibi-lo cru aqui produzia "nec 0 · a comprar 1.591,68" (o déficit
  // era de outras subcoleções). Cada artigo entra com a PARTE desta subcoleção (rateioDeficitSub:
  // proporcional à necessidade, limitado à nec da sub).
  // ⚠️ AO VIVO (item 2): o déficit por artigo NÃO é mais lido cru da prévia salva — é recomputado no
  // front por variante = max(0, nec_VIVA_do_rascunho − cobertura_do_servidor), onde
  // cobertura = max(0, nec_servidor − deficit_servidor) (estável entre saves; muda só com vínculo/OC/
  // rolo, que já invalidam a prévia). Assim mudar a QUANTIDADE no card move o "a comprar" na hora, e
  // ao salvar converge com o refetch (quando rascunho==salvo, cada variante rende o próprio
  // deficit_servidor → paridade exata; ver aComprarVivoPorArtigo + teste). Fonte ÚNICA c/ o drawer
  // 'comprar' (usa `cobertura`, TODAS as variantes reais — inclusive as com fornecedor pendente).
  const catDeArtigo = new Map<string, string>();
  for (const s of slots) { if (!s.categoria_tecido_id) continue; for (const m of s.materiais) if (m.tipo === "tecido" && m.artigo_id) catDeArtigo.set(m.artigo_id, s.categoria_tecido_id); }
  const necVivoColByVar = necVivoPorVariante(colecaoArvore); // nec viva do rascunho por variante_tecido_id
  const deficitVivoPorArtigo = aComprarVivoPorArtigo(previa?.cobertura ?? [], necVivoColByVar);
  const necPorArtigo = (arv: PtArvore) => {
    const m = new Map<string, number>();
    // sem filtro de card (flag usar_estoque aposentado): a necessidade é de TODOS os cards.
    for (const t of necessidadePorTecido(arv)) m.set(t.artigo_id, t.totalMetros);
    return m;
  };
  const necSubArt = necPorArtigo(arvore);
  const necColArt = necPorArtigo(colecaoArvore);
  const aComprarArtigo = (aid: string) =>
    rateioDeficitSub(deficitVivoPorArtigo.get(aid) ?? 0, necSubArt.get(aid) ?? 0, necColArt.get(aid) ?? 0);
  const deficitPorCat = new Map<string, number>();
  for (const aid of necSubArt.keys()) {
    const parte = aComprarArtigo(aid);
    if (parte <= 0) continue;
    const cid = catDeArtigo.get(aid);
    if (cid) deficitPorCat.set(cid, (deficitPorCat.get(cid) ?? 0) + parte);
  }
  const aComprarCat = (cid: string | null) => (cid ? deficitPorCat.get(cid) ?? 0 : 0);
  const totComprar = [...necSubArt.keys()].reduce((a, aid) => a + aComprarArtigo(aid), 0);
  const previaCarregada = previa !== undefined; // enquanto false, mostra "…" no "a comprar"

  // ---- Situação da OC por OC: reservada AO VIVO (demanda dos cards atribuídos, coleção toda) ----
  // OC EFETIVA do slot: o VÍNCULO real do Desenvolvimento (modelo_tecido_oc_links, via vinculoOcMap)
  // vence o hint do plano (slotOcMap) — senão, ao trocar a OC direto no Dev, a Reservada/Sobra ficava
  // defasada (o Dev não atualiza plan_tecido_slot_oc). Slot ainda sem vínculo usa o hint do plano.
  // FONTE ÚNICA (calc.detalheOc) — o Drawer usa a MESMA fn (por OC×variante), então nunca divergem.
  // COMPROMETIDA (laranja) = reservada dos cards JÁ enviados à explosão (enviado_cad); computada no
  // front (não pela RPC) p/ atualizar na hora ao enviar ao CAD e usar a MESMA OC efetiva da reservada.
  // OC → artigos E variantes dos itens dela (da RPC): a reserva por OC conta SÓ os metros desses
  // artigos, e parcela com COR definida só se a cor existe na OC (senão o total por OC divergia da
  // soma por variante do Drawer — 576 vs 567,04 na auditoria).
  const ocArtigos = new Map<string, Set<string>>();
  const ocVariantes = new Map<string, Set<string>>();
  for (const r of situacao) {
    let s = ocArtigos.get(r.oc_tecido_id);
    if (!s) { s = new Set(); ocArtigos.set(r.oc_tecido_id, s); }
    s.add(r.artigo_id);
    let v = ocVariantes.get(r.oc_tecido_id);
    if (!v) { v = new Set(); ocVariantes.set(r.oc_tecido_id, v); }
    if (r.variante_tecido_id) v.add(r.variante_tecido_id);
  }
  const { reservPorOc, comprometidoPorOc, nPorOc } = detalheOc(colecaoArvore, vinculoOcMap, slotOcMap, enviadoCadSet, ocArtigos, ocVariantes);

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
    const custo = custoMateriaisPrevisto(slot) + (Number(cs.materiais) || 0) + maoObraSlot(slot);
    const markup = slot.linha_id ? (markupMap[slot.linha_id] ?? 0) : 0;
    pv += precoInfo(custo, markup, slot.preco_venda ?? null, slot.markup_editado ?? null).efetivo * grade;
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

      {/* A comprar (encomenda) — por categoria. `nec.` = necessidade (viva do plano); `a comprar` =
          déficit EXATO da prévia (necessidade − OCs vinculadas), o MESMO número do "Fazer pedido" →
          cai depois do pedido. Vermelho = falta comprar; verde = coberto. */}
      <Secao title="A comprar" right={
        <span className="ml-auto flex items-center gap-1.5">
          {temRascunho && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Inclui alterações não salvas — o 'a comprar' já reflete o rascunho; salve p/ gerar o pedido com estes números" />}
          <Detalhar onClick={() => onDetalhar("comprar")} />
        </span>
      }>
        {catsSub.length === 0 && semCatMetros === 0 ? (
          <div className="p-2 text-[10px] text-muted-foreground">Nenhuma categoria ainda.</div>
        ) : (
          <>
            {catsSub.map((cid) => {
              const nec = catTecMetros(cid); const comprar = aComprarCat(cid);
              return (
                <div key={cid} className="border-b px-2 py-1 text-xs">
                  <div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot(catStatus(cid))}`} title={catStatus(cid) === "g" ? "Todos os tecidos com fornecedor" : catStatus(cid) === "a" ? "Parte dos tecidos sem fornecedor" : "Nenhum tecido com fornecedor"} /><span className="truncate">{catTecidoNome(cid) ?? "?"}</span></div>
                  <div className="mt-0.5 flex gap-4 pl-3.5 text-[11px] tabular-nums">
                    <span className="text-muted-foreground">nec. <b className="text-foreground">{nMet(nec)}</b> m</span>
                    <span className={!previaCarregada ? "text-muted-foreground" : comprar > 0 ? "font-medium text-red-600" : "font-medium text-emerald-700"}>a comprar <b>{previaCarregada ? nMet(comprar) : "…"}</b> m</span>
                  </div>
                </div>
              );
            })}
            {semCatMetros > 0 && (
              <div className="border-b px-2 py-1 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot("n")}`} />Sem categoria</div>
                <div className="mt-0.5 flex gap-4 pl-3.5 text-[11px] tabular-nums"><span className="text-muted-foreground">nec. <b className="text-foreground">{nMet(semCatMetros)}</b> m</span><span className="text-muted-foreground">a comprar <b>{previaCarregada ? nMet(aComprarCat(null)) : "…"}</b> m</span></div>
              </div>
            )}
            <div className="flex items-center gap-4 px-2 py-1 text-[11px] text-muted-foreground">
              <span>Forros (dentro dos modelos)</span><span className="tabular-nums">{nMet(totForro)} m</span>
            </div>
            <div className="border-t px-2 py-1.5 font-display text-xs font-semibold">
              <div>Total</div>
              <div className="mt-0.5 flex gap-4 pl-0 text-[11px] tabular-nums font-normal">
                <span className="text-muted-foreground">nec. <b className="text-foreground">{nMet(totTec + totForro)}</b> m</span>
                <span className={!previaCarregada ? "text-muted-foreground" : totComprar > 0 ? "font-medium text-red-600" : "font-medium text-emerald-700"}>a comprar <b>{previaCarregada ? nMet(totComprar) : "…"}</b> m</span>
              </div>
            </div>
            <div className="px-2 pb-1 text-[10px] leading-snug text-muted-foreground"><b className="font-semibold">a comprar</b> = parte DESTA subcoleção do déficit da coleção (necessidade − OCs vinculadas; plano salvo). O <b className="font-semibold">Fazer pedido</b> sai da seleção de cards.</div>
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
        {ocs.length ? ocs.map((o) => {
          const aplicada = aplicadas.includes(o.oc_tecido_id);
          return (
            <div key={o.oc_tecido_id} className="flex items-center gap-2 border-b px-2 py-1.5 text-xs">
              <button type="button" onClick={() => onDetalhar("ocnum", o.oc_tecido_id)} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline">
                <ShoppingCart className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="shrink-0 font-medium">{o.numero ?? "OC"}</span>
                <span className="truncate text-muted-foreground">{o.tecidos.join(" · ") || "—"}</span>
              </button>
              {aplicada ? (
                <button type="button" title="Desvincular esta OC do plano" disabled={desvincularAplicada.isPending}
                  onClick={() => setDesvincularAlvo({ id: o.oc_tecido_id, numero: o.numero })}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50">
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : geradas.includes(o.oc_tecido_id) ? (
                <span className="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground" title="OC gerada pelo pedido — remova em 'Desfazer pedido'">gerada</span>
              ) : (
                <span className="shrink-0 rounded bg-muted px-1 text-[9px] text-muted-foreground" title="OC vinculada via Desenvolvimento (tecido do modelo) ou atalho do card — remova lá">vínculo</span>
              )}
            </div>
          );
        }) : (
          <div className="px-2 py-1.5 text-[10px] text-muted-foreground">Nenhuma OC vinculada.</div>
        )}
        <OcAplicadaPicker colecaoId={colecaoId} />
        {desvincularAlvo && (
          <AlertDialog open onOpenChange={(o) => { if (!o) setDesvincularAlvo(null); }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Desvincular {desvincularAlvo.numero ?? "a OC"}?</AlertDialogTitle>
                <AlertDialogDescription>
                  A cobertura dela sai do "a comprar" da coleção inteira. Dá pra vincular de novo depois.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => { desvincularAplicada.mutate(desvincularAlvo.id); setDesvincularAlvo(null); }}>
                  Desvincular
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </Secao>

      {/* Situação da OC — por OC, AGRUPADA POR TECIDO (dono ago/2026): cada tecido é um grupo
          colapsável (chevron, header inteiro clicável), RECOLHIDO por padrão — evita a rolagem
          longa de todas as OCs abertas de uma vez. A conta de cada OC (Pedida/Entregue/Demanda/
          Sobra) continua EXATAMENTE a mesma de antes, só a apresentação foi reorganizada. */}
      <Secao title="Situação por OC" right={<Detalhar onClick={() => onDetalhar("oc")} />}>
        {ocs.length ? gruposTecidoOc.map((g) => (
          <GrupoTecidoOc key={g.tecido} tecido={g.tecido} count={g.itens.length} open={tecidosAbertos.has(g.tecido)} onToggle={() => toggleTecidoOc(g.tecido)}>
            {g.itens.map((o) => {
              const reservadaTotal = reservPorOc.get(o.oc_tecido_id) ?? 0;
              const comprometido = comprometidoPorOc.get(o.oc_tecido_id) ?? 0; // enviado à explosão (laranja)
              // Contabilidade via fonte única (mesma fn do Drawer): usado (comprometido OU baixa) sai da reservada.
              const { reservadaLivre: reservada, usada, sobra, baixaDomina } = contabilizarOc(reservadaTotal, comprometido, o.usada, o.entregue);
              return (
                <div key={o.oc_tecido_id} className="border-b p-2 text-xs last:border-b-0">
                  <div className="mb-0.5 flex items-center gap-2">
                    <b>{o.numero ?? "OC"}</b>
                    <span className="text-[10px] text-muted-foreground">{nPorOc.get(o.oc_tecido_id) ?? 0} modelo(s)</span>
                    <Detalhar onClick={() => onDetalhar("ocnum", o.oc_tecido_id)} />
                  </div>
                  {o.tecidos.length > 0 && <div className="mb-1 truncate text-[10px] text-muted-foreground" title={o.tecidos.join(" · ")}>{o.tecidos.join(" · ")}</div>}
                  {/* Vocabulário ÚNICO com o drawer aprovado (laudo jul/2026): Demanda (total) com
                      "em produção" + "reservada (livre)" como sub-linhas — nada de "Usada" ambígua.
                      Cores em -700 (âmbar/verde-600 dava 3,2:1 em texto pequeno — reprovava AA). */}
                  <div className="flex justify-between text-muted-foreground"><span>Pedida</span><span>{nMet(o.pedida)} m</span></div>
                  <div className="flex justify-between text-muted-foreground"><span>Entregue</span>
                    {o.pedida > 0 && o.entregue >= o.pedida ? (
                      <span className="font-medium text-emerald-700" title="Entrega completa — nada a chegar">{nMet(o.entregue)} ✓</span>
                    ) : (
                      <span className="font-medium text-amber-700" title={`Falta chegar ${nMet(Math.max(0, o.pedida - o.entregue))} m`}>{nMet(o.entregue)} de {nMet(o.pedida)} m</span>
                    )}
                  </div>
                  <div className="flex justify-between text-muted-foreground" title="O que os modelos vinculados planejam usar desta OC"><span>Demanda</span><span className="font-medium text-foreground">{nMet(Math.max(reservadaTotal, usada))} m</span></div>
                  <div className="flex justify-between pl-2.5 text-muted-foreground">
                    <span>em produção</span>
                    <span className={usada <= 0 ? "" : baixaDomina ? "font-medium text-red-700" : "font-medium text-amber-700"}
                          title={usada <= 0 ? undefined : baixaDomina ? "Baixa real (corte enviado)" : "Comprometido — enviado à explosão"}>
                      {nMet(usada)} m
                    </span>
                  </div>
                  <div className="flex justify-between pl-2.5 text-muted-foreground"><span>reservada (livre)</span><span>{nMet(reservada)} m</span></div>
                  <div className={`mt-0.5 flex justify-between border-t pt-0.5 font-display font-semibold ${sobraCls(sobra)}`}><span>Sobra</span><span>{sobra > 0 ? "+" : ""}{nMet(sobra)} m</span></div>
                </div>
              );
            })}
          </GrupoTecidoOc>
        )) : (
          <div className="p-2 text-[10px] text-muted-foreground">Sem OC ainda — gere um pedido ou vincule uma OC existente.</div>
        )}
        <div className="p-2 text-[10px] leading-snug text-muted-foreground"><b className="font-semibold">Demanda</b> = o que os cards vinculados a esta OC planejam usar (em produção + reservada livre). <b className="font-semibold">Sobra</b> = Entregue − Demanda (o físico que sobra de fato) — negativa = ainda não chegou tecido suficiente.</div>
      </Secao>
    </div>
  );
}
