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

type ModeloRaw = {
  modelo_id: string;
  ref: string | null;
  nome: string | null;
  consumo_unit: number | null;
  mult: number | null;
  grade_variante: number | null;
  grade_geral: number | null;
  metragem_m: number | null;
  baixado_m: number | null;
  cortado: boolean;
};
type Item = {
  oc_tecido_item_id: string;
  artigo_id: string | null;
  artigo_nome: string | null;
  unidade: string | null;
  variante: string | null;
  pedido_m: number | null;
  recebido_m: number | null;
  baixado_m: number | null;
  modelos: ModeloRaw[];
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

// Agregados client-side
type VarRow = { variante: string; grade_variante: number; metragem_m: number; baixado_m: number; cortado: boolean };
type ModeloAgg = {
  modelo_id: string; ref: string | null; nome: string | null;
  consumo_unit: number; mult: number; grade_geral: number;
  variantes: VarRow[]; cortado: boolean; consumoTotal: number;
};
type Tecido = {
  artigo_id: string; artigo_nome: string; recebido: number; consumido: number; sobra: number;
  modelos: ModeloAgg[];
};

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

// OC → grupos por tecido (artigo), com um modelo por card e suas variantes juntas.
function agruparPorTecido(oc: OC): Tecido[] {
  const byArtigo = new Map<string, Item[]>();
  for (const it of oc.itens) {
    const k = it.artigo_id ?? `sem-${it.oc_tecido_item_id}`;
    (byArtigo.get(k) ?? byArtigo.set(k, []).get(k)!).push(it);
  }
  const out: Tecido[] = [];
  for (const [artigo_id, items] of byArtigo) {
    const recebido = items.reduce((s, it) => s + (oc.status === "recebido" ? num(it.recebido_m) : num(it.pedido_m)), 0);
    const modelMap = new Map<string, ModeloAgg>();
    for (const it of items) {
      for (const m of it.modelos) {
        let agg = modelMap.get(m.modelo_id);
        if (!agg) {
          agg = {
            modelo_id: m.modelo_id, ref: m.ref, nome: m.nome,
            consumo_unit: num(m.consumo_unit), mult: num(m.mult) || 1, grade_geral: num(m.grade_geral),
            variantes: [], cortado: false, consumoTotal: 0,
          };
          modelMap.set(m.modelo_id, agg);
        }
        agg.variantes.push({
          variante: it.variante ?? "—",
          grade_variante: num(m.grade_variante),
          metragem_m: num(m.metragem_m),
          baixado_m: num(m.baixado_m),
          cortado: !!m.cortado,
        });
        if (m.cortado) agg.cortado = true;
        if (num(m.consumo_unit) > 0) agg.consumo_unit = num(m.consumo_unit);
        if (num(m.grade_geral) > 0) agg.grade_geral = num(m.grade_geral);
      }
    }
    const modelos = Array.from(modelMap.values());
    // Consumo total do modelo = Σ metragem das variantes + 1 peça piloto (consumo × mult), uma vez.
    for (const a of modelos) {
      const metragens = a.variantes.reduce((s, v) => s + v.metragem_m, 0);
      a.consumoTotal = metragens + a.consumo_unit * a.mult;
    }
    const consumido = modelos.reduce((s, a) => s + a.consumoTotal, 0);
    out.push({
      artigo_id,
      artigo_nome: items[0]?.artigo_nome ?? "—",
      recebido,
      consumido,
      sobra: recebido - consumido,
      modelos,
    });
  }
  return out;
}

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
            Por tecido da OC: quanto cada modelo consome e quanto sobra. Consumo = Σ(consumo × grade por variante) + 1 piloto, sem perda. Clique num modelo para ajustar grade/proporção sem sair daqui.
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
              <CardContent className="space-y-6">
                {agruparPorTecido(oc).map((t) => {
                  const sobraClass = t.sobra < 0 ? "text-destructive" : t.sobra <= t.recebido * 0.05 ? "text-emerald-600" : "text-foreground";
                  return (
                    <div key={t.artigo_id} className="space-y-3">
                      <div className="flex items-center justify-between gap-3 flex-wrap border-b pb-2">
                        <div className="font-medium text-sm">{t.artigo_nome}</div>
                        <div className="flex items-center gap-4 text-sm tabular-nums">
                          <span className="text-muted-foreground">{oc.status === "recebido" ? "Recebido" : "Pedido"}: <strong className="text-foreground">{fmt(t.recebido)} m</strong></span>
                          <span className="text-muted-foreground">Consumido: <strong className="text-foreground">{fmt(t.consumido)} m</strong></span>
                          <span className="text-muted-foreground">Sobra: <strong className={sobraClass}>{fmt(t.sobra)} m</strong></span>
                        </div>
                      </div>
                      {t.modelos.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum modelo consome deste tecido ainda.</p>
                      ) : (
                        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {t.modelos.map((a) => (
                            <ModeloMiniCard
                              key={a.modelo_id}
                              a={a}
                              info={modeloInfo[a.modelo_id]}
                              onDev={() => setDevId(a.modelo_id)}
                              onCad={() => setCadId(a.modelo_id)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ModeloDetailPanel modeloId={devId} onClose={closeEditors} />

      <Sheet open={!!cadId} onOpenChange={(o) => !o && closeEditors()}>
        <SheetContent className="w-full sm:w-[92vw] sm:max-w-[1100px] overflow-y-auto p-0">
          {cadId && <CadEditor modeloId={cadId} onAfterDelete={closeEditors} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function KV({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 leading-tight">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-[11px] font-medium tabular-nums text-right ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

function ModeloMiniCard({
  a, info, onDev, onCad,
}: {
  a: ModeloAgg;
  info: ModeloInfo | undefined;
  onDev: () => void;
  onCad: () => void;
}) {
  const foto = info?.fotos_modelo?.[0] ?? null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-left rounded-lg border bg-card hover:border-primary hover:shadow-sm transition overflow-hidden flex flex-col"
        >
          <div className="h-40 bg-muted flex items-center justify-center shrink-0">
            {foto ? <ModeloPhoto path={foto} alt={a.nome ?? "modelo"} fit="contain" /> : (
              <div className="text-muted-foreground text-xs">sem foto</div>
            )}
          </div>
          <div className="p-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-1">
              <div className="text-xs font-semibold truncate">{[a.ref, a.nome].filter(Boolean).join(" · ") || "—"}</div>
              {a.cortado && <Badge variant="outline" className="shrink-0 text-[10px] px-1 py-0 border-emerald-500 text-emerald-600">Baixado</Badge>}
            </div>
            <KV label="Proporção" value={fmtProporcoes(info?.proporcoes)} />
            <KV label="Consumo" value={`${fmt(a.consumo_unit)} m`} />

            <div className="pt-1 mt-1 border-t space-y-1">
              {a.variantes.map((v, i) => (
                <div key={i} className="space-y-0.5">
                  <div className="text-[11px] font-medium truncate">{v.variante}</div>
                  <KV label="Grade" value={fmt(v.grade_variante)} />
                  <KV label="Metragem" value={`${fmt(v.metragem_m)} m`} />
                  {v.cortado && <KV label="Baixado" value={`${fmt(v.baixado_m)} m`} valueClass="text-emerald-600" />}
                </div>
              ))}
            </div>

            <div className="pt-1 mt-1 border-t space-y-1">
              <KV label="Grade geral" value={fmt(a.grade_geral)} />
              <KV label="Consumo total (+piloto)" value={`${fmt(a.consumoTotal)} m`} />
            </div>
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
