import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ChevronRight as GoIcon } from "lucide-react";
import { agruparPorOc, type SituacaoOcRow } from "@/lib/plan-tecido/useSituacaoOcs";
import { OcVinculadaDialog } from "./OcVinculadaDialog";
import { supabase } from "@/integrations/supabase/client";
import type { PtArvore, PtSlot } from "@/lib/plan-tecido/types";
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

// Agrupa as linhas da cobertura de UM artigo por FORNECEDOR (nome), mantendo a ordem de chegada.
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
  return [...map.entries()].map(([fornecedor, itens]) => ({ fornecedor, itens }));
}

// Tabela Variante · Plan · Est · Sob · Compr — reusada no resumo do TEC1 (com fornecedor) e nos
// mini-cards de TEC2/Forros (sem fornecedor, cabeçalho compacto).
function TabelaVariantes({ grupos, compact }: { grupos: { fornecedor: string; itens: LinhaVariante[] }[]; compact?: boolean }) {
  const totais = grupos.flatMap((g) => g.itens).reduce(
    (acc, v) => ({ plan: acc.plan + v.plan, est: acc.est + v.est, sob: acc.sob + v.sob, compr: acc.compr + v.compr }),
    { plan: 0, est: 0, sob: 0, compr: 0 },
  );
  return (
    <div className="text-[11px]">
      <div className={`grid grid-cols-[1.3fr_repeat(4,1fr)] items-center gap-1 border-b bg-muted/60 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground ${compact ? "" : ""}`}>
        <span>Variante</span>
        <span className="text-right">Plan</span>
        <span className="text-right">Est</span>
        <span className="text-right">Sob</span>
        <span className="text-right">Compr</span>
      </div>
      {grupos.map((g) => (
        <div key={g.fornecedor}>
          {!compact && (
            <div className="border-b border-dashed bg-muted/30 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              {g.fornecedor}
            </div>
          )}
          {g.itens.map((v) => (
            <div key={v.key} className={`grid grid-cols-[1.3fr_repeat(4,1fr)] items-center gap-1 border-b px-2 ${compact ? "py-1" : "min-h-[36px] py-1.5"}`}>
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

export function ModoPlanoView({
  arvore,
  colecaoId,
  recolhidos,
  onToggleRecolhido,
  renderCard,
  situacaoRows,
  slotOcMap,
  vinculoOcMap,
}: {
  arvore: PtArvore;
  colecaoId: string;
  /** Nomes de tecido recolhidos (faixa fechada) — controlado pelo pai, mesmo padrão de `lanesRecolhidas`. */
  recolhidos: Set<string>;
  onToggleRecolhido: (nomeTecido: string) => void;
  /** O pai monta o <ModelCard> com todos os handlers/props que já tem hoje — este componente só agrupa. */
  renderCard: (slot: PtSlot, li: number, sli: number) => ReactNode;
  /** Situação das OCs da coleção (pedida/entregue/usada/comprometida por variante) — do useSituacaoOcs. */
  situacaoRows: SituacaoOcRow[];
  /** OCs por slot (hint do plano) e por modelo (vínculo do Dev) — p/ descobrir os modelos de cada OC. */
  slotOcMap: Record<string, string[]>;
  vinculoOcMap: Record<string, string[]>;
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
  const gruposDeArtigos = (artigoIds: string[]) => {
    const linhas = artigoIds.flatMap((aid) =>
      (coberturaPorArtigo.get(aid) ?? []).map((c) => ({ ...c, fornecedor: fornecedorDe(aid) ?? "Sem fornecedor" })));
    return agruparPorFornecedor(linhas);
  };

  // Slots ACHATADOS (todas as subcoleções da árvore recebida — o pai já filtra pra sub ativa) com
  // índices originais (li/sli) preservados, pro renderCard do pai gravar no lugar certo.
  const flat = arvore.subcolecoes.flatMap((sub, subI) =>
    sub.linhas.flatMap((ln, li) => ln.slots.map((slot, sli) => ({ slot, subI, li, sli }))));

  // Modelos (slots) de uma OC — GLOBAL (todos os slots da árvore vinculados a ela, por slot/modelo).
  // Computado no nível do componente p/ o dialog ser renderizado UMA vez (fora do .map dos grupos),
  // evitando dialog duplicado quando a mesma OC toca 2 nomes de tecido (achado da revisão).
  const modelosDaOc = (ocId: string): PtSlot[] =>
    flat.map((f) => f.slot).filter((s) =>
      (s.id ? slotOcMap[s.id] ?? [] : []).includes(ocId) ||
      (s.modelo_id ? vinculoOcMap[s.modelo_id] ?? [] : []).includes(ocId));

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
      {nomes.map((nome) => {
        const itens = porNome.get(nome)!;
        const aberto = !recolhidos.has(nome);
        // Artigo(s) do TEC1 do grupo. Em geral o agrupamento por nome junta cards do MESMO artigo,
        // mas o nome de artigo NÃO é único no cadastro — dois artigos homônimos (fornecedores
        // diferentes) caem no mesmo nome. Coletamos TODOS os artigos de Tecido 1 do grupo p/ o resumo
        // cobrir todos (não só o 1º), agrupando cada um com seu fornecedor.
        const tec1 = itens[0]?.slot.materiais.find((m) => m.tipo === "tecido" && m.artigo_id);
        const tec1ArtigoIds = [...new Set(itens
          .map((f) => f.slot.materiais.find((m) => m.tipo === "tecido" && m.artigo_id)?.artigo_id)
          .filter((id): id is string => !!id))];
        const categoriaNome = tec1ArtigoIds[0] ? categoriaNomeDe(tec1ArtigoIds[0]) : null;
        const tec1Grupos = gruposDeArtigos(tec1ArtigoIds);

        // Posições SECUNDÁRIAS (tipo+numero ≠ Tecido 1) presentes nos slots do grupo — cada posição
        // (ex. "tecido#2", "forro#1", "forro#2") vira uma tira de mini-cards com as variações de
        // artigo encontradas naquela posição entre os cards.
        type Posicao = { key: string; label: string; isForro: boolean; numero: number };
        const posicoesMap = new Map<string, Posicao>();
        for (const { slot } of itens) {
          for (const m of slot.materiais) {
            if (m.tipo === "tecido" && m.numero === (tec1?.numero ?? 1)) continue; // é o TEC1 do grupo
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

        // OCs VINCULADAS ao grupo: OCs cujos itens tocam algum artigo usado pelos cards do grupo
        // (via situacaoRows por artigo). `agruparPorOc` dá nº/status/fornecedor. Ordena por número.
        const artigosDoGrupo = new Set<string>();
        for (const { slot } of itens) for (const m of slot.materiais) if (m.artigo_id) artigosDoGrupo.add(m.artigo_id);
        const rowsDoGrupo = situacaoRows.filter((r) => artigosDoGrupo.has(r.artigo_id));
        const ocsDoGrupo = agruparPorOc(rowsDoGrupo).sort((a, b) => (a.numero ?? "").localeCompare(b.numero ?? "", "pt-BR"));

        return (
          <div key={nome} className="overflow-hidden rounded-lg border bg-card">
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
              <div className="flex items-stretch">
                {/* COLUNA ESQUERDA — resumo (fixa, ~300px) */}
                <div className="flex w-[300px] shrink-0 flex-col border-r-2 border-primary bg-muted/10">
                  {/* TODO(fase futura): altura do topo medida por ResizeObserver contra o header do
                      ModelCard (hoje a coluna esquerda flui livre — o encaixe visual fino é fase futura). */}
                  <div className="border-b">
                    <FotoCarrossel paths={pf.fotosDe(nome)} onChange={(p) => pf.salvar.mutate({ nomeTecido: nome, paths: p })} nomeTecido={nome} />
                  </div>

                  {/* Resumo do TEC1 — alinhado por variante, agrupado por fornecedor */}
                  <div className="border-b px-2 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                    TEC 1 · {nome} — resumo por variante
                  </div>
                  {tec1Grupos.length > 0 ? (
                    <TabelaVariantes grupos={tec1Grupos} />
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
                          <button key={oc.oc_tecido_id} type="button" onClick={() => setOcDialog(oc.oc_tecido_id)}
                            className="flex w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 text-left text-[11px] hover:border-primary">
                            <span className="shrink-0 font-semibold tabular-nums">{oc.numero ?? "s/ nº"}</span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{oc.tecidos.join(", ")}</span>
                            <StatusBadge tone={oc.status === "recebido" ? "success" : "warning"} className="shrink-0 normal-case tracking-normal">
                              {oc.status === "recebido" ? "Recebido" : "Encomendado"}
                            </StatusBadge>
                            <GoIcon className="h-3 w-3 shrink-0 text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* TRILHA DE CARDS — direita, rolável horizontal */}
                <div className="flex flex-1 gap-3 overflow-x-auto p-3">
                  {itens.map(({ slot, li, sli }) => (
                    <div key={slot.id ?? `${li}-${sli}`} className="w-[330px] shrink-0">
                      {renderCard(slot, li, sli)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {nomes.length === 0 && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nenhum card nesta subcoleção ainda.
        </div>
      )}

      {/* Dialog da OC — renderizado UMA vez (fora do .map dos grupos) p/ nunca duplicar. Info da OC
          (nº/status/fornecedor) vem da própria situacaoRows; modelos via `modelosDaOc` global. */}
      {ocDialog && (() => {
        const rows = situacaoRows.filter((r) => r.oc_tecido_id === ocDialog);
        if (rows.length === 0) return null; // OC não está mais visível (ex.: refetch) → não abre
        const r0 = rows[0];
        return (
          <OcVinculadaDialog
            open onOpenChange={(o) => !o && setOcDialog(null)}
            ocId={ocDialog} numero={r0.numero} status={r0.status}
            fornecedor={fornecedorDe(r0.artigo_id)}
            situacaoRows={rows} modelosDaOc={modelosDaOc(ocDialog)}
          />
        );
      })()}
    </div>
  );
}
