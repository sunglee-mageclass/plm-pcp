import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, PanelLeft, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { AgrupamentoButton } from "@/components/shared/filters";
import { useAgrupamentoState } from "@/hooks/useAgrupamentoState";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useOrcamento } from "@/components/otb/orcamento";
import { DEFAULT_TAMANHOS } from "@/components/oc-p-acabado/shared";
import type { EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import type { Opt, CatOpt, SubOpt, CorApelidoOpt } from "@/components/produto-acabado/shared";
import { ProdutoImportadoCard } from "./ProdutoImportadoCard";
import { ResumoImportadoPanel } from "./ResumoImportadoPanel";
import { NovoProdutoImportadoDialog } from "./NovoProdutoImportadoDialog";
import { emptyDraft, type ProdutoImportadoDraft } from "./shared";

type SubRow = { id: string; nome: string; ordem: number };

// Agrupamento das lanes do canvas — MESMO padrão combinável do Produto Acabado
// (`ProdutoAcabadoSheet.tsx`): "Grupo" e "Categoria" marcáveis juntos → lane por Grupo com
// sub-seções por Categoria dentro (aninhado, "Sem categoria" sempre por último); só um dos
// dois → lanes daquele nível; nenhum → lista plana "Todos". Persistido POR USUÁRIO no banco
// via `useAgrupamentoState` (segue o dispositivo).
type AgruparEstado = { grupo: boolean; categoria: boolean };

function useOpt(table: string) {
  return useQuery({
    queryKey: ["opt-produto-importado", table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as Opt[];
    },
  });
}
function useOptCat(table: string, fk: string) {
  return useQuery({
    queryKey: ["opt-produto-importado-cat", table, fk],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select(`id, nome, ${fk}`).order("nome");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/** Linha crua de `produtos_importados` — shape provisório (a tabela real/RPC de leitura
 *  chegam na fase seguinte). Usado só para preencher a lista quando já existir dado; a
 *  query tolera erro/tabela ausente e cai em lista vazia (Fase 1 nunca trava a tela por
 *  causa disso — o objetivo é ter uma tela NAVEGÁVEL mesmo sem backend pronto). */
type ProdutoImportadoRow = { id: string; nome: string; colecao_id: string | null; subcolecao: string | null };

let idSeq = 0;
const novoIdLocal = () => `novo-${Date.now()}-${idSeq++}`;

/**
 * Sheet do planejador Produto Importado (Fase 1 — TELA NAVEGÁVEL, sem persistência no
 * banco ainda). Layout REFATORADO (set/2026) pra bater FIELMENTE com
 * `ProdutoAcabadoSheet.tsx`: canvas em 3 colunas (rail + aside de resumo fixo no desktop +
 * main), cards compactos de 420px em lanes por categoria/grupo (agrupamento combinável via
 * `AgrupamentoButton`), vagas do OTB (bloco único enxuto, ver `renderVagas` abaixo).
 * Ainda sem colab/DnD/multi-seleção/OC (fora de escopo desta fase — Produto Importado não
 * tem OC na Fase 1; rodapé só tem Subcoleções + Salvar).
 *
 * TODO (fase seguinte): trocar o `useState` local por RPCs reais (`salvar_produto_
 * importado`, leitura de `produtos_importados`) — hoje o Salvar só avisa "em breve".
 */
export function ProdutoImportadoSheet({ colecaoId, subInicial = null, onSubChange, onClose }: {
  colecaoId: string;
  subInicial?: string | null;
  onSubChange?: (subId: string | null) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<"subcolecoes" | "canvas">("subcolecoes");
  const [subAtual, setSubAtual] = useState<{ id: string | null; nome: string | null } | null>(null);
  const [drafts, setDrafts] = useState<ProdutoImportadoDraft[]>([]);
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const [novoOpen, setNovoOpen] = useState(false);
  const [resumoAberto, setResumoAberto] = useState(true);
  const [resumoMobileOpen, setResumoMobileOpen] = useState(false);
  const [baseline, setBaseline] = useState<string>("[]");
  const [carregado, setCarregado] = useState(false);
  const resolvedInicialRef = useRef({ done: false });
  const agrup = useAgrupamentoState("produto-importado", ["categoria"]);
  const agrupar: AgruparEstado = { grupo: agrup.isOn("grupo"), categoria: agrup.isOn("categoria") };
  const setAgrupar = (patch: Partial<AgruparEstado>) => {
    const next = { ...agrupar, ...patch };
    agrup.set([next.grupo && "grupo", next.categoria && "categoria"].filter(Boolean) as string[]);
  };

  const { data: colecao } = useQuery({
    queryKey: ["colecao-nome", colecaoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("colecoes").select("id, nome").eq("id", colecaoId).maybeSingle();
      if (error) throw error;
      return data as { id: string; nome: string } | null;
    },
  });

  const { data: subList = [] } = useQuery({
    queryKey: ["colecao-subcolecoes", colecaoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("colecao_subcolecoes" as any).select("id, nome, ordem").eq("colecao_id", colecaoId).order("ordem");
      if (error) throw error;
      return (data ?? []) as unknown as SubRow[];
    },
  });

  // Vagas do OTB — mesmo bucket/queryKey compartilhado do Produto Acabado (`useOrcamento()`
  // + `orc.subcolecao`); "vagas = max(0, total-realizado)". `realizado` conta `modelos` da
  // subcoleção INTEIRA (todos os planejadores), não só os produtos deste.
  const orc = useOrcamento({ staleTime: 0, refetchOnWindowFocus: true, refetchOnMount: "always" });
  const bucketDe = (nome: string | null) => (nome ? orc.subcolecao(colecaoId, nome) : null);
  const vagasDe = (nome: string | null): number => {
    const b = bucketDe(nome);
    return b ? Math.max(0, b.total - b.realizado) : 0;
  };

  // Tenta carregar produtos já existentes (Fase 2 em diante) — se a tabela ainda não tem
  // RLS/RPC pronta ou vier vazia, cai em lista vazia sem quebrar a tela (empty-state
  // "nenhum produto"). `as any` porque `produtos_importados` está fora do types.ts (igual
  // ao padrão de `ocs_p_acabado`/`produtos_acabados`).
  const produtosQuery = useQuery({
    queryKey: ["produtos-importados", colecaoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("produtos_importados" as any).select("id, nome, colecao_id, subcolecao").eq("colecao_id", colecaoId);
      if (error) throw error;
      return (data ?? []) as unknown as ProdutoImportadoRow[];
    },
    retry: false,
  });

  useEffect(() => {
    if (carregado) return;
    // Sucesso OU erro (tabela/RPC ainda não pronta): resolve como "sem produtos" e libera a
    // tela — Fase 1 é sobre navegar/cotar localmente, não sobre a leitura do banco.
    if (produtosQuery.isSuccess || produtosQuery.isError) {
      const linhas = produtosQuery.data ?? [];
      const iniciais: ProdutoImportadoDraft[] = linhas.map((r) => ({ ...emptyDraft(r.colecao_id, r.subcolecao), id: r.id, nome: r.nome }));
      setDrafts(iniciais);
      setBaseline(JSON.stringify(iniciais));
      setCarregado(true);
    }
  }, [carregado, produtosQuery.isSuccess, produtosQuery.isError, produtosQuery.data]);

  // Resolve a subcoleção da URL (deep-link) uma vez, assim que a lista carregar — mesmo
  // padrão do Produto Acabado (`ProdutoAcabadoSheet.tsx`).
  useEffect(() => {
    if (subInicial == null || resolvedInicialRef.current.done) return;
    if (subInicial === "none") {
      resolvedInicialRef.current.done = true;
      setSubAtual({ id: null, nome: null });
      setView("canvas");
      return;
    }
    const found = subList.find((s) => s.id === subInicial);
    if (found) {
      resolvedInicialRef.current.done = true;
      setSubAtual({ id: found.id, nome: found.nome });
      setView("canvas");
    }
  }, [subInicial, subList]);

  // ── Opções (taxonomia, cores, fornecedores, tamanhos) — mesmas tabelas do Produto Acabado. ──
  const { data: grupos = [] } = useOpt("grupos_produto");
  const { data: categorias = [] } = useOptCat("categorias_produto", "grupo_id") as { data: CatOpt[] };
  const { data: subcats1 = [] } = useOptCat("subcategorias1_produto", "categoria_id") as { data: SubOpt[] };
  const { data: subcats2 = [] } = useOptCat("subcategorias2_produto", "categoria_id") as { data: SubOpt[] };
  const { data: cores = [] } = useOpt("cores");
  const { data: coresApelido = [] } = useOptCat("cores_apelido", "cor_base_id") as { data: CorApelidoOpt[] };
  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options", "produto-importado-planner"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nome_fantasia, representantes(id, nome)").eq("tipo", "material").order("nome_fantasia");
      if (error) throw error;
      return (data ?? []) as EmpresaFornecedor[];
    },
  });
  const { data: tamanhos = DEFAULT_TAMANHOS } = useQuery({
    queryKey: ["tenant-config-tamanhos-produto-importado"],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_user_tenant_id" as any);
      if (!data) return DEFAULT_TAMANHOS;
      const { data: cfg } = await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", data as string).maybeSingle();
      const raw = (cfg as any)?.tamanhos_grade;
      return Array.isArray(raw) && raw.length > 0 ? raw.map(String) : DEFAULT_TAMANHOS;
    },
  });
  const categoriaNome = useCallback((id: string | null) => categorias.find((c) => c.id === id)?.nome ?? "?", [categorias]);
  const grupoNome = useCallback((id: string | null) => grupos.find((g) => g.id === id)?.nome ?? "?", [grupos]);
  // Estado combinável: NENHUM marcado → lista plana "Todos"; os dois marcados → Grupo ›
  // Categoria aninhado (lane de TOPO = Grupo, sub-seção = Categoria).
  const semAgrupamento = !agrupar.grupo && !agrupar.categoria;
  const agrupamentoAninhado = agrupar.grupo && agrupar.categoria;
  const nivelMacro: "categoria" | "grupo" = agrupar.grupo ? "grupo" : "categoria";
  const macroNome = nivelMacro === "grupo" ? grupoNome : categoriaNome;
  const macroFallback = nivelMacro === "grupo" ? "Sem grupo" : "Sem categoria";
  const macroCampo = useCallback(
    (p: ProdutoImportadoDraft) => (nivelMacro === "grupo" ? p.grupo_id : p.categoria_id),
    [nivelMacro],
  );

  const dirty = JSON.stringify(drafts) !== baseline;
  const fecharDeVez = () => { setBaseline(JSON.stringify(drafts)); onClose(); };
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose: fecharDeVez });

  const patchDraft = (id: string, patch: Partial<ProdutoImportadoDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const removeDraft = (id: string) => setDrafts((ds) => ds.filter((d) => d.id !== id));
  // Um card aberto por vez (feedback do dono: cards abertos ficavam gigantes empilhados). Abrir
  // um fecha os demais — o card fechado é compacto (só o header-resumo).
  const toggleCard = (id: string) => setOpenCards((s) => (s.has(id) ? new Set() : new Set([id])));

  const produtosDeSub = (nome: string | null) => drafts.filter((d) => (d.subcolecao ?? null) === nome);

  const irParaSubcolecoes = () => { setView("subcolecoes"); onSubChange?.(null); };
  const abrirCanvasDe = (sub: { id: string | null; nome: string | null }) => {
    setSubAtual(sub);
    setView("canvas");
    onSubChange?.(sub.id ?? "none");
  };

  const criarDraft = (dados: { nome: string; grupo_id: string | null; categoria_id: string | null; subcategoria1_id: string | null; subcategoria2_id: string | null }) => {
    const novo: ProdutoImportadoDraft = { ...emptyDraft(colecaoId, subAtual?.nome ?? null), id: novoIdLocal(), ...dados };
    setDrafts((ds) => [...ds, novo]);
    setOpenCards(new Set([novo.id!]));
  };

  // TODO (próxima fase): trocar por RPC real (`salvar_produto_importado` + `salvar_
  // variantes_importado`/etapas) — por ora só sinaliza que a persistência ainda não existe,
  // sem perder o rascunho em memória.
  const salvar = () => {
    // eslint-disable-next-line no-console
    console.log("[produto-importado] TODO: persistência via RPC na próxima fase.", drafts);
    toast.info("Em breve: persistência no banco. Por ora o rascunho fica só nesta tela.");
    setBaseline(JSON.stringify(drafts));
  };

  const produtosSub = subAtual ? produtosDeSub(subAtual.nome) : [];
  const pecasSub = produtosSub.reduce((a, p) => a + (Number(p.qtd_total) || 0), 0);

  // Lanes do canvas: chaves distintas do campo MACRO ativo (categoria_id OU grupo_id), `null`
  // sempre por último (vira a lane de fallback "Sem categoria"/"Sem grupo").
  const laneKeys = useMemo(() => {
    const set = [...new Set(produtosSub.map(macroCampo))];
    return set.sort((a, b) => {
      if (a === b) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return macroNome(a).localeCompare(macroNome(b), "pt-BR", { sensitivity: "base" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtosSub, categorias, grupos, nivelMacro]);

  // Ordena as sub-lanes de categoria DENTRO de um grupo (modo aninhado) — mesma regra de
  // ordenação das lanes macro (alfabética PT-BR, `null`/"Sem categoria" por último).
  const subLaneKeysDe = useCallback(
    (itensDoGrupo: ProdutoImportadoDraft[]) =>
      [...new Set(itensDoGrupo.map((p) => p.categoria_id))].sort((a, b) => {
        if (a === b) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        return categoriaNome(a).localeCompare(categoriaNome(b), "pt-BR", { sensitivity: "base" });
      }),
    [categoriaNome],
  );

  // Linha de cards (mesmo card, mesmas props) — extraído p/ ser reusado tanto na lane simples
  // (categoria/grupo) quanto na sub-seção do modo aninhado (grupo-categoria), sem duplicar o
  // JSX do `ProdutoImportadoCard`.
  const renderCardsRow = (itens: ProdutoImportadoDraft[]) => (
    <div className="flex items-start gap-3 overflow-x-auto pb-2 max-md:snap-x max-md:snap-mandatory">
      {itens.map((d) => (
        <div key={d.id} className="w-[420px] max-md:w-[90vw] shrink-0 max-md:snap-start">
          <ProdutoImportadoCard
            draft={d}
            onChange={(patch) => patchDraft(d.id!, patch)}
            open={openCards.has(d.id!)}
            onToggleOpen={() => toggleCard(d.id!)}
            grupos={grupos}
            categorias={categorias}
            subcats1={subcats1}
            subcats2={subcats2}
            cores={cores}
            coresApelido={coresApelido}
            empresas={empresas}
            tamanhos={tamanhos}
            onExcluir={() => removeDraft(d.id!)}
          />
        </div>
      ))}
    </div>
  );

  const bucketAtual = subAtual ? bucketDe(subAtual.nome) : null;
  const vagasAtual = subAtual ? vagasDe(subAtual.nome) : 0;

  return (
    <Sheet open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <SheetContent side="right" size="full" className="flex flex-col p-0 gap-0 max-sm:[&>button]:hidden">
        <div className="sticky top-0 z-10 flex flex-col gap-1.5 border-b bg-background p-3">
          <div className="flex items-center gap-2">
            <Breadcrumb items={[
              { label: "Estilo & Engenharia" },
              { label: "Produto Importado", onClick: requestClose },
              { label: colecao?.nome ?? "…", onClick: view === "canvas" ? irParaSubcolecoes : undefined },
              ...(view === "canvas" && subAtual ? [{ label: subAtual.nome ?? "Sem subcoleção" }] : []),
            ]} />
            <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
          </div>
        </div>

        {!carregado ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : view === "subcolecoes" ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">Subcoleções</h2>
                <p className="text-sm text-muted-foreground">Escolha uma subcoleção para planejar os produtos importados.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[...subList.map((s) => ({ id: s.id as string | null, nome: s.nome as string | null })), { id: null, nome: null }].map((sub, i) => {
                const itens = produtosDeSub(sub.nome);
                const pecas = itens.reduce((a, p) => a + (Number(p.qtd_total) || 0), 0);
                const bucket = bucketDe(sub.nome);
                const vagas = vagasDe(sub.nome);
                return (
                  <button key={sub.id ?? `__sem__${i}`} type="button"
                    className="flex flex-col gap-2 rounded-lg border bg-background p-4 text-left shadow-sm transition-shadow hover:border-primary hover:shadow-md"
                    onClick={() => abrirCanvasDe(sub)}>
                    <div className="font-medium">{sub.nome ?? "Sem subcoleção"}</div>
                    <div className="text-xs text-muted-foreground">
                      <b className="text-foreground">{itens.length}</b> produto(s) · {pecas} pç
                      {bucket && bucket.total > 0 && ` · ${bucket.realizado} de ${bucket.total} modelos`}
                      {vagas > 0 && <span className="ml-1 font-medium text-primary">· {vagas} vaga{vagas === 1 ? "" : "s"}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 overflow-hidden">
              <div className="hidden w-[46px] shrink-0 flex-col items-center gap-1.5 border-r pt-3 md:flex">
                <button type="button" onClick={() => setResumoAberto((v) => !v)} title="Resumo"
                  className={`flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[9px] font-semibold uppercase tracking-wide ${resumoAberto ? "border-primary/40 bg-primary/10 text-primary" : "border-transparent text-muted-foreground hover:bg-muted"}`}>
                  <PanelLeft className="h-4 w-4" />
                  <span className="[writing-mode:vertical-rl] rotate-180">Resumo</span>
                </button>
              </div>
              {resumoAberto && (
                <aside className="hidden w-80 shrink-0 flex-col overflow-hidden border-r md:flex lg:w-96">
                  <div className="flex-1 overflow-y-auto p-3">
                    <ResumoImportadoPanel
                      produtos={produtosSub}
                      bucket={bucketAtual}
                      nivelMacro={nivelMacro}
                      categorias={categorias}
                      grupos={grupos}
                    />
                  </div>
                </aside>
              )}
              <main className="flex-1 overflow-y-auto p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  {/* Resumo no MOBILE: rail/aside somem (`hidden md:flex`) — este botão abre o
                      mesmo painel num Sheet lateral esquerdo (só existe < md). */}
                  <div className="flex items-center gap-2 md:hidden">
                    <span className="text-sm text-muted-foreground">{produtosSub.length} produto(s) · {pecasSub} pç</span>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => setResumoMobileOpen(true)}>
                      <PanelLeft className="h-3.5 w-3.5" /> Resumo
                    </Button>
                  </div>
                  <span className="hidden text-sm text-muted-foreground md:inline">{produtosSub.length} produto(s) · {pecasSub} pç</span>
                  <div className="flex items-center gap-2">
                    <AgrupamentoButton groups={[
                      { label: "Grupo", active: agrupar.grupo, onToggle: () => setAgrupar({ grupo: !agrupar.grupo }) },
                      { label: "Categoria", active: agrupar.categoria, onToggle: () => setAgrupar({ categoria: !agrupar.categoria }) },
                    ]} />
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => setNovoOpen(true)}>
                      <Plus className="h-3.5 w-3.5" /> Novo produto
                    </Button>
                  </div>
                </div>

                <div className="space-y-4">
                  {produtosSub.length === 0 && (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      Nenhum produto importado nesta subcoleção ainda — clique em "Novo produto".
                    </div>
                  )}
                  {/* Nenhum checkbox marcado → lista plana "Todos", sem lanes. */}
                  {semAgrupamento && produtosSub.length > 0 && (
                    <section>
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="text-sm font-semibold">Todos</span>
                        <span className="rounded-full border px-2 text-[11px] text-muted-foreground">
                          {produtosSub.length} produtos · {pecasSub} pç
                        </span>
                      </div>
                      {renderCardsRow(produtosSub)}
                    </section>
                  )}
                  {!semAgrupamento && laneKeys.map((laneKey) => {
                    const itens = produtosSub.filter((p) => macroCampo(p) === laneKey);
                    if (itens.length === 0) return null;
                    const pecas = itens.reduce((a, p) => a + (Number(p.qtd_total) || 0), 0);
                    const header = (
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className={`text-sm font-semibold ${laneKey ? "" : "text-muted-foreground"}`}>{laneKey ? macroNome(laneKey) : macroFallback}</span>
                        <span className="rounded-full border px-2 text-[11px] text-muted-foreground">{itens.length} produtos · {pecas} pç</span>
                      </div>
                    );
                    if (!agrupamentoAninhado) {
                      return (
                        <section key={laneKey ?? "__sem__"}>
                          {header}
                          {renderCardsRow(itens)}
                        </section>
                      );
                    }
                    const subKeys = subLaneKeysDe(itens);
                    return (
                      <section key={laneKey ?? "__sem__"}>
                        {header}
                        <div className="space-y-3 border-l-2 pl-3">
                          {subKeys.map((subKey) => {
                            const subItens = itens.filter((p) => p.categoria_id === subKey);
                            const subPecas = subItens.reduce((a, p) => a + (Number(p.qtd_total) || 0), 0);
                            return (
                              <div key={subKey ?? "__sem_cat__"}>
                                <div className="mb-1 flex items-center gap-1.5">
                                  <span className={`text-xs font-semibold ${subKey ? "text-muted-foreground" : "text-muted-foreground/70"}`}>{subKey ? categoriaNome(subKey) : "Sem categoria"}</span>
                                  <span className="rounded-full border px-1.5 text-[10px] text-muted-foreground">{subItens.length} · {subPecas} pç</span>
                                </div>
                                {renderCardsRow(subItens)}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    );
                  })}
                  {/* Vagas do OTB — ENXUTO (mudança do dono): UM bloco tracejado só, com
                      subtexto "de N vagas" — não repete N blocos como o Produto Acabado. */}
                  {vagasAtual > 0 && (
                    <section>
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="text-sm font-semibold text-muted-foreground">Disponíveis para criar</span>
                        <span className="rounded-full border px-2 text-[11px] text-muted-foreground">{vagasAtual} vaga(s)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setNovoOpen(true)}
                        title="Criar um novo produto nesta vaga"
                        className="flex h-24 w-[420px] max-md:w-[90vw] flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
                      >
                        <Plus className="h-5 w-5" />
                        <span className="text-xs font-medium">Novo produto</span>
                        <span className="text-[10px] text-muted-foreground/80">de {vagasAtual} vaga{vagasAtual === 1 ? "" : "s"}</span>
                      </button>
                    </section>
                  )}
                </div>
              </main>
            </div>
          </div>
        )}

        <div className="shrink-0 border-t bg-background p-3 flex items-center gap-2">
          <Button variant="outline" size="sm" className="max-sm:h-11" onClick={() => (view === "canvas" ? irParaSubcolecoes() : requestClose())}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {view === "canvas" ? "Subcoleções" : "Voltar"}
          </Button>
          <div className="ml-auto" />
          <Button disabled={!dirty} onClick={salvar}>
            {dirty ? "Salvar" : "Salvo"}
          </Button>
        </div>

        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas no planejador de Produto Importado." />

        <NovoProdutoImportadoDialog
          open={novoOpen}
          onClose={() => setNovoOpen(false)}
          grupos={grupos}
          categorias={categorias}
          subcats1={subcats1}
          subcats2={subcats2}
          onCriar={criarDraft}
        />

        {/* Resumo MOBILE — Sheet lateral esquerdo (só existe < md; no desktop o aside fixo
            acima já cobre o mesmo painel). */}
        <Sheet open={resumoMobileOpen} onOpenChange={setResumoMobileOpen}>
          <SheetContent side="left" className="w-80 p-0 md:hidden">
            <div className="border-b p-4">
              <h2 className="font-display text-base font-semibold">Resumo da subcoleção</h2>
              <p className="text-xs text-muted-foreground">{colecao?.nome ?? ""}{subAtual ? ` · ${subAtual.nome ?? "Sem subcoleção"}` : ""}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <ResumoImportadoPanel
                produtos={produtosSub}
                bucket={bucketAtual}
                nivelMacro={nivelMacro}
                categorias={categorias}
                grupos={grupos}
              />
            </div>
          </SheetContent>
        </Sheet>
      </SheetContent>
    </Sheet>
  );
}
