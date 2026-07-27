import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { printWithImages } from "@/lib/print";
import { RelatorioPrint } from "@/components/shared/RelatorioPrint";
import { fmtNum } from "@/lib/format";
import { FilterButton, SearchToggle } from "@/components/shared/filters";
import { useSort, SortTh } from "@/components/shared/sort";

// Posição de estoque de AVIAMENTOS — antes era a aba "Aviamentos" da tela Estoque (removida);
// hoje é a 3ª aba "Estoque" do OC Aviamento. Fonte ÚNICA: RPC `estoque_aviamento`.
// Preservar a queryKey ["estoque-aviamentos"] — invalidada em vários lugares.

const num = (v: any) => Number(v ?? 0) || 0;
const fmt = (v: number) => fmtNum(v);

export function EstoqueAviamentosTab() {
  const [search, setSearch] = useState("");
  const [fornecedor, setFornecedor] = useState<string>("all");
  const [categoria, setCategoria] = useState<string>("all");
  const [estoqueFilter, setEstoqueFilter] = useState<string>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["estoque-aviamentos"],
    queryFn: async () => {
      // Fonte ÚNICA: RPC canônica estoque_aviamento (mesma do dashboard e da trava da OS).
      // fisico já vem clampado >=0; previsto = fisico + prev - reserva.
      const { data, error } = await supabase.rpc("estoque_aviamento" as any);
      if (error) throw error;
      const rows = ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        nome: r.nome,
        fornecedor: r.fornecedor ?? "—",
        fornecedorId: r.fornecedor_id,
        categoria: r.categoria ?? "—",
        categoriaId: r.categoria_id,
        prevReceb: num(r.prev_receb),
        recebido: num(r.recebido),
        baixa: num(r.baixa),
        reservado: num(r.reservado),
        fisico: num(r.fisico),
        previsto: num(r.previsto),
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

  const { sorted, sortKey, sortDir, toggle } = useSort<any>(filtered, { key: "nome" });
  const sortState = { sortKey, sortDir, toggle };

  return (
    <div className="space-y-4">
      {/* Toolbar (sem TabsList/título — a aba do OC Aviamento já rotula "Estoque"). */}
      <div className="flex flex-wrap items-center justify-end gap-2">
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
      </div>

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

// Detalhe de OCs de um aviamento (recebidas + pendentes), compartilhado entre a linha
// desktop e o card mobile.
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
