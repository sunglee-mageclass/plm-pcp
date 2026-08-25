import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, Trash2, ImageIcon, Layers, LayoutGrid, ArrowLeft, ArrowUp, ArrowDown, CheckSquare, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, AlertTriangle, Rocket, Check, X } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";


import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { useAuth } from "@/hooks/useAuth";
import { MoListaSection } from "@/components/planejamento/MoListaSection";
import { type MoLinha } from "@/lib/mao-obra";
import { DateField } from "@/components/shared/DateField";
import { ResumoVenda } from "@/components/shared/ResumoVenda";
import { HeaderActions } from "@/components/shared/HeaderActions";
import { useCursorTip } from "@/components/shared/CursorTip";
import { precoInfo } from "@/lib/preco";
import { cqLiberado } from "@/lib/cq-status";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useGridCols, GRID_COLS_OPTIONS, GRID_COLS_CLASS, useCompactCards } from "@/hooks/useGridCols";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { useFilterState } from "@/hooks/useFilterState";
import { brl } from "@/lib/format";
import { FilterButton, SearchToggle, AgrupamentoButton } from "@/components/shared/filters";
import { useSort } from "@/components/shared/sort";
import { EmptyState } from "@/components/shared/EmptyState";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { useIsMobile } from "@/hooks/use-mobile";

import { RequirePermission } from "@/components/RequirePermission";
import { useTenantModules } from "@/hooks/useTenantModules";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkEditDialog } from "@/components/planejamento/BulkEditDialog";
// Detalhe do card + campos compartilhados extraídos (refactor 2026-08-25).
import { PlanejamentoDetail, FieldText, FieldSelect } from "@/components/planejamento/PlanejamentoDetail";
import { usePlanejamentoOpts } from "@/hooks/usePlanejamentoOpts";
import {
  STATUS_OPTS, statusMeta, numOr0, useSignedUrlBucket,
  type Opt, type CatOpt, type LinhaOpt, type ArtigoOpt, type SubOpt,
} from "@/components/planejamento/modelo-shared";
import { useOrcamento, orcLabel } from "@/components/otb/orcamento";
// `?modelo=<id>` abre o card direto (deep-link) — usado pelo ⧉ "abrir card no Plan. Produto"
// do planejador Produto Acabado (Task 6, revenda), que precisa navegar pra um card específico
// sem um mecanismo próprio de endereçamento (a tela não tinha nenhum search param antes).
export const Route = createFileRoute("/_authenticated/criacao/planejamento")({
  validateSearch: (s: Record<string, unknown>): { modelo?: string } => ({
    modelo: typeof s.modelo === "string" && s.modelo ? s.modelo : undefined,
  }),
  component: () => (
    <RequirePermission page="criacao_planejamento">
      <PlanejamentoPage />
    </RequirePermission>
  ),
});

type Modelo = {
  id: string;
  nome: string | null;
  ref: string | null;
  ref_auto: string | null;
  estilista_id: string | null;
  linha_id: string | null;
  colecao: string | null;
  colecao_id: string | null;
  subcolecao: string | null;
  semana: string | null;
  mes_id: string | null;
  ano_id: string | null;
  categoria_principal_id: string | null;
  subcategoria1_id: string | null;
  status_planejamento: string | null;
  fotos_modelo: string[] | null;
  fotos_referencia: string[] | null;
  desenho_tecnico_url: string | null;
  croqui_url: string | null;
  observacoes_gerais: string | null;
  versao: number;
  modelo_base_id: string | null;
  preco_venda: number | null;
  origem: string | null;
  tecidos_planejados: string[] | null;
  lancado: boolean | null;
};

const fmtDataBR = (s: string | null) => s ? s.split("-").reverse().join("/") : null;

// MO por serviço: invalidations padrão após aprovar/reprovar POR SERVIÇO (`aprovar_servico_mo`,
// spec 2026-08-11 Task 2). Extraída p/ ser chamada tanto pelo editor do detalhe
// (`PlanejamentoDetail`, aprovação de dentro do card aberto — tem sua PRÓPRIA cópia lá) quanto
// pela seção expandida da lista (`ModeloCard` via `PlanejamentoPage`) sem duplicar a lista de
// queryKeys entre as duas mutations desta página.
function invalidarAposAprovarMO(qc: QueryClient, modeloId: string) {
  // Re-sincroniza a rev do colab (o rollup no banco bumpa `modelos.rev`) — sem isto o próximo
  // Salvar do card compara `.eq('rev', revRef)` desatualizado e dá P0409 falso.
  qc.invalidateQueries({ queryKey: ["modelo", modeloId] });
  qc.invalidateQueries({ queryKey: ["mo-resumo", modeloId] });
  qc.invalidateQueries({ queryKey: ["plan-custo-unit", modeloId] });
  qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
  qc.invalidateQueries({ queryKey: ["mo-resumo-list"] });
  // Cross-invalidation (bidirecionalidade c/ o Desenvolvimento, spec 2026-08-11): sem isto o
  // Dev não ficava sabendo de aprovações feitas aqui sem refetch manual.
  qc.invalidateQueries({ queryKey: ["modelo-mo-resumo"] });
}

function PlanejamentoPage() {
  const qc = useQueryClient();
  const navigate = useNavigate({ from: Route.fullPath });
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useFilterState("planejamento", "Status", []); // multi: [] = todos os status
  const [fEstilista, setFEstilista] = useFilterState("planejamento", "Estilista", []);
  const [fSemana, setFSemana] = useFilterState("planejamento", "Lançamento nº", []);
  const [fMes, setFMes] = useFilterState("planejamento", "Mês de Planejamento", []);
  const [fAno, setFAno] = useFilterState("planejamento", "Ano", []);
  const [fGrupo, setFGrupo] = useFilterState("planejamento", "Grupo", []);
  const [fCat, setFCat] = useFilterState("planejamento", "Categoria", []);
  const [fSubcolecao, setFSubcolecao] = useFilterState("planejamento", "Subcoleção", []);
  const [fSub1, setFSub1] = useFilterState("planejamento", "Subcategoria", []);
  const [fRep, setFRep] = useFilterState("planejamento", "Repetição", []);
  const [fOrigem, setFOrigem] = useFilterState("planejamento", "Origem", []);
  const [fColecao, setFColecao] = useFilterState("planejamento", "Coleção", []);
  const [fLancamento, setFLancamento] = useFilterState("planejamento", "Lançamento", []); // multi: [] = todos
  const [openId, setOpenId] = useState<string | null>(null);
  // Deep-link `?modelo=<id>` (ver Route.validateSearch acima) — abre o card uma vez ao montar;
  // não reabre se o usuário fechar e a URL ainda tiver o param (evita reabrir sozinho).
  const modeloParam = Route.useSearch({ select: (s) => s.modelo });
  const deepLinkAbertoRef = useRef(false);
  useEffect(() => {
    if (modeloParam && !deepLinkAbertoRef.current) {
      deepLinkAbertoRef.current = true;
      setOpenId(modeloParam);
    }
  }, [modeloParam]);
  const [openNew, setOpenNew] = useState(false);
  const [openBatch, setOpenBatch] = useState(false);
  const [openBulk, setOpenBulk] = useState(false);
  // Seleção múltipla SEM "modo": o checkbox fica sempre à mostra no card (pedido do dono) e a barra
  // de ações em massa aparece quando há ≥1 selecionado.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const isMobile = useIsMobile();
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllFiltered = () => setSelected(new Set(sorted.map((m) => m.id)));
  const clearSel = () => setSelected(new Set());
  // Cards do Planejamento alimentam o Plan. Tecido (subcoleção/semana/BOM/exclusão) → refresca o
  // cache dele junto (espelha o `invalidarDownstream` do OTB; sem isso a Plan. Tecido aberta na
  // sessão fica presa no cache até remontar).
  const invalidarPlanTecido = () =>
    qc.invalidateQueries({ predicate: (q) => typeof q.queryKey?.[0] === "string" && (q.queryKey[0] as string).startsWith("plan-tecido") });
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);
  const bulkDel = useMutation({
    mutationFn: async () => {
      const ids = [...selected];
      if (!ids.length) return 0;
      const { error } = await supabase.from("modelos").delete().in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} card(s) excluído(s)`);
      clearSel(); setConfirmBulkDel(false);
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
      invalidarPlanTecido();
    },
    onError: (e: any) => { setConfirmBulkDel(false); toast.error(mensagemErro(e, "Erro ao excluir os cards")); },
  });
  // MO por serviço (spec 2026-08-06): aprovar/reprovar por linha vive no editor do detalhe
  // (`MaoObraEditor`, dentro do card aberto). O card FECHADO mostra o badge agregado (derivado
  // de `modelo_mo_resumo.estado`) e, na variante completa, a seção expandida `MoListaSection`
  // (spec 2026-08-11, Task 2) — aprovar/reprovar POR SERVIÇO direto da lista, sem abrir o card.
  const aprovarServicoMOLista = useMutation({
    mutationFn: async ({ modeloId, categoriaId, aprovado, motivo }: { modeloId: string; categoriaId: string | null; aprovado: boolean; motivo?: string }) => {
      const { error } = await supabase.rpc("aprovar_servico_mo" as any, {
        _modelo_id: modeloId, _categoria_terceirizado_id: categoriaId, _aprovado: aprovado, _motivo: motivo ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(vars.aprovado ? "Mão de obra aprovada." : "Mão de obra reprovada.");
      invalidarAposAprovarMO(qc, vars.modeloId);
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Não foi possível atualizar a mão de obra.")),
  });
  // Lançar/cancelar direto do card (botão foguete) — mesma RPC do detalhe (gate no servidor).
  const lancarCard = useMutation({
    mutationFn: async ({ id, data, send }: { id: string; data: string | null; send: boolean }) => {
      const { error } = await supabase.rpc("lancar_modelo" as any, { _modelo_id: id, _data_lancamento: send ? data : null, _send: send });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.send ? "Modelo lançado" : "Lançamento cancelado");
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["lancamentos-cards"] });
      qc.invalidateQueries({ queryKey: ["sidebar-badges"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao lançar")),
  });
  const [groupByCat, setGroupByCat] = useState(false);
  const [groupByLinha, setGroupByLinha] = useState(false);
  const [groupBySub1, setGroupBySub1] = useState(false);
  const [groupByRep, setGroupByRep] = useState(false);
  const [groupByCatTecido, setGroupByCatTecido] = useState(false);
  // Default: agrupa por Tecido (nível 1) > Categoria (nível 2).
  const [groupByTecido, setGroupByTecido] = useState(true);
  const [groupByOrigem, setGroupByOrigem] = useState(false);
  // Grupos EXPANDIDOS (por caminho único pai/filho). Vazio = todos RECOLHIDOS —
  // default pedido pelo dono (ago/2026): a lista abre com os grupos fechados.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (path: string) =>
    setExpandedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path); else n.add(path);
      return n;
    });
  // Planejamento sempre abre com 5 colunas (não persiste a escolha entre acessos).
  const [cols, setCols] = useGridCols("planejamento", 5, true);
  const gridRef = useRef<HTMLDivElement>(null);
  const compact = useCompactCards(gridRef, cols);
  const fl = useFieldLabels();

  // As 7 listas de opção do Planejamento (mesmas queryKeys/queryFns de antes — cache
  // compartilhado com o detalhe do card via `usePlanejamentoOpts`, sem refetch duplo).
  const { estilistas, linhas, meses, anos, grupos, categorias, artigos } = usePlanejamentoOpts();

  const { isModuleEnabled } = useTenantModules();
  const otbOn = isModuleEnabled("otb");
  const { data: colecoesList = [] } = useQuery({
    queryKey: ["otb-colecoes-opts"],
    enabled: otbOn,
    queryFn: async () => {
      const { data } = await supabase.from("colecoes").select("id, nome, mes_id, ano_id").order("nome");
      return (data ?? []) as { id: string; nome: string; mes_id: string | null; ano_id: string | null }[];
    },
  });
  const { data: sub1Opts = [] } = useQuery({
    queryKey: ["opt", "subcategorias1_produto"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subcategorias1_produto").select("id, nome, categoria_id").order("nome");
      if (error) throw error;
      return (data ?? []) as SubOpt[];
    },
  });
  const { data: sub2Opts = [] } = useQuery({
    queryKey: ["opt", "subcategorias2_produto"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subcategorias2_produto").select("id, nome, categoria_id").order("nome");
      if (error) throw error;
      return (data ?? []) as SubOpt[];
    },
  });

  const { data: modelos = [] } = useQuery({
    queryKey: ["modelos-planejamento"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, nome, ref, ref_auto, estilista_id, linha_id, colecao, colecao_id, subcolecao, semana, mes_id, ano_id, categoria_principal_id, subcategoria1_id, status_planejamento, fotos_modelo, fotos_referencia, desenho_tecnico_url, croqui_url, observacoes_gerais, versao, modelo_base_id, preco_venda, origem, tecidos_planejados, lancado, custo_terceirizados_previsto, custo_terceirizados_aprovado, data_lancamento, observacoes_mao_obra, motivo_reprovacao_mao_obra")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Modelo[];
    },
  });

  const modeloIdsAll = useMemo(() => modelos.map((m) => m.id).sort(), [modelos]);

  // Custo unitário (real senão previsto) e grade planejada por modelo — p/ o preço
  // efetivo e o "poder de venda" (preço × grade).
  const { data: custoMap = {} } = useQuery({
    queryKey: ["plan-custo-unit", modeloIdsAll],
    enabled: modeloIdsAll.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("custo_unitario_modelos" as any, { _ids: modeloIdsAll });
      if (error) throw error;
      return (data ?? {}) as Record<string, { previsto: number; real: number; confirmado: boolean }>;
    },
  });
  // Estado da MO por serviço (badge do card) — derivado do resumo (`modelo_mo_resumo.estado`):
  // sem_servico | pendente | reprovada | aprovada. Substitui o antigo badge do flag
  // `custo_terceirizados_aprovado` (2 estados) por 4 estados. Sem custo exposto: só `estado`.
  // `linhas[]` (spec 2026-08-11, Task 2) alimenta a seção expandida de MO no card completo —
  // já vem mascarada (valor NULL) p/ quem não vê custos, mesmo shape do `moResumo` de `ModeloDialog`.
  const { data: moResumoLista = {} } = useQuery({
    queryKey: ["mo-resumo-list", modeloIdsAll],
    enabled: modeloIdsAll.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("modelo_mo_resumo" as any, { _ids: modeloIdsAll });
      if (error) throw error;
      return (data ?? {}) as Record<string, { estado: string; total: number | null; total_aprovado: number | null; linhas: MoLinha[] }>;
    },
  });
  const { data: gradeByModelo = {} } = useQuery({
    queryKey: ["plan-grade-total", modeloIdsAll],
    enabled: modeloIdsAll.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("modelo_grades").select("modelo_id, grade_total").in("modelo_id", modeloIdsAll);
      if (error) throw error;
      const m: Record<string, number> = {};
      for (const r of (data ?? []) as any[]) m[r.modelo_id] = (m[r.modelo_id] ?? 0) + Number(r.grade_total ?? 0);
      return m;
    },
  });
  // CQ liberado por modelo (Pré + Pós se há serviço pós-costura) → "pronto para lançar".
  // Reusa o SSOT `cqLiberado` (@/lib/cq-status) sobre o CAD embedado, p/ não divergir do
  // gate do setor Lançamento. Map modelo_id → boolean (CQ liberado, ainda sem olhar lançado).
  const { data: cqProntoMap = {} } = useQuery({
    queryKey: ["plan-cq-pronto", modeloIdsAll],
    enabled: modeloIdsAll.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cad")
        .select("modelo_id, controle_qualidade(status, status_pos), producao_terceirizados(ativo, categorias_terceirizado(etapa))")
        .in("modelo_id", modeloIdsAll);
      if (error) throw error;
      const m: Record<string, boolean> = {};
      for (const row of (data ?? []) as any[]) if (row.modelo_id) m[row.modelo_id] = cqLiberado(row);
      return m;
    },
  });
  // "lançado" | "pronto" | null — p/ filtro e badge. "pronto" = mesmo gate do botão
  // Lançar: CQ liberado E valor dos serviços externos aprovado, e ainda não lançado.
  const lancStatusDe = (m: Modelo): "lancado" | "pronto" | null => {
    if (m.lancado) return "lancado";
    const cqOk = !!(cqProntoMap as Record<string, boolean>)[m.id];
    return cqOk && !!(m as any).custo_terceirizados_aprovado ? "pronto" : null;
  };

  const colecoes = useMemo(() => {
    const s = new Set<string>();
    modelos.forEach((m) => m.colecao && s.add(m.colecao));
    return Array.from(s).sort();
  }, [modelos]);

  const subcolecoes = useMemo(() => {
    const s = new Set<string>();
    modelos.forEach((m) => m.subcolecao && s.add(m.subcolecao));
    return Array.from(s).sort();
  }, [modelos]);

  // Coleção comum dos cards selecionados (p/ o BulkEditDialog oferecer as subcoleções
  // certas sem exigir escolher Coleção). null se a seleção mistura coleções (ou nenhuma).
  const bulkColecaoId = useMemo(() => {
    if (!selected.size) return null;
    const byId = new Map(modelos.map((m) => [m.id, m]));
    const cols = new Set([...selected].map((id) => byId.get(id)?.colecao_id ?? null));
    return cols.size === 1 ? ([...cols][0] ?? null) : null;
  }, [selected, modelos]);

  const catGrupoMap = Object.fromEntries(categorias.map((c) => [c.id, c.grupo_id]));
  // CASCATA Grupo→Categoria (filtro): opções de Categoria = união das categorias dos
  // grupos marcados (nenhum grupo marcado = todas as categorias).
  const categoriasParaFiltro = !fGrupo.length ? categorias : categorias.filter((c) => fGrupo.includes(c.grupo_id ?? ""));
  // PODA: ao desmarcar/trocar Grupo, remove de fCat os ids que saíram da união acima —
  // idempotente (só remove, nunca reintroduz), evita filtro de Categoria "fantasma".
  useEffect(() => {
    const validos = new Set(categoriasParaFiltro.map((c) => c.id));
    const podado = fCat.filter((id) => validos.has(id));
    if (podado.length !== fCat.length) setFCat(podado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fGrupo, categorias]);
  // "Repetição" = versão v2 em diante (cópia). O original (v1) é "único".
  const isRepeticao = (m: Modelo) => (m.versao ?? 1) > 1;
  const filtered = modelos.filter((m) => {
    // Lupa casa por nome OU REF (ref/ref_auto — a REF só é exibida a partir do
    // Desenvolvimento, mas ref_auto já existe desde a chegada lá). Mesma normalização
    // do nome (sem accent-fold — o filtro de nome também não normaliza acento).
    if (search) {
      const q = search.toLowerCase();
      const okNome = (m.nome ?? "").toLowerCase().includes(q);
      const okRef = (m.ref ?? "").toLowerCase().includes(q);
      const okRefAuto = (m.ref_auto ?? "").toLowerCase().includes(q);
      if (!okNome && !okRef && !okRefAuto) return false;
    }
    if (fStatus.length && !fStatus.includes(m.status_planejamento ?? "")) return false;
    if (fEstilista.length && !fEstilista.includes(m.estilista_id ?? "")) return false;
    if (fSemana.length && !fSemana.includes(m.semana ?? "")) return false;
    if (fMes.length && !fMes.includes(m.mes_id ?? "")) return false;
    if (fAno.length && !fAno.includes(m.ano_id ?? "")) return false;
    if (fGrupo.length && !fGrupo.includes((m.categoria_principal_id ? catGrupoMap[m.categoria_principal_id] : null) ?? "")) return false;
    if (fCat.length && !fCat.includes(m.categoria_principal_id ?? "")) return false;
    if (fColecao.length && !fColecao.includes(m.colecao ?? "")) return false;
    if (fSubcolecao.length && !fSubcolecao.includes(m.subcolecao ?? "")) return false;
    if (fSub1.length && !fSub1.includes(m.subcategoria1_id ?? "")) return false;
    if (fRep.length && !fRep.includes(isRepeticao(m) ? "rep" : "uni")) return false;
    if (fOrigem.length && !fOrigem.includes(m.origem ?? "interno")) return false;
    if (fLancamento.length && !fLancamento.includes(lancStatusDe(m) ?? "")) return false;
    return true;
  });

  const estMap = Object.fromEntries(estilistas.map((e) => [e.id, e.nome]));
  const catMap = Object.fromEntries(categorias.map((c) => [c.id, c.nome]));
  const sub1Map = Object.fromEntries(sub1Opts.map((s) => [s.id, s.nome]));
  const linhaMap = Object.fromEntries(linhas.map((l) => [l.id, l.nome]));
  const artigoMap = Object.fromEntries(artigos.map((a) => [a.id, a.nome]));
  // artigo → categoria de tecido (id + nome), p/ o agrupamento "Categoria de tecido".
  const artigoCatTecMap = Object.fromEntries(artigos.map((a) => [a.id, (a as any).categoria_tecido_id ?? null]));
  const catTecNomeMap = Object.fromEntries(
    artigos.filter((a) => (a as any).categoria_tecido_id).map((a) => [(a as any).categoria_tecido_id, (a as any).categorias_tecido?.nome ?? "—"]),
  );
  const linhaMarkupMap = Object.fromEntries(linhas.map((l) => [l.id, l.markup]));
  // Preço/markup efetivos de um modelo (custo × markup da linha → sugerido → venda).
  const piFor = (m: Modelo) =>
    precoInfo((custoMap as any)[m.id]?.real, m.linha_id ? linhaMarkupMap[m.linha_id] : 0, m.preco_venda);
  const mesMap = Object.fromEntries(meses.map((x) => [x.id, x.nome]));
  const anoMap = Object.fromEntries(anos.map((x) => [x.id, x.nome]));

  // Ordenação dos cards. Como nome/estilista/categoria/coleção/linha/status são
  // exibidos formatados (ou via mapa de id→nome), ordenamos pelo VALOR CRU usando
  // accessors. `sorted` substitui o array `filtered` na renderização e no agrupamento.
  // estMap/catMap/linhaMap são recriados a cada render (Object.fromEntries), logo
  // dependemos das listas estáveis (estilistas/categorias/linhas) p/ não recriar o
  // objeto de accessors — e assim o useMemo do useSort não recomputa em todo render.
  const sortAccessors = useMemo(() => ({
    estilista: (m: Modelo) => (m.estilista_id ? estMap[m.estilista_id] : null),
    categoria: (m: Modelo) => (m.categoria_principal_id ? catMap[m.categoria_principal_id] : null),
    linha: (m: Modelo) => (m.linha_id ? linhaMap[m.linha_id] : null),
    status: (m: Modelo) => statusMeta(m.status_planejamento).label,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [estilistas, categorias, linhas]);
  // `opts` precisa ser estável (referência) — senão o useMemo interno do useSort,
  // que tem `opts` nas deps, recomputa a ordenação a cada render.
  const sortOpts = useMemo(() => ({ accessors: sortAccessors }), [sortAccessors]);
  const s = useSort(filtered, sortOpts);
  const sorted = s.sorted;

  // Resumo (poder de venda = Σ preço efetivo × grade; markup médio real = média
  // aritmética do markup real dos que o têm) — de uma lista qualquer de modelos.
  const computeResumo = (items: Modelo[]) => {
    let poder = 0, somaMk = 0, nMk = 0;
    for (const m of items) {
      const p = piFor(m);
      poder += p.efetivo * numOr0((gradeByModelo as any)[m.id]);
      if (p.markupReal > 0) { somaMk += p.markupReal; nMk++; }
    }
    return { poder, qtd: items.length, markupMedio: nMk > 0 ? somaMk / nMk : 0 };
  };
  const resumo = computeResumo(sorted);

  // Sentinela "__none__" = ordem padrão. (Radix Select v2 PROÍBE SelectItem com
  // value "" — daí o sentinela.) Como não existe accessor "__none__" nem campo
  // homônimo no Modelo, useSort lê undefined p/ todos → comparador estável →
  // devolve a ordem original (created_at desc da query). Tratamos como "sem ordenação".
  const SORT_NONE = "__none__";
  const SORT_COLS: { key: string; label: string }[] = [
    { key: SORT_NONE, label: "Padrão" },
    { key: "nome", label: "Nome" },
    { key: "estilista", label: fl("estilista") },
    { key: "colecao", label: fl("colecao") },
    { key: "categoria", label: "Categoria" },
    { key: "linha", label: "Linha" },
    { key: "semana", label: "Lançamento" },
    { key: "status", label: "Status" },
  ];

  const renderCard = (m: Modelo) => (
    <div key={m.id} className="relative">
      <div className="absolute left-2 top-2 z-10">
        <Checkbox checked={selected.has(m.id)} onCheckedChange={() => toggleSel(m.id)} className="bg-background/80 shadow-sm" />
      </div>
      <ModeloCard
        modelo={m}
        estilistaNome={m.estilista_id ? estMap[m.estilista_id] : null}
        categoriaNome={m.categoria_principal_id ? catMap[m.categoria_principal_id] : null}
        linhaNome={m.linha_id ? linhaMap[m.linha_id] : null}
        custo={(() => { const p = piFor(m); return p.custo > 0 ? p.custo : null; })()}
        custoReal={!!(custoMap as any)[m.id]?.confirmado}
        markup={(() => { const p = piFor(m); return p.markupExibir > 0 ? p.markupExibir : null; })()}
        preco={(() => { const p = piFor(m); return p.efetivo > 0 ? p.efetivo : null; })()}
        maoObra={(() => {
          const ls = lancStatusDe(m);
          const c = (custoMap as any)[m.id];
          return ls != null ? (c?.mao_obra_real ?? null) : (c?.mao_obra_previsto ?? null);
        })()}
        custoMat={(() => {
          const p = piFor(m);
          const custo = p.custo > 0 ? p.custo : null;
          if (custo == null) return null;
          const ls = lancStatusDe(m);
          const c = (custoMap as any)[m.id];
          const maoObra = ls != null ? (c?.mao_obra_real ?? null) : (c?.mao_obra_previsto ?? null);
          return maoObra != null ? custo - maoObra : custo;
        })()}
        moEstado={(moResumoLista as Record<string, { estado: string }>)[m.id]?.estado ?? null}
        linhasMO={(moResumoLista as Record<string, { linhas?: MoLinha[] }>)[m.id]?.linhas ?? []}
        onAprovarMO={(categoriaId) => aprovarServicoMOLista.mutate({ modeloId: m.id, categoriaId, aprovado: true })}
        onReprovarMO={(categoriaId, motivo) => aprovarServicoMOLista.mutate({ modeloId: m.id, categoriaId, aprovado: false, motivo })}
        // Guard de duplo-clique: a mutation é COMPARTILHADA por todos os cards da lista — só
        // resolve um categoriaId "pendente" pra ESTE card quando o `modeloId` em voo bate com
        // `m.id` (senão aprovar num card deixaria botões de OUTROS cards desabilitados à toa).
        pendingCategoriaMO={aprovarServicoMOLista.isPending && aprovarServicoMOLista.variables?.modeloId === m.id ? aprovarServicoMOLista.variables.categoriaId : undefined}
        dataLancamento={(m as any).data_lancamento ?? null}
        onLancar={(data, send) => lancarCard.mutate({ id: m.id, data, send })}
        lancStatus={lancStatusDe(m)}
        mesNome={m.mes_id ? mesMap[m.mes_id] : null}
        anoNome={m.ano_id ? anoMap[m.ano_id] : null}
        onOpen={() => setOpenId(m.id)}
        compact={compact}
      />
    </div>
  );

  // Agrupamentos combináveis: por linha, categoria e/ou repetição. Aninhamento de
  // amplo→fino (linha › categoria › repetição); qualquer combinação liga/desliga
  // independente. Cada nó carrega o próprio resumo (poder de venda etc.).
  type Split = { key: string; nome: string; items: Modelo[] };
  // "__none__" (Sem categoria/linha/subcategoria/tecido) sempre por ÚLTIMO; o resto alfabético pt-BR.
  const sortSplits = (a: Split, b: Split) =>
    a.key === "__none__" ? 1 : b.key === "__none__" ? -1 : a.nome.localeCompare(b.nome, "pt-BR");
  const byLinha = (items: Modelo[]): Split[] => {
    const map = new Map<string, Modelo[]>();
    items.forEach((m) => {
      const key = m.linha_id ?? "__none__";
      const arr = map.get(key);
      if (arr) arr.push(m); else map.set(key, [m]);
    });
    return Array.from(map.entries())
      .map(([key, its]) => ({ key, nome: key === "__none__" ? "Sem linha" : linhaMap[key] ?? "Sem linha", items: its }))
      .sort(sortSplits);
  };
  const byCat = (items: Modelo[]): Split[] => {
    const map = new Map<string, Modelo[]>();
    items.forEach((m) => {
      const key = m.categoria_principal_id ?? "__none__";
      const arr = map.get(key);
      if (arr) arr.push(m); else map.set(key, [m]);
    });
    return Array.from(map.entries())
      .map(([key, its]) => ({ key, nome: key === "__none__" ? "Sem categoria" : catMap[key] ?? "Sem categoria", items: its }))
      .sort(sortSplits);
  };
  const bySub1 = (items: Modelo[]): Split[] => {
    const map = new Map<string, Modelo[]>();
    items.forEach((m) => {
      const key = m.subcategoria1_id ?? "__none__";
      const arr = map.get(key);
      if (arr) arr.push(m); else map.set(key, [m]);
    });
    return Array.from(map.entries())
      .map(([key, its]) => ({ key, nome: key === "__none__" ? "Sem subcategoria" : sub1Map[key] ?? "Sem subcategoria", items: its }))
      .sort(sortSplits);
  };
  const byRep = (items: Modelo[]): Split[] => {
    const reps = items.filter(isRepeticao);
    const unis = items.filter((m) => !isRepeticao(m));
    const out: Split[] = [];
    if (reps.length) out.push({ key: "rep", nome: "Repetidos", items: reps });
    if (unis.length) out.push({ key: "uni", nome: "Únicos", items: unis });
    return out;
  };
  // Origem: Interno (padrão/NULL) × Revenda — mesma leitura do filtro (fOrigem acima).
  const byOrigem = (items: Modelo[]): Split[] => {
    const map = new Map<string, Modelo[]>();
    items.forEach((m) => {
      const key = (m.origem ?? "interno") === "revenda" ? "revenda" : "interno";
      const arr = map.get(key);
      if (arr) arr.push(m); else map.set(key, [m]);
    });
    return Array.from(map.entries())
      .map(([key, its]) => ({ key, nome: key === "revenda" ? "Revenda" : "Interno", items: its }))
      .sort(sortSplits);
  };
  // Categoria de tecido: MULTI-PERTENCIMENTO (deriva da categoria dos tecidos_planejados do modelo).
  // Um modelo com tecidos de categorias diferentes aparece em cada categoria.
  const byCatTecido = (items: Modelo[]): Split[] => {
    const map = new Map<string, Modelo[]>();
    items.forEach((m) => {
      const cats = [...new Set((m.tecidos_planejados ?? []).filter(Boolean).map((a) => artigoCatTecMap[a]).filter(Boolean))] as string[];
      const keys = cats.length ? cats : ["__none__"];
      keys.forEach((k) => { const arr = map.get(k); if (arr) arr.push(m); else map.set(k, [m]); });
    });
    return Array.from(map.entries())
      .map(([key, its]) => ({ key, nome: key === "__none__" ? "Sem categoria de tecido" : catTecNomeMap[key] ?? "Sem categoria de tecido", items: its }))
      .sort(sortSplits);
  };
  // Tecido é MULTI-PERTENCIMENTO: um modelo com vários tecidos_planejados aparece em cada
  // grupo de tecido (por isso o poder de venda do grupo pode "somar mais" que o total).
  const byTecido = (items: Modelo[]): Split[] => {
    const map = new Map<string, Modelo[]>();
    items.forEach((m) => {
      const arts = (m.tecidos_planejados ?? []).filter(Boolean);
      const keys = arts.length ? arts : ["__none__"];
      keys.forEach((k) => {
        const arr = map.get(k);
        if (arr) arr.push(m); else map.set(k, [m]);
      });
    });
    return Array.from(map.entries())
      .map(([key, its]) => ({ key, nome: key === "__none__" ? "Sem tecido" : artigoMap[key] ?? "Sem tecido", items: its }))
      .sort(sortSplits);
  };
  // Ordem de aninhamento fixa (amplo→fino); os toggles só escolhem quais níveis entram.
  // Ordem = hierarquia de aninhamento. Tecido primeiro (nível 1), depois Categoria.
  const splitters: ((items: Modelo[]) => Split[])[] = [
    groupByCatTecido ? byCatTecido : null, // categoria de tecido é mais ampla que o tecido → nível acima
    groupByTecido ? byTecido : null,
    groupByLinha ? byLinha : null,
    groupByCat ? byCat : null,
    groupBySub1 ? bySub1 : null,
    groupByRep ? byRep : null,
    groupByOrigem ? byOrigem : null,
  ].filter(Boolean) as ((items: Modelo[]) => Split[])[];
  type Grupo = { key: string; nome: string; resumo: ReturnType<typeof computeResumo>; items?: Modelo[]; subgroups?: Grupo[] };
  const buildGroups = (items: Modelo[], depth: number): Grupo[] =>
    splitters[depth](items).map((g) => {
      const node: Grupo = { key: g.key, nome: g.nome, resumo: computeResumo(g.items) };
      if (depth + 1 < splitters.length) node.subgroups = buildGroups(g.items, depth + 1);
      else node.items = g.items;
      return node;
    });
  const groups: Grupo[] | null = splitters.length ? buildGroups(sorted, 0) : null;
  // Recolher/Expandir TODOS os grupos (dono, jul/2026). Paths iguais ao render: raiz = g.key,
  // aninhado = `${path}/${sub.key}`. Percorre todos os níveis (Tecido → Linha → Categoria…).
  const allGroupPaths: string[] = [];
  if (groups) {
    const walk = (nodes: Grupo[], path: string) => {
      for (const g of nodes) { const p = path ? `${path}/${g.key}` : g.key; allGroupPaths.push(p); if (g.subgroups) walk(g.subgroups, p); }
    };
    walk(groups, "");
  }
  const allGruposRecolhidos = allGroupPaths.length > 0 && allGroupPaths.every((p) => !expandedGroups.has(p));
  const toggleGrupos = () => setExpandedGroups(allGruposRecolhidos ? new Set(allGroupPaths) : new Set());

  // Render recursivo dos grupos (profundidade arbitrária). Título encolhe com a
  // profundidade; nós internos ganham barra/indentação à esquerda.
  const HEADER_CLS = ["text-lg font-semibold", "text-base font-semibold", "text-sm font-semibold text-muted-foreground"];
  // Nº de selecionados DENTRO do grupo (recursivo): feedback do "Selecionar todos" mesmo com os
  // grupos RECOLHIDOS — sem isso a seleção acontecia invisível e o botão parecia morto (dono ago/2026).
  const selCountOf = (g: Grupo): number =>
    g.subgroups
      ? g.subgroups.reduce((a, sg) => a + selCountOf(sg), 0)
      : (g.items ?? []).reduce((a, m) => a + (selected.has(m.id) ? 1 : 0), 0);

  const renderGroup = (g: Grupo, depth: number, path: string) => {
    const collapsed = !expandedGroups.has(path);
    const nSel = selCountOf(g);
    return (
      <section key={g.key}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => toggleGroup(path)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGroup(path); } }}
          className={`flex cursor-pointer select-none flex-wrap items-center gap-x-2 gap-y-1 ${depth === 0 ? "mb-3" : "mb-2"}`}
          aria-expanded={!collapsed}
        >
          {collapsed
            ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <h2 className={HEADER_CLS[Math.min(depth, HEADER_CLS.length - 1)]}>{g.nome}</h2>
          <ResumoVenda {...g.resumo} />
          {nSel > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              {nSel} selecionado{nSel === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {!collapsed && (g.subgroups ? (
          <div className="space-y-5 border-l pl-3">{g.subgroups.map((sg) => renderGroup(sg, depth + 1, `${path}/${sg.key}`))}</div>
        ) : (
          <div className={GRID_COLS_CLASS[cols]}>{g.items!.map(renderCard)}</div>
        ))}
      </section>
    );
  };

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-md:pb-24">
      {/* Seleção múltipla no HEADER STICKY (portal), ao lado do nome do módulo. Ativa
          mostra Todos / contagem / Definir em massa ali mesmo. NO MOBILE as ações de seleção
          NÃO ficam no header (dono ago/2026 — "ficou péssimo"): "Selecionar todos" mora na
          toolbar da página e as ações em massa descem pra MobileActionBar no rodapé. */}
      {!isMobile && (
        <HeaderActions>
          {selected.size > 0 ? (
            <>
              <Button size="sm" variant="ghost" onClick={clearSel}>Limpar ({selected.size})</Button>
              <Button size="sm" variant="ghost" onClick={selectAllFiltered}>Todos ({sorted.length})</Button>
              <Button size="sm" onClick={() => setOpenBulk(true)}>Definir em massa</Button>
              <Button size="sm" variant="destructive" disabled={bulkDel.isPending} onClick={() => setConfirmBulkDel(true)} aria-label="Excluir selecionados">
                <Trash2 className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Excluir</span>
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={selectAllFiltered} aria-label="Selecionar todos">
              <CheckSquare className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Selecionar todos</span>
            </Button>
          )}
        </HeaderActions>
      )}
      {isMobile && selected.size > 0 && (
        <MobileActionBar breakpoint="md">
          <Button variant="ghost" className="min-h-11" onClick={clearSel}>Limpar ({selected.size})</Button>
          <Button className="min-h-11 flex-1" onClick={() => setOpenBulk(true)}>Definir em massa</Button>
          <Button variant="destructive" className="min-h-11" disabled={bulkDel.isPending} onClick={() => setConfirmBulkDel(true)} aria-label="Excluir selecionados">
            <Trash2 className="h-4 w-4" />
          </Button>
        </MobileActionBar>
      )}
      <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <ClipboardList className="h-7 w-7 shrink-0 text-primary mt-0.5" />
          <div className="min-w-0">
            {/* Mobile: título curto — "Planejamento de Produto" cortava (dono ago/2026). */}
            <h1 className="font-display text-xl font-semibold tracking-tight truncate">
              <span className="md:hidden">P. Produto</span>
              <span className="hidden md:inline">Planejamento de Produto</span>
            </h1>
            <p className="text-sm text-muted-foreground">Cards de modelos em planejamento.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto max-sm:justify-end">
          <SearchToggle value={search} onChange={setSearch} placeholder="Pesquisar por nome ou REF…" />
          {groups && allGroupPaths.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="hidden md:inline-flex h-9"
              onClick={toggleGrupos}
              title={allGruposRecolhidos ? "Expandir todos os grupos" : "Recolher todos os grupos"}
            >
              {allGruposRecolhidos ? <ChevronsUpDown className="h-4 w-4 sm:mr-1" /> : <ChevronsDownUp className="h-4 w-4 sm:mr-1" />}
              <span className="max-lg:sr-only">{allGruposRecolhidos ? "Expandir todos" : "Recolher todos"}</span>
            </Button>
          )}
          {/* Mobile: "Selecionar todos" SÓ ÍCONE, na mesma linha do Agrupar, à esquerda dele
              (dono ago/2026 — as ações de seleção não moram no header sticky no mobile; as
              ações em massa aparecem na MobileActionBar ao selecionar). */}
          <Button
            variant="outline"
            className="md:hidden h-11 w-11 p-0"
            onClick={selectAllFiltered}
            aria-label="Selecionar todos"
            title="Selecionar todos"
          >
            <CheckSquare className="h-4 w-4" />
          </Button>
          <AgrupamentoButton
            groups={[
              { label: "Linha", active: groupByLinha, onToggle: () => setGroupByLinha((v) => !v) },
              { label: "Categoria", active: groupByCat, onToggle: () => setGroupByCat((v) => !v) },
              { label: "Subcategoria", active: groupBySub1, onToggle: () => setGroupBySub1((v) => !v) },
              { label: "Categoria de tecido", active: groupByCatTecido, onToggle: () => setGroupByCatTecido((v) => !v) },
              { label: "Tecido", active: groupByTecido, onToggle: () => setGroupByTecido((v) => !v) },
              { label: "Repetição", active: groupByRep, onToggle: () => setGroupByRep((v) => !v) },
              { label: "Origem", active: groupByOrigem, onToggle: () => setGroupByOrigem((v) => !v) },
            ]}
          />
          <FilterButton
            screen="planejamento"
            filters={[
              { label: "Status", value: fStatus, onChange: setFStatus, options: STATUS_OPTS.map((s) => ({ id: s.value, nome: s.label })) },
              { label: "Lançamento", value: fLancamento, onChange: setFLancamento, options: [{ id: "pronto", nome: "Prontos para lançar" }, { id: "lancado", nome: "Lançados" }] },
              { label: fl("estilista"), value: fEstilista, onChange: setFEstilista, options: estilistas },
              { label: "Lançamento nº", value: fSemana, onChange: setFSemana, options: ["1","2","3","4","5"].map((s) => ({ id: s, nome: s })) },
              { label: "Mês de Planejamento", value: fMes, onChange: setFMes, options: meses },
              { label: "Ano", value: fAno, onChange: setFAno, options: anos },
              { label: "Grupo", value: fGrupo, onChange: setFGrupo, options: grupos },
              { label: "Categoria", value: fCat, onChange: setFCat, options: categoriasParaFiltro },
              { label: "Subcategoria", value: fSub1, onChange: setFSub1, options: sub1Opts.map((s) => ({ id: s.id, nome: s.nome })) },
              { label: fl("colecao"), value: fColecao, onChange: setFColecao, options: colecoes.map((c) => ({ id: c, nome: c })) },
              { label: "Subcoleção", value: fSubcolecao, onChange: setFSubcolecao, options: subcolecoes.map((c) => ({ id: c, nome: c })) },
              { label: "Origem", value: fOrigem, onChange: setFOrigem, options: [{ id: "interno", nome: "Interno" }, { id: "revenda", nome: "Revenda" }] },
              { label: "Repetição", value: fRep, onChange: setFRep, options: [{ id: "rep", nome: "Repetidos" }, { id: "uni", nome: "Únicos" }] },
            ]}
          />
          <Button className="hidden md:inline-flex" variant="outline" onClick={() => setOpenBatch(true)} aria-label="Novos Cards"><Layers className="h-4 w-4 mr-1" />Novos Cards</Button>
          <Button className="hidden md:inline-flex" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" />Novo Modelo</Button>
        </div>
      </header>

      {/* Seleção migrou pro header (acima). Aqui ficam só o resumo de venda e a ordenação. */}
      <div className="flex items-center gap-2 flex-wrap max-sm:border-b max-sm:pb-3">
        <ResumoVenda {...resumo} className="max-sm:order-last max-sm:w-full" />
        <div className="flex items-center gap-1.5 ml-auto">
          <Label className="text-xs text-muted-foreground">Ordenar por</Label>
          <Select
            value={s.sortKey ?? SORT_NONE}
            // `toggle(v)` define a chave em ASC ao trocar de coluna; "Padrão"
            // (SORT_NONE) volta à ordem original. A direção (ASC/DESC) é invertida
            // pelo botão ao lado, não aqui (Radix não re-dispara onValueChange p/ a
            // mesma opção, então o toggle de direção precisa de um controle próprio).
            onValueChange={(v) => { if (v !== (s.sortKey ?? SORT_NONE)) s.toggle(v); }}
          >
            <SelectTrigger className="h-8 w-[140px]"><SelectValue placeholder="Padrão" /></SelectTrigger>
            <SelectContent>
              {SORT_COLS.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* Botão de direção: só aparece com uma coluna real escolhida. Inverte
              ASC↔DESC re-chamando toggle na MESMA chave (ramo que a UI de Select
              sozinha nunca alcançava). */}
          {s.sortKey && s.sortKey !== SORT_NONE && (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => s.toggle(s.sortKey!)}
              aria-label={s.sortDir === "asc" ? "Ordenar decrescente" : "Ordenar crescente"}
              title={s.sortDir === "asc" ? "Crescente" : "Decrescente"}
            >
              {s.sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
            </Button>
          )}
        </div>
        <div className="hidden lg:flex items-center gap-1.5">
          <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          <Label className="text-xs text-muted-foreground">Colunas</Label>
          <Select value={String(cols)} onValueChange={(v) => setCols(Number(v))}>
            <SelectTrigger className="h-8 w-16"><SelectValue /></SelectTrigger>
            <SelectContent>
              {GRID_COLS_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div ref={gridRef}>
      {filtered.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Nenhum modelo encontrado" description="Crie um modelo usando o botão Novo Modelo." />
      ) : groups ? (
        <div className="space-y-8">
          {groups.map((g) => renderGroup(g, 0, g.key))}
        </div>
      ) : (
        <div className={GRID_COLS_CLASS[cols]}>{sorted.map(renderCard)}</div>
      )}
      </div>

      {(openNew || openId) && (
        <PlanejamentoDetail
          modeloId={openId}
          onClose={() => {
            setOpenNew(false);
            setOpenId(null);
            // Deep-link `?modelo=<id>` consumido (FF4): limpa da URL ao fechar — senão um
            // F5/"voltar" do browser reabre o mesmo card sozinho (mantém o resto do search).
            if (modeloParam) navigate({ search: (prev) => ({ ...prev, modelo: undefined }), replace: true, resetScroll: false });
          }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["modelos-planejamento"] }); invalidarPlanTecido(); }}
        />
      )}

      {openBatch && (
        <BatchCardsDialog
          meses={meses}
          anos={anos}
          grupos={grupos}
          categorias={categorias}
          linhas={linhas}
          onClose={() => setOpenBatch(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["modelos-planejamento"] }); qc.invalidateQueries({ queryKey: ["otb-orcamento"] }); invalidarPlanTecido(); }}
        />
      )}

      {openBulk && (
        <BulkEditDialog
          ids={[...selected]}
          otbOn={otbOn}
          defaultColecaoId={bulkColecaoId}
          colecoes={colecoesList}
          grupos={grupos}
          categorias={categorias}
          sub1={sub1Opts}
          sub2={sub2Opts}
          estilistas={estilistas}
          linhas={linhas}
          meses={meses}
          anos={anos}
          statusOpts={STATUS_OPTS.map((s) => ({ id: s.value, nome: s.label }))}
          onClose={() => setOpenBulk(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["modelos-planejamento"] }); qc.invalidateQueries({ queryKey: ["otb-orcamento"] }); invalidarPlanTecido(); clearSel(); }}
        />
      )}

      <AlertDialog open={confirmBulkDel} onOpenChange={setConfirmBulkDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selected.size} card(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Exclui os cards selecionados do Planejamento. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive"
              onClick={(e) => { e.preventDefault(); bulkDel.mutate(); }} disabled={bulkDel.isPending}>
              {bulkDel.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Barra CONTEXTUAL: com seleção ativa, a barra de seleção (acima) substitui esta —
          duas barras fixed no rodapé se sobrepunham. */}
      {selected.size === 0 && (
        <MobileActionBar breakpoint="md">
          <Button variant="outline" onClick={() => setOpenBatch(true)}><Layers className="h-4 w-4 mr-1" /> Novos Cards</Button>
          <Button className="ml-auto" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" /> Novo Modelo</Button>
        </MobileActionBar>
      )}
    </div>
  );
}


function ModeloCard({ modelo, estilistaNome, categoriaNome, linhaNome, custo, custoReal, markup, preco, maoObra, custoMat, moEstado, linhasMO, onAprovarMO, onReprovarMO, pendingCategoriaMO, dataLancamento, onLancar, lancStatus, mesNome, anoNome, onOpen, compact }: {
  modelo: Modelo; estilistaNome: string | null; categoriaNome: string | null; linhaNome: string | null; custo: number | null; custoReal: boolean; markup: number | null; preco: number | null; maoObra: number | null; custoMat: number | null; moEstado: string | null; linhasMO: MoLinha[]; onAprovarMO: (categoriaId: string | null) => void; onReprovarMO: (categoriaId: string | null, motivo: string) => void; pendingCategoriaMO?: string | null; dataLancamento: string | null; onLancar: (data: string | null, send: boolean) => void; lancStatus: "lancado" | "pronto" | null; mesNome: string | null; anoNome: string | null; onOpen: () => void; compact?: boolean;
}) {
  // Hierarquia da capa: Foto do Modelo -> Desenho Técnico -> Croqui -> vazio.
  const cover = (modelo.fotos_modelo?.[0]) || modelo.desenho_tecnico_url || modelo.croqui_url || null;
  const url = useSignedUrlBucket(cover);
  const coverIsPdf = /\.pdf$/i.test(cover ?? "");
  const meta = statusMeta(modelo.status_planejamento);
  const [dtLanc, setDtLanc] = useState(dataLancamento ?? "");
  const { canView, canEdit } = useAuth();
  const podeVerCustos = canView("criacao_planejamento:custos");
  const podeAprovarMaoObra = canEdit("producao_servico_aprovacao");
  // Mão de obra por serviço (estado agregado do modelo): sem_servico | pendente | reprovada |
  // aprovada. Aprovar/reprovar é POR LINHA no editor do detalhe — o card só exibe o estado.
  const moTxt = moEstado === "aprovada" ? "Mão de obra aprovada"
    : moEstado === "reprovada" ? "Mão de obra reprovada"
    : moEstado === "sem_servico" ? "Sem serviço de mão de obra"
    : "Mão de obra pendente";
  const obsMO = String((modelo as any).observacoes_mao_obra ?? "").trim();
  // Tooltip que SEGUE o cursor: status + situação da mão de obra + obs. O motivo da reprova
  // (agora por serviço) fica visível na linha do serviço, dentro do editor do detalhe.
  const tip = (
    <div className="space-y-1">
      <div className="font-medium">{meta.label}</div>
      {(podeVerCustos || podeAprovarMaoObra) && <div>{moTxt}</div>}
      {obsMO && podeVerCustos && <div><span className="opacity-70">Obs. MO: </span>{obsMO}</div>}
    </div>
  );
  const { handlers, node } = useCursorTip(tip);
  return (
    <>
    <Card
      className={`overflow-hidden cursor-pointer hover:shadow-md transition-shadow border-l-4 ${meta.border}`}
      onClick={onOpen}
      {...handlers}
    >
      <div className="relative aspect-[3/4] bg-muted flex items-center justify-center overflow-hidden">
        {/* STATUS como badge TEXTUAL (não só a cor da borda — acessibilidade/daltônicos, laudo
            jul/2026). A mão de obra saiu daqui (era uma bolinha da MESMA paleta do status, que
            confundia os dois eixos) e virou um badge PRÓPRIO no corpo. */}
        <StatusBadge tone={meta.tone} title={meta.label} className="absolute top-1.5 right-1.5 z-10 rounded-full px-2 py-0.5 shadow-sm normal-case tracking-normal">
          {meta.label}
        </StatusBadge>
        {!url ? (
          <ImageIcon className="h-10 w-10 text-muted-foreground" />
        ) : coverIsPdf ? (
          <iframe src={`${url}#toolbar=0&navpanes=0&scrollbar=0`} title="" className="w-full h-full pointer-events-none" />
        ) : (
          <img src={url} alt={modelo.nome ?? ""} className="w-full h-full object-cover" />
        )}
      </div>
      {compact ? (
        // Compacto (mobile e desktop c/ muitas colunas): nome + STATUS textual + categoria + preço +
        // situação da MO (laudo: o compacto só mostrava nome/preço → status ficava só na cor da borda,
        // barreira p/ daltônicos, e sem contexto do modelo). Status por texto, não só cor.
        <div className="p-2 space-y-1">
          <h3 className="font-medium text-xs leading-tight truncate">{modelo.nome || "Sem nome"}</h3>
          <StatusBadge tone={meta.tone} className="rounded-full px-1.5 py-0.5">{meta.label}</StatusBadge>
          <div className="flex items-center gap-1">
            {categoriaNome && <span className="truncate text-[10px] text-muted-foreground">{categoriaNome}</span>}
            {(podeVerCustos || podeAprovarMaoObra) && (
              <StatusBadge
                tone={moEstado === "aprovada" || moEstado === "sem_servico" ? "success" : moEstado === "reprovada" ? "danger" : "warning"}
                title={moTxt}
                className="ml-auto shrink-0 rounded-full px-1 py-0.5"
              >
                MO
              </StatusBadge>
            )}
          </div>
          {podeVerCustos && <p className="text-[11px] font-medium truncate">{preco != null ? brl(preco) : "—"}</p>}
        </div>
      ) : (
        // Corpo cheio: status = borda do card (sem badge, poupa a linha). Uma info por
        // linha; custo (real/previsto) incluído.
        <div className="p-3 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm leading-tight truncate">{modelo.nome || "Sem nome"}</h3>
            <VersaoBadge versao={modelo.versao} />
          </div>
          <p className="text-xs text-muted-foreground truncate">{estilistaNome ?? "—"}</p>
          {/* Coleção | Subcoleção */}
          <div className="grid grid-cols-2 gap-x-3 [&>span]:truncate text-xs text-muted-foreground">
            <span>{modelo.colecao ?? "—"}</span><span>{modelo.subcolecao || "—"}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{modelo.semana ? `Lançamento ${modelo.semana}` : "—"}</p>
          <p className="text-xs text-muted-foreground truncate">{[mesNome, anoNome].filter(Boolean).join(" · ") || "—"}</p>
          {/* Linha | Categoria em 2 colunas (cabe sem cortar); Markup vai p/ a própria linha
              (antes eram 3 colunas num card estreito e o texto cortava). Markup = custo → gated. */}
          <div className="grid grid-cols-2 gap-x-3 [&>span]:truncate text-xs text-muted-foreground">
            <span title={linhaNome ?? undefined}>{linhaNome ?? "—"}</span>
            <span title={categoriaNome ?? undefined}>{categoriaNome ?? "—"}</span>
          </div>
          {podeVerCustos && <p className="text-xs text-muted-foreground truncate">Markup: {markup != null ? Number(markup).toLocaleString("pt-BR",{maximumFractionDigits:2}) : "—"}</p>}
          {podeVerCustos && <p className="text-xs text-muted-foreground truncate">{custoReal ? "Custo" : "Custo prev."}: {custoMat != null ? brl(custoMat) : "—"}</p>}
          {(podeVerCustos || podeAprovarMaoObra) && (
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-dashed pt-1.5 text-xs">
              {/* Mão de obra em CANAL PRÓPRIO (badge ícone, não a bolinha do status). Estado
                  agregado por serviço; aprovar/reprovar é por linha no editor do detalhe. */}
              <StatusBadge
                tone={moEstado === "aprovada" || moEstado === "sem_servico" ? "success" : moEstado === "reprovada" ? "danger" : "warning"}
                className="shrink-0 gap-1 rounded-full px-2 py-0.5 normal-case tracking-normal"
              >
                {moEstado === "aprovada" || moEstado === "sem_servico" ? <Check className="h-3 w-3" /> : moEstado === "reprovada" ? <X className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                MO {moEstado === "sem_servico" ? "—" : moEstado === "aprovada" ? "aprovada" : moEstado === "reprovada" ? "reprovada" : "pendente"}
              </StatusBadge>
              {podeVerCustos && <span className="truncate text-muted-foreground">{maoObra != null ? brl(maoObra) : "—"}</span>}
            </div>
          )}
          {/* Seção EXPANDIDA de MO por serviço (spec 2026-08-11, Task 2 — decisão do dono: sempre
              visível, não popover). Aprovar/reprovar POR SERVIÇO direto da lista, sem abrir o
              card. Oculta p/ revenda (não tem MO, invariante #8/§Revenda) e p/ "sem_servico" (o
              badge acima já cobre esse caso; a seção sozinha ficaria vazia). */}
          {(podeVerCustos || podeAprovarMaoObra) && moEstado !== "sem_servico" && modelo.origem !== "revenda" && (
            <MoListaSection
              linhas={linhasMO}
              podeVerCustos={podeVerCustos}
              podeAprovarMaoObra={podeAprovarMaoObra}
              onAprovar={onAprovarMO}
              onReprovar={onReprovarMO}
              pendingCategoriaId={pendingCategoriaMO}
            />
          )}
          {podeVerCustos && (preco != null ? <p className="text-xs font-medium truncate">{brl(preco)}</p> : <p className="text-xs text-muted-foreground truncate">Preço: —</p>)}
          {/* "Lançar" = AÇÃO clara (verbo), alvo grande — antes era um foguete de 16px que lançava
              sem confirmação, colado na data (laudo Fitts). "Lançamento N" (a onda) é OUTRA coisa,
              acima nos chips. Botão: âmbar=pronto p/ lançar · verde=lançado (clica p/ cancelar) ·
              cinza=indisponível (falta CQ/MO). */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-dashed pt-1.5 text-xs" onClick={(e) => e.stopPropagation()}>
            <span className="shrink-0 text-muted-foreground">Lançar em</span>
            <DateField value={dtLanc} onChange={(e) => setDtLanc(e.target.value)}
              className="h-7 w-[6.6rem] shrink-0 [&_input]:h-7 [&_input]:px-1.5 [&_input]:text-xs" />
            {/* Só o ícone (a linha já diz "Lançar em") — botão de tamanho adequado (não o foguete
                de 16px do laudo); estado por cor + tooltip: âmbar pronto · verde lançado (clica p/
                cancelar) · cinza indisponível. */}
            <button type="button" disabled={lancStatus == null}
              aria-label={lancStatus === "lancado" ? "Cancelar lançamento" : "Lançar"}
              title={lancStatus === "lancado" ? "Cancelar lançamento" : lancStatus === "pronto" ? "Lançar este modelo" : "Disponível só com CQ liberado e mão de obra aprovada"}
              onClick={() => onLancar(dtLanc || null, lancStatus !== "lancado")}
              className={`ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border max-md:h-11 max-md:w-11 ${
                lancStatus === "lancado" ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
                : lancStatus === "pronto" ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                : "cursor-not-allowed border-input text-muted-foreground/60"}`}>
              <Rocket className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </Card>
    {node}
    </>
  );
}


/* ============ BATCH — criar vários cards ============ */

type CatRow = {
  categoria_id: string | null;
  quantidade: string; // mantido como texto p/ permitir apagar/digitar livremente
};

// Quantidade digitada → inteiro (vazio/invalid = 0).
const parseQtd = (s: string) => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const emptyCatRow = (): CatRow => ({
  categoria_id: null,
  quantidade: "1",
});

function BatchCardsDialog({
  meses, anos, grupos, categorias, linhas, onClose, onSaved,
}: {
  meses: Opt[]; anos: Opt[]; grupos: Opt[]; categorias: CatOpt[]; linhas: LinhaOpt[];
  onClose: () => void; onSaved: () => void;
}) {
  const grupoMap = Object.fromEntries(grupos.map((g) => [g.id, g.nome]));
  // Rótulo "Grupo › Categoria" (a lista é plana; sem o grupo, categorias homônimas confundem).
  const catLabel = (c: CatOpt) => (c.grupo_id && grupoMap[c.grupo_id] ? `${grupoMap[c.grupo_id]} › ${c.nome}` : c.nome);
  // Campos compartilhados por todos os cards (mesmo "core" do Novo Modelo,
  // sem nome/estilista/tecido/fotos).
  const { isModuleEnabled: batchIsModuleEnabled } = useTenantModules();
  const otbOn = batchIsModuleEnabled("otb");
  const orc = useOrcamento();
  const { data: colecoesBatch = [] } = useQuery({
    queryKey: ["otb-colecoes-opts"],
    enabled: otbOn,
    queryFn: async () => {
      const { data } = await supabase.from("colecoes").select("id, nome, mes_id, ano_id").order("nome");
      return (data ?? []) as { id: string; nome: string; mes_id: string | null; ano_id: string | null }[];
    },
  });
  const [colecao, setColecao] = useState("");
  const [colecaoId, setColecaoId] = useState<string | null>(null);
  const [subcolecao, setSubcolecao] = useState("");
  const [linhaId, setLinhaId] = useState<string | null>(null);
  const { data: subOpts = [] } = useQuery({
    queryKey: ["batch-subcolecoes", colecaoId],
    enabled: otbOn && !!colecaoId,
    queryFn: async () => (await supabase.from("colecao_subcolecoes").select("nome").eq("colecao_id", colecaoId!).order("ordem")).data?.map((r: any) => r.nome as string) ?? [],
  });
  const [status, setStatus] = useState("em_planejamento");
  const [semana, setSemana] = useState("");
  const [mesId, setMesId] = useState<string | null>(null);
  const [anoId, setAnoId] = useState<string | null>(null);
  const [rows, setRows] = useState<CatRow[]>([emptyCatRow()]);

  const { dirty } = useDirtySnapshot({ colecao, colecaoId, subcolecao, linhaId, status, semana, mesId, anoId, rows });
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose });

  const total = rows.reduce(
    (sum, r) => sum + (r.categoria_id ? parseQtd(r.quantidade) : 0),
    0,
  );

  const setRow = (i: number, patch: Partial<CatRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyCatRow()]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  // Cada categoria só pode aparecer uma vez (sem subcategoria no Planejamento).
  const usedCats = (exceptIdx: number) =>
    new Set(
      rows
        .filter((r, j) => j !== exceptIdx && r.categoria_id)
        .map((r) => r.categoria_id as string),
    );

  const create = useMutation({
    mutationFn: async () => {
      const payloads: any[] = [];
      const combos = new Set<string>();
      for (const r of rows) {
        if (!r.categoria_id) continue;
        const qtd = parseQtd(r.quantidade);
        if (qtd < 1)
          throw new Error("A quantidade de cada categoria deve ser ao menos 1.");
        if (combos.has(r.categoria_id))
          throw new Error("Há categorias repetidas. Some as quantidades.");
        combos.add(r.categoria_id);
        for (let n = 0; n < qtd; n++) {
          payloads.push({
            nome: "",
            estilista_id: null,
            colecao,
            colecao_id: colecaoId,
            subcolecao,
            linha_id: linhaId,
            semana,
            mes_id: mesId,
            ano_id: anoId,
            categoria_principal_id: r.categoria_id,
            tecidos_planejados: [],
            status_planejamento: status,
            fotos_modelo: [],
            fotos_referencia: [],
            observacoes_gerais: "",
            versao: 1,
            modelo_base_id: null,
          });
        }
      }
      if (payloads.length === 0) throw new Error("Selecione ao menos uma categoria.");
      // tenant_id é preenchido pelo trigger set_tenant_id.
      const { error } = await supabase.from("modelos").insert(payloads);
      if (error) throw error;
      return payloads.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} ${n === 1 ? "card criado" : "cards criados"}`);
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao criar cards")),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!grid-rows-[auto_minmax(0,1fr)_auto] max-sm:!overflow-hidden">
        <DialogHeader className="max-sm:shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <span>Criar vários cards</span>
            <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 max-sm:min-h-0 max-sm:min-w-0 max-sm:overflow-y-auto">
          <div>
            <p className="text-sm font-medium mb-2">Campos compartilhados</p>
            <p className="text-xs text-muted-foreground mb-3">Aplicados a todos os cards criados.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {otbOn ? (
                <FieldSelect
                  label="Coleção"
                  value={colecaoId ?? null}
                  onChange={(v) => {
                    const col = colecoesBatch.find((c) => c.id === v);
                    setColecaoId(v);
                    setColecao(col?.nome ?? colecao);
                    if (!mesId && col?.mes_id) setMesId(col.mes_id);
                    if (!anoId && col?.ano_id) setAnoId(col.ano_id);
                    setSubcolecao("");
                    setLinhaId(null);
                  }}
                  options={colecoesBatch.map((c) => ({ id: c.id, nome: orcLabel(c.nome, orc.colecao(c.id)) }))}
                />
              ) : (
                <FieldText label="Coleção" value={colecao} onChange={setColecao} />
              )}
              <div className="grid gap-1">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {otbOn && (
                <div className="grid gap-1">
                  <Label>Subcoleção</Label>
                  <Select value={subcolecao || "__none__"} onValueChange={(v) => setSubcolecao(v === "__none__" ? "" : v)} disabled={!colecaoId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">—</SelectItem>
                      {subOpts.map((s) => (
                        <SelectItem key={s} value={s}>{orcLabel(s, orc.subcolecao(colecaoId, s))}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-1">
                <Label>Lançamento</Label>
                <Select value={semana || ""} onValueChange={setSemana}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {["1","2","3","4","5"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <FieldSelect label="Mês de Planejamento" value={mesId} onChange={(v) => setMesId(v)} options={meses} />
              <FieldSelect label="Ano" value={anoId} onChange={(v) => setAnoId(v)} options={anos} />
              {otbOn && (
                <div className="grid gap-1">
                  <Label>Linha</Label>
                  <Select value={linhaId ?? "__none__"} onValueChange={(v) => setLinhaId(v === "__none__" ? null : v)} disabled={!colecaoId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">—</SelectItem>
                      {linhas.map((l) => (
                        <SelectItem key={l.id} value={l.id}>{orcLabel(l.nome, orc.nivel3(colecaoId, subcolecao, l.id))}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Categorias</p>
            <p className="text-xs text-muted-foreground mb-3">
              Selecione a categoria e a quantidade de cards.
            </p>
            <div className="space-y-2">
              {rows.map((r, i) => {
                const used = usedCats(i);
                const opts = categorias.filter(
                  (c) => !used.has(c.id) || c.id === r.categoria_id,
                );
                return (
                  <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                    <div className="grid gap-1 flex-1 min-w-[150px]">
                      <Label className="text-xs">Categoria</Label>
                      <Select
                        value={r.categoria_id ?? ""}
                        onValueChange={(v) => setRow(i, { categoria_id: v })}
                      >
                        <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                        <SelectContent>
                          {opts.map((c) => <SelectItem key={c.id} value={c.id}>{catLabel(c)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1 w-20">
                      <Label className="text-xs">Qtd</Label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={r.quantidade}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "" || /^\d+$/.test(v)) setRow(i, { quantidade: v });
                        }}
                        onBlur={() => {
                          const n = parseQtd(r.quantidade);
                          setRow(i, { quantidade: String(n > 0 ? n : 1) });
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(i)}
                      disabled={rows.length === 1}
                      aria-label="Remover categoria"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={addRow}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar categoria
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            Total: <span className="font-medium text-foreground">{total}</span>{" "}
            {total === 1 ? "card" : "cards"} serão criados.
          </p>
          {/* Por que "Total 0" com Qtd 1? A linha só conta com categoria escolhida (laudo jul/2026). */}
          {total === 0 && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />Escolha a categoria em cada linha para os cards serem contados.
            </p>
          )}
          {otbOn && colecaoId && (() => {
            const cb = orc.colecao(colecaoId);
            if (!cb) return null;
            const sb = subcolecao ? orc.subcolecao(colecaoId, subcolecao) : null;
            const nb = (linhaId && subcolecao) ? orc.nivel3(colecaoId, subcolecao, linhaId) : null;
            const proj = (b: { total: number; realizado: number } | null) => b ? `${b.realizado + total}/${b.total}` : null;
            return (
              <p className="text-xs text-muted-foreground">
                Com esse planejamento: <b>{proj(cb)}</b> nesta coleção
                {sb && <> · <b>{proj(sb)}</b> nesta subcoleção</>}
                {nb && <> · <b>{proj(nb)}</b> nesta linha</>}
              </p>
            );
          })()}
        </div>

        <DialogFooter className="gap-2 max-sm:shrink-0 max-sm:flex-row max-sm:items-center max-sm:border-t max-sm:bg-background max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:py-3">
          <Button variant="outline" onClick={requestClose} aria-label="Voltar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
            <ArrowLeft className="h-4 w-4 sm:mr-1" />
            <span className="max-sm:sr-only">Voltar</span>
          </Button>
          <Button className="max-sm:ml-auto" onClick={() => create.mutate()} disabled={create.isPending || total === 0}>
            {create.isPending ? "Criando…" : `Criar ${total} ${total === 1 ? "card" : "cards"}`}
          </Button>
        </DialogFooter>

        <UnsavedChangesGuard confirm={confirm} message="Há dados não salvos na criação de cards." />
      </DialogContent>
    </Dialog>
  );
}

