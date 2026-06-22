import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Scissors, Search, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { FilterButton } from "@/components/shared/filters";
import { PrintFicha } from "@/components/producao/PrintFicha";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CadEditor } from "@/routes/_authenticated/producao.cad.$modeloId";

export const Route = createFileRoute("/_authenticated/producao/cad/")({
  component: CadListPage,
});

type Row = {
  id: string; // cad.id (may be null until first open)
  modelo_id: string;
  ref: string | null;
  nome: string | null;
  versao: number | null;
  colecao: string | null;
  mes_id: string | null;
  ano_id: string | null;
  categoria_principal_id: string | null;
  status_corte: string | null;
};

const STATUS_COLORS: Record<string, string> = {
  pendente: "bg-amber-500",
  enviado: "bg-emerald-500",
};
const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  enviado: "Enviado",
};
// Compat: linhas antigas podem ter "em_corte"/"pronto" — tratar como "enviado".
const normalizeStatus = (s: string | null) => (s === "em_corte" || s === "pronto" ? "enviado" : s ?? "pendente");

function CadListPage() {
  const fl = useFieldLabels();
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fColecao, setFColecao] = useState("all");
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [printReq, setPrintReq] = useState<{ id: string; token: number } | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["producao-cad-list"],
    queryFn: async () => {
      // modelos enviados ao CAD + categoria + cad.status_corte
      const { data, error } = await supabase
        .from("modelos")
        .select(
          "id, ref, nome, versao, colecao, mes_id, ano_id, categoria_principal_id, categorias_produto:categoria_principal_id(nome), cad(id, status_corte)",
        )
        .eq("enviado_cad", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((m: any) => ({
        id: m.cad?.[0]?.id ?? null,
        modelo_id: m.id,
        ref: m.ref,
        nome: m.nome,
        versao: m.versao,
        colecao: m.colecao,
        mes_id: m.mes_id,
        ano_id: m.ano_id,
        categoria_principal_id: m.categoria_principal_id,
        categoria_nome: m.categorias_produto?.nome ?? null,
        status_corte: normalizeStatus(m.cad?.[0]?.status_corte ?? null),
      }));
    },
  });

  const { data: meses = [] } = useQuery({
    queryKey: ["opt", "meses"],
    queryFn: async () => {
      const { data } = await supabase.from("meses").select("id, nome:mes").order("mes");
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

  const filtered = (rows as any[]).filter((r) => {
    if (q && !`${r.ref ?? ""} ${r.nome ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (fColecao !== "all" && r.colecao !== fColecao) return false;
    if (fMes !== "all" && r.mes_id !== fMes) return false;
    if (fAno !== "all" && r.ano_id !== fAno) return false;
    if (fStatus !== "all" && r.status_corte !== fStatus) return false;
    return true;
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Scissors className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">CAD</h1>
          <p className="text-sm text-muted-foreground">Modelos enviados ao CAD para corte.</p>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder={`${fl("ref")} ou nome…`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <FilterButton
          filters={[
            { label: "Coleção", value: fColecao, onChange: setFColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.map((c) => ({ id: c, nome: c }))] },
            { label: "Mês", value: fMes, onChange: setFMes, options: [{ id: "all", nome: "Todos" }, ...(meses as any[])] },
            { label: "Ano", value: fAno, onChange: setFAno, options: [{ id: "all", nome: "Todos" }, ...(anos as any[])] },
            { label: "Status CAD", value: fStatus, onChange: setFStatus, options: [{ id: "all", nome: "Todos" }, ...Object.entries(STATUS_LABELS).map(([v, label]) => ({ id: v, nome: label }))] },
          ]}
        />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm card-table">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2">{fl("ref")}</th>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Categoria</th>
              <th className="px-4 py-2">Status CAD</th>
              <th className="px-4 py-2 w-12 text-center">Ficha</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td className="px-4 py-6 text-muted-foreground" colSpan={5}>Carregando…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td className="px-4 py-6 text-muted-foreground" colSpan={5}>Nenhum modelo enviado ao CAD.</td></tr>
            )}
            {filtered.map((r: any) => (
              <tr
                key={r.modelo_id}
                className="border-t hover:bg-muted/30 cursor-pointer"
                onClick={() => setSheetId(r.modelo_id)}
              >
                <td className="px-4 py-2">
                  <span className="font-mono text-primary">{r.ref ?? "—"}</span>
                  <VersaoBadge versao={r.versao} className="ml-2 text-[10px]" />
                </td>
                <td className="px-4 py-2" data-label="Nome">{r.nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground" data-label="Categoria">{r.categoria_nome ?? "—"}</td>
                <td className="px-4 py-2" data-label="Status CAD">
                  <Badge className={`${STATUS_COLORS[r.status_corte] ?? "bg-muted"} text-white`}>
                    {STATUS_LABELS[r.status_corte] ?? r.status_corte}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-center" data-label="">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hidden md:inline-flex"
                    title="Imprimir Ficha de Corte"
                    onClick={(e) => { e.stopPropagation(); setPrintReq((prev) => ({ id: r.modelo_id, token: (prev?.token ?? 0) + 1 })); }}
                  >
                    <Printer className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {printReq && <PrintFicha modeloId={printReq.id} kind="corte" token={printReq.token} />}

      <Sheet open={!!sheetId} onOpenChange={(o) => !o && setSheetId(null)}>
        <SheetContent className="w-full sm:w-[92vw] sm:max-w-[1100px] overflow-y-auto p-0">
          {sheetId && <CadEditor modeloId={sheetId} onAfterDelete={() => setSheetId(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
