import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCheck, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/producao/cq/$modeloId")({
  component: CqDetailPage,
});

type Etapa = "recebimento" | "conserto" | "lavagem" | "defeito";
const ETAPAS: Etapa[] = ["recebimento", "conserto", "lavagem", "defeito"];

type VarRow = {
  id?: string;
  variante_numero: number;
  grades: Record<string, number>;
  grade_total: number;
  destino_defeito?: string | null;
};

// Map of etapa -> map of variante_numero -> VarRow
type GradesByEtapa = Record<Etapa, Record<number, VarRow>>;

function emptyGrades(): GradesByEtapa {
  return { recebimento: {}, conserto: {}, lavagem: {}, defeito: {} };
}

function CqDetailPage() {
  const { modeloId } = Route.useParams();
  const qc = useQueryClient();

  const { data: modelo } = useQuery({
    queryKey: ["cq-modelo", modeloId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, ref, nome, colecao, categorias_produto:categoria_principal_id(nome)")
        .eq("id", modeloId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: cad } = useQuery({
    queryKey: ["cq-cad", modeloId],
    queryFn: async () => {
      const { data } = await supabase.from("cad").select("id").eq("modelo_id", modeloId).maybeSingle();
      return data;
    },
  });

  const { data: tenantCfg } = useQuery({
    queryKey: ["tenant_config", "tamanhos"],
    queryFn: async () => (await supabase.from("tenant_config").select("tamanhos_grade").maybeSingle()).data,
  });

  // Tamanhos: from tenant_config.tamanhos_grade (array of strings) or default PP..GGG
  const tamanhos = useMemo<string[]>(() => {
    const t = (tenantCfg as any)?.tamanhos_grade;
    if (Array.isArray(t) && t.length) return t.map(String);
    return ["PP", "P", "M", "G", "GG"];
  }, [tenantCfg]);

  const { data: cqRow, refetch: refetchCq } = useQuery({
    queryKey: ["cq", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase.from("controle_qualidade").select("*").eq("cad_id", cad!.id).maybeSingle();
      return data;
    },
  });

  const { data: varRows = [], refetch: refetchVars } = useQuery({
    queryKey: ["cq_variantes", cqRow?.id],
    enabled: !!cqRow?.id,
    queryFn: async () => {
      const { data } = await supabase.from("cq_variantes").select("*").eq("controle_qualidade_id", cqRow!.id);
      return data ?? [];
    },
  });

  const [form, setForm] = useState({
    data_recebimento_enviado_oficina: "",
    data_recebimento_prevista: "",
    data_recebimento_entregue: "",
    data_conserto_enviado: "",
    data_conserto_prevista: "",
    data_conserto_entregue: "",
    data_lavagem_enviado: "",
    data_lavagem_entregue: "",
    observacoes_cq: "",
    pecas_incompletas: 0,
    pecas_faltantes: 0,
    pecas_sem_etiqueta: 0,
  });
  const [grades, setGrades] = useState<GradesByEtapa>(emptyGrades());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated || !cad?.id) return;
    if (cqRow !== undefined) {
      if (cqRow) {
        setForm({
          data_recebimento_enviado_oficina: cqRow.data_recebimento_enviado_oficina ?? "",
          data_recebimento_prevista: cqRow.data_recebimento_prevista ?? "",
          data_recebimento_entregue: cqRow.data_recebimento_entregue ?? "",
          data_conserto_enviado: cqRow.data_conserto_enviado ?? "",
          data_conserto_prevista: cqRow.data_conserto_prevista ?? "",
          data_conserto_entregue: cqRow.data_conserto_entregue ?? "",
          data_lavagem_enviado: cqRow.data_lavagem_enviado ?? "",
          data_lavagem_entregue: cqRow.data_lavagem_entregue ?? "",
          observacoes_cq: cqRow.observacoes_cq ?? "",
          pecas_incompletas: Number(cqRow.pecas_incompletas ?? 0),
          pecas_faltantes: Number(cqRow.pecas_faltantes ?? 0),
          pecas_sem_etiqueta: Number(cqRow.pecas_sem_etiqueta ?? 0),
        });
      }
      const g = emptyGrades();
      (varRows as any[]).forEach((v) => {
        const et = v.etapa as Etapa;
        if (!ETAPAS.includes(et)) return;
        g[et][v.variante_numero] = {
          id: v.id,
          variante_numero: v.variante_numero,
          grades: v.grades ?? {},
          grade_total: Number(v.grade_total ?? 0),
          destino_defeito: v.destino_defeito,
        };
      });
      setGrades(g);
      setHydrated(true);
    }
  }, [cqRow, varRows, cad?.id, hydrated]);

  const ensureRow = (etapa: Etapa, num: number): VarRow => {
    return grades[etapa][num] ?? { variante_numero: num, grades: {}, grade_total: 0 };
  };

  const setQtd = (etapa: Etapa, num: number, tam: string, qtd: number) => {
    setGrades((g) => {
      const row = { ...ensureRow(etapa, num) };
      row.grades = { ...row.grades, [tam]: qtd };
      row.grade_total = Object.values(row.grades).reduce((s, v) => s + (Number(v) || 0), 0);
      return { ...g, [etapa]: { ...g[etapa], [num]: row } };
    });
  };

  const setDestinoDefeito = (num: number, destino: "2_lote" | "cancelado") => {
    setGrades((g) => {
      const row = { ...ensureRow("defeito", num) };
      row.destino_defeito = row.destino_defeito === destino ? null : destino;
      return { ...g, defeito: { ...g.defeito, [num]: row } };
    });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) throw new Error("CAD não encontrado. Abra o CAD desse modelo primeiro.");
      const payload = {
        cad_id: cad.id,
        data_recebimento_enviado_oficina: form.data_recebimento_enviado_oficina || null,
        data_recebimento_prevista: form.data_recebimento_prevista || null,
        data_recebimento_entregue: form.data_recebimento_entregue || null,
        data_conserto_enviado: form.data_conserto_enviado || null,
        data_conserto_prevista: form.data_conserto_prevista || null,
        data_conserto_entregue: form.data_conserto_entregue || null,
        data_lavagem_enviado: form.data_lavagem_enviado || null,
        data_lavagem_entregue: form.data_lavagem_entregue || null,
        observacoes_cq: form.observacoes_cq,
        pecas_incompletas: form.pecas_incompletas,
        pecas_faltantes: form.pecas_faltantes,
        pecas_sem_etiqueta: form.pecas_sem_etiqueta,
      };

      let cqId = cqRow?.id;
      if (cqId) {
        const { error } = await supabase.from("controle_qualidade").update(payload).eq("id", cqId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("controle_qualidade").insert(payload).select("id").single();
        if (error) throw error;
        cqId = data.id;
      }

      // Replace cq_variantes
      const { error: delErr } = await supabase.from("cq_variantes").delete().eq("controle_qualidade_id", cqId);
      if (delErr) throw delErr;

      const rows: any[] = [];
      ETAPAS.forEach((et) => {
        Object.values(grades[et]).forEach((r) => {
          const hasAny = r.grade_total > 0 || (et === "defeito" && r.destino_defeito);
          if (!hasAny) return;
          rows.push({
            controle_qualidade_id: cqId,
            variante_numero: r.variante_numero,
            etapa: et,
            grades: r.grades,
            grade_total: r.grade_total,
            destino_defeito: et === "defeito" ? r.destino_defeito ?? null : null,
          });
        });
      });
      if (rows.length) {
        const { error } = await supabase.from("cq_variantes").insert(rows);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      toast.success("Salvo");
      setHydrated(false);
      await qc.invalidateQueries({ queryKey: ["cq", cad?.id] });
      await refetchCq();
      await refetchVars();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/producao/cq" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          <Save className="h-4 w-4 mr-2" /> Salvar
        </Button>
      </div>

      <header className="flex items-center gap-3">
        <ClipboardCheck className="h-7 w-7 text-primary" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{modelo?.ref ?? "…"} — {modelo?.nome ?? ""}</h1>
          <p className="text-sm text-muted-foreground">
            {(modelo as any)?.categorias_produto?.nome ?? "—"} • {modelo?.colecao ?? "—"}
          </p>
        </div>
      </header>

      {!cad?.id && (
        <Card className="p-4 border-amber-500/50 bg-amber-500/10 text-sm">
          Este modelo ainda não tem registro de CAD. Abra a página de CAD desse modelo antes de salvar.
        </Card>
      )}

      {/* Seção 1 - Recebimento */}
      <EtapaSection
        title="1. Recebimento"
        etapa="recebimento"
        datas={[
          { key: "data_recebimento_enviado_oficina", label: "Data Enviado Oficina" },
          { key: "data_recebimento_prevista", label: "Data Prevista" },
          { key: "data_recebimento_entregue", label: "Data Entregue" },
        ]}
        form={form}
        setForm={setForm}
        tamanhos={tamanhos}
        grades={grades}
        setQtd={setQtd}
      />

      {/* Seção 2 - Conserto */}
      <EtapaSection
        title="2. Conserto"
        etapa="conserto"
        datas={[
          { key: "data_conserto_enviado", label: "Data Enviado" },
          { key: "data_conserto_prevista", label: "Data Prevista" },
          { key: "data_conserto_entregue", label: "Data Entregue" },
        ]}
        form={form}
        setForm={setForm}
        tamanhos={tamanhos}
        grades={grades}
        setQtd={setQtd}
      />

      {/* Seção 3 - Lavagem */}
      <EtapaSection
        title="3. Lavagem"
        etapa="lavagem"
        datas={[
          { key: "data_lavagem_enviado", label: "Data Enviado" },
          { key: "data_lavagem_entregue", label: "Data Entregue" },
        ]}
        form={form}
        setForm={setForm}
        tamanhos={tamanhos}
        grades={grades}
        setQtd={setQtd}
      />

      {/* Seção 4 - Defeito */}
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold text-lg">4. Defeito</h3>
        <GradeMatrix
          etapa="defeito"
          tamanhos={tamanhos}
          grades={grades}
          setQtd={setQtd}
          extraCols={["destino"]}
          renderExtra={(num) => {
            const row = grades.defeito[num];
            return (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={row?.destino_defeito === "2_lote" ? "default" : "outline"}
                  onClick={() => setDestinoDefeito(num, "2_lote")}
                >2º Lote</Button>
                <Button
                  size="sm"
                  variant={row?.destino_defeito === "cancelado" ? "destructive" : "outline"}
                  onClick={() => setDestinoDefeito(num, "cancelado")}
                >Cancelado</Button>
              </div>
            );
          }}
        />
      </Card>

      {/* Gerais */}
      <Card className="p-5 space-y-4">
        <h3 className="font-semibold text-lg">Campos Gerais</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label className="text-xs">Peças Incompletas</Label>
            <Input type="number" value={form.pecas_incompletas}
              onChange={(e) => setForm((f) => ({ ...f, pecas_incompletas: Number(e.target.value) }))} />
          </div>
          <div>
            <Label className="text-xs">Peças Faltantes</Label>
            <Input type="number" value={form.pecas_faltantes}
              onChange={(e) => setForm((f) => ({ ...f, pecas_faltantes: Number(e.target.value) }))} />
          </div>
          <div>
            <Label className="text-xs">Peças sem Etiqueta</Label>
            <Input type="number" value={form.pecas_sem_etiqueta}
              onChange={(e) => setForm((f) => ({ ...f, pecas_sem_etiqueta: Number(e.target.value) }))} />
          </div>
        </div>
        <div>
          <Label className="text-xs">Observações CQ</Label>
          <Textarea rows={3} value={form.observacoes_cq}
            onChange={(e) => setForm((f) => ({ ...f, observacoes_cq: e.target.value }))} />
        </div>
      </Card>
    </div>
  );
}

// ===== sub-components =====

function EtapaSection(props: {
  title: string;
  etapa: Etapa;
  datas: { key: keyof any; label: string }[];
  form: any;
  setForm: (fn: (f: any) => any) => void;
  tamanhos: string[];
  grades: GradesByEtapa;
  setQtd: (etapa: Etapa, num: number, tam: string, qtd: number) => void;
}) {
  const { title, etapa, datas, form, setForm, tamanhos, grades, setQtd } = props;
  return (
    <Card className="p-5 space-y-4">
      <h3 className="font-semibold text-lg">{title}</h3>
      <div className="grid gap-4 md:grid-cols-3">
        {datas.map((d) => (
          <div key={String(d.key)}>
            <Label className="text-xs">{d.label}</Label>
            <Input type="date" value={form[d.key as string] ?? ""}
              onChange={(e) => setForm((f: any) => ({ ...f, [d.key]: e.target.value }))} />
          </div>
        ))}
      </div>
      <GradeMatrix etapa={etapa} tamanhos={tamanhos} grades={grades} setQtd={setQtd} />
    </Card>
  );
}

function GradeMatrix(props: {
  etapa: Etapa;
  tamanhos: string[];
  grades: GradesByEtapa;
  setQtd: (etapa: Etapa, num: number, tam: string, qtd: number) => void;
  extraCols?: string[];
  renderExtra?: (variante_numero: number) => React.ReactNode;
}) {
  const { etapa, tamanhos, grades, setQtd, extraCols = [], renderExtra } = props;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted/50">
            <th className="border px-2 py-1 text-left">Variante</th>
            {tamanhos.map((t) => (
              <th key={t} className="border px-2 py-1 text-center w-16">{t}</th>
            ))}
            <th className="border px-2 py-1 text-center w-20">Total</th>
            {extraCols.map((c) => (
              <th key={c} className="border px-2 py-1 text-center">Ação</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => {
            const row = grades[etapa][num];
            return (
              <tr key={num}>
                <td className="border px-2 py-1">Variante {num}</td>
                {tamanhos.map((t) => (
                  <td key={t} className="border p-0">
                    <Input
                      type="number"
                      className="h-8 border-0 text-center"
                      value={row?.grades?.[t] ?? ""}
                      onChange={(e) => setQtd(etapa, num, t, Number(e.target.value) || 0)}
                    />
                  </td>
                ))}
                <td className="border px-2 py-1 text-center font-semibold">{row?.grade_total ?? 0}</td>
                {extraCols.length > 0 && (
                  <td className="border px-2 py-1">
                    {renderExtra ? renderExtra(num) : null}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
