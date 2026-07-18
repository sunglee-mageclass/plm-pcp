import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { labelVarianteRow } from "@/lib/variante";
import { somaCustosAdicionais } from "@/lib/custo";
import { Loader2, Printer, Send, ArrowLeft } from "lucide-react";
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
import { Button } from "@/components/ui/button";
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
import { ModeloAnexosSection } from "./modelo-detail/ModeloAnexosSection";
import { useEtapasAfetadas, DownstreamConfirmDialog, DesmarcarEtapasDialog } from "./DownstreamImpactAlert";
import { ModeloObservacoes } from "@/components/shared/ModeloObservacoes";
import { VersaoBadge } from "@/components/shared/VersaoBadge";

export function ModeloDetailPanel({ modeloId, onClose }: {
  modeloId: string | null;
  onClose: () => void;
}) {
  const open = !!modeloId;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:w-[70vw] sm:max-w-[70vw] flex flex-col max-sm:[&>button]:hidden">
        {modeloId && <PanelContent modeloId={modeloId} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function PanelContent({ modeloId, onClose }: { modeloId: string; onClose: () => void }) {
  const qc = useQueryClient();
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
  const categorias = useOpts("categorias_produto");
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
  const { data: etiquetasList = [] } = useQuery({
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

  const { data: cadAviamentosDev = [] } = useQuery({
    queryKey: ["dev-cad-aviamentos", cadRowDev?.id],
    enabled: !!cadRowDev?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("cad_aviamentos")
        .select("*, aviamentos:aviamento_id(codigo_nome, preco)")
        .eq("cad_id", cadRowDev!.id)
        .order("numero");
      return (data ?? []) as any[];
    },
  });

  const { data: cadEtiquetasDev = [] } = useQuery({
    queryKey: ["dev-cad-etiquetas", cadRowDev?.id],
    enabled: !!cadRowDev?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("cad_etiquetas")
        .select("id, etiqueta_id, cor_id, consumo, quantidade_planejada, quantidade_enviar, enviar_por_tamanho, etiquetas:etiqueta_id(nome, tamanho)")
        .eq("cad_id", cadRowDev!.id);
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
  // Confirmação (AlertDialog) antes de descartar grade preenchida ao trocar/remover
  // o Tecido 1. Guarda a ação adiada até o usuário confirmar.
  const [confirmGrade, setConfirmGrade] = useState<{ msg: string; onConfirm: () => void } | null>(null);
  // Trava por SEGURANÇA após enviar ao CAD: só edita ao clicar "Editar", e o
  // Salvar volta a travar. Reseta ao abrir outro modelo.
  const [confirmEditOpen, setConfirmEditOpen] = useState(false);
  const [desmarcarOpen, setDesmarcarOpen] = useState(false);
  const { hasDownstream } = useEtapasAfetadas(modeloId);
  // Rastreio p/ o alerta inteligente (o que mudou → impacto específico).
  const [gradeAlterada, setGradeAlterada] = useState(false);
  const [consumoAlterado, setConsumoAlterado] = useState(false);
  const [aviamentoAlterado, setAviamentoAlterado] = useState(false);
  useEffect(() => { setCadSeeded(false); setCadTecidosState([]); setAutoFolhas(false); }, [modeloId]);
  // Grade automática: ao digitar uma célula, escala as demais pela proporção.
  const [gradeAuto, setGradeAuto] = useState(false);

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
  const cadMissing: string[] = [];
  if (isAprovado) {
    if ((draft?.ref ?? "").trim() === "") cadMissing.push(fl("ref"));
    if ((draft?.nome ?? "").trim() === "") cadMissing.push("Nome");
    if (!(modelo as any)?.estilista_id) cadMissing.push("Estilista");
    if (!draft?.categoria_principal_id) cadMissing.push("Categoria");
    if (!hasTecidoComVariante) cadMissing.push("ao menos 1 tecido com variante");
    else if (!todosBlocosComArtigoTemVariante) cadMissing.push("1 variante em cada tecido/forro/entretela selecionado");
    if (gradeTotalGeral <= 0) cadMissing.push("grade preenchida");
    if ((draft?.data_desenho_tecnico ?? "").trim() === "") cadMissing.push("Data Desenho Técnico");
    if ((draft?.data_piloto1 ?? "").trim() === "") cadMissing.push("Data Piloto 1");
    if (piloto2Aberto && (draft?.data_piloto2 ?? "").trim() === "") cadMissing.push("Data Piloto 2");
    if (piloto3Aberto && (draft?.data_piloto3 ?? "").trim() === "") cadMissing.push("Data Piloto 3");
  }
  // Enviar é sempre visível quando aprovado e sem itens faltando (idempotente: reenviar é ok).
  const canEnviarCad = isAprovado && cadMissing.length === 0;

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
        ficha_medida_url: draft.ficha_medida_url || null,
        desenho_tecnico_url: draft.desenho_tecnico_url || null,
        croqui_url: draft.croqui_url || null,
        categoria_principal_id: draft.categoria_principal_id || null,
        subcategoria1_id: draft.subcategoria1_id || null,
        subcategoria2_id: draft.subcategoria2_id || null,
        colecao_id: draft.colecao_id || null,
        subcolecao: draft.subcolecao || null,
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
        // Monta o payload de aviamentos a partir do estado do CAD (se tiver dados do cad_*)
        // ou do modelo (fallback) — prioriza o que está no cad_* para não perder edições.
        const cadAviamentosPayload = (cadAviamentosDev as any[]).length > 0
          ? (cadAviamentosDev as any[]).map((a: any) => ({
              aviamento_id: a.aviamento_id,
              numero: a.numero,
              consumo: Number(a.consumo ?? 0),
              quantidade_enviar: Number(a.quantidade_enviar ?? 0),
              quantidade_separar: Number(a.quantidade_separar ?? 0),
            }))
          : aviamentosPayload.map((a, i) => ({
              aviamento_id: a.aviamento_id,
              numero: i + 1,
              consumo: a.consumo || 0,
              quantidade_enviar: 0,
              quantidade_separar: 0,
            }));
        // Etiquetas: usa o que está no cad_* ou vazio.
        const cadEtiquetasPayload = (cadEtiquetasDev as any[]).map((e: any) => ({
          etiqueta_id: e.etiqueta_id,
          cor_id: e.cor_id ?? null,
          consumo: Number(e.consumo ?? 0),
          quantidade_planejada: Number(e.quantidade_planejada ?? 0),
          quantidade_enviar: Number(e.quantidade_enviar ?? 0),
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
    onSuccess: () => {
      toast.success("Modelo salvo");
      // Marca revisão pendente (#Erro) nas etapas afetadas — calculado no servidor.
      supabase.rpc("marcar_revisao_por_mudanca" as any, {
        _modelo_id: modeloId, _grade: gradeAlterada, _consumo: consumoAlterado, _aviamentos: aviamentoAlterado,
      }).then(() => {
        ["producao-terc-list", "producao-cq-list", "dir-list"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      });
      setGradeAlterada(false); setConsumoAlterado(false); setAviamentoAlterado(false);
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
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
  });

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
      toast.success("Enviado para o CAD");
      setDraft((d: any) => ({ ...d, enviado_cad: true }));
      qc.invalidateQueries({ queryKey: ["modelo-detail", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-condicoes-kanban", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-cad-calc", modeloId] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao enviar para CAD")),
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
        <SheetTitle className="flex flex-wrap items-center gap-2">
          <span>{draft.nome || "Modelo"}</span>
          <VersaoBadge versao={(modelo as any)?.versao} />
        </SheetTitle>
      </SheetHeader>

      <DownstreamConfirmDialog
        modeloId={modeloId}
        open={confirmEditOpen}
        onOpenChange={setConfirmEditOpen}
        onConfirm={() => { setConfirmEditOpen(false); save.mutate(); }}
        onDesmarcar={() => { setConfirmEditOpen(false); setDesmarcarOpen(true); }}
        changes={{ grade: gradeAlterada, consumo: consumoAlterado, aviamentos: aviamentoAlterado }}
      />
      <DesmarcarEtapasDialog
        modeloId={modeloId}
        open={desmarcarOpen}
        onOpenChange={setDesmarcarOpen}
        onSave={() => { setDesmarcarOpen(false); save.mutate(); }}
      />

      {/* área rolável (flex-1) — o footer fica fixo embaixo como irmão shrink-0 */}
      <div className="mt-4 flex-1 min-h-0 overflow-y-auto">
        <Accordion type="multiple" defaultValue={["s1"]}>
          <AccordionItem value="s1">
            <AccordionTrigger>1. Informações Básicas</AccordionTrigger>
            <AccordionContent>
              <ModeloInfoSection
                draft={draft}
                setDraft={setDraft}
                linhas={linhas.data ?? []}
                estilistas={estilistas.data ?? []}
                modelistas={modelistas.data ?? []}
                piloteiros={piloteiros.data ?? []}
                categorias={categorias.data ?? []}
                sub1Opts={sub1Opts.data ?? []}
                sub2Opts={sub2Opts.data ?? []}
                isAprovado={isAprovado}
                isReprovado={isReprovado}
                statusOptions={statusOptions}
                podeEntrarStatus={podeEntrarStatus}
                otbOn={otbOn}
                colecoes={colecoes}
                subcolecoes={subcolecoesOpts}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="prova">
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                2. Ajustes na Prova
                {provaAbertos > 0 && (
                  <span
                    className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground"
                    title={`${provaAbertos} ajuste(s) em aberto`}
                  >
                    {provaAbertos}
                  </span>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <ModeloAjustesProvaSection modeloId={modeloId} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s2">
            <AccordionTrigger>3. Tecidos / Forros / Entretelas</AccordionTrigger>
            <AccordionContent>
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
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s-cad">
            <AccordionTrigger>4. CAD</AccordionTrigger>
            <AccordionContent>
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
                />
              )}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s3">
            <AccordionTrigger>5. Aviamentos</AccordionTrigger>
            <AccordionContent>
              <ModeloAviamentosSection
                rows={aviamentosState}
                aviamentos={aviamentos}
                onChangeRow={updateAviamento}
                onAdd={addAviamento}
                onRemove={removeAviamento}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s3e">
            <AccordionTrigger>6. Insumos</AccordionTrigger>
            <AccordionContent>
              <ModeloEtiquetasSection
                rows={etiquetasState}
                etiquetas={etiquetaOpts}
                etiquetaMap={etiquetaMap}
                onChangeRow={updateEtiqueta}
                onAdd={addEtiqueta}
                onRemove={removeEtiqueta}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s4">
            <AccordionTrigger>7. Grade</AccordionTrigger>
            <AccordionContent>
              <ModeloGradeSection
                tamanhos={tamanhos}
                proporcoes={draft.proporcoes ?? {}}
                onChangeProporcao={updateProporcao}
                grades={grades}
                onChangeGradeTotal={updateGradeTotal}
                onChangeGradeCell={updateGradeCell}
                tecido1Variantes={tecido1VariantesInfo}
                gradeAuto={gradeAuto}
                onToggleGradeAuto={setGradeAuto}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s5">
            <AccordionTrigger>8. Custos</AccordionTrigger>
            <AccordionContent>
              <ModeloCustosSection
                totals={totals}
                custoTerceirizados={draft.custo_terceirizados_previsto}
                onChangeTerceirizados={(v) => setDraft({ ...draft, custo_terceirizados_previsto: v })}
                custosAdicionais={draft.custos_adicionais ?? []}
                onChangeCustos={(v) => setDraft({ ...draft, custos_adicionais: v })}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s6">
            <AccordionTrigger>9. Anexos</AccordionTrigger>
            <AccordionContent>
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
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="mt-4">
          <ModeloObservacoes modeloId={modeloId} />
        </div>
      </div>

      <div className="bg-background border-t pt-3 mt-3 shrink-0 flex flex-wrap gap-2 justify-end items-center max-sm:flex-nowrap">
        {isAprovado && cadMissing.length > 0 && (
          <span className="text-xs text-muted-foreground mr-auto max-sm:hidden">
            Para enviar, falta: {cadMissing.join(", ")}
          </span>
        )}
        <Button variant="outline" onClick={onClose} aria-label="Voltar" className="shrink-0 max-sm:order-first max-sm:mr-auto max-sm:aspect-square max-sm:px-0">
          <ArrowLeft className="h-4 w-4 sm:hidden" />
          <span className="max-sm:sr-only">Fechar</span>
        </Button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
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
        <Button onClick={() => (hasDownstream ? setConfirmEditOpen(true) : save.mutate())} disabled={save.isPending}>
          {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
        </Button>
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
