import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { brl } from "@/lib/format";
import { Target, ArrowLeft, RotateCcw, Plus, Trash2, ChevronRight } from "lucide-react";

/**
 * OTB (beta) — Fluxo por meta. MAQUETE por COLEÇÃO (só front, nada é salvo).
 * Uma coleção = uma meta + N meses. Você monta linhas → categorias+subcategorias,
 * define preço mín/máx (→ custo mín/máx pelo markup) e quantos modelos por mês.
 * Tudo soma de baixo pra cima e mira a meta de Poder de Venda.
 */

type Combo = { id: string; sub: string; min: number; max: number; porMes: number[] };
type Linha = { id: string; nome: string; markup: number; profCor: number; cores: number; contaMix: boolean; combos: Combo[] };

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesLabel = (ini: number, ano: number, i: number) => {
  const k = ini - 1 + i;
  return `${MES[((k % 12) + 12) % 12]}/${String(ano + Math.floor(k / 12)).slice(2)}`;
};

let _seq = 0;
const nid = (p: string) => `${p}-${++_seq}`;
const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")) || 0);
const soma = (a: number[]) => a.reduce((s, n) => s + (Number(n) || 0), 0);
const int = (n: number) => Math.round(n).toLocaleString("pt-BR");
const pct1 = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const SEED: Linha[] = [
  { id: "aces", nome: "Acessórios", markup: 3.0, profCor: 30, cores: 1, contaMix: false, combos: [
    { id: "a1", sub: "Bolsas", min: 198, max: 398, porMes: [7, 7, 6] },
    { id: "a2", sub: "Brinco", min: 58, max: 148, porMes: [7, 7, 6] },
    { id: "a3", sub: "Pulseira", min: 88, max: 198, porMes: [5, 5, 5] },
  ] },
  { id: "ess", nome: "Essential", markup: 3.0, profCor: 64, cores: 3, contaMix: true, combos: [
    { id: "e1", sub: "Blusas", min: 88, max: 198, porMes: [1, 1, 1] },
    { id: "e2", sub: "Jeans", min: 398, max: 498, porMes: [1, 1, 0] },
  ] },
  { id: "sil", nome: "Silluet", markup: 4.8, profCor: 64, cores: 3, contaMix: true, combos: [
    { id: "s1", sub: "Vestido Curto", min: 298, max: 598, porMes: [1, 2, 1] },
    { id: "s2", sub: "Vestido Midi", min: 348, max: 698, porMes: [2, 1, 1] },
    { id: "s3", sub: "Vestido Longo", min: 438, max: 798, porMes: [1, 2, 1] },
  ] },
  { id: "day", nome: "Day Chic", markup: 4.8, profCor: 64, cores: 3, contaMix: true, combos: [
    { id: "d1", sub: "Blusas", min: 198, max: 398, porMes: [2, 1, 2] },
    { id: "d2", sub: "Calças", min: 298, max: 598, porMes: [1, 2, 1] },
  ] },
  { id: "spe", nome: "Special", markup: 4.8, profCor: 64, cores: 3, contaMix: true, combos: [
    { id: "p1", sub: "Vestido Longo", min: 598, max: 998, porMes: [3, 3, 3] },
    { id: "p2", sub: "Vestido Midi", min: 438, max: 898, porMes: [3, 3, 2] },
  ] },
  { id: "lux", nome: "Luxury", markup: 6.9, profCor: 64, cores: 2, contaMix: true, combos: [
    { id: "l1", sub: "Vestido Longo", min: 1298, max: 1998, porMes: [2, 2, 2] },
  ] },
];
const clone = (x: Linha[]) => x.map((l) => ({ ...l, combos: l.combos.map((c) => ({ ...c, porMes: [...c.porMes] })) }));

export const Route = createFileRoute("/_authenticated/otb-beta/")({ component: OtbBetaPage });

function OtbBetaPage() {
  const [nome, setNome] = useState("Alto Verão 26");
  const [mesIni, setMesIni] = useState(7);
  const [ano, setAno] = useState(2026);
  const [meses, setMeses] = useState(3);
  const [meta, setMeta] = useState(5760552);
  const [perda, setPerda] = useState(25);
  const [linhas, setLinhas] = useState<Linha[]>(() => clone(SEED));
  const [aberta, setAberta] = useState<Record<string, boolean>>({ sil: true });

  const patch = (id: string, p: Partial<Linha>) => setLinhas((xs) => xs.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const addLinha = () => { const id = nid("l"); setLinhas((xs) => [...xs, { id, nome: "Nova linha", markup: 4.8, profCor: 64, cores: 3, contaMix: true, combos: [] }]); setAberta((a) => ({ ...a, [id]: true })); };
  const delLinha = (id: string) => setLinhas((xs) => xs.filter((l) => l.id !== id));
  const patchCombo = (lid: string, cid: string, p: Partial<Combo>) => setLinhas((xs) => xs.map((l) => (l.id === lid ? { ...l, combos: l.combos.map((c) => (c.id === cid ? { ...c, ...p } : c)) } : l)));
  const setMesVal = (lid: string, cid: string, i: number, v: number) => setLinhas((xs) => xs.map((l) => (l.id === lid ? { ...l, combos: l.combos.map((c) => { if (c.id !== cid) return c; const arr = [...c.porMes]; while (arr.length <= i) arr.push(0); arr[i] = v; return { ...c, porMes: arr }; }) } : l)));
  const addCombo = (lid: string) => setLinhas((xs) => xs.map((l) => (l.id === lid ? { ...l, combos: [...l.combos, { id: nid("c"), sub: "", min: 0, max: 0, porMes: Array(meses).fill(0) }] } : l)));
  const delCombo = (lid: string, cid: string) => setLinhas((xs) => xs.map((l) => (l.id === lid ? { ...l, combos: l.combos.filter((c) => c.id !== cid) } : l)));
  const restaurar = () => { setNome("Alto Verão 26"); setMesIni(7); setAno(2026); setMeses(3); setMeta(5760552); setPerda(25); setLinhas(clone(SEED)); setAberta({ sil: true }); };

  const d = useMemo(() => {
    const rows = linhas.map((l) => {
      const profTotal = l.profCor * l.cores;
      const combos = l.combos.map((c) => {
        const mod = soma(c.porMes);
        const vm = (c.min + c.max) / 2;
        return { c, mod, vm, custoMin: l.markup > 0 ? c.min / l.markup : 0, custoMax: l.markup > 0 ? c.max / l.markup : 0, poder: mod * profTotal * vm };
      });
      const mod = combos.reduce((s, x) => s + x.mod, 0);
      const poder = combos.reduce((s, x) => s + x.poder, 0);
      return { l, profTotal, combos, mod, pecas: mod * profTotal, poder, custo: l.markup > 0 ? poder / l.markup : 0 };
    });
    const roupa = rows.filter((r) => r.l.contaMix);
    const totModelos = roupa.reduce((s, r) => s + r.mod, 0);
    const totPecas = roupa.reduce((s, r) => s + r.pecas, 0);
    const totPoder = rows.reduce((s, r) => s + r.poder, 0);
    const totCusto = rows.reduce((s, r) => s + r.custo, 0);
    const desconto = (totPoder * perda) / 100;
    return { rows, totModelos, totPecas, totPoder, totCusto, desconto, pvFinal: totPoder - desconto, markupReal: totCusto > 0 ? (totPoder - desconto) / totCusto : 0, atingido: meta > 0 ? (totPoder / meta) * 100 : 0 };
  }, [linhas, meta, perda]);

  const mesCols = Array.from({ length: meses }, (_, i) => i);
  const fieldCls = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-4 max-sm:pb-24">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Target className="h-7 w-7 text-primary shrink-0" />
          <h1 className="text-2xl font-bold">OTB — Fluxo por meta</h1>
          <Badge variant="secondary">beta</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground"><Link to="/otb"><ArrowLeft className="h-4 w-4 mr-1" /> OTB</Link></Button>
          <Button variant="outline" size="sm" onClick={restaurar}><RotateCcw className="h-4 w-4 mr-1" /> Restaurar exemplo</Button>
        </div>
      </header>

      {/* Coleção (card) */}
      <Card className="p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-6">
          <label className="space-y-1 sm:col-span-2"><span className="text-xs font-medium text-muted-foreground">Coleção</span>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} /></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Mês inicial</span>
            <select className={fieldCls} value={mesIni} onChange={(e) => setMesIni(Number(e.target.value))}>
              {MES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Ano</span>
            <Input inputMode="numeric" value={ano} onChange={(e) => setAno(Math.round(num(e.target.value)) || 0)} /></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Nº de meses</span>
            <Input inputMode="numeric" value={meses} onChange={(e) => setMeses(Math.max(1, Math.min(12, Math.round(num(e.target.value)) || 1)))} /></label>
          <div />
          <label className="space-y-1 sm:col-span-2"><span className="text-xs font-medium text-muted-foreground">Meta de Poder de Venda</span>
            <Input inputMode="decimal" value={meta} onChange={(e) => setMeta(num(e.target.value))} /></label>
          <label className="space-y-1"><span className="text-xs font-medium text-muted-foreground">Perda de markup</span>
            <div className="flex items-center gap-1"><Input inputMode="decimal" value={perda} onChange={(e) => setPerda(num(e.target.value))} /><span className="text-muted-foreground">%</span></div></label>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Poder de venda planejado</span>
            <span className="tabular-nums font-medium">{brl(d.totPoder)} <span className="text-muted-foreground">de {brl(meta)}</span></span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, d.atingido)}%` }} />
          </div>
          <div className="text-right text-xs font-semibold text-primary">{pct1(d.atingido)} da meta</div>
        </div>
      </Card>

      {/* Linhas */}
      <div className="space-y-2">
        {d.rows.map((r) => {
          const l = r.l;
          const open = !!aberta[l.id];
          const share = d.totModelos > 0 && l.contaMix ? (r.mod / d.totModelos) * 100 : 0;
          return (
            <Card key={l.id} className="overflow-hidden">
              {/* header da linha */}
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <button className="flex items-center gap-1" onClick={() => setAberta((a) => ({ ...a, [l.id]: !open }))}>
                  <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
                </button>
                <Input className="h-8 w-40 font-medium" value={l.nome} onChange={(e) => patch(l.id, { nome: e.target.value })} />
                <Field label="markup"><Input className="h-8 w-16 px-1 text-right tabular-nums" inputMode="decimal" value={l.markup} onChange={(e) => patch(l.id, { markup: num(e.target.value) })} /></Field>
                <Field label="prof/cor"><Input className="h-8 w-14 px-1 text-right tabular-nums" inputMode="numeric" value={l.profCor} onChange={(e) => patch(l.id, { profCor: Math.round(num(e.target.value)) })} /></Field>
                <Field label="cores"><Input className="h-8 w-12 px-1 text-right tabular-nums" inputMode="numeric" value={l.cores} onChange={(e) => patch(l.id, { cores: Math.round(num(e.target.value)) })} /></Field>
                <label className="flex items-center gap-1 text-xs text-muted-foreground"><Switch checked={l.contaMix} onCheckedChange={(v) => patch(l.id, { contaMix: v })} /> mix %</label>
                <div className="ml-auto flex items-center gap-4 text-sm tabular-nums">
                  <span title="participação no mix de modelos" className="text-muted-foreground">{l.contaMix ? pct1(share) : "—"}</span>
                  <span><b>{int(r.mod)}</b> mod</span>
                  <span className="text-muted-foreground">{int(r.pecas)} pç</span>
                  <span className="font-medium">{brl(r.poder)}</span>
                  <Button variant="ghost" size="iconSm" onClick={() => delLinha(l.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                </div>
              </div>

              {/* corpo: categorias + meses */}
              {open && (
                <div className="border-t bg-muted/10 px-3 py-2">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr className="[&>th]:px-2 [&>th]:py-1 [&>th]:font-medium [&>th]:text-right [&>th:first-child]:text-left">
                          <th className="min-w-[9rem]">Categoria + subcategoria</th>
                          <th>Preço mín</th><th>Preço máx</th>
                          <th className="text-muted-foreground/70">Custo mín</th><th className="text-muted-foreground/70">Custo máx</th>
                          {mesCols.map((i) => <th key={i} className="min-w-[3rem]">{mesLabel(mesIni, ano, i)}</th>)}
                          <th>Modelos</th><th />
                        </tr>
                      </thead>
                      <tbody>
                        {r.combos.map((cx) => {
                          const c = cx.c;
                          return (
                            <tr key={c.id} className="border-t border-border/50 [&>td]:px-2 [&>td]:py-1 [&>td]:text-right [&>td:first-child]:text-left">
                              <td><Input className="h-8 min-w-[9rem]" value={c.sub} placeholder="ex.: Vestido Longo" onChange={(e) => patchCombo(l.id, c.id, { sub: e.target.value })} /></td>
                              <td><Input className="h-8 w-20 px-1 text-right tabular-nums" inputMode="decimal" value={c.min} onChange={(e) => patchCombo(l.id, c.id, { min: num(e.target.value) })} /></td>
                              <td><Input className="h-8 w-20 px-1 text-right tabular-nums" inputMode="decimal" value={c.max} onChange={(e) => patchCombo(l.id, c.id, { max: num(e.target.value) })} /></td>
                              <td className="tabular-nums text-muted-foreground/70">{brl(cx.custoMin)}</td>
                              <td className="tabular-nums text-muted-foreground/70">{brl(cx.custoMax)}</td>
                              {mesCols.map((i) => (
                                <td key={i}><Input className="h-8 w-12 px-1 text-right tabular-nums" inputMode="numeric" value={c.porMes[i] ?? 0} onChange={(e) => setMesVal(l.id, c.id, i, Math.max(0, Math.round(num(e.target.value))))} /></td>
                              ))}
                              <td className="font-semibold tabular-nums">{int(cx.mod)}</td>
                              <td><Button variant="ghost" size="iconSm" onClick={() => delCombo(l.id, c.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></td>
                            </tr>
                          );
                        })}
                        {r.combos.length === 0 && <tr><td colSpan={7 + meses} className="px-2 py-2 text-muted-foreground">Nenhuma categoria.</td></tr>}
                      </tbody>
                      {r.combos.length > 0 && (
                        <tfoot className="text-xs font-semibold">
                          <tr className="border-t [&>td]:px-2 [&>td]:py-1 [&>td]:text-right [&>td:first-child]:text-left">
                            <td colSpan={5}>Total por mês →</td>
                            {mesCols.map((i) => <td key={i} className="tabular-nums">{int(r.combos.reduce((s, cx) => s + (cx.c.porMes[i] ?? 0), 0))}</td>)}
                            <td className="tabular-nums">{int(r.mod)}</td><td />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                  <Button variant="ghost" size="sm" className="mt-1" onClick={() => addCombo(l.id)}><Plus className="h-4 w-4 mr-1" /> Categoria</Button>
                </div>
              )}
            </Card>
          );
        })}
        <Button variant="outline" onClick={addLinha}><Plus className="h-4 w-4 mr-1" /> Linha</Button>
      </div>

      {/* Totais */}
      <Card className="p-4">
        <div className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <Row k="Poder de venda planejado" v={brl(d.totPoder)} strong />
          <Row k={`Desconto (perda ${pct1(perda)})`} v={`− ${brl(d.desconto)}`} muted />
          <Row k="Custo total" v={brl(d.totCusto)} />
          <Row k="PV Final (receita realista)" v={brl(d.pvFinal)} strong />
          <Row k="Markup realizado" v={`${d.markupReal.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×`} />
          <Row k="Modelos · Peças (mix)" v={`${int(d.totModelos)} · ${int(d.totPecas)}`} />
        </div>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <span className="flex items-center gap-1 text-xs text-muted-foreground">{label} {children}</span>;
}
function Row({ k, v, muted, strong }: { k: string; v: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={muted ? "text-muted-foreground" : ""}>{k}</dt>
      <dd className={`tabular-nums ${strong ? "font-bold" : muted ? "text-muted-foreground" : "font-medium"}`}>{v}</dd>
    </div>
  );
}
