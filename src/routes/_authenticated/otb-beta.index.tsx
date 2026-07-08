import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { brl, fmtNum } from "@/lib/format";
import { Target, ArrowLeft, RotateCcw, Plus, Trash2 } from "lucide-react";

/**
 * OTB (beta) — Fluxo por META. MAQUETE (só front, nada é salvo no banco).
 *
 * Painel 1 (por categoria+subcategoria): mín/máx de preço + QUANTOS MODELOS POR MÊS
 *   (manual). O valor médio do combo = (mín+máx)/2. Daqui sai TUDO:
 *     peças  = modelos × Prof/Cor × Cores
 *     poder  = peças × valor médio do combo
 *     custo  = poder ÷ markup da linha
 * Painel 2 (mix por linha): agrega o Painel 1 e mostra % (derivada), modelos,
 *   peças, poder e custo. A META de Poder de Venda é o ALVO — o resumo mostra
 *   quanto do alvo você já planejou.
 * Acessórios entra no dinheiro, mas fica fora da base de % de modelos.
 */

type Combo = { id: string; sub: string; min: number; max: number; porMes: number[] };
type Linha = {
  id: string;
  nome: string;
  incluiNoMix: boolean; // Acessórios = false (fora da base de %)
  profCor: number;
  cores: number;
  markup: number;
  combos: Combo[];
};

let _seq = 0;
const nid = (p: string) => `${p}-${++_seq}`;
const somaMes = (a: number[]) => a.reduce((s, n) => s + (Number(n) || 0), 0);

const SEED: Linha[] = [
  { id: "aces", nome: "Acessórios", incluiNoMix: false, profCor: 30, cores: 1, markup: 3.0, combos: [
    { id: "a1", sub: "Bolsas", min: 198, max: 398, porMes: [7, 7, 6] },
    { id: "a2", sub: "Brinco", min: 58, max: 148, porMes: [7, 7, 6] },
    { id: "a3", sub: "Pulseira", min: 88, max: 198, porMes: [5, 5, 5] },
  ] },
  { id: "ess", nome: "Essential", incluiNoMix: true, profCor: 64, cores: 3, markup: 3.0, combos: [
    { id: "e1", sub: "Blusas", min: 88, max: 198, porMes: [1, 1, 1] },
    { id: "e2", sub: "Jeans", min: 398, max: 498, porMes: [1, 1, 0] },
  ] },
  { id: "sil", nome: "Silluet", incluiNoMix: true, profCor: 64, cores: 3, markup: 4.8, combos: [
    { id: "s1", sub: "Vestido Curto", min: 298, max: 598, porMes: [1, 2, 1] },
    { id: "s2", sub: "Vestido Midi", min: 348, max: 698, porMes: [2, 1, 1] },
    { id: "s3", sub: "Vestido Longo", min: 438, max: 798, porMes: [1, 2, 1] },
  ] },
  { id: "day", nome: "Day Chic", incluiNoMix: true, profCor: 64, cores: 3, markup: 4.8, combos: [
    { id: "d1", sub: "Blusas", min: 198, max: 398, porMes: [2, 1, 2] },
    { id: "d2", sub: "Calças", min: 298, max: 598, porMes: [1, 2, 1] },
  ] },
  { id: "spe", nome: "Special", incluiNoMix: true, profCor: 64, cores: 3, markup: 4.8, combos: [
    { id: "p1", sub: "Vestido Longo", min: 598, max: 998, porMes: [3, 3, 3] },
    { id: "p2", sub: "Vestido Midi", min: 438, max: 898, porMes: [3, 3, 2] },
  ] },
  { id: "lux", nome: "Luxury", incluiNoMix: true, profCor: 64, cores: 2, markup: 6.9, combos: [
    { id: "l1", sub: "Vestido Longo", min: 1298, max: 1998, porMes: [2, 2, 2] },
  ] },
];

const clone = (x: Linha[]) => x.map((l) => ({ ...l, combos: l.combos.map((c) => ({ ...c, porMes: [...c.porMes] })) }));

export const Route = createFileRoute("/_authenticated/otb-beta/")({
  component: OtbBetaPage,
});

function OtbBetaPage() {
  const [linhas, setLinhas] = useState<Linha[]>(() => clone(SEED));
  const [meta, setMeta] = useState(5760552);
  const [perda, setPerda] = useState(25);
  const [meses, setMeses] = useState(3);
  const [selId, setSelId] = useState("sil");

  const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")) || 0);
  const patch = (id: string, p: Partial<Linha>) =>
    setLinhas((xs) => xs.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const patchCombo = (lid: string, cid: string, p: Partial<Combo>) =>
    setLinhas((xs) => xs.map((l) => (l.id === lid ? { ...l, combos: l.combos.map((c) => (c.id === cid ? { ...c, ...p } : c)) } : l)));
  const setMes = (lid: string, cid: string, i: number, val: number) =>
    setLinhas((xs) => xs.map((l) => (l.id === lid ? { ...l, combos: l.combos.map((c) => {
      if (c.id !== cid) return c;
      const arr = [...c.porMes];
      while (arr.length <= i) arr.push(0);
      arr[i] = val;
      return { ...c, porMes: arr };
    }) } : l)));
  const addCombo = (lid: string) =>
    setLinhas((xs) => xs.map((l) => (l.id === lid ? { ...l, combos: [...l.combos, { id: nid("c"), sub: "", min: 0, max: 0, porMes: Array(meses).fill(0) }] } : l)));
  const delCombo = (lid: string, cid: string) =>
    setLinhas((xs) => xs.map((l) => (l.id === lid ? { ...l, combos: l.combos.filter((c) => c.id !== cid) } : l)));

  const d = useMemo(() => {
    const rows = linhas.map((l) => {
      const profTotal = l.profCor * l.cores;
      const combos = l.combos.map((c) => {
        const vm = (Number(c.min) + Number(c.max)) / 2;
        const mod = somaMes(c.porMes);
        const pecas = mod * profTotal;
        const poder = pecas * vm;
        return { c, vm, mod, pecas, poder, custo: l.markup > 0 ? poder / l.markup : 0 };
      });
      const mod = combos.reduce((s, x) => s + x.mod, 0);
      const pecas = mod * profTotal;
      const poder = combos.reduce((s, x) => s + x.poder, 0);
      const custo = l.markup > 0 ? poder / l.markup : 0;
      const vmLinha = pecas > 0 ? poder / pecas : 0;
      return { l, profTotal, combos, mod, pecas, poder, custo, vmLinha };
    });
    const roupa = rows.filter((r) => r.l.incluiNoMix);
    const totModelos = roupa.reduce((s, r) => s + r.mod, 0);
    const totPecas = roupa.reduce((s, r) => s + r.pecas, 0);
    const totPoder = rows.reduce((s, r) => s + r.poder, 0);
    const totCusto = rows.reduce((s, r) => s + r.custo, 0);
    const desconto = (totPoder * perda) / 100;
    const pvFinal = totPoder - desconto;
    const markupReal = totCusto > 0 ? pvFinal / totCusto : 0;
    const atingido = meta > 0 ? (totPoder / meta) * 100 : 0;
    return { rows, totModelos, totPecas, totPoder, totCusto, desconto, pvFinal, markupReal, atingido };
  }, [linhas, meta, perda]);

  const sel = d.rows.find((r) => r.l.id === selId) ?? null;
  const mesCols = Array.from({ length: meses }, (_, i) => i);

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-5 max-sm:pb-24">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Target className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">OTB — Fluxo por meta</h1>
              <Badge variant="secondary">beta</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Você planeja modelos por categoria e por mês; a meta de Poder de Venda é o alvo.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
            <Link to="/otb"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar ao OTB</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setLinhas(clone(SEED)); setMeta(5760552); setPerda(25); setMeses(3); }}>
            <RotateCcw className="h-4 w-4 mr-1" /> Restaurar exemplo
          </Button>
        </div>
      </header>

      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        🧪 <strong>Protótipo visual.</strong> Nada é salvo no banco. Pré-carregado com a sua planilha AVE RARA —
        mexa à vontade; "Restaurar exemplo" volta tudo.
      </div>

      {/* Cabeçalho: meta + perda + meses */}
      <Card className="p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="text-sm font-medium">Meta de Poder de Venda (alvo)</span>
            <Input inputMode="decimal" value={meta} onChange={(e) => setMeta(num(e.target.value))} />
            <span className="text-xs text-muted-foreground">Potencial a preço cheio que o comercial pediu.</span>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Perda de markup (desconto)</span>
            <div className="flex items-center gap-2">
              <Input inputMode="decimal" value={perda} onChange={(e) => setPerda(num(e.target.value))} />
              <span className="text-muted-foreground">%</span>
            </div>
            <span className="text-xs text-muted-foreground">Ponte p/ a receita realista (~1/3 ⇒ ~66%).</span>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Nº de meses da coleção</span>
            <Input inputMode="numeric" value={meses} onChange={(e) => setMeses(Math.max(1, Math.min(12, Math.round(num(e.target.value)) || 1)))} />
            <span className="text-xs text-muted-foreground">Colunas de mês no Painel 1.</span>
          </label>
        </div>
      </Card>

      {/* Painel 2 — Mix por linha (agregado) */}
      <Card className="overflow-hidden">
        <div className="border-b bg-muted/40 px-4 py-2 text-sm font-semibold">Painel 2 · Mix por linha (agregado do Painel 1)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/20 text-xs text-muted-foreground">
              <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-right [&>th:first-child]:text-left">
                <th>Linha</th><th>% modelos</th><th>Prof/Cor</th><th>Cores</th><th>Markup</th>
                <th>V.Médio</th><th>Modelos</th><th>Peças</th><th>Poder de Venda</th><th>Custo Total</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => {
                const l = r.l;
                const pct = d.totModelos > 0 && l.incluiNoMix ? (r.mod / d.totModelos) * 100 : 0;
                return (
                  <tr key={l.id} onClick={() => setSelId(l.id)}
                    className={`cursor-pointer border-t [&>td]:px-2 [&>td]:py-1.5 [&>td]:text-right [&>td:first-child]:text-left ${l.id === selId ? "bg-primary/5" : "hover:bg-muted/30"}`}>
                    <td className="font-medium">{l.nome}{!l.incluiNoMix && <Badge variant="outline" className="ml-2 text-[10px]">fora do %</Badge>}</td>
                    <td className="tabular-nums text-muted-foreground">{l.incluiNoMix ? `${fmtNum(pct)}%` : "—"}</td>
                    <td><InlineNum value={l.profCor} onChange={(v) => patch(l.id, { profCor: v })} /></td>
                    <td><InlineNum value={l.cores} onChange={(v) => patch(l.id, { cores: v })} /></td>
                    <td><InlineNum value={l.markup} onChange={(v) => patch(l.id, { markup: v })} /></td>
                    <td className="tabular-nums text-muted-foreground">{brl(r.vmLinha)}</td>
                    <td className="font-semibold tabular-nums">{fmtNum(r.mod)}</td>
                    <td className="tabular-nums">{fmtNum(r.pecas)}</td>
                    <td className="tabular-nums">{brl(r.poder)}</td>
                    <td className="tabular-nums">{brl(r.custo)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 bg-muted/30 font-semibold">
              <tr className="[&>td]:px-2 [&>td]:py-2 [&>td]:text-right [&>td:first-child]:text-left">
                <td>Total</td><td className="text-xs font-normal text-muted-foreground">100%</td>
                <td colSpan={3} className="text-right text-xs font-normal text-muted-foreground">modelos/peças NÃO contam Acessórios →</td>
                <td />
                <td className="tabular-nums">{fmtNum(d.totModelos)}</td>
                <td className="tabular-nums">{fmtNum(d.totPecas)}</td>
                <td className="tabular-nums">{brl(d.totPoder)}</td>
                <td className="tabular-nums">{brl(d.totCusto)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Painel 1 — faixas + modelos por mês */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
            <span className="text-sm font-semibold">Painel 1 · {sel ? sel.l.nome : "—"} · faixas + modelos por mês</span>
            {sel && <Button variant="ghost" size="sm" onClick={() => addCombo(sel.l.id)}><Plus className="h-4 w-4 mr-1" /> Combo</Button>}
          </div>
          {!sel ? (
            <div className="p-4 text-sm text-muted-foreground">Selecione uma linha no Painel 2.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-xs text-muted-foreground">
                  <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-right [&>th:first-child]:text-left [&>th:nth-child(2)]:text-right">
                    <th>Categoria + sub</th><th>Mín</th><th>Máx</th><th>V.Méd</th>
                    {mesCols.map((i) => <th key={i}>M{i + 1}</th>)}
                    <th>Modelos</th><th>Poder</th><th />
                  </tr>
                </thead>
                <tbody>
                  {sel.combos.map((cx) => {
                    const c = cx.c;
                    return (
                      <tr key={c.id} className="border-t [&>td]:px-2 [&>td]:py-1 [&>td]:text-right [&>td:first-child]:text-left">
                        <td><Input className="h-8 min-w-[7rem]" value={c.sub} placeholder="subcategoria" onChange={(e) => patchCombo(sel.l.id, c.id, { sub: e.target.value })} /></td>
                        <td><Input className="h-8 w-16 px-1 text-right" inputMode="decimal" value={c.min} onChange={(e) => patchCombo(sel.l.id, c.id, { min: num(e.target.value) })} /></td>
                        <td><Input className="h-8 w-16 px-1 text-right" inputMode="decimal" value={c.max} onChange={(e) => patchCombo(sel.l.id, c.id, { max: num(e.target.value) })} /></td>
                        <td className="tabular-nums text-muted-foreground">{brl(cx.vm)}</td>
                        {mesCols.map((i) => (
                          <td key={i}><Input className="h-8 w-12 px-1 text-right tabular-nums" inputMode="numeric" value={c.porMes[i] ?? 0} onChange={(e) => setMes(sel.l.id, c.id, i, Math.max(0, Math.round(num(e.target.value)))) } /></td>
                        ))}
                        <td className="font-semibold tabular-nums">{fmtNum(cx.mod)}</td>
                        <td className="tabular-nums text-muted-foreground">{brl(cx.poder)}</td>
                        <td><Button variant="ghost" size="iconSm" onClick={() => delCombo(sel.l.id, c.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></td>
                      </tr>
                    );
                  })}
                  {sel.combos.length === 0 && (
                    <tr><td colSpan={6 + meses} className="px-3 py-3 text-sm text-muted-foreground">Nenhum combo. Adicione um acima.</td></tr>
                  )}
                </tbody>
                <tfoot className="border-t-2 bg-muted/30 text-xs font-semibold">
                  <tr className="[&>td]:px-2 [&>td]:py-1.5 [&>td]:text-right [&>td:first-child]:text-left">
                    <td colSpan={4}>Total por mês →</td>
                    {mesCols.map((i) => <td key={i} className="tabular-nums">{fmtNum(sel.combos.reduce((s, cx) => s + (cx.c.porMes[i] ?? 0), 0))}</td>)}
                    <td className="tabular-nums">{fmtNum(sel.mod)}</td>
                    <td className="tabular-nums">{brl(sel.poder)}</td><td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Card>

        {/* Resumo / meta */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold">Resumo vs meta</span>
            <Badge variant={Math.abs(d.atingido - 100) <= 5 ? "default" : "secondary"}>
              {fmtNum(d.atingido)}% da meta
            </Badge>
          </div>
          <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, d.atingido)}%` }} />
          </div>
          <dl className="space-y-2 text-sm">
            <Row k="Meta (alvo)" v={brl(meta)} muted />
            <Row k="Poder de Venda planejado" v={brl(d.totPoder)} strong />
            <Row k={`Desconto / perda de markup (${fmtNum(perda)}%)`} v={`− ${brl(d.desconto)}`} muted />
            <div className="border-t pt-2"><Row k="PV Final (receita realista)" v={brl(d.pvFinal)} strong /></div>
            <Row k="Custo Total (compra/produção)" v={brl(d.totCusto)} />
            <Row k="Markup realizado (PV Final ÷ Custo)" v={`${d.markupReal.toFixed(2)}×`} />
            <div className="border-t pt-2">
              <Row k="Modelos (roupa)" v={fmtNum(d.totModelos)} />
              <Row k="Peças (roupa)" v={fmtNum(d.totPecas)} />
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            Poder de venda agora sobe <strong>de baixo pra cima</strong> (dos modelos que você lança por mês em cada
            categoria) e mira a meta. O valor médio de cada combo é o meio da faixa mín–máx — por isso o total fica
            perto, mas não idêntico, aos R$5,76 mi da planilha (lá o valor médio da linha é um degrau arredondado).
          </p>
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v, muted, strong }: { k: string; v: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={muted ? "text-muted-foreground" : ""}>{k}</dt>
      <dd className={`tabular-nums ${strong ? "text-lg font-bold" : muted ? "text-muted-foreground" : "font-medium"}`}>{v}</dd>
    </div>
  );
}

function InlineNum({ value, onChange, prefix, suffix }: { value: number; onChange: (v: number) => void; prefix?: string; suffix?: string }) {
  return (
    <span className="inline-flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
      {prefix && <span className="text-xs text-muted-foreground">{prefix}</span>}
      <Input className="h-8 w-16 px-1 text-right tabular-nums" inputMode="decimal" value={value}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value.replace(",", ".")) || 0)} />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </span>
  );
}
