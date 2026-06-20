import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCheck, Save, CheckCircle2, RotateCcw, Camera, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useReadOnly } from "@/components/RequirePermission";
import { VerificarRevisao } from "@/components/producao/RevisaoErro";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";

export const Route = createFileRoute("/_authenticated/producao/cq/$modeloId")({
  component: CqDetailPage,
});

type Etapa = "recebimento" | "conserto" | "lavagem" | "defeito";
const ETAPAS: Etapa[] = ["recebimento", "conserto", "lavagem", "defeito"];

type VarInfo = { num: number; label: string };

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

// Ordem canônica padrão (mesma do CAD) usada quando o tenant_config não carrega.
const DEFAULT_TAMANHOS = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
// Ordena tokens pelo prefixo numérico ("34|PPP" antes de "36|PP"); fallback alfabético.
const byNumPrefix = (a: string, b: string) => {
  const na = Number(a.split("|")[0]);
  const nb = Number(b.split("|")[0]);
  return Number.isNaN(na) || Number.isNaN(nb) ? a.localeCompare(b) : na - nb;
};

function CqDetailPage() {
  const { modeloId } = Route.useParams();
  return <CqDetail modeloId={modeloId} />;
}

export function CqDetail({ modeloId, onClose }: { modeloId: string; onClose?: () => void }) {
  const qc = useQueryClient();
  const permReadOnly = useReadOnly();
  const tenantId = useActiveTenantId();

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

  // Variantes do Tecido Principal (tipo=tecido, numero=1), rotuladas por cor.
  const { data: mainFabric } = useQuery({
    queryKey: ["cq-main-fabric", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("cad_tecidos")
        .select("tipo, numero, cad_tecido_variantes(ordem, variantes_tecido:variante_tecido_id(nome_variante, cor:cor_id(nome)))")
        .eq("cad_id", cad!.id)
        .eq("tipo", "tecido")
        .eq("numero", 1)
        .maybeSingle();
      return data;
    },
  });

  // Grade cadastrada do modelo (define os Tamanhos exibidos no CQ).
  const { data: modeloGrades = [] } = useQuery({
    queryKey: ["cq-modelo-grades", modeloId],
    queryFn: async () => (await supabase.from("modelo_grades").select("variante_numero, grades, grade_total").eq("modelo_id", modeloId)).data ?? [],
  });

  const { data: tenantCfg } = useQuery({
    queryKey: ["tenant_config", "tamanhos", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", tenantId).maybeSingle()).data,
  });

  // Datas de oficina: vêm de Serviços (producao_terceirizados).
  const { data: tercs = [] } = useQuery({
    queryKey: ["cq-tercs", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("producao_terceirizados")
        .select("data_enviado, data_prevista, data_entregue, ativo")
        .eq("cad_id", cad!.id);
      return (data ?? []).filter((t: any) => t.ativo !== false);
    },
  });

  // Enviado Oficina = data mais antiga; Prevista = mais recente; Entregue = mais recente.
  const oficina = useMemo(() => {
    const enviados = (tercs as any[]).map((t) => t.data_enviado).filter(Boolean).sort();
    const previstas = (tercs as any[]).map((t) => t.data_prevista).filter(Boolean).sort();
    const entregues = (tercs as any[]).map((t) => t.data_entregue).filter(Boolean).sort();
    return {
      enviado: enviados[0] ?? "",
      prevista: previstas[previstas.length - 1] ?? "",
      entregue: entregues[entregues.length - 1] ?? "",
    };
  }, [tercs]);

  // Tamanhos = os cadastrados na grade do modelo, exibidos EXATAMENTE como
  // cadastrados ("34|PPP") e na ordem do tenant_config (default canônico se a
  // config não carregar). Tamanhos fora da config vão ao fim, ordenados pelo nº.
  const tamanhos = useMemo<string[]>(() => {
    const cfg = (tenantCfg as any)?.tamanhos_grade;
    const order: string[] = Array.isArray(cfg) && cfg.length ? cfg.map(String) : DEFAULT_TAMANHOS;
    const present = new Set<string>();
    (modeloGrades as any[]).forEach((g) => Object.keys(g.grades ?? {}).forEach((k) => present.add(k)));
    if (present.size === 0) return order; // ainda sem grade → mostra a config
    const ordered = order.filter((t) => present.has(t));
    const extras = [...present].filter((t) => !ordered.includes(t)).sort(byNumPrefix);
    return [...ordered, ...extras];
  }, [modeloGrades, tenantCfg]);

  // Lista de variantes a exibir (do Tecido Principal; fallback p/ grade do modelo).
  const variantList = useMemo<VarInfo[]>(() => {
    const vs = (((mainFabric as any)?.cad_tecido_variantes ?? []) as any[])
      .filter((v) => v.ordem != null)
      .map((v) => {
        const cor = v.variantes_tecido?.cor?.nome || v.variantes_tecido?.nome_variante || "—";
        return { num: Number(v.ordem), label: `Variante ${v.ordem} - ${cor}` };
      })
      .sort((a, b) => a.num - b.num);
    if (vs.length) return vs;
    return (modeloGrades as any[])
      .map((g) => ({ num: Number(g.variante_numero), label: `Variante ${g.variante_numero}` }))
      .sort((a, b) => a.num - b.num);
  }, [mainFabric, modeloGrades]);

  const labelByNumero = useMemo(() => {
    const m: Record<number, string> = {};
    variantList.forEach((v) => { m[v.num] = v.label; });
    return m;
  }, [variantList]);

  const { data: cqRow, refetch: refetchCq, isFetched: cqFetched, isFetching: cqFetching } = useQuery({
    queryKey: ["cq", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase.from("controle_qualidade").select("*").eq("cad_id", cad!.id).maybeSingle();
      return data;
    },
  });

  const { data: varRows = [], refetch: refetchVars, isFetched: varsFetched, isFetching: varsFetching } = useQuery({
    queryKey: ["cq_variantes", cqRow?.id],
    enabled: !!cqRow?.id,
    queryFn: async () => {
      const { data } = await supabase.from("cq_variantes").select("*").eq("controle_qualidade_id", cqRow!.id);
      return data ?? [];
    },
  });

  const [form, setForm] = useState({
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
  const [fotografado, setFotografado] = useState<Record<number, boolean>>({});
  const [status, setStatus] = useState<string>("pendente");
  const [editing, setEditing] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const confirmado = status === "confirmado";
  // Confirmado trava a edição; "Editar" reabre sem desmarcar a confirmação.
  const readOnly = permReadOnly || (confirmado && !editing);

  // Só hidrata quando as queries ASSENTARAM (fetched && !fetching) — senão, ao
  // salvar, rehidratava do cache vazio/antigo e os números digitados sumiam.
  const cqSettled = cqFetched && !cqFetching;
  const varsSettled = !cqRow?.id || (varsFetched && !varsFetching);

  useEffect(() => {
    if (hydrated || !cad?.id) return;
    if (!cqSettled || !varsSettled) return;
    if (cqRow !== undefined) {
      if (cqRow) {
        setForm({
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
        setStatus((cqRow as any).status ?? "pendente");
        const fv = (cqRow as any).fotografado_variantes ?? {};
        const fmap: Record<number, boolean> = {};
        Object.entries(fv).forEach(([k, v]) => { fmap[Number(k)] = Boolean(v); });
        setFotografado(fmap);
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
  }, [cqRow, varRows, cad?.id, hydrated, cqSettled, varsSettled]);

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

  // Grade editada no CAD (modelo_grades) — referência read-only exibida no topo.
  const cadGradeByNum = useMemo(() => {
    const m: Record<number, { grades: Record<string, number>; total: number }> = {};
    (modeloGrades as any[]).forEach((g) => {
      m[Number(g.variante_numero)] = { grades: g.grades ?? {}, total: Number(g.grade_total ?? 0) };
    });
    return m;
  }, [modeloGrades]);

  // Grade Real = Recebimento − Defeito (por variante, por tamanho; mínimo 0).
  const realByNum = useMemo(() => {
    const out: Record<number, { grades: Record<string, number>; total: number }> = {};
    variantList.forEach(({ num }) => {
      const receb = grades.recebimento[num]?.grades ?? {};
      const def = grades.defeito[num]?.grades ?? {};
      const g: Record<string, number> = {};
      let total = 0;
      tamanhos.forEach((t) => {
        const v = Math.max(0, (Number(receb[t]) || 0) - (Number(def[t]) || 0));
        g[t] = v;
        total += v;
      });
      out[num] = { grades: g, total };
    });
    return out;
  }, [grades, variantList, tamanhos]);

  // Monta os dados do CQ (controle_qualidade + cq_variantes + grade real) para o RPC.
  const buildCqData = () => {
    const cq = {
      // Datas de oficina vêm de Serviços (read-only no CQ) — gravadas como snapshot.
      data_recebimento_enviado_oficina: oficina.enviado || null,
      data_recebimento_prevista: oficina.prevista || null,
      data_recebimento_entregue: oficina.entregue || null,
      data_conserto_enviado: form.data_conserto_enviado || null,
      data_conserto_prevista: form.data_conserto_prevista || null,
      data_conserto_entregue: form.data_conserto_entregue || null,
      data_lavagem_enviado: form.data_lavagem_enviado || null,
      data_lavagem_entregue: form.data_lavagem_entregue || null,
      observacoes_cq: form.observacoes_cq,
      pecas_incompletas: form.pecas_incompletas,
      pecas_faltantes: form.pecas_faltantes,
      pecas_sem_etiqueta: form.pecas_sem_etiqueta,
      fotografado_variantes: Object.fromEntries(
        variantList.filter((v) => fotografado[v.num]).map((v) => [String(v.num), true]),
      ),
    };
    const variantes: any[] = [];
    ETAPAS.forEach((et) => {
      Object.values(grades[et]).forEach((r) => {
        const hasAny = r.grade_total > 0 || (et === "defeito" && r.destino_defeito);
        if (!hasAny) return;
        variantes.push({
          variante_numero: r.variante_numero,
          etapa: et,
          grades: r.grades,
          grade_total: r.grade_total,
          destino_defeito: et === "defeito" ? r.destino_defeito ?? null : null,
        });
      });
    });
    const reais = variantList.map((v) => ({
      variante_numero: v.num,
      grades: realByNum[v.num]?.grades ?? {},
      grade_total: realByNum[v.num]?.total ?? 0,
    }));
    return { cq, variantes, reais };
  };

  // RPC transacional: salva (e opcionalmente confirma) o CQ. cq_variantes e a
  // Grade Real (cad_grades) na MESMA transação — tudo ou nada.
  const saveCq = async (confirmar: boolean) => {
    if (!cad?.id) throw new Error("CAD não encontrado. Abra o CAD desse modelo primeiro.");
    const { cq, variantes, reais } = buildCqData();
    const { error } = await supabase.rpc("salvar_cq" as any, {
      _cad_id: cad.id,
      _cq: cq,
      _variantes: variantes,
      _reais: reais,
      _confirmar: confirmar,
    });
    if (error) throw error;
  };

  const saveMut = useMutation({
    mutationFn: () => saveCq(false),
    onSuccess: async () => {
      toast.success("Salvo");
      setEditing(false);
      // Busca os dados frescos ANTES de liberar a hidratação (senão re-hidrata do
      // cache antigo/vazio e zera os números).
      await qc.invalidateQueries({ queryKey: ["cq", cad?.id] });
      await refetchCq();
      await refetchVars();
      setHydrated(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const confirmMut = useMutation({
    mutationFn: () => saveCq(true),
    onSuccess: async () => {
      toast.success("Controle de Qualidade confirmado — enviado ao Direcionamento");
      setStatus("confirmado");
      await qc.invalidateQueries({ queryKey: ["cq", cad?.id] });
      await qc.invalidateQueries({ queryKey: ["producao-cq-list"] });
      await qc.invalidateQueries({ queryKey: ["dir-list"] });
      await refetchCq();
      await refetchVars();
      setHydrated(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao confirmar"),
  });

  const desmarcarMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) return;
      const { error } = await supabase.rpc("desmarcar_cq" as any, { _cad_id: cad.id });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Confirmação desmarcada — CQ voltou a editável");
      setStatus("pendente");
      await qc.invalidateQueries({ queryKey: ["cq", cad?.id] });
      await qc.invalidateQueries({ queryKey: ["producao-cq-list"] });
      await qc.invalidateQueries({ queryKey: ["dir-list"] });
      await refetchCq();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao desmarcar"),
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <VerificarRevisao modeloId={modeloId} etapa="cq" />
      <div className="flex items-center justify-between gap-2">
        {onClose ? (
          <button onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
        ) : (
          <Link to="/producao/cq" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
        )}
        <div className="flex items-center gap-2">
          {!confirmado ? (
            <>
              <Button variant="outline" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || permReadOnly}>
                <Save className="h-4 w-4 mr-2" /> Salvar
              </Button>
              <Button onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending || saveMut.isPending || permReadOnly || !cad?.id}>
                <CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar Controle de Qualidade
              </Button>
            </>
          ) : editing ? (
            <>
              <Button variant="ghost" onClick={() => { setEditing(false); setHydrated(false); }} disabled={saveMut.isPending}>
                Cancelar
              </Button>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || permReadOnly}>
                <Save className="h-4 w-4 mr-2" /> Salvar
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditing(true)} disabled={permReadOnly}>
                <Pencil className="h-4 w-4 mr-2" /> Editar
              </Button>
              <Button variant="outline" onClick={() => desmarcarMut.mutate()} disabled={desmarcarMut.isPending || permReadOnly}>
                <RotateCcw className="h-4 w-4 mr-2" /> Desmarcar confirmação
              </Button>
            </>
          )}
        </div>
      </div>
      <fieldset disabled={readOnly} className="contents">

      <header className="flex items-center gap-3">
        <ClipboardCheck className="h-7 w-7 text-primary" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{modelo?.ref ?? "…"} — {modelo?.nome ?? ""}</h1>
          <p className="text-sm text-muted-foreground">
            {(modelo as any)?.categorias_produto?.nome ?? "—"} • {modelo?.colecao ?? "—"}
          </p>
        </div>
        <Badge className={confirmado ? "bg-emerald-500 hover:bg-emerald-500 text-white" : "bg-amber-500 hover:bg-amber-500 text-white"}>
          {confirmado ? "Confirmado" : "Pendente"}
        </Badge>
      </header>

      {!cad?.id && (
        <Card className="p-4 border-amber-500/50 bg-amber-500/10 text-sm">
          Este modelo ainda não tem registro de CAD. Abra a página de CAD desse modelo antes de salvar.
        </Card>
      )}

      {/* Grade editada no CAD (referência, read-only) */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">Grade (CAD)</h3>
          <span className="text-xs text-muted-foreground">Grade planejada no CAD · referência</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="border px-2 py-1 text-left">Variante</th>
                {tamanhos.map((t) => <th key={t} className="border px-2 py-1 text-center w-16">{t}</th>)}
                <th className="border px-2 py-1 text-center w-20">Total</th>
              </tr>
            </thead>
            <tbody>
              {variantList.length === 0 && (
                <tr><td className="border px-2 py-2 text-muted-foreground" colSpan={tamanhos.length + 2}>Sem variantes no Tecido Principal.</td></tr>
              )}
              {variantList.map(({ num, label }) => {
                const g = cadGradeByNum[num] ?? { grades: {}, total: 0 };
                return (
                  <tr key={num}>
                    <td className="border px-2 py-1">{label}</td>
                    {tamanhos.map((t) => (
                      <td key={t} className="border px-2 py-1 text-center bg-muted/20">{g.grades[t] ?? 0}</td>
                    ))}
                    <td className="border px-2 py-1 text-center font-semibold">{g.total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Seção 1 - Recebimento (datas vêm de Serviços, read-only) */}
      <EtapaSection
        title="1. Recebimento"
        etapa="recebimento"
        datas={[
          { label: "Data Enviado Oficina", value: oficina.enviado },
          { label: "Data Prevista", value: oficina.prevista },
          { label: "Data Entregue", value: oficina.entregue },
        ]}
        readOnlyDatas
        tamanhos={tamanhos}
        variantList={variantList}
        labelByNumero={labelByNumero}
        grades={grades}
        setQtd={setQtd}
        overFn={(num, t, val) => val > (cadGradeByNum[num]?.grades?.[t] ?? 0)}
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
        variantList={variantList}
        labelByNumero={labelByNumero}
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
        variantList={variantList}
        labelByNumero={labelByNumero}
        grades={grades}
        setQtd={setQtd}
      />

      {/* Seção 4 - Defeito */}
      <Card className="p-5 space-y-3">
        <h3 className="font-semibold text-lg">4. Defeito</h3>
        <GradeMatrix
          etapa="defeito"
          tamanhos={tamanhos}
          variantList={variantList}
          labelByNumero={labelByNumero}
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

      {/* Grade Real = Recebimento − Defeito (read-only). É a grade usada no Direcionamento. */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-lg">Grade Real</h3>
          <span className="text-xs text-muted-foreground">Recebimento − Defeito · usada no Direcionamento</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="border px-2 py-1 text-left">Variante</th>
                {tamanhos.map((t) => <th key={t} className="border px-2 py-1 text-center w-16">{t}</th>)}
                <th className="border px-2 py-1 text-center w-20">Total</th>
                <th className="border px-2 py-1 text-center w-24">Foto</th>
              </tr>
            </thead>
            <tbody>
              {variantList.length === 0 && (
                <tr><td className="border px-2 py-2 text-muted-foreground" colSpan={tamanhos.length + 3}>Sem variantes no Tecido Principal.</td></tr>
              )}
              {variantList.map(({ num, label }) => {
                const real = realByNum[num] ?? { grades: {}, total: 0 };
                const foto = !!fotografado[num];
                return (
                  <tr key={num}>
                    <td className="border px-2 py-1">{label}</td>
                    {tamanhos.map((t) => (
                      <td key={t} className="border px-2 py-1 text-center bg-muted/20">{real.grades[t] ?? 0}</td>
                    ))}
                    <td className="border px-2 py-1 text-center font-semibold">{real.total}</td>
                    <td className="border px-2 py-1 text-center">
                      <Button
                        type="button"
                        size="sm"
                        variant={foto ? "default" : "outline"}
                        className={foto ? "h-7 gap-1 bg-emerald-500 hover:bg-emerald-600" : "h-7 gap-1"}
                        onClick={() => setFotografado((f) => ({ ...f, [num]: !f[num] }))}
                      >
                        <Camera className="h-3.5 w-3.5" /> {foto ? "Sim" : "Não"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Gerais */}
      <Card className="p-5 space-y-4">
        <h3 className="font-semibold text-lg">Campos Gerais</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label className="text-xs">Peças Incompletas</Label>
            <NumberInput type="number" value={form.pecas_incompletas}
              onChange={(e) => setForm((f) => ({ ...f, pecas_incompletas: Number(e.target.value) }))} />
          </div>
          <div>
            <Label className="text-xs">Peças Faltantes</Label>
            <NumberInput type="number" value={form.pecas_faltantes}
              onChange={(e) => setForm((f) => ({ ...f, pecas_faltantes: Number(e.target.value) }))} />
          </div>
          <div>
            <Label className="text-xs">Peças sem Etiqueta</Label>
            <NumberInput type="number" value={form.pecas_sem_etiqueta}
              onChange={(e) => setForm((f) => ({ ...f, pecas_sem_etiqueta: Number(e.target.value) }))} />
          </div>
        </div>
        <div>
          <Label className="text-xs">Observações do Controle de Qualidade</Label>
          <Textarea rows={3} value={form.observacoes_cq}
            onChange={(e) => setForm((f) => ({ ...f, observacoes_cq: e.target.value }))} />
        </div>
      </Card>
      </fieldset>
    </div>
  );
}

// ===== sub-components =====

type DataEditavel = { key: string; label: string; value?: undefined };
type DataReadOnly = { key?: undefined; label: string; value: string };

function EtapaSection(props: {
  title: string;
  etapa: Etapa;
  datas: (DataEditavel | DataReadOnly)[];
  readOnlyDatas?: boolean;
  form?: any;
  setForm?: (fn: (f: any) => any) => void;
  tamanhos: string[];
  variantList: VarInfo[];
  labelByNumero: Record<number, string>;
  grades: GradesByEtapa;
  setQtd: (etapa: Etapa, num: number, tam: string, qtd: number) => void;
  overFn?: (num: number, tam: string, val: number) => boolean;
}) {
  const { title, etapa, datas, readOnlyDatas, form, setForm, tamanhos, variantList, labelByNumero, grades, setQtd, overFn } = props;
  return (
    <Card className="p-5 space-y-4">
      <h3 className="font-semibold text-lg">{title}</h3>
      <div className="grid gap-4 md:grid-cols-3">
        {datas.map((d) => (
          <div key={d.label}>
            <Label className="text-xs">{d.label}</Label>
            {readOnlyDatas ? (
              <Input type="date" value={d.value ?? ""} readOnly className="bg-muted" />
            ) : (
              <Input
                type="date"
                value={form?.[d.key as string] ?? ""}
                onChange={(e) => setForm?.((f: any) => ({ ...f, [d.key as string]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </div>
      <GradeMatrix
        etapa={etapa}
        tamanhos={tamanhos}
        variantList={variantList}
        labelByNumero={labelByNumero}
        grades={grades}
        setQtd={setQtd}
        overFn={overFn}
      />
    </Card>
  );
}

function GradeMatrix(props: {
  etapa: Etapa;
  tamanhos: string[];
  variantList: VarInfo[];
  labelByNumero: Record<number, string>;
  grades: GradesByEtapa;
  setQtd: (etapa: Etapa, num: number, tam: string, qtd: number) => void;
  extraCols?: string[];
  renderExtra?: (variante_numero: number) => React.ReactNode;
  /** Marca a célula em vermelho quando o valor for "demais" (ex.: recebimento > grade do CAD). */
  overFn?: (num: number, tam: string, val: number) => boolean;
}) {
  const { etapa, tamanhos, variantList, labelByNumero, grades, setQtd, extraCols = [], renderExtra, overFn } = props;

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
          {variantList.length === 0 && (
            <tr><td className="border px-2 py-2 text-muted-foreground" colSpan={tamanhos.length + 2 + extraCols.length}>Sem variantes no Tecido Principal.</td></tr>
          )}
          {variantList.map(({ num }) => {
            const row = grades[etapa][num];
            return (
              <tr key={num}>
                <td className="border px-2 py-1">{labelByNumero[num] ?? `Variante ${num}`}</td>
                {tamanhos.map((t) => {
                  const over = overFn?.(num, t, Number(row?.grades?.[t] ?? 0)) ?? false;
                  return (
                    <td key={t} className={`border p-0 ${over ? "bg-destructive/15" : ""}`}>
                      <NumberInput
                        type="number"
                        className={`h-8 border-0 text-center ${over ? "text-destructive font-semibold" : ""}`}
                        value={row?.grades?.[t] ?? ""}
                        onChange={(e) => setQtd(etapa, num, t, Number(e.target.value) || 0)}
                      />
                    </td>
                  );
                })}
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
