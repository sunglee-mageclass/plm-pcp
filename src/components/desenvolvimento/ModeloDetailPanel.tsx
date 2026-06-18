import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { useFieldLabels } from "@/hooks/useFieldLabels";

import {
  BUCKET,
  makeEmptyBlocks,
  recomputeAviamento,
  recomputeBlock,
  type AviamentoRow,
  type GradeRow,
  type OcAlloc,
  type Opt,
  type TecidoBlock,
} from "./modelo-detail/types";
import { ModeloInfoSection } from "./modelo-detail/ModeloInfoSection";
import { ModeloTecidosSection } from "./modelo-detail/ModeloTecidosSection";
import { ModeloAviamentosSection } from "./modelo-detail/ModeloAviamentosSection";
import { ModeloGradeSection } from "./modelo-detail/ModeloGradeSection";
import { ModeloCustosSection } from "./modelo-detail/ModeloCustosSection";
import { ModeloAnexosSection } from "./modelo-detail/ModeloAnexosSection";
import { ModeloObservacoes } from "@/components/shared/ModeloObservacoes";

export function ModeloDetailPanel({ modeloId, onClose }: {
  modeloId: string | null;
  onClose: () => void;
}) {
  const open = !!modeloId;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:w-[70vw] sm:max-w-[70vw] overflow-y-auto">
        {modeloId && <PanelContent modeloId={modeloId} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function PanelContent({ modeloId, onClose }: { modeloId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const fl = useFieldLabels();

  const linhas = useOpts("linhas");
  const modelistas = useColabs("modelista");
  const piloteiros = useColabs("piloteiro");

  const { data: tenantCfg } = useQuery({
    queryKey: ["tenant-config-grade"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_config").select("tamanhos_grade, status_kanban").maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const DEFAULT_KANBAN_STATUS: { value: string; label: string }[] = [
    { value: "em_modelagem", label: "Em Modelagem" },
    { value: "corte_piloto_1", label: "Corte de Piloto I" },
    { value: "corte_piloto_2", label: "Corte de Piloto II" },
    { value: "corte_piloto_3", label: "Corte de Piloto III" },
    { value: "em_pilotagem", label: "Em Pilotagem" },
    { value: "prova_roupa_1", label: "Prova de Roupa I" },
    { value: "prova_roupa_2", label: "Prova de Roupa II" },
    { value: "prova_roupa_3", label: "Prova de Roupa III" },
    { value: "prova_roupa_4", label: "Prova de Roupa IV" },
    { value: "prova_roupa_5", label: "Prova de Roupa V" },
    { value: "em_ajuste", label: "Em Ajuste" },
    { value: "stand_by", label: "Stand By" },
    { value: "reprovado", label: "Reprovado" },
    { value: "aprovado", label: "Aprovado" },
  ];
  const statusOptions = useMemo(() => {
    const raw = (tenantCfg as any)?.status_kanban;
    if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_KANBAN_STATUS;
    return raw.map((s: any, i: number) => {
      if (typeof s === "string") return { value: s, label: s };
      const key = s?.key ?? s?.id ?? s?.value ?? s?.slug ?? `s${i}`;
      const label = s?.label ?? s?.nome ?? s?.name ?? String(key);
      return { value: String(key), label: String(label) };
    });
  }, [tenantCfg]);
  const lastStatusKeys = useMemo(() => {
    if (statusOptions.length === 0) return ["aprovado"];
    const last = statusOptions[statusOptions.length - 1];
    return [last.value.toLowerCase(), last.label.toLowerCase()];
  }, [statusOptions]);
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
        .from("artigos").select("id, nome, preco, preco_por_metro, unidade_medida, categoria_tecido_id").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; preco: number | null; preco_por_metro: number | null; unidade_medida: string | null; categoria_tecido_id: string | null }[];
    },
  });
  const artigoMap = useMemo(() => Object.fromEntries(artigos.map((a) => [a.id, a])), [artigos]);

  const { data: categoriasTecido = [] } = useQuery({
    queryKey: ["cat-tecido-options"],
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aviamentos").select("id, codigo_nome, preco").order("codigo_nome");
      if (error) throw error;
      return (data ?? []) as { id: string; codigo_nome: string; preco: number | null }[];
    },
  });
  const aviamentoMap = useMemo(() => Object.fromEntries(aviamentos.map((a) => [a.id, a])), [aviamentos]);

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

  const [draft, setDraft] = useState<any | null>(null);
  const [blocks, setBlocks] = useState<TecidoBlock[]>(makeEmptyBlocks());
  const [aviamentosState, setAviamentosState] = useState<AviamentoRow[]>([]);
  const [grades, setGrades] = useState<GradeRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [confirmEnviarCad, setConfirmEnviarCad] = useState(false);
  // Grade automática: ao digitar uma célula, escala as demais pela proporção.
  const [gradeAuto, setGradeAuto] = useState(false);

  // Tecidos planejados (Planejamento) = pool de substitutos do tecido no
  // Desenvolvimento: as variantes de qualquer um deles podem ser usadas.
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
        custo_terceirizados_previsto: Number(modelo.custo_terceirizados_previsto ?? 0),
        proporcoes: (modelo.proporcoes ?? {}) as Record<string, number>,
        enviado_cad: !!modelo.enviado_cad,
        fotos_modelo: (modelo.fotos_modelo ?? []) as string[],
        fotos_referencia: (modelo.fotos_referencia ?? []) as string[],
      });
    }
  }, [modelo]);

  useEffect(() => {
    if (!tecidosData || !modelo) return;
    const empty = makeEmptyBlocks();
    const planejados: string[] = Array.isArray((modelo as any).tecidos_planejados)
      ? ((modelo as any).tecidos_planejados as string[])
      : [];
    const planejadosSet = new Set(planejados);
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
        // das variantes salvas. No tecido, os planejados já entram no pool, então
        // só viram "extra" os artigos manualmente adicionados (fora dos planejados).
        const artigoIdsExtra =
          t.tipo === "tecido"
            ? Array.from(varArtigos).filter((aid) => aid && aid !== t.artigo_id && !planejadosSet.has(aid))
            : t.tipo === "forro"
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
    if (!gradesData) { setGrades([]); return; }
    const rows: GradeRow[] = gradesData.map((g: any) => ({
      variante_numero: g.variante_numero,
      grades: (g.grades ?? {}) as Record<string, number>,
      grade_total: g.grade_total ?? 0,
    }));
    setGrades(rows);
  }, [gradesData]);

  const totals = useMemo(() => {
    const sum = (tipo: TecidoBlock["tipo"]) =>
      blocks.filter((b) => b.tipo === tipo).reduce((s, b) => s + (b.custo_previsto || 0), 0);
    const tecido = sum("tecido");
    const forro = sum("forro");
    const entretela = sum("entretela");
    const aviamento = aviamentosState.reduce((s, r) => s + (r.custo_previsto || 0), 0);
    const terceirizados = draft?.custo_terceirizados_previsto ?? 0;
    const peca = tecido + forro + entretela + aviamento + terceirizados;
    return { tecido, forro, entretela, aviamento, terceirizados, peca };
  }, [blocks, aviamentosState, draft?.custo_terceirizados_previsto]);

  const curStatus = (draft?.status_desenvolvimento ?? "").toLowerCase();
  const isAprovado = curStatus === "aprovado" || lastStatusKeys.includes(curStatus);
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
        .select("id, nome_variante, codigo_variante")
        .in("id", tecido1VarianteIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((v: any) => {
        map[v.id] = v.nome_variante || v.codigo_variante || "";
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
  if (isAprovado && !draft?.enviado_cad) {
    if ((draft?.ref ?? "").trim() === "") cadMissing.push(fl("ref"));
    if ((draft?.nome ?? "").trim() === "") cadMissing.push("Nome");
    if (!(modelo as any)?.estilista_id) cadMissing.push("Estilista");
    if (!(modelo as any)?.categoria_principal_id) cadMissing.push("Categoria");
    if (!hasTecidoComVariante) cadMissing.push("ao menos 1 tecido com variante");
    else if (!todosBlocosComArtigoTemVariante) cadMissing.push("1 variante em cada tecido/forro/entretela selecionado");
    if (gradeTotalGeral <= 0) cadMissing.push("grade preenchida");
    if ((draft?.data_desenho_tecnico ?? "").trim() === "") cadMissing.push("Data Desenho Técnico");
    if ((draft?.data_piloto1 ?? "").trim() === "") cadMissing.push("Data Piloto 1");
    if (piloto2Aberto && (draft?.data_piloto2 ?? "").trim() === "") cadMissing.push("Data Piloto 2");
    if (piloto3Aberto && (draft?.data_piloto3 ?? "").trim() === "") cadMissing.push("Data Piloto 3");
  }
  const canEnviarCad = isAprovado && !draft?.enviado_cad && cadMissing.length === 0;

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
        ajustes_prova: draft.ajustes_prova || null,
        observacoes_gerais: draft.observacoes_gerais || null,
        ficha_medida_url: draft.ficha_medida_url || null,
        desenho_tecnico_url: draft.desenho_tecnico_url || null,
        custo_terceirizados_previsto: draft.custo_terceirizados_previsto || 0,
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
  };

  const save = useMutation({
    mutationFn: persistModelo,
    onSuccess: () => {
      toast.success("Modelo salvo");
      qc.invalidateQueries({ queryKey: ["modelo-detail", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-tecidos", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-tecido-oc-links", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-aviamentos", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-grades", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      // A reserva de estoque é recalculada a partir do BOM salvo (1ª reserva).
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
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
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao enviar para CAD"),
  });

  const updateBlock = (idx: number, patch: Partial<TecidoBlock>) => {
    const target = blocks[idx];
    const isTecido1 = target?.tipo === "tecido" && target?.numero === 1;
    // Trocar o artigo do Tecido 1 zera suas variantes; a grade é indexada por
    // essas variantes, então ficaria órfã (somada no total e copiada ao CAD).
    // Confirma antes de descartar grade preenchida e limpa-a junto.
    if (isTecido1 && patch.artigo_id !== undefined && patch.artigo_id !== target.artigo_id) {
      const hasGrade = grades.some(
        (g) => g.grade_total > 0 || Object.values(g.grades || {}).some((v) => (v ?? 0) > 0),
      );
      if (hasGrade && !window.confirm("Trocar o artigo do Tecido 1 vai apagar a grade preenchida. Continuar?")) {
        return;
      }
      setGrades([]);
    }
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
      return recomputeBlock(merged, artigoMap, varianteArtigoMap);
    }));
  };
  const updateBlockVariante = (idx: number, vIdx: number, value: string | null) => {
    const target = blocks[idx];
    const isTecido1 = target?.tipo === "tecido" && target?.numero === 1;
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
        if (!window.confirm(msg)) return;
        setGrades((gs) => gs.filter((g) => !affected.includes(g.variante_numero)));
      }
    }
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
      return recomputeBlock({ ...b, variantes, oc_links }, artigoMap, varianteArtigoMap);
    }));
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
    setAviamentosState((rows) => rows.map((r, i) => i === idx ? recomputeAviamento({ ...r, ...patch }, aviamentoMap) : r));
  };
  const addAviamento = () => {
    if (aviamentosState.length >= 10) return;
    setAviamentosState((rows) => [...rows, { aviamento_id: null, consumo: 0, loss_percent: 0, custo_previsto: 0 }]);
  };
  const removeAviamento = (idx: number) => setAviamentosState((rows) => rows.filter((_, i) => i !== idx));

  const updateGradeTotal = (n: number, total: number) => {
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
      const { tenantPrefix } = await import("@/lib/storage-tenant");
      const tenant = await tenantPrefix();
      const path = `${tenant}/fichas/${modeloId}/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (error) throw error;
      setDraft((d: any) => ({ ...d, ficha_medida_url: path }));
      toast.success("Ficha enviada");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  };

  const uploadDesenho = async (file: File) => {
    setUploading(true);
    try {
      const { tenantPrefix } = await import("@/lib/storage-tenant");
      const tenant = await tenantPrefix();
      const path = `${tenant}/desenhos/${modeloId}/${crypto.randomUUID()}-${file.name}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
      if (error) throw error;
      setDraft((d: any) => ({ ...d, desenho_tecnico_url: path }));
      toast.success("Desenho técnico enviado");
    } catch (e: any) {
      toast.error(e.message);
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

  return (
    <>
      <SheetHeader>
        <SheetTitle>{draft.nome || "Modelo"}</SheetTitle>
      </SheetHeader>

      <div className="mt-4">
        <Accordion type="multiple" defaultValue={["s1"]}>
          <AccordionItem value="s1">
            <AccordionTrigger>1. Informações Básicas</AccordionTrigger>
            <AccordionContent>
              <ModeloInfoSection
                draft={draft}
                setDraft={setDraft}
                linhas={linhas.data ?? []}
                modelistas={modelistas.data ?? []}
                piloteiros={piloteiros.data ?? []}
                isAprovado={isAprovado}
                isReprovado={isReprovado}
                statusOptions={statusOptions}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s2">
            <AccordionTrigger>2. Tecidos / Forros / Entretelas</AccordionTrigger>
            <AccordionContent>
              <ModeloTecidosSection
                modeloId={modeloId}
                blocks={blocks}
                artigos={artigos}
                artigosForro={artigosForro}
                artigosEntretela={artigosEntretela}
                tecidosPlanejados={tecidosPlanejados}
                grades={grades}
                onChangeBlock={updateBlock}
                onChangeVariante={updateBlockVariante}
                onChangeOcLinks={updateBlockOcLinks}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s3">
            <AccordionTrigger>3. Aviamentos</AccordionTrigger>
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

          <AccordionItem value="s4">
            <AccordionTrigger>4. Grade</AccordionTrigger>
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
            <AccordionTrigger>5. Custos</AccordionTrigger>
            <AccordionContent>
              <ModeloCustosSection
                totals={totals}
                custoTerceirizados={draft.custo_terceirizados_previsto}
                onChangeTerceirizados={(v) => setDraft({ ...draft, custo_terceirizados_previsto: v })}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s6">
            <AccordionTrigger>6. Anexos</AccordionTrigger>
            <AccordionContent>
              <ModeloAnexosSection
                fichaMedidaUrl={draft.ficha_medida_url}
                desenhoTecnicoUrl={draft.desenho_tecnico_url}
                uploading={uploading}
                onUploadFicha={uploadFicha}
                onUploadDesenho={uploadDesenho}
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

      <div className="sticky bottom-0 bg-background border-t mt-4 pt-3 flex flex-wrap gap-2 justify-end items-center">
        {draft.enviado_cad && (
          <span className="text-xs text-muted-foreground mr-auto">✓ Já enviado para o CAD</span>
        )}
        {isAprovado && !draft.enviado_cad && cadMissing.length > 0 && (
          <span className="text-xs text-muted-foreground mr-auto">
            Para enviar ao CAD, falta: {cadMissing.join(", ")}
          </span>
        )}
        <Button variant="ghost" onClick={onClose}>Fechar</Button>
        {canEnviarCad && (
          <Button variant="secondary" onClick={() => setConfirmEnviarCad(true)} disabled={enviarCad.isPending}>
            {enviarCad.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            <Send className="h-4 w-4 mr-2" /> Enviar para o CAD
          </Button>
        )}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
        </Button>
      </div>

      <AlertDialog open={confirmEnviarCad} onOpenChange={setConfirmEnviarCad}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza que quer enviar ao CAD?</AlertDialogTitle>
            <AlertDialogDescription>
              O modelo sai do Desenvolvimento e vai para o CAD (Produção) com os tecidos,
              variantes e grade atuais. Você ainda poderá ajustar os consumos no CAD.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não, quero fazer uma revisão antes</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmEnviarCad(false); enviarCad.mutate(); }}>
              Sim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
