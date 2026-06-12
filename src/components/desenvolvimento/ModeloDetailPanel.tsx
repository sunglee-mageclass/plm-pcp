import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";

import {
  BUCKET,
  makeEmptyBlocks,
  recomputeAviamento,
  recomputeBlock,
  type AviamentoRow,
  type GradeRow,
  type Opt,
  type TecidoBlock,
} from "./modelo-detail/types";
import { ModeloInfoSection } from "./modelo-detail/ModeloInfoSection";
import { ModeloTecidosSection } from "./modelo-detail/ModeloTecidosSection";
import { ModeloAviamentosSection } from "./modelo-detail/ModeloAviamentosSection";
import { ModeloGradeSection } from "./modelo-detail/ModeloGradeSection";
import { ModeloCustosSection } from "./modelo-detail/ModeloCustosSection";
import { ModeloAnexosSection } from "./modelo-detail/ModeloAnexosSection";

export function ModeloDetailPanel({ modeloId, onClose }: {
  modeloId: string | null;
  onClose: () => void;
}) {
  const open = !!modeloId;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        {modeloId && <PanelContent modeloId={modeloId} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function PanelContent({ modeloId, onClose }: { modeloId: string; onClose: () => void }) {
  const qc = useQueryClient();

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
        .from("artigos").select("id, nome, preco, preco_por_metro, unidade_medida").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; preco: number | null; preco_por_metro: number | null; unidade_medida: string | null }[];
    },
  });
  const artigoMap = useMemo(() => Object.fromEntries(artigos.map((a) => [a.id, a])), [artigos]);

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
          .select("modelo_tecido_id, variante_tecido_id, ordem")
          .in("modelo_tecido_id", ids);
        if (e2) throw e2;
        variantesRows = vs ?? [];
      }
      return { tecidos: tecidos ?? [], variantes: variantesRows };
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
    tecidosData.tecidos.forEach((t: any) => {
      const idx = empty.findIndex((b) => b.tipo === t.tipo && b.numero === t.numero);
      if (idx >= 0) {
        const variantes = Array(10).fill(null) as (string | null)[];
        tecidosData.variantes
          .filter((v: any) => v.modelo_tecido_id === t.id)
          .forEach((v: any) => {
            const ord = (v.ordem ?? 1) - 1;
            if (ord >= 0 && ord < 10) variantes[ord] = v.variante_tecido_id;
          });
        empty[idx] = {
          id: t.id, tipo: t.tipo, numero: t.numero,
          artigo_id: t.artigo_id, consumo: Number(t.consumo ?? 0),
          loss_percent: Number(t.loss_percent ?? 0), custo_previsto: Number(t.custo_previsto ?? 0),
          variantes,
        };
      }
    });
    // Prefill from tecidos_planejados (planejamento) when nenhum tecido foi ainda salvo
    const planejados: string[] = Array.isArray((modelo as any).tecidos_planejados)
      ? ((modelo as any).tecidos_planejados as string[])
      : [];
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
  }, [tecidosData, modelo]);

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
  const gradeTotalGeral = grades.reduce((s, g) => s + (g.grade_total || 0), 0);
  const canEnviarCad =
    isAprovado &&
    (draft?.ref ?? "").trim() !== "" &&
    (draft?.nome ?? "").trim() !== "" &&
    !!(modelo as any)?.estilista_id &&
    !!(modelo as any)?.categoria_principal_id &&
    hasTecidoComVariante &&
    gradeTotalGeral > 0 &&
    !draft?.enviado_cad;

  const save = useMutation({
    mutationFn: async () => {
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
        custo_terceirizados_previsto: draft.custo_terceirizados_previsto || 0,
        custo_tecido_total: totals.tecido,
        custo_forro_total: totals.forro,
        custo_entretela_total: totals.entretela,
        custo_aviamento_total: totals.aviamento,
        custo_peca_previsto: totals.peca,
        proporcoes: draft.proporcoes ?? {},
        fotos_modelo: draft.fotos_modelo ?? [],
        fotos_referencia: draft.fotos_referencia ?? [],
      };
      const { error: e1 } = await supabase.from("modelos").update(payload).eq("id", modeloId);
      if (e1) throw e1;

      const { error: eDelV } = await supabase
        .from("modelo_tecido_variantes")
        .delete()
        .in("modelo_tecido_id", (tecidosData?.tecidos ?? []).map((t: any) => t.id));
      if (eDelV && (tecidosData?.tecidos?.length ?? 0) > 0) throw eDelV;
      const { error: eDelT } = await supabase
        .from("modelo_tecidos").delete().eq("modelo_id", modeloId);
      if (eDelT) throw eDelT;

      const tecidosToInsert = blocks
        .filter((b) => b.artigo_id)
        .map((b) => ({
          modelo_id: modeloId, artigo_id: b.artigo_id, numero: b.numero, tipo: b.tipo,
          consumo: b.consumo || 0, loss_percent: b.loss_percent || 0, custo_previsto: b.custo_previsto || 0,
        }));
      if (tecidosToInsert.length > 0) {
        const { data: inserted, error: eIns } = await supabase
          .from("modelo_tecidos").insert(tecidosToInsert).select("id, numero, tipo");
        if (eIns) throw eIns;
        const idxMap = new Map<string, string>();
        (inserted ?? []).forEach((row: any) => idxMap.set(`${row.tipo}-${row.numero}`, row.id));
        const variantesToInsert: any[] = [];
        blocks.forEach((b) => {
          const tid = idxMap.get(`${b.tipo}-${b.numero}`);
          if (!tid) return;
          b.variantes.forEach((vid, i) => {
            if (vid) variantesToInsert.push({ modelo_tecido_id: tid, variante_tecido_id: vid, ordem: i + 1 });
          });
        });
        if (variantesToInsert.length > 0) {
          const { error: eV } = await supabase.from("modelo_tecido_variantes").insert(variantesToInsert);
          if (eV) throw eV;
        }
      }

      const { error: eDelA } = await supabase
        .from("modelo_aviamentos").delete().eq("modelo_id", modeloId);
      if (eDelA) throw eDelA;
      const aviamentosToInsert = aviamentosState
        .filter((r) => r.aviamento_id)
        .map((r, i) => ({
          modelo_id: modeloId, aviamento_id: r.aviamento_id, numero: i + 1,
          consumo: r.consumo || 0, loss_percent: r.loss_percent || 0, custo_previsto: r.custo_previsto || 0,
        }));
      if (aviamentosToInsert.length > 0) {
        const { error: eA } = await supabase.from("modelo_aviamentos").insert(aviamentosToInsert);
        if (eA) throw eA;
      }

      const { error: eDelG } = await supabase
        .from("modelo_grades").delete().eq("modelo_id", modeloId);
      if (eDelG) throw eDelG;
      const gradesToInsert = grades
        .filter((g) => g.grade_total > 0 || Object.values(g.grades).some((v) => (v ?? 0) > 0))
        .map((g) => ({
          modelo_id: modeloId, variante_numero: g.variante_numero,
          grades: g.grades, grade_total: g.grade_total,
        }));
      if (gradesToInsert.length > 0) {
        const { error: eG } = await supabase.from("modelo_grades").insert(gradesToInsert);
        if (eG) throw eG;
      }
    },
    onSuccess: () => {
      toast.success("Modelo salvo");
      qc.invalidateQueries({ queryKey: ["modelo-detail", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-tecidos", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-aviamentos", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo-grades", modeloId] });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  const enviarCad = useMutation({
    mutationFn: async () => {
      const { data: mdl, error: eM } = await supabase
        .from("modelos").select("tenant_id").eq("id", modeloId).maybeSingle();
      if (eM) throw eM;
      const tenantId = mdl?.tenant_id;
      const { error: eC } = await supabase.from("cad").insert({
        modelo_id: modeloId,
        tenant_id: tenantId,
        observacoes_tecnicas: draft?.observacoes_tecnicas || null,
        ficha_medida_url: draft?.ficha_medida_url || null,
        status_corte: "pendente",
      });
      if (eC) throw eC;
      const { error: eU } = await supabase
        .from("modelos").update({ enviado_cad: true }).eq("id", modeloId);
      if (eU) throw eU;
    },
    onSuccess: () => {
      toast.success("Enviado para o CAD");
      setDraft((d: any) => ({ ...d, enviado_cad: true }));
      qc.invalidateQueries({ queryKey: ["modelo-detail", modeloId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao enviar para CAD"),
  });

  const updateBlock = (idx: number, patch: Partial<TecidoBlock>) => {
    setBlocks((bs) => bs.map((b, i) => i === idx ? recomputeBlock({ ...b, ...patch }, artigoMap) : b));
  };
  const updateBlockVariante = (idx: number, vIdx: number, value: string | null) => {
    setBlocks((bs) => bs.map((b, i) => {
      if (i !== idx) return b;
      const variantes = [...b.variantes];
      variantes[vIdx] = value;
      if (!value) for (let k = vIdx + 1; k < variantes.length; k++) variantes[k] = null;
      return { ...b, variantes };
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
      const next: Record<string, number> = { ...cur.grades, [tam]: qty };
      const realTotal = tamanhos.reduce((s, t) => s + (Number(next[t]) || 0), 0);
      const others = gs.filter((g) => g.variante_numero !== n);
      return [...others, { variante_numero: n, grades: next, grade_total: realTotal }].sort((a, b) => a.variante_numero - b.variante_numero);
    });
  };
  const updateProporcao = (tam: string, val: number) => {
    setDraft((d: any) => ({ ...d, proporcoes: { ...(d?.proporcoes ?? {}), [tam]: val } }));
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
                canEnviarCad={canEnviarCad}
                onEnviarCad={() => enviarCad.mutate()}
                enviarCadPending={enviarCad.isPending}
                statusOptions={statusOptions}
              />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="s2">
            <AccordionTrigger>2. Tecidos / Forros / Entretelas</AccordionTrigger>
            <AccordionContent>
              <ModeloTecidosSection
                blocks={blocks}
                artigos={artigos}
                onChangeBlock={updateBlock}
                onChangeVariante={updateBlockVariante}
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
                uploading={uploading}
                onUploadFicha={uploadFicha}
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
      </div>

      <div className="sticky bottom-0 bg-background border-t mt-4 pt-3 flex gap-2 justify-end">
        <Button variant="ghost" onClick={onClose}>Fechar</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Salvar
        </Button>
      </div>
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
