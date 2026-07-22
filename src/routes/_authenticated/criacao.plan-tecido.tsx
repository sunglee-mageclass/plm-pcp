import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantModules } from "@/hooks/useTenantModules";
import { RequirePermission } from "@/components/RequirePermission";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Scissors } from "lucide-react";
import { FilterButton } from "@/components/shared/filters";
import { PlanTecidoSheet } from "@/components/plan-tecido/PlanTecidoSheet";

export const Route = createFileRoute("/_authenticated/criacao/plan-tecido")({
  component: () => (
    <RequirePermission page="criacao_plan_tecido">
      <PlanTecidoListPage />
    </RequirePermission>
  ),
});

type ColecaoRow = { id: string; nome: string; tipo: string | null; status: string | null; mes_id: string | null; ano_id: string | null };
type Opt = { id: string; nome: string };

function useOpts(table: string, key = "nome") {
  return useQuery({
    queryKey: ["opt", table, key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(table as any)
        .select(`id, ${key}`)
        .order(table === "meses" ? "ordem" : key);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ id: r.id, nome: r[key] })) as Opt[];
    },
  });
}

function PlanTecidoListPage() {
  const { isModuleEnabled } = useTenantModules();
  const [openColecaoId, setOpenColecaoId] = useState<string | null>(null);

  const { data: colecoes = [] } = useQuery({
    queryKey: ["plan-tecido-colecoes"],
    queryFn: async () =>
      ((await supabase.from("colecoes").select("id, nome, tipo, status, mes_id, ano_id").order("created_at", { ascending: false })).data ?? []) as ColecaoRow[],
  });

  const { data: meses = [] } = useOpts("meses", "mes");
  const { data: anos = [] } = useOpts("anos", "ano");
  const mesMap = useMemo(() => Object.fromEntries(meses.map((m) => [m.id, m.nome])), [meses]);
  const anoMap = useMemo(() => Object.fromEntries(anos.map((a) => [a.id, a.nome])), [anos]);

  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fTipo, setFTipo] = useState("all");

  const filtered = useMemo(() => {
    return colecoes.filter((c) => {
      if (fMes !== "all" && c.mes_id !== fMes) return false;
      if (fAno !== "all" && c.ano_id !== fAno) return false;
      if (fStatus !== "all" && c.status !== fStatus) return false;
      if (fTipo !== "all" && c.tipo !== fTipo) return false;
      return true;
    });
  }, [colecoes, fMes, fAno, fStatus, fTipo]);

  if (!isModuleEnabled("otb")) {
    return <div className="p-6 text-sm text-muted-foreground">Ative o módulo OTB para planejar tecido por coleção.</div>;
  }

  const mesAno = (c: ColecaoRow) => [mesMap[c.mes_id ?? ""], anoMap[c.ano_id ?? ""]].filter(Boolean).join(" / ") || "Sem mês/ano";

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Scissors className="h-5 w-5" />
        <h1 className="font-display text-xl font-semibold">Plan. Tecido</h1>
        <div className="ml-auto">
          <FilterButton
            screen="plan-tecido"
            filters={[
              { label: "Mês", value: fMes, onChange: setFMes, options: [{ id: "all", nome: "Todos" }, ...meses] },
              { label: "Ano", value: fAno, onChange: setFAno, options: [{ id: "all", nome: "Todos" }, ...anos] },
              {
                label: "Status",
                value: fStatus,
                onChange: setFStatus,
                options: [
                  { id: "all", nome: "Todos" },
                  { id: "rascunho", nome: "Rascunho" },
                  { id: "confirmada", nome: "Confirmada" },
                ],
              },
              {
                label: "Tipo",
                value: fTipo,
                onChange: setFTipo,
                options: [
                  { id: "all", nome: "Todos" },
                  { id: "orcamento", nome: "Orçamento" },
                  { id: "poder_venda", nome: "Poder de Venda" },
                ],
              },
            ]}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c) => (
          <button key={c.id} type="button" className="text-left" onClick={() => setOpenColecaoId(c.id)}>
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{c.nome}</CardTitle>
                <p className="text-xs text-muted-foreground">{mesAno(c)}</p>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">{c.tipo === "poder_venda" ? "Poder de Venda" : "Orçamento"}</Badge>
                <Badge variant={c.status === "confirmada" ? "default" : "outline"}>
                  {c.status === "confirmada" ? "Confirmada" : "Rascunho"}
                </Badge>
              </CardContent>
            </Card>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="text-sm text-muted-foreground">
            {colecoes.length === 0 ? "Nenhuma coleção ainda." : "Nenhuma coleção corresponde aos filtros."}
          </div>
        )}
      </div>

      {openColecaoId && <PlanTecidoSheet colecaoId={openColecaoId} onClose={() => setOpenColecaoId(null)} />}
    </div>
  );
}
