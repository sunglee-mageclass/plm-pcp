import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Boxes, Search, Loader2, Palette, Scissors } from "lucide-react";
import { RequirePermission } from "@/components/RequirePermission";
import { ModeloPhoto } from "@/components/producao/cad/shared";
import { ModeloDetailPanel } from "@/components/desenvolvimento/ModeloDetailPanel";
import { CadEditor } from "@/routes/_authenticated/producao.cad.$modeloId";

export const Route = createFileRoute("/_authenticated/producao/consumo-oc")({
  component: () => (
    <RequirePermission page="producao_consumo_oc">
      <ConsumoOcPage />
    </RequirePermission>
  ),
});

type Modelo = {
  modelo_id: string;
  ref: string | null;
  nome: string | null;
  origem: "planejado" | "baixado";
  ordem: number | null;
  consumo_unit: number | null;
  mult: number | null;
  grade_variante: number | null;
  grade_geral: number | null;
  consumo_m: number | null;
};
type Item = {
  oc_tecido_item_id: string;
  artigo_nome: string | null;
  unidade: string | null;
  variante: string | null;
  pedido_m: number | null;
  recebido_m: number | null;
  baixado_m: number | null;
  modelos: Modelo[];
};
type OC = {
  oc_id: string;
  numero_pedido: string | null;
  status: string | null;
  data_entrega: string | null;
  fornecedor: string | null;
  itens: Item[];
};
type ModeloInfo = { id: string; fotos_modelo: string[] | null; proporcoes: Record<string, any> | null };

const num = (v: any) => Number(v ?? 0) || 0;
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
const fmtDate = (s: string | null | undefined) => (s ? s.split("-").reverse().join("/") : "—");
const fmtProporcoes = (p: Record<string, any> | null | undefined) => {
  if (!p || typeof p !== "object") return "—";
  const parts = Object.entries(p)
    .filter(([, v]) => num(v) > 0)
    .map(([k, v]) => `${k.includes("|") ? k.split("|")[1] : k}:${num(v)}`);
  return parts.length ? parts.join("  ") : "—";
};

function ConsumoOcPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [devId, setDevId] = useState<string | null>(null);
  const [cadId, setCadId] = useState<string | null>(null);

  const { data: ocs = [], isLoading } = useQuery({
    queryKey: ["consumo-por-oc"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("consumo_por_oc" as any);
      if (error) throw error;
      return ((data ?? []) as unknown) as OC[];
    },
  });

  // IDs de todos os modelos exibidos → busca foto + proporção em lote.
  const modeloIds = useMemo(() => {
    const s = new Set<string>();
    for (const oc of ocs) for (const it of oc.itens) for (const m of it.modelos) s.add(m.modelo_id);
    return Array.from(s).sort();
  }, [ocs]);

  const { data: modeloInfo = {} } = useQuery({
    queryKey: ["consumo-oc-modelos", modeloIds],
    enabled: modeloIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, fotos_modelo, proporcoes")
        .in("id", modeloIds);
      if (error) throw error;
      const map: Record<string, ModeloInfo> = {};
      for (const m of (data ?? []) as any[]) map[m.id] = m;
      return map;
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return ocs;
    return ocs.filter((oc) =>
      (oc.numero_pedido ?? "").toLowerCase().includes(s) ||
      (oc.fornecedor ?? "").toLowerCase().includes(s) ||
      oc.itens.some((it) => (it.artigo_nome ?? "").toLowerCase().includes(s)),
    );
  }, [ocs, search]);

  // Ao fechar um editor, recarrega a posição (grade/consumo podem ter mudado).
  const closeEditors = () => {
    setDevId(null);
    setCadId(null);
    qc.invalidateQueries({ queryKey: ["consumo-por-oc"] });
    qc.invalidateQueries({ queryKey: ["consumo-oc-modelos"] });
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-start gap-3">
        <Boxes className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Consumo por OC</h1>
          <p className="text-sm text-muted-foreground">
            Quanto cada modelo consome da OC e quanto sobra. Consumo = consumo × (grade + 1 piloto), sem perda. Clique num modelo para ajustar grade/proporção sem sair daqui.
          </p>
        </div>
      </header>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Buscar OC, fornecedor, tecido…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">Nenhuma OC encontrada.</div>
      ) : (
        <div className="space-y-4">
          {filtered.map((oc) => (
            <Card key={oc.oc_id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <CardTitle className="text-base">
                    OC {oc.numero_pedido ?? "—"}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">{oc.fornecedor ?? ""}</span>
                  </CardTitle>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{fmtDate(oc.data_entrega)}</span>
                    {oc.status === "recebido"
                      ? <Badge className="bg-emerald-500 hover:bg-emerald-600">Recebida</Badge>
                      : <Badge variant="secondary">Encomendada</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {oc.itens.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem itens.</p>
                ) : (
                  oc.itens.map((it) => {
                    const total = it.modelos.reduce((s, m) => s + num(m.consumo_m), 0);
                    const base = oc.status === "recebido" ? num(it.recebido_m) : num(it.pedido_m);
                    const sobra = base - total;
                    const sobraClass = sobra < 0 ? "text-destructive" : sobra <= base * 0.05 ? "text-emerald-600" : "text-foreground";
                    return (
                      <div key={it.oc_tecido_item_id} className="space-y-3">
                        <div className="flex items-center justify-between gap-3 flex-wrap border-b pb-2">
                          <div className="font-medium text-sm">
                            {it.artigo_nome ?? "—"} <span className="text-muted-foreground">· {it.variante ?? "—"}</span>
                          </div>
                          <div className="flex items-center gap-4 text-sm tabular-nums">
                            <span className="text-muted-foreground">{oc.status === "recebido" ? "Recebido" : "Pedido"}: <strong className="text-foreground">{fmt(base)} m</strong></span>
                            <span className="text-muted-foreground">Consumido: <strong className="text-foreground">{fmt(total)} m</strong></span>
                            <span className="text-muted-foreground">Sobra: <strong className={sobraClass}>{fmt(sobra)} m</strong></span>
                          </div>
                        </div>
                        {it.modelos.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Nenhum modelo consome desta OC ainda.</p>
                        ) : (
                          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                            {it.modelos.map((m, i) => (
                              <ModeloMiniCard
                                key={`${m.modelo_id}-${m.origem}-${i}`}
                                m={m}
                                info={modeloInfo[m.modelo_id]}
                                onDev={() => setDevId(m.modelo_id)}
                                onCad={() => setCadId(m.modelo_id)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Editor de Desenvolvimento (Sheet próprio do componente) */}
      <ModeloDetailPanel modeloId={devId} onClose={closeEditors} />

      {/* Editor de CAD num Sheet */}
      <Sheet open={!!cadId} onOpenChange={(o) => !o && closeEditors()}>
        <SheetContent className="w-full sm:w-[92vw] sm:max-w-[1100px] overflow-y-auto p-0">
          {cadId && <CadEditor modeloId={cadId} onAfterDelete={closeEditors} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 leading-tight">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-[11px] font-medium tabular-nums text-right">{value}</span>
    </div>
  );
}

function ModeloMiniCard({
  m, info, onDev, onCad,
}: {
  m: Modelo;
  info: ModeloInfo | undefined;
  onDev: () => void;
  onCad: () => void;
}) {
  const foto = info?.fotos_modelo?.[0] ?? null;
  const cu = num(m.consumo_unit);
  const mult = num(m.mult) || 1;
  const gv = num(m.grade_variante);
  const gg = num(m.grade_geral);
  const metragemVar = cu * mult * gv;
  const consumoTotal = cu * mult * (gg + 1); // total do tecido no modelo + 1 piloto
  const planejado = m.origem === "planejado";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-left rounded-lg border bg-card hover:border-primary hover:shadow-sm transition overflow-hidden"
        >
          <div className="aspect-[4/3] bg-muted">
            {foto ? <ModeloPhoto path={foto} alt={m.nome ?? "modelo"} /> : (
              <div className="h-full w-full flex items-center justify-center text-muted-foreground text-xs">sem foto</div>
            )}
          </div>
          <div className="p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-1">
              <div className="text-xs font-semibold truncate">{[m.ref, m.nome].filter(Boolean).join(" · ") || "—"}</div>
              {planejado
                ? <Badge variant="outline" className="shrink-0 text-[10px] px-1 py-0">Plan.</Badge>
                : <Badge variant="outline" className="shrink-0 text-[10px] px-1 py-0 border-emerald-500 text-emerald-600">Baixado</Badge>}
            </div>
            {planejado ? (
              <div className="space-y-0.5">
                <KV label="Proporção" value={fmtProporcoes(info?.proporcoes)} />
                <KV label="Grade variante" value={fmt(gv)} />
                <KV label="Consumo" value={`${fmt(cu)} m`} />
                <KV label="Metragem variante" value={`${fmt(metragemVar)} m`} />
                <KV label="Grade geral" value={fmt(gg)} />
                <KV label="Consumo total (+piloto)" value={`${fmt(consumoTotal)} m`} />
              </div>
            ) : (
              <div className="space-y-0.5">
                <KV label="Baixado" value={`${fmt(num(m.consumo_m))} m`} />
                <KV label="Grade geral" value={fmt(gg)} />
              </div>
            )}
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start">
        <Button variant="ghost" className="w-full justify-start" size="sm" onClick={onDev}>
          <Palette className="h-4 w-4 mr-2" /> Abrir Desenvolvimento
        </Button>
        <Button variant="ghost" className="w-full justify-start" size="sm" onClick={onCad}>
          <Scissors className="h-4 w-4 mr-2" /> Abrir CAD
        </Button>
      </PopoverContent>
    </Popover>
  );
}
