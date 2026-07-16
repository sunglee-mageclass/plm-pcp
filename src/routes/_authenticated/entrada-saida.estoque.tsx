import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Boxes, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { printWithImages } from "@/lib/print";
import { RelatorioPrint } from "@/components/shared/RelatorioPrint";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { labelVarianteRow } from "@/lib/variante";
import { FilterButton, SearchToggle } from "@/components/shared/filters";
import { useSort, SortTh } from "@/components/shared/sort";
import { useEnderecosRollup, agruparEnderecos, type EnderecoRollup } from "@/components/tecido/EnderecoEditor";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/entrada-saida/estoque")({
  component: () => (
    <RequirePermission page="entrada_estoque">
      <EstoquePage />
    </RequirePermission>
  ),
});

const num = (v: any) => Number(v ?? 0) || 0;
const fmt = (v: number) => fmtNum(v);


function EstoquePage() {
  const [tab, setTab] = useState("tecidos");
  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsContent value="tecidos"><TecidosTab /></TabsContent>
        <TabsContent value="aviamentos"><AviamentosTab /></TabsContent>
        <TabsContent value="insumos"><InsumosTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// Cabeçalho compartilhado: título à esquerda + abas/ações (children) à direita, na mesma
// linha do título (desktop). Renderizado dentro de cada aba (que tem o toolbar per-tab).
function EstoqueHeader({ children }: { children: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex items-start gap-3">
        <Boxes className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Estoque</h1>
          <p className="text-sm text-muted-foreground mt-1">Posição de tecidos e aviamentos.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

/* ============================= TECIDOS ============================= */

function TecidosTab() {
  const [search, setSearch] = useState("");
  const [fornecedor, setFornecedor] = useState<string>("all");
  const [categoria, setCategoria] = useState<string>("all");
  const [estoqueFilter, setEstoqueFilter] = useState<string>("all");

  // Endereços agora vêm do rollup consolidado (tabela enderecamento_tecido + colunas
  // do rolo), não mais do jsonb da variante. Chave = variante_tecido_id (= row.varId).
  const { data: rollup } = useEnderecosRollup();

  const { data, isLoading, error } = useQuery({
    queryKey: ["estoque-tecidos"],
    queryFn: async () => {
      // Fonte ÚNICA: RPC canônica estoque_tecido (mesma definição do dashboard). Antes eram
      // 8 queries + agregação no cliente (pesado e com risco de divergir do dashboard). Aqui
      // só metadados da variante (1 query) + os números da RPC. fisico já vem clampado >=0;
      // kg é derivado = metros/rendimento.
      const [varsRes, estRes] = await Promise.all([
        supabase.from("variantes_tecido").select("id, artigo_id, nome_variante, codigo_variante, cores(nome), apelido:cor_apelido_id(nome), artigos(id, nome, unidade_medida, rendimento, empresa_id, categoria_tecido_id, empresas(nome_fantasia), categorias_tecido(nome))"),
        supabase.rpc("estoque_tecido" as any),
      ]);
      if (varsRes.error) throw varsRes.error;
      if (estRes.error) throw estRes.error;
      const variantes = varsRes.data ?? [];
      const estByVar = new Map<string, any>(((estRes.data ?? []) as any[]).map((e) => [e.variante_tecido_id, e]));
      const artById = new Map<string, any>();
      for (const v of variantes as any[]) if (v.artigos && v.artigo_id) artById.set(v.artigo_id, v.artigos);

      const rows = (variantes as any[]).map((v: any) => {
        const a: any = v.artigos ?? artById.get(v.artigo_id);
        const e: any = estByVar.get(v.id) ?? { prev_receb_m: 0, recebido_m: 0, baixa: 0, reservado: 0, fisico: 0, previsto: 0 };
        const isKg = a?.unidade_medida === "kg";
        const rend = num(a?.rendimento) || 1;
        const prevRecebM = num(e.prev_receb_m);
        const recebidoM = num(e.recebido_m);
        return {
          varId: v.id,
          nomeVariante: labelVarianteRow(v),
          artigoId: v.artigo_id,
          artigoNome: a?.nome ?? "—",
          fornecedor: a?.empresas?.nome_fantasia ?? "—",
          fornecedorId: a?.empresa_id ?? null,
          categoria: a?.categorias_tecido?.nome ?? "—",
          categoriaId: a?.categoria_tecido_id ?? null,
          isKg,
          prevRecebKg: isKg && rend ? prevRecebM / rend : prevRecebM,
          prevRecebM,
          recebidoKg: isKg && rend ? recebidoM / rend : recebidoM,
          recebidoM,
          baixa: num(e.baixa),
          reservado: num(e.reservado),
          fisico: num(e.fisico),
          previsto: num(e.previsto),
        };
      });

      return { rows, artigos: Array.from(artById.values()) };
    },
  });

  const fornecedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of (data?.artigos ?? []) as any[]) if (a.empresa_id) m.set(a.empresa_id, a.empresas?.nome_fantasia ?? "—");
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [data]);

  const categorias = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of (data?.artigos ?? []) as any[]) if (a.categoria_tecido_id) m.set(a.categoria_tecido_id, a.categorias_tecido?.nome ?? "—");
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [data]);

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    const s = search.toLowerCase();
    return rows.filter((r: any) =>
      (!s || r.artigoNome.toLowerCase().includes(s) || r.nomeVariante.toLowerCase().includes(s)) &&
      (fornecedor === "all" || r.fornecedorId === fornecedor) &&
      (categoria === "all" || r.categoriaId === categoria) &&
      (estoqueFilter === "all" || (estoqueFilter === "zero" ? r.fisico <= 0 : r.fisico > 0)),
    );
  }, [data, search, fornecedor, categoria, estoqueFilter]);

  // Ordenação clicável (valores crus por variante; cabeçalho da tabela desktop +
  // <Select> "Ordenar por" nos cards mobile). Aplicada ANTES de agrupar por artigo,
  // pra ordenar as variantes dentro de cada grupo.
  const { sorted, sortKey, sortDir, toggle } = useSort<any>(filtered, { key: "nomeVariante" });
  const sortState = { sortKey, sortDir, toggle };

  // Group by artigo (key = artigoId, fallback para variantes sem artigo)
  const grouped = useMemo(() => {
    const map = new Map<string, { artigoId: string; artigoNome: string; rows: any[] }>();
    for (const r of sorted) {
      const key = r.artigoId ?? `sem-artigo-${r.varId}`;
      const g = map.get(key) ?? { artigoId: key, artigoNome: r.artigoNome, rows: [] as any[] };
      g.rows.push(r);
      map.set(key, g);
    }
    return Array.from(map.values());
  }, [sorted]);

  return (
    <div className="space-y-4">
      <EstoqueHeader>
        <TabsList>
          <TabsTrigger value="tecidos">Tecidos</TabsTrigger>
          <TabsTrigger value="aviamentos"><span className="sm:hidden">Aviam.</span><span className="hidden sm:inline">Aviamentos</span></TabsTrigger>
          <TabsTrigger value="insumos">Insumos</TabsTrigger>
        </TabsList>
        <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => printWithImages()}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir
        </Button>
        <SearchToggle value={search} onChange={setSearch} placeholder="Tecido ou variante" />
        <FilterButton
          filters={[
            { label: "Estoque", value: estoqueFilter, onChange: setEstoqueFilter, options: [{ id: "all", nome: "Todos" }, { id: "zero", nome: "Estoque Zerado" }, { id: "positive", nome: "Estoque > 0" }] },
            { label: "Fornecedor", value: fornecedor, onChange: setFornecedor, options: [{ id: "all", nome: "Todos" }, ...fornecedores] },
            { label: "Categoria", value: categoria, onChange: setCategoria, options: [{ id: "all", nome: "Todas" }, ...categorias] },
          ]}
        />
      </EstoqueHeader>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {error && <p className="text-sm text-destructive">Erro ao carregar estoque: {(error as Error).message}</p>}

      {/* Mobile: ordenação por <Select> (cards não têm cabeçalho clicável) */}
      <div className="md:hidden flex items-center gap-2">
        <Label className="text-xs text-muted-foreground shrink-0">Ordenar por</Label>
        <Select value={sortKey ?? "nomeVariante"} onValueChange={(v) => toggle(v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nomeVariante">Variante</SelectItem>
            <SelectItem value="prevRecebM">Prev. Receb.</SelectItem>
            <SelectItem value="recebidoM">Recebido</SelectItem>
            <SelectItem value="fisico">Físico Real</SelectItem>
            <SelectItem value="reservado">Reservado</SelectItem>
            <SelectItem value="previsto">Previsto</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {grouped.map((g) => (
        <Card key={g.artigoId} className="p-4">
          <h3 className="font-semibold mb-3">{g.artigoNome}</h3>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "4%" }} />
                <col style={{ width: "26%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
              </colgroup>
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3"></th>
                  <SortTh label="Variante" sortKey="nomeVariante" sortState={sortState} className="py-2 pr-3" />
                  <SortTh label="Prev. Receb." sortKey="prevRecebM" sortState={sortState} className="py-2 pr-3" align="right" />
                  <SortTh label="Recebido" sortKey="recebidoM" sortState={sortState} className="py-2 pr-3" align="right" />
                  <SortTh label="Físico Real" sortKey="fisico" sortState={sortState} className="py-2 pr-3" align="right" />
                  <SortTh label="Reservado" sortKey="reservado" sortState={sortState} className="py-2 pr-3" align="right" />
                  <SortTh label="Previsto" sortKey="previsto" sortState={sortState} className="py-2 pr-3" align="right" />
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r: any) => (
                  <VarianteRow key={r.varId} row={r} enderecos={rollup?.get(r.varId) ?? []} />
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile: cards por variante (some o scroll horizontal) */}
          <div className="md:hidden space-y-2">
            {g.rows.map((r: any) => (
              <VarianteCard key={r.varId} row={r} enderecos={rollup?.get(r.varId) ?? []} />
            ))}
          </div>
        </Card>
      ))}

      {!isLoading && grouped.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma variante encontrada.</p>
      )}

      <RelatorioPrint
        titulo="Posição de Estoque — Tecidos"
        dataStr={new Date().toLocaleDateString("pt-BR")}
        colunas={[
          { key: "artigo", label: "Tecido" },
          { key: "variante", label: "Variante" },
          { key: "fisico", label: "Físico", align: "right" },
          { key: "reservado", label: "Reservado", align: "right" },
          { key: "previsto", label: "Previsto", align: "right" },
        ]}
        linhas={grouped.flatMap((g) => g.rows.map((r: any) => ({
          artigo: g.artigoNome,
          variante: r.nomeVariante,
          fisico: `${fmt(r.fisico)} m`,
          reservado: `${fmt(r.reservado)} m`,
          previsto: `${fmt(r.previsto)} m`,
        })))}
      />
    </div>
  );
}

// Detalhe de estoque por OC de uma variante (compartilhado entre a linha desktop
// e o card mobile). A RPC traz recebidas (verde) e pendentes/encomendado (amarelo),
// com a reserva calculada p/ ambas; o físico nunca fica negativo quando zerado.
function useEstoqueVarianteDetalhe(varId: string, open: boolean, reservadoTotal: number) {
  const { data: detalhe = [], isLoading } = useQuery({
    queryKey: ["estoque-tecido-detalhe-oc", varId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("detalhe_estoque_variante" as any, { _variante_id: varId });
      if (error) throw error;
      return (data ?? []) as Array<any>;
    },
  });
  // Parte da reserva total não atribuída a nenhuma OC (modelos sem vínculo). Só informa.
  const reservaSemOc =
    Number(reservadoTotal ?? 0) - detalhe.reduce((s: number, d: any) => s + Number(d.reservado_m ?? 0), 0);
  const ocRows = detalhe.map((d: any) => {
    const recebido = Number(d.recebido_m ?? 0);
    const baixa = Number(d.baixado_m ?? 0);
    const reservado = Number(d.reservado_m ?? 0);
    const prevReceb = Number(d.prev_receb_m ?? 0);
    const fisico = d.estoque_zerado ? Math.max(0, recebido - baixa) : recebido - baixa;
    return {
      key: d.oc_tecido_item_id,
      status: d.recebida ? ("recebida" as const) : ("pendente" as const),
      zerado: !!d.estoque_zerado,
      oc: d.numero_pedido, fornecedor: d.fornecedor, entrega: d.data_entrega,
      prevReceb, recebido, baixa, fisico, reservado, previsto: fisico + prevReceb - reservado,
    };
  });
  return { ocRows, reservaSemOc, isLoading };
}

function VarianteRow({ row, enderecos }: { row: any; enderecos: EnderecoRollup[] }) {
  const [open, setOpen] = useState(false);
  const { ocRows, reservaSemOc, isLoading } = useEstoqueVarianteDetalhe(row.varId, open, row.reservado);
  const loadingPend = false;

  return (
    <>
      <tr className="border-b last:border-0 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <td className="py-2 pr-3 text-muted-foreground">{open ? "▾" : "▸"}</td>
        <td className="py-2 pr-3">
          {row.nomeVariante}
          <span className="ml-1 text-[10px] text-muted-foreground">[{row.isKg ? "kg→m" : "m"}]</span>
          {(() => {
            const g = agruparEnderecos(enderecos);
            if (g.length === 0) return null;
            return (
              <span className="ml-2 text-[10px] text-muted-foreground whitespace-nowrap" title={g.map((x) => `${x.label}${x.origens.length ? ` (${x.origens.join(", ")})` : ""}`).join(" | ")}>
                📍 {g[0].label}{g.length > 1 ? ` +${g.length - 1}` : ""}
              </span>
            );
          })()}
        </td>
        <td className="py-2 pr-3 text-right">
          {row.isKg ? (
            <div className="leading-tight">
              <div>{fmt(row.prevRecebKg)} kg</div>
              <div className="text-xs text-muted-foreground">{fmt(row.prevRecebM)} m</div>
            </div>
          ) : (`${fmt(row.prevRecebM)} m`)}
        </td>
        <td className="py-2 pr-3 text-right">
          {row.isKg ? (
            <div className="leading-tight">
              <div>{fmt(row.recebidoKg)} kg</div>
              <div className="text-xs text-muted-foreground">{fmt(row.recebidoM)} m</div>
            </div>
          ) : (`${fmt(row.recebidoM)} m`)}
        </td>
        <td className="py-2 pr-3 text-right font-medium">{fmt(row.fisico)} m</td>
        <td className="py-2 pr-3 text-right">{fmt(row.reservado)} m</td>
        <td className="py-2 pr-3 text-right">{fmt(row.previsto)} m</td>
      </tr>
      {open && (
        <tr className="bg-muted/30">
          <td></td>
          <td colSpan={6} className="py-2 pr-3 space-y-2">
            <div className="text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-muted-foreground">Endereços:</span>
              {enderecos.length > 0
                ? agruparEnderecos(enderecos).map((g, i) => <span key={i} className="whitespace-nowrap" title={g.origens.join(", ")}>📍 {g.label}</span>)
                : <span className="text-muted-foreground">—</span>}
            </div>
            <p className="text-xs font-semibold text-muted-foreground">Estoque por OC</p>
            {(isLoading || loadingPend) && <p className="text-xs text-muted-foreground">Carregando…</p>}
            {!isLoading && !loadingPend && ocRows.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma OC para esta variante.</p>
            )}
            {ocRows.length > 0 && (
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1 pr-3">OC</th>
                    <th className="py-1 pr-3">Fornecedor</th>
                    <th className="py-1 pr-3">Entrega</th>
                    <th className="py-1 pr-3 text-right">Prev. Receb.</th>
                    <th className="py-1 pr-3 text-right">Recebido</th>
                    <th className="py-1 pr-3 text-right">Físico Real</th>
                    <th className="py-1 pr-3 text-right">Reservado</th>
                    <th className="py-1 pr-3 text-right">Previsto</th>
                  </tr>
                </thead>
                <tbody>
                  {ocRows.map((d) => (
                    <tr key={d.key} className={cn("border-b last:border-0", d.status === "recebida" ? "bg-emerald-50" : "bg-amber-50")}>
                      <td className="py-1 pr-3 whitespace-nowrap">
                        #{d.oc ?? "—"}
                        <span className={cn("ml-1 text-[9px] uppercase", d.status === "recebida" ? "text-emerald-700" : "text-amber-700")}>
                          {d.status}
                        </span>
                        {d.zerado && (
                          <Badge className="ml-1.5 h-4 px-1 text-[9px] bg-emerald-500 hover:bg-emerald-500">Zerado</Badge>
                        )}
                      </td>
                      <td className="py-1 pr-3">{d.fornecedor ?? "—"}</td>
                      <td className="py-1 pr-3">{d.entrega ? new Date(d.entrega).toLocaleDateString("pt-BR") : "—"}</td>
                      <td className="py-1 pr-3 text-right">{fmt(d.prevReceb)} m</td>
                      <td className="py-1 pr-3 text-right">{fmt(d.recebido)} m</td>
                      <td className="py-1 pr-3 text-right font-medium">{fmt(d.fisico)} m</td>
                      <td className="py-1 pr-3 text-right">{fmt(d.reservado)} m</td>
                      <td className="py-1 pr-3 text-right">{fmt(d.previsto)} m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!isLoading && reservaSemOc > 0.01 && (
              <p className="text-xs text-muted-foreground mt-1 italic">
                <span className="font-medium not-italic text-foreground">{fmt(reservaSemOc)}</span>{" "}
                m reservado(s) por modelos sem OC atribuída (não consta nas linhas acima).
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Card mobile da variante (mesma fonte de dados do VarianteRow, via hook).
function VarianteCard({ row, enderecos }: { row: any; enderecos: EnderecoRollup[] }) {
  const [open, setOpen] = useState(false);
  const { ocRows, reservaSemOc, isLoading } = useEstoqueVarianteDetalhe(row.varId, open, row.reservado);
  return (
    <div className="rounded-lg border p-3">
      <button type="button" className="w-full text-left" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium truncate">
              {row.nomeVariante} <span className="text-[10px] text-muted-foreground">[{row.isKg ? "kg→m" : "m"}]</span>
            </div>
            {(() => {
              const g = agruparEnderecos(enderecos);
              if (g.length === 0) return null;
              return (
                <div className="text-[10px] text-muted-foreground truncate">
                  📍 {g[0].label}{g.length > 1 ? ` +${g.length - 1}` : ""}
                </div>
              );
            })()}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-lg font-semibold leading-none">
              {fmt(row.fisico)} <span className="text-xs font-normal">m</span>
            </div>
            <div className="text-[10px] text-muted-foreground">Físico Real</div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Prev. Receb.</span><span>{row.isKg ? `${fmt(row.prevRecebKg)} kg` : `${fmt(row.prevRecebM)} m`}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Recebido</span><span>{row.isKg ? `${fmt(row.recebidoKg)} kg` : `${fmt(row.recebidoM)} m`}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Reservado</span><span>{fmt(row.reservado)} m</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Previsto</span><span>{fmt(row.previsto)} m</span></div>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">{open ? "▾ ocultar OCs / endereços" : "▸ ver OCs / endereços"}</div>
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <div className="text-xs">
            <span className="font-semibold text-muted-foreground">Endereços: </span>
            {enderecos.length > 0 ? agruparEnderecos(enderecos).map((g) => g.label).join(" · ") : "—"}
          </div>
          <p className="text-xs font-semibold text-muted-foreground">Estoque por OC</p>
          {isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
          {!isLoading && ocRows.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma OC para esta variante.</p>}
          {ocRows.map((d) => (
            <div key={d.key} className={cn("rounded border p-2 text-xs", d.status === "recebida" ? "bg-emerald-50" : "bg-amber-50")}>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  #{d.oc ?? "—"}{" "}
                  <span className={cn("text-[9px] uppercase", d.status === "recebida" ? "text-emerald-700" : "text-amber-700")}>{d.status}</span>
                  {d.zerado && <Badge className="ml-1 h-4 px-1 text-[9px] bg-emerald-500 hover:bg-emerald-500">Zerado</Badge>}
                </span>
                <span className="font-semibold">{fmt(d.fisico)} m</span>
              </div>
              <div className="text-muted-foreground">{d.fornecedor ?? "—"}{d.entrega ? ` · ${new Date(d.entrega).toLocaleDateString("pt-BR")}` : ""}</div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span>Prev: {fmt(d.prevReceb)} m</span>
                <span>Receb: {fmt(d.recebido)} m</span>
                <span>Reserv: {fmt(d.reservado)} m</span>
                <span>Prev.: {fmt(d.previsto)} m</span>
              </div>
            </div>
          ))}
          {!isLoading && reservaSemOc > 0.01 && (
            <p className="text-xs italic text-muted-foreground">
              <span className="font-medium not-italic text-foreground">{fmt(reservaSemOc)}</span> m reservado(s) por modelos sem OC atribuída.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================ AVIAMENTOS ============================ */

function AviamentosTab() {
  const [search, setSearch] = useState("");
  const [fornecedor, setFornecedor] = useState<string>("all");
  const [categoria, setCategoria] = useState<string>("all");
  const [estoqueFilter, setEstoqueFilter] = useState<string>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["estoque-aviamentos"],
    queryFn: async () => {
      // Fonte ÚNICA: RPC canônica estoque_aviamento (mesma definição do dashboard e da
      // trava de saldo da OS). Antes eram 7 queries + agregação no cliente, que divergia
      // do dashboard (M2). fisico já vem clampado >=0; previsto = fisico + prev - reserva.
      const { data, error } = await supabase.rpc("estoque_aviamento" as any);
      if (error) throw error;
      const rows = ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        nome: r.nome,
        fornecedor: r.fornecedor ?? "—",
        fornecedorId: r.fornecedor_id,
        categoria: r.categoria ?? "—",
        categoriaId: r.categoria_id,
        prevReceb: Number(r.prev_receb ?? 0),
        recebido: Number(r.recebido ?? 0),
        baixa: Number(r.baixa ?? 0),
        reservado: Number(r.reservado ?? 0),
        fisico: Number(r.fisico ?? 0),
        previsto: Number(r.previsto ?? 0),
      }));
      return { rows };
    },
  });

  const fornecedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of (data?.rows ?? []) as any[]) if (r.fornecedorId) m.set(r.fornecedorId, r.fornecedor ?? "—");
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [data]);
  const categorias = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of (data?.rows ?? []) as any[]) if (r.categoriaId) m.set(r.categoriaId, r.categoria ?? "—");
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [data]);

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    const s = search.toLowerCase();
    return rows.filter((r: any) =>
      (!s || r.nome.toLowerCase().includes(s)) &&
      (fornecedor === "all" || r.fornecedorId === fornecedor) &&
      (categoria === "all" || r.categoriaId === categoria) &&
      (estoqueFilter === "all" || (estoqueFilter === "zero" ? r.fisico <= 0 : r.fisico > 0)),
    );
  }, [data, search, fornecedor, categoria, estoqueFilter]);

  // Ordenação clicável (cabeçalho desktop + <Select> "Ordenar por" nos cards mobile).
  const { sorted, sortKey, sortDir, toggle } = useSort<any>(filtered, { key: "nome" });
  const sortState = { sortKey, sortDir, toggle };

  return (
    <div className="space-y-4">
      <EstoqueHeader>
        <TabsList>
          <TabsTrigger value="tecidos">Tecidos</TabsTrigger>
          <TabsTrigger value="aviamentos"><span className="sm:hidden">Aviam.</span><span className="hidden sm:inline">Aviamentos</span></TabsTrigger>
          <TabsTrigger value="insumos">Insumos</TabsTrigger>
        </TabsList>
        <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => printWithImages()}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir
        </Button>
        <SearchToggle value={search} onChange={setSearch} placeholder="Aviamento" />
        <FilterButton
          filters={[
            { label: "Estoque", value: estoqueFilter, onChange: setEstoqueFilter, options: [{ id: "all", nome: "Todos" }, { id: "zero", nome: "Estoque Zerado" }, { id: "positive", nome: "Estoque > 0" }] },
            { label: "Fornecedor", value: fornecedor, onChange: setFornecedor, options: [{ id: "all", nome: "Todos" }, ...fornecedores] },
            { label: "Categoria", value: categoria, onChange: setCategoria, options: [{ id: "all", nome: "Todas" }, ...categorias] },
          ]}
        />
      </EstoqueHeader>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {error && <p className="text-sm text-destructive">Erro ao carregar estoque: {(error as Error).message}</p>}

      <Card className="p-4">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "4%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3"></th>
                <SortTh label="Aviamento" sortKey="nome" sortState={sortState} className="py-2 pr-3" />
                <SortTh label="Fornecedor" sortKey="fornecedor" sortState={sortState} className="py-2 pr-3" />
                <SortTh label="Categoria" sortKey="categoria" sortState={sortState} className="py-2 pr-3" />
                <SortTh label="Prev. Receb." sortKey="prevReceb" sortState={sortState} className="py-2 pr-3" align="right" />
                <SortTh label="Recebido" sortKey="recebido" sortState={sortState} className="py-2 pr-3" align="right" />
                <SortTh label="Físico Real" sortKey="fisico" sortState={sortState} className="py-2 pr-3" align="right" />
                <SortTh label="Reservado" sortKey="reservado" sortState={sortState} className="py-2 pr-3" align="right" />
                <SortTh label="Previsto" sortKey="previsto" sortState={sortState} className="py-2 pr-3" align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r: any) => (
                <AviamentoRow key={r.id} row={r} />
              ))}
              {!isLoading && sorted.length === 0 && (
                <tr><td colSpan={9} className="py-4 text-center text-muted-foreground">Nenhum aviamento encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Mobile: cards por aviamento */}
        <div className="md:hidden space-y-2">
          {/* Mobile: ordenação por <Select> (cards não têm cabeçalho clicável) */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground shrink-0">Ordenar por</Label>
            <Select value={sortKey ?? "nome"} onValueChange={(v) => toggle(v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nome">Aviamento</SelectItem>
                <SelectItem value="fornecedor">Fornecedor</SelectItem>
                <SelectItem value="categoria">Categoria</SelectItem>
                <SelectItem value="prevReceb">Prev. Receb.</SelectItem>
                <SelectItem value="recebido">Recebido</SelectItem>
                <SelectItem value="fisico">Físico Real</SelectItem>
                <SelectItem value="reservado">Reservado</SelectItem>
                <SelectItem value="previsto">Previsto</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {sorted.map((r: any) => (
            <AviamentoCard key={r.id} row={r} />
          ))}
          {!isLoading && sorted.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhum aviamento encontrado.</p>
          )}
        </div>
      </Card>

      <RelatorioPrint
        titulo="Posição de Estoque — Aviamentos"
        dataStr={new Date().toLocaleDateString("pt-BR")}
        colunas={[
          { key: "nome", label: "Aviamento" },
          { key: "fornecedor", label: "Fornecedor" },
          { key: "categoria", label: "Categoria" },
          { key: "fisico", label: "Físico", align: "right" },
          { key: "reservado", label: "Reservado", align: "right" },
          { key: "previsto", label: "Previsto", align: "right" },
        ]}
        linhas={filtered.map((r: any) => ({
          nome: r.nome,
          fornecedor: r.fornecedor ?? "—",
          categoria: r.categoria ?? "—",
          fisico: fmt(r.fisico),
          reservado: fmt(r.reservado),
          previsto: fmt(r.previsto),
        }))}
      />
    </div>
  );
}

// Detalhe de OCs de um aviamento (recebidas + pendentes), compartilhado entre a
// linha desktop e o card mobile.
function useEstoqueAviamentoDetalhe(aviamentoId: string, open: boolean) {
  const { data: pendentes = [], isLoading: loadingPend } = useQuery({
    queryKey: ["estoque-aviamento-pendentes-oc", aviamentoId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_aviamento_itens")
        .select("id, quantidade_pedida, ocs_aviamento!inner(numero_pedido, data_prevista_entrega, status, empresas(nome_fantasia))")
        .eq("aviamento_id", aviamentoId)
        .eq("ocs_aviamento.status", "encomendado")
        .eq("cancelado" as any, false);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const { data: recebidas = [], isLoading: loadingRec } = useQuery({
    queryKey: ["estoque-aviamento-recebidas-oc", aviamentoId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_aviamento_itens")
        .select("id, quantidade_recebida, ocs_aviamento!inner(numero_pedido, data_entrega, status, empresas(nome_fantasia))")
        .eq("aviamento_id", aviamentoId)
        .eq("ocs_aviamento.status", "recebido")
        .eq("cancelado" as any, false);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  return { pendentes, recebidas, loadingPend, loadingRec };
}

function AviamentoRow({ row }: { row: any }) {
  const [open, setOpen] = useState(false);
  const { pendentes, recebidas, loadingPend, loadingRec } = useEstoqueAviamentoDetalhe(row.id, open);
  return (
    <>
      <tr className="border-b last:border-0 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <td className="py-2 pr-3 text-muted-foreground">{open ? "▾" : "▸"}</td>
        <td className="py-2 pr-3">{row.nome}</td>
        <td className="py-2 pr-3">{row.fornecedor}</td>
        <td className="py-2 pr-3">{row.categoria}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.prevReceb)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.recebido)}</td>
        <td className="py-2 pr-3 text-right font-medium">{fmt(row.fisico)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.reservado)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.previsto)}</td>
      </tr>
      {open && (
        <tr className="bg-muted/30">
          <td></td>
          <td colSpan={8} className="py-2 pr-3 space-y-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">OCs Recebidas</p>
              {loadingRec && <p className="text-xs text-muted-foreground">Carregando…</p>}
              {!loadingRec && recebidas.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma OC recebida.</p>
              )}
              {recebidas.length > 0 && (
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1 pr-3">OC</th>
                      <th className="py-1 pr-3">Fornecedor</th>
                      <th className="py-1 pr-3">Entrega</th>
                      <th className="py-1 pr-3 text-right">Recebido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recebidas.map((r: any) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-1 pr-3">#{r.ocs_aviamento?.numero_pedido ?? "—"}</td>
                        <td className="py-1 pr-3">{r.ocs_aviamento?.empresas?.nome_fantasia ?? "—"}</td>
                        <td className="py-1 pr-3">{r.ocs_aviamento?.data_entrega ? new Date(r.ocs_aviamento.data_entrega).toLocaleDateString("pt-BR") : "—"}</td>
                        <td className="py-1 pr-3 text-right">{fmt(Number(r.quantidade_recebida ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">OCs Pendentes (Prev. Recebimento)</p>
              {loadingPend && <p className="text-xs text-muted-foreground">Carregando…</p>}
              {!loadingPend && pendentes.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma OC pendente.</p>
              )}
              {pendentes.length > 0 && (
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1 pr-3">OC</th>
                      <th className="py-1 pr-3">Fornecedor</th>
                      <th className="py-1 pr-3">Entrega Prev.</th>
                      <th className="py-1 pr-3 text-right">Qtd Pedida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendentes.map((p: any) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-1 pr-3">#{p.ocs_aviamento?.numero_pedido ?? "—"}</td>
                        <td className="py-1 pr-3">{p.ocs_aviamento?.empresas?.nome_fantasia ?? "—"}</td>
                        <td className="py-1 pr-3">{p.ocs_aviamento?.data_prevista_entrega ? new Date(p.ocs_aviamento.data_prevista_entrega).toLocaleDateString("pt-BR") : "—"}</td>
                        <td className="py-1 pr-3 text-right">{fmt(Number(p.quantidade_pedida ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// Card mobile do aviamento (mesma fonte de dados do AviamentoRow, via hook).
function AviamentoCard({ row }: { row: any }) {
  const [open, setOpen] = useState(false);
  const { pendentes, recebidas, loadingPend, loadingRec } = useEstoqueAviamentoDetalhe(row.id, open);
  return (
    <div className="rounded-lg border p-3">
      <button type="button" className="w-full text-left" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium truncate">{row.nome}</div>
            <div className="text-[10px] text-muted-foreground truncate">{row.fornecedor ?? "—"}{row.categoria ? ` · ${row.categoria}` : ""}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-lg font-semibold leading-none">{fmt(row.fisico)}</div>
            <div className="text-[10px] text-muted-foreground">Físico Real</div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Prev. Receb.</span><span>{fmt(row.prevReceb)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Recebido</span><span>{fmt(row.recebido)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Reservado</span><span>{fmt(row.reservado)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Previsto</span><span>{fmt(row.previsto)}</span></div>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">{open ? "▾ ocultar OCs" : "▸ ver OCs"}</div>
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">OCs Recebidas</p>
            {loadingRec && <p className="text-xs text-muted-foreground">Carregando…</p>}
            {!loadingRec && recebidas.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma OC recebida.</p>}
            {recebidas.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded border bg-emerald-50 px-2 py-1 text-xs">
                <span className="min-w-0 truncate">#{r.ocs_aviamento?.numero_pedido ?? "—"} · {r.ocs_aviamento?.empresas?.nome_fantasia ?? "—"}{r.ocs_aviamento?.data_entrega ? ` · ${new Date(r.ocs_aviamento.data_entrega).toLocaleDateString("pt-BR")}` : ""}</span>
                <span className="shrink-0 font-medium">{fmt(Number(r.quantidade_recebida ?? 0))}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">OCs Pendentes</p>
            {loadingPend && <p className="text-xs text-muted-foreground">Carregando…</p>}
            {!loadingPend && pendentes.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma OC pendente.</p>}
            {pendentes.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded border bg-amber-50 px-2 py-1 text-xs">
                <span className="min-w-0 truncate">#{p.ocs_aviamento?.numero_pedido ?? "—"} · {p.ocs_aviamento?.empresas?.nome_fantasia ?? "—"}{p.ocs_aviamento?.data_prevista_entrega ? ` · ${new Date(p.ocs_aviamento.data_prevista_entrega).toLocaleDateString("pt-BR")}` : ""}</span>
                <span className="shrink-0 font-medium">{fmt(Number(p.quantidade_pedida ?? 0))}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================ INSUMOS ============================ */

const fmtTamInsumo = (t: string) => { const [n, s] = t.split("|"); return s ? `${s} · ${n}` : t; };

function InsumosTab() {
  const [search, setSearch] = useState("");
  const [estoqueFilter, setEstoqueFilter] = useState("all");
  const { data = [], isLoading } = useQuery({
    queryKey: ["estoque-insumos"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("estoque_etiqueta" as any);
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        etiquetaId: r.etiqueta_id as string, etiquetaNome: r.etiqueta_nome as string,
        tamanho: r.tamanho as string | null, corNome: r.cor_nome as string | null,
        recebido: num(r.recebido), prevReceb: num(r.prev_receb), baixa: num(r.baixa), fisico: num(r.fisico),
      }));
    },
  });
  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return data.filter((r) => {
      if (estoqueFilter === "zero" && r.fisico > 0) return false;
      if (estoqueFilter === "positive" && r.fisico <= 0) return false;
      if (s && !r.etiquetaNome.toLowerCase().includes(s) && !(r.corNome ?? "").toLowerCase().includes(s)) return false;
      return true;
    });
  }, [data, search, estoqueFilter]);

  // Dois níveis de agrupamento dentro do insumo: por COR, e dentro dela por TAMANHO.
  const grouped = useMemo(() => {
    const insMap = new Map<string, { id: string; nome: string; coresMap: Map<string, { cor: string | null; rows: any[] }> }>();
    for (const r of filtered) {
      let ins = insMap.get(r.etiquetaId);
      if (!ins) { ins = { id: r.etiquetaId, nome: r.etiquetaNome, coresMap: new Map() }; insMap.set(r.etiquetaId, ins); }
      const corKey = r.corNome ?? "__semcor__";
      let cor = ins.coresMap.get(corKey);
      if (!cor) { cor = { cor: r.corNome ?? null, rows: [] }; ins.coresMap.set(corKey, cor); }
      cor.rows.push(r);
    }
    return Array.from(insMap.values())
      .map((ins) => ({
        id: ins.id, nome: ins.nome,
        cores: Array.from(ins.coresMap.values())
          .map((c) => ({ cor: c.cor, rows: c.rows.sort((a, b) => (a.tamanho ?? "").localeCompare(b.tamanho ?? "")) }))
          .sort((a, b) => (a.cor ?? "").localeCompare(b.cor ?? "")),
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [filtered]);

  return (
    <div className="space-y-4">
      <EstoqueHeader>
        <TabsList>
          <TabsTrigger value="tecidos">Tecidos</TabsTrigger>
          <TabsTrigger value="aviamentos"><span className="sm:hidden">Aviam.</span><span className="hidden sm:inline">Aviamentos</span></TabsTrigger>
          <TabsTrigger value="insumos">Insumos</TabsTrigger>
        </TabsList>
        <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => printWithImages()}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir
        </Button>
        <SearchToggle value={search} onChange={setSearch} placeholder="Insumo ou cor" />
        <FilterButton
          filters={[
            { label: "Estoque", value: estoqueFilter, onChange: setEstoqueFilter, options: [{ id: "all", nome: "Todos" }, { id: "zero", nome: "Estoque Zerado" }, { id: "positive", nome: "Estoque > 0" }] },
          ]}
        />
      </EstoqueHeader>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : grouped.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          <Boxes className="h-8 w-8 mx-auto mb-2 opacity-50" />
          Sem insumos em estoque. Compras (OC Insumo) e consumos (CAD) aparecem aqui.
        </div>
      ) : (
        grouped.map((g) => (
          <Card key={g.id} className="p-4">
            <h3 className="font-semibold mb-3">{g.nome}</h3>
            <div className="space-y-3">
              {g.cores.map((c, ci) => (
                <div key={ci}>
                  {c.cor && <h4 className="text-sm font-medium mb-1 text-muted-foreground">{c.cor}</h4>}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-muted-foreground">
                        <tr className="border-b">
                          <th className="py-2 pr-3">Tamanho</th>
                          <th className="py-2 pr-3 text-right">Prev. Receb.</th>
                          <th className="py-2 pr-3 text-right">Recebido</th>
                          <th className="py-2 pr-3 text-right">Baixa</th>
                          <th className="py-2 pr-3 text-right">Físico</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.rows.map((r: any, i: number) => (
                          <tr key={i} className="border-t">
                            <td className="py-2 pr-3" data-label="Tamanho">{r.tamanho ? fmtTamInsumo(r.tamanho) : "Geral"}</td>
                            <td className="py-2 pr-3 text-right" data-label="Prev. Receb.">{fmt(r.prevReceb)}</td>
                            <td className="py-2 pr-3 text-right" data-label="Recebido">{fmt(r.recebido)}</td>
                            <td className="py-2 pr-3 text-right" data-label="Baixa">{fmt(r.baixa)}</td>
                            <td className="py-2 pr-3 text-right font-medium" data-label="Físico">{fmt(r.fisico)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))
      )}

      <RelatorioPrint
        titulo="Posição de Estoque — Insumos"
        dataStr={new Date().toLocaleDateString("pt-BR")}
        colunas={[
          { key: "insumo", label: "Insumo" },
          { key: "cor", label: "Cor" },
          { key: "tamanho", label: "Tamanho" },
          { key: "prev", label: "Prev. Receb.", align: "right" },
          { key: "recebido", label: "Recebido", align: "right" },
          { key: "baixa", label: "Baixa", align: "right" },
          { key: "fisico", label: "Físico", align: "right" },
        ]}
        linhas={grouped.flatMap((g) => g.cores.flatMap((c) => c.rows.map((r: any) => ({
          insumo: g.nome,
          cor: c.cor ?? "—",
          tamanho: r.tamanho ? fmtTamInsumo(r.tamanho) : "Geral",
          prev: fmt(r.prevReceb),
          recebido: fmt(r.recebido),
          baixa: fmt(r.baixa),
          fisico: fmt(r.fisico),
        }))))}
      />
    </div>
  );
}
