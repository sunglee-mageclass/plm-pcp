import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageIcon, Scissors } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Field, ModeloPhoto } from "@/components/producao/cad/shared";
import { calcCusto } from "@/components/producao/cad/types";
import type {
  AviamentoRow,
  GradeRow,
  TecidoRow,
  TipoTec,
  VarianteRow,
} from "@/components/producao/cad/types";
import { CadActions } from "@/components/producao/cad/CadActions";
import { CadTecidosSection } from "@/components/producao/cad/CadTecidosSection";
import { CadGradeSection } from "@/components/producao/cad/CadGradeSection";
import { CadExplosaoSection } from "@/components/producao/cad/CadExplosaoSection";
import { CadFichaCorte } from "@/components/producao/cad/CadFichaCorte";

export const Route = createFileRoute("/_authenticated/producao/cad/$modeloId")({
  component: CadDetailPage,
});

function CadDetailPage() {
  const { modeloId } = Route.useParams();
  const qc = useQueryClient();

  // --- queries ---
  const { data: modelo } = useQuery({
    queryKey: ["cad-modelo", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select(
          "*, estilista:estilista_id(nome), cat_p:categoria_principal_id(nome), cat_s:categoria_secundaria_id(nome)",
        )
        .eq("id", modeloId)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: cadRow } = useQuery({
    queryKey: ["cad-row", modeloId],
    queryFn: async () => {
      const { data } = await supabase.from("cad").select("*").eq("modelo_id", modeloId).maybeSingle();
      return data;
    },
  });

  const { data: modeloTecidos = [] } = useQuery({
    queryKey: ["cad-modelo-tecidos", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelo_tecidos")
        .select(
          "id, numero, tipo, artigo_id, consumo, loss_percent, artigos:artigo_id(nome, preco_por_metro, unidade_medida), modelo_tecido_variantes(id, variante_tecido_id, ordem, variantes_tecido:variante_tecido_id(nome))",
        )
        .eq("modelo_id", modeloId)
        .order("tipo")
        .order("numero");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: cadTecidos = [] } = useQuery({
    queryKey: ["cad-tecidos", cadRow?.id],
    enabled: !!cadRow?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cad_tecidos")
        .select(
          "*, artigos:artigo_id(nome, preco_por_metro), cad_tecido_variantes(*, variantes_tecido:variante_tecido_id(nome))",
        )
        .eq("cad_id", cadRow!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: modeloGrades = [] } = useQuery({
    queryKey: ["cad-modelo-grades", modeloId],
    queryFn: async () => {
      const { data } = await supabase.from("modelo_grades").select("*").eq("modelo_id", modeloId);
      return data ?? [];
    },
  });
  const { data: cadGrades = [] } = useQuery({
    queryKey: ["cad-grades-rows", cadRow?.id],
    enabled: !!cadRow?.id,
    queryFn: async () => {
      const { data } = await supabase.from("cad_grades").select("*").eq("cad_id", cadRow!.id);
      return data ?? [];
    },
  });

  const { data: modeloAviamentos = [] } = useQuery({
    queryKey: ["cad-modelo-aviamentos", modeloId],
    queryFn: async () => {
      const { data } = await supabase
        .from("modelo_aviamentos")
        .select("id, numero, aviamento_id, consumo, aviamentos:aviamento_id(codigo_nome)")
        .eq("modelo_id", modeloId)
        .order("numero");
      return data ?? [];
    },
  });
  const { data: cadAviamentos = [] } = useQuery({
    queryKey: ["cad-aviamentos-rows", cadRow?.id],
    enabled: !!cadRow?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("cad_aviamentos")
        .select("*, aviamentos:aviamento_id(codigo_nome)")
        .eq("cad_id", cadRow!.id)
        .order("numero");
      return data ?? [];
    },
  });

  // --- local editable state, seeded from cad rows or modelo defaults ---
  const [tecidos, setTecidos] = useState<TecidoRow[]>([]);
  const [grades, setGrades] = useState<GradeRow[]>([]);
  const [aviamentos, setAviamentos] = useState<AviamentoRow[]>([]);
  const [previsaoEntrega, setPrevisaoEntrega] = useState("");
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (seeded) return;
    if (!modelo) return;
    if (cadRow === undefined) return;
    if (cadRow?.id && (cadTecidos as any[]).length === 0 && (modeloTecidos as any[]).length > 0) {
      return;
    }

    let initialTec: TecidoRow[];
    if ((cadTecidos as any[]).length > 0) {
      initialTec = (cadTecidos as any[]).map((t) => ({
        id: t.id,
        numero: t.numero,
        tipo: t.tipo,
        artigo_id: t.artigo_id,
        consumo_cad: Number(t.consumo_cad ?? 0),
        loss_percent_cad: Number(t.loss_percent_cad ?? 0),
        custo_cad: Number(t.custo_cad ?? 0),
        tamanho_folha: Number(t.tamanho_folha ?? 0),
        preco: Number(t.artigos?.preco_por_metro ?? 0),
        artigo_nome: t.artigos?.nome,
        variantes: (t.cad_tecido_variantes ?? []).map((v: any) => ({
          id: v.id,
          variante_tecido_id: v.variante_tecido_id,
          variante_nome: v.variantes_tecido?.nome,
          ordem: v.ordem,
          quantidade_folhas: Number(v.quantidade_folhas ?? 0),
          metragem_planejada: Number(v.metragem_planejada ?? 0),
          metragem_enviada: Number(v.metragem_enviada ?? 0),
        })),
      }));
    } else {
      initialTec = (modeloTecidos as any[]).map((mt) => {
        const preco = Number(mt.artigos?.preco_por_metro ?? 0);
        const consumo = Number(mt.consumo ?? 0);
        const loss = Number(mt.loss_percent ?? 0);
        return {
          numero: mt.numero,
          tipo: mt.tipo as TipoTec,
          artigo_id: mt.artigo_id,
          consumo_cad: consumo,
          loss_percent_cad: loss,
          custo_cad: calcCusto(consumo, loss, preco),
          tamanho_folha: 0,
          preco,
          artigo_nome: mt.artigos?.nome,
          variantes: (mt.modelo_tecido_variantes ?? []).map((v: any) => ({
            variante_tecido_id: v.variante_tecido_id,
            variante_nome: v.variantes_tecido?.nome,
            ordem: v.ordem,
            quantidade_folhas: 0,
            metragem_planejada: 0,
            metragem_enviada: 0,
          })),
        };
      });
    }
    setTecidos(initialTec);

    let initialGrades: GradeRow[];
    if ((cadGrades as any[]).length > 0) {
      initialGrades = (cadGrades as any[]).map((g) => ({
        id: g.id,
        variante_numero: g.variante_numero,
        grades_planejadas: g.grades_planejadas ?? {},
        grades_reais: g.grades_reais ?? {},
        grade_total_planejada: g.grade_total_planejada ?? 0,
        grade_total_real: g.grade_total_real ?? 0,
      }));
    } else {
      initialGrades = (modeloGrades as any[]).map((g) => ({
        variante_numero: g.variante_numero,
        grades_planejadas: g.grades ?? {},
        grades_reais: g.grades ?? {},
        grade_total_planejada: g.grade_total ?? 0,
        grade_total_real: g.grade_total ?? 0,
      }));
    }
    setGrades(initialGrades);

    const gradeTotalGeral = initialGrades.reduce((a, g) => a + (g.grade_total_planejada || 0), 0);

    let initialAvi: AviamentoRow[];
    if ((cadAviamentos as any[]).length > 0) {
      initialAvi = (cadAviamentos as any[]).map((a) => ({
        id: a.id,
        numero: a.numero,
        aviamento_id: a.aviamento_id,
        aviamento_nome: a.aviamentos?.codigo_nome,
        consumo: Number(a.consumo ?? 0),
        grade_total: gradeTotalGeral,
        quantidade_enviar: Number(a.quantidade_enviar ?? 0),
        quantidade_separar: Number(a.quantidade_separar ?? 0),
      }));
    } else {
      initialAvi = (modeloAviamentos as any[]).map((ma) => {
        const consumo = Number(ma.consumo ?? 0);
        const qEnviar = Number((consumo * gradeTotalGeral).toFixed(4));
        return {
          numero: ma.numero,
          aviamento_id: ma.aviamento_id,
          aviamento_nome: ma.aviamentos?.codigo_nome,
          consumo,
          grade_total: gradeTotalGeral,
          quantidade_enviar: qEnviar,
          quantidade_separar: qEnviar,
        };
      });
    }
    setAviamentos(initialAvi);

    if (cadRow?.data_previsao_corte) setPrevisaoEntrega(cadRow.data_previsao_corte);

    setSeeded(true);
  }, [modelo, cadRow, cadTecidos, modeloTecidos, cadGrades, modeloGrades, cadAviamentos, modeloAviamentos, seeded]);

  // --- helpers ---
  const updateTec = (i: number, patch: Partial<TecidoRow>) => {
    setTecidos((prev) => {
      const next = [...prev];
      const merged = { ...next[i], ...patch };
      merged.custo_cad = calcCusto(merged.consumo_cad, merged.loss_percent_cad, merged.preco);
      next[i] = merged;
      return next;
    });
  };
  const updateVar = (i: number, j: number, patch: Partial<VarianteRow>) => {
    setTecidos((prev) => {
      const next = [...prev];
      const variantes = [...next[i].variantes];
      variantes[j] = { ...variantes[j], ...patch };
      next[i] = { ...next[i], variantes };
      return next;
    });
  };
  const updateGradeCell = (gi: number, tamanho: string, value: number) => {
    setGrades((prev) => {
      const next = [...prev];
      const grades_reais = { ...next[gi].grades_reais, [tamanho]: value };
      const grade_total_real = Object.values(grades_reais).reduce((a, b) => a + (Number(b) || 0), 0);
      next[gi] = { ...next[gi], grades_reais, grade_total_real };
      return next;
    });
  };
  const updateGradePlan = (gi: number, tamanho: string, value: number) => {
    setGrades((prev) => {
      const next = [...prev];
      const grades_planejadas = { ...next[gi].grades_planejadas, [tamanho]: value };
      const grade_total_planejada = Object.values(grades_planejadas).reduce((a, b) => a + (Number(b) || 0), 0);
      next[gi] = { ...next[gi], grades_planejadas, grade_total_planejada };
      return next;
    });
  };
  const updateAvi = (i: number, patch: Partial<AviamentoRow>) => {
    setAviamentos((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  };

  // --- mutations ---
  const saveAll = useMutation({
    mutationFn: async () => {
      let cad_id = cadRow?.id as string | undefined;
      if (!cad_id) {
        const { data, error } = await supabase
          .from("cad")
          .insert({ modelo_id: modeloId, status_corte: "pendente" })
          .select("id")
          .single();
        if (error) throw error;
        cad_id = data.id;
      }
      await supabase.from("cad_tecidos").delete().eq("cad_id", cad_id!);
      await supabase.from("cad_grades").delete().eq("cad_id", cad_id!);
      for (const t of tecidos) {
        const { data: ins, error } = await supabase
          .from("cad_tecidos")
          .insert({
            cad_id,
            artigo_id: t.artigo_id,
            numero: t.numero,
            tipo: t.tipo,
            consumo_cad: t.consumo_cad,
            loss_percent_cad: t.loss_percent_cad,
            custo_cad: t.custo_cad,
            tamanho_folha: t.tamanho_folha,
          })
          .select("id")
          .single();
        if (error) throw error;
        if (t.variantes.length > 0) {
          const payload = t.variantes.map((v) => ({
            cad_tecido_id: ins.id,
            variante_tecido_id: v.variante_tecido_id,
            ordem: v.ordem,
            quantidade_folhas: v.quantidade_folhas,
            metragem_planejada: v.metragem_planejada,
            metragem_enviada: v.metragem_enviada,
          }));
          const { error: ve } = await supabase.from("cad_tecido_variantes").insert(payload);
          if (ve) throw ve;
        }
      }
      if (grades.length > 0) {
        const { error: ge } = await supabase.from("cad_grades").insert(
          grades.map((g) => ({
            cad_id,
            variante_numero: g.variante_numero,
            grades_planejadas: g.grades_planejadas,
            grades_reais: g.grades_reais,
            grade_total_planejada: g.grade_total_planejada,
            grade_total_real: g.grade_total_real,
          })),
        );
        if (ge) throw ge;
      }
      await supabase.from("cad_aviamentos").delete().eq("cad_id", cad_id!);
      if (aviamentos.length > 0) {
        const { error: ae } = await supabase.from("cad_aviamentos").insert(
          aviamentos.map((a) => ({
            cad_id,
            aviamento_id: a.aviamento_id,
            numero: a.numero,
            consumo: a.consumo,
            quantidade_enviar: a.quantidade_enviar,
            quantidade_separar: a.quantidade_separar,
          })),
        );
        if (ae) throw ae;
      }
      if (previsaoEntrega) {
        await supabase.from("cad").update({ data_previsao_corte: previsaoEntrega }).eq("id", cad_id!);
      }
      return cad_id;
    },
    onSuccess: () => {
      toast.success("CAD salvo");
      qc.invalidateQueries({ queryKey: ["cad-row", modeloId] });
      qc.invalidateQueries({ queryKey: ["cad-tecidos"] });
      qc.invalidateQueries({ queryKey: ["cad-grades-rows"] });
      qc.invalidateQueries({ queryKey: ["cad-aviamentos-rows"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  const enviarCorte = useMutation({
    mutationFn: async () => {
      const cad_id = (await saveAll.mutateAsync()) as string;
      const { error } = await supabase
        .from("cad")
        .update({ enviado_corte: true, data_enviado_corte: new Date().toISOString().slice(0, 10), status_corte: "em_corte" })
        .eq("id", cad_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Enviado ao corte");
      qc.invalidateQueries({ queryKey: ["producao-cad-list"] });
      qc.invalidateQueries({ queryKey: ["cad-row", modeloId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro"),
  });

  const tamanhosAll = useMemo(() => {
    const set = new Set<string>();
    grades.forEach((g) => {
      Object.keys(g.grades_planejadas).forEach((k) => set.add(k));
      Object.keys(g.grades_reais).forEach((k) => set.add(k));
    });
    return Array.from(set);
  }, [grades]);

  const gradeTotalGeral = useMemo(
    () => grades.reduce((a, g) => a + (g.grade_total_planejada || 0), 0),
    [grades],
  );

  useEffect(() => {
    setAviamentos((prev) => prev.map((a) => {
      const qEnviar = Number((a.consumo * gradeTotalGeral).toFixed(4));
      return { ...a, grade_total: gradeTotalGeral, quantidade_enviar: qEnviar };
    }));
  }, [gradeTotalGeral]);

  const firstPhoto = (modelo?.fotos_modelo as string[] | null)?.[0] ?? null;
  const handlePrint = () => window.print();

  return (
    <>
      <div className="container mx-auto p-6 space-y-6 no-print">
        <CadActions
          onPrint={handlePrint}
          onSave={() => saveAll.mutate()}
          onEnviar={() => enviarCorte.mutate()}
          saving={saveAll.isPending}
          enviando={enviarCorte.isPending}
          enviado={!!cadRow?.enviado_corte}
          dataEnviado={cadRow?.data_enviado_corte}
        />

        {/* SEÇÃO 1 */}
        <Card className="p-5 flex gap-5">
          <div className="h-32 w-32 rounded-md bg-muted overflow-hidden flex items-center justify-center">
            {firstPhoto ? (
              <ModeloPhoto path={firstPhoto} />
            ) : (
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-3">
              <Scissors className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold">{modelo?.nome ?? "—"}</h1>
              <Badge variant="outline" className="font-mono">{modelo?.ref ?? "sem REF"}</Badge>
            </div>
            <div className="text-sm text-muted-foreground grid grid-cols-2 gap-x-6 gap-y-1 mt-2">
              <span>Estilista: {modelo?.estilista?.nome ?? "—"}</span>
              <span>Coleção: {modelo?.colecao ?? "—"}</span>
              <span>Categoria: {modelo?.cat_p?.nome ?? "—"}</span>
              <span>Sub-categoria: {modelo?.cat_s?.nome ?? "—"}</span>
            </div>
          </div>
        </Card>

        <CadTecidosSection tecidos={tecidos} updateTec={updateTec} updateVar={updateVar} />

        <CadGradeSection
          grades={grades}
          tamanhosAll={tamanhosAll}
          updateGradePlan={updateGradePlan}
          updateGradeCell={updateGradeCell}
        />

        {/* Datas de corte */}
        <Card className="p-5 grid gap-3 md:grid-cols-3">
          <Field label="Data Enviado ao Corte">
            <Input value={cadRow?.data_enviado_corte ?? ""} readOnly className="bg-muted" />
          </Field>
          <Field label="Previsão de Entrega do Corte">
            <Input type="date" value={previsaoEntrega} onChange={(e) => setPrevisaoEntrega(e.target.value)} />
          </Field>
          <Field label="Data Corte Pronto">
            <Input value={cadRow?.data_corte_pronto ?? ""} readOnly className="bg-muted" />
          </Field>
        </Card>

        <CadExplosaoSection
          aviamentos={aviamentos}
          gradeTotalGeral={gradeTotalGeral}
          updateAvi={updateAvi}
        />
      </div>

      {!cadRow?.enviado_corte && (
        <CadFichaCorte
          modelo={modelo}
          cadRow={cadRow}
          previsaoEntrega={previsaoEntrega}
          tecidos={tecidos}
          grades={grades}
          tamanhosAll={tamanhosAll}
          aviamentos={aviamentos}
          gradeTotalGeral={gradeTotalGeral}
        />
      )}
    </>
  );
}
