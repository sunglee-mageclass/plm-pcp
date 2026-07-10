import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { brl } from "@/lib/format";
import { Plus, Trash2, ChevronRight, Pencil, Save, ArrowLeft } from "lucide-react";

/**
 * "Padrão do mix" em MODAL (Sheet lateral). Template de defaults que a coleção por Poder
 * de Venda herda. Vários por loja. Por LINHA (dropdown do cadastro → markup automático):
 * % do mix, prof/cor, cores. Por CATEGORIA+SUB: preço mín/máx (→ custo). Persiste em
 * mix_padroes/mix_padrao_linhas/mix_padrao_categorias via salvar_mix_padrao.
 */

type Sub = { id: string; catId: string; subId: string; min: number; max: number };
type LinhaMix = { id: string; linhaId: string; pct: number; profCor: number; cores: number; subs: Sub[] };
type Draft = { nome: string; linhas: LinhaMix[] };

let _seq = 0;
const nid = (p: string) => `${p}-${++_seq}`;
const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")) || 0);
const pct1 = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const novaSub = (): Sub => ({ id: nid("s"), catId: "", subId: "", min: 0, max: 0 });
const novaLinha = (): LinhaMix => ({ id: nid("l"), linhaId: "", pct: 0, profCor: 64, cores: 3, subs: [novaSub()] });

function mapFromDb(p: any): Draft {
  const linhas = [...(p.linhas ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((l: any) => ({
    id: l.id, linhaId: l.linha_id ?? "", pct: Number(l.pct) || 0, profCor: Number(l.prof_cor) || 0, cores: Number(l.cores) || 0,
    subs: [...(l.categorias ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((c: any) => ({
      id: c.id, catId: c.categoria_id ?? "", subId: c.subcategoria1_id ?? "", min: Number(c.preco_min) || 0, max: Number(c.preco_max) || 0,
    })),
  }));
  return { nome: p.nome, linhas };
}

export function PadraoMixSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: linhaOpts = [] } = useQuery({ queryKey: ["padrao-linhas"], queryFn: async () => (await supabase.from("linhas").select("id, nome, markup").order("nome")).data ?? [] });
  const { data: catOpts = [] } = useQuery({ queryKey: ["padrao-cats"], queryFn: async () => (await supabase.from("categorias_produto").select("id, nome").order("nome")).data ?? [] });
  const { data: subOpts = [] } = useQuery({ queryKey: ["padrao-subs"], queryFn: async () => (await supabase.from("subcategorias1_produto").select("id, nome, categoria_id").order("nome")).data ?? [] });
  const { data: padroes = [] } = useQuery({
    queryKey: ["mix-padroes", "full"],
    queryFn: async () => {
      const { data, error } = await supabase.from("mix_padroes" as any)
        .select("id, nome, linhas:mix_padrao_linhas(id, linha_id, pct, prof_cor, cores, ordem, categorias:mix_padrao_categorias(id, categoria_id, subcategoria1_id, preco_min, preco_max, ordem))").order("nome");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const markupDe = (linhaId: string) => Number((linhaOpts as any[]).find((l) => l.id === linhaId)?.markup) || 0;
  const subsDaCat = (catId: string) => (subOpts as any[]).filter((s) => s.categoria_id === catId);

  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ nome: "", linhas: [] });
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [editNome, setEditNome] = useState(false);
  const [aberta, setAberta] = useState<Record<string, boolean>>({});

  useEffect(() => { if (!selId && padroes.length) setSelId(padroes[0].id); }, [padroes, selId]);
  useEffect(() => {
    if (selId && selId !== draftFor) {
      const p = padroes.find((x) => x.id === selId);
      if (p) { setDraft(mapFromDb(p)); setDraftFor(selId); setDirty(false); }
    }
  }, [selId, padroes, draftFor]);

  const upd = (fn: (d: Draft) => Draft) => { setDraft(fn); setDirty(true); };
  const setLinhas = (fn: (ls: LinhaMix[]) => LinhaMix[]) => upd((d) => ({ ...d, linhas: fn(d.linhas) }));
  const patchLinha = (lid: string, p: Partial<LinhaMix>) => setLinhas((ls) => ls.map((l) => (l.id === lid ? { ...l, ...p } : l)));
  const patchSub = (lid: string, sid: string, p: Partial<Sub>) => setLinhas((ls) => ls.map((l) => (l.id === lid ? { ...l, subs: l.subs.map((s) => (s.id === sid ? { ...s, ...p } : s)) } : l)));
  const addLinha = () => setLinhas((ls) => [...ls, novaLinha()]);
  const delLinha = (lid: string) => setLinhas((ls) => ls.filter((l) => l.id !== lid));
  const addSub = (lid: string) => setLinhas((ls) => ls.map((l) => (l.id === lid ? { ...l, subs: [...l.subs, novaSub()] } : l)));
  const delSub = (lid: string, sid: string) => setLinhas((ls) => ls.map((l) => (l.id === lid ? { ...l, subs: l.subs.filter((s) => s.id !== sid) } : l)));

  const salvar = useMutation({
    mutationFn: async () => {
      const payload = draft.linhas.map((l) => ({
        linha_id: l.linhaId || null, pct: l.pct, prof_cor: l.profCor, cores: l.cores,
        categorias: l.subs.map((s) => ({ categoria_id: s.catId || null, subcategoria1_id: s.subId || null, preco_min: s.min, preco_max: s.max })),
      }));
      const { data, error } = await supabase.rpc("salvar_mix_padrao" as any, { _id: selId, _nome: draft.nome.trim(), _linhas: payload });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => { toast.success("Padrão salvo."); setDirty(false); qc.invalidateQueries({ queryKey: ["mix-padroes"] }); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar o padrão.")),
  });
  const criar = useMutation({
    mutationFn: async () => { const { data, error } = await supabase.rpc("salvar_mix_padrao" as any, { _id: null, _nome: `Padrão ${padroes.length + 1}`, _linhas: [] }); if (error) throw error; return data as string; },
    onSuccess: (id) => { qc.invalidateQueries({ queryKey: ["mix-padroes"] }); setSelId(id); setDraftFor(null); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao criar o padrão.")),
  });
  const excluir = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc("excluir_mix_padrao" as any, { _id: id }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mix-padroes"] }); setSelId(null); setDraftFor(null); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir o padrão.")),
  });

  const somaPct = useMemo(() => draft.linhas.reduce((s, l) => s + (Number(l.pct) || 0), 0), [draft.linhas]);
  const fieldCls = "h-8 rounded-md border border-input bg-background px-2 text-sm";
  const temSel = !!selId && !!padroes.find((p) => p.id === selId);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[70vw] flex flex-col p-0 max-sm:[&>button]:hidden">
        <SheetHeader className="p-4 border-b shrink-0">
          <SheetTitle className="text-base sm:text-lg">Padrão do mix</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Defaults que uma coleção por <strong>Poder de Venda</strong> herda. Por linha: % do mix, profundidade/cor
            e cores (markup vem do cadastro). Por categoria+subcategoria: a faixa de preço mín–máx.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {padroes.map((p) => {
              const isSel = p.id === selId;
              return (
                <div key={p.id} className={`flex items-center gap-1 rounded-full border px-1 ${isSel ? "border-primary bg-primary/5" : ""}`}>
                  {isSel && editNome ? (
                    <Input autoFocus value={draft.nome} onChange={(e) => upd((d) => ({ ...d, nome: e.target.value }))}
                      onBlur={() => setEditNome(false)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditNome(false); }} className="h-7 w-36" />
                  ) : (
                    <button className="px-2 py-1 text-sm font-medium" onClick={() => setSelId(p.id)}>
                      {isSel ? draft.nome : p.nome}{isSel && dirty && <span className="ml-1 text-amber-600" title="não salvo">•</span>}
                    </button>
                  )}
                  {isSel && (
                    <>
                      <Button variant="ghost" size="iconSm" className="h-8 w-8" onClick={() => setEditNome(true)}><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                      <Button variant="ghost" size="iconSm" className="h-8 w-8" onClick={() => excluir.mutate(p.id)}><Trash2 className="h-3.5 w-3.5 text-muted-foreground" /></Button>
                    </>
                  )}
                </div>
              );
            })}
            <Button variant="outline" size="sm" onClick={() => criar.mutate()} disabled={criar.isPending}><Plus className="h-4 w-4 mr-1" /> Padrão</Button>
          </div>

          {linhaOpts.length === 0 && (
            <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Nenhuma linha cadastrada — cadastre em <strong>Cadastro › Atributos › Linha</strong> pra escolher aqui.
            </div>
          )}

          {!temSel ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nenhum padrão ainda. Clique em <strong>+ Padrão</strong> pra criar o primeiro.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Mix de modelos por linha</span>
                <span className={`tabular-nums ${Math.abs(somaPct - 100) > 0.5 ? "text-amber-600" : "text-muted-foreground"}`}>Σ % = {pct1(somaPct)}</span>
              </div>

              {draft.linhas.map((l) => {
                const open = aberta[l.id] ?? true;
                const mk = markupDe(l.linhaId);
                return (
                  <Card key={l.id} className="overflow-hidden">
                    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <button className="p-2 -m-2" onClick={() => setAberta((a) => ({ ...a, [l.id]: !open }))}>
                        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
                      </button>
                      <select className={`${fieldCls} min-w-[10rem]`} value={l.linhaId} onChange={(e) => patchLinha(l.id, { linhaId: e.target.value })}>
                        <option value="">— linha —</option>{(linhaOpts as any[]).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                      </select>
                      <span className="text-xs text-muted-foreground">markup <b className="tabular-nums text-foreground">{mk ? `${mk.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"}</b></span>
                      <Lbl t="% mix"><Input className="h-8 w-16 px-1 text-left tabular-nums" inputMode="decimal" value={l.pct} onChange={(e) => patchLinha(l.id, { pct: num(e.target.value) })} /></Lbl>
                      <Lbl t="prof/cor"><Input className="h-8 w-14 px-1 text-left tabular-nums" inputMode="numeric" value={l.profCor} onChange={(e) => patchLinha(l.id, { profCor: Math.max(0, Math.round(num(e.target.value))) })} /></Lbl>
                      <Lbl t="cores"><Input className="h-8 w-12 px-1 text-left tabular-nums" inputMode="numeric" value={l.cores} onChange={(e) => patchLinha(l.id, { cores: Math.max(0, Math.round(num(e.target.value))) })} /></Lbl>
                      <Button variant="ghost" size="iconSm" className="ml-auto max-sm:h-11 max-sm:w-11" onClick={() => delLinha(l.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                    </div>

                    {open && (
                      <div className="border-t bg-muted/10 px-3 py-2">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm card-table">
                            <thead className="text-xs text-muted-foreground">
                              <tr className="[&>th]:px-2 [&>th]:py-1 [&>th]:font-medium [&>th]:text-left">
                                <th className="min-w-[9rem]">Categoria</th><th className="min-w-[9rem]">Subcategoria</th>
                                <th>Preço mín</th><th>Preço máx</th>
                                <th className="text-muted-foreground/70">Custo mín</th><th className="text-muted-foreground/70">Custo máx</th><th />
                              </tr>
                            </thead>
                            <tbody>
                              {l.subs.map((s) => (
                                <tr key={s.id} className="border-t border-border/50 [&>td]:px-2 [&>td]:py-1 [&>td]:text-left">
                                  <td>
                                    <select className={`${fieldCls} min-w-[9rem] max-sm:w-full`} value={s.catId} onChange={(e) => patchSub(l.id, s.id, { catId: e.target.value, subId: "" })}>
                                      <option value="">— categoria —</option>{(catOpts as any[]).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                                    </select>
                                  </td>
                                  <td data-label="Subcategoria">
                                    <select className={`${fieldCls} min-w-[9rem] max-sm:w-full`} value={s.subId} disabled={!s.catId} onChange={(e) => patchSub(l.id, s.id, { subId: e.target.value })}>
                                      <option value="">{s.catId ? "— subcategoria —" : "escolha a categoria"}</option>{subsDaCat(s.catId).map((o: any) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                                    </select>
                                  </td>
                                  <td data-label="Preço mín"><Input className="h-8 w-20 max-sm:h-9 px-1 text-left tabular-nums" inputMode="decimal" value={s.min} onChange={(e) => patchSub(l.id, s.id, { min: num(e.target.value) })} /></td>
                                  <td data-label="Preço máx"><Input className="h-8 w-20 max-sm:h-9 px-1 text-left tabular-nums" inputMode="decimal" value={s.max} onChange={(e) => patchSub(l.id, s.id, { max: num(e.target.value) })} /></td>
                                  <td data-label="Custo mín" className="tabular-nums text-muted-foreground/70">{mk ? brl(s.min / mk) : "—"}</td>
                                  <td data-label="Custo máx" className="tabular-nums text-muted-foreground/70">{mk ? brl(s.max / mk) : "—"}</td>
                                  <td data-label=""><Button variant="ghost" size="iconSm" onClick={() => delSub(l.id, s.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></td>
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

        <div className="p-4 border-t shrink-0 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="mr-auto shrink-0 max-sm:aspect-square max-sm:px-0" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Voltar</span>
          </Button>
          <Button onClick={() => salvar.mutate()} disabled={!temSel || !dirty || salvar.isPending} className="shrink-0 max-sm:aspect-square max-sm:px-0" aria-label="Salvar">
            <Save className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">{dirty ? (salvar.isPending ? "Salvando…" : "Salvar") : "Salvo"}</span>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Lbl({ t, children }: { t: string; children: React.ReactNode }) {
  return <span className="flex items-center gap-1 text-xs text-muted-foreground">{t} {children}</span>;
}
