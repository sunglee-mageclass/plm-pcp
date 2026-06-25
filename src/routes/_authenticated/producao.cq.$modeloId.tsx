import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ClipboardCheck, Save, CheckCircle2, RotateCcw, Camera, Pencil, Wrench } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { MatrizGradeResponsiva } from "@/components/shared/MatrizGradeResponsiva";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
  const [oficinaOpen, setOficinaOpen] = useState(false);
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

  // Divergência do Recebimento × grade do CAD (p/ banner de alerta). Considera só
  // variantes que já têm algum recebimento lançado.
  const recebDivergente = useMemo(() => {
    return variantList.some(({ num }) => {
      const receb = grades.recebimento[num]?.grades ?? {};
      const rowTotal = Object.values(receb).reduce((s: number, x: any) => s + Number(x || 0), 0);
      if (rowTotal === 0) return false;
      return tamanhos.some((t) => Number(receb[t] ?? 0) !== Number(cadGradeByNum[num]?.grades?.[t] ?? 0));
    });
  }, [grades, variantList, tamanhos, cadGradeByNum]);

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
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-md:pb-24">
      <VerificarRevisao modeloId={modeloId} etapa="cq" />
      {cad?.id && <OficinaServicoDialog cadId={cad.id} open={oficinaOpen} onClose={() => setOficinaOpen(false)} />}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {onClose ? (
            <button onClick={onClose} className="max-sm:hidden text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="h-4 w-4" /> Voltar
            </button>
          ) : (
            <Link to="/producao/cq" className="max-sm:hidden text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="h-4 w-4" /> Voltar
            </Link>
          )}
          {cad?.id && (
            <Button size="sm" variant="outline" onClick={() => setOficinaOpen(true)}>
              <Wrench className="h-3.5 w-3.5 md:mr-1" /> <span className="max-md:sr-only">Oficina</span>
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-40 max-sm:justify-end max-sm:border-t max-sm:bg-background max-sm:p-3 max-sm:shadow-lg">
          {onClose ? (
            <Button type="button" variant="outline" size="icon" className="sm:hidden mr-auto" onClick={onClose} aria-label="Voltar">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : (
            <Button asChild variant="outline" size="icon" className="sm:hidden mr-auto" aria-label="Voltar">
              <Link to="/producao/cq"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
          )}
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
              <Button variant="outline" size="icon" onClick={() => setEditing(true)} disabled={permReadOnly} aria-label="Editar">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={() => desmarcarMut.mutate()} disabled={desmarcarMut.isPending || permReadOnly}>
                <RotateCcw className="h-4 w-4 mr-2" /> Desmarcar confirmação
              </Button>
            </>
          )}
        </div>
      </div>
      <fieldset disabled={readOnly} className="contents">

      <header className="flex items-start gap-3">
        <ClipboardCheck className="h-7 w-7 text-primary mt-0.5 shrink-0" />
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
        <MatrizGradeResponsiva
          tamanhos={tamanhos}
          variantes={variantList.map((v) => ({ num: v.num, label: v.label }))}
          emptyLabel="Sem variantes no Tecido Principal."
          total={(num) => cadGradeByNum[num]?.total ?? 0}
          renderCell={(num, t) => (
            <div className="px-2 py-1 text-center bg-muted/20">{cadGradeByNum[num]?.grades?.[t] ?? 0}</div>
          )}
        />
      </Card>

      {recebDivergente && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          ⚠ O recebimento diverge da grade do CAD em alguns tamanhos (células em vermelho abaixo).
        </div>
      )}

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
        overFn={(num, t, val) => {
          // Alerta de divergência: recebido ≠ grade do CAD (mais OU menos).
          // Só sinaliza depois que a variante já tem algum recebimento lançado,
          // p/ a matriz não ficar toda vermelha antes de digitar.
          const g = Number(cadGradeByNum[num]?.grades?.[t] ?? 0);
          const recebido = grades.recebimento[num]?.grades ?? {};
          const rowTotal = Object.values(recebido).reduce((s: number, x: any) => s + Number(x || 0), 0);
          return rowTotal > 0 && Number(val) !== g;
        }}
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
        <MatrizGradeResponsiva
          tamanhos={tamanhos}
          variantes={variantList.map((v) => ({ num: v.num, label: v.label }))}
          emptyLabel="Sem variantes no Tecido Principal."
          total={(num) => realByNum[num]?.total ?? 0}
          renderCell={(num, t) => (
            <div className="px-2 py-1 text-center bg-muted/20">{realByNum[num]?.grades?.[t] ?? 0}</div>
          )}
          extraHeader="Foto"
          renderExtra={(num) => {
            const foto = !!fotografado[num];
            return (
              <Button
                type="button"
                size="sm"
                variant={foto ? "default" : "outline"}
                className={foto ? "h-7 gap-1 bg-emerald-500 hover:bg-emerald-600" : "h-7 gap-1"}
                onClick={() => setFotografado((f) => ({ ...f, [num]: !f[num] }))}
              >
                <Camera className="h-3.5 w-3.5" /> {foto ? "Sim" : "Não"}
              </Button>
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
    <MatrizGradeResponsiva
      tamanhos={tamanhos}
      variantes={variantList.map((v) => ({ num: v.num, label: labelByNumero[v.num] ?? `Variante ${v.num}` }))}
      emptyLabel="Sem variantes no Tecido Principal."
      total={(num) => grades[etapa][num]?.grade_total ?? 0}
      cellClass={(num, t) => (overFn?.(num, t, Number(grades[etapa][num]?.grades?.[t] ?? 0)) ? "bg-destructive/15" : "")}
      renderCell={(num, t) => {
        const row = grades[etapa][num];
        const over = overFn?.(num, t, Number(row?.grades?.[t] ?? 0)) ?? false;
        return (
          <NumberInput
            type="number"
            className={`h-8 w-full border-0 text-center ${over ? "text-destructive font-semibold" : ""}`}
            value={row?.grades?.[t] ?? ""}
            onChange={(e) => setQtd(etapa, num, t, Number(e.target.value) || 0)}
          />
        );
      }}
      extraHeader={extraCols.length > 0 ? "Ação" : undefined}
      renderExtra={renderExtra}
    />
  );
}

// Janela rápida (pequena) p/ lançar desconto/multa do serviço de OFICINA — a oficina
// só entra no Financeiro após o CQ confirmado, então o ajuste é feito aqui.
function OficinaServicoDialog({ cadId, open, onClose }: { cadId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: serv } = useQuery({
    queryKey: ["cq-oficina-servico", cadId],
    enabled: open && !!cadId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("cq_oficina_servico" as any, { _cad_id: cadId });
      if (error) throw error;
      return data as any;
    },
  });
  const [desc, setDesc] = useState(0);
  const [multa, setMulta] = useState(0);
  useEffect(() => { if (serv) { setDesc(Number(serv.desconto ?? 0)); setMulta(Number(serv.multa ?? 0)); } }, [serv]);
  const brl = (v: number) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const bruto = Number(serv?.custo_bruto ?? 0);
  const liquido = bruto - (Number(desc) || 0) + (Number(multa) || 0);
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("cq_set_oficina_desconto_multa" as any, { _cad_id: cadId, _desconto: Number(desc) || 0, _multa: Number(multa) || 0 });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cq-oficina-servico", cadId] });
      qc.invalidateQueries({ queryKey: ["servicos-financeiro"] });
      // O desconto/multa grava em producao_terceirizados: invalida os caches de
      // terceirizados p/ a tela de Serviços não reescrever por cima com valor antigo
      // (last-write-wins). Over-invalidar aqui só dispara refetch, sem efeito colateral.
      ["producao-terc", "producao-terc-list", "terceirizados-multi", "terceirizados-all"]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success("Oficina atualizada");
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Oficina — desconto / multa</DialogTitle></DialogHeader>
        {!serv ? (
          <p className="text-sm text-muted-foreground">Nenhum serviço de Oficina (externo) neste modelo.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div><span className="text-muted-foreground">Responsável:</span> <b>{serv.responsavel}</b></div>
            <div><span className="text-muted-foreground">Custo bruto:</span> {brl(bruto)}</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Desconto total</Label>
                <NumberInput type="number" step="0.01" value={desc} onChange={(e) => setDesc(Number(e.target.value))} />
              </div>
              <div>
                <Label className="text-xs">Multa total</Label>
                <NumberInput type="number" step="0.01" value={multa} onChange={(e) => setMulta(Number(e.target.value))} />
              </div>
            </div>
            <div className="rounded-md bg-muted/40 px-3 py-2"><span className="text-muted-foreground">Custo líquido:</span> <b>{brl(liquido)}</b></div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} aria-label="Voltar" className="max-sm:w-9 max-sm:px-0">
            <ArrowLeft className="h-4 w-4 sm:hidden" />
            <span className="max-sm:sr-only">Fechar</span>
          </Button>
          {serv && <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
