import { useMemo, useState } from "react";
import { useFilterState } from "@/hooks/useFilterState";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, MapPin, Plus, Trash2 } from "lucide-react";
import { RelatorioPrint } from "@/components/shared/RelatorioPrint";
import { useReadOnly } from "@/components/RequirePermission";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { labelVarianteRow } from "@/lib/variante";
import { useSort, SortTh } from "@/components/shared/sort";
import { useEnderecosRollup, agruparEnderecos, type EnderecoRollup } from "@/components/tecido/EnderecoEditor";

// Posição de estoque de TECIDOS — antes era a aba "Tecidos" da tela Estoque (removida);
// hoje é a 3ª aba "Estoque" do OC Tecido. Fonte ÚNICA: RPC `estoque_tecido`. Preservar a
// queryKey ["estoque-tecidos"] — ~15 lugares a invalidam. Os CONTROLES (busca, imprimir,
// filtro) vivem no HEADER da OC (via o hook abaixo); aqui fica só a tabela.

const num = (v: any) => Number(v ?? 0) || 0;
const fmt = (v: number) => fmtNum(v);

// Tooltips das colunas da tabela de estoque: o que é + a conta (espelha `_estoque_tecido_core`).
const COL_TIPS = {
  prevReceb: (<><b>Previsto receber:</b> o que ainda vai chegar — metragem das OCs <b>encomendadas</b> (não recebidas). Tecido em kg é convertido p/ metros (× rendimento).</>),
  recebido: (<><b>Recebido:</b> o que já entrou — metragem das OCs <b>recebidas</b>. Tecido em kg é convertido p/ metros (× rendimento).</>),
  fisico: (<><b>Físico Real:</b> estoque físico agora.<br /><b>Conta:</b> Recebido − Baixa (baixa = consumo no corte/OS + ajustes). Nunca fica negativo (mín. 0).</>),
  reservado: (<><b>Reservado:</b> demanda que já reservou este tecido — modelos ainda não cortados (consumo × grade × (1+perda)) + Ordens de Saída abertas.</>),
  previsto: (<><b>Previsto:</b> saldo projetado.<br /><b>Conta:</b> Físico Real + Previsto receber − Reservado. Pode ficar negativo (reserva &gt; disponível).</>),
};

/** Estado + consulta + filtros da aba Estoque de tecidos. Chamado pela PÁGINA do OC p/
 *  montar os controles no header (contextuais) e alimentar a tabela. `enabled` = aba ativa. */
export function useEstoqueTecidos(enabled: boolean) {
  const [search, setSearch] = useState("");
  const [fornecedor, setFornecedor] = useFilterState("oc-tecido-estoque", "Fornecedor", []);
  const [categoria, setCategoria] = useFilterState("oc-tecido-estoque", "Categoria", []);
  const [estoqueFilter, setEstoqueFilter] = useFilterState("oc-tecido-estoque", "Estoque", []);

  // Endereços vêm do rollup consolidado (tabela enderecamento_tecido + colunas do rolo).
  const { data: rollup } = useEnderecosRollup(enabled);

  const { data, isLoading, error } = useQuery({
    queryKey: ["estoque-tecidos"],
    enabled,
    queryFn: async () => {
      // Fonte ÚNICA: RPC canônica estoque_tecido (mesma do dashboard). Só metadados da
      // variante (1 query) + os números da RPC. fisico já vem clampado >=0; kg = metros/rendimento.
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
      (!fornecedor.length || fornecedor.includes(r.fornecedorId ?? "")) &&
      (!categoria.length || categoria.includes(r.categoriaId ?? "")) &&
      (!estoqueFilter.length || estoqueFilter.some((e) => (e === "zero" ? r.fisico <= 0 : r.fisico > 0))),
    );
  }, [data, search, fornecedor, categoria, estoqueFilter]);

  const { sorted, sortKey, sortDir, toggle } = useSort<any>(filtered, { key: "nomeVariante" });
  const sortState = { sortKey, sortDir, toggle };

  const grouped = useMemo(() => {
    const map = new Map<string, { artigoId: string; artigoNome: string; rows: any[] }>();
    for (const r of sorted) {
      const key = r.artigoId ?? `sem-artigo-${r.varId}`;
      const g = map.get(key) ?? { artigoId: key, artigoNome: r.artigoNome, rows: [] as any[] };
      g.rows.push(r);
      map.set(key, g);
    }
    // Cada TECIDO (grupo) sempre em ordem alfabética pelo nome do artigo — independe do sortKey das
    // linhas (`sorted` pode estar por Recebido/Físico/etc.; a ordem de INSERÇÃO no Map então seguia a
    // 1ª linha de cada tecido a aparecer nesse sort, não o nome do tecido — bug ago/2026).
    return Array.from(map.values()).sort((a, b) =>
      a.artigoNome.localeCompare(b.artigoNome, "pt-BR", { numeric: true, sensitivity: "base" }),
    );
  }, [sorted]);

  // Descritores prontos p/ o <FilterButton> do header (filtros de estoque, não os da OC).
  const filtros = [
    { label: "Estoque", value: estoqueFilter, onChange: setEstoqueFilter, options: [{ id: "zero", nome: "Estoque Zerado" }, { id: "positive", nome: "Estoque > 0" }] },
    { label: "Fornecedor", value: fornecedor, onChange: setFornecedor, options: fornecedores },
    { label: "Categoria", value: categoria, onChange: setCategoria, options: categorias },
  ];

  return { search, setSearch, filtros, grouped, rollup, sortKey, sortState, toggle, isLoading, error };
}

/** Tabela agrupada por tecido (desktop) + cards (mobile) + área de impressão. Recebe o estado do hook. */
export function EstoqueTecidosTable({ state }: { state: ReturnType<typeof useEstoqueTecidos> }) {
  const { grouped, rollup, sortKey, sortState, toggle, isLoading, error } = state;
  const readOnly = useReadOnly();

  // Seleção de variantes p/ endereçamento em massa (guarda varId). Marcar um TECIDO marca
  // todas as suas variantes. A seleção considera só o que está VISÍVEL (pós-filtro/busca).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);

  // Expandir/recolher todos os tecidos. `collapsed` = ids recolhidos (vazio = todos abertos, igual ao
  // defaultOpen antigo); tecido novo pós-filtro nasce aberto. O Collapsible passa a ser CONTROLADO.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const setGroupOpen = (id: string, open: boolean) =>
    setCollapsed((prev) => { const n = new Set(prev); if (open) n.delete(id); else n.add(id); return n; });
  const allCollapsed = grouped.length > 0 && grouped.every((g) => collapsed.has(g.artigoId));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(grouped.map((g) => g.artigoId)));

  const visibleIds = useMemo(() => grouped.flatMap((g) => g.rows.map((r: any) => r.varId as string)), [grouped]);
  const selectedVisible = useMemo(() => visibleIds.filter((id) => selected.has(id)), [visibleIds, selected]);
  // varId -> { tecido, variante } — p/ o diálogo mostrar a que tecido cada endereço pertence.
  const varInfo = useMemo(() => {
    const m: Record<string, { tecido: string; variante: string }> = {};
    for (const g of grouped) for (const r of g.rows as any[]) m[r.varId] = { tecido: g.artigoNome, variante: r.nomeVariante };
    return m;
  }, [grouped]);

  const toggleVar = (varId: string) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(varId)) n.delete(varId); else n.add(varId); return n; });
  const groupIds = (g: any) => (g.rows as any[]).map((r) => r.varId as string);
  const groupState = (g: any): boolean | "indeterminate" => {
    const ids = groupIds(g);
    const sel = ids.filter((id) => selected.has(id)).length;
    return sel === 0 ? false : sel === ids.length ? true : "indeterminate";
  };
  const toggleGroup = (g: any) =>
    setSelected((prev) => {
      const ids = groupIds(g);
      const all = ids.every((id) => prev.has(id));
      const n = new Set(prev);
      ids.forEach((id) => (all ? n.delete(id) : n.add(id)));
      return n;
    });
  const clearSel = () => setSelected(new Set());

  return (
    <div className="space-y-4">
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {error && <p className="text-sm text-destructive">Erro ao carregar estoque: {(error as Error).message}</p>}

      {/* Barra de seleção (endereçamento em massa) — só com permissão de edição da OC. */}
      {!readOnly && selectedVisible.length > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-2 shadow-sm backdrop-blur">
          <span className="text-sm font-medium">{selectedVisible.length} variante(s) selecionada(s)</span>
          <Button size="sm" onClick={() => setDialogOpen(true)}><MapPin className="h-4 w-4 mr-1" /> Aplicar endereço</Button>
          <Button size="sm" variant="ghost" onClick={clearSel}>Limpar</Button>
        </div>
      )}

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

      {grouped.length > 1 && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={toggleAll}>
            {allCollapsed ? <><ChevronsUpDown className="h-4 w-4 mr-1" /> Expandir todos</> : <><ChevronsDownUp className="h-4 w-4 mr-1" /> Recolher todos</>}
          </Button>
        </div>
      )}

      {grouped.map((g) => (
        // Cada tecido é colapsável (CONTROLADO por `collapsed` p/ o expandir/recolher todos).
        // Checkbox à esquerda seleciona TODAS as variantes do tecido; o cabeçalho (nome) é o gatilho
        // de colapso. A impressão (RelatorioPrint) é independente e sempre lista tudo.
        <Card key={g.artigoId} className="p-4">
          <Collapsible open={!collapsed.has(g.artigoId)} onOpenChange={(o) => setGroupOpen(g.artigoId, o)}>
            <div className="flex items-center gap-2">
              {!readOnly && (
                <Checkbox
                  aria-label={`Selecionar todas as variantes de ${g.artigoNome}`}
                  checked={groupState(g)}
                  onCheckedChange={() => toggleGroup(g)}
                  className="data-[state=indeterminate]:bg-primary/60 data-[state=indeterminate]:text-primary-foreground"
                />
              )}
              <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left font-semibold [&[data-state=open]>svg]:rotate-90">
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
                <span className="min-w-0 truncate">{g.artigoNome}</span>
                <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                  {g.rows.length} {g.rows.length === 1 ? "variante" : "variantes"}
                </span>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="mt-3">
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
                      <SortTh label="Prev. Receb." sortKey="prevRecebM" sortState={sortState} className="py-2 pr-3" align="right" tip={COL_TIPS.prevReceb} />
                      <SortTh label="Recebido" sortKey="recebidoM" sortState={sortState} className="py-2 pr-3" align="right" tip={COL_TIPS.recebido} />
                      <SortTh label="Físico Real" sortKey="fisico" sortState={sortState} className="py-2 pr-3" align="right" tip={COL_TIPS.fisico} />
                      <SortTh label="Reservado" sortKey="reservado" sortState={sortState} className="py-2 pr-3" align="right" tip={COL_TIPS.reservado} />
                      <SortTh label="Previsto" sortKey="previsto" sortState={sortState} className="py-2 pr-3" align="right" tip={COL_TIPS.previsto} />
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r: any) => (
                      <VarianteRow key={r.varId} row={r} enderecos={rollup?.get(r.varId) ?? []}
                        selectable={!readOnly} selected={selected.has(r.varId)} onToggleSelect={() => toggleVar(r.varId)} />
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile: cards por variante (some o scroll horizontal) */}
              <div className="md:hidden space-y-2">
                {g.rows.map((r: any) => (
                  <VarianteCard key={r.varId} row={r} enderecos={rollup?.get(r.varId) ?? []}
                    selectable={!readOnly} selected={selected.has(r.varId)} onToggleSelect={() => toggleVar(r.varId)} />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
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

      {/* Gerenciador de endereços da seleção — monta ao abrir (edições são ao vivo). */}
      {!readOnly && dialogOpen && (
        <BulkEnderecoDialog
          varIds={selectedVisible}
          varInfo={varInfo}
          rollup={rollup}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}

/** Gerenciador de endereços das variantes SELECIONADAS — MESMA fonte do 📍 do estoque
 *  (rollup: manual + OC + rolo). Lista CADA endereço distinto e permite, por endereço:
 *  editar e excluir, roteando p/ o store certo (linha da tabela p/ manual/OC; colunas
 *  ocs_tecido.rolo_* p/ rolo); + acrescentar um novo endereço (manual) às selecionadas.
 *  Excluir um endereço o remove de TODAS as origens ali (por isso some do estoque). */
function BulkEnderecoDialog({ varIds, varInfo, rollup, onClose }: {
  varIds: string[];
  varInfo: Record<string, { tecido: string; variante: string }>;
  rollup: Map<string, EnderecoRollup[]> | undefined;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  // Resumo dos tecidos da seleção (nome + nº de variantes) — mostrado no topo do diálogo.
  const resumoTecidos = useMemo(() => {
    const m = new Map<string, number>();
    for (const id of varIds) { const t = varInfo[id]?.tecido ?? "—"; m.set(t, (m.get(t) ?? 0) + 1); }
    return Array.from(m.entries());
  }, [varIds, varInfo]);

  // Linhas de endereço das variantes selecionadas — derivadas do MESMO rollup do estoque
  // (mantém diálogo e 📍 sempre em sincronia). Cada linha traz origem + endereco_id/rolo_id.
  const rows = useMemo(() => varIds.flatMap((vid) => rollup?.get(vid) ?? []), [varIds, rollup]);

  // Agrupa por endereço (rua|prateleira): guarda os endereco_ids (manual/OC) + rolo_ids,
  // as origens não-manuais (p/ rótulo) e as variantes (p/ contagem/detalhe).
  const grupos = useMemo(() => {
    type G = { key: string; rua: string; prat: string; endIds: string[]; roloIds: string[]; origens: Set<string>; vars: Set<string> };
    const m = new Map<string, G>();
    for (const x of rows) {
      const rua = (x.rua ?? "").trim();
      const prat = (x.prateleira ?? "").trim();
      const key = `${rua}|${prat}`;
      const g = m.get(key) ?? { key, rua, prat, endIds: [], roloIds: [], origens: new Set<string>(), vars: new Set<string>() };
      if (x.endereco_id) g.endIds.push(x.endereco_id);
      if (x.rolo_id) g.roloIds.push(x.rolo_id);
      if (x.origem !== "manual" && x.origem_label) g.origens.add(x.origem_label);
      g.vars.add(x.variante_tecido_id);
      m.set(key, g);
    }
    return Array.from(m.values()).map((g) => ({
      key: g.key, rua: g.rua, prat: g.prat, endIds: g.endIds, roloIds: g.roloIds,
      origens: Array.from(g.origens), varIds: Array.from(g.vars), count: g.vars.size,
    }));
  }, [rows]);

  // "Tecido A: v1, v2 · Tecido B: v3" — a que tecido/variante um endereço pertence.
  const detalheTecidos = (vids: string[]) => {
    const byTecido = new Map<string, string[]>();
    for (const vid of vids) {
      const info = varInfo[vid];
      const t = info?.tecido ?? "—";
      const arr = byTecido.get(t) ?? [];
      arr.push(info?.variante ?? "?");
      byTecido.set(t, arr);
    }
    return Array.from(byTecido.entries()).map(([t, vs]) => `${t}: ${vs.join(", ")}`).join(" · ");
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["end-tecido-rollup"] });
    qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
    qc.invalidateQueries({ queryKey: ["end-tecido"] });
    qc.invalidateQueries({ queryKey: ["rolos"] });
  };

  // Grava rua/prateleira em TODAS as origens do grupo: linhas (manual/OC) por id +
  // colunas do rolo por id da OC-rolo. (Espelha o EnderecoConsolidadoEditor do Cadastro.)
  const updMut = useMutation({
    mutationFn: async (p: { endIds: string[]; roloIds: string[]; rua: string; prat: string }) => {
      const rua = p.rua.trim();
      const prat = p.prat.trim();
      if (p.endIds.length > 0) {
        const { error } = await supabase.from("enderecamento_tecido" as any).update({ rua, prateleira: prat }).in("id", p.endIds);
        if (error) throw error;
      }
      if (p.roloIds.length > 0) {
        const { error } = await supabase.from("ocs_tecido").update({ rolo_rua: rua || null, rolo_prateleira: prat || null } as any).in("id", p.roloIds);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao atualizar endereço.")),
  });

  // Edição inline por grupo (rascunho keyed pela chave do endereço original).
  const [draft, setDraft] = useState<Record<string, { rua: string; prat: string }>>({});
  const val = (g: { key: string; rua: string; prat: string }) => draft[g.key] ?? { rua: g.rua, prat: g.prat };
  const setVal = (key: string, patch: Partial<{ rua: string; prat: string }>) =>
    setDraft((d) => ({ ...d, [key]: { ...(d[key] ?? { rua: "", prat: "" }), ...patch } }));
  const commit = (g: { key: string; rua: string; prat: string; endIds: string[]; roloIds: string[] }) => {
    const v = val(g);
    if (v.rua !== g.rua || v.prat !== g.prat) updMut.mutate({ endIds: g.endIds, roloIds: g.roloIds, rua: v.rua, prat: v.prat });
  };

  // Excluir o endereço em TODAS as origens: apaga as linhas (manual/OC) e LIMPA as colunas
  // do rolo (não apaga o rolo). Assim o endereço some do estoque de fato.
  const delMut = useMutation({
    mutationFn: async (g: { endIds: string[]; roloIds: string[] }) => {
      if (g.endIds.length > 0) {
        const { error } = await supabase.from("enderecamento_tecido" as any).delete().in("id", g.endIds);
        if (error) throw error;
      }
      if (g.roloIds.length > 0) {
        const { error } = await supabase.from("ocs_tecido").update({ rolo_rua: null, rolo_prateleira: null } as any).in("id", g.roloIds);
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir endereço.")),
  });

  // Acrescentar um NOVO endereço (manual) a TODAS as variantes selecionadas (pula quem já tem o exato manual).
  const [novoRua, setNovoRua] = useState("");
  const [novoPrat, setNovoPrat] = useState("");
  const addMut = useMutation({
    mutationFn: async () => {
      const r = novoRua.trim();
      const p = novoPrat.trim();
      if (!r && !p) throw new Error("Informe a Rua e/ou a Prateleira.");
      const norm = (s: any) => (s ?? "").trim();
      // Já tem MANUAL exato? (só olha manual — não duplica linha manual; OC/rolo são outra origem)
      const jaTem = new Set(
        rows.filter((x) => x.origem === "manual" && norm(x.rua) === r && norm(x.prateleira) === p).map((x) => x.variante_tecido_id),
      );
      const payload = varIds
        .filter((id) => !jaTem.has(id))
        .map((id) => ({ variante_tecido_id: id, oc_tecido_item_id: null, rua: r, prateleira: p }));
      if (payload.length === 0) return { inserted: 0, skipped: varIds.length };
      const { error } = await supabase.from("enderecamento_tecido" as any).insert(payload);
      if (error) throw error;
      return { inserted: payload.length, skipped: varIds.length - payload.length };
    },
    onSuccess: (res) => {
      invalidate();
      setNovoRua("");
      setNovoPrat("");
      toast.success(
        res.skipped > 0
          ? `Endereço acrescentado a ${res.inserted} variante(s); ${res.skipped} já tinha(m).`
          : `Endereço acrescentado a ${res.inserted} variante(s).`,
      );
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao acrescentar endereço.")),
  });

  const novoVazio = !novoRua.trim() && !novoPrat.trim();
  const busy = updMut.isPending || delMut.isPending || addMut.isPending;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Endereços de {varIds.length} variante(s)
          </DialogTitle>
        </DialogHeader>
        {resumoTecidos.length > 0 && (
          <p className="-mt-1 text-xs text-muted-foreground">
            Seleção: {resumoTecidos.map(([t, c]) => `${t} (${c})`).join(" · ")}
          </p>
        )}
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          {/* Endereços atuais — cada endereço distinto presente na seleção, editável/excluível. */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Endereços atuais</Label>
            {grupos.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhum endereço ainda nas variantes selecionadas.</p>
            ) : (
              grupos.map((g) => {
                const v = val(g);
                return (
                  <div key={g.key} className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Input className="flex-1" placeholder="Rua" value={v.rua} onChange={(e) => setVal(g.key, { rua: e.target.value })} onBlur={() => commit(g)} />
                      <Input className="flex-1" placeholder="Prateleira" value={v.prat} onChange={(e) => setVal(g.key, { prat: e.target.value })} onBlur={() => commit(g)} />
                      <Badge variant="secondary" className="shrink-0" title={`${g.count} variante(s) com este endereço`}>{g.count}</Badge>
                      <Button size="iconSm" variant="ghost" onClick={() => delMut.mutate(g)} disabled={busy} aria-label="Excluir endereço">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    <p className="ml-0.5 text-[11px] text-muted-foreground">
                      {detalheTecidos(g.varIds)}
                      {g.origens.length > 0 && <span className="text-amber-600"> · origem: {g.origens.join(", ")}</span>}
                    </p>
                  </div>
                );
              })
            )}
          </div>

          {/* Acrescentar um novo endereço a TODAS as variantes selecionadas. */}
          <div className="space-y-2 border-t pt-3">
            <Label className="text-xs text-muted-foreground">Acrescentar endereço às {varIds.length} variante(s)</Label>
            <div className="flex items-center gap-2">
              <Input className="flex-1" placeholder="Rua" value={novoRua} onChange={(e) => setNovoRua(e.target.value)} />
              <Input className="flex-1" placeholder="Prateleira" value={novoPrat} onChange={(e) => setNovoPrat(e.target.value)} />
              <Button size="sm" onClick={() => addMut.mutate()} disabled={busy || novoVazio}>
                <Plus className="h-4 w-4 mr-1" /> Acrescentar
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Detalhe de estoque por OC de uma variante (compartilhado entre a linha desktop e o card
// mobile). A RPC traz recebidas (verde) e pendentes/encomendado (amarelo).
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
  const reservaSemOc =
    Number(reservadoTotal ?? 0) - detalhe.reduce((s: number, d: any) => s + Number(d.reservado_m ?? 0), 0);
  const ocRows = detalhe.map((d: any) => {
    const recebido = Number(d.recebido_m ?? 0);
    const baixa = Number(d.baixado_m ?? 0);
    const reservado = Number(d.reservado_m ?? 0);
    const prevReceb = Number(d.prev_receb_m ?? 0);
    const fisico = recebido - baixa;
    return {
      key: d.oc_tecido_item_id,
      status: d.recebida ? ("recebida" as const) : ("pendente" as const),
      oc: d.numero_pedido, fornecedor: d.fornecedor, entrega: d.data_entrega,
      prevReceb, recebido, baixa, fisico, reservado, previsto: fisico + prevReceb - reservado,
    };
  });
  return { ocRows, reservaSemOc, isLoading };
}

function VarianteRow({ row, enderecos, selectable, selected, onToggleSelect }: {
  row: any; enderecos: EnderecoRollup[]; selectable?: boolean; selected?: boolean; onToggleSelect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { ocRows, reservaSemOc, isLoading } = useEstoqueVarianteDetalhe(row.varId, open, row.reservado);
  const loadingPend = false;

  return (
    <>
      <tr className="border-b last:border-0 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <td className="py-2 pr-3" onClick={(e) => e.stopPropagation()}>
          {selectable && (
            <Checkbox checked={!!selected} onCheckedChange={() => onToggleSelect?.()} aria-label={`Selecionar ${row.nomeVariante}`} />
          )}
        </td>
        <td className="py-2 pr-3">
          <span className="mr-1 text-muted-foreground">{open ? "▾" : "▸"}</span>
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
                    <tr key={d.key} className={cn("border-b last:border-0", d.status === "recebida" ? "bg-[var(--tone-success-bg)]" : "bg-[var(--tone-warning-bg)]")}>
                      <td className="py-1 pr-3 whitespace-nowrap">
                        #{d.oc ?? "—"}
                        <span className={cn("ml-1 text-[9px] uppercase", d.status === "recebida" ? "text-[var(--tone-success-fg)]" : "text-[var(--tone-warning-fg)]")}>
                          {d.status}
                        </span>
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
function VarianteCard({ row, enderecos, selectable, selected, onToggleSelect }: {
  row: any; enderecos: EnderecoRollup[]; selectable?: boolean; selected?: boolean; onToggleSelect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { ocRows, reservaSemOc, isLoading } = useEstoqueVarianteDetalhe(row.varId, open, row.reservado);
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start gap-2">
        {selectable && (
          <Checkbox className="mt-1 shrink-0" checked={!!selected} onCheckedChange={() => onToggleSelect?.()} aria-label={`Selecionar ${row.nomeVariante}`} />
        )}
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen((o) => !o)}>
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
      </div>
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
            <div key={d.key} className={cn("rounded border p-2 text-xs", d.status === "recebida" ? "bg-[var(--tone-success-bg)]" : "bg-[var(--tone-warning-bg)]")}>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  #{d.oc ?? "—"}{" "}
                  <span className={cn("text-[9px] uppercase", d.status === "recebida" ? "text-[var(--tone-success-fg)]" : "text-[var(--tone-warning-fg)]")}>{d.status}</span>
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
