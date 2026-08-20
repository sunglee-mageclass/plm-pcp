import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { RelatorioPrint } from "@/components/shared/RelatorioPrint";
import { fmtNum } from "@/lib/format";
import { corApelidoLabel } from "@/lib/variante";
import { SortTh } from "@/components/shared/sort";
import { useSort } from "@/components/shared/sort";

// Posição de estoque de AVIAMENTOS — 3ª aba "Estoque" do OC Aviamento. Fonte ÚNICA: RPC
// `estoque_aviamento`, que agora retorna 1 linha por AVIAMENTO × VARIANTE (cor base +
// apelido), espelhando o estoque de tecido (físico = recebido − baixa POR variante; a conta
// mora só no _core, ninguém re-implementa). A tela agrupa por aviamento (colapsável) e mostra
// uma linha por variante; "Sem variante" = bucket legado/sem cor (não some). Preservar a
// queryKey ["estoque-aviamentos"]. Os CONTROLES (busca, imprimir, filtro) vivem no HEADER da OC.

const num = (v: any) => Number(v ?? 0) || 0;
const fmt = (v: number) => fmtNum(v);

/** Rótulo da variante do aviamento (mesma régua do tecido): nome_variante → "cor - apelido"
 *  → código → fallback. variante_id NULL = "Sem variante" (legado/sem cor). */
function varianteLabelAvi(r: { variId: string | null; varianteNome?: string | null; varianteCodigo?: string | null; cor?: string | null; apelido?: string | null }): string {
  if (r.variId == null) return "Sem variante";
  const corLbl = corApelidoLabel(r.cor, r.apelido);
  const base = (r.varianteNome ?? "").trim() || (corLbl !== "—" ? corLbl : "") || (r.varianteCodigo ?? "").trim();
  return base || "Variante";
}

/** Estado + consulta + filtros da aba Estoque de aviamentos. Chamado pela PÁGINA da OC p/
 *  montar os controles no header (contextuais) e alimentar a tabela. `enabled` = aba ativa. */
export function useEstoqueAviamentos(enabled: boolean) {
  const [search, setSearch] = useState("");
  const [fornecedor, setFornecedor] = useState<string>("all");
  const [categoria, setCategoria] = useState<string>("all");
  const [estoqueFilter, setEstoqueFilter] = useState<string>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["estoque-aviamentos"],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("estoque_aviamento" as any);
      if (error) throw error;
      const rows = ((data ?? []) as any[]).map((r) => {
        const base = {
          aviamentoId: r.id as string,
          aviamentoNome: r.nome as string,
          fornecedor: (r.fornecedor ?? "—") as string,
          fornecedorId: r.fornecedor_id as string | null,
          categoria: (r.categoria ?? "—") as string,
          categoriaId: r.categoria_id as string | null,
          variId: (r.variante_id ?? null) as string | null,
          varianteNome: r.variante_nome as string | null,
          varianteCodigo: r.variante_codigo as string | null,
          cor: r.cor as string | null,
          apelido: r.apelido as string | null,
          prevReceb: num(r.prev_receb), recebido: num(r.recebido), baixa: num(r.baixa),
          reservado: num(r.reservado), fisico: num(r.fisico), previsto: num(r.previsto),
        };
        return { ...base, varianteLabel: varianteLabelAvi(base) };
      });
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
      (!s || r.aviamentoNome.toLowerCase().includes(s) || r.varianteLabel.toLowerCase().includes(s)) &&
      (fornecedor === "all" || r.fornecedorId === fornecedor) &&
      (categoria === "all" || r.categoriaId === categoria) &&
      (estoqueFilter === "all" || (estoqueFilter === "zero" ? r.fisico <= 0 : r.fisico > 0)),
    );
  }, [data, search, fornecedor, categoria, estoqueFilter]);

  const { sorted, sortKey, sortDir, toggle } = useSort<any>(filtered, { key: "varianteLabel" });
  const sortState = { sortKey, sortDir, toggle };

  // Agrupa por aviamento (as linhas já vêm ordenadas pelo sortKey). Ordem dos GRUPOS = nome do
  // aviamento (independe do sort das linhas, espelha o estoque de tecido).
  const grouped = useMemo(() => {
    const map = new Map<string, { aviamentoId: string; aviamentoNome: string; fornecedor: string; categoria: string; rows: any[] }>();
    for (const r of sorted) {
      const g = map.get(r.aviamentoId) ?? { aviamentoId: r.aviamentoId, aviamentoNome: r.aviamentoNome, fornecedor: r.fornecedor, categoria: r.categoria, rows: [] as any[] };
      g.rows.push(r);
      map.set(r.aviamentoId, g);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.aviamentoNome.localeCompare(b.aviamentoNome, "pt-BR", { numeric: true, sensitivity: "base" }),
    );
  }, [sorted]);

  // Descritores prontos p/ o <FilterButton> do header (filtros de estoque, não os da OC).
  const filtros = [
    { label: "Estoque", value: estoqueFilter, onChange: setEstoqueFilter, options: [{ id: "all", nome: "Todos" }, { id: "zero", nome: "Estoque Zerado" }, { id: "positive", nome: "Estoque > 0" }] },
    { label: "Fornecedor", value: fornecedor, onChange: setFornecedor, options: [{ id: "all", nome: "Todos" }, ...fornecedores] },
    { label: "Categoria", value: categoria, onChange: setCategoria, options: [{ id: "all", nome: "Todas" }, ...categorias] },
  ];

  return { search, setSearch, filtros, filtered, grouped, sortKey, sortState, toggle, isLoading, error };
}

/** Tabela agrupada por aviamento (desktop) + cards (mobile) + área de impressão. */
export function EstoqueAviamentosTable({ state }: { state: ReturnType<typeof useEstoqueAviamentos> }) {
  const { filtered, grouped, sortKey, sortState, toggle, isLoading, error } = state;

  // Expandir/recolher todos os aviamentos. `collapsed` = ids recolhidos (vazio = todos abertos).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const setGroupOpen = (id: string, open: boolean) =>
    setCollapsed((prev) => { const n = new Set(prev); if (open) n.delete(id); else n.add(id); return n; });
  const allCollapsed = grouped.length > 0 && grouped.every((g) => collapsed.has(g.aviamentoId));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(grouped.map((g) => g.aviamentoId)));

  return (
    <div className="space-y-4">
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {error && <p className="text-sm text-destructive">Erro ao carregar estoque: {(error as Error).message}</p>}

      {/* Mobile: ordenação por <Select> (cards não têm cabeçalho clicável) */}
      <div className="md:hidden flex items-center gap-2">
        <Label className="text-xs text-muted-foreground shrink-0">Ordenar por</Label>
        <Select value={sortKey ?? "varianteLabel"} onValueChange={(v) => toggle(v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="varianteLabel">Variante</SelectItem>
            <SelectItem value="prevReceb">Prev. Receb.</SelectItem>
            <SelectItem value="recebido">Recebido</SelectItem>
            <SelectItem value="fisico">Físico Real</SelectItem>
            <SelectItem value="reservado">Reservado</SelectItem>
            <SelectItem value="previsto">Previsto</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {grouped.length > 1 && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={toggleAll}>
            {allCollapsed ? <><ChevronsUpDown className="h-4 w-4 mr-1" /> Expandir todos</> : <><ChevronsDownUp className="h-4 w-4 mr-1" /> Recolher todos</>}
          </Button>
        </div>
      )}

      {grouped.map((g) => {
        // Físico do aviamento = Σ das variantes (rótulo do cabeçalho recolhido).
        const totFisico = (g.rows as any[]).reduce((s, r) => s + num(r.fisico), 0);
        // Variantes REAIS do aviamento (sem o bucket "Sem variante") — regra de atribuição do
        // legado no detalhe por OC: se há exatamente 1 variante real, o item de OC sem variante
        // pertence a ela; senão o item sem variante fica no bucket "Sem variante".
        const realVarIds = (g.rows as any[]).map((r) => r.variId).filter(Boolean) as string[];
        const soleVarId = realVarIds.length === 1 ? realVarIds[0] : null;
        return (
          <Card key={g.aviamentoId} className="p-4">
            <Collapsible open={!collapsed.has(g.aviamentoId)} onOpenChange={(o) => setGroupOpen(g.aviamentoId, o)}>
              <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-2 text-left font-semibold [&[data-state=open]>svg]:rotate-90">
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
                <span className="min-w-0 truncate">{g.aviamentoNome}</span>
                <span className="ml-2 hidden shrink-0 text-xs font-normal text-muted-foreground sm:inline">
                  {g.fornecedor}{g.categoria && g.categoria !== "—" ? ` · ${g.categoria}` : ""}
                </span>
                <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                  {fmt(totFisico)} un · {g.rows.length} {g.rows.length === 1 ? "variante" : "variantes"}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
                    <colgroup>
                      <col style={{ width: "4%" }} />
                      <col style={{ width: "28%" }} />
                      <col style={{ width: "13.6%" }} />
                      <col style={{ width: "13.6%" }} />
                      <col style={{ width: "13.6%" }} />
                      <col style={{ width: "13.6%" }} />
                      <col style={{ width: "13.6%" }} />
                    </colgroup>
                    <thead className="text-left text-muted-foreground">
                      <tr className="border-b">
                        <th className="py-2 pr-3"></th>
                        <SortTh label="Variante" sortKey="varianteLabel" sortState={sortState} className="py-2 pr-3" />
                        <SortTh label="Prev. Receb." sortKey="prevReceb" sortState={sortState} className="py-2 pr-3" align="right" />
                        <SortTh label="Recebido" sortKey="recebido" sortState={sortState} className="py-2 pr-3" align="right" />
                        <SortTh label="Físico Real" sortKey="fisico" sortState={sortState} className="py-2 pr-3" align="right" />
                        <SortTh label="Reservado" sortKey="reservado" sortState={sortState} className="py-2 pr-3" align="right" />
                        <SortTh label="Previsto" sortKey="previsto" sortState={sortState} className="py-2 pr-3" align="right" />
                      </tr>
                    </thead>
                    <tbody>
                      {(g.rows as any[]).map((r) => (
                        <VarianteRow key={r.variId ?? "sem-variante"} row={r} soleVarId={soleVarId} />
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile: cards por variante */}
                <div className="md:hidden space-y-2">
                  {(g.rows as any[]).map((r) => (
                    <VarianteCard key={r.variId ?? "sem-variante"} row={r} soleVarId={soleVarId} />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        );
      })}

      {!isLoading && grouped.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhum aviamento encontrado.</p>
      )}

      <RelatorioPrint
        titulo="Posição de Estoque — Aviamentos"
        dataStr={new Date().toLocaleDateString("pt-BR")}
        colunas={[
          { key: "nome", label: "Aviamento" },
          { key: "variante", label: "Variante" },
          { key: "fornecedor", label: "Fornecedor" },
          { key: "categoria", label: "Categoria" },
          { key: "fisico", label: "Físico", align: "right" },
          { key: "reservado", label: "Reservado", align: "right" },
          { key: "previsto", label: "Previsto", align: "right" },
        ]}
        linhas={filtered.map((r: any) => ({
          nome: r.aviamentoNome,
          variante: r.varianteLabel,
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

// Detalhe de OCs de um aviamento restrito a uma VARIANTE (recebidas + pendentes). Filtra os
// itens de OC por variante_aviamento_id, aplicando a atribuição do legado (item sem variante
// pertence à ÚNICA variante do aviamento). `soleVarId` != null quando o aviamento tem 1 variante.
function useEstoqueAviamentoVarianteDetalhe(row: any, soleVarId: string | null, open: boolean) {
  const aviamentoId = row.aviamentoId as string;
  const variId = row.variId as string | null;
  // effetiva(item) = item.variante ?? soleVarId ; casa com esta variante quando == variId.
  const matches = (itVar: string | null) => {
    const eff = itVar ?? soleVarId;
    return (eff ?? null) === (variId ?? null);
  };
  const { data: pendentes = [], isLoading: loadingPend } = useQuery({
    queryKey: ["estoque-aviamento-var-pendentes-oc", aviamentoId, variId ?? "sem"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_aviamento_itens")
        .select("id, quantidade_pedida, variante_aviamento_id, ocs_aviamento!inner(numero_pedido, data_prevista_entrega, status, empresas(nome_fantasia))")
        .eq("aviamento_id", aviamentoId)
        .eq("ocs_aviamento.status", "encomendado")
        .eq("cancelado" as any, false);
      if (error) throw error;
      return ((data ?? []) as any[]).filter((r) => matches(r.variante_aviamento_id ?? null));
    },
  });
  const { data: recebidas = [], isLoading: loadingRec } = useQuery({
    queryKey: ["estoque-aviamento-var-recebidas-oc", aviamentoId, variId ?? "sem"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_aviamento_itens")
        .select("id, quantidade_recebida, variante_aviamento_id, ocs_aviamento!inner(numero_pedido, data_entrega, status, empresas(nome_fantasia))")
        .eq("aviamento_id", aviamentoId)
        .eq("ocs_aviamento.status", "recebido")
        .eq("cancelado" as any, false);
      if (error) throw error;
      return ((data ?? []) as any[]).filter((r) => matches(r.variante_aviamento_id ?? null));
    },
  });
  return { pendentes, recebidas, loadingPend, loadingRec };
}

function OcDetalhe({ row, soleVarId }: { row: any; soleVarId: string | null }) {
  const { pendentes, recebidas, loadingPend, loadingRec } = useEstoqueAviamentoVarianteDetalhe(row, soleVarId, true);
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-1">OCs Recebidas</p>
        {loadingRec && <p className="text-xs text-muted-foreground">Carregando…</p>}
        {!loadingRec && recebidas.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma OC recebida.</p>}
        {recebidas.length > 0 && (
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b"><th className="py-1 pr-3">OC</th><th className="py-1 pr-3">Fornecedor</th><th className="py-1 pr-3">Entrega</th><th className="py-1 pr-3 text-right">Recebido</th></tr>
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
        {!loadingPend && pendentes.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma OC pendente.</p>}
        {pendentes.length > 0 && (
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b"><th className="py-1 pr-3">OC</th><th className="py-1 pr-3">Fornecedor</th><th className="py-1 pr-3">Entrega Prev.</th><th className="py-1 pr-3 text-right">Qtd Pedida</th></tr>
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
    </div>
  );
}

function VarianteRow({ row, soleVarId }: { row: any; soleVarId: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-b last:border-0 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <td className="py-2 pr-3 text-muted-foreground">{open ? "▾" : "▸"}</td>
        <td className="py-2 pr-3">{row.varianteLabel}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.prevReceb)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.recebido)}</td>
        <td className="py-2 pr-3 text-right font-medium">{fmt(row.fisico)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.reservado)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.previsto)}</td>
      </tr>
      {open && (
        <tr className="bg-muted/30">
          <td></td>
          <td colSpan={6} className="py-2 pr-3">
            <OcDetalhe row={row} soleVarId={soleVarId} />
          </td>
        </tr>
      )}
    </>
  );
}

function VarianteCard({ row, soleVarId }: { row: any; soleVarId: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border p-3">
      <button type="button" className="w-full text-left" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium truncate">{row.varianteLabel}</div>
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
        <div className="mt-2 border-t pt-2">
          <OcDetalhe row={row} soleVarId={soleVarId} />
        </div>
      )}
    </div>
  );
}
