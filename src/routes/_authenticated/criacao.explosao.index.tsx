import { SkeletonTableRow } from "@/components/shared/Skeletons";
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FilterButton } from "@/components/shared/filters";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useSort, SortTh } from "@/components/shared/sort";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { ExplosaoDetail } from "@/components/producao/explosao/ExplosaoDetail";

export const Route = createFileRoute("/_authenticated/criacao/explosao/")({
  component: ExplosaoListPage,
});

type Row = {
  modelo_id: string;
  ref: string | null;
  nome: string | null;
  versao: number | null;
  colecao: string | null;
  mes_id: string | null;
  ano_id: string | null;
  categoria_nome: string | null;
  enviado_corte: boolean;
};

function ExplosaoListPage() {
  const fl = useFieldLabels();
  const [sheetId, setSheetId] = useState<string | null>(null);
  const qc = useQueryClient();
  // Ao fechar o Sheet, refaz a lista para remover modelos já enviados ao corte.
  const closeSheet = () => {
    setSheetId(null);
    qc.invalidateQueries({ queryKey: ["producao-explosao-list"] });
  };
  const [q, setQ] = useState("");
  const [fColecao, setFColecao] = useState("all");
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["producao-explosao-list"],
    queryFn: async () => {
      // Modelos enviados do Desenvolvimento ao CAD que ainda NÃO foram cortados.
      const { data, error } = await supabase
        .from("modelos")
        .select(
          "id, ref, nome, versao, colecao, mes_id, ano_id, categoria_principal_id, categorias_produto:categoria_principal_id(nome), cad(id, enviado_corte)",
        )
        .eq("enviado_cad", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? [])
        .filter((m: any) => !!m.cad?.[0]) // qualquer modelo cujo CAD exista (cortado ou não)
        .map((m: any) => ({
          modelo_id: m.id,
          ref: m.ref,
          nome: m.nome,
          versao: m.versao,
          colecao: m.colecao,
          mes_id: m.mes_id,
          ano_id: m.ano_id,
          categoria_nome: (m.categorias_produto as any)?.nome ?? null,
          // Enviado para Serviços (já cortado) → fica na lista com bolinha verde, editável.
          enviado_corte: m.cad?.[0]?.enviado_corte === true,
        }));
    },
  });

  const { data: meses = [] } = useQuery({
    queryKey: ["opt", "meses"],
    queryFn: async () => {
      const { data } = await supabase.from("meses").select("id, nome:mes").order("ordem");
      return data ?? [];
    },
  });
  const { data: anos = [] } = useQuery({
    queryKey: ["opt", "anos"],
    queryFn: async () => {
      const { data } = await supabase.from("anos").select("id, nome:ano").order("ano");
      return data ?? [];
    },
  });
  const colecoes = useMemo(
    () => Array.from(new Set(rows.map((r: any) => r.colecao).filter(Boolean))) as string[],
    [rows],
  );

  const filtered = (rows as Row[]).filter((r) => {
    if (q && !`${r.ref ?? ""} ${r.nome ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (fColecao !== "all" && r.colecao !== fColecao) return false;
    if (fMes !== "all" && r.mes_id !== fMes) return false;
    if (fAno !== "all" && r.ano_id !== fAno) return false;
    return true;
  });

  const s = useSort(filtered, { key: "ref" });
  const { sorted } = s;

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-start gap-3">
          <Layers className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">Explosão</h1>
            <p className="text-sm text-muted-foreground">Modelos prontos para dar baixa de estoque (corte).</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder={`${fl("ref")} ou nome…`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <FilterButton
            filters={[
              { label: "Coleção", value: fColecao, onChange: setFColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.map((c) => ({ id: c, nome: c }))] },
              { label: "Mês", value: fMes, onChange: setFMes, options: [{ id: "all", nome: "Todos" }, ...(meses as any[])] },
              { label: "Ano", value: fAno, onChange: setFAno, options: [{ id: "all", nome: "Todos" }, ...(anos as any[])] },
            ]}
          />
        </div>
      </header>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm card-table">
          <thead className="bg-muted/50 text-left">
            <tr>
              <SortTh label={fl("ref")} sortKey="ref" sortState={s} className="px-4 py-2" />
              <SortTh label="Nome" sortKey="nome" sortState={s} className="px-4 py-2" />
              <SortTh label="Categoria" sortKey="categoria_nome" sortState={s} className="px-4 py-2" />
              <SortTh label="Coleção" sortKey="colecao" sortState={s} className="px-4 py-2 hidden md:table-cell" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonTableRow cols={4} />}
            {!isLoading && sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="p-0">
                  <EmptyState
                    icon={Layers}
                    title="Nenhum modelo aguardando baixa"
                    description="Os modelos enviados do Desenvolvimento e ainda não cortados aparecem aqui."
                    className="border-0 rounded-none"
                  />
                </td>
              </tr>
            )}
            {sorted.map((r: any) => (
              <tr
                key={r.modelo_id}
                className="border-t hover:bg-muted/30 cursor-pointer"
                onClick={() => setSheetId(r.modelo_id)}
              >
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full shrink-0 ${r.enviado_corte ? "bg-green-500" : "bg-transparent"}`}
                      title={r.enviado_corte ? "Enviado para Serviços — clique para editar" : undefined}
                      aria-label={r.enviado_corte ? "Enviado para Serviços" : undefined}
                    />
                    <span className="font-mono text-primary">{r.ref ?? "—"}</span>
                    <VersaoBadge versao={r.versao} className="text-[10px]" />
                  </span>
                </td>
                <td className="px-4 py-2" data-label="Nome">{r.nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground" data-label="Categoria">{r.categoria_nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground hidden md:table-cell" data-label="Coleção">{r.colecao ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Sheet open={!!sheetId} onOpenChange={(o) => !o && closeSheet()}>
        <SheetContent className="w-full sm:w-[70vw] sm:max-w-[70vw] overflow-y-auto p-0 max-md:[&>button]:hidden">
          {sheetId && (
            <ExplosaoDetail
              modeloId={sheetId}
              onEnviado={closeSheet}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
