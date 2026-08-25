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
import { SituacaoChip } from "@/components/producao/explosao/SituacaoChip";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { ModeloFotoHoverRow, ModeloResumoLinhaMobile } from "@/components/shared/ModeloFotoHover";
import { cn } from "@/lib/utils";
import { situacaoExplosao, type ExplosaoSituacao } from "@/lib/explosao";
import { useFilterState } from "@/hooks/useFilterState";

export const Route = createFileRoute("/_authenticated/entrada-saida/explosao/")({
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
  situacao: ExplosaoSituacao;
};

function ExplosaoListPage() {
  const fl = useFieldLabels();
  const [sheetId, setSheetId] = useState<string | null>(null);
  const qc = useQueryClient();
  // Guarda de "alterações não salvas": o ExplosaoDetail reporta edições de metragem
  // pendentes; fechar (X/ESC/fora) com pendências pede confirmação de descarte.
  const [explDirty, setExplDirty] = useState(false);
  // Ao fechar o Sheet, refaz a lista para remover modelos já enviados ao corte.
  const closeSheet = () => {
    setExplDirty(false);
    setSheetId(null);
    qc.invalidateQueries({ queryKey: ["producao-explosao-list"] });
  };
  const { requestClose, confirm } = useUnsavedGuard({ dirty: explDirty, onClose: closeSheet });
  const [q, setQ] = useState("");
  const [fColecao, setFColecao] = useFilterState("explosao", "Coleção", []);
  const [fMes, setFMes] = useFilterState("explosao", "Mês", []);
  const [fAno, setFAno] = useFilterState("explosao", "Ano", []);
  // Segmento Situação — Todos é o default (não esconde nada ao abrir a tela).
  const [fSituacao, setFSituacao] = useState<"todos" | "aguardando" | "enviados">("todos");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["producao-explosao-list"],
    queryFn: async () => {
      // Modelos enviados do Desenvolvimento ao CAD que ainda NÃO foram cortados.
      const { data, error } = await supabase
        .from("modelos")
        .select(
          "id, ref, nome, versao, colecao, mes_id, ano_id, categoria_principal_id, categorias_produto:categoria_principal_id(nome), cad(id, enviado_corte, deficit_corte), fotos_modelo, desenho_tecnico_url, croqui_url",
        )
        .eq("enviado_cad", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? [])
        .filter((m: any) => !!m.cad?.[0]) // qualquer modelo cujo CAD exista (cortado ou não)
        .map((m: any) => {
          const enviado_corte = m.cad?.[0]?.enviado_corte === true;
          const deficit_corte = m.cad?.[0]?.deficit_corte ?? null;
          return {
            modelo_id: m.id,
            ref: m.ref,
            nome: m.nome,
            versao: m.versao,
            colecao: m.colecao,
            mes_id: m.mes_id,
            ano_id: m.ano_id,
            categoria_nome: (m.categorias_produto as any)?.nome ?? null,
            // Enviado para PCP (já cortado) → fica na lista, editável (lápis).
            enviado_corte,
            situacao: situacaoExplosao(enviado_corte, deficit_corte),
            fotos_modelo: m.fotos_modelo,
            desenho_tecnico_url: m.desenho_tecnico_url,
            croqui_url: m.croqui_url,
          };
        });
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

  // Contagens do segmento — sobre TODAS as linhas (após busca/filtros de coleção/mês/ano,
  // pra não ficar sempre travado no total geral quando a busca já reduziu a fila).
  const buscaEFiltros = (rows as Row[]).filter((r) => {
    if (q && !`${r.ref ?? ""} ${r.nome ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (fColecao.length && !fColecao.includes(r.colecao ?? "")) return false;
    if (fMes.length && !fMes.includes(r.mes_id ?? "")) return false;
    if (fAno.length && !fAno.includes(r.ano_id ?? "")) return false;
    return true;
  });
  const counts = useMemo(() => {
    let aguardando = 0;
    let enviados = 0;
    for (const r of buscaEFiltros) {
      if (r.situacao === "aguardando") aguardando += 1;
      else enviados += 1;
    }
    return { aguardando, enviados, todos: buscaEFiltros.length };
  }, [buscaEFiltros]);

  const filtered = buscaEFiltros.filter((r) => {
    if (fSituacao === "aguardando") return r.situacao === "aguardando";
    if (fSituacao === "enviados") return r.situacao !== "aguardando";
    return true;
  });

  const s = useSort(filtered, { key: "ref" });
  const { sorted } = s;

  const SEGMENTOS: { key: "aguardando" | "enviados" | "todos"; label: string; n: number }[] = [
    { key: "aguardando", label: "Aguardando", n: counts.aguardando },
    { key: "enviados", label: "Enviados", n: counts.enviados },
    { key: "todos", label: "Todos", n: counts.todos },
  ];

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-start gap-3">
          <Layers className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight">Explosão</h1>
            <p className="text-sm text-muted-foreground">Modelos prontos para dar baixa de estoque (corte).</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 max-w-sm">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder={`${fl("ref")} ou nome…`} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <FilterButton
            screen="explosao"
            filters={[
              { label: "Coleção", value: fColecao, onChange: setFColecao, options: colecoes.map((c) => ({ id: c, nome: c })) },
              { label: "Mês", value: fMes, onChange: setFMes, options: meses as any[] },
              { label: "Ano", value: fAno, onChange: setFAno, options: anos as any[] },
            ]}
          />
        </div>
      </header>

      {/* Segmento Situação + contador — realça o que FALTA cortar (Todos é o default). */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex border rounded-md overflow-hidden text-sm w-full sm:w-auto">
          {SEGMENTOS.map((seg) => (
            <button
              key={seg.key}
              type="button"
              onClick={() => setFSituacao(seg.key)}
              className={cn(
                "px-3.5 py-1.5 flex-1 sm:flex-none transition-colors border-l first:border-l-0",
                fSituacao === seg.key
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              {seg.label} <b>{seg.n}</b>
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground sm:ml-auto">
          <b className="text-foreground">{counts.aguardando} aguardando</b> baixa · o acionável em destaque, enviados esmaecidos
        </span>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm card-table card-table-foto">
          <thead className="bg-muted/50 text-left">
            <tr>
              <SortTh label={fl("ref")} sortKey="ref" sortState={s} className="px-4 py-2" />
              <SortTh label="Nome" sortKey="nome" sortState={s} className="px-4 py-2" />
              <SortTh label="Categoria" sortKey="categoria_nome" sortState={s} className="px-4 py-2" />
              <SortTh label="Coleção" sortKey="colecao" sortState={s} className="px-4 py-2 hidden md:table-cell" />
              <th className="px-4 py-2">Situação</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <SkeletonTableRow cols={5} />}
            {!isLoading && sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="p-0">
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
              <ModeloFotoHoverRow
                key={r.modelo_id}
                fontes={[(r as any).fotos_modelo?.[0], (r as any).desenho_tecnico_url, (r as any).croqui_url]}
                nome={r.nome}
              >
              <tr
                className={cn(
                  "border-t hover:bg-muted/30 cursor-pointer",
                  r.situacao === "enviado" && "opacity-50",
                )}
                onClick={() => setSheetId(r.modelo_id)}
              >
                <ModeloResumoLinhaMobile
                  fontes={[(r as any).fotos_modelo?.[0], (r as any).desenho_tecnico_url, (r as any).croqui_url]}
                  refModelo={r.ref}
                  nome={r.nome}
                  categoria={r.categoria_nome}
                  colecao={r.colecao}
                  extra={<SituacaoChip situacao={r.situacao} />}
                />
                <td className="px-4 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono text-primary font-semibold">{r.ref ?? "—"}</span>
                    <VersaoBadge versao={r.versao} className="text-[10px]" />
                  </span>
                </td>
                <td className="px-4 py-2" data-label="Nome">{r.nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground" data-label="Categoria">{r.categoria_nome ?? "—"}</td>
                <td className="px-4 py-2 text-muted-foreground hidden md:table-cell" data-label="Coleção">{r.colecao ?? "—"}</td>
                <td className="px-4 py-2" data-label="Situação">
                  <SituacaoChip situacao={r.situacao} />
                </td>
              </tr>
              </ModeloFotoHoverRow>
            ))}
          </tbody>
        </table>
      </Card>

      <Sheet open={!!sheetId} onOpenChange={(o) => { if (!o) requestClose(); }}>
        {/* Sem X de fechar (o botão "Voltar" do rodapé já fecha; Esc/clique-fora seguem valendo). */}
        <SheetContent size="editor" className="flex flex-col p-0 [&>button]:hidden">
          {sheetId && (
            <ExplosaoDetail
              modeloId={sheetId}
              onEnviado={closeSheet}
              onClose={requestClose}
              onDirtyChange={setExplDirty}
            />
          )}
          {/* Guarda DENTRO do SheetContent (portal): fora do portal o indicador não aparece. */}
          <UnsavedChangesGuard confirm={confirm} message="Há alterações de metragem não salvas nesta Explosão." />
        </SheetContent>
      </Sheet>
    </div>
  );
}
