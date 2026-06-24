import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Compass, Save, CheckCircle2, RotateCcw, Pencil, AlertTriangle, Printer } from "lucide-react";
import { printWithImages } from "@/lib/print";
import { RomaneioDirecionamento } from "@/components/producao/RomaneioDirecionamento";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NumberInput } from "@/components/shared/NumberInput";
import { useReadOnly } from "@/components/RequirePermission";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { VerificarRevisao } from "@/components/producao/RevisaoErro";

export const Route = createFileRoute("/_authenticated/producao/direcionamento/$modeloId")({
  component: DirDetailPage,
});

type VarState = {
  variante_numero: number;
  real: Record<string, number>;
  ecommerce: Record<string, number>;
};

function DirDetailPage() {
  const { modeloId } = Route.useParams();
  return <DirecionamentoDetail modeloId={modeloId} />;
}

export function DirecionamentoDetail({ modeloId, onClose }: { modeloId: string; onClose?: () => void }) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const tenantId = useActiveTenantId();
  // Status do Direcionamento: 'pendente' (default) -> 'separado' ao Confirmar.
  // Confirmado trava as edições; "Editar" reabre e Salvar volta a travar.
  const [status, setStatus] = useState("pendente");
  const [editing, setEditing] = useState(false);

  const { data: modelo } = useQuery({
    queryKey: ["dir-modelo", modeloId],
    queryFn: async () => (await supabase.from("modelos").select("id, ref, nome, colecao").eq("id", modeloId).single()).data,
  });

  const { data: cad } = useQuery({
    queryKey: ["dir-cad", modeloId],
    queryFn: async () => (await (supabase.from("cad") as any).select("id, direcionamento_status, direcionamento_confirmado_at").eq("modelo_id", modeloId).maybeSingle()).data as { id: string; direcionamento_status: string | null; direcionamento_confirmado_at: string | null } | null,
  });
  useEffect(() => {
    if (cad) setStatus((cad as any).direcionamento_status ?? "pendente");
  }, [cad]);

  const { data: tenantCfg } = useQuery({
    queryKey: ["tenant_config", "tamanhos", tenantId],
    enabled: !!tenantId,
    queryFn: async () => (await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", tenantId).maybeSingle()).data,
  });

  const { data: cadGrades = [], isFetched: gradesFetched, isFetching: gradesFetching } = useQuery({
    queryKey: ["cad-grades", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("cad_grades")
        .select("variante_numero, grades_reais")
        .eq("cad_id", cad!.id)
        .order("variante_numero");
      return data ?? [];
    },
  });

  // Apenas os tamanhos presentes na Grade Real (cadastrados), na ordem do
  // tenant_config — não traz os tamanhos da config que o modelo não usa.
  const tamanhos = useMemo<string[]>(() => {
    const cfg = (tenantCfg as any)?.tamanhos_grade;
    const order: string[] = Array.isArray(cfg) && cfg.length ? cfg.map(String) : ["PP", "P", "M", "G", "GG"];
    const present = new Set<string>();
    (cadGrades as any[]).forEach((g) => Object.keys(g.grades_reais ?? {}).forEach((k) => present.add(k)));
    if (present.size === 0) return order;
    const ordered = order.filter((t) => present.has(t));
    const extras = [...present].filter((t) => !ordered.includes(t)).sort();
    return [...ordered, ...extras];
  }, [tenantCfg, cadGrades]);

  const { data: existing = [], refetch, isFetched: existingFetched, isFetching: existingFetching } = useQuery({
    queryKey: ["direcionamento", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase.from("direcionamento").select("*").eq("cad_id", cad!.id);
      return data ?? [];
    },
  });

  // Divergência: a grade real salva no Direcionamento ≠ a grade real atual do CAD
  // (CQ reconfirmado depois) → o split loja física/e-commerce ficou defasado.
  const realDivergente = useMemo(() => {
    if (!(existing as any[]).length) return false;
    const realByNum = new Map((cadGrades as any[]).map((g) => [g.variante_numero, g.grades_reais ?? {}]));
    return (existing as any[]).some((d) => {
      const cur: any = realByNum.get(d.variante_numero) ?? {};
      const saved: any = d.real ?? {};
      const keys = new Set([...Object.keys(cur), ...Object.keys(saved)]);
      return [...keys].some((k) => Number(cur[k] ?? 0) !== Number(saved[k] ?? 0));
    });
  }, [existing, cadGrades]);

  const [state, setState] = useState<Record<number, VarState>>({});
  const [hydrated, setHydrated] = useState(false);

  // Só hidrata quando AMBAS as queries assentaram — senão hidrata do cache vazio
  // (no 1º acesso e ao salvar) e os números somem.
  const dataSettled = gradesFetched && !gradesFetching && existingFetched && !existingFetching;

  useEffect(() => {
    if (hydrated || !cad?.id) return;
    if (!dataSettled) return;
    const obj: Record<number, VarState> = {};
    (cadGrades as any[]).forEach((g) => {
      obj[g.variante_numero] = {
        variante_numero: g.variante_numero,
        real: g.grades_reais ?? {},
        ecommerce: {},
      };
    });
    (existing as any[]).forEach((d) => {
      if (!obj[d.variante_numero]) {
        obj[d.variante_numero] = { variante_numero: d.variante_numero, real: {}, ecommerce: {} };
      }
      obj[d.variante_numero].ecommerce = d.ecommerce ?? {};
    });
    setState(obj);
    setHydrated(true);
  }, [cadGrades, existing, cad?.id, hydrated, dataSettled]);

  const setEcommerce = (num: number, tam: string, qtd: number) => {
    setState((s) => ({
      ...s,
      [num]: { ...(s[num] ?? { variante_numero: num, real: {}, ecommerce: {} }),
        ecommerce: { ...(s[num]?.ecommerce ?? {}), [tam]: qtd } },
    }));
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) throw new Error("CAD não encontrado.");
      const _rows = Object.values(state).map((v) => {
        const lojaFisica: Record<string, number> = {};
        tamanhos.forEach((t) => {
          const real = Number(v.real?.[t] ?? 0);
          const ec = Number(v.ecommerce?.[t] ?? 0);
          lojaFisica[t] = Math.max(0, real - ec);
        });
        const ecTotal = tamanhos.reduce((s, t) => s + Number(v.ecommerce?.[t] ?? 0), 0);
        const lfTotal = tamanhos.reduce((s, t) => s + lojaFisica[t], 0);
        const realTotal = tamanhos.reduce((s, t) => s + Number(v.real?.[t] ?? 0), 0);
        return {
          variante_numero: v.variante_numero,
          ecommerce: v.ecommerce,
          ecommerce_total: ecTotal,
          loja_fisica: lojaFisica,
          loja_fisica_total: lfTotal,
          // Snapshot da grade real usada no cálculo, p/ o registro ser autocontido
          // e permitir detectar divergência se a grade real mudar depois.
          real: v.real,
          grade_real_total: realTotal,
        };
      });
      // RPC transacional com diff por (cad_id, variante_numero): preserva as linhas
      // das variantes mantidas; atômico.
      const { error } = await supabase.rpc("salvar_direcionamento" as any, { _cad_id: cad.id, _rows });
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Salvo");
      setEditing(false); // salvar trava novamente quando já está confirmado
      // Busca os dados frescos ANTES de liberar a hidratação (senão re-hidrata do
      // cache antigo e zera os números).
      await qc.invalidateQueries({ queryKey: ["direcionamento", cad?.id] });
      await refetch();
      setHydrated(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const confirmMut = useMutation({
    mutationFn: async () => {
      await saveMut.mutateAsync();
      if (!cad?.id) throw new Error("CAD não encontrado.");
      const { error } = await supabase
        .from("cad")
        .update({ direcionamento_status: "separado", direcionamento_confirmado_at: new Date().toISOString() } as any)
        .eq("id", cad.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Direcionamento confirmado — Separado");
      setStatus("separado");
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ["dir-cad", modeloId] });
      await qc.invalidateQueries({ queryKey: ["dir-list"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao confirmar"),
  });

  const desmarcarMut = useMutation({
    mutationFn: async () => {
      if (!cad?.id) return;
      const { error } = await supabase
        .from("cad")
        .update({ direcionamento_status: "pendente", direcionamento_confirmado_at: null } as any)
        .eq("id", cad.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Confirmação desmarcada — voltou a editável");
      setStatus("pendente");
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ["dir-cad", modeloId] });
      await qc.invalidateQueries({ queryKey: ["dir-list"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao desmarcar"),
  });

  const confirmado = status === "separado";
  const locked = confirmado && !editing;
  const variantes = Object.values(state).sort((a, b) => a.variante_numero - b.variante_numero);

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-md:pb-24">
      <VerificarRevisao modeloId={modeloId} etapa="direcionamento" />
      {realDivergente && (
        <div className="no-print flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>A grade real mudou desde o último direcionamento salvo. Confira o split e salve novamente.</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        {onClose ? (
          <button onClick={onClose} className="max-md:hidden text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
        ) : (
          <Link to="/producao/direcionamento" className="max-md:hidden text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Link>
        )}
        <div className="flex items-center gap-2 max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:justify-end max-md:border-t max-md:bg-background max-md:p-3 max-md:shadow-lg">
          {onClose ? (
            <Button type="button" variant="outline" size="icon" className="md:hidden mr-auto" onClick={onClose} aria-label="Voltar">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          ) : (
            <Button asChild variant="outline" size="icon" className="md:hidden mr-auto" aria-label="Voltar">
              <Link to="/producao/direcionamento"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
          )}
          <Button variant="outline" className="hidden md:inline-flex" onClick={() => printWithImages()} disabled={variantes.length === 0}>
            <Printer className="h-4 w-4 mr-2" /> Imprimir Romaneio
          </Button>
          {!confirmado ? (
            <>
              <Button variant="outline" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly}>
                <Save className="h-4 w-4 mr-2" /> Salvar
              </Button>
              <Button onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending || saveMut.isPending || readOnly || !cad?.id}>
                <CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar Direcionamento
              </Button>
            </>
          ) : editing ? (
            <>
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly}>
                <Save className="h-4 w-4 mr-2" /> Salvar
              </Button>
              <Button variant="ghost" onClick={() => desmarcarMut.mutate()} disabled={desmarcarMut.isPending || readOnly}>
                <RotateCcw className="h-4 w-4 mr-2" /> Desmarcar
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="icon" onClick={() => setEditing(true)} disabled={readOnly} aria-label="Editar">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" onClick={() => desmarcarMut.mutate()} disabled={desmarcarMut.isPending || readOnly}>
                <RotateCcw className="h-4 w-4 mr-2" /> Desmarcar
              </Button>
            </>
          )}
        </div>
      </div>
      <fieldset disabled={readOnly || locked} className="contents">

      <header className="flex items-center gap-3">
        <Compass className="h-7 w-7 text-primary" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{modelo?.ref ?? "…"} — {modelo?.nome ?? ""}</h1>
          <p className="text-sm text-muted-foreground">{modelo?.colecao ?? "—"}</p>
        </div>
        <Badge className={confirmado ? "bg-emerald-500 hover:bg-emerald-500 text-white" : "bg-amber-500 hover:bg-amber-500 text-white"}>
          {confirmado ? "Separado" : "Pendente"}
        </Badge>
      </header>

      {!cad?.id && (
        <Card className="p-4 border-amber-500/50 bg-amber-500/10 text-sm">
          Sem registro de CAD para este modelo.
        </Card>
      )}

      {variantes.length === 0 && cad?.id && (
        <Card className="p-8 text-center text-sm text-muted-foreground">Nenhuma variante com grade real definida no CAD.</Card>
      )}

      {variantes.map((v) => {
        const realTotal = tamanhos.reduce((s, t) => s + Number(v.real?.[t] ?? 0), 0);
        const ecTotal = tamanhos.reduce((s, t) => s + Number(v.ecommerce?.[t] ?? 0), 0);
        const overSizes = tamanhos.filter((t) => Number(v.ecommerce?.[t] ?? 0) > Number(v.real?.[t] ?? 0));
        return (
          <Card key={v.variante_numero} className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Variante {v.variante_numero}</h3>
              <div className="text-xs text-muted-foreground">Grade Real Total: <strong>{realTotal}</strong></div>
            </div>
            {overSizes.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 text-destructive text-sm px-3 py-2">
                E-commerce excede a Grade Real nos tamanhos: <strong>{overSizes.join(", ")}</strong>.
              </div>
            )}

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="border px-2 py-1 text-left">Linha</th>
                    {tamanhos.map((t) => <th key={t} className="border px-2 py-1 text-center w-20">{t}</th>)}
                    <th className="border px-2 py-1 text-center w-20">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border px-2 py-1 font-medium">Grade Real</td>
                    {tamanhos.map((t) => (
                      <td key={t} className="border px-2 py-1 text-center bg-muted/30">{Number(v.real?.[t] ?? 0)}</td>
                    ))}
                    <td className="border px-2 py-1 text-center font-semibold">{realTotal}</td>
                  </tr>
                  <tr className="bg-amber-100/70 dark:bg-amber-900/30">
                    <td className="border px-2 py-1 font-medium">E-commerce</td>
                    {tamanhos.map((t) => {
                      const real = Number(v.real?.[t] ?? 0);
                      const ec = Number(v.ecommerce?.[t] ?? 0);
                      const over = ec > real;
                      return (
                        <td key={t} className="border p-0">
                          <NumberInput
                            type="number" min={0} max={real}
                            className={`h-8 border-0 bg-transparent text-center ${over ? "text-destructive" : ""}`}
                            value={v.ecommerce?.[t] ?? ""}
                            onChange={(e) => setEcommerce(v.variante_numero, t, Math.max(0, Number(e.target.value) || 0))}
                          />
                        </td>
                      );
                    })}
                    <td className="border px-2 py-1 text-center font-semibold">{ecTotal}</td>
                  </tr>
                  <tr>
                    <td className="border px-2 py-1 font-medium">Loja Física</td>
                    {tamanhos.map((t) => {
                      const real = Number(v.real?.[t] ?? 0);
                      const ec = Number(v.ecommerce?.[t] ?? 0);
                      const lf = Math.max(0, real - ec);
                      return <td key={t} className="border px-2 py-1 text-center bg-muted/20">{lf}</td>;
                    })}
                    <td className="border px-2 py-1 text-center font-semibold">{Math.max(0, realTotal - ecTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Mobile: empilhado por tamanho (some o scroll horizontal ilegível) */}
            <div className="md:hidden grid grid-cols-2 gap-2">
              {tamanhos.map((t) => {
                const real = Number(v.real?.[t] ?? 0);
                const ec = Number(v.ecommerce?.[t] ?? 0);
                const over = ec > real;
                const lf = Math.max(0, real - ec);
                return (
                  <div key={t} className={`rounded-lg border p-2 ${over ? "border-destructive/50" : ""}`}>
                    <div className="mb-1 border-b pb-1 text-center text-xs font-semibold">{t}</div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Grade Real</span>
                      <span className="font-medium">{real}</span>
                    </div>
                    <div className="mt-1">
                      <span className="text-xs text-muted-foreground">E-commerce</span>
                      <NumberInput
                        type="number" min={0} max={real}
                        className={`h-9 text-center ${over ? "border-destructive text-destructive" : ""}`}
                        value={v.ecommerce?.[t] ?? ""}
                        onChange={(e) => setEcommerce(v.variante_numero, t, Math.max(0, Number(e.target.value) || 0))}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Loja Física</span>
                      <span className="font-medium">{lf}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="md:hidden flex justify-between border-t pt-2 text-xs text-muted-foreground">
              <span>Real: <b className="text-foreground">{realTotal}</b></span>
              <span>E-com: <b className="text-foreground">{ecTotal}</b></span>
              <span>Loja: <b className="text-foreground">{Math.max(0, realTotal - ecTotal)}</b></span>
            </div>
          </Card>
        );
      })}
      </fieldset>

      <RomaneioDirecionamento
        modelo={modelo}
        tamanhos={tamanhos}
        variantes={variantes}
        confirmado={confirmado}
        dataStr={new Date().toLocaleDateString("pt-BR")}
      />
    </div>
  );
}
