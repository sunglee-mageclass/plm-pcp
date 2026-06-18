import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Compass, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { useReadOnly } from "@/components/RequirePermission";

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
  const qc = useQueryClient();
  const readOnly = useReadOnly();

  const { data: modelo } = useQuery({
    queryKey: ["dir-modelo", modeloId],
    queryFn: async () => (await supabase.from("modelos").select("id, ref, nome, colecao").eq("id", modeloId).single()).data,
  });

  const { data: cad } = useQuery({
    queryKey: ["dir-cad", modeloId],
    queryFn: async () => (await supabase.from("cad").select("id").eq("modelo_id", modeloId).maybeSingle()).data,
  });

  const { data: tenantCfg } = useQuery({
    queryKey: ["tenant_config", "tamanhos"],
    queryFn: async () => (await supabase.from("tenant_config").select("tamanhos_grade").maybeSingle()).data,
  });

  const { data: cadGrades = [] } = useQuery({
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

  const { data: existing = [], refetch } = useQuery({
    queryKey: ["direcionamento", cad?.id],
    enabled: !!cad?.id,
    queryFn: async () => {
      const { data } = await supabase.from("direcionamento").select("*").eq("cad_id", cad!.id);
      return data ?? [];
    },
  });

  const [state, setState] = useState<Record<number, VarState>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated || !cad?.id) return;
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
  }, [cadGrades, existing, cad?.id, hydrated]);

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
      const { error: delErr } = await supabase.from("direcionamento").delete().eq("cad_id", cad.id);
      if (delErr) throw delErr;

      const payload = Object.values(state).map((v) => {
        const lojaFisica: Record<string, number> = {};
        tamanhos.forEach((t) => {
          const real = Number(v.real?.[t] ?? 0);
          const ec = Number(v.ecommerce?.[t] ?? 0);
          lojaFisica[t] = Math.max(0, real - ec);
        });
        const ecTotal = tamanhos.reduce((s, t) => s + Number(v.ecommerce?.[t] ?? 0), 0);
        const lfTotal = tamanhos.reduce((s, t) => s + lojaFisica[t], 0);
        return {
          cad_id: cad.id,
          variante_numero: v.variante_numero,
          ecommerce: v.ecommerce,
          ecommerce_total: ecTotal,
          loja_fisica: lojaFisica,
          loja_fisica_total: lfTotal,
        };
      });
      if (payload.length) {
        const { error } = await supabase.from("direcionamento").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      toast.success("Salvo");
      setHydrated(false);
      await qc.invalidateQueries({ queryKey: ["direcionamento", cad?.id] });
      await refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro"),
  });

  const variantes = Object.values(state).sort((a, b) => a.variante_numero - b.variante_numero);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/producao/direcionamento" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || readOnly}>
          <Save className="h-4 w-4 mr-2" /> Salvar
        </Button>
      </div>
      <fieldset disabled={readOnly} className="contents">

      <header className="flex items-center gap-3">
        <Compass className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">{modelo?.ref ?? "…"} — {modelo?.nome ?? ""}</h1>
          <p className="text-sm text-muted-foreground">{modelo?.colecao ?? "—"}</p>
        </div>
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

            <div className="overflow-x-auto">
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
          </Card>
        );
      })}
      </fieldset>
    </div>
  );
}
