import { SkeletonTableRow } from "@/components/shared/Skeletons";
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Compass, Search } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { DirecionamentoDetail } from "@/routes/_authenticated/expedicao.direcionamento.$modeloId";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { supabase } from "@/integrations/supabase/client";
import { cqLiberado } from "@/lib/cq-status";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { RevisaoErroBadge } from "@/components/producao/RevisaoErro";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { useFilterState } from "@/hooks/useFilterState";
import { FilterButton } from "@/components/shared/filters";
import { EmptyState } from "@/components/shared/EmptyState";
import { useSort, SortTh } from "@/components/shared/sort";
import { ModeloFotoHoverRow, ModeloResumoLinhaMobile } from "@/components/shared/ModeloFotoHover";

export const Route = createFileRoute("/_authenticated/expedicao/direcionamento/")({
  component: DirListPage,
});

function DirListPage() {
  const fl = useFieldLabels();
  const [sheetId, setSheetId] = useState<string | null>(null);
  // Guarda de "alterações não salvas" do Direcionamento aberto no Sheet: o detalhe
  // reporta se há edições pendentes; fechar (X/ESC/fora) com pendências pede confirmação.
  const [dirDirty, setDirDirty] = useState(false);
  const closeSheet = () => { setDirDirty(false); setSheetId(null); };
  const { requestClose, confirm } = useUnsavedGuard({ dirty: dirDirty, onClose: closeSheet });
  const [q, setQ] = useState("");
  const [fColecao, setFColecao] = useFilterState("direcionamento", "Coleção", []);
  const [fMes, setFMes] = useFilterState("direcionamento", "Mês", []);
  const [fAno, setFAno] = useFilterState("direcionamento", "Ano", []);
  const [fLinha, setFLinha] = useFilterState("direcionamento", "Linha", []);
  const [fStatus, setFStatus] = useFilterState("direcionamento", "Status", []);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["dir-list"],
    queryFn: async () => {
      // Revenda (Produto Acabado, Task 7): nunca passa por Desenvolvimento/CAD, então
      // `enviado_cad` fica sempre false — o `cad` (com `controle_qualidade`/
      // `cad_grades`) nasce direto em `receber_oc_p_acabado` (Task 3). Sem o `.or(...)`
      // abaixo, um modelo revenda com OC recebida nunca aparecia aqui, mesmo com CQ
      // liberado (`cqLiberado` já é origem-agnóstico — só faltava esta linha buscar a
      // linha). `cqLiberado` no filtro abaixo segue igual pros dois casos.
      const { data, error } = await supabase
        .from("modelos")
        .select("id, ref, versao, nome, colecao, mes_id, ano_id, linha_id, revisao_pendente, fotos_modelo, desenho_tecnico_url, croqui_url, linha:linha_id(nome), categorias_produto:categoria_principal_id(nome), cad(direcionamento_status, producao_terceirizados(ativo, categorias_terceirizado(etapa)), controle_qualidade(status, status_pos))")
        .or("enviado_cad.eq.true,origem.eq.revenda")
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Só aparece após o CQ ser Confirmado: o Pré sempre; e o Pós também quando o
      // modelo tem serviço de acabamento (pós-costura).
      return (data ?? [])
        .filter((m: any) => cqLiberado(m.cad?.[0]))
        .map((m: any) => ({
          modelo_id: m.id, ref: m.ref, versao: m.versao, nome: m.nome, colecao: m.colecao,
          mes_id: m.mes_id, ano_id: m.ano_id, linha_id: m.linha_id, revisao_pendente: m.revisao_pendente,
          fotos_modelo: m.fotos_modelo, desenho_tecnico_url: m.desenho_tecnico_url, croqui_url: m.croqui_url,
          linha_nome: m.linha?.nome ?? null,
          categoria_nome: m.categorias_produto?.nome ?? null,
          dir_status: m.cad?.[0]?.direcionamento_status ?? "pendente",
        }));
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
  const { data: linhas = [] } = useQuery({
    queryKey: ["opt", "linhas"],
    queryFn: async () => (await supabase.from("linhas").select("id, nome").order("nome")).data ?? [],
  });

  const colecoes = useMemo(
    () => Array.from(new Set(rows.map((r: any) => r.colecao).filter(Boolean))) as string[],
    [rows],
  );
  const filtered = (rows as any[]).filter((r) => {
    if (q && !`${r.ref ?? ""} ${r.nome ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (fColecao.length && !fColecao.includes(r.colecao ?? "")) return false;
    if (fMes.length && !fMes.includes(r.mes_id ?? "")) return false;
    if (fAno.length && !fAno.includes(r.ano_id ?? "")) return false;
    if (fLinha.length && !fLinha.includes(r.linha_id ?? "")) return false;
    if (fStatus.length && !fStatus.includes(r.dir_status ?? "")) return false;
    return true;
  });
  const { sorted, sortKey, sortDir, toggle } = useSort(filtered, { key: "ref" });
  const s = { sortKey, sortDir, toggle };

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-start gap-3">
          <Compass className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight">Direcionamento</h1>
            <p className="text-sm text-muted-foreground">Distribuição entre as lojas cadastradas.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder={`${fl("ref")} ou nome…`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <FilterButton
            screen="direcionamento"
            filters={[
              { label: "Status", value: fStatus, onChange: setFStatus, options: [{ id: "pendente", nome: "Pendente" }, { id: "separado", nome: "Separado" }] },
              { label: "Coleção", value: fColecao, onChange: setFColecao, options: colecoes.map((c) => ({ id: c, nome: c })) },
              { label: "Mês", value: fMes, onChange: setFMes, options: meses as any[] },
              { label: "Ano", value: fAno, onChange: setFAno, options: anos as any[] },
              { label: fl("linha"), value: fLinha, onChange: setFLinha, options: linhas as any[] },
            ]}
          />
        </div>
      </header>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm card-table card-table-foto">
          <thead className="bg-muted/50 text-left">
            <tr>
              <SortTh label={fl("ref")} sortKey="ref" sortState={s} className="px-4 py-2" />
              <SortTh label="Nome" sortKey="nome" sortState={s} className="px-4 py-2" />
              <SortTh label="Categoria" sortKey="categoria_nome" sortState={s} className="px-4 py-2" />
              <SortTh label="Coleção" sortKey="colecao" sortState={s} className="px-4 py-2" />
              <SortTh label="Status" sortKey="dir_status" sortState={s} className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonTableRow cols={5} />}
            {!isLoading && sorted.length === 0 && (
              <tr><td colSpan={5} className="p-0"><EmptyState icon={Compass} title="Nenhum modelo disponível" description="Modelos prontos para direcionamento aparecerão aqui." className="border-0 rounded-none" /></td></tr>
            )}
            {sorted.map((r: any) => (
              <ModeloFotoHoverRow
                key={r.modelo_id}
                fontes={[r.fotos_modelo?.[0], r.desenho_tecnico_url, r.croqui_url]}
                nome={r.nome}
              >
              <tr
                className="border-t hover:bg-muted/30 cursor-pointer"
                onClick={() => setSheetId(r.modelo_id)}
              >
                <ModeloResumoLinhaMobile
                  fontes={[r.fotos_modelo?.[0], r.desenho_tecnico_url, r.croqui_url]}
                  refModelo={r.ref}
                  versao={r.versao}
                  nome={r.nome}
                  categoria={r.categoria_nome}
                  extra={<StatusBadge tone={r.dir_status === "separado" ? "success" : "warning"}>{r.dir_status === "separado" ? "Separado" : "Pendente"}</StatusBadge>}
                />
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono text-primary">{r.ref ?? "—"}</span>
                    <VersaoBadge versao={r.versao} className="text-[10px]" />
                    <RevisaoErroBadge revisao={r.revisao_pendente} etapa="direcionamento" />
                  </span>
                </td>
                <td className="px-4 py-2" data-label="Nome">{r.nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground" data-label="Categoria">{r.categoria_nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground" data-label="Coleção">{r.colecao ?? "—"}</td>
                <td className="px-4 py-2" data-label="Status">
                  <StatusBadge tone={r.dir_status === "separado" ? "success" : "warning"}>
                    {r.dir_status === "separado" ? "Separado" : "Pendente"}
                  </StatusBadge>
                </td>
              </tr>
              </ModeloFotoHoverRow>
            ))}
          </tbody>
        </table>
      </Card>

      <Sheet open={!!sheetId} onOpenChange={(o) => { if (!o) requestClose(); }}>
        <SheetContent size="editor" className="flex flex-col p-0 max-md:[&>button]:hidden">
          {sheetId && <DirecionamentoDetail modeloId={sheetId} onClose={requestClose} onDirtyChange={setDirDirty} />}
          {/* Guarda DENTRO do SheetContent (portal): fora do portal o indicador "não salvo" não aparecia. */}
          <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas no direcionamento." />
        </SheetContent>
      </Sheet>
    </div>
  );
}
