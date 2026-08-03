import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { labelVarianteRow } from "@/lib/variante";
import { somaCustosAdicionais } from "@/lib/custo";
import { Loader2, Pencil, Printer, Send, ArrowLeft, Download, Check, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PrintFicha } from "@/components/producao/PrintFicha";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CadTecidosSection } from "@/components/producao/cad/CadTecidosSection";
import {
  calcCusto,
  type TecidoRow as CadTecidoRow,
  type VarianteRow as CadVarianteRow,
  type TipoTec,
} from "@/components/producao/cad/types";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STATUS_DESENV_OPTS } from "./modelo-detail/types";
import { Button } from "@/components/ui/button";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useAuth } from "@/hooks/useAuth";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { useTenantModules } from "@/hooks/useTenantModules";
import { normalizeKanbanStatuses, APROVADO_KEY } from "@/lib/kanban-status";
import { requisitosOk } from "@/lib/kanban-condicoes";

import {
  BUCKET,
  makeEmptyBlocks,
  recomputeAviamento,
  recomputeBlock,
  recomputeEtiqueta,
  type AviamentoRow,
  type EtiquetaInfo,
  type GradeRow,
  type ModeloEtiquetaRow,
  type OcAlloc,
  type Opt,
  type TecidoBlock,
} from "./modelo-detail/types";
import { ModeloInfoSection } from "./modelo-detail/ModeloInfoSection";
import { ModeloAjustesProvaSection, useProvaAbertosCount } from "./modelo-detail/ModeloAjustesProvaSection";
import { ModeloTecidosSection } from "./modelo-detail/ModeloTecidosSection";
import { ModeloAviamentosSection } from "./modelo-detail/ModeloAviamentosSection";
import { ModeloEtiquetasSection } from "./modelo-detail/ModeloEtiquetasSection";
import { ModeloGradeSection } from "./modelo-detail/ModeloGradeSection";
import { ModeloCustosSection } from "./modelo-detail/ModeloCustosSection";
import { ObsMaoObraField } from "@/components/shared/ObsMaoObraField";
import { Card } from "@/components/ui/card";
import { ModeloAnexosSection } from "./modelo-detail/ModeloAnexosSection";
import { useEtapasAfetadas, STAGE_LABEL } from "./DownstreamImpactAlert";
import { ModeloObservacoes } from "@/components/shared/ModeloObservacoes";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { ImportarDadosDialog } from "./importar/ImportarDadosDialog";
import type { PatchCopia, ResultadoCopia, ModeloParaCopia, Selecao } from "./importar/importar-copia";

// Serializa o snapshot do guarda de "não salvo" IGNORANDO chaves `id` (ids de LINHA voláteis).
// `salvar_modelo_bom` faz DELETE+re-INSERT de modelo_tecidos/aviamentos → gera UUIDs NOVOS a
// cada save; ao refetchar, blocks/aviamentosState re-hidratam com ids novos e o guarda acusava
// FALSO "alterações não salvas" (só visível quando não travado = modelo não enviado à Explosão).
// As FKs (artigo_id, variante_tecido_id, …) e o conteúdo — o que é edição real — permanecem.
const snapshotSemIds = (v: unknown): string => {
  try { return JSON.stringify(v ?? null, (k, val) => (k === "id" ? undefined : val)); }
  catch { return String(v); }
};

export function ModeloDetailPanel({ modeloId, onClose }: {
  modeloId: string | null;
  onClose: () => void;
}) {
  const open = !!modeloId;
  // Guarda de "alterações não salvas": o PanelContent reporta se o rascunho/BOM tem
  // edições pendentes; fechar (X/ESC/fora/Fechar) com pendências pede confirmação.
  const [dirty, setDirty] = useState(false);
  const close = () => { setDirty(false); onClose(); };
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose: close });
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) requestClose(); }}>
      <SheetContent className="w-full sm:w-[70vw] sm:max-w-[70vw] flex flex-col max-sm:[&>button]:hidden">
        {modeloId && <PanelContent modeloId={modeloId} onClose={requestClose} onDirtyChange={setDirty} />}
        <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas neste modelo." />
      </SheetContent>
    </Sheet>
  );
}

// Selo de completude no cabeçalho de cada seção do accordion (laudo das 3 lentes: cada
// seção mostra de relance se está preenchida). ml-auto encosta na direita, antes do chevron.
function SecBadge({ tone, children }: { tone: "ok" | "info" | "warn" | "muted"; children: ReactNode }) {
  const cls =
    tone === "ok" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
    : tone === "info" ? "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
    : tone === "warn" ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
    : "bg-muted text-muted-foreground";
  return (
    <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

function PanelContent({ modeloId, onClose, onDirtyChange }: { modeloId: string; onClose: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const qc = useQueryClient();
  const { canView } = useAuth();
  const podeVerCustos = canView("criacao_desenvolvimento:custos");
  const fl = useFieldLabels();
  const tenantId = useActiveTenantId();
  const provaAbertos = useProvaAbertosCount(modeloId); // badge de ajustes abertos no accordion

  const { isModuleEnabled } = useTenantModules();
  const otbOn = isModuleEnabled("otb");
  const { data: colecoes = [] } = useQuery({
    queryKey: ["otb-colecoes-opts"],
    enabled: otbOn,
    queryFn: async () => {
      const { data } = await supabase.from("colecoes").select("id, nome, mes_id, ano_id").order("nome");
      return (data ?? []) as { id: string; nome: string; mes_id: string | null; ano_id: string | null }[];
    },
  });

  const linhas = useOpts("linhas");
  const categorias = useQuery({
    queryKey: ["opt", "categorias_produto", "grupo"],
    queryFn: async () => ((await supabase.from("categorias_produto").select("id, nome, grupo_id").order("nome")).data ?? []) as { id: string; nome: string; grupo_id: string | null }[],
  });
  const grupos = useOpts("grupos_produto");
  const meses = useQuery({
    queryKey: ["opt-panel", "meses"],
    queryFn: async () => (((await supabase.from("meses").select("id, mes").order("ordem")).data ?? []) as any[]).map((m) => ({ id: m.id, nome: m.mes })) as Opt[],
  });
  const anos = useQuery({
    queryKey: ["opt-panel", "anos"],
    queryFn: async () => (((await supabase.from("anos").select("id, ano").order("ano", { ascending: false })).data ?? []) as any[]).map((a) => ({ id: a.id, nome: String(a.ano) })) as Opt[],
  });
  const sub1Opts = useSubOpts("subcategorias1_produto");
  const sub2Opts = useSubOpts("subcategorias2_produto");
  const estilistas = useColabs("estilista");
  const modelistas = useColabs("modelista");
  const piloteiros = useColabs("piloteiro");

  const { data: tenantCfg } = useQuery({
    queryKey: ["tenant-config-grade", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_config").select("tamanhos_grade, status_kanban, kanban_requisitos").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Motor de regras: condições satisfeitas do modelo (estado SALVO) + requisitos por status.
  // Bloqueia mudar de status pelo Select se os requisitos não batem — só o salvo conta.
  const { data: condicoesModelo = {} } = useQuery({
    queryKey: ["modelo-condicoes-kanban", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("avaliar_condicoes_kanban" as any, { _ids: [modeloId] });
      if (error) throw error;
      return (((data ?? {}) as any)[modeloId] ?? {}) as Record<string, boolean>;
    },
  });
  const podeEntrarStatus = (statusKey: string) =>
    requisitosOk(((tenantCfg as any)?.kanban_requisitos ?? {})[statusKey], condicoesModelo as Record<string, boolean>);
  // status_kanban resolvido para chave SNAKE canônica (bate com status_desenvolvimento).
  const statusOptions = useMemo(
    () => normalizeKanbanStatuses((tenantCfg as any)?.status_kanban).map((s) => ({ value: s.key, label: s.label })),
    [tenantCfg],
  );
  const tamanhos: string[] = useMemo(() => {
    const raw = (tenantCfg as any)?.tamanhos_grade;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((x: any) => typeof x === "string" ? x : (x?.nome ?? x?.label ?? String(x)));
    }
    return ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
  }, [tenantCfg]);

  const { data: artigos = [] } = useQuery({
    queryKey: ["artigos-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos").select("id, nome, preco, preco_por_metro, unidade_medida, categoria_tecido_id, largura_estimada").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; preco: number | null; preco_por_metro: number | null; unidade_medida: string | null; categoria_tecido_id: string | null; largura_estimada: number | null }[];
    },
  });
  const artigoMap = useMemo(() => Object.fromEntries(artigos.map((a) => [a.id, a])), [artigos]);

  const { data: categoriasTecido = [] } = useQuery({
    queryKey: ["cat-tecido-options"],
    // sem staleTime: o cadastro de categorias não invalida esta chave (fresh-on-mount).
    queryFn: async () => {
      const { data, error } = await supabase.from("categorias_tecido").select("id, nome").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  const { data: artigoCatLinks = [] } = useQuery({
    queryKey: ["artigo-cats-all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("artigo_categorias_tecido").select("artigo_id, categoria_tecido_id");
      if (error) throw error;
      return (data ?? []) as { artigo_id: string; categoria_tecido_id: string }[];
    },
  });

  const catsByArtigo = useMemo(() => {
    const m = new Map<string, Set<string>>();
    artigoCatLinks.forEach((l) => {
      const s = m.get(l.artigo_id) ?? new Set<string>();
      s.add(l.categoria_tecido_id);
      m.set(l.artigo_id, s);
    });
    return m;
  }, [artigoCatLinks]);

  const artigoTemCategoria = (artigoId: string, categoriaId: string) =>
    catsByArtigo.get(artigoId)?.has(categoriaId) || artigoMap[artigoId]?.categoria_tecido_id === categoriaId;

  const artigosPorCategoriaNome = (nome: string) => {
    const cat = categoriasTecido.find((c) => c.nome.trim().toLowerCase() === nome.toLowerCase());
    if (!cat) return [];
    return artigos.filter((a) => artigoTemCategoria(a.id, cat.id));
  };

  const artigosForro = useMemo(() => artigosPorCategoriaNome("Forro"), [artigos, categoriasTecido, catsByArtigo]);
  const artigosEntretela = useMemo(() => artigosPorCategoriaNome("Entretela"), [artigos, categoriasTecido, catsByArtigo]);

  const { data: aviamentos = [] } = useQuery({
    queryKey: ["aviamentos-all"],
    // sem staleTime: o cadastro de aviamentos invalida ["aviamentos"], não esta chave.
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aviamentos").select("id, codigo_nome, preco").order("codigo_nome");
      if (error) throw error;
      return (data ?? []) as { id: string; codigo_nome: string; preco: number | null }[];
    },
  });
  const aviamentoMap = useMemo(() => Object.fromEntries(aviamentos.map((a) => [a.id, a])), [aviamentos]);

  // Etiquetas (com variantes p/ cores + preço por cor) — p/ a seção de BOM do modelo.
  const { data: etiquetasList = [], isFetched: etiquetasListFetched } = useQuery({
    queryKey: ["etiquetas-bom"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("etiquetas" as any)
        .select("id, nome, formato_tamanho, preco, variantes_etiqueta(cor_id, preco, cor:cor_id(nome))")
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as any[]).map((e) => ({
        id: e.id, nome: e.nome, formato_tamanho: e.formato_tamanho ?? "ambos", preco: e.preco,
        variantes: (e.variantes_etiqueta ?? []).map((v: any) => ({ cor_id: v.cor_id, cor_nome: v.cor?.nome ?? null, preco: v.preco })),
      })) as EtiquetaInfo[];
    },
  });
  const etiquetaMap = useMemo(() => Object.fromEntries(etiquetasList.map((e) => [e.id, e])), [etiquetasList]);
  const etiquetaOpts = useMemo<Opt[]>(() => etiquetasList.map((e) => ({ id: e.id, nome: e.nome })), [etiquetasList]);

  const { data: modelo, isLoading: loadingModelo } = useQuery({
    queryKey: ["modelo-detail", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase.from("modelos").select("*").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: tecidosData } = useQuery({
    queryKey: ["modelo-tecidos", modeloId],
    queryFn: async () => {
      const { data: tecidos, error } = await supabase
        .from("modelo_tecidos")
        .select("id, modelo_id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto")
        .eq("modelo_id", modeloId);
      if (error) throw error;
      const ids = (tecidos ?? []).map((t: any) => t.id);
      let variantesRows: any[] = [];
      if (ids.length > 0) {
        const { data: vs, error: e2 } = await supabase
          .from("modelo_tecido_variantes")
          .select("modelo_tecido_id, variante_tecido_id, ordem, multiplicador, variantes_tecido:variante_tecido_id(artigo_id)")
          .in("modelo_tecido_id", ids);
        if (e2) throw e2;
        variantesRows = vs ?? [];
      }
      return { tecidos: tecidos ?? [], variantes: variantesRows };
    },
  });

  const { data: ocLinksData } = useQuery({
    queryKey: ["modelo-tecido-oc-links", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_tecido_oc_links" as any)
        .select("tipo, numero, ordem, oc_tecido_item_id, quantidade_m, prioridade")
        .eq("modelo_id", modeloId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Fase B — preço congelado pela OC vinculada (mapa "tipo|numero" → preço/metro). O custo
  // previsto usa esse preço em vez do preço atual do artigo quando há OC vinculada.
  const { data: frozenPrecos = {} } = useQuery({
    queryKey: ["modelo-precos-congelado", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("precos_tecido_congelado" as any, { _modelo_id: modeloId });
      if (error) throw error;
      return (data ?? {}) as Record<string, number>;
    },
  });

  const { data: aviamentosData } = useQuery({
    queryKey: ["modelo-aviamentos", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_aviamentos")
        .select("id, aviamento_id, numero, consumo, loss_percent, custo_previsto")
        .eq("modelo_id", modeloId).order("numero");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: modeloEtiquetasData } = useQuery({
    queryKey: ["modelo-etiquetas", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_etiquetas" as any)
        .select("id, etiqueta_id, cor_id, consumo, loss_percent, custo_previsto")
        .eq("modelo_id", modeloId).order("numero");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: gradesData } = useQuery({
    queryKey: ["modelo-grades", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_grades")
        .select("variante_numero, grades, grade_total")
        .eq("modelo_id", modeloId).order("variante_numero");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Seção 4. CAD — row do cad (para saber o cad_id e alimentar queries de cad_tecidos).
  const { data: cadRowDev } = useQuery({
    queryKey: ["dev-cad-row", modeloId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("cad").select("id").eq("modelo_id", modeloId).maybeSingle();
      return data as { id: string } | null;
    },
  });

  const { data: cadTecidosDev = [], isFetched: cadTecidosDevFetched } = useQuery({
    queryKey: ["dev-cad-tecidos", cadRowDev?.id],
    enabled: !!cadRowDev?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("cad_tecidos")
        .select("*, artigos:artigo_id(nome, preco_por_metro, unidade_medida, etiqueta_lavagem_urls, largura_estimada), cad_tecido_variantes(*, variantes_tecido:variante_tecido_id(nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))")
        .eq("cad_id", cadRowDev!.id);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  // Preço congelado pela OC vinculada (mesmo padrão do CadEditor).
  const { data: frozenPrecosCad = {}, isFetched: frozenPrecosCadFetched } = useQuery({
    queryKey: ["dev-cad-precos-congelado", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("precos_tecido_congelado" as any, { _modelo_id: modeloId });
      if (error) throw error;
      return (data ?? {}) as Record<string, number>;
    },
  });

  // Etiquetas disponíveis p/ montar o payload do salvar_cad_completo.
  const { data: etiquetasDisponiveisDev = [] } = useQuery({
    queryKey: ["etiquetas-opts"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("etiquetas")
        .select("id, nome, tamanho, formato_tamanho, preco, variantes_etiqueta(tamanho, cor_id, preco, cor:cor_id(nome))")
        .order("nome");
      return ((data ?? []) as any[]).map((e: any) => ({
        id: e.id as string, nome: e.nome as string, tamanho: (e.tamanho ?? null) as string | null,
        formato_tamanho: (e.formato_tamanho ?? "ambos") as string, preco: e.preco as number | null,
        variantes: ((e.variantes_etiqueta ?? []) as any[]).map((v: any) => ({
          tamanho: v.tamanho as string | null, cor_id: v.cor_id as string | null,
          cor_nome: (v.cor?.nome ?? null) as string | null, preco: v.preco as number | null,
        })),
      }));
    },
  });

  // Estado editável da seção "4. CAD": tecidos/folhas/metragem (espelha CadEditor).
  const [cadTecidosState, setCadTecidosState] = useState<CadTecidoRow[]>([]);
  const [autoFolhas, setAutoFolhas] = useState(false);
  const [cadSeeded, setCadSeeded] = useState(false);

  const [draft, setDraft] = useState<any | null>(null);
  // Só reporta "alterações não salvas" depois que o baseline foi tirado com o estado
  // JÁ NORMALIZADO (pós-seed). Enquanto false, a semeadura/normalização (rótulos de
  // variante, herança de grade, cadTecidos) muta o rascunho sem marcar dirty. Reseta ao
  // trocar de modelo (efeito do modeloId) e após salvar (setCadSeeded(false) re-semeia).
  const [guardReady, setGuardReady] = useState(false);
  // Subcoleções da coleção escolhida — dropdown de Subcoleção (OTB ligado).
  const { data: subcolecoesOpts = [] } = useQuery({
    queryKey: ["subcolecoes-opts", draft?.colecao_id],
    enabled: otbOn && !!draft?.colecao_id,
    queryFn: async () => {
      const { data } = await supabase.from("colecao_subcolecoes").select("nome").eq("colecao_id", draft.colecao_id).order("ordem");
      return (data ?? []).map((r: any) => r.nome as string);
    },
  });
  const [blocks, setBlocks] = useState<TecidoBlock[]>(makeEmptyBlocks());
  const [aviamentosState, setAviamentosState] = useState<AviamentoRow[]>([]);
  const [etiquetasState, setEtiquetasState] = useState<ModeloEtiquetaRow[]>([]);
  const [grades, setGrades] = useState<GradeRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [confirmEnviarCad, setConfirmEnviarCad] = useState(false);
  const [printTecnicaToken, setPrintTecnicaToken] = useState(0);
  // Seções abertas do accordion (controlado): o link "falta X" do rodapé abre a seção certa.
  const [accOpen, setAccOpen] = useState<string[]>(["s1"]);
  // Confirmação (AlertDialog) antes de descartar grade preenchida ao trocar/remover
  // o Tecido 1. Guarda a ação adiada até o usuário confirmar.
  const [confirmGrade, setConfirmGrade] = useState<{ msg: string; onConfirm: () => void } | null>(null);
  // Trava por SEGURANÇA após enviar ao CAD: só edita ao clicar "Editar", e o
  // Salvar volta a travar. Reseta ao abrir outro modelo.
  // Trava pós-Enviar: quando enviado à Explosão, o card fica read-only até clicar no lápis (Editar).
  const [editing, setEditing] = useState(false);
  const { etapas } = useEtapasAfetadas(modeloId);
  // Rastreio p/ o alerta inteligente (o que mudou → impacto específico).
  const [gradeAlterada, setGradeAlterada] = useState(false);
  const [consumoAlterado, setConsumoAlterado] = useState(false);
  const [aviamentoAlterado, setAviamentoAlterado] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [camposCopiados, setCamposCopiados] = useState<Set<string>>(new Set());
  const [confirmSobrescrita, setConfirmSobrescrita] = useState<{ itens: string[]; aplicar: () => void } | null>(null);
  useEffect(() => { setCadSeeded(false); setCadTecidosState([]); setAutoFolhas(false); setEditing(false); setGuardReady(false); }, [modeloId]);

  // Guarda de "alterações não salvas": snapshot do rascunho + BOM editável. O baseline é
  // re-tirado quando as queries semeiam o estado (efeito abaixo, keyed na ASSINATURA do
  // estado semeado) e no markClean() após salvar. Read-only (enviado ao CAD, sem "Editar")
  // não altera nada.
  //
  // ⚠️ NÃO usar useDirtySnapshot aqui: seu `reset()` chama `force()` (setState) a cada
  // invocação, e o efeito de re-baseline dependia de objetos de query com default `= {}`
  // (blockVariantesInfo/tecido1VariantesLabels/frozenPrecosCad) que ganham NOVA identidade a
  // cada render enquanto a query está desabilitada/`undefined` (ex.: modelo sem variantes).
  // Isso fechava um loop: reset → force → re-render → novo `{}` → efeito roda → reset → …
  // → "Maximum update depth exceeded" (ErrorBoundary "Algo deu errado"). Aqui o baseline vive
  // num ref e o re-baseline é keyed numa ASSINATURA SERIALIZADA (só muda com conteúdo real),
  // sem forçar render em cadeia.
  const guardSnapshotStr = snapshotSemIds({ draft, blocks, aviamentosState, etiquetasState, grades, cadTecidosState });
  const baselineRef = useRef<string | null>(null);
  const [baselineTick, setBaselineTick] = useState(0);
  const markClean = () => { baselineRef.current = guardSnapshotStr; setBaselineTick((n) => n + 1); };
  const changed = baselineRef.current !== null && guardSnapshotStr !== baselineRef.current;
  // Grade automática: LIGADA por padrão (o dono quer o cálculo por proporção sem ter que clicar).
  // Ao digitar uma célula/grade total, escala as demais pela proporção; desmarcar = grade manual.
  const [gradeAuto, setGradeAuto] = useState(true);

  // Tecidos planejados (Planejamento): preenchem os blocos Tecido 1/2/3 (1 por
  // artigo) e alimentam o mapa variante→artigo p/ o custo. NÃO são pool comum de
  // variantes — cada bloco tem pool estrito (artigo + substitutos do bloco).
  const tecidosPlanejados: string[] = useMemo(
    () => (Array.isArray((modelo as any)?.tecidos_planejados) ? ((modelo as any).tecidos_planejados as string[]) : []),
    [modelo],
  );

  // Mapa variante_tecido_id -> artigo_id, para os pools de cada bloco (tecido =
  // planejados; forro = principal + substitutos; entretela = principal). Cobre
  // todas as variantes selecionáveis, então o custo (maior preço entre os
  // artigos usados) recalcula sem lag ao escolher uma variante.
  const relevantArtigoIds = useMemo(() => {
    const s = new Set<string>();
    tecidosPlanejados.forEach((id) => id && s.add(id));
    artigosForro.forEach((a) => s.add(a.id));
    artigosEntretela.forEach((a) => s.add(a.id));
    blocks.forEach((b) => {
      if (b.artigo_id) s.add(b.artigo_id);
      (b.artigoIdsExtra ?? []).forEach((x) => x && s.add(x));
    });
    return Array.from(s);
  }, [tecidosPlanejados, artigosForro, artigosEntretela, blocks]);

  const { data: varianteArtigoMap = {} } = useQuery({
    queryKey: ["variante-artigo-map", relevantArtigoIds.slice().sort().join(",")],
    enabled: relevantArtigoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido").select("id, artigo_id").in("artigo_id", relevantArtigoIds);
      if (error) throw error;
      const m: Record<string, string> = {};
      (data ?? []).forEach((v: any) => { if (v.artigo_id) m[v.id] = v.artigo_id; });
      return m;
    },
  });

  useEffect(() => {
    if (modelo) {
      setDraft({
        nome: modelo.nome ?? "",
        ref: modelo.ref ?? "",
        status_desenvolvimento: modelo.status_desenvolvimento ?? statusOptions[0]?.value ?? "em_modelagem",
        motivo_cancelamento: modelo.motivo_cancelamento ?? "",
        linha_id: modelo.linha_id,
        estilista_id: (modelo as any).estilista_id ?? null,
        modelista_id: modelo.modelista_id,
        piloteiro1_id: modelo.piloteiro1_id,
        piloteiro2_id: modelo.piloteiro2_id,
        piloteiro3_id: modelo.piloteiro3_id,
        data_piloto1: modelo.data_piloto1 ?? "",
        data_piloto2: modelo.data_piloto2 ?? "",
        data_piloto3: modelo.data_piloto3 ?? "",
        data_desenho_tecnico: modelo.data_desenho_tecnico ?? "",
        data_aprovacao: modelo.data_aprovacao ?? "",
        observacoes_tecnicas: modelo.observacoes_tecnicas ?? "",
        ajustes_prova: modelo.ajustes_prova ?? "",
        observacoes_gerais: modelo.observacoes_gerais ?? "",
        observacoes_mao_obra: (modelo as any).observacoes_mao_obra ?? "",
        ficha_medida_url: modelo.ficha_medida_url ?? "",
        desenho_tecnico_url: (modelo as any).desenho_tecnico_url ?? "",
        croqui_url: (modelo as any).croqui_url ?? "",
        custo_terceirizados_previsto: Number(modelo.custo_terceirizados_previsto ?? 0),
        custos_adicionais: ((modelo as any).custos_adicionais ?? []) as { descricao: string; valor: number }[],
        proporcoes: (modelo.proporcoes ?? {}) as Record<string, number>,
        enviado_cad: !!modelo.enviado_cad,
        fotos_modelo: (modelo.fotos_modelo ?? []) as string[],
        fotos_referencia: (modelo.fotos_referencia ?? []) as string[],
        // Categoria (do Planejamento) + Subcategorias 1/2 — editáveis no Desenvolvimento.
        categoria_principal_id: modelo.categoria_principal_id ?? null,
        subcategoria1_id: (modelo as any).subcategoria1_id ?? null,
        subcategoria2_id: (modelo as any).subcategoria2_id ?? null,
        colecao_id: (modelo as any).colecao_id ?? null,
        subcolecao: (modelo as any).subcolecao ?? "",
        // Lançamento (mês/ano/semana) — o SAVE grava os 3; se não carregar aqui, `draft.x || null`
        // ZERAVA a semana/lançamento a cada save no Desenvolvimento (card saía de "classificado" no
        // OTB por perder a semana). Carrega do modelo p/ preservar quando não editado.
        mes_id: (modelo as any).mes_id ?? null,
        ano_id: (modelo as any).ano_id ?? null,
        semana: (modelo as any).semana ?? "",
      });
    }
  }, [modelo]);

  useEffect(() => {
    if (!tecidosData || !modelo) return;
    const empty = makeEmptyBlocks();
    const planejados: string[] = Array.isArray((modelo as any).tecidos_planejados)
      ? ((modelo as any).tecidos_planejados as string[])
      : [];
    const linksByKey = new Map<string, OcAlloc[]>();
    (ocLinksData ?? []).forEach((l: any) => {
      const key = `${l.tipo}-${l.numero}-${l.ordem}`;
      const arr = linksByKey.get(key) ?? [];
      arr.push({
        oc_tecido_item_id: l.oc_tecido_item_id,
        quantidade_m: Number(l.quantidade_m ?? 0),
        prioridade: Number(l.prioridade ?? 1),
      });
      linksByKey.set(key, arr);
    });
    linksByKey.forEach((arr) => arr.sort((a, b) => a.prioridade - b.prioridade));
    tecidosData.tecidos.forEach((t: any) => {
      const idx = empty.findIndex((b) => b.tipo === t.tipo && b.numero === t.numero);
      if (idx >= 0) {
        const variantes = Array(10).fill(null) as (string | null)[];
        const multiplicadores = Array(10).fill(1) as number[];
        const oc_links = Array.from({ length: 10 }, () => [] as OcAlloc[]);
        const varArtigos = new Set<string>();
        tecidosData.variantes
          .filter((v: any) => v.modelo_tecido_id === t.id)
          .forEach((v: any) => {
            const ord = (v.ordem ?? 1) - 1;
            if (ord >= 0 && ord < 10) {
              variantes[ord] = v.variante_tecido_id;
              multiplicadores[ord] = Number(v.multiplicador ?? 1) || 1;
              oc_links[ord] = linksByKey.get(`${t.tipo}-${t.numero}-${v.ordem ?? ord + 1}`) ?? [];
            }
            const aid = v.variantes_tecido?.artigo_id;
            if (aid) varArtigos.add(aid);
          });
        // Tecido/forro podem ter substitutos: reconstrói-os a partir dos artigos
        // das variantes salvas que não são o artigo principal do bloco. O pool de
        // variantes é estrito (artigo + substitutos), então TODO artigo extra de
        // uma variante salva precisa virar substituto p/ continuar visível.
        const artigoIdsExtra =
          t.tipo === "tecido" || t.tipo === "forro"
            ? Array.from(varArtigos).filter((aid) => aid && aid !== t.artigo_id)
            : [];
        empty[idx] = {
          id: t.id, tipo: t.tipo, numero: t.numero,
          artigo_id: t.artigo_id, artigoIdsExtra,
          consumo: Number(t.consumo ?? 0),
          loss_percent: Number(t.loss_percent ?? 0), custo_previsto: Number(t.custo_previsto ?? 0),
          variantes,
          multiplicadores,
          oc_links,
        };
      }
    });
    // Prefill from tecidos_planejados (planejamento) when nenhum tecido foi ainda salvo
    if (planejados.length > 0) {
      planejados.forEach((artigoId, i) => {
        const numero = i + 1;
        const idx = empty.findIndex((b) => b.tipo === "tecido" && b.numero === numero);
        if (idx >= 0 && !empty[idx].artigo_id) {
          empty[idx] = { ...empty[idx], artigo_id: artigoId };
        }
      });
    }
    setBlocks(empty);
  }, [tecidosData, modelo, ocLinksData]);

  useEffect(() => {
    if (!aviamentosData) return;
    const rows: AviamentoRow[] = aviamentosData.map((a: any) => ({
      id: a.id, aviamento_id: a.aviamento_id,
      consumo: Number(a.consumo ?? 0), loss_percent: Number(a.loss_percent ?? 0),
      custo_previsto: Number(a.custo_previsto ?? 0),
    }));
    setAviamentosState(rows);
  }, [aviamentosData]);

  useEffect(() => {
    if (!modeloEtiquetasData) return;
    setEtiquetasState(modeloEtiquetasData.map((e: any) => ({
      id: e.id, etiqueta_id: e.etiqueta_id, cor_id: e.cor_id,
      consumo: Number(e.consumo ?? 0), loss_percent: Number(e.loss_percent ?? 0),
      custo_previsto: Number(e.custo_previsto ?? 0),
    })));
  }, [modeloEtiquetasData]);

  // Quando os preços das etiquetas carregam/mudam, recalcula o custo das linhas na hora
  // (sem reabrir e sem salvar) — preserva consumo/cor já digitados. Só roda quando o
  // etiquetaMap muda (carga/refetch), não durante a digitação.
  useEffect(() => {
    if (Object.keys(etiquetaMap).length === 0) return;
    setEtiquetasState((rows) => (rows.length ? rows.map((r) => recomputeEtiqueta(r, etiquetaMap)) : rows));
  }, [etiquetaMap]);

  useEffect(() => {
    if (!gradesData) { setGrades([]); return; }
    const rows: GradeRow[] = gradesData.map((g: any) => ({
      variante_numero: g.variante_numero,
      grades: (g.grades ?? {}) as Record<string, number>,
      grade_total: g.grade_total ?? 0,
    }));
    setGrades(rows);
  }, [gradesData]);

  // --- Semeadura do estado CAD (tecidos/folhas/metragem) ---
  // Espelha o padrão do CadEditor: prioriza dados do cad_* (quando existe);
  // senão, semeia a partir do BOM do modelo_tecidos (com folhas/metragem zeradas).
  // Reset p/ re-semear quando o modelo muda (efeito do modeloId acima).
  useEffect(() => {
    if (cadSeeded) return;
    if (!frozenPrecosCadFetched) return; // espera o preço congelado
    // Quando já existe um CAD, espera as queries dele terminarem.
    const hasCad = !!cadRowDev?.id;
    if (hasCad && !cadTecidosDevFetched) return;

    const precoTec = (tipo: string, numero: number, artigoPpm: number) =>
      Number((frozenPrecosCad as Record<string, number>)[`${tipo}|${numero}`] ?? artigoPpm);

    const TIPO_ORDER: Record<string, number> = { tecido: 0, forro: 1, entretela: 2 };

    const varFromModelo = (v: any): CadVarianteRow => ({
      variante_tecido_id: v.variante_tecido_id,
      variante_nome: v.variantes_tecido?.nome_variante ?? v.variantes_tecido?.codigo_variante,
      variante_cor: v.variantes_tecido?.cor?.nome ?? null,
      variante_apelido: v.variantes_tecido?.apelido?.nome ?? null,
      multiplicador: Number(v.multiplicador ?? 1) || 1,
      ordem: v.ordem,
      quantidade_folhas: 0,
      metragem_planejada: 0,
      metragem_enviada: 0,
    });

    let initialTec: CadTecidoRow[];

    if ((cadTecidosDev as any[]).length > 0) {
      // Semeia do cad_*
      initialTec = (cadTecidosDev as any[]).map((t: any) => ({
        id: t.id,
        numero: t.numero,
        tipo: t.tipo as TipoTec,
        artigo_id: t.artigo_id,
        consumo_cad: Number(t.consumo_cad ?? 0),
        loss_percent_cad: Number(t.loss_percent_cad ?? 0),
        custo_cad: Number(t.custo_cad ?? 0),
        tamanho_folha: Number(t.tamanho_folha ?? 0),
        preco: precoTec(t.tipo, t.numero, Number(t.artigos?.preco_por_metro ?? 0)),
        largura: Number(t.artigos?.largura_estimada ?? 0),
        artigo_nome: t.artigos?.nome
          ? (t.artigos?.unidade_medida ? `${t.artigos.nome} [${t.artigos.unidade_medida}]` : t.artigos.nome)
          : null,
        etiqueta_lavagem_urls: (t.artigos?.etiqueta_lavagem_urls ?? []) as string[],
        variantes: (t.cad_tecido_variantes ?? []).map((v: any) => ({
          id: v.id,
          variante_tecido_id: v.variante_tecido_id,
          variante_nome: v.variantes_tecido?.nome_variante ?? v.variantes_tecido?.codigo_variante,
          variante_cor: v.variantes_tecido?.cor?.nome ?? null,
          variante_apelido: v.variantes_tecido?.apelido?.nome ?? null,
          multiplicador: Number(v.multiplicador ?? 1) || 1,
          ordem: v.ordem,
          quantidade_folhas: Number(v.quantidade_folhas ?? 0),
          metragem_planejada: Number(v.metragem_planejada ?? 0),
          metragem_enviada: Number(v.metragem_enviada ?? 0),
        } as CadVarianteRow)),
      }));
      // Mescla variantes/blocos novos do BOM que ainda não estão no CAD.
      const blockByKey = new Map<string, CadTecidoRow>(initialTec.map((t) => [`${t.tipo}-${t.numero}`, t]));
      if (tecidosData) {
        (tecidosData as any).tecidos?.forEach((mt: any) => {
          const existing = blockByKey.get(`${mt.tipo}-${mt.numero}`);
          const allVars = (tecidosData as any).variantes?.filter((v: any) => v.modelo_tecido_id === mt.id) ?? [];
          if (!existing) {
            const preco = precoTec(mt.tipo, mt.numero, Number(artigoMap[mt.artigo_id]?.preco_por_metro ?? 0));
            const consumo = Number(mt.consumo ?? 0);
            const loss = Number(mt.loss_percent ?? 0);
            initialTec.push({
              numero: mt.numero, tipo: mt.tipo as TipoTec, artigo_id: mt.artigo_id,
              consumo_cad: consumo, loss_percent_cad: loss, custo_cad: calcCusto(consumo, loss, preco),
              tamanho_folha: 0, preco, largura: Number(artigoMap[mt.artigo_id]?.largura_estimada ?? 0),
              artigo_nome: artigoMap[mt.artigo_id]?.nome ?? null, etiqueta_lavagem_urls: [],
              variantes: allVars.map((v: any): CadVarianteRow => ({
                variante_tecido_id: v.variante_tecido_id,
                variante_nome: null, variante_cor: null, variante_apelido: null,
                multiplicador: Number(v.multiplicador ?? 1) || 1, ordem: v.ordem,
                quantidade_folhas: 0, metragem_planejada: 0, metragem_enviada: 0,
              })),
            });
            return;
          }
          const have = new Set(existing.variantes.map((v) => v.variante_tecido_id).filter(Boolean));
          let added = false;
          allVars.forEach((v: any) => {
            if (v.variante_tecido_id && !have.has(v.variante_tecido_id)) {
              existing.variantes.push(varFromModelo(v));
              added = true;
            }
          });
          if (added) existing.variantes.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
        });
      }
    } else {
      // Semeia do BOM (modelo_tecidos) — folhas/metragem zerados.
      if (!tecidosData) return; // espera o BOM
      initialTec = (tecidosData as any).tecidos?.map((mt: any) => {
        const allVars = (tecidosData as any).variantes?.filter((v: any) => v.modelo_tecido_id === mt.id) ?? [];
        const preco = precoTec(mt.tipo, mt.numero, Number(artigoMap[mt.artigo_id]?.preco_por_metro ?? 0));
        const consumo = Number(mt.consumo ?? 0);
        const loss = Number(mt.loss_percent ?? 0);
        return {
          numero: mt.numero, tipo: mt.tipo as TipoTec, artigo_id: mt.artigo_id,
          consumo_cad: consumo, loss_percent_cad: loss, custo_cad: calcCusto(consumo, loss, preco),
          tamanho_folha: 0, preco, largura: Number(artigoMap[mt.artigo_id]?.largura_estimada ?? 0),
          artigo_nome: artigoMap[mt.artigo_id]?.nome ?? null, etiqueta_lavagem_urls: [],
          variantes: allVars.map((v: any): CadVarianteRow => ({
            variante_tecido_id: v.variante_tecido_id,
            variante_nome: null, variante_cor: null, variante_apelido: null,
            multiplicador: Number(v.multiplicador ?? 1) || 1, ordem: v.ordem,
            quantidade_folhas: 0, metragem_planejada: 0, metragem_enviada: 0,
          })),
        } as CadTecidoRow;
      }) ?? [];
    }

    initialTec.sort((a, b) =>
      (TIPO_ORDER[a.tipo] ?? 9) - (TIPO_ORDER[b.tipo] ?? 9) || (a.numero - b.numero));
    setCadTecidosState(initialTec);
    setCadSeeded(true);
  }, [cadSeeded, cadRowDev, cadTecidosDev, cadTecidosDevFetched, frozenPrecosCad, frozenPrecosCadFetched, tecidosData, artigoMap]);

  // Helpers p/ editar o estado dos tecidos CAD.
  // Ao mudar consumo_cad ou loss_percent_cad, sincroniza também o bloco correspondente
  // no BOM ("3. Tecidos"), mantendo os dois sempre iguais (mesma fonte de verdade).
  const updateCadTec = (i: number, patch: Partial<CadTecidoRow>) => {
    setCadTecidosState((prev) => {
      const next = [...prev];
      const merged = { ...next[i], ...patch };
      merged.custo_cad = calcCusto(merged.consumo_cad, merged.loss_percent_cad, merged.preco);
      next[i] = merged;
      return next;
    });
    // Propagação bidirecional: consumo/loss no CAD → BOM
    if (patch.consumo_cad !== undefined || patch.loss_percent_cad !== undefined) {
      const tec = cadTecidosState[i];
      if (tec) {
        const { tipo, numero } = tec;
        setBlocks((bs) => bs.map((b) => {
          if (b.tipo !== tipo || b.numero !== numero) return b;
          let changed = false;
          const bomPatch: Partial<TecidoBlock> = {};
          if (patch.consumo_cad !== undefined && b.consumo !== patch.consumo_cad) {
            bomPatch.consumo = patch.consumo_cad;
            changed = true;
          }
          if (patch.loss_percent_cad !== undefined && b.loss_percent !== patch.loss_percent_cad) {
            bomPatch.loss_percent = patch.loss_percent_cad;
            changed = true;
          }
          if (!changed) return b;
          return recomputeBlock({ ...b, ...bomPatch }, artigoMap, varianteArtigoMap, frozenPrecos as Record<string, number>);
        }));
        setConsumoAlterado(true);
      }
    }
  };
  const updateCadVar = (i: number, j: number, patch: Partial<CadVarianteRow>) => {
    setCadTecidosState((prev) => {
      const next = [...prev];
      const variantes = [...next[i].variantes];
      variantes[j] = { ...variantes[j], ...patch };
      next[i] = { ...next[i], variantes };
      return next;
    });
  };

  // Cálculo automático de folhas/metragem (idêntico ao do CadEditor).
  const sumProporcoesDev = useMemo(
    () => Object.values((draft?.proporcoes ?? {}) as Record<string, number>).reduce((a: number, b) => a + (Number(b) || 0), 0),
    [draft?.proporcoes],
  );
  const round2Dev = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const gradeTotalByNumeroDev = (n: number) => grades.find((g) => g.variante_numero === n)?.grade_total ?? 0;
  useEffect(() => {
    if (!autoFolhas) return;
    setCadTecidosState((prev) => {
      let changed = false;
      const next = prev.map((t) => {
        const lossFactor = 1 + (Number(t.loss_percent_cad) || 0) / 100;
        let baseMetragem = 0;
        const variantes = t.variantes.map((v) => {
          const mult = Number(v.multiplicador ?? 1) || 1;
          const pecas = gradeTotalByNumeroDev(v.ordem) * mult;
          const quantidade_folhas = sumProporcoesDev > 0 ? round2Dev(pecas / sumProporcoesDev) : 0;
          const base = pecas * (t.consumo_cad || 0);
          baseMetragem += base;
          const metragem_planejada = round2Dev(base * lossFactor);
          if (v.quantidade_folhas !== quantidade_folhas || v.metragem_planejada !== metragem_planejada) changed = true;
          return { ...v, quantidade_folhas, metragem_planejada };
        });
        const totalFolhas = variantes.reduce((a, v) => a + v.quantidade_folhas, 0);
        const a = totalFolhas > 0 ? baseMetragem / totalFolhas : 0;
        const largura = Number(t.largura || 0);
        const tamanho_folha = largura > 0 ? round2Dev(a / largura) : 0;
        if (t.tamanho_folha !== tamanho_folha) changed = true;
        return { ...t, variantes, tamanho_folha };
      });
      return changed ? next : prev;
    });
  }, [autoFolhas, grades, draft?.proporcoes, cadTecidosState]);

  // Rótulos (nome/cor/apelido) de TODAS as variantes dos blocos, p/ a seção "4. CAD"
  // exibir o nome da variante ao adicioná-la ao vivo (o block só carrega o id). Sem isso,
  // uma variante nova sincronizada pro CAD aparece com "-" até salvar+reabrir.
  const allBlockVarianteIds = useMemo(() => {
    const s = new Set<string>();
    blocks.forEach((b) => b.variantes.forEach((v) => { if (v) s.add(v); }));
    return Array.from(s).sort();
  }, [blocks]);

  const { data: blockVariantesInfo = {}, isFetched: blockVariantesInfoFetched } = useQuery({
    queryKey: ["variantes-info-blocks", allBlockVarianteIds.join(",")],
    enabled: allBlockVarianteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .in("id", allBlockVarianteIds);
      if (error) throw error;
      const map: Record<string, { nome: string | null; cor: string | null; apelido: string | null }> = {};
      (data ?? []).forEach((v: any) => {
        map[v.id] = { nome: v.nome_variante ?? v.codigo_variante ?? null, cor: v.cor?.nome ?? null, apelido: v.apelido?.nome ?? null };
      });
      return map;
    },
  });

  // Sincroniza variantes do BOM (blocks) com o cadTecidosState — roda só após a semeadura.
  // Quando o usuário adiciona/remove uma variante na seção "3. Tecidos", o cadTecidosState
  // do tecido correspondente é atualizado: novas variantes ganham folhas/metragem zeradas
  // (prontas pro autoFolhas calcular) e variantes removidas são descartadas.
  // Preserva valores já digitados das variantes existentes (casa por variante_tecido_id).
  useEffect(() => {
    if (!cadSeeded) return; // só após a semeadura inicial
    setCadTecidosState((prev) => {
      let changed = false;
      const next = prev.map((cadTec) => {
        // Acha o block correspondente (mesmo tipo+numero)
        const block = blocks.find((b) => b.tipo === cadTec.tipo && b.numero === cadTec.numero);
        if (!block) return cadTec;

        // Variantes não-null do block, com sua ordem (1-based)
        const bomVars: { variante_tecido_id: string; ordem: number; multiplicador: number }[] = [];
        block.variantes.forEach((vid, i) => {
          if (vid) bomVars.push({ variante_tecido_id: vid, ordem: i + 1, multiplicador: Number(block.multiplicadores?.[i] ?? 1) || 1 });
        });

        // Mapa das variantes já no cadTecidosState (por variante_tecido_id)
        const have = new Map(cadTec.variantes.map((v) => [v.variante_tecido_id, v]));

        // Constrói a nova lista de variantes do cadTec
        const nextVariantes: CadVarianteRow[] = bomVars.map(({ variante_tecido_id, ordem, multiplicador }) => {
          const existing = have.get(variante_tecido_id);
          const info = blockVariantesInfo[variante_tecido_id];
          // Rótulo vem do mapa; se ainda não carregou, preserva o que houver (não zera).
          const nome = info?.nome ?? existing?.variante_nome ?? null;
          const cor = info?.cor ?? existing?.variante_cor ?? null;
          const apelido = info?.apelido ?? existing?.variante_apelido ?? null;
          if (existing) {
            // Preserva valores já digitados; atualiza ordem/multiplicador e rótulos se mudaram
            if (existing.ordem !== ordem || existing.multiplicador !== multiplicador
              || existing.variante_nome !== nome || existing.variante_cor !== cor || existing.variante_apelido !== apelido) {
              changed = true;
              return { ...existing, ordem, multiplicador, variante_nome: nome, variante_cor: cor, variante_apelido: apelido };
            }
            return existing;
          }
          changed = true;
          // Nova variante: zerada (pronta pro autoFolhas) mas já com o rótulo resolvido
          return {
            variante_tecido_id,
            variante_nome: nome,
            variante_cor: cor,
            variante_apelido: apelido,
            multiplicador,
            ordem,
            quantidade_folhas: 0,
            metragem_planejada: 0,
            metragem_enviada: 0,
          } as CadVarianteRow;
        });

        // Checa se alguma variante foi removida
        if (nextVariantes.length !== cadTec.variantes.length) changed = true;

        if (!changed && nextVariantes.every((v, i) => v === cadTec.variantes[i])) return cadTec;
        changed = true;
        return { ...cadTec, variantes: nextVariantes };
      });
      return changed ? next : prev;
    });
  }, [blocks, cadSeeded, blockVariantesInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => {
    const sum = (tipo: TecidoBlock["tipo"]) =>
      blocks.filter((b) => b.tipo === tipo).reduce((s, b) => s + (b.custo_previsto || 0), 0);
    const tecido = sum("tecido");
    const forro = sum("forro");
    const entretela = sum("entretela");
    const aviamento = aviamentosState.reduce((s, r) => s + (r.custo_previsto || 0), 0);
    const etiqueta = etiquetasState.reduce((s, r) => s + (r.custo_previsto || 0), 0);
    const terceirizados = draft?.custo_terceirizados_previsto ?? 0;
    const custosAdd = somaCustosAdicionais(draft?.custos_adicionais);
    const peca = tecido + forro + entretela + aviamento + etiqueta + terceirizados + custosAdd;
    return { tecido, forro, entretela, aviamento, etiqueta, terceirizados, peca };
  }, [blocks, aviamentosState, etiquetasState, draft?.custo_terceirizados_previsto, draft?.custos_adicionais]);

  const curStatus = (draft?.status_desenvolvimento ?? "").toLowerCase();
  const isAprovado = curStatus === APROVADO_KEY;
  const isReprovado = (draft?.status_desenvolvimento ?? "").toLowerCase() === "reprovado";
  const hasTecidoComVariante = blocks.some(
    (b) => b.tipo === "tecido" && !!b.artigo_id && b.variantes.some((v) => !!v),
  );
  // Todo bloco selecionado (tecido/forro/entretela com artigo) precisa de ≥1 variante.
  const todosBlocosComArtigoTemVariante = blocks
    .filter((b) => !!b.artigo_id)
    .every((b) => b.variantes.some((v) => !!v));
  const gradeTotalGeral = grades.reduce((s, g) => s + (g.grade_total || 0), 0);

  const tecido1VarianteIds = useMemo(() => {
    const t1 = blocks.find((b) => b.tipo === "tecido" && b.numero === 1);
    if (!t1) return [] as string[];
    const out: string[] = [];
    for (const v of t1.variantes) {
      if (!v) break;
      out.push(v);
    }
    return out;
  }, [blocks]);

  // Variante nova HERDA a grade da 1ª variante (cores do mesmo modelo costumam ter a mesma
  // grade) — assim o "cálculo automático" do CAD calcula a variante recém-adicionada na hora,
  // em vez de deixá-la zerada por falta de grade. Só ADICIONA linhas faltantes; preserva as
  // existentes (o usuário pode ajustar a grade de cada cor depois).
  // ⚠️ `grades` PRECISA estar nas deps: as queries de seed são independentes e paralelas — se
  // `grades` (query ["modelo-grades"]) chega DEPOIS de `cadSeeded` (que espera tecidos/preços),
  // este efeito rodava no flanco de cadSeeded com prev=[] (no-op) e NUNCA re-rodava quando a grade
  // parcial chegava (grades não era dep) → linhas 2..N nunca herdadas → `seedSettled` (que exige
  // grade cobrindo o Tecido 1) ficava false p/ sempre → o guarda de "não salvo" nunca armava
  // (perda silenciosa de edição). O efeito é MONOTÔNICO (só adiciona; quando 1..N já existem
  // retorna `prev` = mesma ref → React aborta o setState), então `grades` na dep NÃO faz loop.
  useEffect(() => {
    if (!cadSeeded || tecido1VarianteIds.length === 0) return;
    setGrades((prev) => {
      if (prev.length === 0) return prev; // sem grade base pra herdar ainda
      const base = prev.find((g) => (g.grade_total || 0) > 0) ?? prev[0];
      let changed = false;
      const next = [...prev];
      for (let i = 0; i < tecido1VarianteIds.length; i++) {
        const numero = i + 1;
        if (!next.some((g) => g.variante_numero === numero)) {
          next.push({ variante_numero: numero, grades: { ...base.grades }, grade_total: base.grade_total });
          changed = true;
        }
      }
      return changed ? next.sort((a, b) => a.variante_numero - b.variante_numero) : prev;
    });
  }, [tecido1VarianteIds, cadSeeded, grades]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: tecido1VariantesLabels = {} } = useQuery({
    queryKey: ["variantes-labels", tecido1VarianteIds.join(",")],
    enabled: tecido1VarianteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .in("id", tecido1VarianteIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((v: any) => {
        const l = labelVarianteRow(v);
        map[v.id] = l !== "—" ? l : "";
      });
      return map;
    },
  });

  const tecido1VariantesInfo = useMemo(
    () => tecido1VarianteIds.map((id, i) => ({
      numero: i + 1,
      label: tecido1VariantesLabels[id] ?? "",
    })),
    [tecido1VarianteIds, tecido1VariantesLabels],
  );
  // Pilotos 2/3 são considerados "abertos" quando têm piloteiro ou data preenchidos.
  const piloto2Aberto = !!(draft?.piloteiro2_id || (draft?.data_piloto2 ?? "").trim());
  const piloto3Aberto = !!(draft?.piloteiro3_id || (draft?.data_piloto3 ?? "").trim());
  // Cada pendência aponta a SEÇÃO do accordion onde se resolve (o rodapé vira link que abre a seção).
  const cadMissing: { label: string; sec: string }[] = [];
  if (isAprovado) {
    if ((draft?.ref ?? "").trim() === "") cadMissing.push({ label: fl("ref"), sec: "s1" });
    if ((draft?.nome ?? "").trim() === "") cadMissing.push({ label: "Nome", sec: "s1" });
    if (!(modelo as any)?.estilista_id) cadMissing.push({ label: "Estilista", sec: "s1" });
    if (!draft?.categoria_principal_id) cadMissing.push({ label: "Categoria", sec: "s1" });
    if (!hasTecidoComVariante) cadMissing.push({ label: "ao menos 1 tecido com variante", sec: "s2" });
    else if (!todosBlocosComArtigoTemVariante) cadMissing.push({ label: "1 variante em cada tecido/forro/entretela selecionado", sec: "s2" });
    if (gradeTotalGeral <= 0) cadMissing.push({ label: "grade preenchida", sec: "s4" });
    if ((draft?.data_desenho_tecnico ?? "").trim() === "") cadMissing.push({ label: "Data Desenho Técnico", sec: "s1" });
    if ((draft?.data_piloto1 ?? "").trim() === "") cadMissing.push({ label: "Data Piloto 1", sec: "s1" });
    if (piloto2Aberto && (draft?.data_piloto2 ?? "").trim() === "") cadMissing.push({ label: "Data Piloto 2", sec: "s1" });
    if (piloto3Aberto && (draft?.data_piloto3 ?? "").trim() === "") cadMissing.push({ label: "Data Piloto 3", sec: "s1" });
  }
  // Enviar é sempre visível quando aprovado e sem itens faltando (idempotente: reenviar é ok).
  const canEnviarCad = isAprovado && !draft?.enviado_cad && cadMissing.length === 0;
  // Read-only quando já enviado à Explosão e fora do modo edição (lápis "Editar").
  const locked = !!draft?.enviado_cad && !editing;

  // ── Selos de completude por seção + numeração DINÂMICA do accordion ──────────────────
  const nTecidos = blocks.filter((b) => b.tipo === "tecido" && !!b.artigo_id).length;
  const nAviamentos = aviamentosState.filter((r) => !!r.aviamento_id).length;
  const nInsumos = etiquetasState.filter((e) => !!e.etiqueta_id).length;
  const infoCompleta = !!(draft?.nome && draft?.categoria_principal_id && draft?.linha_id && (modelo as any)?.estilista_id);
  const temCroqui = !!draft?.croqui_url;
  const temAnexo = temCroqui || !!draft?.desenho_tecnico_url || !!draft?.ficha_medida_url || ((draft?.fotos_modelo?.length ?? 0) > 0);
  const custoLbl = totals.peca > 0 ? `R$ ${totals.peca.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "R$ —";
  // Ordem das seções → nº 1..N pulando as ocultas (Custos some sem permissão, sem deixar buraco).
  const secOrdem: { key: string; on: boolean }[] = [
    { key: "s1", on: true }, { key: "prova", on: true }, { key: "s2", on: true },
    { key: "s-cad", on: true }, { key: "s3", on: true }, { key: "s3e", on: true },
    { key: "s4", on: true }, { key: "s5", on: podeVerCustos }, { key: "s6", on: true },
  ];
  const secNum = (key: string) => {
    let n = 0;
    for (const s of secOrdem) { if (!s.on) continue; n++; if (s.key === key) return n; }
    return n;
  };
  // Abre (e rola até) a seção onde uma pendência se resolve — usado pelos links do rodapé.
  const irParaSecao = (sec: string) => {
    setAccOpen((prev) => (prev.includes(sec) ? prev : [...prev, sec]));
    requestAnimationFrame(() =>
      document.querySelector(`[data-acc="${sec}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  // Status no fluxo — barra persistente acima do accordion (mockup): é o controle que porteia o
  // kanban; sempre visível, não enterrado numa seção colapsável. Move o Select que ficava na §1.
  const statusList = statusOptions.length > 0 ? statusOptions : STATUS_DESENV_OPTS;
  const statusCur = draft?.status_desenvolvimento ?? "";
  const statusRenderList = statusList.some((s) => s.value === statusCur) || !statusCur ? statusList : [...statusList, { value: statusCur, label: statusCur }];

  // Re-baseline o guarda de alterações quando o estado semeado ASSENTA. A dificuldade: a
  // semeadura acontece em VÁRIOS efeitos (draft, blocks, aviamentos, grades, cadTecidos) e a
  // sincronização de rótulos (blockVariantesInfo → cadTecidosState) só normaliza o estado
  // DEPOIS que os mapas de rótulo carregam. Se baselinássemos cedo demais, uma normalização
  // posterior divergiria do baseline e o card abriria "sujo" sem edição (falso-positivo).
  //
  // ⚠️ A heurística ANTIGA ("estável por 2 renders") NÃO armava de forma confiável e o
  // indicador de "alterações não salvas" sumiu (regressão). O motivo: o efeito de armar tinha
  // `guardSnapshotStr` nas deps, mas o React só re-roda o efeito quando o VALOR da dep muda —
  // e o efeito só ARMA no galho `prev === atual`, que exige um render EXTRA com o snapshot
  // IGUAL. Depois que o estado assentava, o snapshot parava de mudar → o efeito não re-rodava
  // → nunca alcançava o galho de armar → `guardReady` ficava false p/ sempre → `dirty` sempre
  // false. (Só armava por acidente, se um render não-relacionado ocorresse com o mesmo snapshot.)
  //
  // Estratégia NOVA (confiável, à prova de loop e de falso-positivo): arma quando as FONTES
  // de dados que semeiam/normalizam o estado ASSENTARAM (readiness data-driven) E o snapshot
  // já ESTABILIZOU relativo ao render anterior. A readiness (`seedSettled`) GARANTE que o
  // efeito seja re-executado até armar (não depende de um render extra acidental como a
  // heurística antiga); a estabilidade evita armar no MESMO render em que uma normalização
  // pós-seed ainda está pendente (o efeito de sync de rótulos, declarado ANTES deste, agenda
  // `setCadTecidosState` no commit em que `blockVariantesInfo` chega — se armássemos ali,
  // baselinaríamos o snapshot PRÉ-normalização e a atualização pendente marcaria falso "sujo").
  //
  // `seedSettled` = seed do CAD terminou (`cadSeeded`, o último a disparar) E as duas
  // normalizações pós-seed que dependem de query async já carregaram (ou não são necessárias):
  // rótulos de variante dos blocos (`blockVariantesInfo`) e recomputo de preço das etiquetas
  // (`etiquetasList`).
  const seedSettled =
    cadSeeded
    && (allBlockVarianteIds.length === 0 || blockVariantesInfoFetched)
    && (etiquetasState.length === 0 || etiquetasListFetched)
    // Grade coberta: o efeito de HERANÇA de grade (adiciona uma linha por variante do Tecido 1
    // que ainda não tem grade) muta `grades` DEPOIS que os blocks assentam — fora dos outros
    // gates. Se armássemos antes dele rodar (ex.: após "aplicar ao modelo", quando modelo_grades
    // tem menos linhas que as variantes do Tecido 1), a linha herdada divergiria do baseline e o
    // card abriria FALSO "não salvo". Só considera assentado quando toda variante do Tecido 1 já
    // tem linha de grade (ou não há grade base p/ herdar).
    && (grades.length === 0 || tecido1VarianteIds.every((_, i) => grades.some((g) => g.variante_numero === i + 1)));
  // `prevSnapStr` guarda o snapshot do render anterior JÁ com `seedSettled=true`. Fica null
  // enquanto as fontes não assentaram; assim, no PRIMEIRO render assentado a comparação
  // falha de propósito (não arma). Isso cobre o caso em que `blockVariantesInfo` chega e,
  // no MESMO commit, o efeito de sync de rótulos (declarado antes) agenda um
  // `setCadTecidosState` ainda pendente: o `guardSnapshotStr` deste render é PRÉ-normalização,
  // então NÃO armamos aqui; esperamos o próximo render, já com o estado normalizado FINAL.
  const prevSnapStr = useRef<string | null>(null);
  useEffect(() => {
    if (guardReady) return; // já armado: só o usuário muda o estado a partir daqui
    if (!draft || !seedSettled) {
      // Ainda semeando/normalizando: o baseline SEGUE o estado (absorve a semeadura) e
      // reseta a referência de estabilidade — o `changed` não dispara falso-positivo aqui
      // porque `dirty` só liga com `guardReady`, que ainda é false.
      baselineRef.current = guardSnapshotStr;
      prevSnapStr.current = null;
      return;
    }
    if (prevSnapStr.current === guardSnapshotStr) {
      // Fontes assentadas E snapshot ESTÁVEL vs o render anterior assentado (nenhuma
      // normalização pendente mexeu): congela o baseline no estado normalizado e ARMA. Daqui
      // pra frente só uma edição REAL do usuário muda `guardSnapshotStr` → `changed`/`dirty`.
      baselineRef.current = guardSnapshotStr;
      setGuardReady(true);
    } else {
      // 1º render assentado (prevSnapStr=null) OU normalização pós-seed acabou de aplicar
      // neste render: registra o snapshot e FORÇA um render extra p/ CONFIRMAR a estabilidade.
      // Sem esse bump, quando o estado normalizado é o FINAL o efeito não re-rodaria (a dep
      // `guardSnapshotStr` não muda mais) e nunca alcançaria o galho de armar — era exatamente
      // a falha da heurística antiga. O bump é BOUNDED: só ocorre enquanto `!guardReady &&
      // seedSettled` e o snapshot ainda difere; assim que estabiliza, arma e para (sem loop).
      baselineRef.current = guardSnapshotStr;
      prevSnapStr.current = guardSnapshotStr;
      setBaselineTick((n) => n + 1);
    }
  }, [guardSnapshotStr, draft, seedSettled, guardReady, baselineTick]);

  // Reporta ao pai (dono do Sheet) se há edições pendentes. Read-only não altera nada.
  // Só conta como sujo depois que o baseline pós-seed assentou (guardReady).
  const dirty = guardReady && !locked && !!draft && changed;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  // Persiste o modelo + BOM (tecidos/variantes/grade/aviamentos) via salvar_modelo_bom.
  // Usado pelo Salvar e também ANTES de Enviar ao CAD, garantindo que a cópia ao CAD
  // use exatamente o que está no Desenvolvimento (a validação usa estado local; a
  // cópia ao CAD lê do banco — sem persistir, iria dado incompleto/vazio).
  const persistModelo = async () => {
      if (!draft) return;
      const payload = {
        nome: draft.nome,
        ref: draft.ref || null,
        status_desenvolvimento: draft.status_desenvolvimento,
        motivo_cancelamento: isReprovado ? draft.motivo_cancelamento : null,
        linha_id: draft.linha_id,
        estilista_id: draft.estilista_id,
        modelista_id: draft.modelista_id,
        piloteiro1_id: draft.piloteiro1_id,
        piloteiro2_id: draft.piloteiro2_id,
        piloteiro3_id: draft.piloteiro3_id,
        data_piloto1: draft.data_piloto1 || null,
        data_piloto2: draft.data_piloto2 || null,
        data_piloto3: draft.data_piloto3 || null,
        data_desenho_tecnico: draft.data_desenho_tecnico || null,
        data_aprovacao: draft.data_aprovacao || null,
        observacoes_tecnicas: draft.observacoes_tecnicas || null,
        observacoes_gerais: draft.observacoes_gerais || null,
        observacoes_mao_obra: draft.observacoes_mao_obra || null,
        ficha_medida_url: draft.ficha_medida_url || null,
        desenho_tecnico_url: draft.desenho_tecnico_url || null,
        croqui_url: draft.croqui_url || null,
        categoria_principal_id: draft.categoria_principal_id || null,
        subcategoria1_id: draft.subcategoria1_id || null,
        subcategoria2_id: draft.subcategoria2_id || null,
        colecao_id: draft.colecao_id || null,
        subcolecao: draft.subcolecao || null,
        mes_id: draft.mes_id || null,
        ano_id: draft.ano_id || null,
        semana: draft.semana || null,
        custo_terceirizados_previsto: draft.custo_terceirizados_previsto || 0,
        custos_adicionais: draft.custos_adicionais ?? [],
        custo_tecido_total: totals.tecido,
        custo_forro_total: totals.forro,
        custo_entretela_total: totals.entretela,
        custo_aviamento_total: totals.aviamento,
        custo_peca_previsto: totals.peca,
        proporcoes: draft.proporcoes ?? {},
        fotos_modelo: draft.fotos_modelo ?? [],
        fotos_referencia: draft.fotos_referencia ?? [],
        // Mantém no plano os artigos principais E os substitutos efetivamente
        // usados (artigos das variantes de tecido), senão o pool de substitutos
        // do tecido encolheria ao recarregar e órfanaria variantes.
        tecidos_planejados: (() => {
          const out: string[] = [];
          const push = (id?: string | null) => { if (id && !out.includes(id)) out.push(id); };
          blocks
            .filter((b) => b.tipo === "tecido" && !!b.artigo_id)
            .sort((a, b) => a.numero - b.numero)
            .forEach((b) => push(b.artigo_id));
          blocks
            .filter((b) => b.tipo === "tecido")
            .forEach((b) => b.variantes.forEach((v) => push(v ? varianteArtigoMap[v] : null)));
          return out;
        })(),
      };
      const { error: e1 } = await supabase.from("modelos").update(payload as any).eq("id", modeloId);
      if (e1) throw e1;

      // Persistência atômica do BOM via RPC (substitui delete+insert não-transacional)
      const tecidosPayload = blocks
        .filter((b) => b.artigo_id)
        .map((b) => ({
          artigo_id: b.artigo_id,
          numero: b.numero,
          tipo: b.tipo,
          consumo: b.consumo || 0,
          loss_percent: b.loss_percent || 0,
          custo_previsto: b.custo_previsto || 0,
          variantes: b.variantes,
          // Tecido 1 é sempre 1:1 (principal); só complementares carregam multiplicador.
          multiplicadores: (b.tipo === "tecido" && b.numero === 1)
            ? b.variantes.map(() => 1)
            : b.multiplicadores.map((m) => Number(m) || 1),
          oc_links: b.variantes.flatMap((vid, i) => {
            const allocs = b.oc_links?.[i] ?? [];
            if (!vid) return [];
            return allocs
              .filter((al) => al.oc_tecido_item_id)
              .map((al) => ({
                ordem: i + 1,
                variante_tecido_id: vid,
                oc_tecido_item_id: al.oc_tecido_item_id,
                quantidade_m: al.quantidade_m ?? 0,
                prioridade: al.prioridade ?? 1,
              }));
          }),
        }));

      const aviamentosPayload = aviamentosState
        .filter((r) => r.aviamento_id)
        .map((r, i) => ({
          aviamento_id: r.aviamento_id,
          numero: i + 1,
          consumo: r.consumo || 0,
          loss_percent: r.loss_percent || 0,
          custo_previsto: r.custo_previsto || 0,
        }));

      const gradesPayload = grades.map((g) => ({
        variante_numero: g.variante_numero,
        grades: g.grades,
        grade_total: g.grade_total,
      }));

      const { error: eBom } = await supabase.rpc("salvar_modelo_bom" as any, {
        _modelo_id: modeloId,
        _tecidos: tecidosPayload as any,
        _aviamentos: aviamentosPayload as any,
        _grades: gradesPayload as any,
      });
      if (eBom) throw eBom;

      // Etiquetas do modelo (BOM) — diff direto por id (fora da RPC crítica do BOM, que
      // trata reserva de estoque; etiqueta não reserva). Preserva ids.
      const etqRows = etiquetasState.filter((r) => r.etiqueta_id);
      const existingEtqIds = (modeloEtiquetasData ?? []).map((e: any) => e.id as string);
      const keptEtq = new Set(etqRows.filter((r) => r.id).map((r) => r.id as string));
      for (const [i, r] of etqRows.entries()) {
        const row = {
          modelo_id: modeloId, etiqueta_id: r.etiqueta_id, cor_id: r.cor_id || null,
          numero: i + 1, consumo: r.consumo || 0, loss_percent: r.loss_percent || 0, custo_previsto: r.custo_previsto || 0,
        };
        if (r.id) {
          const { error } = await supabase.from("modelo_etiquetas" as any).update(row).eq("id", r.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("modelo_etiquetas" as any).insert(row);
          if (error) throw error;
        }
      }
      const toDelEtq = existingEtqIds.filter((id) => !keptEtq.has(id));
      if (toDelEtq.length) {
        const { error } = await supabase.from("modelo_etiquetas" as any).delete().in("id", toDelEtq);
        if (error) throw error;
      }

      // Sincroniza o cad_* com as folhas/metragem editadas na seção "4. CAD".
      // salvar_cad_completo cria o CAD se não existir (idempotente); preserva a
      // grade real do CQ quando confirmado (invariante #6).
      // Só sincroniza se o BOM tem ao menos um tecido com variante (evita payload vazio
      // que criaria um CAD vazio antes do modelo estar pronto).
      if (cadTecidosState.length > 0) {
        const cadGradesPayload = gradesPayload.filter(
          (g) => (g.grade_total || 0) > 0 || Object.values(g.grades || {}).some((v) => (Number(v) || 0) > 0),
        );
        // Explosão (quantidade) = consumo × grade total geral — recomputada do ESTADO ATUAL
        // do card (seções 5. Aviamentos / 6. Insumos), NÃO do cad_* antigo. Assim editar
        // aviamento/insumo reflete na Ficha Técnica e no downstream. Espelha a fórmula do
        // _enviar_modelo_para_cad_core (consumo × grade total).
        const round4 = (n: number) => Math.round(n * 10000) / 10000;
        const cadAviamentosPayload = aviamentosPayload.map((a, i) => ({
          aviamento_id: a.aviamento_id,
          numero: i + 1,
          consumo: a.consumo || 0,
          quantidade_enviar: round4((a.consumo || 0) * gradeTotalGeral),
          quantidade_separar: round4((a.consumo || 0) * gradeTotalGeral),
        }));
        const cadEtiquetasPayload = etqRows.map((e: any) => ({
          etiqueta_id: e.etiqueta_id,
          cor_id: e.cor_id ?? null,
          consumo: Number(e.consumo ?? 0),
          quantidade_planejada: round4(Number(e.consumo ?? 0) * gradeTotalGeral),
          quantidade_enviar: round4(Number(e.consumo ?? 0) * gradeTotalGeral),
          enviar_por_tamanho: (e.enviar_por_tamanho ?? {}) as Record<string, number>,
        }));
        const { error: eCad } = await supabase.rpc("salvar_cad_completo" as any, {
          _modelo_id: modeloId,
          _tecidos: cadTecidosState.map((t) => ({
            artigo_id: t.artigo_id,
            numero: t.numero,
            tipo: t.tipo,
            consumo_cad: t.consumo_cad,
            loss_percent_cad: t.loss_percent_cad,
            custo_cad: t.custo_cad,
            tamanho_folha: t.tamanho_folha,
            variantes: t.variantes.map((v) => ({
              variante_tecido_id: v.variante_tecido_id,
              ordem: v.ordem,
              multiplicador: Number(v.multiplicador ?? 1) || 1,
              quantidade_folhas: v.quantidade_folhas,
              metragem_planejada: v.metragem_planejada,
              metragem_enviada: v.metragem_enviada,
            })),
          })),
          _grades: cadGradesPayload,
          _aviamentos: cadAviamentosPayload,
          _etiquetas: cadEtiquetasPayload,
          _proporcoes: draft?.proporcoes ?? {},
          _observacoes_molde: null,
          _data_previsao_corte: null,
        });
        if (eCad) throw eCad;
      }
  };

  const save = useMutation({
    mutationFn: persistModelo,
    onSuccess: async () => {
      markClean(); // limpa o indicador de "alterações não salvas" já no sucesso
      // Marca revisão (#Erro) nas etapas afetadas — o SERVIDOR retorna EXATAMENTE quais
      // etapas existem downstream e foram marcadas. A mensagem usa esse retorno (não o
      // hasDownstream cacheado, que fica stale depois de reverter uma etapa e faria o toast
      // citar Serviços/CQ/Direcionamento que já não existem).
      const { data: marcadas } = await supabase.rpc("marcar_revisao_por_mudanca" as any, {
        _modelo_id: modeloId, _grade: gradeAlterada, _consumo: consumoAlterado, _aviamentos: aviamentoAlterado,
      });
      const etapasMarcadas = marcadas && typeof marcadas === "object" ? Object.keys(marcadas as any) : [];
      if (etapasMarcadas.length > 0) {
        // Grade mudou → etapas de PEÇA marcadas p/ re-verificação (o CQ é contagem física,
        // precisa ser refeito por quem conta; o resto — split, metragem — re-deriva sozinho).
        const nomes = etapasMarcadas.map((k) => STAGE_LABEL[k] ?? k).join(", ");
        const corteMsg = etapas.corte && (etapas.baixa_total ?? 0) > 0
          ? " O corte/baixa de estoque também foi afetado — reveja a Explosão."
          : "";
        toast.info(`Salvo. Etapas posteriores marcadas para verificação (#Erro): ${nomes}.${corteMsg}`);
      } else if ((consumoAlterado || aviamentoAlterado) && etapas.corte) {
        // Consumo/aviamento mudou num modelo já cortado → afeta SÓ a metragem do corte; as
        // etapas de peça (Serviços/CQ/Direcionamento) NÃO precisam ser refeitas.
        toast.info("Salvo. A metragem/baixa do corte mudou — reveja a Explosão (reenvie se necessário).");
      } else {
        toast.success("Modelo salvo");
      }
      ["producao-terc-list", "producao-cq-list", "dir-list"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ["etapas-afetadas", modeloId] });
      setGradeAlterada(false); setConsumoAlterado(false); setAviamentoAlterado(false);
      setCamposCopiados(new Set());
      qc.invalidateQueries({ queryKey: ["modelo-detail", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-etiquetas", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-condicoes-kanban", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-tecidos", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-tecido-oc-links", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-aviamentos", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-grades", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      // A reserva de estoque é recalculada a partir do BOM salvo (1ª reserva).
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      // Invalida o cache do CAD (seção "4. CAD") p/ refletir o cad_* salvo.
      qc.invalidateQueries({ queryKey: ["dev-cad-row", modeloId] });
      qc.invalidateQueries({ queryKey: ["dev-cad-tecidos"] });
      qc.invalidateQueries({ queryKey: ["dev-cad-aviamentos"] });
      qc.invalidateQueries({ queryKey: ["dev-cad-etiquetas"] });
      // Re-semeia a seção "4. CAD" a partir do cad_* recém-criado/salvo. Sem isso, o
      // cadSeeded (one-shot, só reseta ao trocar de modelo) trava a re-semeadura e a
      // seção CAD fica defasada até fechar+reabrir o card (bug pós-importação/1º save).
      setCadSeeded(false);
      // Desarma o guarda: o re-seed pós-save re-baselina para o estado gravado/normalizado
      // (absorve qualquer diferença de normalização do refetch, sem falso "não salvo").
      setGuardReady(false);
      // Printável (Ficha Técnica, useFichaData keys ft-*) lê do banco — invalida p/ refletir o que acabou de salvar.
      qc.invalidateQueries({ predicate: (query) => typeof query.queryKey?.[0] === "string" && (query.queryKey[0] as string).startsWith("ft-") });
      qc.invalidateQueries({ queryKey: ["modelo-observacoes", modeloId] });
      // Atualiza a Explosão para refletir o CAD recém-salvo.
      qc.invalidateQueries({ queryKey: ["explosao-cad-row", modeloId] });
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "explosao-cad-tecidos" });
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "explosao-cad-grades" });
      qc.invalidateQueries({ queryKey: ["producao-explosao-list"] });
      setEditing(false); // Salvar re-trava quando já foi enviado à Explosão.
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
  });

  // Aplica um patch de importação nos estados locais (NÃO grava no banco — o Salvar existente comita).
  const aplicarPatch = (patch: PatchCopia, campos: Set<string>) => {
    if (patch.observacoes_tecnicas !== undefined) setDraft((d: any) => ({ ...d, observacoes_tecnicas: patch.observacoes_tecnicas }));
    if (patch.custos_adicionais !== undefined) setDraft((d: any) => ({ ...d, custos_adicionais: patch.custos_adicionais }));
    if (patch.proporcoes !== undefined) setDraft((d: any) => ({ ...d, proporcoes: patch.proporcoes }));
    if (patch.blocks !== undefined) setBlocks(patch.blocks.map((b) => recomputeBlock(b, artigoMap, varianteArtigoMap, frozenPrecos as Record<string, number>)));
    if (patch.aviamentos !== undefined) setAviamentosState(patch.aviamentos);
    if (patch.etiquetas !== undefined) setEtiquetasState(patch.etiquetas);
    if (patch.grades !== undefined) setGrades(patch.grades);
    // Marca alterações p/ o alerta de revisão downstream (mesma semântica do editar à mão)
    if (patch.blocks) setConsumoAlterado(true);
    if (patch.grades) setGradeAlterada(true);
    if (patch.aviamentos) setAviamentoAlterado(true);
    setCamposCopiados((prev) => new Set([...prev, ...campos]));
  };

  const onCampoEditado = (chave: string) => setCamposCopiados((prev) => {
    if (!prev.has(chave)) return prev;
    const n = new Set(prev); n.delete(chave); return n;
  });

  // Lista o que já tem valor e será substituído (para o AlertDialog de confirmação).
  const overwritesDoPatch = (patch: PatchCopia): string[] => {
    const out: string[] = [];
    if (patch.observacoes_tecnicas !== undefined && (draft?.observacoes_tecnicas ?? "").trim()) out.push("Observações técnicas");
    if (patch.custos_adicionais !== undefined && (draft?.custos_adicionais ?? []).length) out.push("Custos adicionais");
    if (patch.proporcoes !== undefined && Object.keys(draft?.proporcoes ?? {}).length > 0) out.push("Proporções");
    if (patch.grades !== undefined && grades.some((g) => (g.grade_total ?? 0) > 0)) out.push("Grade");
    if (patch.aviamentos !== undefined && aviamentosState.some((a) => a.aviamento_id)) out.push("Aviamentos");
    if (patch.etiquetas !== undefined && etiquetasState.some((e) => e.etiqueta_id)) out.push("Insumos/Etiquetas");
    if (patch.blocks !== undefined) {
      for (const nb of patch.blocks) {
        const old = blocks.find((b) => b.tipo === nb.tipo && b.numero === nb.numero);
        if (!old) continue;
        const mudouArtigo = old.artigo_id && nb.artigo_id !== old.artigo_id;
        const mudouConsumo = (old.consumo ?? 0) > 0 && nb.consumo !== old.consumo;
        const mudouVar = old.variantes.some((v) => v) && JSON.stringify(nb.variantes) !== JSON.stringify(old.variantes);
        if (mudouArtigo || mudouConsumo || mudouVar) out.push(`${nb.tipo === "tecido" ? "Tecido" : nb.tipo === "forro" ? "Forro" : "Entretela"} ${nb.numero}`);
      }
    }
    return out;
  };

  const onCopiar = (r: ResultadoCopia, origem?: ModeloParaCopia, sel?: Selecao) => {
    const aplicar = async () => {
      aplicarPatch(r.patch, r.campos);
      if (sel?.obsBloco && origem) {
        // REPLACE semantics: delete destination's existing manual rows, then insert source's rows.
        // Always delete (even if source is empty) so a copy of an empty source clears the destination.
        const { error: eDel } = await supabase.from("modelo_observacoes" as any).delete().eq("modelo_id", modeloId);
        if (eDel) { toast.error(mensagemErro(eDel, "Erro ao substituir observações")); return; }
        const rows = (origem.obsBlocoLinhas ?? []).map((o) => ({ modelo_id: modeloId, ordem: o.ordem, descricao: o.descricao, observacao: o.observacao }));
        if (rows.length > 0) {
          const { error: eIns } = await supabase.from("modelo_observacoes" as any).insert(rows);
          if (eIns) { toast.error(mensagemErro(eIns, "Erro ao copiar observações")); return; }
        }
        qc.invalidateQueries({ queryKey: ["modelo-observacoes", modeloId] });
        toast.info("Observações copiadas.");
      }
    };
    const itens = overwritesDoPatch(r.patch);
    if (sel?.obsBloco) itens.push("Observações (bloco)");
    if (itens.length === 0) { aplicar(); return; }
    setConfirmSobrescrita({ itens, aplicar: () => { aplicar(); setConfirmSobrescrita(null); } });
  };

  const enviarCad = useMutation({
    mutationFn: async () => {
      // Salva o BOM atual antes de copiar para o CAD (consumos/variantes corretos).
      await persistModelo();
      // Criação do CAD + cópia do BOM (tecidos/variantes/grade/aviamentos) agora é
      // ATÔMICA e IDEMPOTENTE via RPC: recusa um segundo CAD para o mesmo modelo
      // (UNIQUE cad.modelo_id) e, em qualquer falha parcial, faz ROLLBACK de tudo.
      const { error } = await supabase.rpc("enviar_modelo_para_cad" as any, {
        _modelo_id: modeloId,
        _observacoes_tecnicas: draft?.observacoes_tecnicas || null,
        _ficha_medida_url: draft?.ficha_medida_url || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Enviado para a Explosão");
      setDraft((d: any) => ({ ...d, enviado_cad: true }));
      qc.invalidateQueries({ queryKey: ["modelo-detail", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-condicoes-kanban", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-cad-calc", modeloId] });
      // Ficha Técnica reflete o estado enviado; a Explosão passa a listar o modelo.
      qc.invalidateQueries({ predicate: (query) => typeof query.queryKey?.[0] === "string" && (query.queryKey[0] as string).startsWith("ft-") });
      qc.invalidateQueries({ queryKey: ["producao-explosao-list"] });
      // Explosão precisa recarregar os dados do CAD recém-criado/atualizado.
      qc.invalidateQueries({ queryKey: ["explosao-cad-row", modeloId] });
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "explosao-cad-tecidos" });
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "explosao-cad-grades" });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao enviar")),
  });

  const updateBlock = (idx: number, patch: Partial<TecidoBlock>) => {
    // Só marca "consumo alterado" (que vira #Erro nas etapas downstream) quando
    // consumo/%loss REALMENTE mudam — trocar artigo/substituto não altera a metragem,
    // então não deve disparar revisão pendente nas etapas.
    if (patch.consumo !== undefined || patch.loss_percent !== undefined) setConsumoAlterado(true);
    // Propagação bidirecional: consumo/loss no BOM → CAD
    if (patch.consumo !== undefined || patch.loss_percent !== undefined) {
      const target = blocks[idx];
      if (target) {
        const { tipo, numero } = target;
        setCadTecidosState((prev) => prev.map((t) => {
          if (t.tipo !== tipo || t.numero !== numero) return t;
          const cadPatch: Partial<CadTecidoRow> = {};
          if (patch.consumo !== undefined) cadPatch.consumo_cad = patch.consumo;
          if (patch.loss_percent !== undefined) cadPatch.loss_percent_cad = patch.loss_percent;
          const merged = { ...t, ...cadPatch };
          merged.custo_cad = calcCusto(merged.consumo_cad, merged.loss_percent_cad, merged.preco);
          return merged;
        }));
      }
    }
    const target = blocks[idx];
    const isTecido1 = target?.tipo === "tecido" && target?.numero === 1;
    const applyPatch = () => {
      setBlocks((bs) => bs.map((b, i) => {
        if (i !== idx) return b;
        let merged = { ...b, ...patch };
        // Ao remover um substituto (forro), descarta variantes que pertenciam a
        // ele — ficariam órfãs (fora do pool de variantes do bloco).
        if (patch.artigoIdsExtra !== undefined) {
          const pool = new Set<string>([merged.artigo_id, ...merged.artigoIdsExtra].filter(Boolean) as string[]);
          const variantes = merged.variantes.map((v) =>
            v && varianteArtigoMap[v] && !pool.has(varianteArtigoMap[v]) ? null : v,
          );
          merged = { ...merged, variantes };
        }
        return recomputeBlock(merged, artigoMap, varianteArtigoMap, frozenPrecos as Record<string, number>);
      }));
    };
    // Trocar o artigo do Tecido 1 zera suas variantes; a grade é indexada por
    // essas variantes, então ficaria órfã (somada no total e copiada ao CAD).
    // Confirma antes de descartar grade preenchida e limpa-a junto.
    if (isTecido1 && patch.artigo_id !== undefined && patch.artigo_id !== target.artigo_id) {
      const hasGrade = grades.some(
        (g) => g.grade_total > 0 || Object.values(g.grades || {}).some((v) => (v ?? 0) > 0),
      );
      if (hasGrade) {
        setConfirmGrade({
          msg: "Trocar o Tecido 1 vai apagar a grade preenchida. Continuar?",
          onConfirm: () => { setGrades([]); applyPatch(); },
        });
        return;
      }
      setGrades([]);
    }
    applyPatch();
  };
  const updateBlockVariante = (idx: number, vIdx: number, value: string | null) => {
    setConsumoAlterado(true);
    const target = blocks[idx];
    const isTecido1 = target?.tipo === "tecido" && target?.numero === 1;
    const applyChange = () => {
      setBlocks((bs) => bs.map((b, i) => {
        if (i !== idx) return b;
        const variantes = [...b.variantes];
        const oc_links = (b.oc_links ?? []).map((a) => [...(a ?? [])]);
        while (oc_links.length < 10) oc_links.push([]);
        const prev = variantes[vIdx];
        variantes[vIdx] = value;
        if (!value) {
          oc_links[vIdx] = [];
          for (let k = vIdx + 1; k < variantes.length; k++) { variantes[k] = null; oc_links[k] = []; }
        } else if (prev !== value) {
          // variante mudou: invalida os vínculos de OC (eram de outra variante)
          oc_links[vIdx] = [];
        }
        // Recalcula: o custo usa o maior preço entre os artigos das variantes
        // escolhidas (substitutos podem ter preços diferentes).
        return recomputeBlock({ ...b, variantes, oc_links }, artigoMap, varianteArtigoMap, frozenPrecos as Record<string, number>);
      }));
    };
    if (isTecido1 && !value) {
      // Verifica se há grade preenchida nesta variante ou nas que serão removidas em cascata
      const affected: number[] = [];
      for (let k = vIdx; k < target.variantes.length; k++) {
        const n = k + 1;
        const g = grades.find((x) => x.variante_numero === n);
        const hasGrade = !!g && (g.grade_total > 0 || Object.values(g.grades || {}).some((v) => (v ?? 0) > 0));
        if (hasGrade) affected.push(n);
      }
      if (affected.length > 0) {
        const lista = affected.map((n) => `Variante ${n}`).join(", ");
        const msg = affected.length === 1
          ? `A ${lista} possui grade preenchida. Remover mesmo assim?`
          : `As variantes ${lista} possuem grade preenchida. Remover mesmo assim?`;
        setConfirmGrade({
          msg,
          onConfirm: () => {
            setGrades((gs) => gs.filter((g) => !affected.includes(g.variante_numero)));
            applyChange();
          },
        });
        return;
      }
    }
    applyChange();
  };
  const updateBlockOcLinks = (idx: number, vIdx: number, allocs: OcAlloc[]) => {
    setBlocks((bs) => bs.map((b, i) => {
      if (i !== idx) return b;
      const oc_links = (b.oc_links ?? []).map((a) => [...(a ?? [])]);
      while (oc_links.length < 10) oc_links.push([]);
      oc_links[vIdx] = allocs;
      return { ...b, oc_links };
    }));
  };

  const updateAviamento = (idx: number, patch: Partial<AviamentoRow>) => {
    setAviamentoAlterado(true);
    setAviamentosState((rows) => rows.map((r, i) => i === idx ? recomputeAviamento({ ...r, ...patch }, aviamentoMap) : r));
  };
  const addAviamento = () => {
    setAviamentoAlterado(true);
    if (aviamentosState.length >= 20) return;
    setAviamentosState((rows) => [...rows, { aviamento_id: null, consumo: 0, loss_percent: 0, custo_previsto: 0 }]);
  };
  const removeAviamento = (idx: number) => { setAviamentoAlterado(true); setAviamentosState((rows) => rows.filter((_, i) => i !== idx)); };

  const updateEtiqueta = (idx: number, patch: Partial<ModeloEtiquetaRow>) => {
    setEtiquetasState((rows) => rows.map((r, i) => i === idx ? recomputeEtiqueta({ ...r, ...patch }, etiquetaMap) : r));
  };
  const addEtiqueta = () => {
    if (etiquetasState.length >= 20) return;
    setEtiquetasState((rows) => [...rows, { etiqueta_id: null, cor_id: null, consumo: 0, loss_percent: 0, custo_previsto: 0 }]);
  };
  const removeEtiqueta = (idx: number) => setEtiquetasState((rows) => rows.filter((_, i) => i !== idx));

  const updateGradeTotal = (n: number, total: number) => {
    setGradeAlterada(true);
    setGrades((gs) => {
      const cur = gs.find((g) => g.variante_numero === n) ?? { variante_numero: n, grades: {}, grade_total: 0 };
      const props = draft?.proporcoes ?? {};
      const sum = tamanhos.reduce((s, t) => s + (Number(props[t]) || 0), 0);
      const next: Record<string, number> = { ...cur.grades };
      if (sum > 0 && total > 0) {
        tamanhos.forEach((t) => {
          next[t] = Math.round(((Number(props[t]) || 0) / sum) * total);
        });
        const rounded = tamanhos.reduce((s, t) => s + (next[t] || 0), 0);
        const diff = total - rounded;
        if (diff !== 0) {
          // distribui a diferença no tamanho com maior proporção
          let maxTam = tamanhos[0];
          let maxProp = -Infinity;
          tamanhos.forEach((t) => {
            const p = Number(props[t]) || 0;
            if (p > maxProp) { maxProp = p; maxTam = t; }
          });
          next[maxTam] = Math.max(0, (next[maxTam] || 0) + diff);
        }
      } else {
        tamanhos.forEach((t) => { next[t] = 0; });
      }
      const others = gs.filter((g) => g.variante_numero !== n);
      return [...others, { variante_numero: n, grades: next, grade_total: total }].sort((a, b) => a.variante_numero - b.variante_numero);
    });
  };
  const updateGradeCell = (n: number, tam: string, qty: number) => {
    setGradeAlterada(true);
    setGrades((gs) => {
      const cur = gs.find((g) => g.variante_numero === n) ?? { variante_numero: n, grades: {}, grade_total: 0 };
      const props = draft?.proporcoes ?? {};
      const propTam = Number(props[tam]) || 0;
      let next: Record<string, number>;
      if (gradeAuto && qty > 0 && propTam > 0) {
        // Âncora: a célula digitada define a "unidade" (qty / proporção dela) e as
        // demais são preenchidas por proporção. Ex.: PPP=30 com prop 1·1·2·2·2·1
        // -> 30·30·60·60·60·30.
        const unit = qty / propTam;
        next = {};
        tamanhos.forEach((t) => { next[t] = Math.round(unit * (Number(props[t]) || 0)); });
        next[tam] = qty; // mantém exatamente o valor digitado na âncora
      } else {
        next = { ...cur.grades, [tam]: qty };
      }
      const realTotal = tamanhos.reduce((s, t) => s + (Number(next[t]) || 0), 0);
      const others = gs.filter((g) => g.variante_numero !== n);
      return [...others, { variante_numero: n, grades: next, grade_total: realTotal }].sort((a, b) => a.variante_numero - b.variante_numero);
    });
  };
  const updateProporcao = (tam: string, val: number) => {
    setGradeAlterada(true);
    const oldProp = (draft?.proporcoes ?? {}) as Record<string, number>;
    const newProp = { ...oldProp, [tam]: Math.max(0, val) };
    setDraft((d: any) => ({ ...d, proporcoes: newProp }));
    // Com cálculo automático ativo, mudar a proporção redistribui a grade
    // mantendo a escala (unidade = total ÷ soma das proporções anterior).
    if (gradeAuto) {
      const oldSum = tamanhos.reduce((s, t) => s + (Number(oldProp[t]) || 0), 0);
      if (oldSum > 0) {
        setGrades((gs) => gs.map((g) => {
          const total = g.grade_total || 0;
          if (total <= 0) return g;
          const unit = total / oldSum;
          const next: Record<string, number> = {};
          tamanhos.forEach((t) => { next[t] = Math.round(unit * (Number(newProp[t]) || 0)); });
          const gt = tamanhos.reduce((s, t) => s + (next[t] || 0), 0);
          return { ...g, grades: next, grade_total: gt };
        }));
      }
    }
  };

  // Ligar o "cálculo automático" REDISTRIBUI a grade de cada variante pela proporção atual na hora
  // (mantendo o grade_total) — antes só distribuía ao re-digitar a grade total. Ex.: após "Aplicar ao
  // modelo" trazer nova proporção + grade total, ligar o auto recalcula quantos vão em cada tamanho.
  const toggleGradeAuto = (v: boolean) => {
    setGradeAuto(v);
    if (!v) return;
    const props = (draft?.proporcoes ?? {}) as Record<string, number>;
    const sum = tamanhos.reduce((s, t) => s + (Number(props[t]) || 0), 0);
    if (sum <= 0) return;
    setGradeAlterada(true);
    setGrades((gs) => gs.map((g) => {
      const total = g.grade_total || 0;
      if (total <= 0) return g;
      const next: Record<string, number> = {};
      tamanhos.forEach((t) => { next[t] = Math.round(((Number(props[t]) || 0) / sum) * total); });
      const rounded = tamanhos.reduce((s, t) => s + (next[t] || 0), 0);
      const diff = total - rounded;
      if (diff !== 0) {
        let maxTam = tamanhos[0]; let maxProp = -Infinity;
        tamanhos.forEach((t) => { const p = Number(props[t]) || 0; if (p > maxProp) { maxProp = p; maxTam = t; } });
        next[maxTam] = Math.max(0, (next[maxTam] || 0) + diff);
      }
      return { ...g, grades: next, grade_total: total };
    }));
  };

  const uploadFicha = async (file: File) => {
    setUploading(true);
    try {
      const { tenantPrefix, sanitizeStorageName } = await import("@/lib/storage-tenant");
      const tenant = await tenantPrefix();
      const path = `${tenant}/fichas/${modeloId}/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (error) throw error;
      setDraft((d: any) => ({ ...d, ficha_medida_url: path }));
      toast.success("Ficha enviada");
    } catch (e: any) {
      toast.error(mensagemErro(e));
    } finally {
      setUploading(false);
    }
  };

  const uploadDesenho = async (file: File) => {
    setUploading(true);
    try {
      const { tenantPrefix, sanitizeStorageName } = await import("@/lib/storage-tenant");
      const tenant = await tenantPrefix();
      const path = `${tenant}/desenhos/${modeloId}/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (error) throw error;
      setDraft((d: any) => ({ ...d, desenho_tecnico_url: path }));
      toast.success("Desenho técnico enviado");
    } catch (e: any) {
      toast.error(mensagemErro(e));
    } finally {
      setUploading(false);
    }
  };

  const uploadCroqui = async (file: File) => {
    setUploading(true);
    try {
      const { tenantPrefix, sanitizeStorageName } = await import("@/lib/storage-tenant");
      const tenant = await tenantPrefix();
      const path = `${tenant}/croqui/${modeloId}/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (error) throw error;
      setDraft((d: any) => ({ ...d, croqui_url: path }));
      toast.success("Croqui enviado");
    } catch (e: any) {
      toast.error(mensagemErro(e));
    } finally {
      setUploading(false);
    }
  };

  if (loadingModelo || !draft) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Trava removida: o card é sempre editável; salvar sincroniza o cad_*.
  // (decisão do dono: "card sempre edita→salva")
  return (
    <>
      <SheetHeader>
        <Breadcrumb
          items={[
            { label: "Estilo & Engenharia" },
            { label: "Desenvolvimento" },
            { label: draft.nome || (modelo as any)?.nome || "Modelo" },
          ]}
        />
        <div className="flex items-center justify-between gap-2">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <span>{draft.nome || "Modelo"}</span>
            <VersaoBadge versao={(modelo as any)?.versao} />
          </SheetTitle>
          <div className="flex items-center gap-2 shrink-0">
            <UnsavedIndicator show={dirty} className="shrink-0" />
            {!locked && (
              <Button variant="outline" size="sm" className="shrink-0 max-sm:h-11 max-sm:w-11 max-sm:px-0" onClick={() => setImportOpen(true)}>
                <Download className="h-4 w-4 sm:mr-2" /> <span className="max-sm:sr-only">Importar dados</span>
              </Button>
            )}
          </div>
        </div>
      </SheetHeader>

      {/* área rolável (flex-1) — o footer fica fixo embaixo como irmão shrink-0 */}
      <div className="mt-4 flex-1 min-h-0 overflow-y-auto">
        {/* Status no fluxo — barra persistente acima do accordion (mockup); porteia o kanban. */}
        <fieldset disabled={locked} className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status no fluxo</span>
          <Select
            value={statusCur}
            onValueChange={(v) => {
              // Motor de regras: só muda de status se os requisitos (estado SALVO) batem.
              if (v !== statusCur) {
                const chk = podeEntrarStatus(v);
                if (!chk.ok) { toast.error(`Salve as pendências primeiro. Faltam: ${chk.faltando.map((c) => c.label).join(", ")}`); return; }
              }
              setDraft({ ...draft, status_desenvolvimento: v });
            }}
          >
            <SelectTrigger className="h-9 w-full max-w-[240px] bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              {statusRenderList.map((s) => {
                // Destino bloqueado: mostra o que falta e esmaece, mas segue clicável (toast explica).
                const chk = s.value !== statusCur ? podeEntrarStatus(s.value) : undefined;
                const faltando = chk && !chk.ok ? chk.faltando : [];
                return (
                  <SelectItem key={s.value} value={s.value} className={faltando.length ? "text-muted-foreground" : ""}>
                    {s.label}
                    {faltando.length > 0 && <span className="text-xs opacity-70"> · falta {faltando.map((c) => c.label).join(", ")}</span>}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </fieldset>
        <Accordion type="multiple" value={accOpen} onValueChange={setAccOpen}>
          <AccordionItem value="s1" data-acc="s1">
            <AccordionTrigger>
              <span className="flex flex-1 items-center gap-2 pr-2">
                <span>{secNum("s1")}. Informações Básicas</span>
                {infoCompleta
                  ? <SecBadge tone="ok"><Check className="h-3 w-3" />completa</SecBadge>
                  : <SecBadge tone="muted">faltam dados</SecBadge>}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <fieldset disabled={locked} className="contents">
              <ModeloInfoSection
                draft={draft}
                setDraft={setDraft}
                linhas={linhas.data ?? []}
                estilistas={estilistas.data ?? []}
                modelistas={modelistas.data ?? []}
                piloteiros={piloteiros.data ?? []}
                categorias={categorias.data ?? []}
                grupos={grupos.data ?? []}
                meses={meses.data ?? []}
                anos={anos.data ?? []}
                sub1Opts={sub1Opts.data ?? []}
                sub2Opts={sub2Opts.data ?? []}
                isAprovado={isAprovado}
                isReprovado={isReprovado}
                statusOptions={statusOptions}
                podeEntrarStatus={podeEntrarStatus}
                otbOn={otbOn}
                colecoes={colecoes}
                subcolecoes={subcolecoesOpts}
                camposCopiados={camposCopiados}
                onCampoEditado={onCampoEditado}
              />
              </fieldset>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="prova" data-acc="prova">
            <AccordionTrigger>
              <span className="flex flex-1 items-center gap-2 pr-2">
                <span>{secNum("prova")}. Ajustes na Prova</span>
                {provaAbertos > 0
                  ? <SecBadge tone="info">{provaAbertos} aberto{provaAbertos > 1 ? "s" : ""}</SecBadge>
                  : <SecBadge tone="muted">sem ajustes</SecBadge>}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <fieldset disabled={locked} className="contents">
              <ModeloAjustesProvaSection modeloId={modeloId} />
              </fieldset>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s2" data-acc="s2">
            <AccordionTrigger>
              <span className="flex flex-1 items-center gap-2 pr-2">
                <span>{secNum("s2")}. Tecidos / Forros / Entretelas</span>
                {nTecidos === 0
                  ? <SecBadge tone="muted">vazio</SecBadge>
                  : !todosBlocosComArtigoTemVariante
                  ? <SecBadge tone="warn"><AlertTriangle className="h-3 w-3" />falta variante</SecBadge>
                  : <SecBadge tone="ok"><Check className="h-3 w-3" />{nTecidos} tecido{nTecidos > 1 ? "s" : ""}</SecBadge>}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <fieldset disabled={locked} className="contents">
              <ModeloTecidosSection
                modeloId={modeloId}
                blocks={blocks}
                artigos={artigos}
                artigosForro={artigosForro}
                artigosEntretela={artigosEntretela}
                grades={grades}
                onChangeBlock={updateBlock}
                onChangeVariante={updateBlockVariante}
                onChangeOcLinks={updateBlockOcLinks}
                camposCopiados={camposCopiados}
                onCampoEditado={onCampoEditado}
              />
              </fieldset>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s-cad" data-acc="s-cad">
            <AccordionTrigger>
              <span className="flex flex-1 items-center gap-2 pr-2">
                <span>{secNum("s-cad")}. CAD</span>
                {cadTecidosState.length === 0
                  ? <SecBadge tone="muted">vazio</SecBadge>
                  : <SecBadge tone="ok"><Check className="h-3 w-3" />ok</SecBadge>}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <fieldset disabled={locked} className="contents">
              {cadTecidosState.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  Nenhum tecido/variante planejado neste modelo. Adicione tecidos na seção 3.
                </p>
              ) : (
                <CadTecidosSection
                  tecidos={cadTecidosState}
                  updateTec={updateCadTec}
                  updateVar={updateCadVar}
                  autoFolhas={autoFolhas}
                  onToggleAutoFolhas={setAutoFolhas}
                  hideSeparar
                />
              )}
              </fieldset>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s3" data-acc="s3">
            <AccordionTrigger>
              <span className="flex flex-1 items-center gap-2 pr-2">
                <span>{secNum("s3")}. Aviamentos</span>
                {nAviamentos > 0
                  ? <SecBadge tone="ok"><Check className="h-3 w-3" />{nAviamentos}</SecBadge>
                  : <SecBadge tone="muted">vazio</SecBadge>}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <fieldset disabled={locked} className="contents">
              <ModeloAviamentosSection
                rows={aviamentosState}
                aviamentos={aviamentos}
                onChangeRow={updateAviamento}
                onAdd={addAviamento}
                onRemove={removeAviamento}
                camposCopiados={camposCopiados}
                onCampoEditado={onCampoEditado}
              />
              </fieldset>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s3e" data-acc="s3e">
            <AccordionTrigger>
              <span className="flex flex-1 items-center gap-2 pr-2">
                <span>{secNum("s3e")}. Insumos</span>
                {nInsumos > 0
                  ? <SecBadge tone="ok"><Check className="h-3 w-3" />{nInsumos}</SecBadge>
                  : <SecBadge tone="muted">vazio</SecBadge>}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <fieldset disabled={locked} className="contents">
              <ModeloEtiquetasSection
                rows={etiquetasState}
                etiquetas={etiquetaOpts}
                etiquetaMap={etiquetaMap}
                onChangeRow={updateEtiqueta}
                onAdd={addEtiqueta}
                onRemove={removeEtiqueta}
                camposCopiados={camposCopiados}
                onCampoEditado={onCampoEditado}
              />
              </fieldset>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s4" data-acc="s4">
            <AccordionTrigger>
              <span className="flex flex-1 items-center gap-2 pr-2">
                <span>{secNum("s4")}. Grade</span>
                {gradeTotalGeral > 0
                  ? <SecBadge tone="ok"><Check className="h-3 w-3" />preenchida</SecBadge>
                  : <SecBadge tone="warn"><AlertTriangle className="h-3 w-3" />falta preencher</SecBadge>}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <fieldset disabled={locked} className="contents">
              <ModeloGradeSection
                tamanhos={tamanhos}
                proporcoes={draft.proporcoes ?? {}}
                onChangeProporcao={updateProporcao}
                grades={grades}
                onChangeGradeTotal={updateGradeTotal}
                onChangeGradeCell={updateGradeCell}
                tecido1Variantes={tecido1VariantesInfo}
                gradeAuto={gradeAuto}
                onToggleGradeAuto={toggleGradeAuto}
                camposCopiados={camposCopiados}
                onCampoEditado={onCampoEditado}
              />
              </fieldset>
            </AccordionContent>
          </AccordionItem>

          {podeVerCustos && (
          <AccordionItem value="s5" data-acc="s5">
            <AccordionTrigger>
              <span className="flex flex-1 items-center gap-2 pr-2">
                <span>{secNum("s5")}. Custos</span>
                <SecBadge tone="muted">{custoLbl}</SecBadge>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <fieldset disabled={locked} className="contents space-y-3">
              <ModeloCustosSection
                totals={totals}
                custoTerceirizados={draft.custo_terceirizados_previsto}
                onChangeTerceirizados={(v) => setDraft({ ...draft, custo_terceirizados_previsto: v })}
                maoObraAprovado={(modelo as any)?.custo_terceirizados_aprovado ?? null}
                custosAdicionais={draft.custos_adicionais ?? []}
                onChangeCustos={(v) => setDraft({ ...draft, custos_adicionais: v })}
                camposCopiados={camposCopiados}
                onCampoEditado={onCampoEditado}
              />
              {/* Observação de mão de obra — mesma seção, BLOCO separado dos custos. */}
              <Card className="p-4">
                <ObsMaoObraField
                  label="Obs. Mão de Obra"
                  value={draft.observacoes_mao_obra ?? ""}
                  onChange={(v) => setDraft({ ...draft, observacoes_mao_obra: v })}
                />
              </Card>
              </fieldset>
            </AccordionContent>
          </AccordionItem>
          )}

          <AccordionItem value="s6" data-acc="s6">
            <AccordionTrigger>
              <span className="flex flex-1 items-center gap-2 pr-2">
                <span>{secNum("s6")}. Anexos</span>
                {temAnexo
                  ? <SecBadge tone="ok"><Check className="h-3 w-3" />{temCroqui ? "croqui" : "anexos"}</SecBadge>
                  : <SecBadge tone="muted">vazio</SecBadge>}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <fieldset disabled={locked} className="contents">
              <ModeloAnexosSection
                fichaMedidaUrl={draft.ficha_medida_url}
                desenhoTecnicoUrl={draft.desenho_tecnico_url}
                croquiUrl={draft.croqui_url}
                uploading={uploading}
                onUploadFicha={uploadFicha}
                onUploadDesenho={uploadDesenho}
                onUploadCroqui={uploadCroqui}
                onRemoveFicha={() => setDraft({ ...draft, ficha_medida_url: "" })}
                onRemoveDesenho={() => setDraft({ ...draft, desenho_tecnico_url: "" })}
                onRemoveCroqui={() => setDraft({ ...draft, croqui_url: "" })}
                observacoesGerais={draft.observacoes_gerais}
                onChangeObservacoes={(v) => setDraft({ ...draft, observacoes_gerais: v })}
                fotosModelo={draft.fotos_modelo ?? []}
                fotosReferencia={draft.fotos_referencia ?? []}
                onChangeFotosModelo={(p) => setDraft({ ...draft, fotos_modelo: p })}
                onChangeFotosReferencia={(p) => setDraft({ ...draft, fotos_referencia: p })}
              />
              </fieldset>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <fieldset disabled={locked} className="contents">
          <div className="mt-4">
            <ModeloObservacoes modeloId={modeloId} />
          </div>
        </fieldset>

        {/* Pendências p/ enviar — VISÍVEL no mobile (no desktop ficam no rodapé). Cada uma
            é um link que abre a seção onde se resolve. */}
        {isAprovado && cadMissing.length > 0 && (
          <p className="sm:hidden mt-4 text-xs text-amber-700 dark:text-amber-300">
            Para enviar, falta:{" "}
            {cadMissing.map((m, i) => (
              <span key={i}>
                {i > 0 && " · "}
                <button type="button" className="font-medium underline underline-offset-2" onClick={() => irParaSecao(m.sec)}>{m.label}</button>
              </span>
            ))}
          </p>
        )}
      </div>

      <div className="bg-background border-t pt-3 mt-3 shrink-0 flex flex-wrap gap-2 items-center max-sm:flex-nowrap">
        {/* Voltar: ESQUERDA — ícone no mobile, texto no desktop. */}
        <Button variant="outline" onClick={onClose} aria-label="Voltar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
          <ArrowLeft className="h-4 w-4 mr-1 max-sm:mr-0" />
          <span className="max-sm:sr-only">Voltar</span>
        </Button>
        {/* Grupo direito: ml-auto empurra para a direita. */}
        {isAprovado && cadMissing.length > 0 && (
          <span className="text-xs text-muted-foreground ml-auto max-sm:hidden">
            Para enviar, falta:{" "}
            {cadMissing.map((m, i) => (
              <span key={i}>
                {i > 0 && ", "}
                <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => irParaSecao(m.sec)}>{m.label}</button>
              </span>
            ))}
          </span>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={!(isAprovado && cadMissing.length > 0) ? "ml-auto" : "max-sm:ml-auto"}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!draft.enviado_cad}
                  onClick={() => setPrintTecnicaToken((t) => t + 1)}
                  aria-label="Imprimir Ficha Técnica"
                >
                  <Printer className="h-4 w-4 mr-1" />
                  <span className="max-sm:hidden">Ficha Técnica</span>
                </Button>
              </span>
            </TooltipTrigger>
            {!draft.enviado_cad && (
              <TooltipContent>Disponível após Enviar</TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
        {canEnviarCad && (
          <Button variant="secondary" onClick={() => setConfirmEnviarCad(true)} disabled={enviarCad.isPending}>
            {enviarCad.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Send className="h-4 w-4 mr-2" /> Enviar
          </Button>
        )}
        {locked ? (
          <Button variant="secondary" size="icon" onClick={() => setEditing(true)} aria-label="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
          </Button>
        )}
      </div>

      <AlertDialog open={confirmEnviarCad} onOpenChange={setConfirmEnviarCad}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Enviar modelo para a Explosão?</AlertDialogTitle>
            <AlertDialogDescription>
              O modelo vai para a Explosão (próxima etapa) com os tecidos, variantes e
              grade atuais. Na Explosão você define a quantidade a enviar e autoriza a baixa
              do estoque. Você pode reenviar sempre que precisar atualizar os dados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não, quero fazer uma revisão antes</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmEnviarCad(false); enviarCad.mutate(); }}>
              Sim, enviar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmGrade} onOpenChange={(o) => { if (!o) setConfirmGrade(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar grade preenchida?</AlertDialogTitle>
            <AlertDialogDescription>{confirmGrade?.msg}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { confirmGrade?.onConfirm(); setConfirmGrade(null); }}
            >
              Continuar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportarDadosDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        modeloDestinoId={modeloId}
        destinoBlocks={blocks}
        onCopiar={(r, origem, sel) => onCopiar(r, origem, sel)}
      />
      <AlertDialog open={!!confirmSobrescrita} onOpenChange={(o) => !o && setConfirmSobrescrita(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sobrescrever dados existentes?</AlertDialogTitle>
            <AlertDialogDescription>
              A importação vai substituir: {confirmSobrescrita?.itens.join(" · ")}. Os campos entram para revisão (só o Salvar grava); as Observações (bloco), se marcadas, são aplicadas na hora.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmSobrescrita?.aplicar()}>Substituir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Ficha oculta — FichaTecnica já usa PrintArea (portal no body).
          Montar direto (SEM wrapper .print-area), igual à tela de CAD (producao.cad.index). */}
      {draft.enviado_cad && (
        <PrintFicha modeloId={modeloId} kind="tecnica" token={printTecnicaToken} />
      )}
    </>
  );
}

function useOpts(table: string) {
  return useQuery({
    queryKey: ["opt", table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select("id, nome").order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as Opt[];
    },
  });
}
function useSubOpts(table: "subcategorias1_produto" | "subcategorias2_produto") {
  return useQuery({
    queryKey: ["opt", table],
    queryFn: async () => {
      const { data, error } = await supabase.from(table).select("id, nome, categoria_id").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; categoria_id: string | null }[];
    },
  });
}
function useColabs(tipo: string) {
  return useQuery({
    queryKey: ["colab", tipo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("colaboradores").select("id, nome").eq("tipo", tipo).order("nome");
      if (error) throw error;
      return (data ?? []) as Opt[];
    },
  });
}
