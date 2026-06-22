import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Search } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CqDetail } from "@/routes/_authenticated/producao.cq.$modeloId";
import { supabase } from "@/integrations/supabase/client";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { RevisaoErroBadge } from "@/components/producao/RevisaoErro";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { Badge } from "@/components/ui/badge";
import { FilterButton } from "@/components/shared/filters";

export const Route = createFileRoute("/_authenticated/producao/cq/")({
  component: CqListPage,
});

function CqListPage() {
  const fl = useFieldLabels();
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fColecao, setFColecao] = useState("all");
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");
  const [fStatus, setFStatus] = useState("all");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["producao-cq-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, ref, versao, nome, colecao, mes_id, ano_id, revisao_pendente, categorias_produto:categoria_principal_id(nome), cad(enviado_corte, producao_terceirizados(data_entregue, ativo), controle_qualidade(status))")
        .eq("enviado_cad", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // CQ só ativa quando o Status Geral dos Serviços é "Finalizado"
      // (todos os serviços ativos entregues, e há ao menos um).
      return (data ?? [])
        .filter((m: any) => {
          const tercs = (m.cad?.[0]?.producao_terceirizados ?? []).filter((t: any) => t.ativo !== false);
          return tercs.length > 0 && tercs.every((t: any) => !!t.data_entregue);
        })
        .map((m: any) => ({
          modelo_id: m.id, ref: m.ref, versao: m.versao, nome: m.nome, colecao: m.colecao,
          mes_id: m.mes_id, ano_id: m.ano_id, revisao_pendente: m.revisao_pendente,
          categoria_nome: m.categorias_produto?.nome ?? null,
          status: (m.cad?.[0]?.controle_qualidade?.[0]?.status ?? "pendente") as string,
        }));
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
    if (fStatus !== "all" && r.status !== fStatus) return false;
    return true;
  });

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex items-center gap-3">
        <ClipboardCheck className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Controle de Qualidade</h1>
          <p className="text-sm text-muted-foreground">Recebimento, conserto, lavagem e defeito por REF.</p>
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
            { label: "Status", value: fStatus, onChange: setFStatus, options: [
              { id: "all", nome: "Todos" },
              { id: "pendente", nome: "Pendente" },
              { id: "confirmado", nome: "Confirmado" },
            ] },
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
              <th className="px-4 py-2">Coleção</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td className="px-4 py-6 text-muted-foreground" colSpan={5}>Carregando…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr><td className="px-4 py-6 text-muted-foreground" colSpan={5}>Nenhum modelo disponível.</td></tr>
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
                  <span className="ml-2"><RevisaoErroBadge revisao={r.revisao_pendente} etapa="cq" /></span>
                </td>
                <td className="px-4 py-2" data-label="Nome">{r.nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground" data-label="Categoria">{r.categoria_nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground" data-label="Coleção">{r.colecao ?? "—"}</td>
                <td className="px-4 py-2" data-label="Status"><CqStatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Sheet open={!!sheetId} onOpenChange={(o) => !o && setSheetId(null)}>
        <SheetContent className="w-full sm:w-[92vw] sm:max-w-[1100px] overflow-y-auto p-0">
          {sheetId && <CqDetail modeloId={sheetId} onClose={() => setSheetId(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CqStatusBadge({ status }: { status: string }) {
  if (status === "confirmado") return <Badge className="bg-emerald-500 hover:bg-emerald-500 text-white">Confirmado</Badge>;
  return <Badge className="bg-amber-500 hover:bg-amber-500 text-white">Pendente</Badge>;
}
