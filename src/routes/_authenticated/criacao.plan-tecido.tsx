import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantModules } from "@/hooks/useTenantModules";
import { RequirePermission } from "@/components/RequirePermission";
import { Button } from "@/components/ui/button";
import { ArrowDownAZ, ArrowDownZA } from "lucide-react";
import { FilterButton } from "@/components/shared/filters";
import { useSort } from "@/components/shared/sort";
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

  // Lista só-nomes, ordenável alfabeticamente (A–Z por padrão; botão alterna Z–A).
  const sort = useSort(filtered, { key: "nome" });

  if (!isModuleEnabled("otb")) {
    return <div className="p-6 text-sm text-muted-foreground">Ative o módulo OTB para planejar tecido por coleção.</div>;
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Planejamento de Tecido</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Escolha uma coleção para planejar os tecidos. (Só clicar e entrar.)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => sort.toggle("nome")}
            title="Ordenar por nome"
          >
            {sort.sortDir === "asc" ? <ArrowDownAZ className="h-4 w-4" /> : <ArrowDownZA className="h-4 w-4" />}
            <span className="hidden sm:inline">{sort.sortDir === "asc" ? "A–Z" : "Z–A"}</span>
          </Button>
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
        {sort.sorted.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setOpenColecaoId(c.id)}
            className="flex items-center justify-between rounded-lg border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md"
          >
            <span className="text-base font-semibold tracking-tight">{c.nome}</span>
            <span className="text-xs font-medium text-primary">abrir →</span>
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
