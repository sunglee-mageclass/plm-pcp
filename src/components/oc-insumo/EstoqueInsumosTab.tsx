import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Boxes, ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { RelatorioPrint } from "@/components/shared/RelatorioPrint";
import { fmtNum } from "@/lib/format";

// Posição de estoque de INSUMOS — 3ª aba "Estoque" do OC Insumo. Fonte ÚNICA: RPC
// `estoque_etiqueta`. Preservar a queryKey ["estoque-insumos"]. Os CONTROLES (busca,
// imprimir, filtro) vivem no HEADER da OC (via o hook abaixo); aqui fica só a tabela.

const num = (v: any) => Number(v ?? 0) || 0;
const fmt = (v: number) => fmtNum(v);
const fmtTamInsumo = (t: string) => { const [n, s] = t.split("|"); return s ? `${s} · ${n}` : t; };

/** Estado + consulta + filtros da aba Estoque de insumos. `enabled` = aba ativa. */
export function useEstoqueInsumos(enabled: boolean) {
  const [search, setSearch] = useState("");
  const [estoqueFilter, setEstoqueFilter] = useState("all");
  const { data = [], isLoading } = useQuery({
    queryKey: ["estoque-insumos"],
    enabled,
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

  const filtros = [
    { label: "Estoque", value: estoqueFilter, onChange: setEstoqueFilter, options: [{ id: "all", nome: "Todos" }, { id: "zero", nome: "Estoque Zerado" }, { id: "positive", nome: "Estoque > 0" }] },
  ];

  return { search, setSearch, filtros, grouped, isLoading };
}

/** Tabela agrupada (insumo → cor → tamanho) + área de impressão. Recebe o estado do hook. */
export function EstoqueInsumosTable({ state }: { state: ReturnType<typeof useEstoqueInsumos> }) {
  const { grouped, isLoading } = state;
  // Expandir/recolher todos os insumos. `collapsed` = ids recolhidos (vazio = todos abertos); insumo
  // novo pós-filtro nasce aberto. Cada card vira um Collapsible CONTROLADO.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const setGroupOpen = (id: string, open: boolean) =>
    setCollapsed((prev) => { const n = new Set(prev); if (open) n.delete(id); else n.add(id); return n; });
  const allCollapsed = grouped.length > 0 && grouped.every((g) => collapsed.has(g.id));
  const toggleAll = () => setCollapsed(allCollapsed ? new Set() : new Set(grouped.map((g) => g.id)));
  return (
    <div className="space-y-4">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : grouped.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          <Boxes className="h-8 w-8 mx-auto mb-2 opacity-50" />
          Sem insumos em estoque. Compras (OC Insumo) e consumos (CAD) aparecem aqui.
        </div>
      ) : (
        <>
        {grouped.length > 1 && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={toggleAll}>
              {allCollapsed ? <><ChevronsUpDown className="h-4 w-4 mr-1" /> Expandir todos</> : <><ChevronsDownUp className="h-4 w-4 mr-1" /> Recolher todos</>}
            </Button>
          </div>
        )}
        {grouped.map((g) => (
          <Card key={g.id} className="p-4">
            <Collapsible open={!collapsed.has(g.id)} onOpenChange={(o) => setGroupOpen(g.id, o)}>
              <CollapsibleTrigger className="flex w-full items-center gap-2 text-left font-semibold [&[data-state=open]>svg]:rotate-90">
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" />
                <span className="min-w-0 truncate">{g.nome}</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
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
              </CollapsibleContent>
            </Collapsible>
          </Card>
        ))}
        </>
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
