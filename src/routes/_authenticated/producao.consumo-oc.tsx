import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FilterButton } from "@/components/shared/filters";
import { Boxes, Search, Loader2, Palette, Scissors, ChevronRight } from "lucide-react";
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
  modelo_id: string; ref: string | null; nome: string | null;
  consumo_unit: number | null; mult: number | null;
  grade_variante: number | null; grade_geral: number | null;
  metragem_m: number | null; baixado_m: number | null; cortado: boolean;
};
type Item = {
  oc_tecido_item_id: string; estoque_zerado?: boolean; pode_zerar?: boolean; artigo_id: string | null; artigo_nome: string | null;
  unidade: string | null; variante: string | null;
  pedido_m: number | null; recebido_m: number | null; baixado_m: number | null;
  modelos: ModeloRaw[];
};
type OC = {
  oc_id: string; numero_pedido: string | null; status: string | null;
  data_entrega: string | null; fornecedor: string | null; itens: Item[];
  is_rolo?: boolean; rolo_codigo?: string | null;
  rolo_rua?: string | null; rolo_prateleira?: string | null;
};
type ModeloInfo = {
  id: string; fotos_modelo: string[] | null; proporcoes: Record<string, any> | null;
  colecao: string | null; mes_id: string | null; ano_id: string | null;
};

type VarRow = { variante: string; grade_variante: number; metragem_m: number; baixado_m: number; cortado: boolean };
type ModeloAgg = {
  modelo_id: string; ref: string | null; nome: string | null;
  consumo_unit: number; mult: number; grade_geral: number;
  variantes: VarRow[]; cortado: boolean; consumoTotal: number;
};
type Tecido = { artigo_id: string; artigo_nome: string; recebido: number; consumido: number; sobra: number; modelos: ModeloAgg[] };

const num = (v: any) => Number(v ?? 0) || 0;
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
const fmtDate = (s: string | null | undefined) => (s ? s.split("-").reverse().join("/") : "—");
const fmtProporcoes = (p: Record<string, any> | null | undefined) => {
  if (!p || typeof p !== "object") return "—";
  // Ordena pelo prefixo numérico do tamanho ("34|PPP" -> 34), como no resto do
  // projeto — Object.entries vinha na ordem de inserção (tamanhos fora de ordem).
  const ord = (k: string) => { const n = Number(k.split("|")[0]); return Number.isNaN(n) ? Infinity : n; };
  const parts = Object.entries(p)
    .filter(([, v]) => num(v) > 0)
    .sort(([a], [b]) => ord(a) - ord(b) || a.localeCompare(b))
    .map(([k, v]) => `${k.includes("|") ? k.split("|")[1] : k}:${num(v)}`);
  return parts.length ? parts.join("  ") : "—";
};
const recebidoItem = (oc: OC, it: Item) => (oc.status === "recebido" ? num(it.recebido_m) : num(it.pedido_m));

function agruparPorTecido(oc: OC, keep: (id: string) => boolean, anyFilter: boolean): Tecido[] {
  const byArtigo = new Map<string, Item[]>();
  for (const it of oc.itens) {
    const k = it.artigo_id ?? `sem-${it.oc_tecido_item_id}`;
    const arr = byArtigo.get(k) ?? [];
    arr.push(it); byArtigo.set(k, arr);
  }
  const out: Tecido[] = [];
  for (const [artigo_id, items] of byArtigo) {
    const recebido = items.reduce((s, it) => s + recebidoItem(oc, it), 0);
    const modelMap = new Map<string, ModeloAgg>();
    for (const it of items) {
      for (const m of it.modelos) {
        if (!keep(m.modelo_id)) continue;
        let agg = modelMap.get(m.modelo_id);
        if (!agg) {
          agg = { modelo_id: m.modelo_id, ref: m.ref, nome: m.nome, consumo_unit: num(m.consumo_unit), mult: num(m.mult) || 1, grade_geral: num(m.grade_geral), variantes: [], cortado: false, consumoTotal: 0 };
          modelMap.set(m.modelo_id, agg);
        }
        agg.variantes.push({ variante: it.variante ?? "—", grade_variante: num(m.grade_variante), metragem_m: num(m.metragem_m), baixado_m: num(m.baixado_m), cortado: !!m.cortado });
        if (m.cortado) agg.cortado = true;
        if (num(m.consumo_unit) > 0) agg.consumo_unit = num(m.consumo_unit);
        if (num(m.grade_geral) > 0) agg.grade_geral = num(m.grade_geral);
      }
    }
    const modelos = Array.from(modelMap.values());
    for (const a of modelos) {
      const metragens = a.variantes.reduce((s, v) => s + v.metragem_m, 0);
      const baixado = a.variantes.reduce((s, v) => s + v.baixado_m, 0);
      // Regra baixa × reserva: modelo CORTADO consome a baixa REAL; ainda não
      // cortado consome o planejado (BOM) + 1 peça piloto.
      a.consumoTotal = a.cortado ? baixado : metragens + a.consumo_unit * a.mult;
    }
    if (anyFilter && modelos.length === 0) continue; // com filtro ativo, esconde tecido sem modelos
    const consumido = modelos.reduce((s, a) => s + a.consumoTotal, 0);
    out.push({ artigo_id, artigo_nome: items[0]?.artigo_nome ?? "—", recebido, consumido, sobra: recebido - consumido, modelos });
  }
  return out;
}

function ConsumoOcPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [roloView, setRoloView] = useState(false); // false = OCs, true = Rolos
  const [devId, setDevId] = useState<string | null>(null);
  const [cadId, setCadId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fColecao, setFColecao] = useState("all");
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");
  // Filtro por categoria do tecido. Default: só "tecido" (forro deselecionado;
  // entretela já não entra — o RPC consumo_por_oc a exclui).
  const [cats, setCats] = useState<Set<string>>(() => new Set(["tecido"]));

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

  const artigoIds = useMemo(() => {
    const s = new Set<string>();
    for (const oc of ocs) for (const it of oc.itens) if (it.artigo_id) s.add(it.artigo_id);
    return Array.from(s).sort();
  }, [ocs]);

  // Categoria de cada artigo (tecido/forro/entretela), via categorias_tecido
  // (principal + vínculos artigo_categorias_tecido). Forro/Entretela são
  // categorias nomeadas; o resto é "tecido".
  const { data: artigoBucket = {} } = useQuery({
    queryKey: ["consumo-oc-artigo-cats", artigoIds],
    enabled: artigoIds.length > 0,
    queryFn: async () => {
      const [{ data: catsData }, { data: arts }, { data: links }] = await Promise.all([
        supabase.from("categorias_tecido").select("id, nome"),
        supabase.from("artigos").select("id, categoria_tecido_id").in("id", artigoIds),
        supabase.from("artigo_categorias_tecido").select("artigo_id, categoria_tecido_id").in("artigo_id", artigoIds),
      ]);
      const idByName = (n: string) => ((catsData ?? []) as any[]).find((c) => (c.nome ?? "").trim().toLowerCase() === n)?.id as string | undefined;
      const forroId = idByName("forro");
      const entreId = idByName("entretela");
      const linkMap = new Map<string, Set<string>>();
      for (const l of (links ?? []) as any[]) {
        const set = linkMap.get(l.artigo_id) ?? new Set<string>();
        set.add(l.categoria_tecido_id); linkMap.set(l.artigo_id, set);
      }
      const out: Record<string, "tecido" | "forro" | "entretela"> = {};
      for (const a of (arts ?? []) as any[]) {
        const set = linkMap.get(a.id) ?? new Set<string>();
        if (a.categoria_tecido_id) set.add(a.categoria_tecido_id);
        out[a.id] = entreId && set.has(entreId) ? "entretela" : forroId && set.has(forroId) ? "forro" : "tecido";
      }
      return out;
    },
  });
  const catOf = (artigoId: string | null | undefined) => (artigoId && (artigoBucket as any)[artigoId]) || "tecido";
  const catKeep = (artigoId: string | null | undefined) => cats.has(catOf(artigoId));

  const { data: modeloInfo = {} } = useQuery({
    queryKey: ["consumo-oc-modelos", modeloIds],
    enabled: modeloIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, fotos_modelo, proporcoes, colecao, mes_id, ano_id")
        .in("id", modeloIds);
      if (error) throw error;
      const map: Record<string, ModeloInfo> = {};
      for (const m of (data ?? []) as any[]) map[m.id] = m;
      return map;
    },
  });

  const { data: mesMap = {} } = useQuery({
    queryKey: ["meses-map"],
    queryFn: async () => {
      const { data } = await supabase.from("meses").select("id, mes");
      const m: Record<string, string> = {};
      for (const r of (data ?? []) as any[]) m[r.id] = r.mes;
      return m;
    },
    staleTime: 60 * 60 * 1000,
  });
  const { data: anoMap = {} } = useQuery({
    queryKey: ["anos-map"],
    queryFn: async () => {
      const { data } = await supabase.from("anos").select("id, ano");
      const m: Record<string, string> = {};
      for (const r of (data ?? []) as any[]) m[r.id] = String(r.ano);
      return m;
    },
    staleTime: 60 * 60 * 1000,
  });

  // Opções de filtro a partir dos modelos carregados.
  const { colecaoOpts, mesOpts, anoOpts } = useMemo(() => {
    const cols = new Set<string>(), meses = new Set<string>(), anos = new Set<string>();
    for (const m of Object.values(modeloInfo)) {
      if (m.colecao) cols.add(m.colecao);
      if (m.mes_id) meses.add(m.mes_id);
      if (m.ano_id) anos.add(m.ano_id);
    }
    return {
      colecaoOpts: [{ id: "all", nome: "Todas as coleções" }, ...[...cols].sort().map((c) => ({ id: c, nome: c }))],
      mesOpts: [{ id: "all", nome: "Todos os meses" }, ...[...meses].map((id) => ({ id, nome: mesMap[id] ?? id }))],
      anoOpts: [{ id: "all", nome: "Todos os anos" }, ...[...anos].map((id) => ({ id, nome: anoMap[id] ?? id }))],
    };
  }, [modeloInfo, mesMap, anoMap]);

  const anyFilter = fColecao !== "all" || fMes !== "all" || fAno !== "all";
  const keepModel = (id: string) => {
    if (!anyFilter) return true;
    const info = modeloInfo[id];
    if (!info) return false;
    if (fColecao !== "all" && info.colecao !== fColecao) return false;
    if (fMes !== "all" && info.mes_id !== fMes) return false;
    if (fAno !== "all" && info.ano_id !== fAno) return false;
    return true;
  };

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return ocs.filter((oc) => {
      // Separa OCs de Rolos por aba.
      if (!!oc.is_rolo !== roloView) return false;
      // OC sem itens (ex.: só tinha entretela, agora oculta) não aparece.
      if (!oc.itens || oc.itens.length === 0) return false;
      // Esconde a OC se nenhum item bate com a categoria de tecido selecionada.
      if (!oc.itens.some((it) => catKeep(it.artigo_id))) return false;
      if (s && !(
        (oc.numero_pedido ?? "").toLowerCase().includes(s) ||
        (oc.fornecedor ?? "").toLowerCase().includes(s) ||
        oc.itens.some((it) => (it.artigo_nome ?? "").toLowerCase().includes(s))
      )) return false;
      if (anyFilter && !oc.itens.some((it) => it.modelos.some((m) => keepModel(m.modelo_id)))) return false;
      return true;
    });
  }, [ocs, search, anyFilter, fColecao, fMes, fAno, modeloInfo, cats, artigoBucket, roloView]);

  const toggle = (id: string) => setExpanded((prev) => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  // Marca/desmarca "estoque zerado" de um item de OC (some a sobra/negativo dele
  // do estoque real). Atualização otimista no cache do consumo.
  const zerarMut = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase.from("ocs_tecido_itens").update({ estoque_zerado: value }).eq("id", id);
      if (error) throw error;
    },
    // Sem update otimista: refaz a busca do servidor (fonte da verdade) — garante
    // que ao desmarcar a metragem volta e o estoque atualiza.
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["consumo-por-oc"] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      qc.invalidateQueries({ queryKey: ["estoque-tecido-detalhe-oc"] });
      qc.invalidateQueries({ queryKey: ["dash-estoque"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao zerar estoque"),
  });
  // Zerar exige confirmação; desmarcar (voltar ao número) é direto.
  const [confirmZerarId, setConfirmZerarId] = useState<string | null>(null);
  const onToggleZerar = (id: string, zerado: boolean) => {
    if (zerado) zerarMut.mutate({ id, value: false });
    else setConfirmZerarId(id);
  };

  const closeEditors = () => {
    setDevId(null); setCadId(null);
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          <Button size="sm" variant={!roloView ? "secondary" : "ghost"} onClick={() => setRoloView(false)}>OCs</Button>
          <Button size="sm" variant={roloView ? "secondary" : "ghost"} onClick={() => setRoloView(true)}>Rolos</Button>
        </div>
        <div className="relative flex-1 min-w-[10rem] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar OC, fornecedor, tecido…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <FilterButton
          filters={[
            { label: "Coleção", value: fColecao, onChange: setFColecao, options: colecaoOpts },
            { label: "Mês", value: fMes, onChange: setFMes, options: mesOpts },
            { label: "Ano", value: fAno, onChange: setFAno, options: anoOpts },
          ]}
        />
        {/* Categoria do tecido (entretela não entra; forro deselecionado por padrão). */}
        <div className="flex items-center gap-1">
          {(["tecido", "forro"] as const).map((c) => (
            <Button
              key={c}
              type="button"
              size="sm"
              variant={cats.has(c) ? "default" : "outline"}
              onClick={() => setCats((prev) => { const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n; })}
            >
              {c === "tecido" ? "Tecido" : "Forro"}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">{roloView ? "Nenhum rolo encontrado." : "Nenhuma OC encontrada."}</div>
      ) : (
        <div className="space-y-4">
          {filtered.map((oc) => {
            const isOpen = expanded.has(oc.oc_id);
            return (
              <Card key={oc.oc_id}>
                <CardHeader className="pb-3 cursor-pointer" onClick={() => toggle(oc.oc_id)}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <CardTitle className="text-base flex items-center gap-2">
                      <ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                      {oc.is_rolo
                        ? `Rolo ${oc.rolo_codigo ?? oc.numero_pedido ?? "—"}`
                        : `OC ${oc.numero_pedido ?? "—"}`}
                      {oc.is_rolo && (oc.rolo_rua || oc.rolo_prateleira) && (
                        <span className="text-xs font-normal text-muted-foreground">
                          📍 {[oc.rolo_rua, oc.rolo_prateleira].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      <span className="text-sm font-normal text-muted-foreground">{oc.fornecedor ?? ""}</span>
                    </CardTitle>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>{fmtDate(oc.data_entrega)}</span>
                      {oc.status === "recebido"
                        ? <Badge className="bg-emerald-500 hover:bg-emerald-600">Recebida</Badge>
                        : <Badge variant="secondary">Encomendada</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className={isOpen ? "space-y-6" : "pt-0"}>
                  {isOpen ? (
                    agruparPorTecido(oc, keepModel, anyFilter).filter((t) => catKeep(t.artigo_id)).map((t) => {
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
                                <ModeloMiniCard key={a.modelo_id} a={a} info={modeloInfo[a.modelo_id]} onDev={() => setDevId(a.modelo_id)} onCad={() => setCadId(a.modelo_id)} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <ResumoVariantes oc={oc} keep={keepModel} onToggleZerar={onToggleZerar} />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!confirmZerarId} onOpenChange={(o) => !o && setConfirmZerarId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Zerar estoque deste item?</AlertDialogTitle>
            <AlertDialogDescription>
              Você tem certeza? Zerar este produto vai influenciar no estoque — a sobra (ou o negativo) deste item deixa de ser contabilizada no estoque real.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-emerald-500 hover:bg-emerald-600"
              onClick={() => { if (confirmZerarId) zerarMut.mutate({ id: confirmZerarId, value: true }); setConfirmZerarId(null); }}
            >
              Zerar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ModeloDetailPanel modeloId={devId} onClose={closeEditors} />

      <Sheet open={!!cadId} onOpenChange={(o) => !o && closeEditors()}>
        <SheetContent className="w-full sm:w-[92vw] sm:max-w-[1100px] overflow-y-auto p-0">
          {cadId && <CadEditor modeloId={cadId} onAfterDelete={closeEditors} onClose={closeEditors} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// Resumo enxuto (OC colapsada): uma linha por variante, com nº de modelos.
function ResumoVariantes({ oc, keep, onToggleZerar }: { oc: OC; keep: (id: string) => boolean; onToggleZerar: (id: string, zerado: boolean) => void }) {
  return (
    <div className="rounded-md border divide-y text-sm">
      {oc.itens.map((it) => {
        const modelos = it.modelos.filter((m) => keep(m.modelo_id));
        const recebido = recebidoItem(oc, it);
        // Regra baixa × reserva: cortado usa a baixa REAL; senão o planejado.
        const consumido = modelos.reduce((s, m) => s + (m.cortado ? num(m.baixado_m) : num(m.metragem_m)), 0);
        const zerado = !!it.estoque_zerado;
        const podeZerar = it.pode_zerar !== false; // default permissivo se o campo não vier
        const sobra = recebido - consumido;
        const sobraClass = sobra < 0 ? "text-destructive" : sobra <= recebido * 0.05 ? "text-emerald-600" : "text-foreground";
        return (
          <div key={it.oc_tecido_item_id} className="flex items-center justify-between gap-3 flex-wrap px-3 py-2">
            <div className="min-w-0">
              <span className="font-medium">{it.artigo_nome ?? "—"}</span>
              <span className="text-muted-foreground"> · {it.variante ?? "—"}</span>
            </div>
            <div className="flex items-center gap-3 tabular-nums">
              <Badge variant="secondary">{modelos.length} modelo{modelos.length === 1 ? "" : "s"}</Badge>
              <span className="text-muted-foreground">{oc.status === "recebido" ? "Receb." : "Ped."}: <strong className="text-foreground">{fmt(recebido)} m</strong></span>
              <span className="text-muted-foreground">Sobra: {zerado
                ? <strong className="text-emerald-600">zerado</strong>
                : <strong className={sobraClass}>{fmt(sobra)} m</strong>}</span>
              <Button
                type="button"
                size="sm"
                variant={zerado ? "default" : "outline"}
                className={"h-7 " + (zerado ? "bg-emerald-500 hover:bg-emerald-600" : "")}
                disabled={!zerado && !podeZerar}
                onClick={(e) => { e.stopPropagation(); onToggleZerar(it.oc_tecido_item_id, zerado); }}
                title={!zerado && !podeZerar
                  ? "Só é possível zerar quando todos os modelos desta variante estiverem enviados ao corte"
                  : "Zerar a sobra/negativo deste item no estoque real"}
              >
                {zerado ? "Zerado" : "Zerar"}
              </Button>
            </div>
          </div>
        );
      })}
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

function ModeloMiniCard({ a, info, onDev, onCad }: { a: ModeloAgg; info: ModeloInfo | undefined; onDev: () => void; onCad: () => void }) {
  const foto = info?.fotos_modelo?.[0] ?? null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="text-left rounded-lg border bg-card hover:border-primary hover:shadow-sm transition overflow-hidden flex flex-col">
          <div className="h-40 bg-muted flex items-center justify-center shrink-0">
            {foto ? <ModeloPhoto path={foto} alt={a.nome ?? "modelo"} fit="contain" /> : <div className="text-muted-foreground text-xs">sem foto</div>}
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
