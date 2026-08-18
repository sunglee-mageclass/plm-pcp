import { createFileRoute } from "@tanstack/react-router";
import { brl, fmtNum, fmtPct, fmtInt } from "@/lib/format";
import { precoInfo } from "@/lib/preco";
import { normalizeKanbanStatuses, DEFAULT_STATUSES } from "@/lib/kanban-status";
import { useMemo, useState, useRef, useLayoutEffect, type ReactNode } from "react";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Package, Palette, Boxes, AlertTriangle, Layers, Sparkles, Printer, CheckCircle2, Scissors, ClipboardCheck, Factory, DollarSign, Tag, ArrowUp, ArrowDown, Minus, Check, X, Timer, Gauge, ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { FilterButton } from "@/components/shared/filters";
import { useSort, SortTh } from "@/components/shared/sort";
import { Button } from "@/components/ui/button";
import { printWithImages } from "@/lib/print";
import { RelatorioPrint, type RelSecao, REL_COR_SUCESSO, REL_COR_ALERTA, REL_COR_PERIGO } from "@/components/shared/RelatorioPrint";
import { PBar, PBar2 } from "@/components/shared/PrintBarChart";
import { PeriodoPicker, type Periodo } from "@/components/shared/PeriodoPicker";
import {
  CHART_SERIE, CHART_SEQ, CHART_AGE, CHART_GRID, CHART_DIVERGE_NEG, CHART_DIVERGE_POS,
  TONE_BG, TONE_FG, type Tone,
} from "@/lib/chart-colors";
import {
  FASES, idealLookup, itemTotais, heroStats, seqIndexRatio, seqTextToken, bulletScaleMax,
  metaConfig, splitFaseSub,
  type HeroStats, type FaseTotais,
} from "@/lib/leadtime";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  Cell, LabelList,
} from "recharts";

import { RequirePermission } from "@/components/RequirePermission";
import { ModuleGuard } from "@/components/ModuleGuard";
import { useAuth } from "@/hooks/useAuth";
export const Route = createFileRoute("/_authenticated/dashboard")({
  component: () => (
    <ModuleGuard module="dashboard">
      <RequirePermission anyOf={["dashboard_colecao","dashboard_estoque","dashboard_producao","dashboard_financeiro","dashboard_custos","dashboard_comercial","dashboard_leadtime"]}>
        <Dashboard />
      </RequirePermission>
    </ModuleGuard>
  ),
});

// Cores de gráfico: fonte ÚNICA em src/lib/chart-colors.ts (tokens --chart-* de styles.css,
// §R). Série única = CHART_SERIE (1 matiz navy); ordinal = CHART_SEQ; idade do WIP = CHART_AGE.

const isoDate = (d?: Date) => (d ? format(d, "yyyy-MM-dd") : undefined);

const DASH_TABS = [
  { value: "colecao", label: "Coleção", Comp: ColecaoTab },
  { value: "estoque", label: "Estoque", Comp: EstoqueTab },
  { value: "producao", label: "Produção", Comp: ProducaoTab },
  { value: "financeiro", label: "Financeiro", Comp: FinanceiroTab },
  { value: "custos", label: "Custos", Comp: CustosTab },
  { value: "comercial", label: "Comercial", Comp: ComercialTab },
  { value: "leadtime", label: "Leadtime", Comp: LeadtimeTab },
] as const;

function Dashboard() {
  const { canView } = useAuth();
  // Só mostra as abas que o usuário pode ver (a RPC de cada aba também checa
  // a permissão no banco — ver migration dashboard_permissao_por_aba).
  const tabs = DASH_TABS.filter((t) => canView(`dashboard_${t.value}`));
  const [tab, setTab] = useState<string>(tabs[0]?.value ?? "colecao");
  const active = tabs.some((t) => t.value === tab) ? tab : (tabs[0]?.value ?? "colecao");
  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex items-start gap-3">
        <BarChart3 className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Visão geral da coleção e do estoque.</p>
        </div>
      </header>
      <Tabs value={active} onValueChange={setTab}>
        {/* Mobile: dropdown (as abas ficavam apertadas no celular). Desktop: o
            TabsList vai DENTRO da toolbar de cada aba (mr-auto), via <DashTabsList />. */}
        <div className="md:hidden">
          <Select value={active} onValueChange={setTab}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {tabs.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {tabs.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-4">
            {active === t.value && <t.Comp />}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

// TabsList do desktop, reaproveitado dentro da toolbar de cada aba (mr-auto empurra
// os botões de ação pra direita). Mesma lista filtrada por permissão do <Dashboard />.
// No mobile o seletor de abas é o dropdown no nível da página (hidden md:inline-flex aqui).
function DashTabsList() {
  const { canView } = useAuth();
  const tabs = DASH_TABS.filter((t) => canView(`dashboard_${t.value}`));
  return (
    <TabsList className="mr-auto hidden md:inline-flex">
      {tabs.map((t) => (
        <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
      ))}
    </TabsList>
  );
}

type Opt = { id: string; nome: string };

function DashError({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      Erro ao carregar os dados. Verifique a conexão e recarregue a página.
    </p>
  );
}

/* ============================ COLEÇÃO ============================ */

const nfInt = (n: any) => Number(n ?? 0).toLocaleString("pt-BR");

// Estágios do destrinche por LINHA — MESMOS rótulos dos KPI cards da aba (a soma dos 4 =
// total da linha). São ORDINAIS (planejamento → lançados), então usam a rampa SEQUENCIAL
// navy (§R: ordinal = 1 matiz claro→escuro), não matizes cicladas. Drive a barra empilhada;
// as colunas da tabela só usam os rótulos. Casa com os campos de porLinha da RPC.
const LINHA_STAGES = [
  { key: "planejamento", label: "Em Planejamento", color: CHART_SEQ[0] },
  { key: "desenvolvimento", label: "Em Desenvolvimento", color: CHART_SEQ[1] },
  { key: "producao", label: "Em Produção", color: CHART_SEQ[2] },
  { key: "lancados", label: "Lançados", color: CHART_SEQ[3] },
] as const;

function ColecaoTab() {
  const [periodo, setPeriodo] = useState<Periodo>(undefined);
  const [colecao, setColecao] = useState("all");
  const [estilista, setEstilista] = useState("all");
  const [linha, setLinha] = useState("all");
  const ini = isoDate(periodo?.from), fim = isoDate(periodo?.to);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dash-colecao", ini, fim, colecao, estilista, linha],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_colecao", {
        p_inicio: ini,
        p_fim: fim,
        p_colecao: colecao === "all" ? undefined : colecao,
        p_estilista: estilista === "all" ? undefined : estilista,
        p_linha: linha === "all" ? undefined : linha,
      });
      if (error) throw error;
      return data as any;
    },
  });

  const kpis = data?.kpis ?? { total: 0, planejamento: 0, desenvolvimento: 0, producao: 0, lancados: 0 };
  const funnelBase = Number((data?.funnel ?? [])[0]?.value) || 0;
  const funnel = (data?.funnel ?? []).map((f: any, i: number, arr: any[]) => {
    const val = Number(f.value) || 0;
    const prev = i > 0 ? Number(arr[i - 1].value) || 0 : val;
    // pctBase = retenção acumulada vs o topo do funil; conv = conversão do estágio anterior (P1 #4b).
    const pctBase = funnelBase > 0 ? Math.round((val / funnelBase) * 100) : 0;
    const conv = i === 0 ? null : prev > 0 ? Math.round((val / prev) * 100) : 0;
    // Estágios ordinais do funil → rampa sequencial navy (§R), por posição de etapa.
    return { ...f, value: val, fill: CHART_SEQ[Math.min(i, CHART_SEQ.length - 1)], pctBase, conv };
  });
  const pieData = data?.pie ?? [];
  const estilistas: Opt[] = data?.filtros?.estilistas ?? [];
  const linhas: Opt[] = data?.filtros?.linhas ?? [];
  const colecoes: string[] = data?.filtros?.colecoes ?? [];
  const porLinha: any[] = data?.porLinha ?? [];
  const linhaSort = useSort<any>(porLinha, { key: "total", dir: "desc" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DashTabsList />
        <PeriodoPicker value={periodo} onChange={setPeriodo} />
        <FilterButton
          filters={[
            { label: "Coleção", value: colecao, onChange: setColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.filter(Boolean).map((c) => ({ id: c, nome: c }))] },
            { label: "Linha", value: linha, onChange: setLinha, options: [{ id: "all", nome: "Todas" }, ...linhas] },
            { label: "Estilista", value: estilista, onChange: setEstilista, options: [{ id: "all", nome: "Todos" }, ...estilistas] },
          ]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Total Modelos" value={kpis.total} icon={Layers} />
        <Kpi label="Em Planejamento" value={kpis.planejamento} icon={Palette} />
        <Kpi label="Em Desenvolvimento" value={kpis.desenvolvimento} icon={Sparkles} />
        <Kpi label="Em Produção" value={kpis.producao} icon={BarChart3} />
        <Kpi label="Lançados" value={kpis.lancados} icon={Package} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          {/* §R P1 #4b: funil (segmentos difíceis de comparar) → barras de estágio com a % de
              CONVERSÃO etapa-a-etapa (comprimento = retenção vs o topo; rampa navy sequencial). */}
          <h3 className="font-semibold mb-3">Funil de progresso <span className="text-sm font-normal text-muted-foreground">· conversão etapa a etapa</span></h3>
          {funnelBase === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">{isLoading ? "Carregando…" : "Sem dados no período."}</p>
          ) : (
          <div className="space-y-1">
            {funnel.map((f: any) => (
              <div key={f.name}>
                {f.conv != null && (
                  <div className="flex items-center gap-1.5 py-0.5 pl-1 text-[11px] font-semibold text-muted-foreground">
                    <ArrowDown className="h-3 w-3" aria-hidden />
                    <span className="tabular-nums">{f.conv}%</span>
                    <span className="font-normal">de conversão</span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="w-32 shrink-0 truncate text-sm font-medium" title={f.name}>{f.name}</div>
                  <div className="relative h-7 flex-1 overflow-hidden rounded bg-muted" title={`${f.name}: ${fmtInt(f.value)} (${f.pctBase}% do topo)`}>
                    <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${Math.max(f.pctBase, f.value > 0 ? 2 : 0)}%`, background: f.fill }} />
                    <span className="absolute inset-y-0 left-2 flex items-center text-xs font-semibold tabular-nums text-foreground">{fmtInt(f.value)}</span>
                    <span className="absolute inset-y-0 right-2 flex items-center text-[11px] font-medium tabular-nums text-muted-foreground">{f.pctBase}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          )}
        </Card>
        <Card className="p-4">
          {/* §R P1: pizza (ângulos difíceis de comparar, cores cicladas) → BARRA HORIZONTAL
              ordenada maior→menor, 1 matiz navy (a fatia vira comprimento, comparável). */}
          <h3 className="font-semibold mb-3">Distribuição por categoria <span className="text-sm font-normal text-muted-foreground">· maior → menor</span></h3>
          {pieData.length === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">{isLoading ? "Carregando…" : "Sem dados no período."}</p>
          ) : (
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={[...pieData].sort((a: any, b: any) => Number(b.value) - Number(a.value))} layout="vertical" margin={{ left: 8, right: 28 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tickFormatter={(v) => Number(v).toLocaleString("pt-BR")} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: any) => fmtNum(v)} />
                <Bar dataKey="value" name="Modelos" fill={CHART_SERIE} radius={[0, 4, 4, 0]}>
                  <LabelList dataKey="value" position="right" formatter={(v: any) => (Number(v) > 0 ? fmtNum(v) : "")} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          )}
        </Card>
      </div>

      {/* Destrinche por LINHA (item 7) — mesmas métricas dos KPIs, quebradas por linha
          (modelos sem linha = "Sem linha"). Respeita o filtro global da aba. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Modelos por linha <span className="text-sm font-normal text-muted-foreground">· por estágio</span></h3>
          {porLinha.length === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">{isLoading ? "Carregando…" : "Sem dados no período."}</p>
          ) : (
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={porLinha}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="nome" tick={{ fontSize: 11 }} interval={0} />
                <YAxis allowDecimals={false} tickFormatter={(v) => Number(v).toLocaleString("pt-BR")} />
                <Tooltip formatter={(v: any) => fmtNum(v)} />
                <Legend />
                {LINHA_STAGES.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.label} stackId="linha" fill={s.color} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Detalhe por linha</h3>
          <div className="overflow-auto max-h-[360px]">
            <table className="w-full text-sm card-table">
              <thead className="text-left text-muted-foreground sticky top-0 bg-card">
                <tr className="border-b">
                  <SortTh label="Linha" sortKey="nome" sortState={linhaSort} className="py-2 pr-3" />
                  <SortTh label="Total" sortKey="total" sortState={linhaSort} className="py-2 pr-3 text-right" />
                  {LINHA_STAGES.map((s) => (
                    <SortTh key={s.key} label={s.label} sortKey={s.key} sortState={linhaSort} className="py-2 pr-3 text-right" />
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhaSort.sorted.map((r: any) => (
                  <tr key={r.linha_id ?? "sem-linha"} className="border-b last:border-0">
                    <td className="py-2 pr-3" data-label="Linha">{r.nome}</td>
                    <td className="py-2 pr-3 text-right font-medium" data-label="Total">{nfInt(r.total)}</td>
                    {LINHA_STAGES.map((s) => (
                      <td key={s.key} className="py-2 pr-3 text-right" data-label={s.label}>{nfInt(r[s.key])}</td>
                    ))}
                  </tr>
                ))}
                {!isLoading && linhaSort.sorted.length === 0 && (
                  <tr><td colSpan={2 + LINHA_STAGES.length} className="py-4 text-center text-muted-foreground">Sem modelos.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <DashError show={isError} />
    </div>
  );
}


// KPI / stat tile. O acento vem de um TOM semântico §Q9 (chip com fundo suave + ícone e
// número na cor-fg legível) — nunca hsl/hex solto, nunca só cor (o ícone acompanha). Sem
// `tone` = acento neutro/informativo e número na cor de texto padrão (KPIs de contagem).
function Kpi({ label, value, icon: Icon, tone, sub }: { label: string; value: number | string; icon: any; tone?: Tone; sub?: string }) {
  const bg = tone ? TONE_BG[tone] : "var(--tone-info-bg)";
  const fg = tone ? TONE_FG[tone] : "var(--tone-info-fg)";
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: bg, color: fg }}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 text-3xl font-bold leading-none" style={tone ? { color: fg } : undefined}>{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

// Donut on-screen (SVG) p/ taxas — mesmo visual do relatório. Cor default = tom sucesso (§Q9).
function DashDonut({ pct, cor = "var(--success)", legenda }: { pct: number; cor?: string; legenda?: string }) {
  const r = 60, c = 2 * Math.PI * r, on = (c * pct) / 100;
  return (
    <div className="flex flex-col items-center justify-center">
      <svg width="160" height="160" viewBox="0 0 170 170">
        <circle cx="85" cy="85" r={r} fill="none" stroke="var(--muted)" strokeWidth="22" />
        <circle cx="85" cy="85" r={r} fill="none" stroke={cor} strokeWidth="22" strokeDasharray={`${on} ${c - on}`} transform="rotate(-90 85 85)" strokeLinecap="butt" />
        <text x="85" y="98" textAnchor="middle" fontSize="40" fontWeight="800" fill={cor}>{pct}%</text>
      </svg>
      {legenda && <div className="mt-1 text-xs text-muted-foreground text-center">{legenda}</div>}
    </div>
  );
}

// Cabeçalho de seção com ícone em círculo escuro (estilo do relatório aprovado).
function SecHeader({ icon: Icon, children }: { icon: any; children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
        <Icon className="h-4 w-4" />
      </span>
      <h3 className="font-semibold">{children}</h3>
    </div>
  );
}

/* ============================ ESTOQUE ============================ */

function EstoqueTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dash-estoque"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_estoque");
      if (error) throw error;
      return data as any;
    },
  });

  const totalVariantes = data?.totalVariantes ?? 0;
  const totalAviamentos = data?.totalAviamentos ?? 0;
  const estoqueTecido = data?.estoqueTecido ?? [];
  const estoqueAviamento = data?.estoqueAviamento ?? [];
  const barTecido = data?.barTecido ?? [];
  const barAviamento = data?.barAviamento ?? [];
  const tecSort = useSort<any>(estoqueTecido, { key: "estoque", dir: "desc" });
  const aviSort = useSort<any>(estoqueAviamento, { key: "estoque", dir: "desc" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DashTabsList />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Kpi label="Variantes de Tecido" value={totalVariantes} icon={Boxes} />
        <Kpi label="Aviamentos" value={totalAviamentos} icon={Package} />
      </div>

      {/* Estoque (maior → menor), separado Tecido e Aviamento. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { titulo: "Estoque de Tecido", s: tecSort },
          { titulo: "Estoque de Aviamento", s: aviSort },
        ].map(({ titulo, s }) => (
          <Card key={titulo} className="p-4">
            <h3 className="font-semibold mb-3">{titulo} <span className="text-sm font-normal text-muted-foreground">· maior → menor</span></h3>
            <div className="overflow-auto max-h-[360px]">
              <table className="w-full text-sm card-table">
                <thead className="text-left text-muted-foreground sticky top-0 bg-card">
                  <tr className="border-b">
                    <SortTh label="Item" sortKey="nome" sortState={s} className="py-2 pr-3" />
                    <SortTh label="Categoria" sortKey="categoria" sortState={s} className="py-2 pr-3" />
                    <SortTh label="Estoque" sortKey="estoque" sortState={s} className="py-2 pr-3 text-right" />
                  </tr>
                </thead>
                <tbody>
                  {s.sorted.map((r: any) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 truncate max-w-[240px]" data-label="Item">{r.nome}</td>
                      <td className="py-2 pr-3" data-label="Categoria">{r.categoria}</td>
                      <td className="py-2 pr-3 text-right" data-label="Estoque">{fmtNum(r.estoque)}</td>
                    </tr>
                  ))}
                  {!isLoading && s.sorted.length === 0 && (
                    <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">Sem itens.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>

      {/* Estoque por categoria — tecido e aviamento. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {[
          { titulo: "Estoque por categoria de tecido", data: barTecido, cor: CHART_SERIE },
          { titulo: "Estoque por categoria de aviamento", data: barAviamento, cor: CHART_SERIE },
        ].map((g) => (
          <Card key={g.titulo} className="p-4">
            <h3 className="font-semibold mb-3">{g.titulo}</h3>
            <div style={{ width: "100%", height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={g.data}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="categoria" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="total" fill={g.cor} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        ))}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <DashError show={isError} />
    </div>
  );
}

/* Barra vertical por mês (um único indicador). */
function MonthBarCard({ title, subtitle, data, dataKey, name, color, empty, loading }: {
  title: string; subtitle?: string; data: any[]; dataKey: string; name: string; color: string; empty: string; loading: boolean;
}) {
  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-1">{title}</h3>
      {subtitle && <p className="text-xs text-muted-foreground mb-2">{subtitle}</p>}
      <div style={{ width: "100%", height: 280 }}>
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis dataKey="mes" />
            <YAxis allowDecimals={false} tickFormatter={(v) => Number(v).toLocaleString("pt-BR")} />
            <Tooltip formatter={(v: any) => fmtNum(v)} />
            <Bar dataKey={dataKey} name={name} fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {!loading && data.length === 0 && <p className="text-sm text-muted-foreground text-center mt-2">{empty}</p>}
    </Card>
  );
}

/* Barra horizontal por etapa do kanban (um único indicador). */
function EtapaBarCard({ title, data, dataKey, name, color }: {
  title: string; data: any[]; dataKey: string; name: string; color: string;
}) {
  const height = Math.max(320, data.length * 30 + 40);
  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 48 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            {/* domain c/ folga à direita p/ o rótulo do valor não ser cortado (ex.: "770"). */}
            <XAxis type="number" allowDecimals={false} domain={[0, (max: number) => Math.ceil(max * 1.15) || 1]} />
            <YAxis type="category" dataKey="label" width={132} tick={{ fontSize: 11 }} interval={0} />
            <Tooltip formatter={(v: any) => fmtNum(v)} />
            <Bar dataKey={dataKey} name={name} fill={color} radius={[0, 4, 4, 0]}>
              <LabelList dataKey={dataKey} position="right" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

/* ============================ PRODUÇÃO ============================ */

function RankingServicos() {
  // Seletor = CATEGORIA DE SERVIÇO (Corte/Oficina/PL/...), não subcategoria de produto.
  // "Geral" agrega todos os serviços. Prazo = data_prevista do bloco; desvio = entrega − prazo.
  const [cat, setCat] = useState("all");
  const { data } = useQuery({
    queryKey: ["dash-ranking-servicos", cat],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ranking_servicos" as never, {
        p_categoria: cat === "all" ? undefined : cat,
      } as never);
      if (error) throw error;
      return data as any;
    },
  });
  const ranking: any[] = data?.ranking ?? [];
  const categorias: any[] = data?.categorias ?? [];
  const rankMap = useMemo(() => new Map(ranking.map((r, i) => [r.fornecedor, i + 1])), [ranking]);
  const sort = useSort<any>(ranking, { key: "desvio", dir: "asc" });

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Ranking de serviços <span className="text-sm font-normal text-muted-foreground">· entrega real vs prazo estipulado (menor desvio = melhor)</span></h3>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger className="h-8 w-full sm:w-56"><SelectValue placeholder="Serviço" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Geral (todos os serviços)</SelectItem>
            {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm card-table">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pr-3 w-10 text-center">#</th>
              <SortTh label="Fornecedor" sortKey="fornecedor" sortState={sort} className="py-2 pr-3" />
              <SortTh label="Entregas" sortKey="entregas" sortState={sort} className="py-2 pr-3 text-right" />
              <SortTh label="Dias real" sortKey="diasReal" sortState={sort} className="py-2 pr-3 text-right" />
              <SortTh label="Prazo" sortKey="diasPrazo" sortState={sort} className="py-2 pr-3 text-right" />
              <SortTh label="Desvio" sortKey="desvio" sortState={sort} className="py-2 pr-3 text-right" />
              <SortTh label="% no prazo" sortKey="pctDentro" sortState={sort} className="py-2 pr-3 text-right" />
            </tr>
          </thead>
          <tbody>
            {sort.sorted.map((r: any) => {
              const pos = rankMap.get(r.fornecedor) ?? 0;
              const medal = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : String(pos);
              const dentro = Number(r.desvio) <= 0;
              return (
                <tr key={r.fornecedor} className="border-b last:border-0">
                  <td className="py-2 pr-3 text-center">{medal}</td>
                  <td className="py-2 pr-3 font-medium" data-label="Fornecedor">{r.fornecedor}</td>
                  <td className="py-2 pr-3 text-right" data-label="Entregas">{r.entregas}</td>
                  <td className="py-2 pr-3 text-right" data-label="Dias real">{fmtNum(r.diasReal)}</td>
                  <td className="py-2 pr-3 text-right" data-label="Prazo">{fmtNum(r.diasPrazo)}</td>
                  <td className={"py-2 pr-3 text-right font-medium " + (dentro ? "text-green-600 dark:text-green-400" : "text-destructive")} data-label="Desvio">
                    {Number(r.desvio) > 0 ? "+" : ""}{fmtNum(r.desvio)}
                  </td>
                  <td className="py-2 pr-3 text-right" data-label="% no prazo">{r.pctDentro}%</td>
                </tr>
              );
            })}
            {ranking.length === 0 && (
              <tr><td colSpan={7} className="py-4 text-center text-muted-foreground">
                Sem entregas registradas para este serviço (precisa de envio + entrega no bloco).
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Produção por CATEGORIA DE SERVIÇO (Corte/Oficina/PL/…). Uma chamada por seleção à RPC
// dashboard_producao_servicos; herda o filtro global da aba (período/coleção/linha) por props.
//   • Em produção (foto atual): categoria=Todas => barras POR SERVIÇO (quem tem mais WIP agora);
//     categoria específica => barras POR IDADE (dias desde o envio, escala sequencial).
//   • Entregue (série temporal): barras por MÊS da data_entregue.
// Toggle Modelos | Peças = as 2 visões de cada gráfico.
function ProducaoServicos({ ini, fim, colecao, linha }: { ini?: string; fim?: string; colecao: string; linha: string }) {
  const [categoria, setCategoria] = useState("all");
  const [metrica, setMetrica] = useState<"modelos" | "pecas">("modelos");
  const { data, isLoading } = useQuery({
    queryKey: ["dash-prod-servicos", ini, fim, colecao, linha, categoria],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_producao_servicos" as never, {
        p_inicio: ini,
        p_fim: fim,
        p_colecao: colecao === "all" ? undefined : colecao,
        p_linha: linha === "all" ? undefined : linha,
        p_categoria: categoria === "all" ? undefined : categoria,
      } as never);
      if (error) throw error;
      return data as any;
    },
  });

  const categorias: { nome: string }[] = data?.categorias ?? [];
  const porCategoria: any[] = data?.emProducaoPorCategoria ?? [];
  const porIdade: any[] = data?.emProducaoPorIdade ?? [];
  const entregue: any[] = data?.entreguePorMes ?? [];
  const isTodas = categoria === "all";
  const dk = metrica; // "modelos" | "pecas"
  const mLabel = metrica === "modelos" ? "Modelos" : "Peças";

  // Em produção: por serviço (visão geral) OU por idade (categoria específica).
  const emProdData = isTodas ? porCategoria : porIdade;
  const emProdXKey = isTodas ? "categoria" : "bucket";
  const emProdVazio = (emProdData as any[]).length === 0 || (emProdData as any[]).every((d) => Number(d?.[dk] ?? 0) === 0);
  const entregueVazio = (entregue as any[]).length === 0;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Produção por serviço <span className="font-normal">· {isTodas ? "todas as categorias" : categoria}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {/* Toggle das 2 visões (Modelos | Peças), aplicado aos dois gráficos. */}
          <div className="inline-flex rounded-md border p-0.5">
            <Button size="sm" variant={metrica === "modelos" ? "default" : "ghost"} className="h-7 border-0" onClick={() => setMetrica("modelos")}>Modelos</Button>
            <Button size="sm" variant={metrica === "pecas" ? "default" : "ghost"} className="h-7 border-0" onClick={() => setMetrica("pecas")}>Peças</Button>
          </div>
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger className="h-8 w-full sm:w-52"><SelectValue placeholder="Serviço" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as categorias</SelectItem>
              {categorias.map((c) => <SelectItem key={c.nome} value={c.nome}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* (a) Em produção — foto atual (sem finalização). */}
        <Card className="p-4">
          <h3 className="font-semibold mb-1">Em produção <span className="text-sm font-normal text-muted-foreground">· {mLabel}</span></h3>
          <p className="text-xs text-muted-foreground mb-2">
            {isTodas ? "por serviço · blocos sem finalização (foto atual)" : "por idade (dias desde o envio) · blocos sem finalização"}
          </p>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={emProdData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey={emProdXKey} tick={{ fontSize: 11 }} interval={0} />
                <YAxis allowDecimals={false} tickFormatter={(v) => Number(v).toLocaleString("pt-BR")} />
                <Tooltip formatter={(v: any) => fmtNum(v)} />
                <Bar dataKey={dk} name={mLabel} fill={CHART_SERIE} radius={[4, 4, 0, 0]}>
                  {/* Categoria específica: rampa SEQUENCIAL por idade (§R, por barra). Visão geral: matiz único. */}
                  {!isTodas && (emProdData as any[]).map((d, i) => (
                    <Cell key={i} fill={CHART_AGE[Number(d.ordem)] ?? CHART_SERIE} />
                  ))}
                  <LabelList dataKey={dk} position="top" formatter={(v: any) => (Number(v) > 0 ? fmtNum(v) : "")} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {!isLoading && emProdVazio && (
            <p className="text-sm text-muted-foreground text-center mt-2">Nada em produção{isTodas ? "" : " nesta categoria"}.</p>
          )}
        </Card>

        {/* (b) Entregue ao longo do tempo — blocos finalizados. */}
        <Card className="p-4">
          <h3 className="font-semibold mb-1">Entregue ao longo do tempo <span className="text-sm font-normal text-muted-foreground">· {mLabel}</span></h3>
          <p className="text-xs text-muted-foreground mb-2">blocos finalizados · por mês da data de entrega</p>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={entregue}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tickFormatter={(v) => Number(v).toLocaleString("pt-BR")} />
                <Tooltip formatter={(v: any) => fmtNum(v)} />
                <Bar dataKey={dk} name={mLabel} fill={CHART_SERIE} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {!isLoading && entregueVazio && (
            <p className="text-sm text-muted-foreground text-center mt-2">Nada entregue no período.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function ProducaoTab() {
  const fl = useFieldLabels();
  const [periodo, setPeriodo] = useState<Periodo>(undefined);
  const [colecao, setColecao] = useState("all");
  const [linha, setLinha] = useState("all");
  const [servico, setServico] = useState("all");
  // SLA mostra só 5 por padrão (cabe em mobile e desktop); "ver mais" expande.
  const [slaAll, setSlaAll] = useState(false);
  const ini = isoDate(periodo?.from), fim = isoDate(periodo?.to);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dash-producao", ini, fim, colecao, linha],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_producao" as never, {
        p_inicio: ini,
        p_fim: fim,
        p_colecao: colecao === "all" ? undefined : colecao,
        p_linha: linha === "all" ? undefined : linha,
      } as never);
      if (error) throw error;
      return data as any;
    },
  });

  const slaPorTerc = data?.slaPorTerc ?? [];
  // SLA por serviço: tipos disponíveis (p/ filtro), filtra e ordena.
  const slaTipos = useMemo<string[]>(
    () => Array.from(new Set((slaPorTerc as any[]).map((r) => r.tipo).filter(Boolean))).sort(),
    [slaPorTerc],
  );
  const slaFiltrado = useMemo(
    () => (servico === "all" ? slaPorTerc : (slaPorTerc as any[]).filter((r) => r.tipo === servico)),
    [slaPorTerc, servico],
  );
  const slaSort = useSort<any>(slaFiltrado, { key: "nome" });
  const kpiPrazo = data?.kpiPrazo ?? { noPrazo: 0, atrasadas: 0, pct: 0 };
  const cortes = data?.cortesPorMes ?? [];
  // Cortes só fazem sentido se a loja usa o serviço "Corte" (senão é PL, corte incluso).
  const usaCorte = (data as any)?.usaCorte ?? false;
  const finalizadas = data?.finalizadasPorMes ?? [];
  const kanbanDev = data?.kanbanDev ?? [];
  const cortesFinalizados = useMemo(() => {
    const m = new Map<string, { mes: string; cortados: number; finalizados: number }>();
    for (const c of (cortes as any[])) m.set(c.mes, { mes: c.mes, cortados: Number(c.modelos ?? 0), finalizados: 0 });
    for (const f of (finalizadas as any[])) { const e = m.get(f.mes) ?? { mes: f.mes, cortados: 0, finalizados: 0 }; e.finalizados = Number(f.modelos ?? 0); m.set(f.mes, e); }
    return Array.from(m.values());
  }, [cortes, finalizadas]);
  const porColecao = data?.porColecao ?? [];
  const porLinha = data?.porLinha ?? [];
  const defeitoMes = data?.defeitoPorMes ?? [];
  const defeitoMedio = useMemo(() => {
    const a = defeitoMes as any[];
    return a.length ? a.reduce((s, d) => s + Number(d.taxa || 0), 0) / a.length : 0;
  }, [defeitoMes]);

  const colecoes: string[] = data?.filtros?.colecoes ?? [];
  const linhas: Opt[] = data?.filtros?.linhas ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DashTabsList />
        <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => printWithImages()}><Printer className="h-4 w-4 mr-1" /> Imprimir</Button>
        <PeriodoPicker value={periodo} onChange={setPeriodo} />
        <FilterButton
          filters={[
            { label: "Coleção", value: colecao, onChange: setColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.filter(Boolean).map((c) => ({ id: c, nome: c }))] },
            { label: "Linha", value: linha, onChange: setLinha, options: [{ id: "all", nome: "Todas" }, ...linhas] },
          ]}
        />
      </div>

      <DashError show={isError} />

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_260px]">
        <Kpi label="Entregas no prazo" value={kpiPrazo.noPrazo} icon={CheckCircle2} tone="success" sub="entregas de Serviços" />
        <Kpi label="Atrasadas" value={kpiPrazo.atrasadas} icon={AlertTriangle} tone={Number(kpiPrazo.atrasadas) > 0 ? "danger" : undefined} sub={`${Math.round((Number(kpiPrazo.atrasadas) / Math.max(Number(kpiPrazo.noPrazo) + Number(kpiPrazo.atrasadas), 1)) * 100)}% do total`} />
        <Kpi label="Defeito médio" value={fmtPct(defeitoMedio)} icon={Sparkles} tone="warning" sub="defeito ÷ recebido" />
        <Card className="p-4 flex flex-col">
          <span className="text-xs font-medium text-muted-foreground mb-1">% no prazo</span>
          <div className="flex-1 flex items-center justify-center">
            <DashDonut pct={Math.round(Number(kpiPrazo.pct) || 0)} legenda={`${kpiPrazo.noPrazo} no prazo · ${kpiPrazo.atrasadas} atrasadas`} />
          </div>
        </Card>
      </div>

      {usaCorte && (
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">Cortes por mês <span className="font-normal">· por data de entrega do corte</span></h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <MonthBarCard title="Modelos cortados" data={cortes} dataKey="modelos" name="Modelos" color={CHART_SERIE} empty="Sem cortes no período." loading={isLoading} />
          <MonthBarCard title="Grade total cortada" subtitle="peças" data={cortes} dataKey="grade" name="Grade total" color={CHART_SERIE} empty="Sem cortes no período." loading={isLoading} />
        </div>
      </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">Produção finalizada por mês <span className="font-normal">· Serviços com status finalizado</span></h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <MonthBarCard title="Modelos finalizados" data={finalizadas} dataKey="modelos" name="Modelos" color={CHART_SERIE} empty="Nada finalizado no período." loading={isLoading} />
          <MonthBarCard title="Grade total finalizada" subtitle="peças" data={finalizadas} dataKey="grade" name="Grade total" color={CHART_SERIE} empty="Nada finalizado no período." loading={isLoading} />
        </div>
      </div>

      <ProducaoServicos ini={ini} fim={fim} colecao={colecao} linha={linha} />

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">Etapa do kanban de Desenvolvimento</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <EtapaBarCard title="Modelos por etapa" data={kanbanDev} dataKey="modelos" name="Modelos" color={CHART_SERIE} />
          <EtapaBarCard title="Grade total por etapa" data={kanbanDev} dataKey="grade" name="Grade total" color={CHART_SERIE} />
        </div>
      </div>

      {/* "Timeline por REF" aposentada (jul/2026): a aba Leadtime a substitui — tempo por
          etapa vs ideal, em vez de só a posição atual de cada REF. */}

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Taxa de defeito por mês <span className="text-sm font-normal text-muted-foreground">· defeito ÷ recebido (entregas de Serviços)</span></h3>
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={defeitoMes}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="mes" />
              <YAxis tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: any) => `${Number(v)}%`} />
              <Bar dataKey="taxa" name="Taxa de defeito" fill={CHART_SERIE} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="font-semibold">SLA por serviço</h3>
          <Select value={servico} onValueChange={setServico}>
            <SelectTrigger className="h-8 w-48"><SelectValue placeholder="Serviço" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os serviços</SelectItem>
              {slaTipos.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm card-table">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <SortTh label="Nome" sortKey="nome" sortState={slaSort} className="py-2 pr-3" />
              <SortTh label="Tipo de serviço" sortKey="tipo" sortState={slaSort} className="py-2 pr-3" />
              <SortTh label="SLA médio (dias)" sortKey="slaMedio" sortState={slaSort} className="py-2 pr-3 text-right" />
              <SortTh label="Atrasos" sortKey="atrasos" sortState={slaSort} className="py-2 pr-3 text-right" />
              <SortTh label="Total entregue" sortKey="total" sortState={slaSort} className="py-2 pr-3 text-right" />
              <SortTh label="Taxa de Defeito" sortKey="taxaDefeito" sortState={slaSort} className="py-2 pr-3 text-right" />
            </tr>
          </thead>
          <tbody>
            {(slaAll ? slaSort.sorted : slaSort.sorted.slice(0, 5)).map((r: any, i: number) => {
              const taxa = Number(r.taxaDefeito ?? 0);
              const produzidas = Number(r.pecasProduzidas ?? 0);
              const defeito = Number(r.pecasDefeito ?? 0);
              const badgeCls = taxa > 5
                ? "bg-destructive text-destructive-foreground"
                : taxa > 2
                  ? "bg-yellow-500 text-white"
                  : "bg-muted text-muted-foreground";
              return (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 pr-3">{r.nome}</td>
                  <td className="py-2 pr-3" data-label="Tipo de serviço">{r.tipo ?? "—"}</td>
                  <td className="py-2 pr-3 text-right" data-label="SLA médio (dias)">{fmtNum(r.slaMedio)}</td>
                  <td className={"py-2 pr-3 text-right " + (Number(r.atrasos) > 0 ? "text-destructive" : "")} data-label="Atrasos">{r.atrasos}</td>
                  <td className="py-2 pr-3 text-right" data-label="Total entregue">{r.total}</td>
                  <td className="py-2 pr-3 text-right" data-label="Taxa de Defeito">
                    {produzidas > 0 ? (
                      <span
                        className={"inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium " + badgeCls}
                        title={`${defeito} defeito${defeito === 1 ? "" : "s"} / ${produzidas} peça${produzidas === 1 ? "" : "s"}`}
                      >
                        {fmtNum(taxa)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!isLoading && slaSort.sorted.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">Sem entregas registradas.</td></tr>}
          </tbody>
        </table>
        </div>
        {slaSort.sorted.length > 5 && (
          <button type="button" onClick={() => setSlaAll((v) => !v)} className="mt-3 text-sm text-primary hover:underline">
            {slaAll ? "Ver menos" : `Ver mais (${slaSort.sorted.length - 5})`}
          </button>
        )}
      </Card>

      <RankingServicos />

      <RelatorioPrint
        titulo="Relatório de Produção — prazos e qualidade"
        subtitulo="Cortes, finalizações, SLA e defeitos da produção"
        dataStr={new Date().toLocaleDateString("pt-BR")}
        kpis={[
          { label: "Entregas no prazo", valor: String(kpiPrazo.noPrazo ?? 0), cor: REL_COR_SUCESSO },
          { label: "Atrasadas", valor: String(kpiPrazo.atrasadas ?? 0), cor: Number(kpiPrazo.atrasadas) > 0 ? REL_COR_PERIGO : undefined },
          { label: "Defeito médio", valor: fmtPct(defeitoMedio), cor: REL_COR_ALERTA },
        ]}
        donut={{ pct: Math.round(Number(kpiPrazo.pct) || 0), cor: REL_COR_SUCESSO, titulo: "Entregas no prazo", legenda: `${kpiPrazo.noPrazo ?? 0} no prazo · ${kpiPrazo.atrasadas ?? 0} atrasadas` }}
        secoes={[
          {
            titulo: "Qualidade — taxa de defeito por mês", icone: "◷",
            descricao: "Defeito ÷ recebido (entregas de Serviços)",
            grafico: (defeitoMes as any[]).length > 0 ? <PBar data={defeitoMes as any[]} xKey="mes" barKey="taxa" fmtL={(v) => `${v}%`} /> : undefined,
            colunas: [{ key: "mes", label: "Mês" }, { key: "taxa", label: "Taxa de defeito", align: "right" }],
            linhas: (defeitoMes as any[]).map((d) => ({ mes: d.mes, taxa: `${Number(d.taxa)}%` })), zebra: true,
          },
          {
            titulo: "SLA / qualidade por serviço", icone: "▤",
            colunas: [
              { key: "nome", label: "Prestador" },
              { key: "tipo", label: "Tipo de serviço" },
              { key: "sla", label: "SLA médio (dias)", align: "right" },
              { key: "atrasos", label: "Atrasos", align: "right" },
              { key: "total", label: "Total entregue", align: "right" },
              { key: "defeito", label: "Taxa de defeito", align: "right" },
            ],
            linhas: (slaPorTerc as any[]).map((r) => ({
              nome: r.nome ?? "—",
              tipo: r.tipo ?? "—",
              sla: fmtNum(r.slaMedio),
              atrasos: String(r.atrasos ?? 0),
              total: String(r.total ?? 0),
              defeito: `${Number(r.taxaDefeito ?? 0)}%`,
            })), zebra: true,
          },
          {
            titulo: "Desempenho por coleção", icone: "▣",
            colunas: [{ key: "nome", label: "Coleção" }, { key: "modelos", label: "Modelos", align: "right" }, { key: "grade", label: "Grade total", align: "right" }, { key: "defeito", label: "Defeito", align: "right" }],
            linhas: (porColecao as any[]).map((c) => ({ nome: c.nome ?? "—", modelos: nfInt(c.modelos), grade: nfInt(c.grade), defeito: `${Number(c.defeito ?? 0)}%` })), zebra: true,
          },
          {
            titulo: "Desempenho por linha", icone: "▦",
            colunas: [{ key: "nome", label: "Linha" }, { key: "modelos", label: "Modelos", align: "right" }, { key: "grade", label: "Grade total", align: "right" }, { key: "defeito", label: "Defeito", align: "right" }],
            linhas: (porLinha as any[]).map((c) => ({ nome: c.nome ?? "—", modelos: nfInt(c.modelos), grade: nfInt(c.grade), defeito: `${Number(c.defeito ?? 0)}%` })), zebra: true,
          },
          ...(usaCorte ? ([{
            titulo: "Cortes por mês", icone: "▦",
            descricao: "Por data de entrega do corte",
            grafico: (cortes as any[]).length > 0 ? <PBar2
              a={{ titulo: "Modelos cortados", node: <PBar data={cortes} xKey="mes" barKey="modelos" width={320} height={160} fmtL={nfInt} /> }}
              b={{ titulo: "Grade total cortada", node: <PBar data={cortes} xKey="mes" barKey="grade" width={320} height={160} fmtL={nfInt} /> }} /> : undefined,
            colunas: [{ key: "mes", label: "Mês" }, { key: "modelos", label: "Modelos", align: "right" }, { key: "grade", label: "Grade total", align: "right" }],
            linhas: (cortes as any[]).map((d) => ({ mes: d.mes, modelos: nfInt(d.modelos), grade: nfInt(d.grade) })), zebra: true,
          }] as RelSecao[]) : []),
          {
            titulo: "Produção finalizada por mês", icone: "▦",
            descricao: "Serviços com status finalizado",
            grafico: (finalizadas as any[]).length > 0 ? <PBar2
              a={{ titulo: "Modelos finalizados", node: <PBar data={finalizadas} xKey="mes" barKey="modelos" width={320} height={160} fmtL={nfInt} /> }}
              b={{ titulo: "Grade total finalizada", node: <PBar data={finalizadas} xKey="mes" barKey="grade" width={320} height={160} fmtL={nfInt} /> }} /> : undefined,
            colunas: [{ key: "mes", label: "Mês" }, { key: "modelos", label: "Modelos", align: "right" }, { key: "grade", label: "Grade total", align: "right" }],
            linhas: (finalizadas as any[]).map((d) => ({ mes: d.mes, modelos: nfInt(d.modelos), grade: nfInt(d.grade) })), zebra: true,
          },
          {
            titulo: "Kanban de desenvolvimento", icone: "◷",
            colunas: [{ key: "etapa", label: "Etapa" }, { key: "modelos", label: "Modelos", align: "right" }, { key: "grade", label: "Grade total", align: "right" }],
            linhas: (kanbanDev as any[]).map((k) => ({ etapa: k.label ?? "—", modelos: nfInt(k.modelos), grade: nfInt(k.grade) })), zebra: true,
          },
        ]}
      />
    </div>
  );
}

/* ============================ FINANCEIRO ============================ */

function FinanceiroTab() {
  const [periodo, setPeriodo] = useState<Periodo>(undefined);
  const inicio = isoDate(periodo?.from), fim = isoDate(periodo?.to);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dash-financeiro", inicio, fim],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_financeiro" as never, {
        p_inicio: inicio,
        p_fim: fim,
      } as never);
      if (error) throw error;
      return data as any;
    },
  });

  const { data: estoqueParado, isError: estoqueParadoErr, isLoading: estoqueParadoLoading } = useQuery({
    queryKey: ["dash-estoque-parado"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_estoque_parado" as any);
      if (error) throw error;
      return data as any;
    },
  });

  const investido = Number(data?.investido ?? 0);
  const pago = Number(data?.pago ?? 0);
  const pendente = Number(data?.pendente ?? 0);
  const chartData = data?.chartData ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DashTabsList />
        <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => printWithImages()}><Printer className="h-4 w-4 mr-1" /> Imprimir</Button>
        <PeriodoPicker value={periodo} onChange={setPeriodo} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_260px]">
        <Kpi label="Investido em MP" value={brl(investido)} icon={DollarSign} tone="info" />
        <Kpi label="Total pago" value={brl(pago)} icon={CheckCircle2} tone="success" />
        <Kpi label="Total pendente" value={brl(pendente)} icon={AlertTriangle} tone="warning" />
        <Card className="p-4 flex flex-col">
          <span className="text-xs font-medium text-muted-foreground mb-1">% pago</span>
          <div className="flex-1 flex items-center justify-center">
            <DashDonut pct={(pago + pendente) > 0 ? Math.round((pago / (pago + pendente)) * 100) : 0} legenda="do total a pagar" />
          </div>
        </Card>
      </div>
      <Card className="p-4">
        <h3 className="font-semibold mb-3">{periodo?.from && periodo?.to ? "Contas a pagar — período" : "Contas a pagar — próximos 6 meses"}</h3>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="mes" />
              <YAxis tickFormatter={(v) => v.toLocaleString("pt-BR")} />
              <Tooltip formatter={(v: any) => brl(Number(v))} />
              <Bar dataKey="total" name="A pagar" fill={CHART_SERIE} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card className="p-4">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
          <h3 className="font-semibold">Estoque em R$ parado <span className="text-sm font-normal text-muted-foreground">· tecido físico não reservado e não usado</span></h3>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
            {estoqueParadoErr ? <span className="text-base font-medium text-destructive">erro ao carregar</span>
              : estoqueParadoLoading ? <span className="text-base font-normal text-muted-foreground">carregando…</span>
              : brl(Number(estoqueParado?.total ?? 0))}
          </div>
        </div>
        {estoqueParadoErr ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-destructive">Não foi possível carregar o estoque parado.</div>
        ) : (
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={estoqueParado?.porArtigo ?? []} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => Number(v).toLocaleString("pt-BR")} />
              <YAxis type="category" dataKey="nome" width={140} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v: any) => brl(Number(v))} />
              <Bar dataKey="valor" name="R$ parado" fill={CHART_SERIE} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Aging de contas a pagar <span className="text-sm font-normal text-muted-foreground">· em aberto, por idade do vencimento</span></h3>
          {/* §R P2: barra HORIZONTAL (faixas no eixo Y, sem inclinar rótulo — resolve a
              legibilidade sofrível no mobile) + rampa sequencial navy (mais novo → mais velho). */}
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={data?.aging ?? []} layout="vertical" margin={{ left: 8, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => (Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : `${v}`)} />
                <YAxis type="category" dataKey="faixa" width={96} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => brl(Number(v))} />
                <Bar dataKey="total" name="A pagar" radius={[0, 4, 4, 0]}>
                  {((data?.aging ?? []) as any[]).map((_: any, i: number) => (
                    <Cell key={i} fill={CHART_SEQ[Math.min(i, CHART_SEQ.length - 1)]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Top fornecedores <span className="text-sm font-normal text-muted-foreground">· por valor no período</span></h3>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={data?.topFornecedores ?? []} layout="vertical" margin={{ right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                {/* números compactos (ex.: "320k") p/ não cortar no eixo em telas estreitas. */}
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => (Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : `${v}`)} />
                <YAxis type="category" dataKey="nome" width={92} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => brl(Number(v))} />
                <Bar dataKey="total" name="Total" fill={CHART_SERIE} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <RelatorioPrint
        titulo="Relatório Financeiro — contas a pagar"
        subtitulo={periodo?.from && periodo?.to ? "Período selecionado" : "Projeção próximos 6 meses"}
        dataStr={new Date().toLocaleDateString("pt-BR")}
        kpis={[
          { label: "Investido em MP", valor: brl(investido) },
          { label: "Total pago", valor: brl(pago), cor: REL_COR_SUCESSO },
          { label: "Total pendente", valor: brl(pendente), cor: REL_COR_ALERTA },
        ]}
        donut={(pago + pendente) > 0 ? { pct: Math.round((pago / (pago + pendente)) * 100), cor: REL_COR_SUCESSO, titulo: "Pago do total", legenda: `${brl(pago)} pago · ${brl(pendente)} pendente` } : undefined}
        secoes={[
          {
            titulo: "Contas a pagar — projeção mensal", icone: "▦",
            grafico: (chartData as any[]).length > 0 ? <PBar data={chartData as any[]} xKey="mes" barKey="total" fmtL={(v) => nfInt(v)} /> : undefined,
            colunas: [{ key: "mes", label: "Mês" }, { key: "total", label: "A pagar", align: "right" }],
            linhas: (chartData as any[]).map((d) => ({ mes: d.mes, total: brl(Number(d.total)) })), zebra: true,
            rodape: `Total projetado: ${brl((chartData as any[]).reduce((s, d) => s + Number(d.total || 0), 0))}`,
          },
          {
            titulo: "Aging — contas em aberto por idade do vencimento", icone: "◷",
            grafico: ((data?.aging ?? []) as any[]).length > 0 ? <PBar data={data?.aging ?? []} xKey="faixa" barKey="total" fmtL={(v) => nfInt(v)} height={170} /> : undefined,
            colunas: [{ key: "faixa", label: "Faixa" }, { key: "total", label: "Valor em aberto", align: "right" }],
            linhas: ((data?.aging ?? []) as any[]).map((a) => ({ faixa: a.faixa, total: brl(Number(a.total)) })), zebra: true,
          },
          {
            titulo: "Top fornecedores no período", icone: "▤",
            grafico: ((data?.topFornecedores ?? []) as any[]).length > 0 ? <PBar data={data?.topFornecedores ?? []} xKey="nome" barKey="total" horizontal height={Math.max(150, ((data?.topFornecedores ?? []) as any[]).length * 26)} fmtL={(v) => nfInt(v)} /> : undefined,
            colunas: [{ key: "nome", label: "Fornecedor" }, { key: "total", label: "Total no período", align: "right" }],
            linhas: ((data?.topFornecedores ?? []) as any[]).map((r) => ({ nome: r.nome ?? "—", total: brl(Number(r.total)) })), zebra: true,
          },
        ]}
      />
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <DashError show={isError} />
    </div>
  );
}

/* ============================ CUSTOS ============================ */

// §R P1 — barra DIVERGENTE da variação previsto×real: abaixo do previsto (economia) = navy
// à ESQUERDA do zero; acima (estouro) = vermelho à DIREITA; ~0 = neutro. Sempre com sinal +
// ícone (nunca só cor). `max` = maior |Δ%| da tabela (piso 10%) p/ escalar as barras juntas.
// Não confirmado em CAD ainda = "—" neutro (não há variação real a comparar).
function DeltaBar({ pct, max, confirmado }: { pct: number | null | undefined; max: number; confirmado?: boolean }) {
  if (!confirmado) {
    return <span className="text-muted-foreground" title="Ainda não confirmado em CAD">—</span>;
  }
  const v = Number(pct ?? 0);
  const acima = v > 0.5, abaixo = v < -0.5; // tolerância p/ "no previsto"
  const mag = Math.min(Math.abs(v), max) / (max || 1); // 0..1
  const w = `${Math.round(mag * 50)}%`; // metade da barra por lado
  const cor = acima ? CHART_DIVERGE_POS : abaixo ? CHART_DIVERGE_NEG : "var(--muted-foreground)";
  const Icon = acima ? ArrowUp : abaixo ? ArrowDown : Minus;
  const label = acima || abaixo ? `${v > 0 ? "+" : ""}${fmtInt(v)}%` : "no previsto";
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="inline-flex items-center justify-end gap-1 text-xs font-medium num" style={{ color: cor, minWidth: 62 }}>
        <Icon className="h-3.5 w-3.5 shrink-0" /> {label}
      </span>
      <div className="relative h-3 w-24 shrink-0 rounded bg-muted/60" aria-hidden>
        <span className="absolute inset-y-0 left-1/2 w-px bg-border" />
        <span className="absolute inset-y-0 rounded" style={{ background: cor, width: w, ...(acima ? { left: "50%" } : { right: "50%" }) }} />
      </div>
    </div>
  );
}

function CustosTab() {
  const fl = useFieldLabels();
  const [periodo, setPeriodo] = useState<Periodo>(undefined);
  const [colecao, setColecao] = useState("all");
  const [categoria, setCategoria] = useState("all");
  const [linha, setLinha] = useState("all");
  const ini = isoDate(periodo?.from), fim = isoDate(periodo?.to);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dash-custos", ini, fim, colecao, categoria, linha],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_custos", {
        p_inicio: ini,
        p_fim: fim,
        p_colecao: colecao === "all" ? undefined : colecao,
        p_categoria: categoria === "all" ? undefined : categoria,
        p_linha: linha === "all" ? undefined : linha,
      });
      if (error) throw error;
      return data as any;
    },
  });

  const rows = data?.rows ?? [];
  // Escala comum das barras de variação (§R): maior |Δ%| confirmado, piso 10% (Δ pequeno
  // não enche a barra) e teto 100% (outlier não achata todas as demais).
  const deltaMax = useMemo(() => {
    const m = Math.max(0, ...(rows as any[]).filter((r) => r.confirmado).map((r) => Math.abs(Number(r.pct ?? 0))));
    return Math.min(100, Math.max(10, m));
  }, [rows]);
  const chartData = data?.chartData ?? [];
  const categorias: Opt[] = data?.filtros?.categorias ?? [];
  const linhas: Opt[] = data?.filtros?.linhas ?? [];
  const colecoes: string[] = data?.filtros?.colecoes ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DashTabsList />
        <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => printWithImages()}><Printer className="h-4 w-4 mr-1" /> Imprimir</Button>
        <PeriodoPicker value={periodo} onChange={setPeriodo} />
        <FilterButton
          filters={[
            { label: "Coleção", value: colecao, onChange: setColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.filter(Boolean).map((c) => ({ id: c, nome: c }))] },
            { label: "Linha", value: linha, onChange: setLinha, options: [{ id: "all", nome: "Todas" }, ...linhas] },
            { label: "Categoria", value: categoria, onChange: setCategoria, options: [{ id: "all", nome: "Todas" }, ...categorias] },
          ]}
        />
      </div>

      <DashError show={isError} />

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Custo previsto vs real</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm card-table">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">{fl("ref")}</th>
                <th className="py-2 pr-3">Modelo</th>
                <th className="py-2 pr-3 text-right">Previsto (un.)</th>
                <th className="py-2 pr-3 text-right">Real (un.)</th>
                <th className="py-2 pr-3 text-right">Δ variação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {r.ref ?? "—"}
                      {r.versao != null && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">v{r.versao}</Badge>}
                    </span>
                  </td>
                  <td className="py-2 pr-3" data-label="Modelo">{r.nome}</td>
                  <td className="py-2 pr-3 text-right" data-label="Previsto (un.)">{brl(r.previsto)}</td>
                  <td className={"py-2 pr-3 text-right " + (r.confirmado ? "" : "text-muted-foreground italic")} title={r.confirmado ? undefined : "Ainda não confirmado em CAD — exibindo o previsto"} data-label="Real (un.)">{brl(r.real)}</td>
                  <td className="py-2 pr-3 text-right" data-label="Δ variação"><DeltaBar pct={r.pct} max={deltaMax} confirmado={r.confirmado} /></td>
                </tr>
              ))}
              {!isLoading && rows.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">Sem dados.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-1">Custo médio por peça por coleção</h3>
        <p className="mb-3 text-xs text-muted-foreground">Só modelos com corte confirmado. Passe o mouse para ver a cobertura (quantos de quantos).</p>
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="colecao" />
              <YAxis tickFormatter={(v) => v.toLocaleString("pt-BR")} />
              <Tooltip
                formatter={(v: any) => brl(Number(v))}
                labelFormatter={(label: any, payload: any) => {
                  const p = payload?.[0]?.payload;
                  return p && p.nTotal != null ? `${label} — média de ${p.nConf}/${p.nTotal} modelo(s)` : label;
                }}
              />
              <Bar dataKey="medio" name="Custo médio" fill={CHART_SERIE} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <RelatorioPrint
        titulo="Relatório de Custos — previsto × real"
        subtitulo="Custo unitário por modelo e custo médio por coleção"
        dataStr={new Date().toLocaleDateString("pt-BR")}
        kpis={[
          { label: "Modelos analisados", valor: String((rows as any[]).length) },
          { label: "Variação média", valor: `${Math.round((rows as any[]).reduce((s, r) => s + (Number(r.pct) || 0), 0) / Math.max((rows as any[]).length, 1))}%` },
          { label: "Acima do previsto", valor: String((rows as any[]).filter((r) => Number(r.pct) > 0).length), cor: REL_COR_PERIGO },
        ]}
        donut={(rows as any[]).length > 0 ? { pct: Math.round(((rows as any[]).filter((r) => Number(r.pct) <= 0).length / (rows as any[]).length) * 100), cor: REL_COR_SUCESSO, titulo: "Dentro do previsto", legenda: `${(rows as any[]).filter((r) => Number(r.pct) <= 0).length} de ${(rows as any[]).length} modelos no custo previsto ou abaixo` } : undefined}
        secoes={[
          {
            titulo: "Custo médio por peça por coleção", icone: "▣",
            grafico: (chartData as any[]).length > 0 ? <PBar data={chartData as any[]} xKey="colecao" barKey="medio" fmtL={(v) => nfInt(v)} /> : undefined,
            colunas: [{ key: "colecao", label: "Coleção" }, { key: "medio", label: "Custo médio / peça", align: "right" }],
            linhas: (chartData as any[]).map((d) => ({ colecao: d.colecao, medio: brl(Number(d.medio)) })), zebra: true,
          },
          {
            titulo: "Custo previsto × real por modelo", icone: "▤",
            descricao: "Custo unitário; diferença positiva = acima do previsto",
            colunas: [
              { key: "ref", label: "Ref" },
              { key: "modelo", label: "Modelo" },
              { key: "previsto", label: "Previsto (un.)", align: "right" },
              { key: "real", label: "Real (un.)", align: "right" },
            ],
            linhas: (rows as any[]).map((r) => ({
              ref: r.ref ?? "—",
              modelo: r.nome ?? "—",
              previsto: brl(Number(r.previsto)),
              real: brl(Number(r.real)),
            })), zebra: true,
          },
        ]}
      />
    </div>
  );
}

/* ============================ COMERCIAL ============================ */

// Poder de venda / margem por Coleção e Linha — POTENCIAL (grade planejada) vs
// REALIZADO (grade real do CQ). Cálculo no FRONT reusando @/lib/preco (fonte ÚNICA
// de preço; não replicar em SQL); sem RPC nova — custo_unitario_modelos (tenant-safe)
// + queries RLS por tenant. Espelha o "poder de venda" do Planejamento/Lançamentos.
type ComRow = { key: string; nome: string; pvPlan: number; lucroPlan: number; pvReal: number; lucroReal: number; margemPlan: number; markupPlan: number; margemReal: number; markupReal: number };

// Nome PRÓPRIO (distinto do `fmtPct` de src/lib/format.ts, 1 casa decimal) — este é
// 0 casas + fallback "—" p/ v<=0, usado só nesta aba Comercial.
const fmtPctComercial = (v: number) => (v > 0 ? `${fmtInt(v)}%` : "—");
const fmtMkp = (v: number) => (v > 0 ? `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—");

// Tabela com DOIS grupos de colunas claramente separados: Planejado (orçamento, grade
// planejada) vs Realizado (feito, grade real). Cor + borda separam as duas contas.
function ComTable({ title, firstLabel, rows }: { title: string; firstLabel: string; rows: ComRow[] }) {
  const s = useSort(rows, { accessors: {
    nome: (r: ComRow) => r.nome,
    pvPlan: (r: ComRow) => r.pvPlan, lucroPlan: (r: ComRow) => r.lucroPlan, margemPlan: (r: ComRow) => r.margemPlan, markupPlan: (r: ComRow) => r.markupPlan,
    pvReal: (r: ComRow) => r.pvReal, lucroReal: (r: ComRow) => r.lucroReal, margemReal: (r: ComRow) => r.margemReal, markupReal: (r: ComRow) => r.markupReal,
  } });
  const plan = "bg-blue-500/5", real = "bg-emerald-500/5";
  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm card-table">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 pr-3"></th>
              <th colSpan={4} className={`py-1 px-2 text-center font-semibold text-blue-600 border-l ${plan}`}>Planejado (orçamento)</th>
              <th colSpan={4} className={`py-1 px-2 text-center font-semibold text-emerald-600 border-l ${real}`}>Realizado (feito)</th>
            </tr>
            <tr className="border-b">
              <SortTh label={firstLabel} sortKey="nome" sortState={s} className="py-2 pr-3" />
              <SortTh label="PV" sortKey="pvPlan" sortState={s} className={`py-2 px-2 text-right border-l ${plan}`} align="right" />
              <SortTh label="Lucro" sortKey="lucroPlan" sortState={s} className={`py-2 px-2 text-right ${plan}`} align="right" />
              <SortTh label="Margem" sortKey="margemPlan" sortState={s} className={`py-2 px-2 text-right ${plan}`} align="right" />
              <SortTh label="Markup" sortKey="markupPlan" sortState={s} className={`py-2 px-2 text-right ${plan}`} align="right" />
              <SortTh label="PV" sortKey="pvReal" sortState={s} className={`py-2 px-2 text-right border-l ${real}`} align="right" />
              <SortTh label="Lucro" sortKey="lucroReal" sortState={s} className={`py-2 px-2 text-right ${real}`} align="right" />
              <SortTh label="Margem" sortKey="margemReal" sortState={s} className={`py-2 px-2 text-right ${real}`} align="right" />
              <SortTh label="Markup" sortKey="markupReal" sortState={s} className={`py-2 px-2 text-right ${real}`} align="right" />
            </tr>
          </thead>
          <tbody>
            {s.sorted.map((r) => (
              <tr key={r.key} className="border-b last:border-0">
                <td className="py-2 pr-3 font-medium">{r.nome}</td>
                <td className={`py-2 px-2 text-right border-l ${plan}`} data-label="Plan · PV">{brl(r.pvPlan)}</td>
                <td className={`py-2 px-2 text-right ${plan}`} data-label="Plan · Lucro">{brl(r.lucroPlan)}</td>
                <td className={`py-2 px-2 text-right ${plan}`} data-label="Plan · Margem">{fmtPctComercial(r.margemPlan)}</td>
                <td className={`py-2 px-2 text-right ${plan}`} data-label="Plan · Markup">{fmtMkp(r.markupPlan)}</td>
                <td className={`py-2 px-2 text-right border-l ${real}`} data-label="Real · PV">{brl(r.pvReal)}</td>
                <td className={`py-2 px-2 text-right ${real}`} data-label="Real · Lucro">{brl(r.lucroReal)}</td>
                <td className={`py-2 px-2 text-right ${real}`} data-label="Real · Margem">{fmtPctComercial(r.margemReal)}</td>
                <td className={`py-2 px-2 text-right ${real}`} data-label="Real · Markup">{fmtMkp(r.markupReal)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-muted-foreground">Sem dados.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function ComercialTab() {
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");
  const [fSemana, setFSemana] = useState("all");
  const [fSubcolecao, setFSubcolecao] = useState("all");
  const [fColecao, setFColecao] = useState("all");

  const { data: meses = [] } = useQuery({ queryKey: ["opt", "meses"], queryFn: async () => (await supabase.from("meses").select("id, nome:mes").order("ordem")).data ?? [] });
  const { data: anos = [] } = useQuery({ queryKey: ["opt", "anos"], queryFn: async () => (await supabase.from("anos").select("id, nome:ano").order("ano")).data ?? [] });
  const { data: opts = { colecoes: [] as string[], subcolecoes: [] as string[] } } = useQuery({
    queryKey: ["comercial-opts"],
    queryFn: async () => {
      const { data } = await supabase.from("modelos").select("colecao, subcolecao");
      return {
        colecoes: Array.from(new Set((data ?? []).map((m: any) => m.colecao).filter(Boolean))).sort() as string[],
        subcolecoes: Array.from(new Set((data ?? []).map((m: any) => m.subcolecao).filter(Boolean))).sort() as string[],
      };
    },
  });

  const { data: modelos = [], isLoading, isError } = useQuery({
    queryKey: ["comercial-modelos", fMes, fAno, fSemana, fSubcolecao, fColecao],
    queryFn: async () => {
      let q = supabase.from("modelos").select("id, colecao, linha_id, preco_venda, linha:linha_id(nome, markup)");
      if (fMes !== "all") q = q.eq("mes_id", fMes);
      if (fAno !== "all") q = q.eq("ano_id", fAno);
      if (fSemana !== "all") q = q.eq("semana", fSemana);
      if (fSubcolecao !== "all") q = q.eq("subcolecao", fSubcolecao);
      if (fColecao !== "all") q = q.eq("colecao", fColecao);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const ids = useMemo(() => modelos.map((m) => m.id).sort(), [modelos]);

  const { data: custoMap = {} } = useQuery({
    queryKey: ["comercial-custo", ids], enabled: ids.length > 0,
    queryFn: async () => (await supabase.rpc("custo_unitario_modelos" as any, { _ids: ids })).data ?? {},
  });
  const { data: gradePlan = {} } = useQuery({
    queryKey: ["comercial-grade-plan", ids], enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("modelo_grades").select("modelo_id, grade_total").in("modelo_id", ids);
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { m[r.modelo_id] = (m[r.modelo_id] ?? 0) + Number(r.grade_total ?? 0); });
      return m;
    },
  });
  const { data: gradeReal = {} } = useQuery({
    queryKey: ["comercial-grade-real", ids], enabled: ids.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("cad").select("modelo_id, cad_grades(grade_total_real)").in("modelo_id", ids);
      const m: Record<string, number> = {};
      (data ?? []).forEach((c: any) => {
        const soma = (c.cad_grades ?? []).reduce((sum: number, g: any) => sum + Number(g.grade_total_real ?? 0), 0);
        m[c.modelo_id] = (m[c.modelo_id] ?? 0) + soma;
      });
      return m;
    },
  });

  const { byColecao, byLinha, tot } = useMemo(() => {
    const acc = (map: Map<string, ComRow>, key: string, nome: string, m: any) => {
      const cu = (custoMap as any)[m.id];
      const custo = Number(cu?.real) || Number(cu?.previsto) || 0;
      const pi = precoInfo(custo, m.linha?.markup, m.preco_venda);
      const gp = Number((gradePlan as any)[m.id]) || 0;
      const gr = Number((gradeReal as any)[m.id]) || 0;
      let r = map.get(key);
      if (!r) { r = { key, nome, pvPlan: 0, lucroPlan: 0, pvReal: 0, lucroReal: 0, margemPlan: 0, markupPlan: 0, margemReal: 0, markupReal: 0 }; map.set(key, r); }
      r.pvPlan += pi.efetivo * gp; r.lucroPlan += (pi.efetivo - custo) * gp;
      r.pvReal += pi.efetivo * gr; r.lucroReal += (pi.efetivo - custo) * gr;
    };
    // margem% = lucro/PV; markup = PV/custo, e custo = PV − lucro.
    const derive = (r: ComRow): ComRow => {
      const custoPlan = r.pvPlan - r.lucroPlan, custoReal = r.pvReal - r.lucroReal;
      return { ...r,
        margemPlan: r.pvPlan > 0 ? (r.lucroPlan / r.pvPlan) * 100 : 0,
        markupPlan: custoPlan > 0 ? r.pvPlan / custoPlan : 0,
        margemReal: r.pvReal > 0 ? (r.lucroReal / r.pvReal) * 100 : 0,
        markupReal: custoReal > 0 ? r.pvReal / custoReal : 0,
      };
    };
    const mc = new Map<string, ComRow>(), ml = new Map<string, ComRow>();
    for (const m of modelos) {
      acc(mc, m.colecao ?? "__none__", m.colecao || "Sem coleção", m);
      acc(ml, m.linha_id ?? "__none__", (m.linha?.nome as string) || "Sem linha", m);
    }
    const finish = (map: Map<string, ComRow>) => Array.from(map.values()).map(derive).sort((a, b) => b.pvPlan - a.pvPlan);
    const bc = finish(mc), bl = finish(ml);
    const t0 = bc.reduce((a, r) => ({ pvPlan: a.pvPlan + r.pvPlan, lucroPlan: a.lucroPlan + r.lucroPlan, pvReal: a.pvReal + r.pvReal, lucroReal: a.lucroReal + r.lucroReal }), { pvPlan: 0, lucroPlan: 0, pvReal: 0, lucroReal: 0 });
    const tot = derive({ key: "", nome: "", ...t0, margemPlan: 0, markupPlan: 0, margemReal: 0, markupReal: 0 });
    return { byColecao: bc, byLinha: bl, tot };
  }, [modelos, custoMap, gradePlan, gradeReal]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DashTabsList />
        <FilterButton
          filters={[
            { label: "Coleção", value: fColecao, onChange: setFColecao, options: [{ id: "all", nome: "Todas" }, ...opts.colecoes.map((c) => ({ id: c, nome: c }))] },
            { label: "Subcoleção", value: fSubcolecao, onChange: setFSubcolecao, options: [{ id: "all", nome: "Todas" }, ...opts.subcolecoes.map((c) => ({ id: c, nome: c }))] },
            { label: "Mês", value: fMes, onChange: setFMes, options: [{ id: "all", nome: "Todos" }, ...(meses as any[]).map((m) => ({ id: m.id, nome: m.nome }))] },
            { label: "Ano", value: fAno, onChange: setFAno, options: [{ id: "all", nome: "Todos" }, ...(anos as any[]).map((a) => ({ id: a.id, nome: a.nome }))] },
            { label: "Lançamento nº", value: fSemana, onChange: setFSemana, options: [{ id: "all", nome: "Todas" }, ...["1", "2", "3", "4", "5"].map((n) => ({ id: n, nome: n }))] },
          ]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Poder de venda" value={brl(tot.pvPlan)} icon={Tag} sub={`realizado ${brl(tot.pvReal)}`} />
        <Kpi label="Lucro bruto" value={brl(tot.lucroPlan)} icon={DollarSign} sub={`realizado ${brl(tot.lucroReal)}`} />
        <Kpi label="Margem média" value={fmtPctComercial(tot.margemPlan)} icon={Sparkles} sub={`realizado ${fmtPctComercial(tot.margemReal)}`} />
        <Kpi label="Markup médio" value={fmtMkp(tot.markupPlan)} icon={Layers} sub={`realizado ${fmtMkp(tot.markupReal)}`} />
      </div>

      <ComTable title="Por coleção" firstLabel="Coleção" rows={byColecao} />
      <ComTable title="Por linha" firstLabel="Linha" rows={byLinha} />

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <DashError show={isError} />
    </div>
  );
}

/* ============================ LEADTIME ============================ */

// Leadtime: duração média REAL por etapa vs o tempo IDEAL (config da loja, senão
// default). Etapas MACRO (marcos existentes) + Desenvolvimento destrinchado por COLUNA
// do kanban (modelo_kanban_historico). RPC dashboard_leadtime (só exibe).
// Estado de uma etapa (bullet/hero): ok ≤ meta · atenção ≤ 1,5× · atrasado > 1,5× (ou, na etapa
// de SLA por item, por faixas de % no prazo). Devolve o tom §Q9 + o ícone (R3 — nunca só cor).
function etapaEstado(e: any): { estado: "ok" | "watch" | "late"; cor: string; Icon: any } {
  const ideal = Number(e.idealDias) || 0;
  const media = Number(e.duracaoMedia) || 0;
  const sla = !!e.slaCol;
  const ratio = ideal > 0 ? media / ideal : 0;
  const estado: "ok" | "watch" | "late" = sla
    ? Number(e.pctNoPrazo) >= 100 ? "ok" : Number(e.pctNoPrazo) >= 60 ? "watch" : "late"
    : ideal <= 0 || media <= ideal ? "ok" : ratio <= 1.5 ? "watch" : "late";
  const cor = estado === "ok" ? "var(--success)" : estado === "watch" ? "var(--warning)" : "var(--destructive)";
  const Icon = estado === "ok" ? Check : estado === "watch" ? AlertTriangle : X;
  return { estado, cor, Icon };
}

// Bullet graph (§R R7): barra = duração REAL, tique = meta (ideal), faixas ok/atenção/atrasado ao
// fundo. A barra ULTRAPASSA a meta — a escala do grupo (`scaleMax`) cobre o pior caso, então nada
// satura em 100% e o gargalo salta. Substitui a parede de cards de média.
function BulletRow({ label, e, scaleMax }: { label: string; e: any; scaleMax: number }) {
  const ideal = Number(e.idealDias) || 0;
  const media = Number(e.duracaoMedia) || 0;
  const sla = !!e.slaCol;
  const ratio = ideal > 0 ? media / ideal : 0;
  const over = ideal > 0 && media > ideal;
  const pct = (x: number) => Math.max(0, Math.min(100, (x / scaleMax) * 100));
  const okEnd = ideal > 0 ? pct(ideal) : 0;
  const watchEnd = ideal > 0 ? pct(ideal * 1.5) : 0;
  const { cor, Icon } = etapaEstado(e);
  const bandas = ideal > 0
    ? `linear-gradient(90deg, var(--tone-success-bg) 0 ${okEnd}%, var(--tone-warning-bg) ${okEnd}% ${watchEnd}%, var(--tone-danger-bg) ${watchEnd}% 100%)`
    : "var(--muted)";
  return (
    <div className="grid grid-cols-1 items-center gap-x-3 gap-y-1 py-1.5 sm:grid-cols-[minmax(120px,190px)_1fr_minmax(104px,auto)]">
      <div className={"truncate text-sm " + (over ? "font-semibold" : "font-medium")} title={label}>{label}</div>
      <div className="relative h-5 overflow-hidden rounded border" style={{ background: bandas }}>
        <div
          className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-r"
          style={{ width: `${pct(media)}%`, background: over ? "var(--destructive)" : CHART_SERIE }}
        />
        {ideal > 0 && (
          <div className="absolute bottom-0.5 top-0.5 w-0.5" style={{ left: `${pct(ideal)}%`, background: "var(--foreground)", opacity: 0.7 }} />
        )}
      </div>
      <div className="text-right tabular-nums">
        <span className="text-sm font-bold" style={over ? { color: cor } : undefined}>{fmtNum(media)}d</span>
        <span className="block text-[11px] font-semibold" style={{ color: cor }}>
          <Icon className="mr-0.5 inline h-3 w-3 align-[-1px]" aria-hidden />
          {sla ? `${e.pctNoPrazo}% no prazo` : ideal > 0 ? `${e.pctNoPrazo}% · ${fmtNum(ratio)}×` : `${e.nModelos} mod.`}
        </span>
      </div>
    </div>
  );
}

// Uma seção de bullets (Planejamento / Desenvolvimento / Produção), ordenada do PIOR pro melhor
// (maior razão real/meta em cima). Escala do eixo compartilhada pelo grupo (barras comparáveis).
function BulletSection({ icon, titulo, etapas, labelDe }: { icon: any; titulo: string; etapas: any[]; labelDe: (e: any) => string }) {
  if (etapas.length === 0) return null;
  const badness = (e: any) => {
    const ideal = Number(e.idealDias) || 0;
    if (e.slaCol) return (100 - (Number(e.pctNoPrazo) || 0)) / 100;
    return ideal > 0 ? (Number(e.duracaoMedia) || 0) / ideal : 0;
  };
  const ord = [...etapas].sort((a, b) => badness(b) - badness(a));
  const scaleMax = bulletScaleMax(
    ord.map((e) => Number(e.duracaoMedia) || 0),
    ord.map((e) => Number(e.idealDias) || 0),
  );
  return (
    <div>
      <SecHeader icon={icon}>{titulo}</SecHeader>
      <Card className="p-4">
        {ord.map((e) => <BulletRow key={e.etapa} label={labelDe(e)} e={e} scaleMax={scaleMax} />)}
      </Card>
    </div>
  );
}

// Hero ponta-a-ponta (§R R8): número-título + contexto (desvio vs meta, nº de modelos, gargalo,
// fração dentro da meta). Números pt-BR (.num), setas/ícones reforçam a direção.
function LeadtimeHero({ hero, gargalo, filtroTxt }: { hero: HeroStats; gargalo: any; filtroTxt: string }) {
  const acima = hero.delta > 0.05;
  const abaixo = hero.delta < -0.05;
  const corDesvio = acima ? "var(--destructive)" : abaixo ? "var(--success)" : "var(--muted-foreground)";
  const SetaDesvio = acima ? ArrowUp : abaixo ? ArrowDown : Minus;
  const gOver = gargalo && gargalo.ratio > 1;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Card className="p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">Lead time médio ponta a ponta</span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--tone-info-bg)", color: "var(--tone-info-fg)" }}><Timer className="h-4 w-4" /></span>
        </div>
        <div className="mt-2 text-3xl font-bold leading-none tabular-nums">{hero.n ? fmtNum(hero.mediaTotal) : "—"} <span className="text-base font-semibold text-muted-foreground">dias</span></div>
        {hero.n > 0 && (
          <p className="mt-1.5 text-xs font-semibold" style={{ color: corDesvio }}>
            <SetaDesvio className="mr-0.5 inline h-3 w-3 align-[-1px]" aria-hidden />
            {acima ? `+${fmtNum(hero.delta)}d` : abaixo ? `−${fmtNum(-hero.delta)}d` : "no alvo"} vs meta {fmtNum(hero.mediaMeta)}d
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hero.n} modelo(s) · {filtroTxt}</p>
      </Card>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">Maior gargalo</span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: gOver ? "var(--tone-danger-bg)" : "var(--tone-neutral-bg)", color: gOver ? "var(--tone-danger-fg)" : "var(--tone-neutral-fg)" }}><Gauge className="h-4 w-4" /></span>
        </div>
        {gargalo ? (
          <>
            <div className="mt-2 truncate text-xl font-bold leading-tight" title={gargalo.label}>{gargalo.label}</div>
            <p className="mt-1.5 text-xs font-semibold" style={{ color: gOver ? "var(--destructive)" : "var(--success)" }}>
              {gOver ? <ArrowUp className="mr-0.5 inline h-3 w-3 align-[-1px]" aria-hidden /> : <Check className="mr-0.5 inline h-3 w-3 align-[-1px]" aria-hidden />}
              {fmtNum(gargalo.media)}d · {fmtNum(gargalo.ratio)}× a meta ({fmtNum(gargalo.ideal)}d)
            </p>
          </>
        ) : (
          <div className="mt-2 text-xl font-bold text-muted-foreground">—</div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">Dentro da meta ponta a ponta</span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--tone-success-bg)", color: "var(--tone-success-fg)" }}><CheckCircle2 className="h-4 w-4" /></span>
        </div>
        <div className="mt-2 text-3xl font-bold leading-none tabular-nums">{hero.n ? hero.pctDentro : "—"}<span className="text-base font-semibold text-muted-foreground">%</span></div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">{hero.dentroMeta} de {hero.n} modelo(s) ≤ meta</p>
      </Card>
    </div>
  );
}

function LeadtimeTab() {
  // Filtro GLOBAL do Leadtime: move os cards (médias) E a tabela (detalhamento) juntos.
  const [colecao, setColecao] = useState("all");
  const [subcol, setSubcol] = useState("all");
  const [semana, setSemana] = useState("all");

  // skeleton = quais etapas + ideal/label/ordem (config); det = itens (dados por modelo).
  const skel = useQuery({
    queryKey: ["dash-leadtime"],
    queryFn: async () => { const { data, error } = await supabase.rpc("dashboard_leadtime" as never); if (error) throw error; return data as any; },
  });
  const det = useQuery({
    queryKey: ["dash-leadtime-itens"],
    queryFn: async () => { const { data, error } = await supabase.rpc("dashboard_leadtime_itens" as never); if (error) throw error; return data as any; },
  });
  // Categorias de serviço (id→nome/ativo/ordem) p/ rotular as sub-colunas de Serviços do heatmap
  // (o esqueleto só traz `servico_cat` QUANDO configurado; aqui vêm todas, RLS por tenant).
  const cats = useQuery({
    queryKey: ["leadtime-categorias-terceirizado"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("categorias_terceirizado") as any)
        .select("id, nome, ativo, ordem").order("ordem").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; ativo: boolean; ordem: number }[];
    },
  });
  const etapas: any[] = skel.data?.etapas ?? [];
  const itens: any[] = det.data?.itens ?? [];
  const slaServico: string | null = det.data?.slaServico ?? null;

  const uniq = (vals: any[]) => Array.from(new Set(vals.filter((v) => v != null && v !== ""))).sort();
  const colecoes = uniq(itens.map((i) => i.colecao));
  const subcols = uniq(itens.map((i) => i.subcolecao));
  const semanas = uniq(itens.map((i) => i.semana));
  const filtItens = itens.filter(
    (i) =>
      (colecao === "all" || (i.colecao ?? "") === colecao) &&
      (subcol === "all" || (i.subcolecao ?? "") === subcol) &&
      (semana === "all" || (i.semana ?? "") === semana),
  );

  // Stats por etapa RECOMPUTADOS dos itens filtrados (cards movem com o filtro). Na etapa
  // do SLA, o prazo por item vem do SLA da Subcategoria (sub1_sla).
  const statOf = (etapaKey: string, idealFixo: number) => {
    let s = 0, n = 0, ok = 0, fora = 0;
    for (const it of filtItens) {
      const d = it.duracoes?.[etapaKey];
      if (d == null) continue;
      n++; s += Number(d);
      const ideal = etapaKey === slaServico && it.sub1_sla != null ? Number(it.sub1_sla) : idealFixo;
      if (ideal <= 0 || Number(d) <= ideal) ok++; else fora++;
    }
    return { duracaoMedia: n ? Math.round((s / n) * 10) / 10 : 0, nModelos: n, foraSla: fora, pctNoPrazo: n ? Math.round((100 * ok) / n) : 0 };
  };
  const withStats = (e: any) => ({ ...e, ...statOf(e.etapa, Number(e.idealDias) || 0), slaCol: e.etapa === slaServico });

  // Ordem do fluxo (kanban pela ordem de status_kanban; produção fixa; serviços-micro no slot de Serviços).
  const kanbanCols = normalizeKanbanStatuses(skel.data?.kanbanOrder);
  const kanbanIdx = new Map(kanbanCols.map((s, i) => ["kanban:" + s.key, i] as const));
  const ordKb = (k: string) => (kanbanIdx.has(k) ? kanbanIdx.get(k)! : 999);
  // Rótulo de uma coluna do kanban = o label EXATO do board (status_kanban) — NUNCA um
  // title-case programático, que corrompe acento e conector ("Corte de Piloto I"→"Corte De
  // Piloto I", "Desenho Técnico"→"Desenho TéCnico", "Aprovação"→"AprovaçãO"). Órfã (status
  // fora do board atual) cai no label canônico do DEFAULT_STATUSES; em último caso o valor
  // cru — sem reformatar.
  const kanbanLabelByKey = new Map<string, string>();
  for (const s of kanbanCols) kanbanLabelByKey.set(s.key, s.label);
  for (const s of DEFAULT_STATUSES) if (!kanbanLabelByKey.has(s.key)) kanbanLabelByKey.set(s.key, s.label);
  const kanbanLabel = (etapaOrKey: string) => {
    const key = etapaOrKey.startsWith("kanban:") ? etapaOrKey.slice("kanban:".length) : etapaOrKey;
    return kanbanLabelByKey.get(key) ?? key;
  };
  const PROD_ORDER = ["cad_corte", "servicos", "cq", "direcionamento", "lancamento"];
  const ordProd = (e: any) =>
    String(e.etapa).startsWith("servico_cat:")
      ? 1 + (Number(e.sub) || 0) / 1000
      : (PROD_ORDER.indexOf(e.etapa) < 0 ? 999 : PROD_ORDER.indexOf(e.etapa));
  const planejamento = etapas.filter((e) => e.etapa === "planejamento").map(withStats);
  const kanban = etapas.filter((e) => e.tipo === "kanban").sort((a, b) => ordKb(a.etapa) - ordKb(b.etapa)).map(withStats);
  const macro = etapas
    .filter((e) => (e.tipo === "macro" && e.etapa !== "planejamento") || e.tipo === "servico")
    .sort((a, b) => ordProd(a) - ordProd(b)).map(withStats);

  const isLoading = skel.isLoading || det.isLoading;
  const isError = skel.isError || det.isError;

  // Hero ponta-a-ponta e gargalo derivam dos MESMOS itens filtrados. `lookup` = ideal por etapa
  // (config da loja; default por tipo p/ chaves históricas fora do board).
  const lookup = idealLookup(etapas);
  const hero = heroStats(filtItens, lookup, slaServico);
  // Gargalo = pior razão real/meta entre as etapas CONFIGURADAS (as dos bullets), preferindo as com
  // massa (≥3 modelos) p/ um outlier de 1 modelo não dominar. Exclui a etapa de SLA (sem ideal único).
  const bulletsAll = [...planejamento, ...kanban, ...macro].filter((e) => !e.slaCol && (Number(e.idealDias) || 0) > 0);
  const gargaloDe = (arr: any[]) =>
    arr.reduce<any>((best, e) => {
      const ratio = (Number(e.duracaoMedia) || 0) / (Number(e.idealDias) || 1);
      if (best && best.ratio >= ratio) return best;
      return { label: e.tipo === "kanban" ? kanbanLabel(e.etapa) : e.label, media: Number(e.duracaoMedia) || 0, ideal: Number(e.idealDias) || 0, ratio };
    }, null);
  const gargalo = gargaloDe(bulletsAll.filter((e) => (Number(e.nModelos) || 0) >= 3)) ?? gargaloDe(bulletsAll);
  const filtroTxt = [
    colecao === "all" ? "todas as coleções" : colecao,
    subcol === "all" ? null : subcol,
    semana === "all" ? null : "Lan " + semana,
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DashTabsList />
        <FilterButton
          screen="leadtime"
          filters={[
            { label: "Coleção", value: colecao, onChange: setColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.map((c) => ({ id: String(c), nome: String(c) }))] },
            { label: "Subcoleção", value: subcol, onChange: setSubcol, options: [{ id: "all", nome: "Todas" }, ...subcols.map((c) => ({ id: String(c), nome: String(c) }))] },
            { label: "Lançamento nº", value: semana, onChange: setSemana, options: [{ id: "all", nome: "Todas" }, ...semanas.map((c) => ({ id: String(c), nome: "Lan " + c }))] },
          ]}
        />
      </div>

      {/* Hero: a mensagem primeiro (§R R8) — total ponta-a-ponta, gargalo, % dentro da meta. */}
      {etapas.length > 0 && <LeadtimeHero hero={hero} gargalo={gargalo} filtroTxt={filtroTxt} />}

      {/* Onde o tempo é gasto — bullets por etapa (§R R7), do pior pro melhor. Ordem de fluxo:
          Planejamento → Desenvolvimento (kanban) → Produção (marcos). */}
      <BulletSection icon={ClipboardCheck} titulo="Planejamento" etapas={planejamento} labelDe={(e) => e.label} />
      <BulletSection icon={Palette} titulo="Desenvolvimento · por coluna do kanban" etapas={kanban} labelDe={(e) => kanbanLabel(e.etapa)} />
      <BulletSection icon={Factory} titulo="Produção" etapas={macro} labelDe={(e) => e.label} />

      {etapas.length > 0 && <LeadtimeHeatmap itens={filtItens} lookup={lookup} slaServico={slaServico} kanbanOrder={skel.data?.kanbanOrder} categorias={cats.data ?? []} />}

      {!isLoading && etapas.length === 0 && (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          Sem dados de leadtime ainda. As etapas populam conforme os modelos avançam no fluxo.
        </p>
      )}
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <DashError show={isError} />
    </div>
  );
}

// Célula AGREGADA de uma fase (rampa real/meta + ▲). Reusada na fase RECOLHIDA e no "Total" de um
// grupo EXPANDIDO (que é a soma das sub-colunas — a invariante Σ sub ≡ agregado, visível na tela).
function FaseAggCell({ fase, label, edge, strong, groupEnd }: { fase: FaseTotais | undefined; label: string; edge?: boolean; strong?: boolean; groupEnd?: boolean }) {
  const cls = "py-2 px-2 text-center align-middle" + (edge ? (strong ? " border-l-2" : " border-l") : "") + (groupEnd ? " border-r-2" : "");
  if (!fase) return <td className={cls + " text-muted-foreground/50"}>—</td>;
  const ratio = fase.meta > 0 ? fase.valor / fase.meta : 0;
  const idx = seqIndexRatio(ratio);
  const over = ratio > 1;
  return (
    <td className={cls}>
      <span
        className="inline-flex min-w-[36px] items-center justify-center gap-0.5 rounded px-2 py-0.5 text-xs font-semibold tabular-nums"
        style={{ background: CHART_SEQ[idx], color: seqTextToken(idx) }}
        title={`${label}: ${fmtNum(fase.valor)}d · meta ${fmtNum(fase.meta)}d · ${fmtNum(ratio)}×`}
      >
        {fmtInt(fase.valor)}
        {over && <span aria-hidden>▲</span>}
      </span>
    </td>
  );
}

// Célula de SUB-coluna (status do kanban / categoria de serviço). MESMA rampa da agregada QUANDO a
// sub-etapa tem meta na config (R2); sem meta configurada = NEUTRA (valor sem cor de razão — não
// inventa ideal, R3/honestidade). Sem dado no item = "—" (não zera à toa). `edge` = borda-esquerda
// que delimita o início do grupo expandido.
function SubCell({ valor, meta, label, edge, strong }: { valor: number | undefined; meta: number | null; label: string; edge?: boolean; strong?: boolean }) {
  const cls = "py-2 px-2 text-center align-middle" + (edge ? (strong ? " border-l-2" : " border-l") : "");
  if (valor == null) return <td className={cls + " text-muted-foreground/50"}>—</td>;
  if (meta == null) {
    return (
      <td className={cls}>
        <span
          className="inline-flex min-w-[36px] items-center justify-center rounded bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground"
          title={`${label}: ${fmtNum(valor)}d · sem meta na config`}
        >
          {fmtInt(valor)}
        </span>
      </td>
    );
  }
  const ratio = meta > 0 ? valor / meta : 0;
  const idx = seqIndexRatio(ratio);
  const over = ratio > 1;
  return (
    <td className={cls}>
      <span
        className="inline-flex min-w-[36px] items-center justify-center gap-0.5 rounded px-2 py-0.5 text-xs font-semibold tabular-nums"
        style={{ background: CHART_SEQ[idx], color: seqTextToken(idx) }}
        title={`${label}: ${fmtNum(valor)}d · meta ${fmtNum(meta)}d · ${fmtNum(ratio)}×`}
      >
        {fmtInt(valor)}
        {over && <span aria-hidden>▲</span>}
      </span>
    </td>
  );
}

// Tracking INDIVIDUAL: HEATMAP item × 6 FASES (o DETALHAMENTO). As ~18 etapas colapsam em 6 fases
// (o kanban inteiro vira "Desenvolvimento" total — inclui status históricos fora do board, ex.
// "aprovado"). Célula = razão real/meta acumulada da fase por RAMPA sequencial navy (§R R2), com
// ▲ nos atrasados (R3 — nunca só cor). Linhas ordenadas pelo maior lead time; coluna Total com
// barra de dado. **Cabeçalho CONGELADO** (sticky top) + coluna Item sticky-left (canto double-sticky)
// e **grupos Desenvolvimento/Serviços EXPANSÍVEIS** em sub-colunas (chevron). Rola nos 2 eixos no
// próprio container (nunca a página).
function LeadtimeHeatmap({ itens, lookup, slaServico, kanbanOrder, categorias }: {
  itens: any[]; lookup: Map<string, number>; slaServico: string | null;
  kanbanOrder: any; categorias: { id: string; nome: string; ativo: boolean; ordem: number }[];
}) {
  // Estado da expansão POR SESSÃO (useState — reinicia ao recarregar; default RECOLHIDO).
  const [expand, setExpand] = useState<{ desenvolvimento: boolean; servicos: boolean }>({ desenvolvimento: false, servicos: false });
  const toggle = (g: "desenvolvimento" | "servicos") => setExpand((e) => ({ ...e, [g]: !e[g] }));

  // Altura REAL da 1ª linha do cabeçalho (não "chutar" h-9): a 2ª linha (sub-headers) gruda
  // exatamente embaixo dela via `top: row1H`. Medido no layout + ResizeObserver (reage a
  // expandir/recolher, zoom, wrap). Sem isso, sub-header desalinha se a linha 1 não tem 36px.
  const head1Ref = useRef<HTMLTableRowElement>(null);
  const [row1H, setRow1H] = useState(36);

  const rows = itens
    .map((it) => ({ it, ...itemTotais(it, lookup, slaServico) }))
    .sort((a, b) => b.total - a.total); // pior (maior lead time) primeiro
  const maxTotal = Math.max(1, ...rows.map((r) => r.total));

  // Sub-colunas de Desenvolvimento = TODO status do board na ORDEM (mesmo sem dado); status
  // histórico FORA do board (ex. "aprovado") cai em "Outros" (Σ preservada).
  const devCols = normalizeKanbanStatuses(kanbanOrder).map((s) => ({
    key: "kanban:" + s.key, label: s.label, meta: metaConfig("kanban:" + s.key, lookup),
  }));
  const devKeys = devCols.map((c) => c.key);
  const devOutros = rows.some((r) => splitFaseSub(r.it, "desenvolvimento", devKeys).outros > 1e-9);

  // Sub-colunas de Serviços = categoria ATIVA com dado no filtro (ordem do cadastro); cad_corte, o
  // macro "servicos" e categoria inativa/desconhecida caem em "Outros".
  const catById = new Map(categorias.map((c) => [c.id, c]));
  const servPresent = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.it?.duracoes ?? {})) if (k.startsWith("servico_cat:")) servPresent.add(k);
  const servCols = [...servPresent]
    .map((k) => ({ k, cat: catById.get(k.slice("servico_cat:".length)) }))
    .filter((x): x is { k: string; cat: { id: string; nome: string; ativo: boolean; ordem: number } } => !!x.cat && x.cat.ativo)
    .sort((a, b) => (a.cat.ordem - b.cat.ordem) || a.cat.nome.localeCompare(b.cat.nome))
    .map((x) => ({ key: x.k, label: x.cat.nome, meta: metaConfig(x.k, lookup) }));
  const servKeys = servCols.map((c) => c.key);
  const servOutros = rows.some((r) => splitFaseSub(r.it, "servicos", servKeys).outros > 1e-9);

  const anyExpanded = expand.desenvolvimento || expand.servicos;
  // nº de leaf-colunas de um grupo expandido = sub-colunas + Outros? + Total.
  const devLeafN = devCols.length + (devOutros ? 1 : 0) + 1;
  const servLeafN = servCols.length + (servOutros ? 1 : 0) + 1;
  const leafTotal =
    1 + // Item
    (expand.desenvolvimento ? devLeafN : 1) + // Desenvolvimento
    (expand.servicos ? servLeafN : 1) + // Serviços
    4 + // Planejamento + CQ + Direcionamento + Lançamento
    1; // Total (lead time)

  useLayoutEffect(() => {
    const el = head1Ref.current;
    if (!el) return;
    const measure = () => setRow1H(Math.round(el.getBoundingClientRect().height));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [anyExpanded, expand.desenvolvimento, expand.servicos, devCols.length, servCols.length, devOutros, servOutros]);

  const rspan = anyExpanded ? 2 : 1;
  // Camadas de z: canto Item (sticky left+top) fica ACIMA de tudo (z-40) p/ nada vazar por
  // baixo dele ao rolar nos 2 eixos; demais headers z-20; coluna Item do CORPO z-10 (acima
  // das células, abaixo do header); células comuns do corpo ficam no z base. Todo header e a
  // coluna Item são bg OPACO (bg-card) — a opacidade é o que impede o "vazamento".
  const cornerCell = "sticky left-0 top-0 z-40 bg-card whitespace-nowrap py-2 px-3 border-r align-middle";
  const topCell = "sticky top-0 z-20 bg-card whitespace-nowrap py-2 px-2 text-center text-xs align-middle";
  // Header de GRUPO expandido (colSpan): título centrado + borda vertical forte dos 2 lados
  // p/ delimitar o bloco (o dono: "não dá pra entender o que é o que").
  const groupHeadCell = "sticky top-0 z-20 bg-card h-9 whitespace-nowrap py-2 px-2 text-center text-xs font-semibold text-foreground border-l-2 border-r-2";
  // Sub-header (linha 2): gruda em `top: row1H` (medido), bg opaco p/ o corpo passar por baixo limpo.
  const subHeadCell = "sticky z-20 bg-card whitespace-nowrap py-1.5 px-2 text-center text-[11px] font-medium";
  const subTop = { top: row1H };

  const GroupToggle = ({ g, label }: { g: "desenvolvimento" | "servicos"; label: string }) => (
    <button
      type="button"
      onClick={() => toggle(g)}
      aria-expanded={expand[g]}
      className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      title={expand[g] ? "Recolher sub-etapas" : "Expandir em sub-etapas"}
    >
      {expand[g] ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <SecHeader icon={ClipboardCheck}>Detalhamento por item</SecHeader>
      <p className="-mt-1 text-xs text-muted-foreground">
        18 etapas colapsadas em 6 fases (o kanban vira "Desenvolvimento" total). Cor = razão real/meta
        acumulada da fase (mais intenso = mais acima da meta); <span aria-hidden>▲</span> = acima da meta.
        Ordenado pelo maior lead time. Toque no <span aria-hidden>▸</span> em <strong>Desenvolvimento</strong> ou
        {" "}<strong>Serviços</strong> para destrinchar em sub-colunas (a soma fecha na coluna <strong>Total</strong> do grupo).
      </p>
      {/* Legenda da rampa (sequencial = magnitude) + o marcador de atraso (R5). */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>dentro da meta</span>
        {CHART_SEQ.map((c, i) => (
          <span key={i} className="inline-block h-3 w-5 rounded-sm border" style={{ background: c }} aria-hidden />
        ))}
        <span>acima →</span>
        <span className="ml-1"><span aria-hidden>▲</span> acima da meta · — não atingida · sub-etapa sem meta = neutra</span>
      </div>
      <Card className="p-0 overflow-hidden">
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr ref={head1Ref} className="border-b">
                <th rowSpan={rspan} className={cornerCell}>Item</th>
                <th rowSpan={rspan} className={topCell}>Planej.</th>
                {expand.desenvolvimento ? (
                  <th colSpan={devLeafN} className={groupHeadCell}><GroupToggle g="desenvolvimento" label="Desenvolvimento" /></th>
                ) : (
                  <th rowSpan={rspan} className={topCell}><GroupToggle g="desenvolvimento" label="Desenv." /></th>
                )}
                {expand.servicos ? (
                  <th colSpan={servLeafN} className={groupHeadCell}><GroupToggle g="servicos" label="Serviços" /></th>
                ) : (
                  <th rowSpan={rspan} className={topCell}><GroupToggle g="servicos" label="Serviços" /></th>
                )}
                <th rowSpan={rspan} className={topCell}>CQ</th>
                <th rowSpan={rspan} className={topCell}>Direc.</th>
                <th rowSpan={rspan} className={topCell}>Lançam.</th>
                <th rowSpan={rspan} className="sticky top-0 z-20 whitespace-nowrap bg-card py-2 px-3 text-right text-xs align-middle">
                  Total
                  <span className="block font-normal text-[10px] text-muted-foreground/70">lead time</span>
                </th>
              </tr>
              {anyExpanded && (
                <tr className="border-b">
                  {expand.desenvolvimento && (
                    <>
                      {devCols.map((c, i) => (
                        <th key={c.key} style={subTop} className={subHeadCell + (i === 0 ? " border-l-2" : "")} title={c.label}>
                          <span className="mx-auto block max-w-[96px] truncate">{c.label}</span>
                        </th>
                      ))}
                      {devOutros && <th style={subTop} className={subHeadCell} title="Status históricos fora do board (Σ preservada)">Outros</th>}
                      <th style={subTop} className={subHeadCell + " border-l border-r-2 font-semibold text-foreground"}>Total</th>
                    </>
                  )}
                  {expand.servicos && (
                    <>
                      {servCols.map((c, i) => (
                        <th key={c.key} style={subTop} className={subHeadCell + (i === 0 ? " border-l-2" : "")} title={c.label}>
                          <span className="mx-auto block max-w-[96px] truncate">{c.label}</span>
                        </th>
                      ))}
                      {servOutros && <th style={subTop} className={subHeadCell} title="CAD→Corte + Produção (macro) + categorias sem coluna (Σ preservada)">Outros</th>}
                      <th style={subTop} className={subHeadCell + " border-l border-r-2 font-semibold text-foreground"}>Total</th>
                    </>
                  )}
                </tr>
              )}
            </thead>
            <tbody>
              {rows.map(({ it, total, porFase }) => {
                const devSplit = expand.desenvolvimento ? splitFaseSub(it, "desenvolvimento", devKeys) : null;
                const servSplit = expand.servicos ? splitFaseSub(it, "servicos", servKeys) : null;
                return (
                  <tr key={it.modelo_id} className="border-b last:border-0">
                    <td className="sticky left-0 z-10 max-w-[190px] bg-card border-r py-2 px-3" title={[it.ref, it.nome].filter(Boolean).join(" · ")}>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{it.ref || it.nome || "—"}</span>
                        {it.versao != null && it.versao > 1 && <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">v{it.versao}</Badge>}
                      </span>
                      {it.ref && it.nome && <span className="block truncate text-xs text-muted-foreground">{it.nome}</span>}
                    </td>
                    <FaseAggCell fase={porFase.planejamento} label="Planejamento" />
                    {expand.desenvolvimento ? (
                      <>
                        {devCols.map((c, i) => (
                          <SubCell key={c.key} edge={i === 0} strong={i === 0} valor={devSplit!.valores[c.key]} meta={c.meta} label={c.label} />
                        ))}
                        {devOutros && <SubCell valor={devSplit!.outros || undefined} meta={null} label="Outros / histórico (fora do board)" />}
                        <FaseAggCell fase={porFase.desenvolvimento} label="Desenvolvimento (total)" edge groupEnd />
                      </>
                    ) : (
                      <FaseAggCell fase={porFase.desenvolvimento} label="Desenvolvimento" />
                    )}
                    {expand.servicos ? (
                      <>
                        {servCols.map((c, i) => (
                          <SubCell key={c.key} edge={i === 0} strong={i === 0} valor={servSplit!.valores[c.key]} meta={c.meta} label={c.label} />
                        ))}
                        {servOutros && <SubCell valor={servSplit!.outros || undefined} meta={null} label="Outros: CAD→Corte + Produção (macro)" />}
                        <FaseAggCell fase={porFase.servicos} label="Serviços (total)" edge groupEnd />
                      </>
                    ) : (
                      <FaseAggCell fase={porFase.servicos} label="Serviços" />
                    )}
                    <FaseAggCell fase={porFase.cq} label="CQ" />
                    <FaseAggCell fase={porFase.direcionamento} label="Direcionamento" />
                    <FaseAggCell fase={porFase.lancamento} label="Lançamento" />
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="relative h-4 min-w-[64px] flex-1 overflow-hidden rounded bg-muted">
                          <div className="absolute inset-y-0 left-0 rounded" style={{ width: `${(total / maxTotal) * 100}%`, background: CHART_SERIE, opacity: 0.85 }} />
                        </div>
                        <span className="w-12 shrink-0 text-right text-xs font-bold tabular-nums">{fmtInt(total)}d</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={leafTotal} className="py-6 text-center text-muted-foreground">Nenhum item no filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
