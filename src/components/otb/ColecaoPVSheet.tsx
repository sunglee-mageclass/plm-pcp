import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DateField } from "@/components/shared/DateField";
import { brl } from "@/lib/format";
import { Plus, Trash2, ChevronRight, Save, Check, ArrowLeft } from "lucide-react";

/**
 * Editor da coleção por PODER DE VENDA, em MODAL (Sheet lateral, como o de Orçamento).
 * Herda um "Padrão do mix"; árvore Subcoleção ▸ Linha ▸ Categoria+Sub. Cada subcoleção
 * escolhe as semanas 1–5 + data de lançamento (vai pro card). Qtd por semana; total = nº
 * de cards. Confirmar gera os cards no Planejamento (preço em branco).
 */

const SEMANAS = [1, 2, 3, 4, 5];
type Cat = { id: string; catId: string; subId: string; min: number; max: number; q: Record<string, number> };
type LinhaSub = { id: string; linhaId: string; profCor: number; cores: number; cats: Cat[] };
type Subcolecao = { id: string; nome: string; semanas: number[]; dataLanc: string; linhas: LinhaSub[] };

let _seq = 0;
const nid = (p: string) => `${p}-${++_seq}`;
const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")) || 0);
const int = (n: number) => Math.round(n).toLocaleString("pt-BR");
const pct1 = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const totCat = (c: Cat, semanas: number[]) => semanas.reduce((s, w) => s + (Number(c.q[String(w)]) || 0), 0);

export function ColecaoPVSheet({ colecaoId, onClose, onSaved }: { colecaoId: string | null; onClose: () => void; onSaved?: () => void }) {
  const qc = useQueryClient();
  const { data: padroes = [] } = useQuery({
    queryKey: ["mix-padroes", "opts"],
    queryFn: async () => (await supabase.from("mix_padroes" as any)
      .select("id, nome, linhas:mix_padrao_linhas(linha_id, pct, prof_cor, cores, ordem, categorias:mix_padrao_categorias(categoria_id, subcategoria1_id, preco_min, preco_max, ordem))").order("nome")).data ?? [] as any[],
  });
  const { data: meses = [] } = useQuery({ queryKey: ["opt", "meses"], queryFn: async () => (await supabase.from("meses").select("id, mes").order("ordem")).data ?? [] });
  const { data: anos = [] } = useQuery({ queryKey: ["opt", "anos"], queryFn: async () => (await supabase.from("anos").select("id, ano").order("ano")).data ?? [] });
  const { data: linhaOpts = [] } = useQuery({ queryKey: ["padrao-linhas"], queryFn: async () => (await supabase.from("linhas").select("id, nome, markup").order("nome")).data ?? [] });
  const { data: catOpts = [] } = useQuery({ queryKey: ["padrao-cats"], queryFn: async () => (await supabase.from("categorias_produto").select("id, nome")).data ?? [] });
  const { data: subOpts = [] } = useQuery({ queryKey: ["padrao-subs"], queryFn: async () => (await supabase.from("subcategorias1_produto").select("id, nome, categoria_id")).data ?? [] });

  const markupDe = (id: string) => Number((linhaOpts as any[]).find((l) => l.id === id)?.markup) || 0;
  const nomeLinha = (id: string) => (linhaOpts as any[]).find((l) => l.id === id)?.nome ?? "—";
  const subsDaCat = (catId: string) => (subOpts as any[]).filter((s) => s.categoria_id === catId);

  const [savedId, setSavedId] = useState<string | null>(colecaoId);
  const [confirmada, setConfirmada] = useState(false);
  const [padraoId, setPadraoId] = useState("");
  const [nome, setNome] = useState("");
  const [mesId, setMesId] = useState("");
  const [anoId, setAnoId] = useState("");
  const [meta, setMeta] = useState(0);
  const [perda, setPerda] = useState(25);
  const [subs, setSubs] = useState<Subcolecao[]>([]);
  const [aberta, setAberta] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  const { data: loaded } = useQuery({
    queryKey: ["colecao-pv", colecaoId],
    enabled: !!colecaoId,
    queryFn: async () => {
      const { data, error } = await supabase.from("colecoes" as any)
        .select("id, nome, mes_id, ano_id, status, mix_padrao_id, poder_venda_meta, perda_markup, subcolecoes:colecao_subcolecoes(id, nome, ordem, semanas, data_lancamento), itens:colecao_pv_itens(id, subcolecao_id, linha_id, prof_cor, cores, categoria_id, subcategoria1_id, preco_min, preco_max, qtd_semanas, ordem)")
        .eq("id", colecaoId).single();
      if (error) throw error;
      return data as any;
    },
  });

  useEffect(() => {
    if (!colecaoId || !loaded || hydrated) return;
    const c = loaded;
    setNome(c.nome ?? ""); setMesId(c.mes_id ?? ""); setAnoId(c.ano_id ?? "");
    setPadraoId(c.mix_padrao_id ?? ""); setMeta(Number(c.poder_venda_meta) || 0); setPerda(Number(c.perda_markup) || 25);
    setConfirmada(c.status === "confirmada");
    const bySub: Record<string, any[]> = {};
    for (const it of (c.itens ?? [])) (bySub[it.subcolecao_id] ??= []).push(it);
    const mapped: Subcolecao[] = [...(c.subcolecoes ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((sc: any) => {
      const its = [...(bySub[sc.id] ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
      const lm: Record<string, LinhaSub> = {}; const ordem: string[] = [];
      for (const it of its) {
        const k = `${it.linha_id ?? ""}|${it.prof_cor}|${it.cores}`;
        if (!lm[k]) { lm[k] = { id: nid("l"), linhaId: it.linha_id ?? "", profCor: Number(it.prof_cor) || 0, cores: Number(it.cores) || 0, cats: [] }; ordem.push(k); }
        lm[k].cats.push({ id: nid("c"), catId: it.categoria_id ?? "", subId: it.subcategoria1_id ?? "", min: Number(it.preco_min) || 0, max: Number(it.preco_max) || 0, q: (it.qtd_semanas ?? {}) as Record<string, number> });
      }
      const semanas: number[] = Array.isArray(sc.semanas) && sc.semanas.length ? sc.semanas.map(Number).sort((a: number, b: number) => a - b) : [1, 2, 3, 4];
      return { id: nid("s"), nome: sc.nome, semanas, dataLanc: sc.data_lancamento ?? "", linhas: ordem.map((k) => lm[k]) };
    });
    setSubs(mapped); setHydrated(true);
  }, [colecaoId, loaded, hydrated]);

  const cloneDoPadrao = (): LinhaSub[] => {
    const p = (padroes as any[]).find((x) => x.id === padraoId);
    if (!p) return [];
    return [...(p.linhas ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((l: any) => ({
      id: nid("l"), linhaId: l.linha_id ?? "", profCor: Number(l.prof_cor) || 0, cores: Number(l.cores) || 0,
      cats: [...(l.categorias ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).map((c: any) => ({
        id: nid("c"), catId: c.categoria_id ?? "", subId: c.subcategoria1_id ?? "", min: Number(c.preco_min) || 0, max: Number(c.preco_max) || 0, q: {} as Record<string, number>,
      })),
    }));
  };
  const addSub = () => { const sid = nid("s"); setSubs((xs) => [...xs, { id: sid, nome: `Subcoleção ${xs.length + 1}`, semanas: [1, 2, 3, 4], dataLanc: "", linhas: cloneDoPadrao() }]); setAberta((a) => ({ ...a, [sid]: true })); };
  const delSub = (sid: string) => setSubs((xs) => xs.filter((s) => s.id !== sid));
  const patchSub = (sid: string, p: Partial<Subcolecao>) => setSubs((xs) => xs.map((s) => (s.id === sid ? { ...s, ...p } : s)));
  const toggleSemana = (sid: string, w: number) => setSubs((xs) => xs.map((s) => {
    if (s.id !== sid) return s;
    const tem = s.semanas.includes(w);
    const semanas = tem ? s.semanas.filter((x) => x !== w) : [...s.semanas, w].sort((a, b) => a - b);
    // Desmarcar a semana zera a qtd dela (o estado local casa com o que é salvo/confirmado).
    const linhas = tem ? s.linhas.map((l) => ({ ...l, cats: l.cats.map((c) => { const q = { ...c.q }; delete q[String(w)]; return { ...c, q }; }) })) : s.linhas;
    return { ...s, semanas, linhas };
  }));
  const mapLinha = (sid: string, lid: string, fn: (l: LinhaSub) => LinhaSub) => setSubs((xs) => xs.map((s) => s.id !== sid ? s : { ...s, linhas: s.linhas.map((l) => (l.id === lid ? fn(l) : l)) }));
  const patchLinha = (sid: string, lid: string, p: Partial<LinhaSub>) => mapLinha(sid, lid, (l) => ({ ...l, ...p }));
  const patchCat = (sid: string, lid: string, cid: string, p: Partial<Cat>) => mapLinha(sid, lid, (l) => ({ ...l, cats: l.cats.map((c) => (c.id === cid ? { ...c, ...p } : c)) }));
  const setQ = (sid: string, lid: string, cid: string, w: number, v: number) => mapLinha(sid, lid, (l) => ({ ...l, cats: l.cats.map((c) => (c.id === cid ? { ...c, q: { ...c.q, [String(w)]: v } } : c)) }));
  const addCat = (sid: string, lid: string) => mapLinha(sid, lid, (l) => ({ ...l, cats: [...l.cats, { id: nid("c"), catId: "", subId: "", min: 0, max: 0, q: {} }] }));
  const delCat = (sid: string, lid: string, cid: string) => mapLinha(sid, lid, (l) => ({ ...l, cats: l.cats.filter((c) => c.id !== cid) }));
  const delLinha = (sid: string, lid: string) => setSubs((xs) => xs.map((s) => (s.id === sid ? { ...s, linhas: s.linhas.filter((l) => l.id !== lid) } : s)));
  const addLinha = (sid: string) => setSubs((xs) => xs.map((s) => (s.id === sid ? { ...s, linhas: [...s.linhas, { id: nid("l"), linhaId: "", profCor: 64, cores: 3, cats: [{ id: nid("c"), catId: "", subId: "", min: 0, max: 0, q: {} }] }] } : s)));

  const salvarRaw = async (): Promise<string> => {
    const _header = { nome, mes_id: mesId || null, ano_id: anoId || null, mix_padrao_id: padraoId || null, poder_venda_meta: meta || null, perda_markup: perda };
    const _subcolecoes = subs.map((s) => ({
      nome: s.nome, data_lancamento: s.dataLanc || null, semanas: s.semanas,
      itens: s.linhas.flatMap((l) => l.cats.map((c) => ({
        linha_id: l.linhaId || null, prof_cor: l.profCor, cores: l.cores,
        categoria_id: c.catId || null, subcategoria1_id: c.subId || null, preco_min: c.min, preco_max: c.max,
        qtd_semanas: Object.fromEntries(s.semanas.map((w) => [String(w), Number(c.q[String(w)]) || 0]).filter(([, v]) => (v as number) > 0)),
      }))),
    }));
    const { data, error } = await supabase.rpc("salvar_colecao_pv" as any, { _id: savedId ?? null, _header, _subcolecoes });
    if (error) throw error;
    return data as string;
  };
  const feito = (cid: string) => { setSavedId(cid); qc.invalidateQueries({ queryKey: ["colecao-pv", cid] }); onSaved?.(); };
  const salvar = useMutation({ mutationFn: salvarRaw, onSuccess: (cid) => { toast.success("Coleção salva."); feito(cid); }, onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar a coleção.")) });
  const confirmar = useMutation({
    mutationFn: async () => { const cid = await salvarRaw(); const { data, error } = await supabase.rpc("otb_confirmar_pv" as any, { _colecao_id: cid }); if (error) throw error; return { cid, res: data as { criados: number; removidos: number } }; },
    onSuccess: ({ cid, res }) => { toast.success(`${res.criados} card(s) gerados no Planejamento${res.removidos ? `, ${res.removidos} removido(s)` : ""}.`); setConfirmada(true); feito(cid); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao confirmar a coleção.")),
  });

  const d = useMemo(() => {
    let poder = 0, custo = 0, modelos = 0;
    for (const s of subs) for (const l of s.linhas) {
      const mk = markupDe(l.linhaId); const prof = l.profCor * l.cores;
      for (const c of l.cats) { const tot = totCat(c, s.semanas); const vm = (c.min + c.max) / 2; const pod = tot * prof * vm; poder += pod; modelos += tot; custo += mk > 0 ? pod / mk : 0; }
    }
    return { poder, custo, modelos, desconto: (poder * perda) / 100, pvFinal: poder - (poder * perda) / 100, atingido: meta > 0 ? (poder / meta) * 100 : 0 };
  }, [subs, perda, meta, linhaOpts]);

  // % REAL do mix por linha (modelos da linha ÷ total da coleção) vs a meta do padrão (pct).
  const mixLinha = useMemo(() => {
    const perLinha: Record<string, number> = {}; let total = 0;
    for (const s of subs) for (const l of s.linhas) {
      const mod = l.cats.reduce((a, c) => a + totCat(c, s.semanas), 0);
      perLinha[l.linhaId || ""] = (perLinha[l.linhaId || ""] || 0) + mod; total += mod;
    }
    const p = (padroes as any[]).find((x) => x.id === padraoId);
    const metaPct: Record<string, number> = {};
    for (const pl of (p?.linhas ?? [])) if (pl.linha_id) metaPct[pl.linha_id] = Number(pl.pct) || 0;
    const rows = Object.entries(perLinha).filter(([, m]) => m > 0).map(([lid, mod]) => ({
      linhaId: lid, modelos: mod, real: total > 0 ? (mod / total) * 100 : 0, meta: lid in metaPct ? metaPct[lid] : null,
    })).sort((a, b) => b.modelos - a.modelos);
    return { rows, total };
  }, [subs, padroes, padraoId]);

  const fieldCls = "h-9 rounded-md border border-input bg-background px-2 text-sm";
  const temPadrao = !!padraoId && !!(padroes as any[]).find((p) => p.id === padraoId);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-[70vw] flex flex-col p-0 max-sm:[&>button]:hidden">
        <SheetHeader className="p-4 border-b shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="text-base sm:text-lg">{colecaoId ? "Editar coleção" : "Nova coleção"} · Poder de venda</SheetTitle>
            <Badge variant={confirmada ? "secondary" : "outline"}>{confirmada ? "Confirmada" : "Rascunho"}</Badge>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <Card className="p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <label className="space-y-1 col-span-2"><span className="text-xs font-medium text-muted-foreground">Nome</span>
                <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="ex.: Alto Verão 26" /></label>
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Padrão do mix</span>
                <select className={`${fieldCls} w-full`} value={padraoId} onChange={(e) => setPadraoId(e.target.value)}>
                  <option value="">— escolher —</option>{(padroes as any[]).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select></label>
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Mês</span>
                <select className={`${fieldCls} w-full`} value={mesId} onChange={(e) => setMesId(e.target.value)}><option value="">—</option>{(meses as any[]).map((m) => <option key={m.id} value={m.id}>{m.mes}</option>)}</select></label>
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Ano</span>
                <select className={`${fieldCls} w-full`} value={anoId} onChange={(e) => setAnoId(e.target.value)}><option value="">—</option>{(anos as any[]).map((a) => <option key={a.id} value={a.id}>{a.ano}</option>)}</select></label>
              <label className="space-y-1 col-span-2"><span className="text-xs font-medium text-muted-foreground">Poder de venda meta</span>
                <Input inputMode="decimal" value={meta} onChange={(e) => setMeta(num(e.target.value))} /></label>
              <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Perda markup</span>
                <div className="flex items-center gap-1"><Input inputMode="decimal" value={perda} onChange={(e) => setPerda(num(e.target.value))} /><span className="text-muted-foreground">%</span></div></label>
            </div>
            <div className="mt-3 space-y-2">
              {meta > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Poder de venda planejado</span>
                    <span className="tabular-nums font-medium">{brl(d.poder)} <span className="text-muted-foreground">de {brl(meta)}</span></span></div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, d.atingido)}%` }} /></div>
                  <div className="text-right text-xs font-semibold text-primary">{pct1(d.atingido)} da meta</div>
                </div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{int(d.modelos)} modelos</span>
                <span>Orçamento (custo): <b className="text-foreground tabular-nums">{brl(d.custo)}</b></span>
                <span>Poder de venda: <b className="text-foreground tabular-nums">{brl(d.poder)}</b></span>
                <span>Desconto: <span className="tabular-nums">{brl(d.desconto)}</span></span>
                <span>PV final: <b className="text-foreground tabular-nums">{brl(d.pvFinal)}</b></span>
              </div>
              {mixLinha.rows.length > 0 && (
                <div className="border-t pt-2">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Mix por linha — % real vs meta do padrão</div>
                  <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    {mixLinha.rows.map((r) => {
                      const off = r.meta != null && Math.abs(r.real - r.meta) > 3;
                      return (
                        <div key={r.linhaId} className="flex items-center justify-between text-sm">
                          <span>{r.linhaId ? nomeLinha(r.linhaId) : "— sem linha —"} <span className="text-xs text-muted-foreground">· {int(r.modelos)} mod</span></span>
                          <span className={`tabular-nums ${off ? "text-amber-600" : "text-foreground"}`}>{pct1(r.real)}{r.meta != null && <span className="text-muted-foreground"> / meta {pct1(r.meta)}</span>}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </Card>

          {!temPadrao ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Escolha um Padrão do mix acima pra começar.</div>
          ) : (
            <div className="space-y-2">
              {subs.map((s) => {
                const open = aberta[s.id] ?? true;
                return (
                  <Card key={s.id} className="overflow-hidden">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                      <button className="p-2 -m-2" onClick={() => setAberta((a) => ({ ...a, [s.id]: !open }))}><ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} /></button>
                      <Input className="h-8 w-48 max-sm:w-full font-medium" value={s.nome} onChange={(e) => patchSub(s.id, { nome: e.target.value })} />
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">Semanas:
                        {SEMANAS.map((w) => (
                          <button key={w} onClick={() => toggleSemana(s.id, w)}
                            className={`h-8 w-8 rounded border text-xs tabular-nums ${s.semanas.includes(w) ? "border-primary bg-primary/10 font-semibold text-foreground" : "text-muted-foreground"}`}>{w}</button>
                        ))}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">Lançamento
                        <span className="w-32 max-sm:w-40"><DateField value={s.dataLanc} onChange={(e) => patchSub(s.id, { dataLanc: e.target.value })} /></span>
                      </span>
                      <Button variant="ghost" size="iconSm" className="ml-auto max-sm:h-11 max-sm:w-11" onClick={() => delSub(s.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                    </div>

                    {open && (
                      <div className="border-t bg-muted/10 px-3 py-2 space-y-3">
                        {s.semanas.length === 0 && <p className="text-xs text-amber-600">Escolha ao menos uma semana acima.</p>}
                        {s.linhas.map((l) => {
                          const mk = markupDe(l.linhaId);
                          return (
                            <div key={l.id} className="rounded-md border bg-background p-2">
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <select className={`${fieldCls} min-w-[9rem]`} value={l.linhaId} onChange={(e) => patchLinha(s.id, l.id, { linhaId: e.target.value })}>
                                  <option value="">— linha —</option>{(linhaOpts as any[]).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                                </select>
                                <span className="text-xs text-muted-foreground">markup <b className="text-foreground tabular-nums">{mk ? `${mk.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—"}</b></span>
                                <Lbl t="prof/cor"><Input className="h-8 w-14 px-1 text-right tabular-nums" inputMode="numeric" value={l.profCor} onChange={(e) => patchLinha(s.id, l.id, { profCor: Math.max(0, Math.round(num(e.target.value))) })} /></Lbl>
                                <Lbl t="cores"><Input className="h-8 w-12 px-1 text-right tabular-nums" inputMode="numeric" value={l.cores} onChange={(e) => patchLinha(s.id, l.id, { cores: Math.max(0, Math.round(num(e.target.value))) })} /></Lbl>
                                <Button variant="ghost" size="iconSm" className="ml-auto max-sm:h-11 max-sm:w-11" onClick={() => delLinha(s.id, l.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-sm card-table">
                                  <thead className="text-xs text-muted-foreground">
                                    <tr className="[&>th]:px-2 [&>th]:py-1 [&>th]:font-medium [&>th]:text-right [&>th:first-child]:text-left [&>th:nth-child(2)]:text-left">
                                      <th className="min-w-[8rem]">Categoria</th><th className="min-w-[8rem]">Sub</th><th>Mín</th><th>Máx</th>
                                      {s.semanas.map((w) => <th key={w}>Sem {w}</th>)}<th>Total</th><th>Poder</th><th />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {l.cats.map((c) => {
                                      const tot = totCat(c, s.semanas); const vm = (c.min + c.max) / 2; const pod = tot * l.profCor * l.cores * vm;
                                      return (
                                        <tr key={c.id} className="border-t border-border/50 [&>td]:px-2 [&>td]:py-1 [&>td]:text-right [&>td:first-child]:text-left [&>td:nth-child(2)]:text-left">
                                          <td><select className={`${fieldCls} min-w-[8rem] max-sm:w-full`} value={c.catId} onChange={(e) => patchCat(s.id, l.id, c.id, { catId: e.target.value, subId: "" })}><option value="">— categoria —</option>{(catOpts as any[]).map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}</select></td>
                                          <td data-label="Subcategoria"><select className={`${fieldCls} min-w-[8rem] max-sm:w-full`} value={c.subId} disabled={!c.catId} onChange={(e) => patchCat(s.id, l.id, c.id, { subId: e.target.value })}><option value="">{c.catId ? "—" : "cat. antes"}</option>{subsDaCat(c.catId).map((o: any) => <option key={o.id} value={o.id}>{o.nome}</option>)}</select></td>
                                          <td data-label="Preço mín"><Input className="h-8 w-20 max-sm:h-9 px-1 text-right tabular-nums" inputMode="decimal" value={c.min} onChange={(e) => patchCat(s.id, l.id, c.id, { min: num(e.target.value) })} /></td>
                                          <td data-label="Preço máx"><Input className="h-8 w-20 max-sm:h-9 px-1 text-right tabular-nums" inputMode="decimal" value={c.max} onChange={(e) => patchCat(s.id, l.id, c.id, { max: num(e.target.value) })} /></td>
                                          {s.semanas.map((w) => (
                                            <td key={w} data-label={`Sem ${w}`}><Input className="h-8 w-12 max-sm:h-9 max-sm:w-16 px-1 text-right tabular-nums" inputMode="numeric" value={c.q[String(w)] ?? 0} onChange={(e) => setQ(s.id, l.id, c.id, w, Math.max(0, Math.round(num(e.target.value))))} /></td>
                                          ))}
                                          <td data-label="Total" className="font-semibold tabular-nums">{int(tot)}</td>
                                          <td data-label="Poder" className="tabular-nums text-muted-foreground">{brl(pod)}</td>
                                          <td data-label=""><Button variant="ghost" size="iconSm" onClick={() => delCat(s.id, l.id, c.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></td>
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

        <div className="p-4 border-t shrink-0 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="mr-auto shrink-0 max-sm:aspect-square max-sm:px-0" aria-label="Voltar">
            <ArrowLeft className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Voltar</span>
          </Button>
          <Button variant="secondary" onClick={() => salvar.mutate()} disabled={!nome.trim() || salvar.isPending} className="shrink-0 max-sm:aspect-square max-sm:px-0" aria-label="Salvar">
            <Save className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">{salvar.isPending ? "Salvando…" : "Salvar"}</span>
          </Button>
          <Button onClick={() => confirmar.mutate()} disabled={!nome.trim() || confirmar.isPending || salvar.isPending} className="shrink-0">
            <Check className="h-4 w-4 mr-1" /> Confirmar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Lbl({ t, children }: { t: string; children: React.ReactNode }) {
  return <span className="flex items-center gap-1 text-xs text-muted-foreground">{t} {children}</span>;
}
