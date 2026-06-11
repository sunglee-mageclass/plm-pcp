import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Send, Plus, X, Upload, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const BUCKET = "modelos";

type Opt = { id: string; nome: string };

type TecidoBlock = {
  id?: string;
  tipo: "tecido" | "forro" | "entretela";
  numero: number;
  artigo_id: string | null;
  consumo: number;
  loss_percent: number;
  custo_previsto: number;
  variantes: (string | null)[]; // up to 10
};

type AviamentoRow = {
  id?: string;
  aviamento_id: string | null;
  consumo: number;
  loss_percent: number;
  custo_previsto: number;
};

type GradeRow = {
  variante_numero: number;
  grades: Record<string, number>;
  grade_total: number;
};

const TIPOS: TecidoBlock["tipo"][] = ["tecido", "forro", "entretela"];
const TIPO_LABEL: Record<TecidoBlock["tipo"], string> = {
  tecido: "Tecido",
  forro: "Forro",
  entretela: "Entretela",
};

const STATUS_DESENV_OPTS = [
  { value: "novo", label: "Novo" },
  { value: "desenho_tecnico", label: "Desenho Técnico" },
  { value: "modelagem", label: "Modelagem" },
  { value: "piloto", label: "Piloto" },
  { value: "aprovado", label: "Aprovado" },
  { value: "reprovado", label: "Reprovado" },
];

function makeEmptyBlocks(): TecidoBlock[] {
  const arr: TecidoBlock[] = [];
  TIPOS.forEach((t) => {
    for (let n = 1; n <= 3; n++) {
      arr.push({
        tipo: t, numero: n, artigo_id: null, consumo: 0, loss_percent: 0, custo_previsto: 0,
        variantes: Array(10).fill(null),
      });
    }
  });
  return arr;
}

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

  // Reference data
  const linhas = useOpts("linhas");
  const modelistas = useColabs("modelista");
  const piloteiros = useColabs("piloteiro");
  const { data: tenantCfg } = useQuery({
    queryKey: ["tenant-config-grade"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_config")
        .select("tamanhos_grade")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const tamanhos: string[] = useMemo(() => {
    const raw = (tenantCfg as any)?.tamanhos_grade;
    if (Array.isArray(raw) && raw.length > 0) {
      return raw.map((x: any) => typeof x === "string" ? x : (x?.nome ?? x?.label ?? String(x)));
    }
    return ["PP", "P", "M", "G", "GG"];
  }, [tenantCfg]);

  const { data: artigos = [] } = useQuery({
    queryKey: ["artigos-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("id, nome, preco, preco_por_metro")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; preco: number | null; preco_por_metro: number | null }[];
    },
  });
  const artigoMap = useMemo(() => Object.fromEntries(artigos.map((a) => [a.id, a])), [artigos]);

  const { data: aviamentos = [] } = useQuery({
    queryKey: ["aviamentos-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aviamentos")
        .select("id, codigo_nome, preco")
        .order("codigo_nome");
      if (error) throw error;
      return (data ?? []) as { id: string; codigo_nome: string; preco: number | null }[];
    },
  });
  const aviamentoMap = useMemo(() => Object.fromEntries(aviamentos.map((a) => [a.id, a])), [aviamentos]);

  // Modelo + children
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
        .eq("modelo_id", modeloId)
        .order("numero");
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
        .eq("modelo_id", modeloId)
        .order("variante_numero");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Local draft
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
        status_desenvolvimento: modelo.status_desenvolvimento ?? "novo",
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
      });
    }
  }, [modelo]);

  useEffect(() => {
    if (!tecidosData) return;
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
    setBlocks(empty);
  }, [tecidosData]);

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

  // Derived totals
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

  const isAprovado = (draft?.status_desenvolvimento ?? "").toLowerCase() === "aprovado";
  const isReprovado = (draft?.status_desenvolvimento ?? "").toLowerCase() === "reprovado";
  const canEnviarCad = isAprovado && (draft?.ref ?? "").trim() !== "" && !draft?.enviado_cad;

  // Mutations
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
      };
      const { error: e1 } = await supabase.from("modelos").update(payload).eq("id", modeloId);
      if (e1) throw e1;

      // Replace tecidos + variants
      const { error: eDelV } = await supabase
        .from("modelo_tecido_variantes")
        .delete()
        .in("modelo_tecido_id",
          (tecidosData?.tecidos ?? []).map((t: any) => t.id)
        );
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

      // Replace aviamentos
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

      // Replace grades
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

  // Helpers
  const updateBlock = (idx: number, patch: Partial<TecidoBlock>) => {
    setBlocks((bs) => bs.map((b, i) => i === idx ? recomputeBlock({ ...b, ...patch }, artigoMap) : b));
  };
  const updateBlockVariante = (idx: number, vIdx: number, value: string | null) => {
    setBlocks((bs) => bs.map((b, i) => {
      if (i !== idx) return b;
      const variantes = [...b.variantes];
      variantes[vIdx] = value;
      // If removed intermediate, clear following
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

  const ensureGrade = (n: number): GradeRow => {
    const found = grades.find((g) => g.variante_numero === n);
    if (found) return found;
    const empty: GradeRow = { variante_numero: n, grades: {}, grade_total: 0 };
    return empty;
  };
  const updateGradeTotal = (n: number, total: number) => {
    setGrades((gs) => {
      const cur = gs.find((g) => g.variante_numero === n) ?? { variante_numero: n, grades: {}, grade_total: 0 };
      const props = draft?.proporcoes ?? {};
      const sum = tamanhos.reduce((s, t) => s + (Number(props[t]) || 0), 0);
      const next: Record<string, number> = { ...cur.grades };
      if (sum > 0) {
        tamanhos.forEach((t) => {
          next[t] = Math.round(((Number(props[t]) || 0) / sum) * total);
        });
      }
      const others = gs.filter((g) => g.variante_numero !== n);
      const realTotal = tamanhos.reduce((s, t) => s + (next[t] || 0), 0);
      return [...others, { variante_numero: n, grades: next, grade_total: realTotal }].sort((a, b) => a.variante_numero - b.variante_numero);
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
      const path = `fichas/${modeloId}/${crypto.randomUUID()}-${file.name}`;
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
          {/* SECTION 1 */}
          <AccordionItem value="s1">
            <AccordionTrigger>1. Informações Básicas</AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Nome">
                  <Input value={draft.nome} onChange={(e) => setDraft({ ...draft, nome: e.target.value })} />
                </Field>
                <Field label="Status">
                  <Select value={draft.status_desenvolvimento} onValueChange={(v) => setDraft({ ...draft, status_desenvolvimento: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUS_DESENV_OPTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                {isAprovado && (
                  <Field label="REF">
                    <Input value={draft.ref} onChange={(e) => setDraft({ ...draft, ref: e.target.value })} />
                  </Field>
                )}
                {isReprovado && (
                  <Field label="Motivo do Cancelamento" full>
                    <Textarea rows={2} value={draft.motivo_cancelamento} onChange={(e) => setDraft({ ...draft, motivo_cancelamento: e.target.value })} />
                  </Field>
                )}
                <FieldSelectOpt label="Linha" value={draft.linha_id} onChange={(v) => setDraft({ ...draft, linha_id: v })} options={linhas.data ?? []} />
                <FieldSelectOpt label="Modelista" value={draft.modelista_id} onChange={(v) => setDraft({ ...draft, modelista_id: v })} options={modelistas.data ?? []} />
                <FieldSelectOpt label="Piloteiro 1" value={draft.piloteiro1_id} onChange={(v) => setDraft({ ...draft, piloteiro1_id: v })} options={piloteiros.data ?? []} />
                <Field label="Data Piloto 1">
                  <Input type="date" value={draft.data_piloto1 ?? ""} onChange={(e) => setDraft({ ...draft, data_piloto1: e.target.value })} />
                </Field>
                <FieldSelectOpt label="Piloteiro 2" value={draft.piloteiro2_id} onChange={(v) => setDraft({ ...draft, piloteiro2_id: v })} options={piloteiros.data ?? []} />
                <Field label="Data Piloto 2">
                  <Input type="date" value={draft.data_piloto2 ?? ""} onChange={(e) => setDraft({ ...draft, data_piloto2: e.target.value })} />
                </Field>
                <FieldSelectOpt label="Piloteiro 3" value={draft.piloteiro3_id} onChange={(v) => setDraft({ ...draft, piloteiro3_id: v })} options={piloteiros.data ?? []} />
                <Field label="Data Piloto 3">
                  <Input type="date" value={draft.data_piloto3 ?? ""} onChange={(e) => setDraft({ ...draft, data_piloto3: e.target.value })} />
                </Field>
                <Field label="Data Desenho Técnico">
                  <Input type="date" value={draft.data_desenho_tecnico ?? ""} onChange={(e) => setDraft({ ...draft, data_desenho_tecnico: e.target.value })} />
                </Field>
                <Field label="Data Aprovação">
                  <Input type="date" value={draft.data_aprovacao ?? ""} onChange={(e) => setDraft({ ...draft, data_aprovacao: e.target.value })} />
                </Field>
              </div>
              <Field label="Observações Técnicas" full>
                <Textarea rows={3} value={draft.observacoes_tecnicas} onChange={(e) => setDraft({ ...draft, observacoes_tecnicas: e.target.value })} />
              </Field>
              <Field label="Ajustes na Prova" full>
                <Textarea rows={3} value={draft.ajustes_prova} onChange={(e) => setDraft({ ...draft, ajustes_prova: e.target.value })} />
              </Field>
              {canEnviarCad && (
                <Button onClick={() => enviarCad.mutate()} disabled={enviarCad.isPending} className="w-full">
                  <Send className="h-4 w-4 mr-2" /> Enviar para o CAD
                </Button>
              )}
              {draft.enviado_cad && (
                <p className="text-xs text-muted-foreground text-center">✓ Já enviado para o CAD</p>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* SECTION 2 */}
          <AccordionItem value="s2">
            <AccordionTrigger>2. Tecidos / Forros / Entretelas</AccordionTrigger>
            <AccordionContent className="space-y-3">
              {TIPOS.map((tipo) => (
                <div key={tipo} className="space-y-2">
                  <p className="text-sm font-semibold">{TIPO_LABEL[tipo]}</p>
                  {[1, 2, 3].map((numero) => {
                    const idx = blocks.findIndex((b) => b.tipo === tipo && b.numero === numero);
                    const b = blocks[idx];
                    return (
                      <TecidoBlockEditor
                        key={`${tipo}-${numero}`}
                        block={b}
                        artigos={artigos}
                        onChangeBlock={(p) => updateBlock(idx, p)}
                        onChangeVariante={(vi, val) => updateBlockVariante(idx, vi, val)}
                      />
                    );
                  })}
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>

          {/* SECTION 3 */}
          <AccordionItem value="s3">
            <AccordionTrigger>3. Aviamentos</AccordionTrigger>
            <AccordionContent className="space-y-2">
              {aviamentosState.map((r, i) => (
                <Card key={i} className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Aviamento {i + 1}</span>
                    <Button variant="ghost" size="sm" onClick={() => removeAviamento(i)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    <FieldSelectOpt
                      label="Aviamento"
                      value={r.aviamento_id}
                      onChange={(v) => updateAviamento(i, { aviamento_id: v })}
                      options={aviamentos.map((a) => ({ id: a.id, nome: a.codigo_nome }))}
                    />
                    <Field label="Custo Previsto">
                      <Input readOnly value={r.custo_previsto.toFixed(2)} />
                    </Field>
                    <Field label="Consumo">
                      <Input type="number" step="0.001" value={r.consumo} onChange={(e) => updateAviamento(i, { consumo: Number(e.target.value) || 0 })} />
                    </Field>
                    <Field label="% Loss">
                      <Input type="number" step="0.01" value={r.loss_percent} onChange={(e) => updateAviamento(i, { loss_percent: Number(e.target.value) || 0 })} />
                    </Field>
                  </div>
                </Card>
              ))}
              {aviamentosState.length < 10 && (
                <Button variant="outline" size="sm" onClick={addAviamento}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar Aviamento
                </Button>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* SECTION 4 */}
          <AccordionItem value="s4">
            <AccordionTrigger>4. Grade</AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div>
                <p className="text-xs font-semibold mb-2">Proporções por Tamanho</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {tamanhos.map((t) => (
                    <Field key={t} label={t}>
                      <Input
                        type="number"
                        value={draft.proporcoes?.[t] ?? 0}
                        onChange={(e) => updateProporcao(t, Number(e.target.value) || 0)}
                      />
                    </Field>
                  ))}
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
                  const g = ensureGrade(n);
                  const hasAny = g.grade_total > 0 || Object.values(g.grades).some((v) => v > 0);
                  if (!hasAny && n > 1 && !grades.find((x) => x.variante_numero === n - 1 && (x.grade_total > 0))) return null;
                  return (
                    <Card key={n} className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold">Variante {n}</span>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs">Grade Total</Label>
                          <Input
                            className="w-24"
                            type="number"
                            value={g.grade_total}
                            onChange={(e) => updateGradeTotal(n, Number(e.target.value) || 0)}
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        {tamanhos.map((t) => (
                          <Field key={t} label={t}>
                            <Input
                              type="number"
                              value={g.grades[t] ?? 0}
                              onChange={(e) => updateGradeCell(n, t, Number(e.target.value) || 0)}
                            />
                          </Field>
                        ))}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* SECTION 5 */}
          <AccordionItem value="s5">
            <AccordionTrigger>5. Custos</AccordionTrigger>
            <AccordionContent>
              <Card className="p-4 space-y-1.5 text-sm">
                <Row label="Tecido" value={totals.tecido} />
                <Row label="Forro" value={totals.forro} />
                <Row label="Entretela" value={totals.entretela} />
                <Row label="Aviamento" value={totals.aviamento} />
                <div className="flex justify-between items-center">
                  <Label>Terceirizados</Label>
                  <Input
                    className="w-32 text-right"
                    type="number"
                    step="0.01"
                    value={draft.custo_terceirizados_previsto}
                    onChange={(e) => setDraft({ ...draft, custo_terceirizados_previsto: Number(e.target.value) || 0 })}
                  />
                </div>
                <Separator className="my-2" />
                <Row label="Custo de 1 Peça" value={totals.peca} strong />
              </Card>
            </AccordionContent>
          </AccordionItem>

          {/* SECTION 6 */}
          <AccordionItem value="s6">
            <AccordionTrigger>6. Anexos</AccordionTrigger>
            <AccordionContent className="space-y-3">
              <div className="grid gap-2">
                <Label>Ficha de Medida</Label>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent">
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Enviar arquivo
                    <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadFicha(e.target.files[0])} />
                  </label>
                  {draft.ficha_medida_url && (
                    <span className="text-xs text-muted-foreground truncate">{draft.ficha_medida_url.split("/").pop()}</span>
                  )}
                </div>
              </div>
              <Field label="Observações Gerais" full>
                <Textarea rows={4} value={draft.observacoes_gerais} onChange={(e) => setDraft({ ...draft, observacoes_gerais: e.target.value })} />
              </Field>
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

function recomputeBlock(b: TecidoBlock, artigoMap: Record<string, any>): TecidoBlock {
  const preco = b.artigo_id ? Number(artigoMap[b.artigo_id]?.preco ?? 0) : 0;
  const custo = preco * (b.consumo || 0) * (1 + (b.loss_percent || 0) / 100);
  return { ...b, custo_previsto: Math.round(custo * 100) / 100 };
}
function recomputeAviamento(r: AviamentoRow, aviamentoMap: Record<string, any>): AviamentoRow {
  const preco = r.aviamento_id ? Number(aviamentoMap[r.aviamento_id]?.preco ?? 0) : 0;
  const custo = preco * (r.consumo || 0) * (1 + (r.loss_percent || 0) / 100);
  return { ...r, custo_previsto: Math.round(custo * 100) / 100 };
}

function TecidoBlockEditor({ block, artigos, onChangeBlock, onChangeVariante }: {
  block: TecidoBlock;
  artigos: { id: string; nome: string }[];
  onChangeBlock: (p: Partial<TecidoBlock>) => void;
  onChangeVariante: (vIdx: number, val: string | null) => void;
}) {
  const { data: variantesArtigo = [] } = useQuery({
    queryKey: ["variantes-artigo", block.artigo_id],
    enabled: !!block.artigo_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, nome_variante, codigo_variante")
        .eq("artigo_id", block.artigo_id!);
      if (error) throw error;
      return (data ?? []).map((v: any) => ({
        id: v.id, nome: v.nome_variante || v.codigo_variante || v.id,
      }));
    },
  });

  return (
    <Card className="p-3 space-y-2">
      <div className="grid sm:grid-cols-2 gap-2">
        <FieldSelectOpt
          label={`${TIPO_LABEL[block.tipo]} ${block.numero} — Artigo`}
          value={block.artigo_id}
          onChange={(v) => onChangeBlock({ artigo_id: v, variantes: Array(10).fill(null) })}
          options={artigos.map((a) => ({ id: a.id, nome: a.nome }))}
        />
        <Field label="Custo Previsto">
          <Input readOnly value={block.custo_previsto.toFixed(2)} />
        </Field>
        <Field label="Consumo">
          <Input type="number" step="0.001" value={block.consumo} onChange={(e) => onChangeBlock({ consumo: Number(e.target.value) || 0 })} />
        </Field>
        <Field label="% Loss">
          <Input type="number" step="0.01" value={block.loss_percent} onChange={(e) => onChangeBlock({ loss_percent: Number(e.target.value) || 0 })} />
        </Field>
      </div>

      {block.artigo_id && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Variantes</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {Array.from({ length: 10 }).map((_, i) => {
              const prevFilled = i === 0 || !!block.variantes[i - 1];
              if (!prevFilled) return null;
              return (
                <Select
                  key={i}
                  value={block.variantes[i] ?? ""}
                  onValueChange={(v) => onChangeVariante(i, v === "__none__" ? null : v)}
                >
                  <SelectTrigger><SelectValue placeholder={`Variante ${i + 1}`} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Remover —</SelectItem>
                    {variantesArtigo.map((v) => <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`grid gap-1 ${full ? "sm:col-span-2" : ""}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
function FieldSelectOpt({ label, value, onChange, options }: {
  label: string; value: string | null | undefined; onChange: (v: string | null) => void; options: Opt[];
}) {
  return (
    <Field label={label}>
      <Select value={value ?? ""} onValueChange={(v) => onChange(v === "__none__" ? null : v)}>
        <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— Nenhum —</SelectItem>
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
  );
}
function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold text-base" : ""}`}>
      <span>{label}</span>
      <span>R$ {value.toFixed(2)}</span>
    </div>
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
