import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, Search, Printer } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TerceirizadosDetail } from "@/routes/_authenticated/producao.terceirizados.$modeloId";
import { supabase } from "@/integrations/supabase/client";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterButton } from "@/components/shared/filters";
import { PrintFicha } from "@/components/producao/PrintFicha";
import { useFieldLabels } from "@/hooks/useFieldLabels";

export const Route = createFileRoute("/_authenticated/producao/terceirizados/")({
  component: TercListPage,
});

function TercListPage() {
  const fl = useFieldLabels();
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fColecao, setFColecao] = useState("all");
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [printReq, setPrintReq] = useState<{ id: string; token: number } | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["producao-terc-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select(
          "id, ref, versao, nome, colecao, mes_id, ano_id, categoria_principal_id, categorias_produto:categoria_principal_id(nome), cad(id, enviado_corte, status_corte, producao_terceirizados(data_enviado, data_entregue, ativo))",
        )
        .eq("enviado_cad", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Só aparece após o CAD ser confirmado (Confirmar CAD => cad.enviado_corte).
      return (data ?? []).filter((m: any) => m.cad?.[0]?.enviado_corte === true).map((m: any) => {
        const tercs = (m.cad?.[0]?.producao_terceirizados ?? []).filter((t: any) => t.ativo !== false);
        let statusGeral: "sem" | "pendente" | "em_andamento" | "finalizado" = "sem";
        if (tercs.length > 0) {
          const todosEntregues = tercs.every((t: any) => !!t.data_entregue);
          const algumEnviado = tercs.some((t: any) => !!t.data_enviado);
          if (todosEntregues) statusGeral = "finalizado";
          else if (algumEnviado) statusGeral = "em_andamento";
          else statusGeral = "pendente";
        }
        return {
          modelo_id: m.id,
          ref: m.ref,
          versao: m.versao,
          nome: m.nome,
          colecao: m.colecao,
          mes_id: m.mes_id,
          ano_id: m.ano_id,
          categoria_nome: m.categorias_produto?.nome ?? null,
          cad_id: m.cad?.[0]?.id ?? null,
          statusGeral,
        };
      });
    },
  });

  const { data: meses = [] } = useQuery({
    queryKey: ["opt", "meses"],
    queryFn: async () => (await supabase.from("meses").select("id, nome:mes").order("mes")).data ?? [],
  });
  const { data: anos = [] } = useQuery({
    queryKey: ["opt", "anos"],
    queryFn: async () => (await supabase.from("anos").select("id, nome:ano").order("ano")).data ?? [],
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
    if (fStatus !== "all" && r.statusGeral !== fStatus) return false;
    return true;
  });

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center gap-3">
        <Users className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Serviços</h1>
          <p className="text-sm text-muted-foreground">Acompanhamento de serviços por REF.</p>
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
            { label: "Status Geral", value: fStatus, onChange: setFStatus, options: [
              { id: "all", nome: "Todos" },
              { id: "pendente", nome: "Pendente" },
              { id: "em_andamento", nome: "Em andamento" },
              { id: "finalizado", nome: "Finalizado" },
              { id: "sem", nome: "Sem serviço" },
            ] },
          ]}
        />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2">{fl("ref")}</th>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Categoria</th>
              <th className="px-4 py-2">Coleção</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 w-12 text-center">Ficha</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td className="px-4 py-6 text-muted-foreground" colSpan={6}>Carregando…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td className="px-4 py-6 text-muted-foreground" colSpan={6}>Nenhum modelo disponível.</td></tr>
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
                <td className="px-4 py-2">{r.nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.categoria_nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.colecao ?? "—"}</td>
                <td className="px-4 py-2"><StatusBadge status={r.statusGeral} /></td>
                <td className="px-4 py-2 text-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="Imprimir Ficha Técnica"
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

      {printReq && <PrintFicha modeloId={printReq.id} kind="tecnica" token={printReq.token} />}

      <Sheet open={!!sheetId} onOpenChange={(o) => !o && setSheetId(null)}>
        <SheetContent className="w-full sm:w-[92vw] sm:max-w-[1100px] overflow-y-auto p-0">
          {sheetId && <TerceirizadosDetail modeloId={sheetId} onClose={() => setSheetId(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatusBadge({ status }: { status: "sem" | "pendente" | "em_andamento" | "finalizado" }) {
  if (status === "finalizado") return <Badge className="bg-emerald-500 hover:bg-emerald-500 text-white">Finalizado</Badge>;
  if (status === "em_andamento") return <Badge className="bg-amber-500 hover:bg-amber-500 text-white">Em andamento</Badge>;
  if (status === "pendente") return <Badge variant="secondary">Pendente</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">Sem terc.</Badge>;
}
