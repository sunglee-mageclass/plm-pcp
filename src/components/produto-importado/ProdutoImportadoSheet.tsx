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
import { useOrcamento } from "@/components/otb/orcamento";
import { DEFAULT_TAMANHOS } from "@/components/oc-p-acabado/shared";
import { mensagemErro } from "@/lib/erro-mensagem";
import type { EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import type { Opt, CatOpt, SubOpt, CorApelidoOpt } from "@/components/produto-acabado/shared";
import { ProdutoImportadoCard } from "./ProdutoImportadoCard";
import { ResumoImportadoPanel } from "./ResumoImportadoPanel";
import { NovoProdutoImportadoDialog } from "./NovoProdutoImportadoDialog";
import { EditarMixDialog } from "@/components/plan-tecido/EditarMixDialog";
import { ReplicarImportadoDialog } from "./ReplicarImportadoDialog";
import { emptyDraft, montarPayload, validarDraft, type ProdutoImportadoDraft, type VarianteImportadoDraft, type EtapaImportadoDraft } from "./shared";

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
  const [baseline, setBaseline] = useState<string>("[]");
  const [carregado, setCarregado] = useState(false);
  const resolvedInicialRef = useRef({ done: false });
  const qc = useQueryClient();
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

  useEffect(() => {
    if (carregado) return;
    // Sucesso OU erro (tabela/RPC ainda não pronta): resolve como "sem produtos" e libera a
    // tela — nunca trava a navegação por causa disso.
    if (produtosQuery.isSuccess || produtosQuery.isError) {
      const linhas = produtosQuery.data ?? [];
      const iniciais: ProdutoImportadoDraft[] = linhas.map(draftDeRow);
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

  // Salva TODOS os drafts (simples — mesmo padrão do Produto Acabado): cada um vira uma
  // chamada a `salvar_produto_importado` (upsert; `_id` local "novo-..." → null = criação).
  // Depois de salvar, drafts locais recebem o id definitivo do banco.
  const salvarMut = useMutation({
    mutationFn: async () => {
      // Valida TODOS os drafts no cliente ANTES de qualquer INSERT — senão um produto com
      // Σ%≠100 (rejeitado pelo servidor) abortaria o Promise.all no meio, deixando os já
      // criados no banco sem o id refletido no estado local (dupla no próximo save).
      for (const d of drafts) {
        const erro = validarDraft(d);
        if (erro) throw new Error(`${d.nome || "Produto sem nome"}: ${erro}`);
      }
      const atualizados = await Promise.all(
        drafts.map(async (d) => {
          const isLocal = !d.id || d.id.startsWith("novo-");
          const { dados, variantes, etapas } = montarPayload(d);
          const { data, error } = await supabase.rpc("salvar_produto_importado" as any, {
            _id: isLocal ? null : d.id,
            _dados: dados,
            _variantes: variantes,
            _etapas: etapas,
          });
          if (error) throw error;
          return isLocal ? { ...d, id: data as string } : d;
        }),
      );
      return atualizados;
    },
    onSuccess: (atualizados) => {
      setDrafts(atualizados);
      setBaseline(JSON.stringify(atualizados));
      toast.success("Produtos importados salvos.");
      qc.invalidateQueries({ queryKey: ["produtos-importados", colecaoId] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Falha ao salvar")),
  });
  const salvar = () => salvarMut.mutate();

  // Salva UM produto (não a tela inteira) — usado pelo "Fazer pedido" do card (fase 2, OC):
  // persiste ANTES de gerar a OC, pra nunca criar um pedido em cima de rascunho ainda não
  // salvo (mesmo cuidado do `onSalvarProduto`/"Fazer pedido" da revenda, `ProdutoCard.tsx`).
  // Devolve o id definitivo do banco e já patcheia o draft local (mesmo id, sem esperar o
  // refetch de `["produtos-importados", colecaoId]`).
  const salvarUmProduto = async (d: ProdutoImportadoDraft): Promise<string> => {
    const erro = validarDraft(d);
    if (erro) throw new Error(erro);
    const isLocal = !d.id || d.id.startsWith("novo-");
    const { dados, variantes, etapas } = montarPayload(d);
    const { data, error } = await supabase.rpc("salvar_produto_importado" as any, {
      _id: isLocal ? null : d.id,
      _dados: dados,
      _variantes: variantes,
      _etapas: etapas,
    });
    if (error) throw error;
    const novoId = data as string;
    if (isLocal) {
      const idAntigo = d.id!;
      patchDraft(idAntigo, { id: novoId });
      // Mantém o card aberto/selecionado sob o NOVO id (senão "Fazer pedido" fecharia o card
      // visualmente — `openCards` rastreia por id, e o id local "novo-..." deixou de existir).
      setOpenCards((s) => (s.has(idAntigo) ? new Set([novoId]) : s));
    }
    qc.invalidateQueries({ queryKey: ["produtos-importados", colecaoId] });
    return novoId;
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
      {itens.map((d) => (
        <div key={d.id} className="w-[420px] max-md:w-[90vw] shrink-0 max-md:snap-start">
          <ProdutoImportadoCard
            draft={d}
            onChange={(patch) => patchDraft(d.id!, patch)}
            open={openCards.has(d.id!)}
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
            onSalvarProduto={salvarUmProduto}
            onPedidoCriado={() => {
              // A navegação pra OC (`/entrada-saida/oc-p-importado?oc=<id>`) acontece dentro do
              // próprio card (tem `useNavigate`); aqui só a higiene de cache dos vizinhos —
              // espelha `invalidarVizinhos` do `ProdutoCard` (revenda).
              qc.invalidateQueries({ queryKey: ["produtos-importados", colecaoId] });
            }}
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
          <Button disabled={!dirty || salvarMut.isPending} onClick={salvar}>
            {salvarMut.isPending ? "Salvando…" : dirty ? "Salvar" : "Salvo"}
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
