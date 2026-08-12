import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowLeft, PanelLeft, Plus, ShoppingCart } from "lucide-react";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { AgrupamentoExclusivoButton } from "@/components/shared/filters";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useOrcamento } from "@/components/otb/orcamento";
import { ProdutoCard } from "./ProdutoCard";
import { ResumoRevendaPanel } from "./ResumoRevendaPanel";
import { NovoProdutoDialog } from "./NovoProdutoDialog";
import {
  chaveDirty, somaPecas, hojeISO, montarDadosProduto, variantesBatemComTotal, erroValidacao,
  type ProdutoDraft, type VarianteDraft, type Opt, type CatOpt, type SubOpt, type CorApelidoOpt,
} from "./shared";
import { DEFAULT_TAMANHOS } from "@/components/oc-p-acabado/shared";
import type { EmpresaFornecedor } from "@/components/shared/FornecedorSelect";

type SubRow = { id: string; nome: string; ordem: number };
type SemanaRow = { subcolecao_id: string | null; qtd_planejada: number | null };

// Agrupamento das lanes do canvas — EXCLUSIVO (Grupo | Categoria, nunca os dois ao mesmo
// tempo, diferente do combinável do Plan. Tecido). Persiste por navegador, mesmo padrão de
// `GROUPBY_LS` em criacao.desenvolvimento.tsx (chave própria, try/catch, default = valor
// atual do sistema antes desta feature = "categoria").
const AGRUPAR_LS = "produto-acabado-agrupar";
type AgruparPor = "categoria" | "grupo";
function lerAgruparPorSalvo(): AgruparPor {
  try { return localStorage.getItem(AGRUPAR_LS) === "grupo" ? "grupo" : "categoria"; } catch { return "categoria"; }
}

// B1 (FIX WAVE, causa raiz): estas opções são gerenciadas no Cadastro (grupos/categorias/
// subcategorias de produto, cores) — igual a `useOpts`/os `useQuery` de grupos_produto em
// `criacao.planejamento.tsx`/`criacao.desenvolvimento.tsx`, que NÃO fixam staleTime (default
// 0 → sempre stale → refetch a cada mount). Um `staleTime` de 5min aqui fazia um grupo recém
// -criado no Cadastro não aparecer no dropdown do "+ Novo produto" se o Sheet fosse reaberto
// dentro da janela de 5min (cache do QueryClient sobrevive ao fechar/reabrir o Sheet, só não
// refaz o fetch enquanto "fresco") — reproduzido ao vivo, corrigido alinhando ao padrão das
// telas irmãs (sem staleTime) em vez de inventar uma invalidação cruzada Cadastro→aqui.
function useOpt(table: string) {
  return useQuery({
    queryKey: ["opt-produto-acabado", table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as Opt[];
    },
  });
}
function useOptCat(table: string, fk: string) {
  return useQuery({
    queryKey: ["opt-produto-acabado-cat", table, fk],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select(`id, nome, ${fk}`).order("nome");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

function rowToDraft(row: any): ProdutoDraft {
  const oc = Array.isArray(row.ocs) && row.ocs.length > 0 ? row.ocs[0] : null;
  const variantes: VarianteDraft[] = ((row.variantes ?? []) as any[])
    .map((v) => ({ ordem: v.ordem, cor_id: v.cor_id, cor_apelido_id: v.cor_apelido_id, peso: Number(v.peso) || 0, qtd: Number(v.qtd) || 0 }))
    .sort((a, b) => a.ordem - b.ordem);
  return {
    id: row.id,
    nome: row.nome,
    ref: row.ref,
    grupo_id: row.grupo_id,
    categoria_id: row.categoria_id,
    subcategoria1_id: row.subcategoria1_id,
    subcategoria2_id: row.subcategoria2_id,
    colecao_id: row.colecao_id,
    subcolecao: row.subcolecao,
    semana: row.semana,
    empresa_id: row.empresa_id,
    representante_id: row.representante_id,
    ref_fornecedor: row.ref_fornecedor ?? "",
    composicao: row.composicao ?? "",
    grade_proporcao: row.grade_proporcao ?? {},
    qtd_total: row.qtd_total ?? 0,
    valor_unitario: Number(row.valor_unitario) || 0,
    desconto_pct: Number(row.desconto_pct) || 0,
    insumos_total: Number(row.insumos_total) || 0,
    modelo_id: row.modelo_id,
    variantes,
    modeloPrecoVenda: row.modelo?.preco_venda != null ? Number(row.modelo.preco_venda) : null,
    modeloPrecoAtacado: row.modelo?.preco_atacado != null ? Number(row.modelo.preco_atacado) : null,
    modeloLinhaId: row.modelo?.linha_id ?? null,
    oc: oc
      ? {
          id: oc.id,
          numero: oc.numero,
          status: oc.status,
          qtd_total: oc.qtd_total ?? 0,
          valor_unitario_real: Number(oc.valor_unitario_real) || 0,
          grade_detalhe: oc.grade_detalhe ?? {},
        }
      : null,
  };
}

const SELECT_PRODUTO = `
  id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
  colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor, composicao,
  grade_proporcao, qtd_total, valor_unitario, desconto_pct, insumos_total, modelo_id,
  variantes:produto_acabado_variantes(ordem, cor_id, cor_apelido_id, peso, qtd),
  modelo:modelo_id(preco_venda, preco_atacado, linha_id),
  ocs:ocs_p_acabado(id, numero, status, qtd_total, valor_unitario_real, grade_detalhe)
`;

/**
 * Sheet full-screen do planejador Produto Acabado — réplica dos padrões visuais de
 * `PlanTecidoSheet.tsx` (navegação lista→Sheet→grid de subcoleções→canvas, Breadcrumb
 * sticky + UnsavedIndicator, aside de resumo colapsável, lanes por categoria, rodapé
 * fixo) SEM copiar o arquivo — sem colab/DnD/multi-seleção (fora de escopo desta feature,
 * ver design spec §"Fora de escopo").
 */
export function ProdutoAcabadoSheet({ colecaoId, subInicial = null, onSubChange, onClose }: {
  colecaoId: string;
  subInicial?: string | null;
  onSubChange?: (subId: string | null) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [view, setView] = useState<"subcolecoes" | "canvas">("subcolecoes");
  const [subAtual, setSubAtual] = useState<{ id: string | null; nome: string | null } | null>(null);
  const [drafts, setDrafts] = useState<ProdutoDraft[] | null>(null);
  const [openCards, setOpenCards] = useState<Set<string>>(new Set());
  const [resumoAberto, setResumoAberto] = useState(true);
  const [novoOpen, setNovoOpen] = useState(false);
  const [pedidoPickerOpen, setPedidoPickerOpen] = useState(false);
  const [agruparPor, setAgruparPorState] = useState<AgruparPor>(lerAgruparPorSalvo);
  const setAgruparPor = (v: AgruparPor) => {
    setAgruparPorState(v);
    try { localStorage.setItem(AGRUPAR_LS, v); } catch { /* ignore */ }
  };
  const resolvedInicialRef = useRef({ done: false });

  const navPermitida = useCallback(
    (next: { pathname?: string; search?: Record<string, unknown> }) =>
      String(next?.pathname ?? "").includes("/criacao/produto-acabado") && next?.search?.colecao === colecaoId,
    [colecaoId],
  );

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

  const { data: semanas = [] } = useQuery({
    queryKey: ["colecao-semanas-alvo", colecaoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("colecao_semanas" as any).select("subcolecao_id, qtd_planejada").eq("colecao_id", colecaoId);
      if (error) throw error;
      return (data ?? []) as unknown as SemanaRow[];
    },
  });
  const alvoPorSub = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const s of semanas) {
      const key = s.subcolecao_id ?? null;
      m.set(key, (m.get(key) ?? 0) + (Number(s.qtd_planejada) || 0));
    }
    return m;
  }, [semanas]);

  // Item 1 (slots vazios de OTB): {total, realizado} por subcoleção via a MESMA RPC/queryKey
  // (["otb-orcamento"]) que o Plan. Tecido usa p/ vagas — `realizado` conta `modelos` (não
  // `produtos_acabados`), então é o orçamento COMPARTILHADO entre os planejadores que criam
  // card nesta subcoleção. `total` casa com `alvoPorSub` p/ coleções tipo 'orcamento', mas
  // também cobre 'poder_venda' (que `alvoPorSub`, lido só de `colecao_semanas`, não cobre).
  // Refino (item 1, ago/2026): staleTime 0 + refetch em foco/montagem SEMPRE — o critério do
  // dono é "mudou lá, volto pra cá, número novo". O `staleTime: 30_000` default (herdado pelas
  // outras telas do OTB) deixava "vagas" velhas por até 30s mesmo já invalidado, e não cobre
  // troca de ABA do navegador (QueryClient é por-aba; sem realtime cross-aba de propósito —
  // foco/montagem já resolve o caso real, dentro da mesma aba, que é o critério do dono).
  const orc = useOrcamento({ staleTime: 0, refetchOnWindowFocus: true, refetchOnMount: "always" });
  const vagasDe = (nome: string | null): number => {
    if (!nome) return 0;
    const b = orc.subcolecao(colecaoId, nome);
    return b ? Math.max(0, b.total - b.realizado) : 0;
  };

  // ── Opções (taxonomia, cores, fornecedores, tamanhos, markup) — carregadas 1x pra tela toda ──
  const { data: grupos = [] } = useOpt("grupos_produto");
  const { data: categorias = [] } = useOptCat("categorias_produto", "grupo_id") as { data: CatOpt[] };
  const { data: subcats1 = [] } = useOptCat("subcategorias1_produto", "categoria_id") as { data: SubOpt[] };
  const { data: subcats2 = [] } = useOptCat("subcategorias2_produto", "categoria_id") as { data: SubOpt[] };
  const { data: cores = [] } = useOpt("cores");
  const { data: coresApelido = [] } = useOptCat("cores_apelido", "cor_base_id") as { data: CorApelidoOpt[] };
  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options", "produto-acabado-planner"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nome_fantasia, representantes(id, nome)").eq("tipo", "material").order("nome_fantasia");
      if (error) throw error;
      return (data ?? []) as EmpresaFornecedor[];
    },
  });
  const { data: tamanhos = DEFAULT_TAMANHOS } = useQuery({
    queryKey: ["tenant-config-tamanhos-produto-acabado"],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_user_tenant_id" as any);
      if (!data) return DEFAULT_TAMANHOS;
      const { data: cfg } = await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", data as string).maybeSingle();
      const raw = (cfg as any)?.tamanhos_grade;
      return Array.isArray(raw) && raw.length > 0 ? raw.map(String) : DEFAULT_TAMANHOS;
    },
  });
  const { data: linhasMarkup = {} } = useQuery({
    queryKey: ["linhas-markup"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.from("linhas").select("id, markup");
      if (error) throw error;
      return Object.fromEntries(((data ?? []) as { id: string; markup: number | null }[]).map((r) => [r.id, Number(r.markup) || 0])) as Record<string, number>;
    },
  });
  const categoriaNome = useCallback((id: string | null) => categorias.find((c) => c.id === id)?.nome ?? "?", [categorias]);
  const grupoNome = useCallback((id: string | null) => grupos.find((g) => g.id === id)?.nome ?? "?", [grupos]);
  // Campo/rótulo/fallback do agrupamento ATIVO — item 2 do pedido: produto sem a taxonomia
  // usada pra agrupar cai numa lane de fallback ("Sem categoria"/"Sem grupo"), NUNCA some
  // (ex. "Cinto Teste": grupo Acessório, categoria NULL — estado válido).
  const laneNome = agruparPor === "grupo" ? grupoNome : categoriaNome;
  const laneFallback = agruparPor === "grupo" ? "Sem grupo" : "Sem categoria";
  const laneCampo = useCallback(
    (p: ProdutoDraft) => (agruparPor === "grupo" ? p.grupo_id : p.categoria_id),
    [agruparPor],
  );

  // ── Produtos da coleção inteira — carregados 1x; a re-hidratação só acontece no load
  //     inicial (ver effect abaixo). Sem colab/merge (fora de escopo) — invalidações de cache
  //     posteriores (após criar/salvar) não perturbam os `drafts` já em memória, só a query. ──
  const produtosQuery = useQuery({
    queryKey: ["produtos-acabados", colecaoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("produtos_acabados" as any).select(SELECT_PRODUTO).eq("colecao_id", colecaoId).order("nome");
      if (error) throw error;
      return ((data ?? []) as any[]).map(rowToDraft);
    },
  });

  // Baseline de dirty POR PRODUTO (id → snapshot serializado dos campos de `chaveDirty`) — não
  // é o `useDirtySnapshot` de 1 blob só. Achado no fix round 1: "Fazer pedido" já persiste o
  // produto via `salvarUmProduto` ANTES de navegar (item 4a), mas um baseline de blob único só
  // zera com `markClean()` do Salvar em LOTE — a navegação subsequente via `useBlocker` via
  // `navigate()` continuava vendo `dirty=true` (achando que a Compra recém-persistida ainda
  // estava suja) e disparava "Descartar alterações?" logo depois do toast de sucesso, uma
  // contradição visual (dado JÁ salvo, prompt dizendo o contrário). Com baseline por produto,
  // `salvarUmProduto` marca SÓ o produto que persistiu, sem esconder edições pendentes dos
  // demais cards abertos ao mesmo tempo.
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const dirty = (drafts ?? []).some((p) => JSON.stringify(chaveDirty(p)) !== baseline[p.id]);
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose, blockNav: true, navPermitida });

  const marcarProdutoLimpo = (p: ProdutoDraft) => setBaseline((b) => ({ ...b, [p.id]: JSON.stringify(chaveDirty(p)) }));

  useEffect(() => {
    if (produtosQuery.data && drafts === null) {
      setDrafts(produtosQuery.data);
      setBaseline(Object.fromEntries(produtosQuery.data.map((p) => [p.id, JSON.stringify(chaveDirty(p))])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtosQuery.data, drafts]);

  // Resolve a subcoleção da URL (deep-link) uma vez, assim que a lista carregar.
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

  const patchProduto = (id: string, patch: Partial<ProdutoDraft>) =>
    setDrafts((ds) => (ds ? ds.map((p) => (p.id === id ? { ...p, ...patch } : p)) : ds));
  const changeProduto = (next: ProdutoDraft) => setDrafts((ds) => (ds ? ds.map((p) => (p.id === next.id ? next : p)) : ds));
  const removeProduto = (id: string) => setDrafts((ds) => (ds ? ds.filter((p) => p.id !== id) : ds));
  const toggleCard = (id: string) => setOpenCards((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const produtosDeSub = (nome: string | null) => (drafts ?? []).filter((p) => (p.subcolecao ?? null) === nome);

  // Save de UM produto — fonte ÚNICA reusada pelo Salvar em lote (abaixo) E pelo "Fazer
  // pedido" de cada card (`ProdutoCard`, que precisa persistir a Compra ANTES de gerar a OC —
  // fix round 1 item 4). Nunca redistribui sozinho (`redistribuir:"false"` sempre, via
  // `montarDadosProduto`) — bloqueia com mensagem clara em vez de mandar o servidor rejeitar.
  const salvarUmProduto = async (p: ProdutoDraft) => {
    if (!variantesBatemComTotal(p)) {
      throw erroValidacao(
        `A soma das variantes (${somaPecas(p)}) precisa bater com a Qtd total (${p.qtd_total}) de "${p.nome}" — use "Redistribuir por peso" ou corrija manualmente.`,
      );
    }
    const { error } = await supabase.rpc("salvar_produto_acabado" as any, {
      _id: p.id,
      _dados: montarDadosProduto(p),
      _variantes: p.variantes,
    });
    if (error) throw error;
    marcarProdutoLimpo(p); // baseline por produto — ver comentário acima (fix round 1 item 4b)
  };

  const salvarMut = useMutation({
    mutationFn: async () => {
      const lista = drafts ?? [];
      const invalidas = lista.filter((p) => !variantesBatemComTotal(p));
      if (invalidas.length > 0) {
        throw erroValidacao(
          `A soma das variantes precisa bater com a Qtd total antes de salvar — use "Redistribuir por peso" ou corrija manualmente em: ${invalidas.map((p) => p.nome).join(", ")}.`,
        );
      }
      await Promise.all(lista.map((p) => salvarUmProduto(p)));
    },
    onSuccess: () => {
      toast.success("Produtos salvos.");
      qc.invalidateQueries({ queryKey: ["produtos-acabados"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar.")),
  });

  const irParaSubcolecoes = () => { setView("subcolecoes"); onSubChange?.(null); };

  const abrirCanvasDe = (sub: { id: string | null; nome: string | null }) => {
    setSubAtual(sub);
    setView("canvas");
    onSubChange?.(sub.id ?? "none");
  };

  const produtosSub = subAtual ? produtosDeSub(subAtual.nome) : [];
  // Lanes do canvas: chaves distintas do campo ativo (categoria_id OU grupo_id), `null`
  // sempre por último (vira a lane de fallback "Sem categoria"/"Sem grupo").
  const laneKeys = useMemo(() => {
    const set = [...new Set(produtosSub.map(laneCampo))];
    return set.sort((a, b) => {
      if (a === b) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return laneNome(a).localeCompare(laneNome(b), "pt-BR", { sensitivity: "base" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtosSub, categorias, grupos, agruparPor]);

  const alvoAtual = subAtual ? alvoPorSub.get(subAtual.id) ?? null : null;
  const vagasAtual = subAtual ? vagasDe(subAtual.nome) : 0;
  const semOc = produtosSub.filter((p) => !p.oc);

  return (
    <Sheet open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <SheetContent side="right" className="w-screen max-w-none sm:max-w-none flex flex-col p-0 max-sm:[&>button]:hidden">
        <div className="sticky top-0 z-10 flex flex-col gap-1.5 border-b bg-background p-3">
          <div className="flex items-center gap-2">
            <Breadcrumb items={[
              { label: "Estilo & Engenharia" },
              { label: "Produto Acabado", onClick: requestClose },
              { label: colecao?.nome ?? "…", onClick: view === "canvas" ? irParaSubcolecoes : undefined },
              ...(view === "canvas" && subAtual ? [{ label: subAtual.nome ?? "Sem subcoleção" }] : []),
            ]} />
            <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
          </div>
        </div>

        {drafts === null ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : view === "subcolecoes" ? (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-semibold tracking-tight">Subcoleções</h2>
                <p className="text-sm text-muted-foreground">Escolha uma subcoleção para planejar os produtos de revenda.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[...subList.map((s) => ({ id: s.id as string | null, nome: s.nome as string | null })), { id: null, nome: null }].map((sub, i) => {
                const itens = produtosDeSub(sub.nome);
                const pecas = itens.reduce((a, p) => a + somaPecas(p), 0);
                const alvo = alvoPorSub.get(sub.id) ?? null;
                const vagas = vagasDe(sub.nome);
                return (
                  <button key={sub.id ?? `__sem__${i}`} type="button"
                    className="flex flex-col gap-2 rounded-lg border bg-background p-4 text-left shadow-sm transition-shadow hover:border-primary hover:shadow-md"
                    onClick={() => abrirCanvasDe(sub)}>
                    <div className="font-medium">{sub.nome ?? "Sem subcoleção"}</div>
                    <div className="text-xs text-muted-foreground">
                      <b className="text-foreground">{itens.length}</b> produto(s) · {pecas} pç{alvo ? ` (alvo ${alvo})` : ""}
                      {vagas > 0 && <span className="ml-1 font-medium text-primary">· {vagas} disponíve{vagas === 1 ? "l" : "is"}</span>}
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
                    <ResumoRevendaPanel
                      produtos={produtosSub}
                      agruparPor={agruparPor}
                      categoriaNome={categoriaNome}
                      grupoNome={grupoNome}
                      otbAlvo={alvoAtual}
                    />
                  </div>
                </aside>
              )}
              <main className="flex-1 overflow-y-auto p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">{produtosSub.length} produto(s) · {produtosSub.reduce((a, p) => a + somaPecas(p), 0)} pç</span>
                  <div className="flex items-center gap-2">
                    <AgrupamentoExclusivoButton
                      value={agruparPor}
                      onChange={(v) => setAgruparPor(v as AgruparPor)}
                      options={[
                        { value: "categoria", label: "Categoria" },
                        { value: "grupo", label: "Grupo" },
                      ]}
                    />
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => setNovoOpen(true)}>
                      <Plus className="h-3.5 w-3.5" /> Novo produto
                    </Button>
                  </div>
                </div>
                <div className="space-y-4">
                  {produtosSub.length === 0 && (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      Nenhum produto nesta subcoleção ainda — clique em "Novo produto".
                    </div>
                  )}
                  {laneKeys.map((laneKey) => {
                    const itens = produtosSub.filter((p) => laneCampo(p) === laneKey);
                    if (itens.length === 0) return null;
                    const pecas = itens.reduce((a, p) => a + somaPecas(p), 0);
                    return (
                      <section key={laneKey ?? "__sem__"}>
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className={`text-sm font-semibold ${laneKey ? "" : "text-muted-foreground"}`}>{laneKey ? laneNome(laneKey) : laneFallback}</span>
                          <span className="rounded-full border px-2 text-[11px] text-muted-foreground">{itens.length} produtos · {pecas} pç</span>
                        </div>
                        <div className="flex items-start gap-3 overflow-x-auto pb-2">
                          {itens.map((p) => (
                            <div key={p.id} className="w-[420px] max-md:w-[90vw] shrink-0">
                              <ProdutoCard
                                produto={p}
                                onChange={changeProduto}
                                open={openCards.has(p.id)}
                                onToggleOpen={() => toggleCard(p.id)}
                                grupos={grupos}
                                categorias={categorias}
                                subcats1={subcats1}
                                subcats2={subcats2}
                                cores={cores}
                                coresApelido={coresApelido}
                                empresas={empresas}
                                tamanhos={tamanhos}
                                colecaoNome={colecao?.nome ?? null}
                                linhasMarkup={linhasMarkup}
                                onSalvarProduto={salvarUmProduto}
                                onCardCriado={(modeloId) => patchProduto(p.id, { modelo_id: modeloId, modeloPrecoVenda: null, modeloPrecoAtacado: null, modeloLinhaId: null })}
                                onOcVinculada={(oc) => patchProduto(p.id, { oc })}
                                onExcluido={() => removeProduto(p.id)}
                              />
                            </div>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                  {/* Item 1: vagas de OTB disponíveis nesta subcoleção (N = alvo − modelos
                      existentes, via `useOrcamento()`/["otb-orcamento"] — mesmo orçamento
                      compartilhado do Plan. Tecido). Cards tracejados clicáveis abrem "+ Novo
                      produto" já contextualizado na subcoleção aberta. */}
                  {vagasAtual > 0 && (
                    <section>
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="text-sm font-semibold text-muted-foreground">Disponíveis para criar</span>
                        <span className="rounded-full border px-2 text-[11px] text-muted-foreground">{vagasAtual} vaga(s)</span>
                      </div>
                      <div className="flex items-start gap-3 overflow-x-auto pb-2">
                        {Array.from({ length: vagasAtual }, (_, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setNovoOpen(true)}
                            title="Criar um novo produto nesta vaga"
                            className="flex h-24 w-[420px] max-md:w-[90vw] shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary"
                          >
                            <Plus className="h-5 w-5" />
                            <span className="text-xs font-medium">Novo produto</span>
                          </button>
                        ))}
                      </div>
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
          {view === "canvas" && (
            <Button variant="outline" size="sm" className="max-sm:h-11" onClick={() => setPedidoPickerOpen(true)}>
              <ShoppingCart className="mr-1 h-4 w-4" />
              <span className="hidden sm:inline">Fazer pedido</span>
              <span className="sm:hidden">Pedido</span>
            </Button>
          )}
          <Button disabled={!dirty || salvarMut.isPending} onClick={() => salvarMut.mutate()}>
            {salvarMut.isPending ? "Salvando…" : dirty ? "Salvar" : "Salvo"}
          </Button>
        </div>

        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas no planejador de Produto Acabado." />

        <NovoProdutoDialog
          open={novoOpen}
          onClose={() => setNovoOpen(false)}
          colecaoId={colecaoId}
          subcolecaoNome={subAtual?.nome ?? null}
          grupos={grupos}
          categorias={categorias}
          subcats1={subcats1}
          subcats2={subcats2}
          empresas={empresas}
          onCreated={async (id) => {
            const { data, error } = await supabase.from("produtos_acabados" as any).select(SELECT_PRODUTO).eq("id", id).maybeSingle();
            if (!error && data) {
              const novo = rowToDraft(data);
              setDrafts((ds) => (ds ? [...ds, novo] : [novo]));
              marcarProdutoLimpo(novo); // já veio fresco do servidor — nasce limpo
              setOpenCards((s) => new Set([...s, novo.id]));
            }
            qc.invalidateQueries({ queryKey: ["produtos-acabados"] });
          }}
        />

        {/* Fazer pedido (rodapé): escolhe um produto da subcoleção sem OC vinculada e abre o
            card dele — a criação em si acontece no botão "Fazer pedido" da seção 3 do card
            (mesma ação; evita duplicar a construção do payload da OC). */}
        <Dialog open={pedidoPickerOpen} onOpenChange={setPedidoPickerOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Fazer pedido</DialogTitle></DialogHeader>
            {semOc.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todos os produtos desta subcoleção já têm OC vinculada.</p>
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {semOc.map((p) => (
                  <button key={p.id} type="button"
                    onClick={() => {
                      setPedidoPickerOpen(false);
                      setOpenCards((s) => new Set([...s, p.id]));
                      requestAnimationFrame(() => document.getElementById(`produto-card-${p.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left text-sm hover:bg-muted">
                    <span className="min-w-0 truncate"><b>{p.nome}</b> {p.ref ? `· ${p.ref}` : ""}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{somaPecas(p)} pç</span>
                  </button>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
