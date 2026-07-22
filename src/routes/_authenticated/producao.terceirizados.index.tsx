import { SkeletonTableRow } from "@/components/shared/Skeletons";
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Users, Search, Printer } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TerceirizadosDetail } from "@/routes/_authenticated/producao.terceirizados.$modeloId";
import { supabase } from "@/integrations/supabase/client";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { RevisaoErroBadge } from "@/components/producao/RevisaoErro";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge as SharedStatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { FilterButton } from "@/components/shared/filters";
import { PrintFicha } from "@/components/producao/PrintFicha";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { EmptyState } from "@/components/shared/EmptyState";
import { useSort, SortTh } from "@/components/shared/sort";

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
          "id, ref, versao, nome, colecao, mes_id, ano_id, categoria_principal_id, revisao_pendente, custo_terceirizados_aprovado, categorias_produto:categoria_principal_id(nome), cad(id, enviado_corte, status_corte, sem_acabamento, producao_terceirizados(data_enviado, data_entregue, quantidade_enviada, quantidade_recebida, quantidade_defeito, ativo, interno, categorias_terceirizado(etapa)))",
        )
        .eq("enviado_cad", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Só aparece após o CAD ser confirmado (Confirmar CAD => cad.enviado_corte).
      return (data ?? []).filter((m: any) => m.cad?.[0]?.enviado_corte === true).map((m: any) => {
        const tercs = (m.cad?.[0]?.producao_terceirizados ?? []).filter((t: any) => t.ativo !== false);
        // Status Geral com pré/pós (mesma regra do detalhe): pré fin + pós pendente=pendente;
        // pré+pós fin=finalizado; pré fin + pós SEM seleção=pré finalizado.
        const etapaDe = (t: any) => t.categorias_terceirizado?.etapa ?? "ate_costura";
        // "Finalizado" = data entregue + qtd enviada > 0 + (qtd recebida > 0 OU qtd defeito > 0).
        const finalizado = (t: any) =>
          !!t.data_entregue &&
          Number(t.quantidade_enviada) > 0 &&
          (Number(t.quantidade_recebida) > 0 || Number(t.quantidade_defeito) > 0);
        const statusDe = (bs: any[]) => {
          if (bs.length === 0) return "vazio";
          if (bs.every(finalizado)) return "finalizado";
          if (bs.some((t: any) => !!t.data_enviado)) return "em_andamento";
          return "pendente";
        };
        let statusGeral: "sem" | "pendente" | "em_andamento" | "finalizado" | "pre_finalizado" = "sem";
        if (tercs.length > 0) {
          const sPre = statusDe(tercs.filter((t: any) => etapaDe(t) === "ate_costura"));
          const sPos = statusDe(tercs.filter((t: any) => etapaDe(t) === "pos_costura"));
          if (sPre !== "finalizado") statusGeral = sPre === "vazio" ? "pendente" : (sPre as any);
          else if (sPos === "finalizado") statusGeral = "finalizado";
          else if (sPos === "vazio") statusGeral = m.cad?.[0]?.sem_acabamento === true ? "finalizado" : "pre_finalizado";
          else statusGeral = "pendente";
        }
        // Aprovação: reflete a flag de modelo (aprovada no Planejamento).
        const aprovacao: "verde" | "vermelha" = (m as any).custo_terceirizados_aprovado ? "verde" : "vermelha";
        return {
          modelo_id: m.id,
          ref: m.ref,
          versao: m.versao,
          revisao_pendente: m.revisao_pendente,
          nome: m.nome,
          colecao: m.colecao,
          mes_id: m.mes_id,
          ano_id: m.ano_id,
          categoria_nome: m.categorias_produto?.nome ?? null,
          cad_id: m.cad?.[0]?.id ?? null,
          statusGeral,
          aprovacao,
        };
      });
    },
  });

  const { data: meses = [] } = useQuery({
    queryKey: ["opt", "meses"],
    queryFn: async () => (await supabase.from("meses").select("id, nome:mes").order("ordem")).data ?? [],
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

  const { sorted, sortKey, sortDir, toggle } = useSort(filtered, { key: "ref" });
  const sortState = { sortKey, sortDir, toggle };

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-start gap-3">
          <Users className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">Serviços</h1>
            <p className="text-sm text-muted-foreground">Acompanhamento de serviços por REF.</p>
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
              { label: "Status Geral", value: fStatus, onChange: setFStatus, options: [
                { id: "all", nome: "Todos" },
                { id: "pendente", nome: "Pendente" },
                { id: "em_andamento", nome: "Em andamento" },
                { id: "pre_finalizado", nome: "Pré finalizado" },
                { id: "finalizado", nome: "Finalizado" },
                { id: "sem", nome: "Sem serviço" },
              ] },
            ]}
          />
        </div>
      </header>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm card-table">
          <thead className="bg-muted/50 text-left">
            <tr>
              <SortTh label={fl("ref")} sortKey="ref" sortState={sortState} className="px-4 py-2" />
              <SortTh label="Nome" sortKey="nome" sortState={sortState} className="px-4 py-2" />
              <SortTh label="Categoria" sortKey="categoria_nome" sortState={sortState} className="px-4 py-2" />
              <SortTh label="Coleção" sortKey="colecao" sortState={sortState} className="px-4 py-2" />
              <SortTh label="Status" sortKey="statusGeral" sortState={sortState} className="px-4 py-2" />
              <th className="px-4 py-2 w-12 text-center">Ficha</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <SkeletonTableRow cols={6} />
            )}
            {!isLoading && sorted.length === 0 && (
              <tr><td colSpan={6} className="p-0"><EmptyState icon={Users} title="Nenhum modelo disponível" description="Modelos enviados aos serviços aparecerão aqui." className="border-0 rounded-none" /></td></tr>
            )}
            {sorted.map((r: any) => (
              <tr
                key={r.modelo_id}
                className="border-t hover:bg-muted/30 cursor-pointer"
                // Abrir o detalhe fecha o printável da lista (senão as duas .print-area —
                // a ficha da lista + a do detalhe — imprimiam empilhadas na mesma folha).
                onClick={() => { setPrintReq(null); setSheetId(r.modelo_id); }}
              >
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${r.aprovacao === "verde" ? "bg-emerald-500" : "bg-red-500"}`}
                      title={r.aprovacao === "verde" ? "Mão de obra aprovada" : "Mão de obra reprovada"}
                    />
                    <span className="font-mono text-primary">{r.ref ?? "—"}</span>
                    <VersaoBadge versao={r.versao} className="text-[10px]" />
                    <RevisaoErroBadge revisao={r.revisao_pendente} etapa="terceirizados" />
                  </span>
                </td>
                <td className="px-4 py-2" data-label="Nome">{r.nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground" data-label="Categoria">{r.categoria_nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground" data-label="Coleção">{r.colecao ?? "—"}</td>
                <td className="px-4 py-2" data-label="Status"><StatusBadge status={r.statusGeral} /></td>
                <td className="px-4 py-2 text-center" data-label="">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hidden md:inline-flex"
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
        <SheetContent className="w-full sm:w-[70vw] sm:max-w-[70vw] overflow-y-auto p-0 max-md:[&>button]:hidden">
          {sheetId && <TerceirizadosDetail modeloId={sheetId} onClose={() => setSheetId(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatusBadge({ status }: { status: "sem" | "pendente" | "em_andamento" | "finalizado" | "pre_finalizado" }) {
  if (status === "finalizado") return <SharedStatusBadge tone="success">Finalizado</SharedStatusBadge>;
  if (status === "pre_finalizado") return <SharedStatusBadge tone="info">Pré finalizado</SharedStatusBadge>;
  if (status === "em_andamento") return <SharedStatusBadge tone="warning">Em andamento</SharedStatusBadge>;
  if (status === "pendente") return <SharedStatusBadge tone="neutral">Pendente</SharedStatusBadge>;
  return <SharedStatusBadge tone="neutral">Sem serv.</SharedStatusBadge>;
}
