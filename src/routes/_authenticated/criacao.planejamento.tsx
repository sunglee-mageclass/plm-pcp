import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette, Plus, Search, Upload, Trash2, Copy, ImageIcon, Layers, LayoutGrid, ArrowLeft, ArrowUp, ArrowDown, CheckSquare, Save, ChevronDown, ChevronRight, AlertTriangle, Rocket, Check, X } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";


import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { useAuth } from "@/hooks/useAuth";
import { ObsMaoObraField } from "@/components/shared/ObsMaoObraField";
import { Textarea } from "@/components/ui/textarea";
import { NumberInput } from "@/components/shared/NumberInput";
import { DateField } from "@/components/shared/DateField";
import { ResumoVenda } from "@/components/shared/ResumoVenda";
import { HeaderActions } from "@/components/shared/HeaderActions";
import { useCursorTip } from "@/components/shared/CursorTip";
import { precoInfo, custoSimulado, type CustoSimInput } from "@/lib/preco";
import { cqLiberado } from "@/lib/cq-status";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { useGridCols, GRID_COLS_OPTIONS, GRID_COLS_CLASS, useCompactCards } from "@/hooks/useGridCols";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { brl, fmtNum } from "@/lib/format";
import { FilterButton, SearchToggle, AgrupamentoButton } from "@/components/shared/filters";
import { useSort } from "@/components/shared/sort";
import { EmptyState } from "@/components/shared/EmptyState";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { Breadcrumb } from "@/components/shared/Breadcrumb";

import { RequirePermission } from "@/components/RequirePermission";
import { useTenantModules } from "@/hooks/useTenantModules";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { BulkEditDialog } from "@/components/planejamento/BulkEditDialog";
import { ProdutoRelacionadoSetor } from "@/components/planejamento/ProdutoRelacionadoSetor";
import { useOrcamento, orcLabel } from "@/components/otb/orcamento";
export const Route = createFileRoute("/_authenticated/criacao/planejamento")({
  component: () => (
    <RequirePermission page="criacao_planejamento">
      <PlanejamentoPage />
    </RequirePermission>
  ),
});

const BUCKET = "modelos";

/**
 * Sincroniza tecidos_planejados (Planejamento) com modelo_tecidos tipo "tecido" (Desenvolvimento).
 * - Preserva blocos não-tecido (forro/entretela/etc).
 * - Se o artigo de um numero mudou, limpa variantes daquela linha.
 * - Remove tecidos cujo numero não está mais em planejados.
 * - Insere novos com consumo=0.
 */
async function syncTecidosToDesenvolvimento(modeloId: string, planejados: string[]) {
  const { data: existing, error: eFetch } = await supabase
    .from("modelo_tecidos")
    .select("id, artigo_id, numero, tipo")
    .eq("modelo_id", modeloId)
    .eq("tipo", "tecido");
  if (eFetch) throw eFetch;
  const rows = (existing ?? []) as any[];

  // Casa por ARTIGO (e não por posição): assim REORDENAR ou REMOVER um tecido no
  // Planejamento NÃO apaga as variantes/cores e o consumo já preenchidos no
  // Desenvolvimento — só reposiciona (numero) ou insere/remove o que mudou.
  const usedIds = new Set<string>();
  for (let i = 0; i < planejados.length; i++) {
    const numero = i + 1;
    const artigoId = planejados[i];
    const match = rows.find((r) => r.artigo_id === artigoId && !usedIds.has(r.id));
    if (match) {
      usedIds.add(match.id);
      if (match.numero !== numero) {
        const { error } = await supabase.from("modelo_tecidos").update({ numero }).eq("id", match.id);
        if (error) throw error;
      }
    } else {
      const { error } = await supabase.from("modelo_tecidos").insert({
        modelo_id: modeloId, tipo: "tecido", numero, artigo_id: artigoId,
        consumo: 0, loss_percent: 0, custo_previsto: 0,
      });
      if (error) throw error;
    }
  }

  // Remove só os tecidos cujo artigo NÃO está mais planejado (aí sim apaga as
  // variantes deles).
  const toDelete = rows.filter((r) => !usedIds.has(r.id));
  if (toDelete.length > 0) {
    const ids = toDelete.map((r) => r.id);
    await supabase.from("modelo_tecido_variantes").delete().in("modelo_tecido_id", ids);
    await supabase.from("modelo_tecidos").delete().in("id", ids);
  }
}


type Opt = { id: string; nome: string };
type Modelo = {
  id: string;
  nome: string | null;
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

// `color` = badge tonalizado (bg claro + texto escuro; passa WCAG AA, ao contrário do
// -500 + branco de antes ~2:1) p/ onde o status aparece como badge (ex.: diálogo/detalhe).
// `border` = faixa esquerda do card no Planejamento: o status vira a BORDA do card (não
// ocupa linha de texto). Cor-só p/ scan; o label vai no `title`/tooltip do card.
// `color` = badge tonalizado (usado no diálogo/detalhe; passa WCAG AA). `border` = faixa
// esquerda do card no Planejamento: o status vira a BORDA (não gasta linha); o label vai
// no `title`/tooltip do card (desktop). Cor da borda como sinal principal (decisão do dono).
const STATUS_OPTS = [
  { value: "em_planejamento", label: "Em Planejamento", color: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200", border: "border-l-amber-500" },
  { value: "reprovado", label: "Reprovado", color: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200", border: "border-l-red-500" },
  { value: "planejado", label: "Planejado", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200", border: "border-l-emerald-500" },
];
const statusMeta = (s: string | null) => STATUS_OPTS.find((o) => o.value === s) ?? STATUS_OPTS[0];


async function uploadFile(file: File, prefix: string) {
  const { tenantPrefix, sanitizeStorageName } = await import("@/lib/storage-tenant");
  const tenant = await tenantPrefix();
  const path = `${tenant}/${prefix}/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

const fmtDataBR = (s: string | null) => s ? s.split("-").reverse().join("/") : null;

function useOpts(table: string, key = "nome") {
  return useQuery({
    queryKey: ["opt", table, key],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select(`id, ${key}`).order(table === "meses" ? "ordem" : key);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ id: r.id, nome: r[key] })) as Opt[];
    },
  });
}

type CatOpt = { id: string; nome: string; grupo_id: string | null };

function PlanejamentoPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState("all");
  const [fEstilista, setFEstilista] = useState("all");
  const [fSemana, setFSemana] = useState("");
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");
  const [fGrupo, setFGrupo] = useState("all");
  const [fCat, setFCat] = useState("all");
  const [fSubcolecao, setFSubcolecao] = useState("all");
  const [fSub1, setFSub1] = useState("all");
  const [fRep, setFRep] = useState("all");
  const [fOrigem, setFOrigem] = useState("all");
  const [fColecao, setFColecao] = useState("all");
  const [fLancamento, setFLancamento] = useState("all"); // all | pronto | lancado
  const [openId, setOpenId] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [openBatch, setOpenBatch] = useState(false);
  const [openBulk, setOpenBulk] = useState(false);
  // Seleção múltipla SEM "modo": o checkbox fica sempre à mostra no card (pedido do dono) e a barra
  // de ações em massa aparece quando há ≥1 selecionado.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllFiltered = () => setSelected(new Set(sorted.map((m) => m.id)));
  const clearSel = () => setSelected(new Set());
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
    },
    onError: (e: any) => { setConfirmBulkDel(false); toast.error(mensagemErro(e, "Erro ao excluir os cards")); },
  });
  const setMaoObra = useMutation({
    mutationFn: async ({ id, aprovado, motivo }: { id: string; aprovado: boolean; motivo?: string | null }) => {
      // Reprovar exige motivo (validado no diálogo); aprovar limpa o motivo.
      const { error } = await supabase.from("modelos").update({
        custo_terceirizados_aprovado: aprovado,
        motivo_reprovacao_mao_obra: aprovado ? null : (motivo ?? null),
      } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["modelos-planejamento"] }); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao aprovar mão de obra")),
  });
  // Reprovar mão de obra pede motivo obrigatório num diálogo (P3).
  const [reprova, setReprova] = useState<{ id: string; nome: string | null } | null>(null);
  const [reprovaMotivo, setReprovaMotivo] = useState("");
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
  // Default: agrupa por Tecido (nível 1) > Categoria (nível 2).
  const [groupByTecido, setGroupByTecido] = useState(true);
  // Grupos recolhidos (por caminho único pai/filho). Vazio = todos expandidos.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (path: string) =>
    setCollapsedGroups((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path); else n.add(path);
      return n;
    });
  // Planejamento sempre abre com 5 colunas (não persiste a escolha entre acessos).
  const [cols, setCols] = useGridCols("planejamento", 5, true);
  const gridRef = useRef<HTMLDivElement>(null);
  const compact = useCompactCards(gridRef, cols);
  const fl = useFieldLabels();

  const { data: estilistas = [] } = useQuery({
    queryKey: ["colab-estilistas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("id, nome").eq("tipo", "estilista").order("nome");
      if (error) throw error;
      return (data ?? []) as Opt[];
    },
  });
  const { data: meses = [] } = useOpts("meses", "mes");
  const { data: anos = [] } = useOpts("anos", "ano");
  const { data: grupos = [] } = useOpts("grupos_produto");
  const { data: categorias = [] } = useQuery({
    queryKey: ["opt", "categorias_produto", "com-grupo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_produto").select("id, nome, grupo_id").order("nome");
      if (error) throw error;
      return (data ?? []) as CatOpt[];
    },
  });
  const { data: linhas = [] } = useQuery({
    queryKey: ["opt", "linhas", "com-markup"],
    queryFn: async () => {
      const { data, error } = await supabase.from("linhas").select("id, nome, markup").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; markup: number | null }[];
    },
  });
  const { data: artigos = [] } = useQuery({
    queryKey: ["artigos-planejamento"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("id, nome, unidade_medida, preco_por_metro")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; unidade_medida: string | null; preco_por_metro: number | null }[];
    },
  });

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
        .select("id, nome, estilista_id, linha_id, colecao, colecao_id, subcolecao, semana, mes_id, ano_id, categoria_principal_id, subcategoria1_id, status_planejamento, fotos_modelo, fotos_referencia, desenho_tecnico_url, croqui_url, observacoes_gerais, versao, modelo_base_id, preco_venda, origem, tecidos_planejados, lancado, custo_terceirizados_previsto, custo_terceirizados_aprovado, data_lancamento, observacoes_mao_obra, motivo_reprovacao_mao_obra")
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
  // "Repetição" = versão v2 em diante (cópia). O original (v1) é "único".
  const isRepeticao = (m: Modelo) => (m.versao ?? 1) > 1;
  const filtered = modelos.filter((m) => {
    if (search && !(m.nome ?? "").toLowerCase().includes(search.toLowerCase())) return false;
    if (fStatus !== "all" && m.status_planejamento !== fStatus) return false;
    if (fEstilista !== "all" && m.estilista_id !== fEstilista) return false;
    if (fSemana && m.semana !== fSemana) return false;
    if (fMes !== "all" && m.mes_id !== fMes) return false;
    if (fAno !== "all" && m.ano_id !== fAno) return false;
    if (fGrupo !== "all" && (m.categoria_principal_id ? catGrupoMap[m.categoria_principal_id] : null) !== fGrupo) return false;
    if (fCat !== "all" && m.categoria_principal_id !== fCat) return false;
    if (fColecao !== "all" && m.colecao !== fColecao) return false;
    if (fSubcolecao !== "all" && m.subcolecao !== fSubcolecao) return false;
    if (fSub1 !== "all" && m.subcategoria1_id !== fSub1) return false;
    if (fRep === "rep" && !isRepeticao(m)) return false;
    if (fRep === "uni" && isRepeticao(m)) return false;
    if (fOrigem !== "all" && (m.origem ?? "interno") !== fOrigem) return false;
    if (fLancamento !== "all" && lancStatusDe(m) !== fLancamento) return false;
    return true;
  });

  const estMap = Object.fromEntries(estilistas.map((e) => [e.id, e.nome]));
  const catMap = Object.fromEntries(categorias.map((c) => [c.id, c.nome]));
  const sub1Map = Object.fromEntries(sub1Opts.map((s) => [s.id, s.nome]));
  const linhaMap = Object.fromEntries(linhas.map((l) => [l.id, l.nome]));
  const artigoMap = Object.fromEntries(artigos.map((a) => [a.id, a.nome]));
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
        maoObraAprovado={((m as any).custo_terceirizados_aprovado ?? null) as boolean | null}
        dataLancamento={(m as any).data_lancamento ?? null}
        onAprovar={() => setMaoObra.mutate({ id: m.id, aprovado: true })}
        onReprovar={() => { setReprovaMotivo(""); setReprova({ id: m.id, nome: m.nome }); }}
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
    groupByTecido ? byTecido : null,
    groupByLinha ? byLinha : null,
    groupByCat ? byCat : null,
    groupBySub1 ? bySub1 : null,
    groupByRep ? byRep : null,
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

  // Render recursivo dos grupos (profundidade arbitrária). Título encolhe com a
  // profundidade; nós internos ganham barra/indentação à esquerda.
  const HEADER_CLS = ["text-lg font-semibold", "text-base font-semibold", "text-sm font-semibold text-muted-foreground"];
  const renderGroup = (g: Grupo, depth: number, path: string) => {
    const collapsed = collapsedGroups.has(path);
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
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      {/* Seleção múltipla no HEADER STICKY (portal), ao lado do nome do módulo. Ativa
          mostra Todos / contagem / Definir em massa ali mesmo. */}
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
      <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Palette className="h-7 w-7 shrink-0 text-primary mt-0.5" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold truncate">Planejamento de Produto</h1>
            <p className="text-sm text-muted-foreground">Cards de modelos em planejamento.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto max-sm:justify-end">

          <SearchToggle value={search} onChange={setSearch} placeholder="Pesquisar por nome…" />
          <AgrupamentoButton
            groups={[
              { label: "Linha", active: groupByLinha, onToggle: () => setGroupByLinha((v) => !v) },
              { label: "Categoria", active: groupByCat, onToggle: () => setGroupByCat((v) => !v) },
              { label: "Subcategoria", active: groupBySub1, onToggle: () => setGroupBySub1((v) => !v) },
              { label: "Tecido", active: groupByTecido, onToggle: () => setGroupByTecido((v) => !v) },
              { label: "Repetição", active: groupByRep, onToggle: () => setGroupByRep((v) => !v) },
            ]}
          />
          <FilterButton
            screen="planejamento"
            filters={[
              { label: "Status", value: fStatus, onChange: setFStatus, options: [{ id: "all", nome: "Todos" }, ...STATUS_OPTS.map((s) => ({ id: s.value, nome: s.label }))] },
              { label: "Lançamento", value: fLancamento, onChange: setFLancamento, options: [{ id: "all", nome: "Todos" }, { id: "pronto", nome: "Prontos para lançar" }, { id: "lancado", nome: "Lançados" }] },
              { label: fl("estilista"), value: fEstilista, onChange: setFEstilista, options: [{ id: "all", nome: "Todos" }, ...estilistas] },
              { label: "Lançamento nº", value: fSemana || "all", onChange: (v) => setFSemana(v === "all" ? "" : v), options: [{ id: "all", nome: "Todas" }, ...["1","2","3","4","5"].map((s) => ({ id: s, nome: s }))] },
              { label: "Mês de Planejamento", value: fMes, onChange: setFMes, options: [{ id: "all", nome: "Todos" }, ...meses] },
              { label: "Ano", value: fAno, onChange: setFAno, options: [{ id: "all", nome: "Todos" }, ...anos] },
              { label: "Grupo", value: fGrupo, onChange: (v) => { setFGrupo(v); setFCat("all"); }, options: [{ id: "all", nome: "Todos" }, ...grupos] },
              { label: "Categoria", value: fCat, onChange: setFCat, options: [{ id: "all", nome: "Todas" }, ...(fGrupo === "all" ? categorias : categorias.filter((c) => c.grupo_id === fGrupo))] },
              { label: "Subcategoria", value: fSub1, onChange: setFSub1, options: [{ id: "all", nome: "Todas" }, ...sub1Opts.map((s) => ({ id: s.id, nome: s.nome }))] },
              { label: fl("colecao"), value: fColecao, onChange: setFColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.map((c) => ({ id: c, nome: c }))] },
              { label: "Subcoleção", value: fSubcolecao, onChange: setFSubcolecao, options: [{ id: "all", nome: "Todas" }, ...subcolecoes.map((c) => ({ id: c, nome: c }))] },
              { label: "Origem", value: fOrigem, onChange: setFOrigem, options: [{ id: "all", nome: "Todas" }, { id: "interno", nome: "Interno" }, { id: "revenda", nome: "Revenda" }] },
              { label: "Repetição", value: fRep, onChange: setFRep, options: [{ id: "all", nome: "Todos" }, { id: "rep", nome: "Repetidos" }, { id: "uni", nome: "Únicos" }] },
            ]}
          />
          <Button className="max-sm:hidden" variant="outline" onClick={() => setOpenBatch(true)} aria-label="Novos Cards"><Layers className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Novos Cards</span></Button>
          <Button className="max-sm:hidden" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" /><span className="sm:hidden">Novo</span><span className="hidden sm:inline">Novo Modelo</span></Button>
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
        <EmptyState icon={Palette} title="Nenhum modelo encontrado" description="Crie um modelo usando o botão Novo Modelo." />
      ) : groups ? (
        <div className="space-y-8">
          {groups.map((g) => renderGroup(g, 0, g.key))}
        </div>
      ) : (
        <div className={GRID_COLS_CLASS[cols]}>{sorted.map(renderCard)}</div>
      )}
      </div>

      {(openNew || openId) && (
        <ModeloDialog
          modeloId={openId}
          estilistas={estilistas}
          linhas={linhas}
          meses={meses}
          anos={anos}
          grupos={grupos}
          categorias={categorias}
          artigos={artigos}
          onClose={() => { setOpenNew(false); setOpenId(null); }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["modelos-planejamento"] })}
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
          onSaved={() => { qc.invalidateQueries({ queryKey: ["modelos-planejamento"] }); qc.invalidateQueries({ queryKey: ["otb-orcamento"] }); }}
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
          onSaved={() => { qc.invalidateQueries({ queryKey: ["modelos-planejamento"] }); qc.invalidateQueries({ queryKey: ["otb-orcamento"] }); clearSel(); }}
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
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); bulkDel.mutate(); }} disabled={bulkDel.isPending}>
              {bulkDel.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reprovar mão de obra: motivo OBRIGATÓRIO (aparece no tooltip do card). */}
      <Dialog open={!!reprova} onOpenChange={(o) => { if (!o) setReprova(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reprovar mão de obra</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Informe o motivo da reprovação{reprova?.nome ? ` de "${reprova.nome}"` : ""}. Ele aparece ao passar o mouse no card.
            </p>
            <Textarea
              autoFocus
              rows={3}
              placeholder="Motivo da reprovação…"
              value={reprovaMotivo}
              onChange={(e) => setReprovaMotivo(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReprova(null)}>Cancelar</Button>
            <Button
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!reprovaMotivo.trim() || setMaoObra.isPending}
              onClick={() => {
                if (!reprova || !reprovaMotivo.trim()) return;
                setMaoObra.mutate(
                  { id: reprova.id, aprovado: false, motivo: reprovaMotivo.trim() },
                  { onSuccess: () => setReprova(null) },
                );
              }}
            >
              {setMaoObra.isPending ? "Reprovando…" : "Reprovar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MobileActionBar>
        <Button variant="outline" onClick={() => setOpenBatch(true)}><Layers className="h-4 w-4 mr-1" /> Novos Cards</Button>
        <Button className="ml-auto" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" /> Novo Modelo</Button>
      </MobileActionBar>
    </div>
  );
}


function ModeloCard({ modelo, estilistaNome, categoriaNome, linhaNome, custo, custoReal, markup, preco, maoObra, custoMat, maoObraAprovado, dataLancamento, onAprovar, onReprovar, onLancar, lancStatus, mesNome, anoNome, onOpen, compact }: {
  modelo: Modelo; estilistaNome: string | null; categoriaNome: string | null; linhaNome: string | null; custo: number | null; custoReal: boolean; markup: number | null; preco: number | null; maoObra: number | null; custoMat: number | null; maoObraAprovado: boolean | null; dataLancamento: string | null; onAprovar: () => void; onReprovar: () => void; onLancar: (data: string | null, send: boolean) => void; lancStatus: "lancado" | "pronto" | null; mesNome: string | null; anoNome: string | null; onOpen: () => void; compact?: boolean;
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
  // Mão de obra: 3 estados — aprovado(true)/reprovado(false)/pendente(null).
  const moTxt = maoObraAprovado === true ? "Mão de obra aprovada" : maoObraAprovado === false ? "Mão de obra reprovada" : "Mão de obra pendente";
  const obsMO = String((modelo as any).observacoes_mao_obra ?? "").trim();
  const motivoReprova = String((modelo as any).motivo_reprovacao_mao_obra ?? "").trim();
  // Tooltip que SEGUE o cursor: status + situação da mão de obra + obs + motivo (se reprovado).
  const tip = (
    <div className="space-y-1">
      <div className="font-medium">{meta.label}</div>
      <div>{moTxt}</div>
      {obsMO && <div><span className="opacity-70">Obs. MO: </span>{obsMO}</div>}
      {maoObraAprovado === false && motivoReprova && (
        <div><span className="opacity-70">Motivo da reprova: </span>{motivoReprova}</div>
      )}
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
        <span
          className={`absolute top-1.5 right-1.5 z-10 h-3 w-3 rounded-full ring-2 ring-white shadow ${maoObraAprovado === true ? "bg-emerald-500" : maoObraAprovado === false ? "bg-red-500" : "bg-amber-400"}`}
          title={moTxt}
        />
        {!url ? (
          <ImageIcon className="h-10 w-10 text-muted-foreground" />
        ) : coverIsPdf ? (
          <iframe src={`${url}#toolbar=0&navpanes=0&scrollbar=0`} title="" className="w-full h-full pointer-events-none" />
        ) : (
          <img src={url} alt={modelo.nome ?? ""} className="w-full h-full object-cover" />
        )}
      </div>
      {compact ? (
        // Compacto (mobile e desktop c/ muitas colunas): nome + preço. O STATUS é a
        // borda esquerda do card (não gasta linha). Antes o corpo sumia por completo.
        <div className="p-2 space-y-0.5">
          <h3 className="font-medium text-xs leading-tight truncate">{modelo.nome || "Sem nome"}</h3>
          <p className="text-[11px] font-medium truncate">{preco != null ? brl(preco) : "—"}</p>
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
          <p className="text-xs text-muted-foreground truncate">{[mesNome, anoNome].filter(Boolean).join(" / ") || "—"}</p>
          {/* Linha | Categoria | Markup (Markup = custo → gated) */}
          <div className="grid grid-cols-3 gap-x-3 [&>span]:truncate text-xs text-muted-foreground">
            <span>{linhaNome ?? "—"}</span><span>{categoriaNome ?? "—"}</span>
            {podeVerCustos && <span>Markup: {markup != null ? Number(markup).toLocaleString("pt-BR",{maximumFractionDigits:2}) : "—"}</span>}
          </div>
          {podeVerCustos && <p className="text-xs text-muted-foreground truncate">{custoReal ? "Custo" : "Custo prev."}: {custoMat != null ? brl(custoMat) : "—"}</p>}
          {(podeVerCustos || podeAprovarMaoObra) && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {podeVerCustos && <span className="truncate">MO{custoReal ? "" : " prev."}: {maoObra != null ? brl(maoObra) : "—"}</span>}
              {podeAprovarMaoObra && (
                <>
                  <button type="button" aria-label="Aprovar mão de obra" onClick={(e) => { e.stopPropagation(); onAprovar(); }}
                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center max-md:h-11 max-md:w-11 ${maoObraAprovado === true ? "text-emerald-600" : "text-muted-foreground/40 hover:text-emerald-600"}`}><Check className="h-3.5 w-3.5" /></button>
                  <button type="button" aria-label="Reprovar mão de obra" onClick={(e) => { e.stopPropagation(); onReprovar(); }}
                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center max-md:h-11 max-md:w-11 ${maoObraAprovado === false ? "text-red-600" : "text-muted-foreground/40 hover:text-red-600"}`}><X className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>
          )}
          {podeVerCustos && (preco != null ? <p className="text-xs font-medium truncate">{brl(preco)}</p> : <p className="text-xs text-muted-foreground truncate">Preço: —</p>)}
          {/* Lançamento: escolhe a data + botão foguete = Lançar/Cancelar (mesma RPC do detalhe).
              Foguete âmbar=pronto (clicável), verde=lançado (clica p/ cancelar), cinza=indisponível. */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground" onClick={(e) => e.stopPropagation()}>
            <span className="shrink-0">Lançamento:</span>
            <DateField value={dtLanc} onChange={(e) => setDtLanc(e.target.value)}
              className="h-5 w-[6.4rem] shrink-0 [&_input]:h-5 [&_input]:border-0 [&_input]:bg-transparent [&_input]:shadow-none [&_input]:px-0 [&_input]:pr-5 [&_input]:text-xs [&_input]:text-muted-foreground [&_input]:focus-visible:ring-0 [&>button]:w-5 [&>button]:place-items-center" />
            <button type="button" disabled={lancStatus == null}
              aria-label={lancStatus === "lancado" ? "Cancelar lançamento" : "Lançar"}
              title={lancStatus === "lancado" ? "Cancelar lançamento" : lancStatus === "pronto" ? "Lançar" : "Pronto só com CQ liberado e mão de obra aprovada"}
              onClick={(e) => { e.stopPropagation(); onLancar(dtLanc || null, lancStatus !== "lancado"); }}
              className={`shrink-0 ${lancStatus === "lancado" ? "text-emerald-600 hover:text-emerald-700" : lancStatus === "pronto" ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground/30 cursor-not-allowed"}`}>
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

/* Signed URL hook scoped to modelos bucket */
const _cache = new Map<string, { url: string; exp: number }>();
function useSignedUrlBucket(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    const key = `${BUCKET}:${path}`;
    const cached = _cache.get(key);
    const now = Date.now();
    if (cached && cached.exp > now + 60_000) { setUrl(cached.url); return; }
    supabase.storage.from(BUCKET).createSignedUrl(path, 3600).then(({ data }) => {
      if (!alive || !data?.signedUrl) return;
      _cache.set(key, { url: data.signedUrl, exp: now + 3600_000 });
      setUrl(data.signedUrl);
    });
    return () => { alive = false; };
  }, [path]);
  return url;
}


/* ============ DIALOG ============ */

type Draft = {
  nome: string;
  estilista_id: string | null;
  linha_id: string | null;
  colecao: string;
  colecao_id: string | null;
  subcolecao: string;
  semana: string;
  mes_id: string | null;
  ano_id: string | null;
  categoria_principal_id: string | null;
  subcategoria1_id: string | null;
  subcategoria2_id: string | null;
  origem: string;
  preco_venda: number | null;
  data_lancamento: string | null;
  tecidos_planejados: string[];
  status_planejamento: string;
  croqui_url: string;
  desenho_tecnico_url: string;
  fotos_modelo: string[];
  fotos_referencia: string[];
  observacoes_gerais: string;
  observacoes_mao_obra: string;
  versao: number;
  modelo_base_id: string | null;
  custo_simulado: CustoSimInput;
};
const emptyDraft = (): Draft => ({
  nome: "", estilista_id: null, linha_id: null, colecao: "", colecao_id: null, subcolecao: "", semana: "", mes_id: null, ano_id: null,
  categoria_principal_id: null,
  subcategoria1_id: null, subcategoria2_id: null, origem: "interno", preco_venda: null, data_lancamento: null,
  tecidos_planejados: [],
  status_planejamento: "em_planejamento", croqui_url: "", desenho_tecnico_url: "", fotos_modelo: [], fotos_referencia: [],
  observacoes_gerais: "",
  observacoes_mao_obra: "",
  versao: 1, modelo_base_id: null,
  custo_simulado: {},
});

type ArtigoOpt = { id: string; nome: string; unidade_medida: string | null; preco_por_metro: number | null };

type LinhaOpt = { id: string; nome: string; markup: number | null };
type SubOpt = { id: string; nome: string; categoria_id: string | null };

const numOr0 = (v: any) => Number(v ?? 0) || 0;

// Normaliza a simulação de custo p/ salvar: só valores > 0; se tudo vazio → null.
// preco_tecido_m NÃO é gravado (é derivado do Tecido Planejado mais caro); consumo_tecido
// aqui é só o OVERRIDE manual (quando nulo, a tela usa o consumo real do BOM).
function limparCustoSim(s: CustoSimInput | null | undefined): CustoSimInput | null {
  const n = (v: any) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null; };
  const out: CustoSimInput = {
    consumo_tecido: n(s?.consumo_tecido),
    aviamento: n(s?.aviamento),
    mao_obra: n(s?.mao_obra),
  };
  return Object.values(out).some((v) => v != null) ? out : null;
}

// Seção colapsável do detalhe do card — expandida por default; estado local por seção
// (não persiste). Colapsar só esconde os filhos; o draft vive no diálogo, nada se perde.
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 text-sm font-semibold text-foreground border-b pb-1.5 text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span>{titulo}</span>
      </button>
      {open && children}
    </section>
  );
}

/** Campo somente-leitura (label + valor) no mesmo estilo dos inputs do form. */
function CampoRO({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <div className="h-9 px-3 flex items-center rounded-md border bg-muted text-sm tabular-nums">{value}</div>
    </div>
  );
}

function ModeloDialog({
  modeloId, estilistas, linhas, meses, anos, grupos, categorias, artigos, onClose, onSaved,
}: {
  modeloId: string | null; estilistas: Opt[]; linhas: LinhaOpt[]; meses: Opt[]; anos: Opt[];
  grupos: Opt[]; categorias: CatOpt[];
  artigos: ArtigoOpt[];
  onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!modeloId;
  const qc = useQueryClient();
  const fl = useFieldLabels();
  const { canView } = useAuth();
  const podeVerCustos = canView("criacao_planejamento:custos");
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const { dirty, markClean, reset: resetDraftBaseline } = useDirtySnapshot(draft);
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose });
  // Grupo é transiente (não é coluna do modelo) — filtra as Categorias na cascata.
  const [grupoSel, setGrupoSel] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const { isModuleEnabled } = useTenantModules();
  const otbOn = isModuleEnabled("otb");
  const orc = useOrcamento();
  const { data: colecoes = [] } = useQuery({
    queryKey: ["otb-colecoes-opts"],
    enabled: otbOn,
    queryFn: async () => {
      const { data } = await supabase.from("colecoes").select("id, nome, mes_id, ano_id").order("nome");
      return (data ?? []) as { id: string; nome: string; mes_id: string | null; ano_id: string | null }[];
    },
  });
  // Subcoleções da coleção escolhida — viram o dropdown de Subcoleção (OTB ligado).
  const { data: subcolecoesOpts = [] } = useQuery({
    queryKey: ["subcolecoes-opts", draft.colecao_id],
    enabled: otbOn && !!draft.colecao_id,
    queryFn: async () => {
      const { data } = await supabase.from("colecao_subcolecoes").select("nome").eq("colecao_id", draft.colecao_id!).order("ordem");
      return (data ?? []).map((r: any) => r.nome as string);
    },
  });

  // Estoque por artigo (físico/disponível) para mostrar ao selecionar o tecido.
  const { data: estoqueArr = [] } = useQuery({
    queryKey: ["estoque-tecido-por-artigo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("estoque_tecido_por_artigo" as any);
      if (error) throw error;
      return (data ?? []) as Array<{ artigo_id: string; fisico_m: number; reservado_m: number; disponivel_m: number }>;
    },
  });
  const estoqueMap = useMemo(
    () => Object.fromEntries(estoqueArr.map((e) => [e.artigo_id, e])),
    [estoqueArr],
  ) as Record<string, EstoqueArtigo>;

  // Subcategorias 1 e 2 (filhas da Categoria) — Setor "Informações Gerais".
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

  // Custo total unitário do modelo (real de Serviços senão previsto de Desenvolvimento).
  const { data: custoData } = useQuery({
    queryKey: ["plan-custo-unit", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("custo_unitario_modelos" as any, { _ids: [modeloId] });
      if (error) throw error;
      return ((data ?? {}) as any)[modeloId as string] as { previsto: number; real: number; confirmado: boolean } | undefined;
    },
  });

  // Consumo real do BOM (Desenvolvimento/CAD) por artigo — alimenta o pré-preenchimento
  // do consumo na Simulação de custo quando o modelo já avançou.
  const { data: bomTecidos = [] } = useQuery({
    queryKey: ["modelo-tecidos-consumo", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_tecidos")
        .select("artigo_id, consumo")
        .eq("modelo_id", modeloId as string)
        .eq("tipo", "tecido");
      if (error) throw error;
      return (data ?? []) as { artigo_id: string | null; consumo: number | null }[];
    },
  });

  // Cálculo de preço (Setor "Preço") — mesma lógica usada na lista e nos Lançamentos.
  const custoReal = !!custoData?.confirmado;
  const { custo, markupLinha: markup, preco, sugerido: precoSug, markupReal } =
    precoInfo(custoData?.real, linhas.find((l) => l.id === draft.linha_id)?.markup, draft.preco_venda);

  // Simulação de custo (isolada do real). Tecido: preço/m = o TECIDO PLANEJADO MAIS CARO
  // (auto do cadastro); consumo = override do usuário, senão o consumo REAL do BOM (editável).
  // Aviamento e mão de obra são manuais. Custo estimado × markup da linha → preço estimado.
  const tecidoMaisCaro = draft.tecidos_planejados
    .map((id) => artigos.find((a) => a.id === id))
    .filter((a): a is ArtigoOpt => !!a)
    .reduce<ArtigoOpt | null>((best, a) => ((Number(a.preco_por_metro) || 0) > (Number(best?.preco_por_metro) || 0) ? a : best), null);
  const precoTecidoM = Number(tecidoMaisCaro?.preco_por_metro) || 0;
  const consumoRealBOM = tecidoMaisCaro
    ? Number(bomTecidos.find((t) => t.artigo_id === tecidoMaisCaro.id)?.consumo) || 0
    : 0;
  const consumoOverride = draft.custo_simulado.consumo_tecido ?? null;
  const consumoUsado = consumoOverride ?? consumoRealBOM;
  // Mão de obra: espelha o padrão do consumo — usa a "Previsão de Mão de Obra" do
  // Desenvolvimento (custo_terceirizados_previsto, via custo_unitario_modelos) como
  // DEFAULT editável (override). Reflete na edição o mesmo valor mostrado no card.
  const maoObraDev = Number((custoData as any)?.mao_obra_previsto) || 0;
  const maoObraOverride = draft.custo_simulado.mao_obra ?? null;
  const maoObraUsado = maoObraOverride ?? (maoObraDev > 0 ? maoObraDev : null);
  const simCalc = custoSimulado({
    consumo_tecido: consumoUsado,
    preco_tecido_m: precoTecidoM,
    aviamento: draft.custo_simulado.aviamento,
    mao_obra: maoObraUsado,
  });
  const piSim = precoInfo(simCalc.total, markup, null);
  const setSim = (patch: Partial<CustoSimInput>) =>
    setDraft((d) => ({ ...d, custo_simulado: { ...d.custo_simulado, ...patch } }));

  // Preço para venda é PLACEHOLDER (mostra o sugerido); só vira valor real se o usuário
  // digitar. Não auto-preenche o draft (isso causava o flip-flop preenchido↔placeholder).
  // O preço efetivo já cai no sugerido via precoInfo quando o campo está vazio.

  // "Ordem de Criação enviada" = gate p/ o Desenvolvimento (botão, não mais o status).
  const [enviada, setEnviada] = useState(false);
  // "Lançado" = gate p/ Lançamentos (botão, após CAD + CQ confirmado).
  const [lancado, setLancado] = useState(false);

  // CAD + status do CQ do modelo — habilita a Data de Lançamento / botão Lançar.
  const { data: cqInfo } = useQuery({
    queryKey: ["plan-cq", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cad")
        .select("id, controle_qualidade(status, status_pos), producao_terceirizados(ativo, categorias_terceirizado(etapa))")
        .eq("modelo_id", modeloId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  // Lançar exige Pré confirmado E (se há serviço pós-costura) Pós confirmado — mesmo
  // gate do Direcionamento (predicado único em @/lib/cq-status).
  const cqConfirmado = cqLiberado(cqInfo as any);

  // Aprovação da MÃO DE OBRA (feita no card do Planejamento): flag por modelo.
  // 3 estados; lançar exige aprovado(true). pendente(null)/reprovado(false) = bloqueia.
  const { data: maoObraAprov } = useQuery({
    queryKey: ["plan-mao-obra-aprov", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("modelos") as any).select("custo_terceirizados_aprovado").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      return (data?.custo_terceirizados_aprovado ?? null) as boolean | null;
    },
  });
  const maoObraPendente = maoObraAprov !== true;

  useQuery({
    queryKey: ["modelo", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      if (!modeloId) return null;
      const { data, error } = await supabase.from("modelos").select("*").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      if (data) {
        const seeded: Draft = {
          nome: data.nome ?? "",
          estilista_id: data.estilista_id,
          linha_id: (data as any).linha_id ?? null,
          colecao: data.colecao ?? "",
          colecao_id: (data as any).colecao_id ?? null,
          subcolecao: (data as any).subcolecao ?? "",
          semana: data.semana ?? "",
          mes_id: data.mes_id,
          ano_id: data.ano_id,
          categoria_principal_id: data.categoria_principal_id,
          subcategoria1_id: (data as any).subcategoria1_id ?? null,
          subcategoria2_id: (data as any).subcategoria2_id ?? null,
          origem: (data as any).origem ?? "interno",
          preco_venda: (data as any).preco_venda ?? null,
          data_lancamento: (data as any).data_lancamento ?? null,
          tecidos_planejados: (data as any).tecidos_planejados ?? [],
          status_planejamento: data.status_planejamento ?? "em_planejamento",
          croqui_url: (data as any).croqui_url ?? "",
          desenho_tecnico_url: (data as any).desenho_tecnico_url ?? "",
          fotos_modelo: data.fotos_modelo ?? [],
          fotos_referencia: data.fotos_referencia ?? [],
          observacoes_gerais: data.observacoes_gerais ?? "",
          observacoes_mao_obra: (data as any).observacoes_mao_obra ?? "",
          versao: (data as any).versao ?? 1,
          modelo_base_id: (data as any).modelo_base_id ?? null,
          custo_simulado: ((data as any).custo_simulado ?? {}) as CustoSimInput,
        };
        setDraft(seeded);
        resetDraftBaseline(seeded);
        // Pré-seleciona o Grupo da categoria carregada (deriva de categorias_produto.grupo_id).
        setGrupoSel(categorias.find((c) => c.id === data.categoria_principal_id)?.grupo_id ?? null);
        setEnviada(!!(data as any).ordem_criacao_enviada);
        setLancado(!!(data as any).lancado);
      }
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, key }: { file: File; key: "fotos_modelo" | "fotos_referencia" }) => {
      const path = await uploadFile(file, key);
      return { path, key };
    },
    onSuccess: ({ path, key }) => setDraft((d) => ({ ...d, [key]: [...d[key], path] })),
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const uploadDesenho = useMutation({
    mutationFn: async (file: File) => uploadFile(file, "desenho_tecnico"),
    onSuccess: (path) => setDraft((d) => ({ ...d, desenho_tecnico_url: path })),
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const uploadCroqui = useMutation({
    mutationFn: async (file: File) => uploadFile(file, "croqui"),
    onSuccess: (path) => setDraft((d) => ({ ...d, croqui_url: path })),
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload: any = {
        ...draft,
        croqui_url: draft.croqui_url || null,
        desenho_tecnico_url: draft.desenho_tecnico_url || null,
        preco_venda: numOr0(draft.preco_venda) > 0 ? numOr0(draft.preco_venda) : null,
        data_lancamento: draft.data_lancamento || null,
        observacoes_mao_obra: draft.observacoes_mao_obra || null,
        custo_simulado: limparCustoSim(draft.custo_simulado),
      };
      if (isEdit && modeloId) {
        const { error } = await supabase.from("modelos").update(payload).eq("id", modeloId);
        if (error) throw error;
        await syncTecidosToDesenvolvimento(modeloId, draft.tecidos_planejados);
      } else {
        const { data: inserted, error } = await supabase.from("modelos").insert(payload).select("id").single();
        if (error) throw error;
        if (inserted?.id) await syncTecidosToDesenvolvimento(inserted.id, draft.tecidos_planejados);
      }
    },
    onSuccess: () => {
      toast.success("Modelo salvo");
      markClean();
      qc.invalidateQueries({ queryKey: ["modelo"] });
      qc.invalidateQueries({ queryKey: ["modelo-tecidos"] });
      qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro")),
  });

  // Enviar/Cancelar Ordem de Criação: gate explícito pro Desenvolvimento (independe do Salvar).
  const enviar = useMutation({
    mutationFn: async (send: boolean) => {
      if (!modeloId) throw new Error("Salve o modelo primeiro.");
      const payload = send
        ? { ordem_criacao_enviada: true, ordem_criacao_enviada_at: new Date().toISOString(), status_planejamento: "planejado" }
        : { ordem_criacao_enviada: false, ordem_criacao_enviada_at: null };
      const { error } = await supabase.from("modelos").update(payload).eq("id", modeloId);
      if (error) throw error;
    },
    onMutate: (send: boolean) => setEnviada(send),
    onError: (e: any, send: boolean) => { setEnviada(!send); toast.error(mensagemErro(e, "Erro")); },
    onSuccess: (_d, send: boolean) => {
      toast.success(send ? "Ordem de Criação enviada" : "Envio cancelado");
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
    },
  });

  // Lançar/Cancelar: gate explícito pro Lançamentos (independe do Salvar). Persiste a
  // Data de Lançamento junto (o usuário pode não ter clicado em Salvar).
  const lancar = useMutation({
    mutationFn: async (send: boolean) => {
      if (!modeloId) throw new Error("Salve o modelo primeiro.");
      // Pré-checagens de UX (mensagem imediata); o SERVIDOR re-valida em lancar_modelo.
      if (send) {
        if (!cqConfirmado) throw new Error("Confirme o Controle de Qualidade antes de lançar.");
        if (maoObraPendente) throw new Error("Aprove a mão de obra antes de lançar.");
        if (!draft.data_lancamento) throw new Error("Preencha a Data de Lançamento.");
      }
      // Gate REAL no servidor (CQ liberado + valor de serviço aprovado + data). Ao lançar,
      // a RPC também limpa o #Erro de 'lancamentos' (setado quando o CQ foi desmarcado antes).
      const { error } = await supabase.rpc("lancar_modelo" as any, {
        _modelo_id: modeloId,
        _data_lancamento: send ? draft.data_lancamento : null,
        _send: send,
      });
      if (error) throw error;
    },
    onMutate: (send: boolean) => setLancado(send),
    onError: (e: any, send: boolean) => { setLancado(!send); toast.error(mensagemErro(e, "Erro")); },
    onSuccess: (_d, send: boolean) => {
      toast.success(send ? "Modelo lançado" : "Lançamento cancelado");
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["lancamentos-cards"] });
      qc.invalidateQueries({ queryKey: ["sidebar-badges"] });
    },
  });

  const duplicate = useMutation({
    mutationFn: async () => {
      if (!modeloId) return;
      // Raiz da família de versões: o original (cópias apontam para ele via modelo_base_id).
      const root = draft.modelo_base_id ?? modeloId;
      // Próxima versão = maior versão existente na família + 1.
      const { data: fam, error: eFam } = await supabase
        .from("modelos")
        .select("versao")
        .or(`id.eq.${root},modelo_base_id.eq.${root}`);
      if (eFam) throw eFam;
      const maxV = (fam ?? []).reduce((m, r: any) => Math.max(m, r.versao ?? 1), 1);
      // A cópia mantém o nome do original; a versão é que diferencia.
      const { versao: _v, modelo_base_id: _b, ...rest } = draft;
      const payload: any = {
        ...rest,
        status_planejamento: "em_planejamento",
        data_lancamento: null, // a cópia (nova versão) não nasce lançada (lancado default false)
        versao: maxV + 1,
        modelo_base_id: root,
      };
      const { error } = await supabase.from("modelos").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Card duplicado"); qc.invalidateQueries({ queryKey: ["otb-orcamento"] }); onSaved(); onClose(); },
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!modeloId) return;
      const { error } = await supabase.from("modelos").delete().eq("id", modeloId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Modelo excluído"); qc.invalidateQueries({ queryKey: ["otb-orcamento"] }); onSaved(); onClose(); },
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  // Condições que faltam p/ Enviar a Ordem de Criação (mostradas no tooltip do botão).
  const enviarBloqueios: string[] = [];
  if (draft.status_planejamento !== "planejado") enviarBloqueios.push('Defina o Status como "Planejado".');

  // O que falta p/ poder Lançar (mesmo gate da mutation `lancar`) — alimenta o tooltip
  // do botão desabilitado no setor Lançamento.
  const lancarBloqueios: string[] = [];
  if (!cqConfirmado) lancarBloqueios.push("Confirme o Controle de Qualidade (Pré e, se houver acabamento, o Pós).");
  if (maoObraPendente) lancarBloqueios.push("Aprove a mão de obra (no card do Planejamento).");
  if (!draft.data_lancamento) lancarBloqueios.push("Preencha a Data de Lançamento.");

  // Conteúdo interno idêntico p/ os dois containers (header / corpo rolável / rodapé
  // sticky / diálogos / guarda). EDITAR abre num Sheet lateral (side=right, ~70vw);
  // NOVO num Dialog central. O container é escolhido por `isEdit` logo abaixo.
  const conteudo = (
    <>
        <div className="shrink-0 px-6 pt-4 pb-0">
          <Breadcrumb items={[{ label: "Estilo & Engenharia" }, { label: "Planejamento de Produto" }, { label: draft.nome || "Novo modelo" }]} />
        </div>
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2 text-left">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span>{isEdit ? draft.nome || "Modelo" : "Novo Modelo"}</span>
            {draft.versao > 1 && <VersaoBadge versao={draft.versao} />}
            <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-6">
          {/* SETOR 1 — Informações Gerais do Produto */}
          <Secao titulo="Informações Gerais do Produto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="grid gap-1">
                <Label>Status</Label>
                <Select value={draft.status_planejamento} onValueChange={(v) => setDraft((d) => ({ ...d, status_planejamento: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <FieldText label="Nome do Modelo" value={draft.nome} onChange={(v) => setDraft((d) => ({ ...d, nome: v }))} />
              <FieldSelect label={fl("estilista")} value={draft.estilista_id} onChange={(v) => setDraft((d) => ({ ...d, estilista_id: v }))} options={estilistas} />
              <div className="grid gap-1">
                <Label>Origem</Label>
                <Select value={draft.origem} onValueChange={(v) => setDraft((d) => ({ ...d, origem: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="interno">Interno</SelectItem>
                    <SelectItem value="revenda">Revenda</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <FieldSelect
                label="Grupo"
                value={grupoSel}
                onChange={(v) => {
                  setGrupoSel(v);
                  // Se a categoria atual não pertence ao novo grupo, limpa categoria + subs.
                  const cat = categorias.find((c) => c.id === draft.categoria_principal_id);
                  if (cat && cat.grupo_id !== v) setDraft((d) => ({ ...d, categoria_principal_id: null, subcategoria1_id: null, subcategoria2_id: null }));
                }}
                options={grupos}
              />
              <FieldSelect
                label="Categoria"
                value={draft.categoria_principal_id}
                onChange={(v) => {
                  // Mantém o Grupo coerente e reseta as subcategorias (pertencem à categoria).
                  const cat = categorias.find((c) => c.id === v);
                  if (cat?.grupo_id) setGrupoSel(cat.grupo_id);
                  setDraft((d) => ({ ...d, categoria_principal_id: v, subcategoria1_id: null, subcategoria2_id: null }));
                }}
                options={grupoSel ? categorias.filter((c) => c.grupo_id === grupoSel) : categorias}
              />
              <FieldSelect
                label="Subcategoria 1"
                value={draft.subcategoria1_id}
                onChange={(v) => setDraft((d) => ({ ...d, subcategoria1_id: v }))}
                options={sub1Opts.filter((s) => s.categoria_id === draft.categoria_principal_id)}
              />
              <FieldSelect
                label="Subcategoria 2"
                value={draft.subcategoria2_id}
                onChange={(v) => setDraft((d) => ({ ...d, subcategoria2_id: v }))}
                options={sub2Opts.filter((s) => s.categoria_id === draft.categoria_principal_id)}
              />
            </div>
          </Secao>

          {/* SETOR 2 — Coleção */}
          <Secao titulo="Coleção">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {otbOn ? (
                <FieldSelect
                  label={fl("colecao")}
                  value={draft.colecao_id ?? null}
                  onChange={(v) => {
                    const col = colecoes.find((c) => c.id === v);
                    setDraft((d) => ({ ...d, colecao_id: v, colecao: col?.nome ?? d.colecao,
                      mes_id: d.mes_id ?? col?.mes_id ?? null, ano_id: d.ano_id ?? col?.ano_id ?? null }));
                  }}
                  options={colecoes.map((c) => ({ id: c.id, nome: orcLabel(c.nome, orc.colecao(c.id)) }))}
                />
              ) : (
                <FieldText label={fl("colecao")} value={draft.colecao} onChange={(v) => setDraft((d) => ({ ...d, colecao: v }))} />
              )}
              {otbOn ? (
                <FieldSelect
                  label="Subcoleção"
                  value={draft.subcolecao || null}
                  onChange={(v) => setDraft((d) => ({ ...d, subcolecao: v }))}
                  options={Array.from(new Set([...subcolecoesOpts, ...(draft.subcolecao ? [draft.subcolecao] : [])])).map((s) => ({ id: s, nome: orcLabel(s, orc.subcolecao(draft.colecao_id, s)) }))}
                />
              ) : (
                <FieldText label="Subcoleção" value={draft.subcolecao ?? ""} onChange={(v) => setDraft((d) => ({ ...d, subcolecao: v }))} />
              )}
              <FieldSelect label={fl("linha")} value={draft.linha_id} onChange={(v) => setDraft((d) => ({ ...d, linha_id: v }))} options={linhas.map((l) => ({ id: l.id, nome: orcLabel(l.nome, orc.nivel3(draft.colecao_id, draft.subcolecao, l.id)) }))} />
              <div className="grid gap-1">
                <Label>Lançamento</Label>
                <Select value={draft.semana || ""} onValueChange={(v) => setDraft((d) => ({ ...d, semana: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {["1","2","3","4","5"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <FieldSelect label="Mês de Planejamento" value={draft.mes_id} onChange={(v) => setDraft((d) => ({ ...d, mes_id: v }))} options={meses} />
              <FieldSelect label="Ano" value={draft.ano_id} onChange={(v) => setDraft((d) => ({ ...d, ano_id: v }))} options={anos} />
              {/* Data de Lançamento: vem do OTB (por subcoleção) e é editável aqui — sempre
                  visível (a ação "Lançar" fica no setor Lançamento, liberada após o CQ). */}
              <div className="grid gap-1">
                <Label>Data de Lançamento</Label>
                <DateField
                  value={draft.data_lancamento ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, data_lancamento: e.target.value || null }))}
                />
              </div>
            </div>
          </Secao>

          {/* SETOR 3 — Preço (só na edição; na criação o custo vem do BOM depois) */}
          {isEdit && (
          <Secao titulo="Preço">
            <div className="grid sm:grid-cols-2 gap-3">
              <CampoRO label={custoReal ? "Custo (real)" : "Custo (previsto)"} value={custo > 0 ? brl(custo) : "—"} />
              <CampoRO label="Markup" value={markup > 0 ? markup.toLocaleString("pt-BR") : "—"} />
              <CampoRO label="Preço" value={preco > 0 ? brl(preco) : "—"} />
              <CampoRO label="Preço sugerido" value={precoSug > 0 ? brl(precoSug) : "—"} />
              <div className="grid gap-1">
                <Label>Preço para venda</Label>
                <NumberInput
                  value={draft.preco_venda && draft.preco_venda > 0 ? draft.preco_venda : ""}
                  placeholder={precoSug > 0 ? brl(precoSug) : undefined}
                  onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, preco_venda: numOr0(v) > 0 ? Number(v) : null })); }}
                />
              </div>
              <CampoRO label="Markup real" value={markupReal > 0 ? markupReal.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"} />
            </div>
          </Secao>
          )}

          {/* SETOR 4 — Tecido Planejado */}
          <Secao titulo="Tecido Planejado">
            <MultiArtigosField
              label=""
              value={draft.tecidos_planejados}
              onChange={(v) => setDraft((d) => ({ ...d, tecidos_planejados: v }))}
              artigos={artigos}
              estoque={estoqueMap}
            />
          </Secao>

          {/* SETOR — Simulação de custo (após Tecido Planejado; isolada do custo/preço real do BOM/CAD) */}
          <Secao titulo="Simulação de custo">
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Estimativa — <strong>não</strong> é o custo nem o preço real (esses vêm do BOM/CAD).</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="grid gap-1">
                <Label>Consumo de tecido (m)</Label>
                <NumberInput
                  value={consumoOverride ?? (consumoRealBOM > 0 ? consumoRealBOM : "")}
                  onChange={(e) => { const v = e.target.value; setSim({ consumo_tecido: numOr0(v) > 0 ? Number(v) : null }); }}
                />
              </div>
              <div className="grid gap-1">
                <Label>Preço do tecido (R$/m)</Label>
                <div className="h-9 px-3 flex items-center rounded-md border bg-muted text-sm tabular-nums">
                  {precoTecidoM > 0 ? brl(precoTecidoM) : "—"}
                </div>
              </div>
              <div className="grid gap-1">
                <Label>Aviamento &amp; Insumo (R$)</Label>
                <NumberInput
                  value={draft.custo_simulado.aviamento ?? ""}
                  onChange={(e) => { const v = e.target.value; setSim({ aviamento: numOr0(v) > 0 ? Number(v) : null }); }}
                />
              </div>
              <div className="grid gap-1">
                <Label>Mão de obra (R$)</Label>
                <NumberInput
                  value={maoObraOverride ?? (maoObraDev > 0 ? maoObraDev : "")}
                  onChange={(e) => { const v = e.target.value; setSim({ mao_obra: numOr0(v) > 0 ? Number(v) : null }); }}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <CampoRO label="Custo do tecido" value={simCalc.tecido > 0 ? brl(simCalc.tecido) : "—"} />
              <CampoRO label="Markup da linha" value={markup > 0 ? markup.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"} />
              <CampoRO label="Custo estimado" value={simCalc.total > 0 ? brl(simCalc.total) : "—"} />
              <CampoRO label="Preço estimado" value={piSim.sugerido > 0 ? brl(piSim.sugerido) : "—"} />
            </div>
            {simCalc.total > 0 && !(markup > 0) && (
              <p className="text-xs text-muted-foreground">Defina a Linha (com markup) para ver o preço estimado.</p>
            )}
          </Secao>

          {/* Observação sobre mão de obra — entre Simulação de custo e Anexos; gated pelos
              custos (paridade com Desenvolvimento > "8. Custos"). */}
          {podeVerCustos && (
            <Secao titulo="Obs. Mão de Obra">
              <ObsMaoObraField
                value={draft.observacoes_mao_obra}
                onChange={(v) => setDraft({ ...draft, observacoes_mao_obra: v })}
              />
            </Secao>
          )}

          {/* SETOR 5 — Anexos */}
          <Secao titulo="Anexos">
            <div className="grid sm:grid-cols-2 gap-4">
              <SingleFileField
                label="Foto do Croqui"
                path={draft.croqui_url}
                onUpload={(f) => uploadCroqui.mutate(f)}
                onRemove={() => setDraft((d) => ({ ...d, croqui_url: "" }))}
              />
              <SingleFileField
                label="Desenho Técnico"
                path={draft.desenho_tecnico_url}
                onUpload={(f) => uploadDesenho.mutate(f)}
                onRemove={() => setDraft((d) => ({ ...d, desenho_tecnico_url: "" }))}
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <PhotoList label="Foto do Modelo" paths={draft.fotos_modelo}
                onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_modelo" })}
                onRemove={(i) => setDraft((d) => ({ ...d, fotos_modelo: d.fotos_modelo.filter((_, j) => j !== i) }))} />
              <PhotoList label="Foto de Referência" paths={draft.fotos_referencia}
                onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_referencia" })}
                onRemove={(i) => setDraft((d) => ({ ...d, fotos_referencia: d.fotos_referencia.filter((_, j) => j !== i) }))} />
            </div>
          </Secao>

          {/* SETOR 6 — Lançamento (gate: CAD + CQ liberado + valor de serviços aprovado) */}
          {isEdit && (
            <Secao titulo="Lançamento">
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1 flex-1 min-w-[180px]">
                  <Label>Data de Lançamento</Label>
                  {/* Editável aqui também: a data real pode não se cumprir, então o
                      usuário ajusta no próprio setor Lançamento (Salvar persiste). */}
                  <DateField
                    value={draft.data_lancamento ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, data_lancamento: e.target.value || null }))}
                  />
                </div>
                {lancado ? (
                  <Button variant="outline" onClick={() => lancar.mutate(false)} disabled={lancar.isPending}>
                    Cancelar Lançamento
                  </Button>
                ) : (
                  <TooltipProvider>
                    <Tooltip>
                      {/* Botão desabilitado não dispara title nativo — o span recebe o
                          hover e o tooltip lista o que falta para lançar. */}
                      <TooltipTrigger asChild>
                        <span className="inline-flex">
                          <Button
                            onClick={() => lancar.mutate(true)}
                            disabled={lancar.isPending || lancarBloqueios.length > 0}
                          >
                            Lançar
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {lancarBloqueios.length > 0 && (
                        <TooltipContent className="max-w-[260px]">
                          <p className="font-medium">Para lançar, falta:</p>
                          <ul className="mt-1 list-disc pl-4">
                            {lancarBloqueios.map((b) => <li key={b}>{b}</li>)}
                          </ul>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              {lancado && <p className="mt-2 text-xs text-emerald-600">✓ Lançado — aparece em Lançamentos.</p>}
            </Secao>
          )}
          {isEdit && modeloId && (
            <Secao titulo="Produto Relacionado">
              <ProdutoRelacionadoSetor modeloId={modeloId} />
            </Secao>
          )}
        </div>

        <div className="shrink-0 border-t bg-background px-4 py-3 flex flex-wrap items-center gap-2">
          {/* Voltar: ESQUERDA — ícone no mobile, texto no desktop. */}
          <Button variant="outline" onClick={requestClose} aria-label="Voltar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
            <ArrowLeft className="h-4 w-4 mr-1 max-sm:mr-0" />
            <span className="max-sm:sr-only">Voltar</span>
          </Button>
          {/* Excluir: logo ao lado do Voltar (só no modo edição). */}
          {isEdit && (
            <Button variant="destructive" onClick={() => setConfirmDel(true)} aria-label="Excluir" className="shrink-0 max-sm:aspect-square max-sm:px-0">
              <Trash2 className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">Excluir</span>
            </Button>
          )}
          {/* Grupo direito: ml-auto empurra para a direita. */}
          {isEdit && (
            <Button variant="outline" onClick={() => duplicate.mutate()} disabled={duplicate.isPending} aria-label="Duplicar" className="ml-auto shrink-0 max-sm:aspect-square max-sm:px-0">
              <Copy className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">Duplicar</span>
            </Button>
          )}
          {isEdit && (enviada ? (
            <Button variant="outline" onClick={() => enviar.mutate(false)} disabled={enviar.isPending}>
              Cancelar Envio
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                {/* Botão desabilitado não dispara title nativo — o span recebe o hover
                    e o tooltip lista o que falta para enviar. */}
                <TooltipTrigger asChild>
                  <span className={isEdit ? "" : "ml-auto"} style={{ display: "inline-flex" }}>
                    <Button
                      variant="secondary"
                      onClick={() => enviar.mutate(true)}
                      disabled={enviar.isPending || enviarBloqueios.length > 0}
                    >
                      <span className="sm:hidden">Enviar Ordem</span>
                      <span className="hidden sm:inline">Enviar Ordem de Criação</span>
                    </Button>
                  </span>
                </TooltipTrigger>
                {enviarBloqueios.length > 0 && (
                  <TooltipContent className="max-w-[260px]">
                    <p className="font-medium">Para enviar a Ordem de Criação, falta:</p>
                    <ul className="mt-1 list-disc pl-4">
                      {enviarBloqueios.map((b) => <li key={b}>{b}</li>)}
                    </ul>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          ))}
          <Button className={`shrink-0 max-sm:aspect-square max-sm:px-0${!isEdit ? " ml-auto" : ""}`} aria-label="Salvar" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save className="h-4 w-4 sm:mr-1" />
            <span className="max-sm:sr-only">Salvar</span>
          </Button>
        </div>

        <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir modelo?</AlertDialogTitle>
              <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => del.mutate()}>Excluir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas neste card." />
    </>
  );

  // Regra 3: EDITAR registro existente = Sheet lateral (side=right, ~70vw); NOVO = Dialog
  // central. Mesmo conteúdo interno nos dois; classes max-sm:* mantêm o fullscreen mobile.
  return isEdit ? (
    <Sheet open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 w-full sm:w-[70vw] sm:max-w-[70vw] max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!rounded-none max-sm:!border-0 max-sm:!overflow-hidden"
      >
        {conteudo}
      </SheetContent>
    </Sheet>
  ) : (
    <Dialog open onOpenChange={(o) => { if (!o) requestClose(); }}>
      <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-[70vw] max-h-[90vh] max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!overflow-hidden">
        {conteudo}
      </DialogContent>
    </Dialog>
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
            <ArrowLeft className="h-4 w-4 sm:hidden" />
            <span className="max-sm:sr-only">Cancelar</span>
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

type EstoqueArtigo = { fisico_m: number; reservado_m: number; disponivel_m: number };
const fmtMetros = (n: number) => `${fmtNum(n)} m`;

function MultiArtigosField({ label, value, onChange, artigos, estoque }: {
  label: string; value: string[]; onChange: (v: string[]) => void; artigos: ArtigoOpt[];
  estoque: Record<string, EstoqueArtigo>;
}) {
  const available = artigos.filter((a) => !value.includes(a.id));
  const byId = Object.fromEntries(artigos.map((a) => [a.id, a]));
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1 mb-1">
        {value.length === 0 && <span className="text-xs text-muted-foreground">Nenhum tecido selecionado</span>}
        {value.map((id) => {
          const a = byId[id];
          const e = estoque[id];
          return (
            <Badge key={id} variant="secondary" className="gap-1">
              {a ? (a.unidade_medida ? `${a.nome} [${a.unidade_medida}]` : a.nome) : id}
              {a?.preco_por_metro != null && (
                <span className="text-[10px] opacity-70">· {brl(a.preco_por_metro)}/m</span>
              )}
              {e && (
                <span className={`text-[10px] ${e.disponivel_m <= 0 ? "text-destructive font-medium" : "opacity-70"}`}>
                  · disp. {fmtMetros(e.disponivel_m)}
                </span>
              )}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== id))}
                className="ml-1 hover:text-destructive"
                aria-label="Remover"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}
      </div>
      {available.length > 0 && (
        <Select value="" onValueChange={(v) => v && onChange([...value, v])}>
          <SelectTrigger><SelectValue placeholder="Adicionar tecido…" /></SelectTrigger>
          <SelectContent>
            {available.map((a) => {
              const e = estoque[a.id];
              return (
                <SelectItem key={a.id} value={a.id}>
                  <span className="flex flex-col">
                    <span>{a.unidade_medida ? `${a.nome} [${a.unidade_medida}]` : a.nome}</span>
                    <span className="text-xs text-muted-foreground">Preço/m: {a.preco_por_metro != null ? brl(a.preco_por_metro) : "—"}</span>
                    {e && (
                      <span className={`text-xs ${e.disponivel_m <= 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        Estoque: {fmtMetros(e.fisico_m)} · disp.: {fmtMetros(e.disponivel_m)}
                      </span>
                    )}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}


function FieldText({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function FieldSelect({ label, value, onChange, options }: {
  label: string; value: string | null; onChange: (v: string) => void; options: Opt[];
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
function PhotoList({ label, paths, onAdd, onRemove }: {
  label: string; paths: string[]; onAdd: (f: File) => void; onRemove: (i: number) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {paths.map((p, i) => (
          <FileThumb key={i} path={p} onRemove={() => onRemove(i)} />
        ))}
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
          <Upload className="h-4 w-4" /> Adicionar
          <input type="file" accept="image/*,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && onAdd(e.target.files[0])} />
        </label>
      </div>
    </div>
  );
}
/* Miniatura de anexo (imagem OU PDF) com preview + zoom ao clicar (abre grande). */
function FileThumb({ path, onRemove }: { path: string; onRemove?: () => void }) {
  const isPdf = /\.pdf$/i.test(path);
  const url = useSignedUrlBucket(path);
  const [zoom, setZoom] = useState(false);
  return (
    <div className="relative h-20 w-20 rounded border overflow-hidden bg-muted group">
      <div
        role="button"
        tabIndex={0}
        onClick={() => url && setZoom(true)}
        onKeyDown={(e) => { if (url && (e.key === "Enter" || e.key === " ")) setZoom(true); }}
        className="h-full w-full cursor-zoom-in flex items-center justify-center"
        title="Abrir"
      >
        {!url ? (
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        ) : isPdf ? (
          <iframe src={`${url}#toolbar=0&navpanes=0&scrollbar=0`} title="PDF" className="h-full w-full pointer-events-none" />
        ) : (
          <img src={url} className="h-full w-full object-cover" alt="" />
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-0.5 right-0.5 bg-background/80 rounded p-0.5 opacity-0 group-hover:opacity-100 z-10"
          aria-label="Remover"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-w-5xl p-1 border-none bg-transparent shadow-none [&>button]:!text-white [&>button]:top-2 [&>button]:right-2">
          {isPdf ? (
            <iframe src={url ?? ""} title="PDF" className="w-full h-[85vh] rounded-md bg-white" />
          ) : (
            <img src={url ?? ""} alt="" className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* Anexo único (imagem ou PDF) com preview + zoom — Croqui / Desenho Técnico. */
function SingleFileField({ label, path, onUpload, onRemove }: {
  label: string; path: string; onUpload: (f: File) => void; onRemove: () => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {path && <FileThumb path={path} onRemove={onRemove} />}
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
          <Upload className="h-4 w-4" /> {path ? "Trocar arquivo" : "Enviar arquivo"}
          <input
            type="file"
            accept="image/*,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
        </label>
      </div>
    </div>
  );
}
