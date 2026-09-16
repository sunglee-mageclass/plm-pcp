import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BrushCleaning, ChevronRight, ClipboardList, CopyPlus, PanelLeft, Plus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { AgrupamentoButton } from "@/components/shared/filters";
import { RecolherMenu } from "@/components/plan-tecido/RecolherMenu";
import { useAgrupamentoState } from "@/hooks/useAgrupamentoState";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { ColabPresenceOverlay } from "@/components/shared/ColabPresenceOverlay";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import { mergeDraft, type Conflito } from "@/lib/colab/merge";
import { pathDoElemento } from "@/lib/colab/colab-field-path";
import { useOrcamento } from "@/components/otb/orcamento";
import { DEFAULT_TAMANHOS } from "@/components/oc-p-acabado/shared";
import { mensagemErro } from "@/lib/erro-mensagem";
import { erroValidacao } from "@/components/produto-acabado/shared";
import type { EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import type { Opt, CatOpt, SubOpt, CorApelidoOpt } from "@/components/produto-acabado/shared";
import { ProdutoImportadoCard } from "./ProdutoImportadoCard";
import { ResumoImportadoPanel } from "./ResumoImportadoPanel";
import { NovoProdutoImportadoDialog } from "./NovoProdutoImportadoDialog";
import { EditarMixDialog } from "@/components/plan-tecido/EditarMixDialog";
import { ReplicarImportadoDialog } from "./ReplicarImportadoDialog";
import { chaveDirty, emptyDraft, montarPayload, validarDraft, type ProdutoImportadoDraft, type VarianteImportadoDraft, type EtapaImportadoDraft } from "./shared";

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

/** Linha crua de `produtos_importados` — TODOS os escalares + variantes/etapas embedadas
 *  (`produto_importado_variantes`/`produto_importado_etapas`, FK `produto_importado_id`).
 *  A query tolera erro/tabela ausente e cai em lista vazia (empty-state "nenhum produto"
 *  em vez de travar a tela). */
type ProdutoImportadoRow = {
  id: string;
  rev: number;
  modelo_id: string | null;
  mix_id: string | null;
  nome: string;
  grupo_id: string | null;
  categoria_id: string | null;
  subcategoria1_id: string | null;
  subcategoria2_id: string | null;
  colecao_id: string | null;
  subcolecao: string | null;
  semana: string | null;
  empresa_id: string | null;
  representante_id: string | null;
  ref_fornecedor: string | null;
  ref: string | null;
  composicao: string | null;
  foto_url: string | null;
  data_pedido: string | null;
  data_prevista: string | null;
  data_entrega: string | null;
  grade_proporcao: Record<string, number> | null;
  qtd_total: number | null;
  moeda_compra: string | null;
  moeda_intermediaria: string | null;
  valor_unitario_m1: number | null;
  cotacao_ref: number | null;
  peso_kg: number | null;
  transporte_m2: number | null;
  desconto_pct: number | null;
  cotacao_final: number | null;
  markup_atacado: number | null;
  markup_varejo: number | null;
  variantes: (VarianteImportadoDraft & { ordem: number })[] | null;
  etapas: (EtapaImportadoDraft & { ordem: number })[] | null;
};

/** Mapeia uma linha crua do banco (com embeds) pro `ProdutoImportadoDraft` completo —
 *  variantes/etapas ordenadas por `ordem`; falta de variante/etapa cai no default do
 *  `emptyDraft` (nunca deixa o card sem nenhuma linha pra editar). */
function draftDeRow(r: ProdutoImportadoRow): ProdutoImportadoDraft {
  const base = emptyDraft(r.colecao_id, r.subcolecao);
  const variantes = [...(r.variantes ?? [])].sort((a, b) => a.ordem - b.ordem);
  const etapas = [...(r.etapas ?? [])].sort((a, b) => a.ordem - b.ordem);
  return {
    ...base,
    id: r.id,
    rev: Number(r.rev) || 0,
    modelo_id: r.modelo_id,
    mix_id: r.mix_id ?? null,
    nome: r.nome,
    grupo_id: r.grupo_id,
    categoria_id: r.categoria_id,
    subcategoria1_id: r.subcategoria1_id,
    subcategoria2_id: r.subcategoria2_id,
    colecao_id: r.colecao_id,
    subcolecao: r.subcolecao,
    semana: r.semana,
    empresa_id: r.empresa_id,
    representante_id: r.representante_id,
    ref_fornecedor: r.ref_fornecedor ?? "",
    ref: r.ref,
    composicao: r.composicao ?? "",
    foto_url: r.foto_url,
    data_pedido: r.data_pedido,
    data_prevista: r.data_prevista,
    data_entrega: r.data_entrega,
    grade_proporcao: r.grade_proporcao ?? {},
    qtd_total: Number(r.qtd_total) || 0,
    moeda_compra: r.moeda_compra ?? "RMB",
    moeda_intermediaria: r.moeda_intermediaria,
    valor_unitario_m1: Number(r.valor_unitario_m1) || 0,
    cotacao_ref: Number(r.cotacao_ref) || 0,
    peso_kg: Number(r.peso_kg) || 0,
    transporte_m2: Number(r.transporte_m2) || 0,
    desconto_pct: Number(r.desconto_pct) || 0,
    cotacao_final: Number(r.cotacao_final) || 0,
    markup_atacado: r.markup_atacado,
    markup_varejo: r.markup_varejo,
    variantes: variantes.length > 0 ? variantes.map((v) => ({ ...v, _touched: false })) : base.variantes,
    etapas: etapas.length > 0 ? etapas : base.etapas,
  };
}

let idSeq = 0;
const novoIdLocal = () => `novo-${Date.now()}-${idSeq++}`;

// Rótulo PT de cada campo de `chaveDirty` — consumido pelo `rotulo` do ColabBanner (colab Fase
// 3) pra formatar "Nome do produto · Campo" em cada linha de conflito pendente. Espelha
// `ROTULO_CAMPO_PA` (`ProdutoAcabadoSheet.tsx`), adaptado aos campos do Importado (moeda/
// cotação/frete/etapas em vez de valor_unitario/desconto/insumos).
const ROTULO_CAMPO_PI: Record<string, string> = {
  nome: "Nome", grupo_id: "Grupo", categoria_id: "Categoria", subcategoria1_id: "Subcategoria 1",
  subcategoria2_id: "Subcategoria 2", empresa_id: "Fornecedor", representante_id: "Representante",
  ref_fornecedor: "Ref. Fornecedor", ref: "REF", composicao: "Composição", foto_url: "Foto",
  data_pedido: "Data do pedido", data_prevista: "Data prevista", data_entrega: "Data de entrega",
  grade_proporcao: "Proporção da grade", qtd_total: "Quantidade total",
  moeda_compra: "Moeda de compra", moeda_intermediaria: "Moeda intermediária",
  valor_unitario_m1: "Valor unitário (M1)", cotacao_ref: "Cotação de referência",
  peso_kg: "Peso (kg)", transporte_m2: "Transporte (M2)", desconto_pct: "Desconto (%)",
  cotacao_final: "Cotação final", markup_atacado: "Markup Atacado", markup_varejo: "Markup Varejo",
  variantes: "Variantes", etapas: "Etapas de pagamento",
};

/**
 * Sheet do planejador Produto Importado. Layout REFATORADO (set/2026) pra bater FIELMENTE
 * com `ProdutoAcabadoSheet.tsx`: canvas em 3 colunas (rail + aside de resumo fixo no desktop
 * + main), cards compactos de 420px em lanes por categoria/grupo (agrupamento combinável via
 * `AgrupamentoButton`), vagas do OTB (bloco único enxuto, ver `renderVagas` abaixo).
 * PERSISTÊNCIA REAL (Fase 1 backend): carrega `produtos_importados` com variantes+etapas
 * embedadas; Salvar chama `salvar_produto_importado` por produto; excluir chama
 * `excluir_produto_importado`. Ainda sem colab/DnD/multi-seleção/OC (Fase 2/3 — Produto
 * Importado não tem OC na Fase 1; rodapé só tem Subcoleções + Salvar).
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
  const [mixDialogOpen, setMixDialogOpen] = useState(false);
  const [resumoAberto, setResumoAberto] = useState(true);
  const [resumoMobileOpen, setResumoMobileOpen] = useState(false);
  // Seleção múltipla (por `d.id`) — barra de seleção sticky com a ação "Replicar card(s)"
  // (espelha `PlanTecidoSheet`, Plan. Tecido). `replicarPayload` guarda os ids ELEGÍVEIS
  // (já persistidos e com modelo_id) + o nº ignorados até o dialog confirmar o destino.
  const [selecao, setSelecao] = useState<Set<string>>(new Set());
  const [replicarPayload, setReplicarPayload] = useState<{ produtoIds: string[]; nIgnorados: number } | null>(null);
  const [replicando, setReplicando] = useState(false);
  // Baseline de dirty POR PRODUTO (id → snapshot serializado dos campos de `chaveDirty`) —
  // espelha `ProdutoAcabadoSheet.tsx` (não é mais o `useDirtySnapshot` de 1 blob só).
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [carregado, setCarregado] = useState(false);
  const resolvedInicialRef = useRef({ done: false });
  const qc = useQueryClient();
  // Presença por campo NO CANVAS (ring nos campos inline dos N cards abertos — molde do canvas do
  // Planejamento). Canal único por COLEÇÃO (colecaoId é prop deste Sheet); o `campoFocado` codifica
  // `card:<idDoCard>:<campo>` — namespaced pelo id do card, já que N cards editáveis ao mesmo tempo.
  const [campoFocadoCanvas, setCampoFocadoCanvas] = useState<string | null>(null);
  const colabScopeRef = useRef<HTMLElement>(null);
  // Merge de conflito colaborativo (Fase 3, set/2026 — molde = ProdutoAcabadoSheet.tsx, merge POR
  // PRODUTO num array). `baseServidorRef` guarda o último snapshot visto do servidor POR PRODUTO
  // (id → ProdutoImportadoDraft) — o "base" do merge 3-vias; `touched` é DERIVADO comparando
  // `chaveDirty(draft atual)` vs `chaveDirty(base)` no momento do merge. `conflitosPorProduto`
  // guarda os conflitos pendentes por produto — consumido pelo guard síncrono do save e pelo
  // `ColabBanner`.
  const baseServidorRef = useRef<Record<string, ProdutoImportadoDraft>>({});
  const [conflitosPorProduto, setConflitosPorProduto] = useState<Record<string, Conflito[]>>({});
  const [ultimoMergeColab, setUltimoMergeColab] = useState<{ atualizados: number; conflitos: number } | null>(null);
  const { presentes: presentesCanvas } = useColabRegistro({
    canal: `colab-prod-importado:${colecaoId}`,
    tabela: "produtos_importados",
    registroId: colecaoId,
    filtroColuna: "colecao_id",
    onMudancaServidor: () => qc.invalidateQueries({ queryKey: ["produtos-importados", colecaoId] }),
    campoFocado: campoFocadoCanvas,
  });
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

  // Carrega os produtos COMPLETOS da coleção — escalares + variantes/etapas embedadas.
  // `as any` porque `produtos_importados` está fora do types.ts (igual ao padrão de
  // `ocs_p_acabado`/`produtos_acabados`). `retry:false` + tolerância a erro: se a tabela/RPC
  // ainda não estiver pronta em alguma loja, cai em lista vazia sem travar a tela.
  const produtosQuery = useQuery({
    queryKey: ["produtos-importados", colecaoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("produtos_importados" as any)
        .select("*, modelo_id, variantes:produto_importado_variantes(*), etapas:produto_importado_etapas(*)")
        .eq("colecao_id", colecaoId);
      if (error) throw error;
      return (data ?? []) as unknown as ProdutoImportadoRow[];
    },
    retry: false,
  });

  const marcarProdutoLimpo = (d: ProdutoImportadoDraft) =>
    setBaseline((b) => (d.id ? { ...b, [d.id]: JSON.stringify(chaveDirty(d)) } : b));

  // Load inicial: seed normal (sem merge, sem conflito) — mesmo shape que alimenta `baseline`.
  // Refetch subsequente (Realtime, `onMudancaServidor` acima, OU invalidação "de fundo" após
  // criar/salvar): MERGE POR PRODUTO em vez de sobrescrever às cegas — espelha
  // `ProdutoAcabadoSheet.tsx` (ver comentário lá para o raciocínio completo). Rascunhos LOCAIS
  // (`id` null/"novo-...", nunca persistidos) nunca têm `base`/`fresh` — ficam de fora do merge,
  // sempre preservados como estão (o servidor não os conhece ainda).
  useEffect(() => {
    // Sucesso OU erro (tabela/RPC ainda não pronta): resolve como "sem produtos" e libera a
    // tela — nunca trava a navegação por causa disso.
    if (!produtosQuery.isSuccess && !produtosQuery.isError) return;
    const linhas = produtosQuery.data ?? [];
    const fresh: ProdutoImportadoDraft[] = linhas.map(draftDeRow);
    if (!carregado) {
      setDrafts(fresh);
      setBaseline(Object.fromEntries(fresh.filter((d) => d.id).map((d) => [d.id as string, JSON.stringify(chaveDirty(d))])));
      baseServidorRef.current = Object.fromEntries(fresh.filter((d) => d.id).map((d) => [d.id as string, d]));
      setCarregado(true);
      return;
    }
    const freshById = new Map(fresh.filter((d) => d.id).map((d) => [d.id as string, d]));
    let totalAtualizados = 0;
    const novosConflitos: Record<string, Conflito[]> = {};
    // IDs que PASSARAM pelo merge nesta rodada — só esses podem ter o conflito RECONSTRUÍDO.
    const idsProcessados = new Set<string>();
    const proximosDrafts: ProdutoImportadoDraft[] = [];
    for (const draft of drafts) {
      if (!draft.id || draft.id.startsWith("novo-")) { proximosDrafts.push(draft); continue; } // rascunho local — fora do merge
      const base = baseServidorRef.current[draft.id];
      const fr = freshById.get(draft.id);
      if (!base || !fr) {
        if (fr) proximosDrafts.push(draft); // base ainda não seedada (produto nasceu agora)
        else if (JSON.stringify(chaveDirty(draft)) === baseline[draft.id]) continue; // limpo → some
        else {
          // Tinha edição pendente num produto que sumiu no servidor — sinaliza e MANTÉM o card.
          idsProcessados.add(draft.id);
          novosConflitos[draft.id] = [{ path: "__produto__", meu: "suas edições", dele: null }];
          proximosDrafts.push(draft);
        }
        continue;
      }
      idsProcessados.add(draft.id);
      const touched = new Set(
        (Object.keys(chaveDirty(draft)) as (keyof ReturnType<typeof chaveDirty>)[]).filter(
          (k) => JSON.stringify((chaveDirty(draft) as any)[k]) !== JSON.stringify((chaveDirty(base) as any)[k]),
        ),
      );
      const m = mergeDraft({ base: base as any, draft: draft as any, fresh: fr as any, touched });
      if (m.atualizados.length > 0) totalAtualizados++;
      if (m.conflitos.length > 0) novosConflitos[draft.id] = m.conflitos; // ausência = convergiu → poda
      // rev nunca é "tocado" (não está em chaveDirty) — sempre adota o do fresh.
      proximosDrafts.push({ ...(m.valor as ProdutoImportadoDraft), rev: fr.rev });
    }
    // Produtos novos no servidor (criado por outra aba) que eu ainda não tenho localmente.
    for (const fr of fresh) {
      if (fr.id && !drafts.some((d) => d.id === fr.id)) proximosDrafts.push(fr);
    }
    baseServidorRef.current = Object.fromEntries(fresh.filter((d) => d.id).map((d) => [d.id as string, d]));

    // Conflitos: RECONSTRÓI o conjunto p/ os produtos processados — mantém quem ainda conflita,
    // REMOVE quem convergiu (o servidor passou a coincidir com o meu draft SEM eu ter clicado
    // "resolver"). ⚠️ Isto roda SEMPRE, fora do early-return abaixo — espelha EXATAMENTE
    // `ProdutoAcabadoSheet.tsx` (comentário "Conflitos: RECONSTRÓI o conjunto" lá): um
    // conflito-fantasma faz `temConflitoPendente` travar o Salvar mesmo quando `drafts` não mudou
    // nesta passada. NÃO usar spread-merge (`{...prev, ...novos}`) — isso nunca remove a chave
    // convergida. Produtos NÃO processados (rascunho local/outra subcoleção) preservam o conflito
    // que já tinham.
    setConflitosPorProduto((prev) => {
      const next = { ...prev };
      let mudou = false;
      for (const id of idsProcessados) {
        const cs = novosConflitos[id];
        if (cs && cs.length > 0) {
          if (next[id] !== cs) { next[id] = cs; mudou = true; }
        } else if (next[id]) {
          delete next[id]; mudou = true;
        }
      }
      return mudou ? next : prev;
    });

    const totalConflitos = Object.values(novosConflitos).reduce((a, c) => a + c.length, 0);
    if (totalAtualizados === 0 && totalConflitos === 0) return; // sem mudança em drafts — não perturba
    setDrafts(proximosDrafts);
    setUltimoMergeColab({ atualizados: totalAtualizados, conflitos: totalConflitos });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [produtosQuery.isSuccess, produtosQuery.isError, produtosQuery.data]);

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

  // dirty: qualquer draft (local ou persistido) cujo `chaveDirty` diverge do baseline daquele
  // id — rascunho local ("novo-...") nunca tem baseline (`undefined`), então qualquer rascunho
  // recém-criado já é dirty (mesma semântica de antes: um card novo pede salvamento).
  const dirty = drafts.some((d) => JSON.stringify(chaveDirty(d)) !== (d.id ? baseline[d.id] : undefined));
  // Item 7 (espelha P.Acabado): QUALQUER produto com conflito pendente barra Salvar/Fazer pedido.
  const temConflitoPendente = Object.values(conflitosPorProduto).some((cs) => cs.length > 0);
  const fecharDeVez = () => {
    setBaseline((b) => ({ ...b, ...Object.fromEntries(drafts.filter((d) => d.id).map((d) => [d.id as string, JSON.stringify(chaveDirty(d))])) }));
    onClose();
  };
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose: fecharDeVez });

  const patchDraft = (id: string, patch: Partial<ProdutoImportadoDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  // Excluir: rascunho local (id "novo-...", nunca salvo) só sai do estado; produto que JÁ
  // existe no banco passa pela RPC com guarda antes de sair da tela.
  const excluirMut = useMutation({
    mutationFn: async (id: string) => {
      if (!id.startsWith("novo-")) {
        const { error } = await supabase.rpc("excluir_produto_importado" as any, { _produto_id: id });
        if (error) throw error;
      }
      return id;
    },
    onSuccess: (id) => {
      setDrafts((ds) => ds.filter((d) => d.id !== id));
      qc.invalidateQueries({ queryKey: ["produtos-importados", colecaoId] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Falha ao excluir.")),
  });
  const removeDraft = (id: string) => excluirMut.mutate(id);

  // "Limpar card" (#4c): zera o rascunho mantendo o card na lista. Rascunho LOCAL ("novo-") =
  // reset só no estado (nada no banco); PERSISTIDO = RPC dedicada (o save usa COALESCE e não
  // zeraria o nome). Preserva id/colecao/subcolecao/modelo_id(null)/mix_id/ref.
  const limparMut = useMutation({
    mutationFn: async (d: ProdutoImportadoDraft) => {
      if (d.id && !d.id.startsWith("novo-")) {
        const { error } = await supabase.rpc("limpar_produto_importado" as any, { _produto_id: d.id });
        if (error) throw error;
      }
      return d;
    },
    onSuccess: (d) => {
      // Estado zerado = card recém-criado (emptyDraft: 1 variante + 3 etapas default), preservando
      // a identidade (id/modelo_id/mix_id/ref). A RPC zera as moedas p/ RMB/USD (default do emptyDraft),
      // então banco e front ficam COERENTES (achado D2).
      // Colab (Fase 3): `limpar_produto_importado` bumpa `rev` no servidor por fora do
      // `salvar_produto_importado` (RPC dedicada, sem `_rev_base`) — sem resincronizar
      // `baseServidorRef`/`rev` aqui, o PRÓXIMO save deste produto mandaria um `rev` local
      // velho e tomaria um P0409 FALSO (não é conflito de outra pessoa, é o meu próprio bump
      // do Limpar). SELECT pontual do rev novo, mesmo padrão de `salvarUmProduto` (espelha
      // o `onLimpo` do `ProdutoAcabadoSheet.tsx`).
      const vazio = emptyDraft(d.colecao_id, d.subcolecao);
      const persistido = !!d.id && !d.id.startsWith("novo-");
      const limpo: ProdutoImportadoDraft = { ...vazio, id: d.id, rev: d.rev, modelo_id: d.modelo_id ?? null, mix_id: d.mix_id ?? null, ref: d.ref ?? null };
      setDrafts((ds) => ds.map((x) => (x.id === d.id ? limpo : x)));
      // Persistido: o produto já está limpo no banco → rebaseline p/ o Sheet não ficar "sujo"
      // por um estado já salvo (achado C4/D2). Local ("novo-"): segue como rascunho não salvo.
      if (persistido) {
        marcarProdutoLimpo(limpo);
        void supabase.from("produtos_importados" as any).select("rev").eq("id", d.id as string).maybeSingle().then(({ data }) => {
          const revNovo = data ? Number((data as any).rev) || 0 : limpo.rev;
          const sincronizado = { ...limpo, rev: revNovo };
          baseServidorRef.current = { ...baseServidorRef.current, [d.id as string]: sincronizado };
          setDrafts((ds) => ds.map((x) => (x.id === d.id ? { ...x, rev: revNovo } : x)));
        });
        qc.invalidateQueries({ queryKey: ["produtos-importados", colecaoId] });
      }
      toast.success("Card limpo.");
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Falha ao limpar.")),
  });
  const limparDraft = (d: ProdutoImportadoDraft) => limparMut.mutate(d);
  // Um card aberto por vez (feedback do dono: cards abertos ficavam gigantes empilhados). Abrir
  // um fecha os demais — o card fechado é compacto (só o header-resumo).
  // Abre/fecha um card. Permite VÁRIOS abertos (necessário p/ o "Expandir todos" do RecolherMenu).
  const toggleCard = (id: string) => setOpenCards((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Lanes (agrupamentos) recolhidas — Set de laneKey ("__sem__" p/ null). Vazio = todas expandidas.
  const [lanesRecolhidas, setLanesRecolhidas] = useState<Set<string>>(new Set());
  const laneRecolhida = (laneKey: string | null) => lanesRecolhidas.has(laneKey ?? "__sem__");
  const toggleLane = (laneKey: string | null) => setLanesRecolhidas((s) => { const k = laneKey ?? "__sem__"; const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleSel = (id: string) => setSelecao((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // "Replicar card(s)" — só produtos JÁ PERSISTIDOS (id não-local) e MATERIALIZADOS (modelo_id
  // preenchido) são elegíveis; a RPC ignora silenciosamente quem não tem card, mas contamos
  // aqui pra avisar ANTES (nIgnorados). Abre o dialog de destino (coleção/subcoleção).
  function handleReplicarClick() {
    const selecionados = drafts.filter((d) => d.id && selecao.has(d.id));
    const elegiveis = selecionados.filter((d) => d.id && !d.id.startsWith("novo-") && !!d.modelo_id);
    const produtoIds = elegiveis.map((d) => d.id as string);
    const nIgnorados = selecionados.length - elegiveis.length; // rascunho local não-salvo OU sem card no Planejamento
    if (produtoIds.length === 0) {
      toast.error("Selecione ao menos um produto materializado (com card no Planejamento) para replicar.");
      return;
    }
    setReplicarPayload({ produtoIds, nIgnorados });
  }

  async function confirmarReplicar(destinoColId: string, destinoSubId: string | null) {
    const payload = replicarPayload;
    if (!payload) return;
    setReplicando(true);
    try {
      const { data, error } = await supabase.rpc("replicar_produtos_importados" as any, {
        _destino_colecao_id: destinoColId,
        _destino_subcolecao_id: destinoSubId,
        _produto_ids: payload.produtoIds,
      });
      if (error) throw error;
      const res = (data ?? []) as { origem_produto_id: string; novo_produto_id: string; novo_modelo_id: string }[];
      for (const cid of new Set([destinoColId, colecaoId])) {
        void qc.invalidateQueries({ queryKey: ["produtos-importados", cid] });
        void qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
      }
      setReplicarPayload(null);
      setSelecao(new Set());
      toast.success(`${res.length} card(s) replicado(s).`);
    } catch (e) {
      toast.error(mensagemErro(e, "Falha ao replicar"));
    } finally {
      setReplicando(false);
    }
  }

  // "Criar card(s) no Planejamento" (ação em massa) — materializa o espelho `modelos` dos
  // selecionados JÁ PERSISTIDOS que ainda NÃO têm card (modelo_id nulo). Só depois de virar card o
  // produto pode ser replicado (versionamento) e aparece no Planejamento de Produto.
  async function criarCardsClick() {
    const selecionados = drafts.filter((d) => d.id && selecao.has(d.id));
    const idsSemCard = selecionados.filter((d) => d.id && !d.id.startsWith("novo-") && !d.modelo_id).map((d) => d.id as string);
    const nLocais = selecionados.filter((d) => !d.id || d.id.startsWith("novo-")).length;
    if (idsSemCard.length === 0) {
      toast.info(nLocais > 0 ? "Salve os rascunhos antes de criar o card." : "Os selecionados já têm card no Planejamento.");
      return;
    }
    setReplicando(true);
    try {
      const { data, error } = await supabase.rpc("criar_cards_produto_importado" as any, { _produto_ids: idsSemCard });
      if (error) throw error;
      const res = (data ?? []) as { produto_id: string; modelo_id: string }[];
      void qc.invalidateQueries({ queryKey: ["produtos-importados", colecaoId] });
      void qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
      setSelecao(new Set());
      toast.success(`${res.length} card(s) criado(s) no Planejamento.`);
    } catch (e) {
      toast.error(mensagemErro(e, "Falha ao criar card(s)"));
    } finally {
      setReplicando(false);
    }
  }

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

  // Reconcilia um P0409 de UM produto (alguém salvou aquele card no meio): recarrega SÓ ele do
  // servidor (mesmo select da query da tela, com variantes+etapas) e funde com a edição local —
  // espelha `reconciliarProdutoP0409` do `ProdutoAcabadoSheet.tsx`. base = último snapshot visto
  // (`baseServidorRef`) · meu = `d` (o que eu tentava salvar) · fresh = recarregado · touched =
  // diff local vs base. Campos que só o servidor mudou são adotados; campos que EU editei E o
  // servidor também mudou viram conflito (bloqueia o PRÓXIMO save até resolver).
  const reconciliarProdutoP0409 = async (d: ProdutoImportadoDraft) => {
    if (!d.id) return;
    const { data, error } = await supabase
      .from("produtos_importados" as any)
      .select("*, modelo_id, variantes:produto_importado_variantes(*), etapas:produto_importado_etapas(*)")
      .eq("id", d.id)
      .maybeSingle();
    if (error || !data) return; // produto sumiu (excluído por outra aba) — o merge do refetch geral cuida do aviso
    const fresh = draftDeRow(data as unknown as ProdutoImportadoRow);
    const base = baseServidorRef.current[d.id] ?? fresh;
    const touched = new Set(
      (Object.keys(chaveDirty(d)) as (keyof ReturnType<typeof chaveDirty>)[]).filter(
        (k) => JSON.stringify((chaveDirty(d) as any)[k]) !== JSON.stringify((chaveDirty(base) as any)[k]),
      ),
    );
    const m = mergeDraft({ base: base as any, draft: d as any, fresh: fresh as any, touched });
    const fundido: ProdutoImportadoDraft = { ...(m.valor as ProdutoImportadoDraft), rev: fresh.rev };
    baseServidorRef.current = { ...baseServidorRef.current, [d.id]: fresh };
    setDrafts((ds) => ds.map((x) => (x.id === d.id ? fundido : x)));
    if (m.conflitos.length > 0) {
      setConflitosPorProduto((prev) => ({ ...prev, [d.id as string]: m.conflitos }));
    } else {
      // Sem conflito de verdade — o card já está atualizado com o fresh + minhas edições
      // preservadas; rebaseline pra não segurar `dirty`/bloquear um novo Salvar por um
      // conflito fantasma.
      marcarProdutoLimpo(fundido);
    }
  };

  // Salva UM produto — fonte ÚNICA reusada pelo Salvar em lote (abaixo) E pelo "Fazer pedido" de
  // cada card (persiste a Compra ANTES de gerar a OC). Colab (Fase 3): manda `_rev_base: d.rev`
  // (null p/ rascunho local, sem base a checar) — a RPC dá P0409 se outra pessoa salvou ESTE
  // produto desde que eu o carreguei; reconciliado por `reconciliarProdutoP0409` (acima).
  const salvarUmProduto = async (d: ProdutoImportadoDraft): Promise<string> => {
    const erro = validarDraft(d);
    if (erro) throw erroValidacao(erro);
    const isLocal = !d.id || d.id.startsWith("novo-");
    const { dados, variantes, etapas } = montarPayload(d);
    const { data, error } = await supabase.rpc("salvar_produto_importado" as any, {
      _id: isLocal ? null : d.id,
      _dados: dados,
      _variantes: variantes,
      _etapas: etapas,
      _rev_base: isLocal ? null : d.rev,
    });
    if (error) {
      if ((error as any).code === "P0409") {
        toast.warning(`Alguém salvou "${d.nome}" agora — o card foi recarregado e fundido com suas edições.`);
        await reconciliarProdutoP0409(d);
      }
      throw error;
    }
    const novoId = data as string;
    // rev pós-save (espelha `salvarUmProduto` do P.Acabado): a RPC só retorna o `uuid` do
    // produto, não o rev novo — busca ele pontualmente (1 SELECT leve) e faz um PATCH local
    // IMEDIATO. Mais seguro que esperar o `invalidateQueries`/refetch geral: a janela até o
    // refetch terminar deixaria um 2º Salvar comparar `d.rev` contra um valor velho.
    const { data: revRow } = await supabase.from("produtos_importados" as any).select("rev").eq("id", novoId).maybeSingle();
    const revNovo = revRow ? Number((revRow as any).rev) || 0 : d.rev + 1; // fallback otimista
    const salvo: ProdutoImportadoDraft = { ...d, id: novoId, rev: revNovo };
    baseServidorRef.current = { ...baseServidorRef.current, [novoId]: salvo };
    if (isLocal) {
      const idAntigo = d.id!;
      setDrafts((ds) => ds.map((x) => (x.id === idAntigo ? salvo : x)));
      // Mantém o card aberto/selecionado sob o NOVO id (senão "Fazer pedido" fecharia o card
      // visualmente — `openCards` rastreia por id, e o id local "novo-..." deixou de existir).
      setOpenCards((s) => (s.has(idAntigo) ? new Set([novoId]) : s));
    } else {
      setDrafts((ds) => ds.map((x) => (x.id === novoId ? salvo : x)));
    }
    marcarProdutoLimpo(salvo); // baseline por produto
    qc.invalidateQueries({ queryKey: ["produtos-importados", colecaoId] });
    return novoId;
  };

  // Salva TODOS os drafts — cada um via `salvarUmProduto` (fonte única). `allSettled` (não
  // `all`): um P0409 isolado num produto não deve abortar o save dos DEMAIS — `salvarUmProduto`
  // já reconcilia o card em conflito sozinho; os outros produtos do lote salvam normalmente.
  // Erros que NÃO são P0409 (ex.: validação/rede) também não devem derrubar o lote inteiro —
  // propaga o 1º pro onError (espelha `ProdutoAcabadoSheet.tsx`).
  const salvarMut = useMutation({
    mutationFn: async () => {
      // Guard SÍNCRONO (item 4/7, colab Fase 3): há QUALQUER conflito pendente em QUALQUER
      // produto → bloqueia ANTES de qualquer RPC. O `disabled` do botão (rodapé) é um segundo
      // freio, mas é async.
      const produtosEmConflito = Object.entries(conflitosPorProduto).filter(([, cs]) => cs.length > 0);
      if (produtosEmConflito.length > 0) {
        throw erroValidacao("Resolva os conflitos indicados nos cards destacados antes de salvar.");
      }
      // Valida TODOS os drafts no cliente ANTES de qualquer save — senão um produto com Σ%≠100
      // (rejeitado pelo servidor) abortaria o lote no meio.
      for (const d of drafts) {
        const erro = validarDraft(d);
        if (erro) throw new Error(`${d.nome || "Produto sem nome"}: ${erro}`);
      }
      const resultados = await Promise.allSettled(drafts.map((d) => salvarUmProduto(d)));
      const falhas = resultados.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      const falhasP0409 = falhas.filter((r) => (r.reason as any)?.code === "P0409");
      const outrasFalhas = falhas.filter((r) => (r.reason as any)?.code !== "P0409");
      if (outrasFalhas.length > 0) throw outrasFalhas[0].reason; // erro "de verdade" — propaga o 1º pro onError
      return { totalConflitos: falhasP0409.length };
    },
    onSuccess: ({ totalConflitos }) => {
      if (totalConflitos > 0) {
        toast.warning(`${totalConflitos} produto(s) tiveram conflito e foram recarregados — confira antes de salvar de novo.`);
      } else {
        toast.success("Produtos importados salvos.");
      }
      qc.invalidateQueries({ queryKey: ["produtos-importados", colecaoId] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Falha ao salvar")),
  });
  const salvar = () => salvarMut.mutate();

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

  // Recolher/expandir TODOS os cards (RecolherMenu). `todosRecolhidos` = nenhum aberto.
  const idsSub = produtosSub.map((d) => d.id!).filter(Boolean);
  const todosRecolhidos = idsSub.every((id) => !openCards.has(id));
  const toggleTodos = () => setOpenCards(todosRecolhidos ? new Set(idsSub) : new Set());
  // Recolher/expandir TODAS as lanes (agrupamentos). `todasSecoesRecolhidas` = todas recolhidas.
  const todasSecoesRecolhidas = laneKeys.length > 0 && laneKeys.every((k) => laneRecolhida(k));
  const toggleSecoes = () => setLanesRecolhidas(todasSecoesRecolhidas ? new Set() : new Set(laneKeys.map((k) => k ?? "__sem__")));

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
      {itens.map((d) => {
        const conflitosDoCard = (d.id && conflitosPorProduto[d.id]) || [];
        return (
        <div
          key={d.id}
          className={`w-[420px] max-md:w-[90vw] shrink-0 max-md:snap-start ${conflitosDoCard.length > 0 ? "rounded-lg ring-2 ring-amber-400 dark:ring-amber-600" : ""}`}
        >
          <ProdutoImportadoCard
            draft={d}
            onChange={(patch) => patchDraft(d.id!, patch)}
            open={openCards.has(d.id!) || conflitosDoCard.length > 0}
            onToggleOpen={() => toggleCard(d.id!)}
            selected={selecao.has(d.id!)}
            onToggleSelect={() => toggleSel(d.id!)}
            grupos={grupos}
            categorias={categorias}
            subcats1={subcats1}
            subcats2={subcats2}
            cores={cores}
            coresApelido={coresApelido}
            empresas={empresas}
            tamanhos={tamanhos}
            onExcluir={() => removeDraft(d.id!)}
            onLimpar={() => limparDraft(d)}
            onSalvarProduto={salvarUmProduto}
            // Item 7 (espelha P.Acabado): "Fazer pedido" (dentro do card) chama `onSalvarProduto`
            // — bloqueia enquanto ESTE produto (ou qualquer outro) tiver conflito pendente.
            conflitoPendente={temConflitoPendente}
            onPedidoCriado={() => {
              // A navegação pra OC (`/entrada-saida/oc-p-importado?oc=<id>`) acontece dentro do
              // próprio card (tem `useNavigate`); aqui só a higiene de cache dos vizinhos —
              // espelha `invalidarVizinhos` do `ProdutoCard` (revenda).
              qc.invalidateQueries({ queryKey: ["produtos-importados", colecaoId] });
            }}
          />
        </div>
        );
      })}
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
          {/* Colab (Fase 3): presença + resultado do último merge + resolução dos conflitos
              pendentes — espelha `ProdutoAcabadoSheet.tsx` (ver comentário lá). Conflitos são POR
              PRODUTO (`conflitosPorProduto`) — achatados aqui numa lista única com path
              `${produtoId}::${campo}` p/ reusar o `ColabBanner` genérico. */}
          {view === "canvas" && (
            <ColabBanner
              presentes={presentesCanvas}
              ultimoMerge={ultimoMergeColab ? { atualizados: ultimoMergeColab.atualizados, conflitos: [] } : null}
              conflitos={Object.entries(conflitosPorProduto).flatMap(([produtoId, cs]) => cs.map((c) => ({ ...c, path: `${produtoId}::${c.path}` })))}
              onResolver={(path, escolha) => {
                const [produtoId, campo] = path.split("::");
                const c = conflitosPorProduto[produtoId]?.find((x) => x.path === campo);
                if (c && escolha === "dele") {
                  if (campo === "__produto__") {
                    setDrafts((ds) => ds.filter((d) => d.id !== produtoId)); // servidor não tem mais esse produto — aceita a exclusão
                  } else {
                    patchDraft(produtoId, { [campo]: c.dele } as Partial<ProdutoImportadoDraft>);
                  }
                }
                setConflitosPorProduto((prev) => {
                  const restantes = (prev[produtoId] ?? []).filter((x) => x.path !== campo);
                  const next = { ...prev, [produtoId]: restantes };
                  if (restantes.length === 0) delete next[produtoId];
                  return next;
                });
              }}
              rotulo={(path) => {
                const [produtoId, campo] = path.split("::");
                const nomeProduto = drafts.find((d) => d.id === produtoId)?.nome || "Produto";
                if (campo === "__produto__") return `${nomeProduto} (excluído no servidor)`;
                return `${nomeProduto} · ${ROTULO_CAMPO_PI[campo] ?? campo}`;
              }}
            />
          )}
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
            {/* Barra de seleção múltipla (só no canvas, quando há seleção) — mesmo padrão do
                Plan. Tecido (`PlanTecidoSheet`): sticky, âmbar, ação principal "Replicar". */}
            {selecao.size > 0 && (
              <div className="flex flex-row flex-wrap items-center gap-2 border-b bg-amber-50 px-3 py-2 max-sm:gap-1.5">
                <span className="font-medium max-sm:text-xs sm:text-sm">{selecao.size} selecionado(s)</span>
                <div className="ml-auto flex flex-wrap items-center gap-2 max-sm:gap-1.5">
                  <Button size="sm" variant="outline" aria-label="Criar card(s) no Planejamento" className="gap-1 text-xs max-sm:aspect-square max-sm:px-0" disabled={replicando} onClick={criarCardsClick}>
                    <ClipboardList className="h-4 w-4" /><span className="max-sm:sr-only"> Criar card</span>
                  </Button>
                  <Button size="sm" variant="outline" aria-label="Replicar em outra coleção/subcoleção" className="gap-1 text-xs max-sm:aspect-square max-sm:px-0" disabled={replicando} onClick={handleReplicarClick}>
                    <CopyPlus className="h-4 w-4" /><span className="max-sm:sr-only"> Replicar</span>
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Limpar seleção" className="gap-1 text-xs text-muted-foreground max-sm:aspect-square max-sm:px-0" onClick={() => setSelecao(new Set())}>
                    <BrushCleaning className="h-4 w-4" /><span className="max-sm:sr-only"> Limpar</span>
                  </Button>
                </div>
              </div>
            )}
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
              <main
                ref={colabScopeRef}
                className="flex-1 overflow-y-auto p-3"
                onFocusCapture={(e) => {
                  const scope = colabScopeRef.current;
                  setCampoFocadoCanvas(scope ? pathDoElemento(e.target as HTMLElement, scope) : null);
                }}
                onBlurCapture={() => setCampoFocadoCanvas(null)}
              >
                {/* Ring de presença colaborativa nos campos inline dos cards do canvas. */}
                <ColabPresenceOverlay presentes={presentesCanvas} scopeRef={colabScopeRef} />
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
                    {produtosSub.length > 0 && (
                      <RecolherMenu
                        todasSecoesRecolhidas={todasSecoesRecolhidas}
                        todosRecolhidos={todosRecolhidos}
                        onToggleSecoes={toggleSecoes}
                        onToggleCards={toggleTodos}
                      />
                    )}
                    <AgrupamentoButton groups={[
                      { label: "Grupo", active: agrupar.grupo, onToggle: () => setAgrupar({ grupo: !agrupar.grupo }) },
                      { label: "Categoria", active: agrupar.categoria, onToggle: () => setAgrupar({ categoria: !agrupar.categoria }) },
                    ]} />
                    {subAtual?.nome && (
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => setMixDialogOpen(true)}>
                        <Users className="h-3.5 w-3.5" /> Editar Fam.
                      </Button>
                    )}
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
                    const recolhida = laneRecolhida(laneKey);
                    const header = (
                      <button type="button" onClick={() => toggleLane(laneKey)} title={recolhida ? "Expandir" : "Recolher"}
                        className="mb-1.5 flex items-center gap-2 rounded p-0.5 text-left hover:bg-muted">
                        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${recolhida ? "" : "rotate-90"}`} />
                        <span className={`text-sm font-semibold ${laneKey ? "" : "text-muted-foreground"}`}>{laneKey ? macroNome(laneKey) : macroFallback}</span>
                        <span className="rounded-full border px-2 text-[11px] text-muted-foreground">{itens.length} produtos · {pecas} pç</span>
                      </button>
                    );
                    if (!agrupamentoAninhado) {
                      return (
                        <section key={laneKey ?? "__sem__"}>
                          {header}
                          {!recolhida && renderCardsRow(itens)}
                        </section>
                      );
                    }
                    const subKeys = subLaneKeysDe(itens);
                    return (
                      <section key={laneKey ?? "__sem__"}>
                        {header}
                        {!recolhida && <div className="space-y-3 border-l-2 pl-3">
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
                        </div>}
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
          <Button
            disabled={!dirty || salvarMut.isPending || temConflitoPendente}
            title={temConflitoPendente ? "Resolva os conflitos de edição pendentes antes de salvar." : undefined}
            onClick={salvar}
          >
            {salvarMut.isPending ? "Salvando…" : temConflitoPendente ? "Conflito pendente" : dirty ? "Salvar" : "Salvo"}
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

        {/* Editar Família de Produtos (#4b) — reusa o EditarMixDialog. Materializados entram pela
            query `modelos` do dialog; RASCUNHOS persistidos (modelo_id null, id não-"novo-") entram
            como "vagas" e o callback grava `produtos_importados.mix_id`. Rascunho local ("novo-",
            não salvo) NÃO entra — sem linha no banco. */}
        {mixDialogOpen && subAtual?.nome && (
          <EditarMixDialog
            colecaoId={colecaoId}
            colecaoNome={colecao?.nome ?? ""}
            subcolecao={subAtual.nome}
            breadcrumbBase={["Estilo & Engenharia", "Produto Importado"]}
            onClose={() => {
              setMixDialogOpen(false);
              // Excluir família zera produtos_importados.mix_id (on delete set null) — re-sincroniza
              // só o mix_id dos drafts (leve; read-only, nunca dirty).
              void supabase.from("produtos_importados" as any).select("id, mix_id").eq("colecao_id", colecaoId)
                .then(({ data }) => {
                  if (!data) return;
                  const map = new Map((data as any[]).map((r) => [r.id, r.mix_id ?? null]));
                  setDrafts((ds) => ds.map((d) => (d.id && map.has(d.id) ? { ...d, mix_id: map.get(d.id)! } : d)));
                });
              qc.invalidateQueries({ queryKey: ["produtos-importados", colecaoId] });
            }}
            vagas={produtosDeSub(subAtual.nome)
              .filter((d) => d.id && !d.id.startsWith("novo-") && !d.modelo_id)
              .map((d) => ({ slotId: d.id as string, ref: d.ref, nome: d.nome, mixId: d.mix_id ?? null }))}
            onMoverVagas={async (produtoIds, mixId) => {
              const { error } = await supabase.from("produtos_importados" as any).update({ mix_id: mixId }).in("id", produtoIds);
              if (error) { toast.error(mensagemErro(error, "Erro ao mover para a família.")); return; }
              setDrafts((ds) => ds.map((d) => (d.id && produtoIds.includes(d.id) ? { ...d, mix_id: mixId } : d)));
              qc.invalidateQueries({ queryKey: ["produtos-importados", colecaoId] });
            }}
          />
        )}

        {/* Replicar card(s) → dialog de (coleção, subcoleção) destino. Monta só quando há
            payload (nasce limpo). A RPC replica materializando + versionando + ocupando
            vaga no destino; produtos sem card (modelo_id nulo) já foram filtrados como
            ignorados antes de abrir o dialog. */}
        {replicarPayload && (
          <ReplicarImportadoDialog
            open={!!replicarPayload}
            onOpenChange={(o) => { if (!o && !replicando) setReplicarPayload(null); }}
            nEleg={replicarPayload.produtoIds.length}
            nIgnorados={replicarPayload.nIgnorados}
            colecaoAtualId={colecaoId}
            replicando={replicando}
            onConfirmar={confirmarReplicar}
          />
        )}

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
