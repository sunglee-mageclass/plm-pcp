import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ChevronRight as GoIcon } from "lucide-react";
import { agruparPorOc, type SituacaoOcRow } from "@/lib/plan-tecido/useSituacaoOcs";
import { OcVinculadaDialog } from "./OcVinculadaDialog";
import { OcHoverResumo } from "./OcHoverResumo";
import { supabase } from "@/integrations/supabase/client";
import type { PtArvore, PtSlot, PtVariante } from "@/lib/plan-tecido/types";
import type { PreviaRpc, PreviaCoberturaRpc } from "@/components/plan-tecido/FazerPedidoWizard";
import { useArtigosTecido } from "@/lib/plan-tecido/useArtigosTecido";
import { fmtMetros } from "@/lib/plan-tecido/calc";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FotoCarrossel } from "./FotoCarrossel";
import { usePedidoFotos } from "./usePedidoFotos";

// "Modo Plano" (set/2026) — view alternativa do Plan. Tecido: uma FAIXA horizontal por NOME de
// tecido (Tecido 1), com resumo alinhado por variante à esquerda + a trilha de cards à direita.
// Mockup de referência: mockup-plan-tecido-modo-plano.html (estrutura replicada com os primitivos
// do sistema — nenhum estilo/hex/px solto do HTML foi copiado literalmente).
//
// Isolado de propósito: quem monta cada <ModelCard> (com todos os handlers/props que já existem em
// PlanTecidoSheet) é o PAI, via `renderCard` — este componente só AGRUPA os slots por nome de tecido
// e organiza o layout (faixa/coluna-resumo/trilha).

// Nome do tecido (Tecido 1) de um slot — mesma regra de PlanTecidoSheet.tsx:1445/1667 (1º material
// tipo "tecido"; fallback "Sem tecido" quando não há artigo definido).
function tecidoNomeDoSlot(slot: PtSlot, artigoMap: Map<string, { nome: string }>): string {
  const t = slot.materiais.find((m) => m.tipo === "tecido" && m.artigo_id);
  return (t?.artigo_nome ?? (t?.artigo_id ? artigoMap.get(t.artigo_id)?.nome ?? null : null)) ?? "Sem tecido";
}

// label da cobertura vem formatado no servidor como `concat_ws(' - ', cor.nome, apelido.nome)`
// (ver _plan_tecido_previa_pedido_core, comentário "só cor base - apelido"). Separa em 2 linhas
// (cor base / apelido) pro mesmo layout 2-linhas usado no resumo e nos mini-cards.
function splitCorApelido(label: string | null): { cor: string; apelido: string | null } {
  if (!label) return { cor: "—", apelido: null };
  const i = label.indexOf(" - ");
  return i < 0 ? { cor: label, apelido: null } : { cor: label.slice(0, i), apelido: label.slice(i + 3) || null };
}

type LinhaVariante = {
  key: string;
  cor: string;
  apelido: string | null;
  plan: number;
  est: number;
  sob: number;
  compr: number;
};

// Agrupa as linhas da cobertura de UM artigo por FORNECEDOR (nome). ORDENA fornecedores e variantes
// ALFABÉTICO — a MESMA ordem do card (MaterialBlock: fornecedores por localeCompare, variantes por
// cmpVar cor→apelido). Sem isso, no multi-fornecedor o resumo (ordem de chegada da RPC) desalinhava
// linha-a-linha com o card (achado da revisão set/2026); alinhar só a 1ª variante não bastava.
function agruparPorFornecedor(
  linhas: (PreviaCoberturaRpc & { fornecedor: string })[],
): { fornecedor: string; itens: LinhaVariante[] }[] {
  const map = new Map<string, LinhaVariante[]>();
  for (const c of linhas) {
    const { cor, apelido } = splitCorApelido(c.label);
    const plan = Number(c.nec_m) || 0;
    const est = Number(c.estoque_m) || 0;
    const compr = Number(c.deficit_m) || 0;
    const sob = Math.max(0, est - plan);
    const arr = map.get(c.fornecedor) ?? map.set(c.fornecedor, []).get(c.fornecedor)!;
    arr.push({ key: c.variante_tecido_id ?? `${c.artigo_id}-${c.label}`, cor, apelido, plan, est, sob, compr });
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" });
  return [...map.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([fornecedor, itens]) => ({
      fornecedor,
      itens: itens.slice().sort((x, y) => cmp(x.cor, y.cor) || cmp(x.apelido ?? "", y.apelido ?? "")),
    }));
}

// Tabela Variante · Plan · Est · Sob · Compr — reusada no resumo do TEC1 (com fornecedor) e nos
// mini-cards de TEC2/Forros (sem fornecedor, cabeçalho compacto).
// `marcarPrimeira` (só o resumo do TEC1 passa): põe `data-pt-resumo-var` na 1ª LINHA DE VARIANTE —
// a âncora que o encaixe do topo mede (a linha real, NÃO o wrapper — o wrapper inclui o cabeçalho
// "Variante·Plan·…" e mediria o lugar errado).
function TabelaVariantes({ grupos, compact, marcarPrimeira }: { grupos: { fornecedor: string; itens: LinhaVariante[] }[]; compact?: boolean; marcarPrimeira?: boolean }) {
  const totais = grupos.flatMap((g) => g.itens).reduce(
    (acc, v) => ({ plan: acc.plan + v.plan, est: acc.est + v.est, sob: acc.sob + v.sob, compr: acc.compr + v.compr }),
    { plan: 0, est: 0, sob: 0, compr: 0 },
  );
  // Cabeçalho de fornecedor só quando há MAIS de um fornecedor — espelha o card (MaterialBlock só
  // agrupa por fornecedor quando `multiFornecedor`). Com 1 fornecedor os dois lados ficam com a
  // MESMA contagem de linhas (sem a linha extra do cabeçalho) → alinhamento linha-a-linha (set/2026).
  const mostrarFornecedor = !compact && grupos.length > 1;
  return (
    <div className="text-[11px]">
      <div className={`grid grid-cols-[1.3fr_repeat(4,1fr)] items-center gap-1 border-b bg-muted/60 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground ${compact ? "" : ""}`}>
        <span>Variante</span>
        <span className="text-right">Plan</span>
        <span className="text-right">Est</span>
        <span className="text-right">Sob</span>
        <span className="text-right">Compr</span>
      </div>
      {grupos.map((g, gi) => (
        <div key={g.fornecedor}>
          {/* ⚠️ Tailwind v4: var CSS em arbitrary value exige `var(...)` por extenso — `h-[--h-fornec]`
              (sintaxe v3) NÃO gera CSS no v4 e a altura simplesmente não aplicava (incidente set/2026:
              linhas do resumo ~32px vs 40px dos cards, desalinhando tudo). */}
          {mostrarFornecedor && (
            <div className="flex h-[var(--h-fornec)] items-center border-b border-dashed bg-muted/30 px-2 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              {g.fornecedor}
            </div>
          )}
          {g.itens.map((v, vi) => (
            <div key={v.key} {...(marcarPrimeira && gi === 0 && vi === 0 ? { "data-pt-resumo-var": "" } : {})} className={`grid grid-cols-[1.3fr_repeat(4,1fr)] items-center gap-1 border-b px-2 ${compact ? "py-1" : "h-[var(--h-var)]"}`}>
              <span className="flex min-w-0 items-center gap-1.5">
                <VarianteSwatch nome={v.cor} />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-[11px] font-semibold">{v.cor}</span>
                  {v.apelido && <span className="block truncate text-[9px] text-muted-foreground">{v.apelido}</span>}
                </span>
              </span>
              <span className="text-right tabular-nums">{fmtMetros(v.plan)}</span>
              <span className="text-right tabular-nums text-muted-foreground">{fmtMetros(v.est)}</span>
              <span className="text-right tabular-nums text-emerald-700">{v.sob > 0 ? fmtMetros(v.sob) : "—"}</span>
              <span className={`text-right tabular-nums ${v.compr > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{v.compr > 0 ? fmtMetros(v.compr) : "0"}</span>
            </div>
          ))}
        </div>
      ))}
      <div className="grid grid-cols-[1.3fr_repeat(4,1fr)] items-center gap-1 bg-muted px-2 py-1 text-[11px] font-semibold">
        <span className="text-[9px] uppercase tracking-wide text-muted-foreground">Total</span>
        <span className="text-right tabular-nums">{fmtMetros(totais.plan)}</span>
        <span className="text-right tabular-nums">{fmtMetros(totais.est)}</span>
        <span className="text-right tabular-nums text-emerald-700">{fmtMetros(totais.sob)}</span>
        <span className={`text-right tabular-nums ${totais.compr > 0 ? "text-destructive" : ""}`}>{fmtMetros(totais.compr)}</span>
      </div>
    </div>
  );
}

// ENCAIXE DO TOPO (set/2026) — alinha a 1ª variante do RESUMO com a 1ª variante do primeiro CARD.
// Mede (ResizeObserver) o offset vertical da 1ª LINHA DE VARIANTE de cada lado — `[data-pt-resumo-var]`
// no resumo e `[data-pt-primeira-var]` no card — relativo ao topo comum da faixa, e devolve o AJUSTE
// com sinal: >0 = resumo desce (paddingTop na coluna esquerda) · <0 = TRILHA desce (paddingTop no
// wrapper dos cards). Bidirecional porque qualquer lado pode ser o mais alto (carrossel alto vs header
// do card alto). A altura de cada linha já é fixa (`--h-var`), então alinhar a 1ª alinha todas.
//
// ⚠️ CONVERGÊNCIA (incidente set/2026 — "variantes descendo infinito" + página lenta): a medição usa a
// posição NATURAL (sem o ajuste aplicado) dos DOIS lados. Cada âncora está DENTRO do container que
// recebe o paddingTop do seu lado → desconta o pad APLICADO daquele lado. A 1ª versão descontava o pad
// da âncora ERRADA (o wrapper, cujo top não se move com o próprio padding) → o delta crescia a cada
// ciclo do RO, pad → ∞, re-render em loop. Nunca descontar pad de um elemento que não se move com ele.
function useEncaixeTopo(faixaRef: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  const [ajuste, setAjuste] = useState(0);
  const ajusteRef = useRef(0);
  ajusteRef.current = ajuste;
  useLayoutEffect(() => {
    const faixa = faixaRef.current;
    if (!faixa) return;
    const medir = () => {
      const cardAncora = faixa.querySelector<HTMLElement>("[data-pt-primeira-var]");
      const resumoAncora = faixa.querySelector<HTMLElement>("[data-pt-resumo-var]");
      // Resumo OCULTO (mobile: `hidden md:flex` → offsetParent null): sem coluna p/ alinhar, o encaixe
      // é inerte (getBoundingClientRect de display:none é 0 e geraria um pad espúrio). Zera e sai.
      if (!cardAncora || !resumoAncora || resumoAncora.offsetParent === null) { setAjuste(0); return; }
      const base = faixa.getBoundingClientRect().top;
      // Pads APLICADOS no DOM neste momento (derivados do ajuste atual) — descontados p/ obter a
      // posição natural de cada âncora, tornando o delta um PONTO FIXO (converge em 1 passo).
      const padResumoAplicado = Math.max(0, ajusteRef.current);
      const padTrilhaAplicado = Math.max(0, -ajusteRef.current);
      const yCardNatural = cardAncora.getBoundingClientRect().top - base - padTrilhaAplicado;
      const yResumoNatural = resumoAncora.getBoundingClientRect().top - base - padResumoAplicado;
      const delta = Math.round(yCardNatural - yResumoNatural); // >0: resumo desce · <0: trilha desce
      setAjuste((prev) => (Math.abs(prev - delta) <= 1 ? prev : delta)); // tolerância 1px: sem jitter
    };
    const ro = new ResizeObserver(medir);
    ro.observe(faixa);
    const primeiroCard = faixa.querySelector<HTMLElement>("[data-pt-card]");
    if (primeiroCard) ro.observe(primeiroCard); // remede quando o header do card muda de altura
    medir();
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ajuste;
}

// Tipos das props que o PAI computa uma vez e passa a CADA faixa (evita reprocessar no map). As
// funções abaixo já existem no escopo do ModoPlanoView; a faixa só as consome.
type GruposFornecedor = { fornecedor: string; itens: LinhaVariante[] }[];
type FlatSlot = { slot: PtSlot; subI: number; li: number; sli: number };

// FAIXA (uma por NOME de tecido) — extraída do `.map` p/ poder CHAMAR o hook `useEncaixeTopo`
// (hooks não podem rodar dentro de `.map`). Toda a lógica POR FAIXA que antes vivia no corpo do
// map foi movida pra cá SEM ALTERAÇÃO; o PAI passa o que é global (funções/dados já computados).
function FaixaModoPlano({
  nome,
  itens,
  aberto,
  gruposDeArtigos,
  gruposDoArtigo,
  artigoMap,
  fornecedorDe,
  categoriaNomeDe,
  pf,
  situacaoRows,
  slotOcMap,
  vinculoOcMap,
  focoDestaque,
  renderCard,
  setOcDialog,
  onToggleRecolhido,
}: {
  nome: string;
  itens: FlatSlot[];
  aberto: boolean;
  gruposDeArtigos: (artigoIds: string[], permitidas?: Set<string>) => GruposFornecedor;
  gruposDoArtigo: (artigoId: string | null) => GruposFornecedor;
  artigoMap: Map<string, { nome: string }>;
  fornecedorDe: (artigoId: string) => string | null;
  categoriaNomeDe: (artigoId: string) => string | null;
  pf: ReturnType<typeof usePedidoFotos>;
  situacaoRows: SituacaoOcRow[];
  slotOcMap: Record<string, string[]>;
  vinculoOcMap: Record<string, string[]>;
  focoDestaque?: string | null;
  renderCard: (slot: PtSlot, li: number, sli: number, variantesGrupoT1: PtVariante[], onAbrirOcDialog: (ocId: string) => void) => ReactNode;
  setOcDialog: (ocId: string | null) => void;
  onToggleRecolhido: (nomeTecido: string) => void;
}) {
  // Artigo(s) do TEC1 do grupo. Em geral o agrupamento por nome junta cards do MESMO artigo,
  // mas o nome de artigo NÃO é único no cadastro — dois artigos homônimos (fornecedores
  // diferentes) caem no mesmo nome. Coletamos TODOS os artigos de Tecido 1 do grupo p/ o resumo
  // cobrir todos (não só o 1º), agrupando cada um com seu fornecedor.
  const tec1ArtigoIds = [...new Set(itens
    .map((f) => f.slot.materiais.find((m) => m.tipo === "tecido" && m.artigo_id)?.artigo_id)
    .filter((id): id is string => !!id))];
  const categoriaNome = tec1ArtigoIds[0] ? categoriaNomeDe(tec1ArtigoIds[0]) : null;

  // UNIÃO VISUAL das variantes do Tecido 1 do grupo (set/2026): todas as cores que QUALQUER card
  // do grupo tem no seu Tecido 1. Passada aos cards p/ exibirem as faltantes com qtd 0 (fantasma,
  // editável — digitar promove). NÃO grava; é só apresentação (o card real só ganha a cor ao
  // digitar). Ordem canônica = 1ª aparição (mesma ordem em todos → linhas batem com o resumo).
  // "Tecido 1" POR CARD = o 1º tecido COM artigo (fallback 1º tecido) — MESMO critério do
  // `tec1Idx` do ModelCard, p/ a união casar o bloco que a exibe (não um material de outro numero).
  const tec1DoSlot = (slot: PtSlot) =>
    slot.materiais.find((m) => m.tipo === "tecido" && m.artigo_id) ??
    slot.materiais.find((m) => m.tipo === "tecido");
  const uniaoVariantesT1: PtVariante[] = [];
  const vistas = new Set<string>();
  for (const { slot } of itens) {
    const m = tec1DoSlot(slot);
    for (const v of m?.variantes ?? []) {
      const k = v.variante_tecido_id ?? `plan:${v.cor_id ?? ""}|${v.cor_apelido_id ?? ""}`;
      if (!vistas.has(k)) { vistas.add(k); uniaoVariantesT1.push(v); }
    }
  }

  // Resumo do TEC1 filtrado pelas variantes REALMENTE usadas pelos cards do grupo (a união).
  // A RPC de cobertura devolve TODAS as variantes cadastradas do artigo (o card só usa 4, o
  // cadastro pode ter 10) — sem esse filtro o resumo listava cores que nenhum card usa.
  // Chave espelha o filtro de `gruposDeArtigos`: variante_tecido_id, ou `label:<label>` p/ planejada.
  const permitidasT1 = new Set<string>();
  for (const v of uniaoVariantesT1)
    permitidasT1.add(v.variante_tecido_id ?? `label:${(v.label ?? "").trim().toLowerCase()}`);
  const tec1Grupos = gruposDeArtigos(tec1ArtigoIds, permitidasT1);

  // Posições SECUNDÁRIAS (tipo+numero ≠ Tecido 1) presentes nos slots do grupo — cada posição
  // (ex. "tecido#2", "forro#1", "forro#2") vira uma tira de mini-cards com as variações de
  // artigo encontradas naquela posição entre os cards.
  type Posicao = { key: string; label: string; isForro: boolean; numero: number };
  const posicoesMap = new Map<string, Posicao>();
  for (const { slot } of itens) {
    const t1 = tec1DoSlot(slot); // o material Tecido 1 DESTE slot (mesmo critério da união)
    for (const m of slot.materiais) {
      if (m === t1) continue; // é o TEC1 do grupo — sai das posições secundárias
      const key = `${m.tipo}-${m.numero}`;
      if (!posicoesMap.has(key)) {
        posicoesMap.set(key, {
          key,
          label: m.tipo === "forro" ? `FOR ${m.numero}` : `TEC ${m.numero}`,
          isForro: m.tipo === "forro",
          numero: m.numero,
        });
      }
    }
  }
  const posicoes = [...posicoesMap.values()].sort((a, b) => (a.isForro === b.isForro ? a.numero - b.numero : a.isForro ? 1 : -1));

  // OCs VINCULADAS ao grupo (fix set/2026): SÓ as OCs efetivamente ligadas aos slots/modelos deste
  // grupo — via hint de OC do card (`slotOcMap[slot_id]`) OU vínculo do Desenvolvimento
  // (`vinculoOcMap[modelo_id]`). ⚠️ ANTES filtrava por ARTIGO (`artigosDoGrupo.has(r.artigo_id)`), o que
  // listava QUALQUER OC daquele tecido, mesmo sem vínculo com nenhum card do grupo ("qual OC contém
  // esse tecido?"). Agora é o conjunto de oc_ids realmente vinculados. `agruparPorOc` dá nº/status/forn.
  const ocIdsDoGrupo = new Set<string>();
  for (const { slot } of itens) {
    if (slot.id) for (const oc of slotOcMap[slot.id] ?? []) ocIdsDoGrupo.add(oc);
    if (slot.modelo_id) for (const oc of vinculoOcMap[slot.modelo_id] ?? []) ocIdsDoGrupo.add(oc);
  }
  const rowsDoGrupo = situacaoRows.filter((r) => ocIdsDoGrupo.has(r.oc_tecido_id));
  const ocsDoGrupo = agruparPorOc(rowsDoGrupo).sort((a, b) => (a.numero ?? "").localeCompare(b.numero ?? "", "pt-BR"));

  // ENCAIXE DO TOPO — mede a 1ª variante do card vs a âncora do resumo e empurra o resumo p/ baixo.
  const faixaRef = useRef<HTMLDivElement>(null);
  // Guarda: scrolla até o card destacado UMA vez por foco (o ref callback dispara a cada re-render
  // enquanto `destacado` for true — sem isto o card ficaria "puxando" o scroll a cada hover/render).
  // RESETA quando o destaque cai (focoDestaque=null) — senão re-navegar ao MESMO modelo (id igual)
  // não re-scrollaria (achado D da revisão): scrollFocoRef ficaria preso no id antigo.
  const scrollFocoRef = useRef<string | null>(null);
  if (!focoDestaque && scrollFocoRef.current !== null) scrollFocoRef.current = null;
  // Deps ESTÁVEIS (não o array `tec1Grupos`, recriado a cada render — reconectaria o ResizeObserver
  // à toa): nº de fornecedores + nº total de linhas de variante + aberto capturam toda mudança de
  // geometria do resumo; qualquer variação de ALTURA restante o próprio RO já pega.
  const nLinhasResumo = tec1Grupos.reduce((n, g) => n + g.itens.length, 0);
  const ajusteTopo = useEncaixeTopo(faixaRef, [tec1Grupos.length, nLinhasResumo, itens.length, aberto]);
  // >0: a 1ª variante do CARD está mais abaixo (header do card mais alto) → o RESUMO desce.
  // <0: a 1ª variante do RESUMO está mais abaixo (carrossel/topo mais alto) → a TRILHA desce.
  const padResumo = Math.max(0, ajusteTopo);
  const padTrilha = Math.max(0, -ajusteTopo);

  return (
    <div ref={faixaRef} className="overflow-hidden rounded-lg border bg-card">
      {/* Cabeçalho da faixa */}
      <button type="button" onClick={() => onToggleRecolhido(nome)}
        className="flex w-full items-center gap-2 border-b bg-muted/60 px-3 py-2 text-left">
        {aberto ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="font-display text-[14px] font-bold">{nome}</span>
        {categoriaNome && <StatusBadge tone="neutral" className="shrink-0">{categoriaNome}</StatusBadge>}
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {itens.length} card{itens.length === 1 ? "" : "s"}
          {posicoes.length > 0 ? ` · T1 alinhado + ${posicoes.length} mini-card${posicoes.length === 1 ? "" : "s"} (T2/Forros)` : ""}
        </span>
      </button>

      {aberto && (
        // Alturas de linha COMPARTILHADAS resumo↔card (var CSS herdadas): a linha da variante
        // (`--h-var`) e o cabeçalho de fornecedor (`--h-fornec`) têm o MESMO valor nos dois lados,
        // então a variante N do resumo casa a variante N do card (alinhamento linha-a-linha).
        <div className="flex items-stretch" style={{ "--h-var": "40px", "--h-fornec": "20px" } as CSSProperties}>
          {/* COLUNA ESQUERDA — resumo (fixa, ~300px). ESCONDIDA no MOBILE (`hidden md:flex`): a coluna
              fixa comeria quase toda a largura e os cards ficariam sem espaço (dono set/2026). No
              mobile só a trilha de cards aparece, com scroll-snap (um card por vez). */}
          <div className="hidden w-[300px] shrink-0 flex-col border-r-2 border-primary bg-muted/10 md:flex">
            <div className="border-b">
              <FotoCarrossel paths={pf.fotosDe(nome)} onChange={(p) => pf.salvar.mutate({ nomeTecido: nome, paths: p })} nomeTecido={nome} />
            </div>

            {/* Resumo do TEC1 — alinhado por variante, agrupado por fornecedor */}
            <div className="border-b px-2 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-wide text-primary">
              TEC 1 · {nome} — resumo por variante
            </div>
            {tec1Grupos.length > 0 ? (
              // Espaçador do ENCAIXE DO TOPO (lado resumo): desce a tabela até a 1ª variante alinhar
              // com a do 1º card. A âncora de MEDIÇÃO é a 1ª linha de variante ([data-pt-resumo-var],
              // via `marcarPrimeira`) — não este wrapper (que inclui o cabeçalho da tabela).
              <div style={{ paddingTop: padResumo }}>
                <TabelaVariantes grupos={tec1Grupos} marcarPrimeira />
              </div>
            ) : (
              <div className="border-b px-2 py-2 text-[11px] text-muted-foreground">Sem cobertura calculada ainda.</div>
            )}

            {/* Mini-cards por POSIÇÃO (TEC 2 / FOR 1 / FOR 2…) — tira rolável, um por vez (snap) */}
            {posicoes.map((pos) => {
              // Variações de artigo naquela posição entre os cards do grupo (podem ser
              // tecidos/forros DISTINTOS — cada um vira 1 mini-card).
              const porArtigoNaPosicao = new Map<string, { artigoId: string; nome: string; count: number }>();
              for (const { slot } of itens) {
                const m = slot.materiais.find((x) => x.tipo === (pos.isForro ? "forro" : "tecido") && x.numero === pos.numero);
                if (!m?.artigo_id) continue;
                const atual = porArtigoNaPosicao.get(m.artigo_id);
                if (atual) atual.count++;
                else porArtigoNaPosicao.set(m.artigo_id, { artigoId: m.artigo_id, nome: m.artigo_nome ?? artigoMap.get(m.artigo_id)?.nome ?? "Tecido", count: 1 });
              }
              const variacoes = [...porArtigoNaPosicao.values()];
              if (variacoes.length === 0) return null;
              return (
                <div key={pos.key} className="border-b px-2 py-2">
                  <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {pos.label} — variações entre os cards
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollSnapType: "x mandatory" }}>
                    {variacoes.map((v) => {
                      const grupos = gruposDoArtigo(v.artigoId);
                      return (
                        <div key={v.artigoId} className="w-full shrink-0 rounded-lg border bg-card"
                          style={{ scrollSnapAlign: "start", scrollSnapStop: "always" }}>
                          <div className="flex items-center gap-1.5 border-b bg-muted/60 px-2 py-1.5">
                            <StatusBadge tone={pos.isForro ? "neutral" : "info"} className="shrink-0">{pos.label}</StatusBadge>
                            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">{v.nome}</span>
                          </div>
                          <div className="border-b border-dashed px-2 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                            {fornecedorDe(v.artigoId) ?? "Sem fornecedor"} · {v.count} card{v.count === 1 ? "" : "s"}
                          </div>
                          {grupos.length > 0 ? (
                            <TabelaVariantes grupos={grupos} compact />
                          ) : (
                            <div className="px-2 py-2 text-[11px] text-muted-foreground">Sem cobertura calculada ainda.</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* OCs VINCULADAS — nº + fornecedor + status; clicar abre o dialog (Pedido·Reserva·Sobra + modelos). */}
            {ocsDoGrupo.length > 0 && (
              <div className="px-2 py-2">
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">OCs vinculadas</div>
                <div className="space-y-1">
                  {ocsDoGrupo.map((oc) => (
                    // Hover (desktop) → popover Cor·Pedido·Reserva·Sobra (sem modelos); clique → dialog completo.
                    <OcHoverResumo key={oc.oc_tecido_id} situacaoRows={situacaoRows} ocId={oc.oc_tecido_id}>
                      <button type="button" onClick={() => setOcDialog(oc.oc_tecido_id)}
                        className="flex w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 text-left text-[11px] hover:border-primary">
                        <span className="shrink-0 font-semibold tabular-nums">{oc.numero ?? "s/ nº"}</span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{oc.tecidos.join(", ")}</span>
                        <StatusBadge tone={oc.status === "recebido" ? "success" : "warning"} className="shrink-0 normal-case tracking-normal">
                          {oc.status === "recebido" ? "Recebido" : "Encomendado"}
                        </StatusBadge>
                        <GoIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                      </button>
                    </OcHoverResumo>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* TRILHA DE CARDS — direita, rolável horizontal. O wrapper EXTERNO recebe o espaçador do
              encaixe (lado trilha, quando o resumo é o mais alto) — em wrapper próprio p/ não brigar
              com o p-3 da trilha (inline paddingTop sobrescreveria a classe).
              MOBILE: scroll-snap (`snap-x snap-mandatory` só < md, pra não brigar com o alinhamento
              lado-a-lado do desktop) — cada card cheira a largura da tela e para inteiro (nunca no
              meio de um card), como o carrossel de fotos. */}
          <div className="min-w-0 flex-1" style={{ paddingTop: padTrilha }}>
            <div className="flex gap-3 overflow-x-auto p-3 snap-x snap-mandatory md:snap-none">
              {itens.map(({ slot, li, sli }, idx) => {
                const destacado = !!focoDestaque && slot.modelo_id === focoDestaque;
                return (
                <div
                  key={slot.id ?? `${li}-${sli}`}
                  ref={destacado ? (el) => {
                    if (el && scrollFocoRef.current !== focoDestaque) {
                      scrollFocoRef.current = focoDestaque ?? null;
                      el.scrollIntoView({ behavior: "smooth", block: "start", inline: "center" });
                    }
                  } : undefined}
                  className={`w-[85vw] max-w-[330px] shrink-0 snap-start snap-always md:w-[330px] ${destacado ? "rounded-lg ring-2 ring-orange-500 ring-offset-2" : ""}`}
                  {...(idx === 0 ? { "data-pt-card": "" } : {})}
                >
                  {renderCard(slot, li, sli, uniaoVariantesT1, setOcDialog)}
                </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function ModoPlanoView({
  arvore,
  colecaoId,
  recolhidos,
  onToggleRecolhido,
  renderCard,
  situacaoRows,
  slotOcMap,
  vinculoOcMap,
  focoDestaque,
}: {
  arvore: PtArvore;
  colecaoId: string;
  /** Nomes de tecido recolhidos (faixa fechada) — controlado pelo pai, mesmo padrão de `lanesRecolhidas`. */
  recolhidos: Set<string>;
  onToggleRecolhido: (nomeTecido: string) => void;
  /** O pai monta o <ModelCard> com todos os handlers/props que já tem hoje — este componente só agrupa. */
  /** Recebe também a UNIÃO das variantes do Tecido 1 do grupo (p/ o card exibir as faltantes com 0). */
  renderCard: (slot: PtSlot, li: number, sli: number, variantesGrupoT1: PtVariante[], onAbrirOcDialog: (ocId: string) => void) => ReactNode;
  /** Situação das OCs da coleção (pedida/entregue/usada/comprometida por variante) — do useSituacaoOcs. */
  situacaoRows: SituacaoOcRow[];
  /** OCs VINCULADAS por slot (hint do plano) e por modelo (vínculo do Dev) — a seção "OCs vinculadas"
      do resumo lista só as OCs realmente ligadas aos slots/modelos do grupo, NÃO toda OC do tecido. */
  slotOcMap: Record<string, string[]>;
  vinculoOcMap: Record<string, string[]>;
  /** modelo_id a REALÇAR (deep-link do dialog da OC): borda laranja + scroll até o card por ~10s. */
  focoDestaque?: string | null;
}) {
  const { artigoMap, fornecedorDe, categoriaNomeDe } = useArtigosTecido();
  const pf = usePedidoFotos(colecaoId);
  const [ocDialog, setOcDialog] = useState<string | null>(null); // oc_tecido_id do dialog aberto

  const { data: previa } = useQuery({
    queryKey: ["plan-tecido-previa", colecaoId],
    refetchOnWindowFocus: true,
    queryFn: async () => ((await supabase.rpc("plan_tecido_previa_pedido" as any, { _colecao_id: colecaoId })).data ?? null) as PreviaRpc | null,
  });
  const cobertura = previa?.cobertura ?? [];

  // Cobertura por ARTIGO (chave = artigo_id) — usada tanto pro TEC1 do grupo (artigo do tecido que
  // dá nome à faixa) quanto pelos mini-cards de TEC2/Forros (artigo daquela posição secundária).
  const coberturaPorArtigo = new Map<string, PreviaCoberturaRpc[]>();
  for (const c of cobertura) {
    const arr = coberturaPorArtigo.get(c.artigo_id) ?? coberturaPorArtigo.set(c.artigo_id, []).get(c.artigo_id)!;
    arr.push(c);
  }
  const gruposDoArtigo = (artigoId: string | null) => gruposDeArtigos(artigoId ? [artigoId] : []);
  // Junta a cobertura de N artigos (homônimos: mesmo nome, fornecedores diferentes) e agrupa por
  // fornecedor UMA vez (consolida artigos de mesmo fornecedor num só grupo).
  // `permitidas` (opcional): filtra a cobertura pelas variantes REALMENTE usadas pelos cards do grupo
  // (chave = variante_tecido_id, ou o label p/ cores planejadas). Sem ela, mostra toda a cobertura do
  // artigo (comportamento dos mini-cards secundários). O resumo do TEC1 passa a união p/ bater 1-a-1
  // com os cards — a RPC de cobertura devolve TODAS as variantes cadastradas do artigo, não só as do grupo.
  const gruposDeArtigos = (artigoIds: string[], permitidas?: Set<string>) => {
    const linhas = artigoIds.flatMap((aid) =>
      (coberturaPorArtigo.get(aid) ?? []).map((c) => ({ ...c, fornecedor: fornecedorDe(aid) ?? "Sem fornecedor" })));
    const filtradas = permitidas
      ? linhas.filter((c) => permitidas.has(c.variante_tecido_id ?? `label:${(c.label ?? "").trim().toLowerCase()}`))
      : linhas;
    return agruparPorFornecedor(filtradas);
  };

  // Slots ACHATADOS (todas as subcoleções da árvore recebida — o pai já filtra pra sub ativa) com
  // índices originais (li/sli) preservados, pro renderCard do pai gravar no lugar certo.
  const flat = arvore.subcolecoes.flatMap((sub, subI) =>
    sub.linhas.flatMap((ln, li) => ln.slots.map((slot, sli) => ({ slot, subI, li, sli }))));

  // Agrupa por NOME de tecido (Tecido 1) — mesma chave usada no agrupamento "por nome" do canvas.
  const porNome = new Map<string, typeof flat>();
  for (const f of flat) {
    const nome = tecidoNomeDoSlot(f.slot, artigoMap);
    (porNome.get(nome) ?? porNome.set(nome, []).get(nome)!).push(f);
  }
  const nomes = [...porNome.keys()].sort((a, b) => {
    const sa = a === "Sem tecido", sb = b === "Sem tecido";
    if (sa !== sb) return sa ? 1 : -1;
    return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
  });

  return (
    <div className="space-y-3">
      {nomes.map((nome) => (
        <FaixaModoPlano
          key={nome}
          nome={nome}
          itens={porNome.get(nome)!}
          aberto={!recolhidos.has(nome)}
          gruposDeArtigos={gruposDeArtigos}
          gruposDoArtigo={gruposDoArtigo}
          artigoMap={artigoMap}
          fornecedorDe={fornecedorDe}
          categoriaNomeDe={categoriaNomeDe}
          pf={pf}
          situacaoRows={situacaoRows}
          slotOcMap={slotOcMap}
          vinculoOcMap={vinculoOcMap}
          focoDestaque={focoDestaque}
          renderCard={renderCard}
          setOcDialog={setOcDialog}
          onToggleRecolhido={onToggleRecolhido}
        />
      ))}
      {nomes.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhum card nesta subcoleção ainda.
        </div>
      )}

      {/* Dialog da OC — renderizado UMA vez (fora do .map dos grupos) p/ nunca duplicar. Info da OC
          (nº/status/fornecedor) vem da própria situacaoRows; a lista de modelos é GLOBAL (o dialog
          busca por RPC internamente — não mais os slots locais). */}
      {ocDialog && (() => {
        const rows = situacaoRows.filter((r) => r.oc_tecido_id === ocDialog);
        if (rows.length === 0) return null; // OC não está mais visível (ex.: refetch) → não abre
        const r0 = rows[0];
        return (
          <OcVinculadaDialog
            open onOpenChange={(o) => !o && setOcDialog(null)}
            ocId={ocDialog} numero={r0.numero} status={r0.status}
            fornecedor={fornecedorDe(r0.artigo_id)}
            situacaoRows={rows}
          />
        );
      })()}
    </div>
  );
}
