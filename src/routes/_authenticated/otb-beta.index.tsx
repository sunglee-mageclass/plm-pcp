import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { brl } from "@/lib/format";
import { Layers, ArrowLeft, Plus, Trash2, ChevronRight, Pencil } from "lucide-react";

/**
 * "Padrão do mix" (beta) — MAQUETE (só front, nada é salvo).
 * Template de defaults que uma coleção por PODER DE VENDA herda ao ser criada:
 *   • por LINHA (dropdown do cadastro → markup automático): % do mix, prof/cor, cores;
 *   • por CATEGORIA+SUB (dropdowns do cadastro): preço mín/máx (→ custo mín/máx pelo markup).
 * Dá pra ter VÁRIOS padrões (Verão, Inverno…) e escolher qual herdar ao criar a coleção.
 * Aqui NÃO tem mês/semana/qty/meta — isso é da coleção, não do padrão.
 */

type Sub = { id: string; catId: string; subId: string; min: number; max: number };
type LinhaMix = { id: string; linhaId: string; pct: number; profCor: number; cores: number; subs: Sub[] };
type Padrao = { id: string; nome: string; linhas: LinhaMix[] };

let _seq = 0;
const nid = (p: string) => `${p}-${++_seq}`;
const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")) || 0);
const int = (n: number) => Math.round(n).toLocaleString("pt-BR");
const pct1 = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const novaLinha = (): LinhaMix => ({ id: nid("l"), linhaId: "", pct: 0, profCor: 64, cores: 3, subs: [novaSub()] });
function novaSub(): Sub { return { id: nid("s"), catId: "", subId: "", min: 0, max: 0 }; }
const SEED: Padrao[] = [
  { id: "verao", nome: "Padrão Verão", linhas: [novaLinha(), novaLinha()] },
];

export const Route = createFileRoute("/_authenticated/otb-beta/")({ component: PadraoMixPage });

function PadraoMixPage() {
  // Dropdowns REAIS do cadastro.
  const { data: linhaOpts = [] } = useQuery({
    queryKey: ["padrao-linhas"],
    queryFn: async () => (await supabase.from("linhas").select("id, nome, markup").order("nome")).data ?? [],
  });
  const { data: catOpts = [] } = useQuery({
    queryKey: ["padrao-cats"],
    queryFn: async () => (await supabase.from("categorias_produto").select("id, nome").order("nome")).data ?? [],
  });
  const { data: subOpts = [] } = useQuery({
    queryKey: ["padrao-subs"],
    queryFn: async () => (await supabase.from("subcategorias1_produto").select("id, nome, categoria_id").order("nome")).data ?? [],
  });
  const markupDe = (linhaId: string) => Number((linhaOpts as any[]).find((l) => l.id === linhaId)?.markup) || 0;
  const subsDaCat = (catId: string) => (subOpts as any[]).filter((s) => s.categoria_id === catId);

  const [padroes, setPadroes] = useState<Padrao[]>(() => SEED.map((p) => ({ ...p, linhas: p.linhas.map((l) => ({ ...l, subs: l.subs.map((s) => ({ ...s })) })) })));
  const [selId, setSelId] = useState(SEED[0].id);
  const [editNomeId, setEditNomeId] = useState<string | null>(null);
  const [aberta, setAberta] = useState<Record<string, boolean>>({});

  const sel = padroes.find((p) => p.id === selId) ?? null;
  const setLinhas = (fn: (ls: LinhaMix[]) => LinhaMix[]) =>
    setPadroes((ps) => ps.map((p) => (p.id === selId ? { ...p, linhas: fn(p.linhas) } : p)));
  const patchLinha = (lid: string, patch: Partial<LinhaMix>) => setLinhas((ls) => ls.map((l) => (l.id === lid ? { ...l, ...patch } : l)));
  const patchSub = (lid: string, sid: string, patch: Partial<Sub>) =>
    setLinhas((ls) => ls.map((l) => (l.id === lid ? { ...l, subs: l.subs.map((s) => (s.id === sid ? { ...s, ...patch } : s)) } : l)));
  const addLinha = () => setLinhas((ls) => [...ls, novaLinha()]);
  const delLinha = (lid: string) => setLinhas((ls) => ls.filter((l) => l.id !== lid));
  const addSub = (lid: string) => setLinhas((ls) => ls.map((l) => (l.id === lid ? { ...l, subs: [...l.subs, novaSub()] } : l)));
  const delSub = (lid: string, sid: string) => setLinhas((ls) => ls.map((l) => (l.id === lid ? { ...l, subs: l.subs.filter((s) => s.id !== sid) } : l)));

  const addPadrao = () => { const id = nid("p"); setPadroes((ps) => [...ps, { id, nome: `Padrão ${ps.length + 1}`, linhas: [novaLinha()] }]); setSelId(id); setEditNomeId(id); };
  const delPadrao = (id: string) => setPadroes((ps) => { const r = ps.filter((p) => p.id !== id); if (id === selId) setSelId(r[0]?.id ?? ""); return r; });
  const renomear = (id: string, nome: string) => setPadroes((ps) => ps.map((p) => (p.id === id ? { ...p, nome } : p)));

  const somaPct = useMemo(() => (sel?.linhas ?? []).reduce((s, l) => s + (Number(l.pct) || 0), 0), [sel]);
  const fieldCls = "h-8 rounded-md border border-input bg-background px-2 text-sm";

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-4 max-sm:pb-24">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Layers className="h-7 w-7 text-primary shrink-0" />
          <h1 className="text-2xl font-bold">Padrão do mix</h1>
          <Badge variant="secondary">beta</Badge>
        </div>
        <Button variant="ghost" size="sm" asChild className="text-muted-foreground"><Link to="/otb"><ArrowLeft className="h-4 w-4 mr-1" /> OTB</Link></Button>
      </header>

      <p className="text-sm text-muted-foreground">
        Defaults que uma coleção por <strong>Poder de Venda</strong> já herda ao ser criada. Aqui você define,
        por linha, o % do mix, profundidade/cor e cores; e por categoria+subcategoria, a faixa de preço mín–máx.
      </p>

      {/* Seletor de padrões */}
      <div className="flex flex-wrap items-center gap-2">
        {padroes.map((p) => (
          <div key={p.id} className={`flex items-center gap-1 rounded-full border px-1 ${p.id === selId ? "border-primary bg-primary/5" : ""}`}>
            {editNomeId === p.id ? (
              <Input autoFocus value={p.nome} onChange={(e) => renomear(p.id, e.target.value)} onBlur={() => setEditNomeId(null)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditNomeId(null); }} className="h-7 w-32" />
            ) : (
              <button className="px-2 py-1 text-sm font-medium" onClick={() => setSelId(p.id)}>{p.nome}</button>
            )}
            {p.id === selId && (
              <>
                <Button variant="ghost" size="iconSm" className="h-6 w-6" onClick={() => setEditNomeId(p.id)}><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                {padroes.length > 1 && <Button variant="ghost" size="iconSm" className="h-6 w-6" onClick={() => delPadrao(p.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>}
              </>
            )}
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addPadrao}><Plus className="h-4 w-4 mr-1" /> Padrão</Button>
      </div>

      {linhaOpts.length === 0 && (
        <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Nenhuma linha cadastrada ainda — cadastre em <strong>Cadastro › Atributos › Linha</strong> pra aparecer aqui.
        </div>
      )}

      {/* Linhas do padrão selecionado */}
      {sel && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Mix de modelos por linha</span>
            <span className={`tabular-nums ${Math.abs(somaPct - 100) > 0.5 ? "text-amber-600" : "text-muted-foreground"}`}>Σ % = {pct1(somaPct)}</span>
          </div>

          {sel.linhas.map((l) => {
            const open = aberta[l.id] ?? true;
            const mk = markupDe(l.linhaId);
            return (
              <Card key={l.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <button onClick={() => setAberta((a) => ({ ...a, [l.id]: !open }))}>
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
                  </button>
                  <select className={`${fieldCls} min-w-[10rem]`} value={l.linhaId} onChange={(e) => patchLinha(l.id, { linhaId: e.target.value })}>
                    <option value="">— linha —</option>
                    {(linhaOpts as any[]).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                  </select>
                  <span className="text-xs text-muted-foreground">markup <b className="tabular-nums text-foreground">{mk ? `${mk.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"}</b></span>
                  <Lbl t="% mix"><Input className="h-8 w-16 px-1 text-right tabular-nums" inputMode="decimal" value={l.pct} onChange={(e) => patchLinha(l.id, { pct: num(e.target.value) })} /></Lbl>
                  <Lbl t="prof/cor"><Input className="h-8 w-14 px-1 text-right tabular-nums" inputMode="numeric" value={l.profCor} onChange={(e) => patchLinha(l.id, { profCor: Math.max(0, Math.round(num(e.target.value))) })} /></Lbl>
                  <Lbl t="cores"><Input className="h-8 w-12 px-1 text-right tabular-nums" inputMode="numeric" value={l.cores} onChange={(e) => patchLinha(l.id, { cores: Math.max(0, Math.round(num(e.target.value))) })} /></Lbl>
                  <Button variant="ghost" size="iconSm" className="ml-auto" onClick={() => delLinha(l.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                </div>

                {open && (
                  <div className="border-t bg-muted/10 px-3 py-2">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-xs text-muted-foreground">
                          <tr className="[&>th]:px-2 [&>th]:py-1 [&>th]:font-medium [&>th]:text-right [&>th:first-child]:text-left [&>th:nth-child(2)]:text-left">
                            <th className="min-w-[9rem]">Categoria</th><th className="min-w-[9rem]">Subcategoria</th>
                            <th>Preço mín</th><th>Preço máx</th>
                            <th className="text-muted-foreground/70">Custo mín</th><th className="text-muted-foreground/70">Custo máx</th><th />
                          </tr>
                        </thead>
                        <tbody>
                          {l.subs.map((s) => (
                            <tr key={s.id} className="border-t border-border/50 [&>td]:px-2 [&>td]:py-1 [&>td]:text-right [&>td:first-child]:text-left [&>td:nth-child(2)]:text-left">
                              <td>
                                <select className={`${fieldCls} min-w-[9rem]`} value={s.catId} onChange={(e) => patchSub(l.id, s.id, { catId: e.target.value, subId: "" })}>
                                  <option value="">— categoria —</option>
                                  {(catOpts as any[]).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                                </select>
                              </td>
                              <td>
                                <select className={`${fieldCls} min-w-[9rem]`} value={s.subId} disabled={!s.catId} onChange={(e) => patchSub(l.id, s.id, { subId: e.target.value })}>
                                  <option value="">{s.catId ? "— subcategoria —" : "escolha a categoria"}</option>
                                  {subsDaCat(s.catId).map((o: any) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                                </select>
                              </td>
                              <td><Input className="h-8 w-20 px-1 text-right tabular-nums" inputMode="decimal" value={s.min} onChange={(e) => patchSub(l.id, s.id, { min: num(e.target.value) })} /></td>
                              <td><Input className="h-8 w-20 px-1 text-right tabular-nums" inputMode="decimal" value={s.max} onChange={(e) => patchSub(l.id, s.id, { max: num(e.target.value) })} /></td>
                              <td className="tabular-nums text-muted-foreground/70">{mk ? brl(s.min / mk) : "—"}</td>
                              <td className="tabular-nums text-muted-foreground/70">{mk ? brl(s.max / mk) : "—"}</td>
                              <td><Button variant="ghost" size="iconSm" onClick={() => delSub(l.id, s.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Button variant="ghost" size="sm" className="mt-1" onClick={() => addSub(l.id)}><Plus className="h-4 w-4 mr-1" /> Categoria</Button>
                  </div>
                )}
              </Card>
            );
          })}
          <Button variant="outline" onClick={addLinha}><Plus className="h-4 w-4 mr-1" /> Linha</Button>
        </div>
      )}
    </div>
  );
}

function Lbl({ t, children }: { t: string; children: React.ReactNode }) {
  return <span className="flex items-center gap-1 text-xs text-muted-foreground">{t} {children}</span>;
}
