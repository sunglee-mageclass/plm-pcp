import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { brl } from "@/lib/format";
import { Target, ArrowLeft, Plus, Trash2, ChevronRight, Save } from "lucide-react";

/**
 * MAQUETE (só front) da coleção por PODER DE VENDA. Herda um "Padrão do mix" real
 * e monta a árvore Subcoleção ▸ Linha ▸ Categoria+Sub, com a quantidade nas colunas
 * Semana 1..N. Poder de venda sobe de baixo pra cima e mira a meta. Nada é salvo ainda.
 */

type Cat = { id: string; catId: string; subId: string; min: number; max: number; q: number[] };
type LinhaSub = { id: string; linhaId: string; profCor: number; cores: number; cats: Cat[] };
type Subcolecao = { id: string; nome: string; linhas: LinhaSub[] };

let _seq = 0;
const nid = (p: string) => `${p}-${++_seq}`;
const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")) || 0);
const int = (n: number) => Math.round(n).toLocaleString("pt-BR");
const pct1 = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const somaQ = (a: number[]) => a.reduce((s, n) => s + (Number(n) || 0), 0);

export const Route = createFileRoute("/_authenticated/otb-beta-colecao/")({
  validateSearch: (s: Record<string, unknown>) => ({ id: typeof s.id === "string" ? s.id : undefined }),
  component: ColecaoPVMaquete,
});

// jsonb {"1":n,...} → array por índice de semana; e o inverso.
const semanasToArr = (o: any, n: number) => Array.from({ length: n }, (_, i) => Number(o?.[String(i + 1)]) || 0);
const arrToSemanas = (a: number[]) => { const o: Record<string, number> = {}; a.forEach((v, i) => { if (v) o[String(i + 1)] = v; }); return o; };
const maxSemana = (itens: any[]) => Math.max(4, ...itens.map((it) => Math.max(0, ...Object.keys(it.qtd_semanas ?? {}).map(Number))));

function ColecaoPVMaquete() {
  const { data: padroes = [] } = useQuery({
    queryKey: ["mix-padroes"],
    queryFn: async () => {
      const { data } = await supabase.from("mix_padroes" as any)
        .select("id, nome, linhas:mix_padrao_linhas(linha_id, prof_cor, cores, ordem, categorias:mix_padrao_categorias(categoria_id, subcategoria1_id, preco_min, preco_max, ordem))")
        .order("nome");
      return (data ?? []) as any[];
    },
  });
  const { data: meses = [] } = useQuery({ queryKey: ["opt", "meses"], queryFn: async () => (await supabase.from("meses").select("id, mes").order("ordem")).data ?? [] });
  const { data: anos = [] } = useQuery({ queryKey: ["opt", "anos"], queryFn: async () => (await supabase.from("anos").select("id, ano").order("ano")).data ?? [] });
  const { data: linhaOpts = [] } = useQuery({ queryKey: ["padrao-linhas"], queryFn: async () => (await supabase.from("linhas").select("id, nome, markup").order("nome")).data ?? [] });
  const { data: catOpts = [] } = useQuery({ queryKey: ["padrao-cats"], queryFn: async () => (await supabase.from("categorias_produto").select("id, nome")).data ?? [] });
  const { data: subOpts = [] } = useQuery({ queryKey: ["padrao-subs"], queryFn: async () => (await supabase.from("subcategorias1_produto").select("id, nome, categoria_id")).data ?? [] });

  const markupDe = (id: string) => Number((linhaOpts as any[]).find((l) => l.id === id)?.markup) || 0;
  const subsDaCat = (catId: string) => (subOpts as any[]).filter((s) => s.categoria_id === catId);

  const [padraoId, setPadraoId] = useState("");
  const [nome, setNome] = useState("");
  const [mesId, setMesId] = useState("");
  const [anoId, setAnoId] = useState("");
  const [meta, setMeta] = useState(0);
  const [perda, setPerda] = useState(25);
  const [semanas, setSemanas] = useState(4);
  const [subs, setSubs] = useState<Subcolecao[]>([]);
  const [aberta, setAberta] = useState<Record<string, boolean>>({});

  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  const { data: loaded } = useQuery({
    queryKey: ["colecao-pv", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("colecoes" as any)
        .select("id, nome, mes_id, ano_id, mix_padrao_id, poder_venda_meta, perda_markup, subcolecoes:colecao_subcolecoes(id, nome, ordem), itens:colecao_pv_itens(id, subcolecao_id, linha_id, prof_cor, cores, categoria_id, subcategoria1_id, preco_min, preco_max, qtd_semanas, ordem)")
        .eq("id", id).single();
      if (error) throw error;
      return data as any;
    },
  });

  useEffect(() => {
    if (!id || !loaded || hydratedFor === id) return;
    const c = loaded;
    const nSem = maxSemana(c.itens ?? []);
    setNome(c.nome ?? ""); setMesId(c.mes_id ?? ""); setAnoId(c.ano_id ?? "");
    setPadraoId(c.mix_padrao_id ?? ""); setMeta(Number(c.poder_venda_meta) || 0);
    setPerda(Number(c.perda_markup) || 25); setSemanas(nSem);
    const bySub: Record<string, any[]> = {};
    for (const it of (c.itens ?? [])) (bySub[it.subcolecao_id] ??= []).push(it);
    const mapped: Subcolecao[] = [...(c.subcolecoes ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((sc: any) => {
      const its = [...(bySub[sc.id] ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
      const lm: Record<string, LinhaSub> = {}; const ordem: string[] = [];
      for (const it of its) {
        const k = `${it.linha_id ?? ""}|${it.prof_cor}|${it.cores}`;
        if (!lm[k]) { lm[k] = { id: nid("l"), linhaId: it.linha_id ?? "", profCor: Number(it.prof_cor) || 0, cores: Number(it.cores) || 0, cats: [] }; ordem.push(k); }
        lm[k].cats.push({ id: nid("c"), catId: it.categoria_id ?? "", subId: it.subcategoria1_id ?? "", min: Number(it.preco_min) || 0, max: Number(it.preco_max) || 0, q: semanasToArr(it.qtd_semanas, nSem) });
      }
      return { id: nid("s"), nome: sc.nome, linhas: ordem.map((k) => lm[k]) };
    });
    setSubs(mapped); setHydratedFor(id);
  }, [id, loaded, hydratedFor]);

  const salvar = useMutation({
    mutationFn: async () => {
      const _header = { nome, mes_id: mesId || null, ano_id: anoId || null, mix_padrao_id: padraoId || null, poder_venda_meta: meta || null, perda_markup: perda };
      const _subcolecoes = subs.map((s) => ({
        nome: s.nome,
        itens: s.linhas.flatMap((l) => l.cats.map((c) => ({
          linha_id: l.linhaId || null, prof_cor: l.profCor, cores: l.cores,
          categoria_id: c.catId || null, subcategoria1_id: c.subId || null,
          preco_min: c.min, preco_max: c.max, qtd_semanas: arrToSemanas(c.q),
        }))),
      }));
      const { data, error } = await supabase.rpc("salvar_colecao_pv" as any, { _id: id ?? null, _header, _subcolecoes });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (newId) => {
      toast.success("Coleção salva.");
      qc.invalidateQueries({ queryKey: ["colecao-pv"] });
      qc.invalidateQueries({ queryKey: ["otb-colecoes"] });
      if (!id) { setHydratedFor(newId); navigate({ to: "/otb-beta-colecao", search: { id: newId } }); }
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar a coleção.")),
  });

  const cloneDoPadrao = (): LinhaSub[] => {
    const p = (padroes as any[]).find((x) => x.id === padraoId);
    if (!p) return [];
    return [...(p.linhas ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((l: any) => ({
      id: nid("l"), linhaId: l.linha_id ?? "", profCor: Number(l.prof_cor) || 0, cores: Number(l.cores) || 0,
      cats: [...(l.categorias ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((c: any) => ({
        id: nid("c"), catId: c.categoria_id ?? "", subId: c.subcategoria1_id ?? "",
        min: Number(c.preco_min) || 0, max: Number(c.preco_max) || 0, q: Array(semanas).fill(0),
      })),
    }));
  };
  const addSub = () => { const id = nid("s"); setSubs((xs) => [...xs, { id, nome: `Subcoleção ${xs.length + 1}`, linhas: cloneDoPadrao() }]); setAberta((a) => ({ ...a, [id]: true })); };
  const delSub = (id: string) => setSubs((xs) => xs.filter((s) => s.id !== id));
  const patchSub = (id: string, p: Partial<Subcolecao>) => setSubs((xs) => xs.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const setQ = (sid: string, lid: string, cid: string, i: number, v: number) =>
    setSubs((xs) => xs.map((s) => s.id !== sid ? s : { ...s, linhas: s.linhas.map((l) => l.id !== lid ? l : { ...l, cats: l.cats.map((c) => {
      if (c.id !== cid) return c; const q = [...c.q]; while (q.length <= i) q.push(0); q[i] = v; return { ...c, q };
    }) }) }));
  // Edições EM CIMA do padrão (evita criar vários padrões p/ pequenas variações).
  const mapLinha = (sid: string, lid: string, fn: (l: LinhaSub) => LinhaSub) =>
    setSubs((xs) => xs.map((s) => s.id !== sid ? s : { ...s, linhas: s.linhas.map((l) => (l.id === lid ? fn(l) : l)) }));
  const patchLinha = (sid: string, lid: string, p: Partial<LinhaSub>) => mapLinha(sid, lid, (l) => ({ ...l, ...p }));
  const patchCat = (sid: string, lid: string, cid: string, p: Partial<Cat>) => mapLinha(sid, lid, (l) => ({ ...l, cats: l.cats.map((c) => (c.id === cid ? { ...c, ...p } : c)) }));
  const addCat = (sid: string, lid: string) => mapLinha(sid, lid, (l) => ({ ...l, cats: [...l.cats, { id: nid("c"), catId: "", subId: "", min: 0, max: 0, q: Array(semanas).fill(0) }] }));
  const delCat = (sid: string, lid: string, cid: string) => mapLinha(sid, lid, (l) => ({ ...l, cats: l.cats.filter((c) => c.id !== cid) }));
  const delLinha = (sid: string, lid: string) => setSubs((xs) => xs.map((s) => (s.id === sid ? { ...s, linhas: s.linhas.filter((l) => l.id !== lid) } : s)));
  const addLinha = (sid: string) => setSubs((xs) => xs.map((s) => (s.id === sid ? { ...s, linhas: [...s.linhas, { id: nid("l"), linhaId: "", profCor: 64, cores: 3, cats: [{ id: nid("c"), catId: "", subId: "", min: 0, max: 0, q: Array(semanas).fill(0) }] }] } : s)));

  const d = useMemo(() => {
    let poder = 0, custo = 0, modelos = 0;
    for (const s of subs) for (const l of s.linhas) {
      const mk = markupDe(l.linhaId); const prof = l.profCor * l.cores;
      for (const c of l.cats) {
        const tot = somaQ(c.q); const vm = (c.min + c.max) / 2;
        const pod = tot * prof * vm; poder += pod; modelos += tot;
        custo += mk > 0 ? pod / mk : 0;
      }
    }
    const desconto = (poder * perda) / 100;
    return { poder, custo, modelos, desconto, pvFinal: poder - desconto, atingido: meta > 0 ? (poder / meta) * 100 : 0 };
  }, [subs, perda, meta, linhaOpts]);

  const fieldCls = "h-9 rounded-md border border-input bg-background px-2 text-sm";
  const mesCols = Array.from({ length: semanas }, (_, i) => i);
  const temPadrao = !!padraoId && !!(padroes as any[]).find((p) => p.id === padraoId);

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-4 max-sm:pb-24">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Target className="h-7 w-7 text-primary shrink-0" />
          <h1 className="text-2xl font-bold">Coleção por Poder de Venda</h1>
          <Badge variant="secondary">beta</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => salvar.mutate()} disabled={!nome.trim() || salvar.isPending}><Save className="h-4 w-4 mr-1" /> Salvar</Button>
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground"><Link to="/otb-beta"><ArrowLeft className="h-4 w-4 mr-1" /> Padrão do mix</Link></Button>
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground"><Link to="/otb">OTB</Link></Button>
        </div>
      </header>

      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Escolha um <strong>Padrão do mix</strong> pra herdar a estrutura; ao adicionar uma subcoleção, ela já vem
        com as linhas e categorias do padrão (tudo editável). Lance a quantidade por semana e clique em <strong>Salvar</strong>.
      </div>

      {/* Cabeçalho da coleção */}
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="space-y-1 sm:col-span-2"><span className="text-xs font-medium text-muted-foreground">Nome</span>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Alto Verão 26" /></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Padrão do mix</span>
            <select className={`${fieldCls} w-full`} value={padraoId} onChange={(e) => { setPadraoId(e.target.value); setSubs([]); }}>
              <option value="">— escolher —</option>
              {(padroes as any[]).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Mês</span>
            <select className={`${fieldCls} w-full`} value={mesId} onChange={(e) => setMesId(e.target.value)}>
              <option value="">—</option>{(meses as any[]).map((m) => <option key={m.id} value={m.id}>{m.mes}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Ano</span>
            <select className={`${fieldCls} w-full`} value={anoId} onChange={(e) => setAnoId(e.target.value)}>
              <option value="">—</option>{(anos as any[]).map((a) => <option key={a.id} value={a.id}>{a.ano}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Semanas</span>
            <Input inputMode="numeric" value={semanas} onChange={(e) => setSemanas(Math.max(1, Math.min(5, Math.round(num(e.target.value)) || 1)))} /></label>
          <label className="space-y-1 sm:col-span-2"><span className="text-xs font-medium text-muted-foreground">Poder de venda meta</span>
            <Input inputMode="decimal" value={meta} onChange={(e) => setMeta(num(e.target.value))} /></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Perda markup</span>
            <div className="flex items-center gap-1"><Input inputMode="decimal" value={perda} onChange={(e) => setPerda(num(e.target.value))} /><span className="text-muted-foreground">%</span></div></label>
        </div>
        {meta > 0 && (
          <div className="mt-3 space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Poder de venda planejado</span>
              <span className="tabular-nums font-medium">{brl(d.poder)} <span className="text-muted-foreground">de {brl(meta)}</span></span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, d.atingido)}%` }} /></div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>{int(d.modelos)} modelos · custo {brl(d.custo)} · PV final {brl(d.pvFinal)}</span><span className="font-semibold text-primary">{pct1(d.atingido)} da meta</span></div>
          </div>
        )}
      </Card>

      {!temPadrao ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Escolha um Padrão do mix acima pra começar.</div>
      ) : (
        <div className="space-y-2">
          {subs.map((s) => {
            const open = aberta[s.id] ?? true;
            return (
              <Card key={s.id} className="overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2">
                  <button onClick={() => setAberta((a) => ({ ...a, [s.id]: !open }))}><ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} /></button>
                  <Input className="h-8 w-52 font-medium" value={s.nome} onChange={(e) => patchSub(s.id, { nome: e.target.value })} />
                  <Button variant="ghost" size="iconSm" className="ml-auto" onClick={() => delSub(s.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                </div>
                {open && (
                  <div className="border-t bg-muted/10 px-3 py-2 space-y-3">
                    {s.linhas.map((l) => {
                      const mk = markupDe(l.linhaId);
                      return (
                        <div key={l.id} className="rounded-md border bg-background p-2">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <select className={`${fieldCls} min-w-[9rem]`} value={l.linhaId} onChange={(e) => patchLinha(s.id, l.id, { linhaId: e.target.value })}>
                              <option value="">— linha —</option>
                              {(linhaOpts as any[]).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                            </select>
                            <span className="text-xs text-muted-foreground">markup <b className="text-foreground tabular-nums">{mk ? `${mk.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"}</b></span>
                            <Lbl t="prof/cor"><Input className="h-8 w-14 px-1 text-right tabular-nums" inputMode="numeric" value={l.profCor} onChange={(e) => patchLinha(s.id, l.id, { profCor: Math.max(0, Math.round(num(e.target.value))) })} /></Lbl>
                            <Lbl t="cores"><Input className="h-8 w-12 px-1 text-right tabular-nums" inputMode="numeric" value={l.cores} onChange={(e) => patchLinha(s.id, l.id, { cores: Math.max(0, Math.round(num(e.target.value))) })} /></Lbl>
                            <Button variant="ghost" size="iconSm" className="ml-auto" onClick={() => delLinha(s.id, l.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="text-xs text-muted-foreground">
                                <tr className="[&>th]:px-2 [&>th]:py-1 [&>th]:font-medium [&>th]:text-right [&>th:first-child]:text-left [&>th:nth-child(2)]:text-left">
                                  <th className="min-w-[8rem]">Categoria</th><th className="min-w-[8rem]">Sub</th><th>Mín</th><th>Máx</th>
                                  {mesCols.map((i) => <th key={i}>Sem {i + 1}</th>)}<th>Total</th><th>Poder</th><th />
                                </tr>
                              </thead>
                              <tbody>
                                {l.cats.map((c) => {
                                  const tot = somaQ(c.q); const vm = (c.min + c.max) / 2; const pod = tot * l.profCor * l.cores * vm;
                                  return (
                                    <tr key={c.id} className="border-t border-border/50 [&>td]:px-2 [&>td]:py-1 [&>td]:text-right [&>td:first-child]:text-left [&>td:nth-child(2)]:text-left">
                                      <td><select className={`${fieldCls} min-w-[8rem]`} value={c.catId} onChange={(e) => patchCat(s.id, l.id, c.id, { catId: e.target.value, subId: "" })}><option value="">— categoria —</option>{(catOpts as any[]).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}</select></td>
                                      <td><select className={`${fieldCls} min-w-[8rem]`} value={c.subId} disabled={!c.catId} onChange={(e) => patchCat(s.id, l.id, c.id, { subId: e.target.value })}><option value="">{c.catId ? "—" : "cat. antes"}</option>{subsDaCat(c.catId).map((o: any) => <option key={o.id} value={o.id}>{o.nome}</option>)}</select></td>
                                      <td><Input className="h-8 w-20 px-1 text-right tabular-nums" inputMode="decimal" value={c.min} onChange={(e) => patchCat(s.id, l.id, c.id, { min: num(e.target.value) })} /></td>
                                      <td><Input className="h-8 w-20 px-1 text-right tabular-nums" inputMode="decimal" value={c.max} onChange={(e) => patchCat(s.id, l.id, c.id, { max: num(e.target.value) })} /></td>
                                      {mesCols.map((i) => (
                                        <td key={i}><Input className="h-8 w-12 px-1 text-right tabular-nums" inputMode="numeric" value={c.q[i] ?? 0} onChange={(e) => setQ(s.id, l.id, c.id, i, Math.max(0, Math.round(num(e.target.value))))} /></td>
                                      ))}
                                      <td className="font-semibold tabular-nums">{int(tot)}</td>
                                      <td className="tabular-nums text-muted-foreground">{brl(pod)}</td>
                                      <td><Button variant="ghost" size="iconSm" onClick={() => delCat(s.id, l.id, c.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <Button variant="ghost" size="sm" className="mt-1" onClick={() => addCat(s.id, l.id)}><Plus className="h-4 w-4 mr-1" /> Categoria</Button>
                        </div>
                      );
                    })}
                    <Button variant="outline" size="sm" onClick={() => addLinha(s.id)}><Plus className="h-4 w-4 mr-1" /> Linha</Button>
                  </div>
                )}
              </Card>
            );
          })}
          <Button variant="outline" onClick={addSub}><Plus className="h-4 w-4 mr-1" /> Subcoleção</Button>
        </div>
      )}
    </div>
  );
}

function Lbl({ t, children }: { t: string; children: React.ReactNode }) {
  return <span className="flex items-center gap-1 text-xs text-muted-foreground">{t} {children}</span>;
}
