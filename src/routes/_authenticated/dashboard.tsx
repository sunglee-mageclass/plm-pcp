import { createFileRoute } from "@tanstack/react-router";
import { brl, fmtNum } from "@/lib/format";
import { precoInfo } from "@/lib/preco";
import { useMemo, useState, type ReactNode } from "react";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Package, Palette, Boxes, AlertTriangle, Layers, Sparkles, Printer, CheckCircle2, Scissors, ClipboardCheck, Factory, DollarSign, Tag } from "lucide-react";
import { format } from "date-fns";
import { FilterButton } from "@/components/shared/filters";
import { useSort, SortTh } from "@/components/shared/sort";
import { Button } from "@/components/ui/button";
import { printWithImages } from "@/lib/print";
import { RelatorioPrint, type RelSecao } from "@/components/shared/RelatorioPrint";
import { PeriodoPicker, type Periodo } from "@/components/shared/PeriodoPicker";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell, FunnelChart, Funnel, LabelList,
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

const PIE_COLORS = ["hsl(217 91% 60%)", "hsl(142 71% 45%)", "hsl(45 93% 47%)", "hsl(0 84% 60%)", "hsl(280 70% 60%)", "hsl(190 80% 50%)", "hsl(20 90% 55%)", "hsl(160 60% 45%)"];

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

// Gráfico de barras de TAMANHO FIXO p/ impressão (ResponsiveContainer mede 0 em
// display:none; isAnimationActive=false senão sai vazio escondido). Cor = paleta do
// dashboard; rótulo de valor no topo; cantos arredondados.
function PBar({ data, xKey, barKey, fmtL, color = PIE_COLORS[0], horizontal, height = 190, width = 680 }: { data: any[]; xKey: string; barKey: string; fmtL?: (v: any) => string; color?: string; horizontal?: boolean; height?: number; width?: number }) {
  const lab = { fontSize: 9, fill: "#475569", fontWeight: 600 } as const;
  if (horizontal) {
    return (
      <BarChart width={width} height={height} data={data} layout="vertical" margin={{ left: 2, right: 30, top: 2, bottom: 2 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={fmtL} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey={xKey} width={132} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
        <Bar dataKey={barKey} fill={color} isAnimationActive={false} radius={[0, 3, 3, 0]}>
          <LabelList dataKey={barKey} position="right" style={lab} formatter={fmtL} />
        </Bar>
      </BarChart>
    );
  }
  return (
    <BarChart width={width} height={height} data={data} margin={{ top: 16, right: 8, bottom: 2, left: 2 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
      <XAxis dataKey={xKey} tick={{ fontSize: 10 }} axisLine={{ stroke: "#ccc" }} tickLine={false} />
      <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtL} axisLine={false} tickLine={false} width={fmtL ? 42 : 28} />
      <Bar dataKey={barKey} fill={color} isAnimationActive={false} radius={[3, 3, 0, 0]}>
        <LabelList dataKey={barKey} position="top" style={lab} formatter={fmtL} />
      </Bar>
    </BarChart>
  );
}

const nfInt = (n: any) => Number(n ?? 0).toLocaleString("pt-BR");
// Duas mini-barras lado a lado (ex.: Modelos | Grade), p/ caber no A4.
function PBar2({ a, b }: { a: { titulo: string; node: ReactNode }; b: { titulo: string; node: ReactNode } }) {
  return (
    <div style={{ display: "flex", gap: 18 }}>
      {[a, b].map((c, i) => (
        <div key={i} style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}>{c.titulo}</div>
          {c.node}
        </div>
      ))}
    </div>
  );
}

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
  const funnel = (data?.funnel ?? []).map((f: any, i: number) => {
    const pct = funnelBase > 0 ? Math.round((Number(f.value) / funnelBase) * 100) : 0;
    return { ...f, fill: PIE_COLORS[i % PIE_COLORS.length], labelDir: `${f.name} · ${f.value} · ${pct}%` };
  });
  const pieData = data?.pie ?? [];
  const estilistas: Opt[] = data?.filtros?.estilistas ?? [];
  const linhas: Opt[] = data?.filtros?.linhas ?? [];
  const colecoes: string[] = data?.filtros?.colecoes ?? [];

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
          <h3 className="font-semibold mb-3">Funil de progresso</h3>
          {funnelBase === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">{isLoading ? "Carregando…" : "Sem dados no período."}</p>
          ) : (
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <FunnelChart>
                <Tooltip />
                <Funnel dataKey="value" data={funnel} isAnimationActive>
                  {/* Nome + valor fora do funil (à direita): legível mesmo quando o segmento é fino. */}
                  <LabelList position="right" dataKey="labelDir" stroke="none" fill="var(--foreground)" />
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          </div>
          )}
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Distribuição por categoria</h3>
          {pieData.length === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">{isLoading ? "Carregando…" : "Sem dados no período."}</p>
          ) : (
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <PieChart>
                <Tooltip />
                <Legend />
                <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={110} label>
                  {pieData.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          )}
        </Card>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <DashError show={isError} />
    </div>
  );
}


function Kpi({ label, value, icon: Icon, cor, sub }: { label: string; value: number | string; icon: any; cor?: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: cor ?? "hsl(217 91% 60%)" }}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 text-3xl font-bold leading-none" style={cor ? { color: cor } : undefined}>{value}</div>
      {sub && <div className="mt-1.5 text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

// Donut on-screen (SVG) p/ taxas — mesmo visual do relatório.
function DashDonut({ pct, cor = "hsl(142 71% 45%)", legenda }: { pct: number; cor?: string; legenda?: string }) {
  const r = 60, c = 2 * Math.PI * r, on = (c * pct) / 100;
  return (
    <div className="flex flex-col items-center justify-center">
      <svg width="160" height="160" viewBox="0 0 170 170">
        <circle cx="85" cy="85" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="22" />
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
          { titulo: "Estoque por categoria de tecido", data: barTecido, cor: PIE_COLORS[0] },
          { titulo: "Estoque por categoria de aviamento", data: barAviamento, cor: PIE_COLORS[1] },
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

function ProducaoTab() {
  const fl = useFieldLabels();
  const [periodo, setPeriodo] = useState<Periodo>(undefined);
  const [colecao, setColecao] = useState("all");
  const [linha, setLinha] = useState("all");
  const [servico, setServico] = useState("all");
  // Timeline e SLA mostram só 5 por padrão (cabe em mobile e desktop); "ver mais" expande.
  const [timelineAll, setTimelineAll] = useState(false);
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

  const timeline = data?.timeline ?? [];
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
  // Oficina e Acabamento são subtipos de Serviço — não etapas próprias.
  const etapas = ["CAD", "Serviço", "Controle de Qualidade", "Direcionamento", "Lançado"];
  // Rótulo da timeline. "Lançado" = modelos.lancado (fonte única), a MESMA base do
  // KPI "Lançados" da aba Coleção — consistentes desde jul/2026.
  const etapaLabel: Record<string, string> = { "Lançado": "Em Lançamento" };

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
        <Kpi label="Entregas no prazo" value={kpiPrazo.noPrazo} icon={CheckCircle2} cor="hsl(142 71% 45%)" sub="entregas de Serviços" />
        <Kpi label="Atrasadas" value={kpiPrazo.atrasadas} icon={AlertTriangle} cor={Number(kpiPrazo.atrasadas) > 0 ? "hsl(0 84% 60%)" : undefined} sub={`${Math.round((Number(kpiPrazo.atrasadas) / Math.max(Number(kpiPrazo.noPrazo) + Number(kpiPrazo.atrasadas), 1)) * 100)}% do total`} />
        <Kpi label="Defeito médio" value={`${defeitoMedio.toFixed(1)}%`} icon={Sparkles} cor="hsl(45 93% 47%)" sub="defeito ÷ recebido" />
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
          <MonthBarCard title="Modelos cortados" data={cortes} dataKey="modelos" name="Modelos" color={PIE_COLORS[0]} empty="Sem cortes no período." loading={isLoading} />
          <MonthBarCard title="Grade total cortada" subtitle="peças" data={cortes} dataKey="grade" name="Grade total" color={PIE_COLORS[1]} empty="Sem cortes no período." loading={isLoading} />
        </div>
      </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">Produção finalizada por mês <span className="font-normal">· Serviços com status finalizado</span></h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <MonthBarCard title="Modelos finalizados" data={finalizadas} dataKey="modelos" name="Modelos" color={PIE_COLORS[2]} empty="Nada finalizado no período." loading={isLoading} />
          <MonthBarCard title="Grade total finalizada" subtitle="peças" data={finalizadas} dataKey="grade" name="Grade total" color={PIE_COLORS[3]} empty="Nada finalizado no período." loading={isLoading} />
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">Etapa do kanban de Desenvolvimento</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <EtapaBarCard title="Modelos por etapa" data={kanbanDev} dataKey="modelos" name="Modelos" color={PIE_COLORS[0]} />
          <EtapaBarCard title="Grade total por etapa" data={kanbanDev} dataKey="grade" name="Grade total" color={PIE_COLORS[1]} />
        </div>
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Timeline por {fl("ref")}</h3>
        <div className="overflow-x-auto">
          {/* table-fixed + larguras explícitas: REF/Nome fixos e as colunas de etapa
              todas com a MESMA largura (alinha as bolinhas). */}
          <table className="w-full text-sm card-table sm:table-fixed">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 w-[16%]">{fl("ref")}</th>
                <th className="py-2 pr-3 w-[24%]">Nome</th>
                {etapas.map((e) => (
                  <th key={e} className="py-2 px-2 text-center text-xs align-bottom" style={{ width: `${60 / etapas.length}%` }}>
                    {etapaLabel[e] ?? e}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(timelineAll ? timeline : timeline.slice(0, 5)).map((r: any) => {
                // Oficina/Acabamento caem sob Serviço na timeline.
                const etapaAtual = (r.etapa === "Oficina" || r.etapa === "Acabamento") ? "Serviço" : r.etapa;
                const idx = etapas.indexOf(etapaAtual);
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {r.ref ?? "—"}
                        {r.versao != null && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">v{r.versao}</Badge>}
                      </span>
                    </td>
                    <td className="py-2 pr-3" data-label="Nome">{r.nome}</td>
                    {etapas.map((e, i) => (
                      <td key={i} className="py-2 px-2 text-center" data-label={etapaLabel[e] ?? e}>
                        <span className={"inline-block h-3 w-3 rounded-full " + (i < idx ? "bg-muted-foreground/30" : i === idx ? "bg-primary" : "bg-muted")}></span>
                      </td>
                    ))}
                  </tr>
                );
              })}
              {!isLoading && timeline.length === 0 && <tr><td colSpan={etapas.length + 2} className="py-4 text-center text-muted-foreground">Sem dados.</td></tr>}
            </tbody>
          </table>
        </div>
        {timeline.length > 5 && (
          <button type="button" onClick={() => setTimelineAll((v) => !v)} className="mt-3 text-sm text-primary hover:underline">
            {timelineAll ? "Ver menos" : `Ver mais (${timeline.length - 5})`}
          </button>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Taxa de defeito por mês <span className="text-sm font-normal text-muted-foreground">· defeito ÷ recebido (entregas de Serviços)</span></h3>
        <div style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={defeitoMes}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="mes" />
              <YAxis tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: any) => `${Number(v)}%`} />
              <Bar dataKey="taxa" name="Taxa de defeito" fill={PIE_COLORS[3]} />
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
          { label: "Entregas no prazo", valor: String(kpiPrazo.noPrazo ?? 0), cor: "#16a34a" },
          { label: "Atrasadas", valor: String(kpiPrazo.atrasadas ?? 0), cor: Number(kpiPrazo.atrasadas) > 0 ? "#dc2626" : undefined },
          { label: "Defeito médio", valor: `${defeitoMedio.toFixed(1)}%`, cor: "#ca8a04" },
        ]}
        donut={{ pct: Math.round(Number(kpiPrazo.pct) || 0), cor: "#16a34a", titulo: "Entregas no prazo", legenda: `${kpiPrazo.noPrazo ?? 0} no prazo · ${kpiPrazo.atrasadas ?? 0} atrasadas` }}
        secoes={[
          {
            titulo: "Qualidade — taxa de defeito por mês", icone: "◷",
            descricao: "Defeito ÷ recebido (entregas de Serviços)",
            grafico: (defeitoMes as any[]).length > 0 ? <PBar data={defeitoMes as any[]} xKey="mes" barKey="taxa" color={PIE_COLORS[3]} fmtL={(v) => `${v}%`} /> : undefined,
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
              a={{ titulo: "Modelos cortados", node: <PBar data={cortes} xKey="mes" barKey="modelos" color={PIE_COLORS[0]} width={320} height={160} fmtL={nfInt} /> }}
              b={{ titulo: "Grade total cortada", node: <PBar data={cortes} xKey="mes" barKey="grade" color={PIE_COLORS[1]} width={320} height={160} fmtL={nfInt} /> }} /> : undefined,
            colunas: [{ key: "mes", label: "Mês" }, { key: "modelos", label: "Modelos", align: "right" }, { key: "grade", label: "Grade total", align: "right" }],
            linhas: (cortes as any[]).map((d) => ({ mes: d.mes, modelos: nfInt(d.modelos), grade: nfInt(d.grade) })), zebra: true,
          }] as RelSecao[]) : []),
          {
            titulo: "Produção finalizada por mês", icone: "▦",
            descricao: "Serviços com status finalizado",
            grafico: (finalizadas as any[]).length > 0 ? <PBar2
              a={{ titulo: "Modelos finalizados", node: <PBar data={finalizadas} xKey="mes" barKey="modelos" color={PIE_COLORS[2]} width={320} height={160} fmtL={nfInt} /> }}
              b={{ titulo: "Grade total finalizada", node: <PBar data={finalizadas} xKey="mes" barKey="grade" color={PIE_COLORS[3]} width={320} height={160} fmtL={nfInt} /> }} /> : undefined,
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
        <Kpi label="Investido em MP" value={brl(investido)} icon={DollarSign} cor="hsl(217 91% 60%)" />
        <Kpi label="Total pago" value={brl(pago)} icon={CheckCircle2} cor="hsl(142 71% 45%)" />
        <Kpi label="Total pendente" value={brl(pendente)} icon={AlertTriangle} cor="hsl(45 93% 47%)" />
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
              <Bar dataKey="total" name="A pagar" fill={PIE_COLORS[2]} />
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
              <Bar dataKey="valor" name="R$ parado" fill={PIE_COLORS[2]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Aging de contas a pagar <span className="text-sm font-normal text-muted-foreground">· em aberto, por idade do vencimento</span></h3>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={data?.aging ?? []} margin={{ bottom: 14 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                {/* mobile: rótulos das faixas inclinados + menores p/ não colidirem. */}
                <XAxis dataKey="faixa" interval={0} tick={{ fontSize: 10 }} angle={-12} textAnchor="end" height={46} />
                <YAxis width={44} tick={{ fontSize: 10 }} tickFormatter={(v) => (Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : `${v}`)} />
                <Tooltip formatter={(v: any) => brl(Number(v))} />
                <Bar dataKey="total" name="A pagar" fill={PIE_COLORS[3]} />
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
                <Bar dataKey="total" name="Total" fill={PIE_COLORS[0]} />
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
          { label: "Total pago", valor: brl(pago), cor: "#16a34a" },
          { label: "Total pendente", valor: brl(pendente), cor: "#ca8a04" },
        ]}
        donut={(pago + pendente) > 0 ? { pct: Math.round((pago / (pago + pendente)) * 100), cor: "#16a34a", titulo: "Pago do total", legenda: `${brl(pago)} pago · ${brl(pendente)} pendente` } : undefined}
        secoes={[
          {
            titulo: "Contas a pagar — projeção mensal", icone: "▦",
            grafico: (chartData as any[]).length > 0 ? <PBar data={chartData as any[]} xKey="mes" barKey="total" color={PIE_COLORS[2]} fmtL={(v) => nfInt(v)} /> : undefined,
            colunas: [{ key: "mes", label: "Mês" }, { key: "total", label: "A pagar", align: "right" }],
            linhas: (chartData as any[]).map((d) => ({ mes: d.mes, total: brl(Number(d.total)) })), zebra: true,
            rodape: `Total projetado: ${brl((chartData as any[]).reduce((s, d) => s + Number(d.total || 0), 0))}`,
          },
          {
            titulo: "Aging — contas em aberto por idade do vencimento", icone: "◷",
            grafico: ((data?.aging ?? []) as any[]).length > 0 ? <PBar data={data?.aging ?? []} xKey="faixa" barKey="total" color={PIE_COLORS[3]} fmtL={(v) => nfInt(v)} height={170} /> : undefined,
            colunas: [{ key: "faixa", label: "Faixa" }, { key: "total", label: "Valor em aberto", align: "right" }],
            linhas: ((data?.aging ?? []) as any[]).map((a) => ({ faixa: a.faixa, total: brl(Number(a.total)) })), zebra: true,
          },
          {
            titulo: "Top fornecedores no período", icone: "▤",
            grafico: ((data?.topFornecedores ?? []) as any[]).length > 0 ? <PBar data={data?.topFornecedores ?? []} xKey="nome" barKey="total" color={PIE_COLORS[0]} horizontal height={Math.max(150, ((data?.topFornecedores ?? []) as any[]).length * 26)} fmtL={(v) => nfInt(v)} /> : undefined,
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
                </tr>
              ))}
              {!isLoading && rows.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">Sem dados.</td></tr>}
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
              <Bar dataKey="medio" name="Custo médio" fill={PIE_COLORS[1]} />
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
          { label: "Acima do previsto", valor: String((rows as any[]).filter((r) => Number(r.pct) > 0).length), cor: "#dc2626" },
        ]}
        donut={(rows as any[]).length > 0 ? { pct: Math.round(((rows as any[]).filter((r) => Number(r.pct) <= 0).length / (rows as any[]).length) * 100), cor: "#16a34a", titulo: "Dentro do previsto", legenda: `${(rows as any[]).filter((r) => Number(r.pct) <= 0).length} de ${(rows as any[]).length} modelos no custo previsto ou abaixo` } : undefined}
        secoes={[
          {
            titulo: "Custo médio por peça por coleção", icone: "▣",
            grafico: (chartData as any[]).length > 0 ? <PBar data={chartData as any[]} xKey="colecao" barKey="medio" color={PIE_COLORS[1]} fmtL={(v) => nfInt(v)} /> : undefined,
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

const fmtPct = (v: number) => (v > 0 ? `${v.toFixed(0)}%` : "—");
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
                <td className={`py-2 px-2 text-right ${plan}`} data-label="Plan · Margem">{fmtPct(r.margemPlan)}</td>
                <td className={`py-2 px-2 text-right ${plan}`} data-label="Plan · Markup">{fmtMkp(r.markupPlan)}</td>
                <td className={`py-2 px-2 text-right border-l ${real}`} data-label="Real · PV">{brl(r.pvReal)}</td>
                <td className={`py-2 px-2 text-right ${real}`} data-label="Real · Lucro">{brl(r.lucroReal)}</td>
                <td className={`py-2 px-2 text-right ${real}`} data-label="Real · Margem">{fmtPct(r.margemReal)}</td>
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
            { label: "Semana", value: fSemana, onChange: setFSemana, options: [{ id: "all", nome: "Todas" }, ...["1", "2", "3", "4", "5"].map((n) => ({ id: n, nome: n }))] },
          ]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Poder de venda" value={brl(tot.pvPlan)} icon={Tag} sub={`realizado ${brl(tot.pvReal)}`} />
        <Kpi label="Lucro bruto" value={brl(tot.lucroPlan)} icon={DollarSign} sub={`realizado ${brl(tot.lucroReal)}`} />
        <Kpi label="Margem média" value={fmtPct(tot.margemPlan)} icon={Sparkles} sub={`realizado ${fmtPct(tot.margemReal)}`} />
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
function LeadtimePretty(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function EtapaLeadCard({ label, e }: { label: string; e: any }) {
  const ideal = Number(e.idealDias) || 0;
  const media = Number(e.duracaoMedia) || 0;
  const ok = ideal <= 0 || media <= ideal;
  const pctBar = ideal > 0 ? Math.min(100, (media / ideal) * 100) : 0;
  return (
    <Card className="p-4">
      <p className="text-sm font-medium truncate">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className={"text-2xl font-bold " + (ok ? "text-green-600 dark:text-green-400" : "text-destructive")}>{fmtNum(media)}d</span>
        <span className="text-xs text-muted-foreground">ideal {fmtNum(ideal)}d</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded bg-muted">
        <div className={"h-full " + (ok ? "bg-green-500" : "bg-destructive")} style={{ width: `${pctBar}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {e.pctNoPrazo}% no prazo · {e.nModelos} modelo(s){Number(e.foraSla) > 0 ? ` · ${e.foraSla} fora` : ""}
      </p>
    </Card>
  );
}

function LeadtimeTab() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dash-leadtime"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_leadtime" as never);
      if (error) throw error;
      return data as any;
    },
  });
  const etapas: any[] = data?.etapas ?? [];
  const macro = etapas.filter((e) => e.tipo === "macro");
  const kanban = etapas.filter((e) => e.tipo === "kanban");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DashTabsList />
      </div>
      <p className="text-sm text-muted-foreground">
        Tempo médio em cada etapa vs o ideal. O ideal e quais etapas acompanhar são definidos em
        Configurações da Loja (em breve). Verde = dentro do ideal.
      </p>

      {macro.length > 0 && (
        <div>
          <SecHeader icon={Factory}>Etapas de produção</SecHeader>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {macro.map((e) => <EtapaLeadCard key={e.etapa} label={e.label} e={e} />)}
          </div>
        </div>
      )}

      {kanban.length > 0 && (
        <div>
          <SecHeader icon={Palette}>Desenvolvimento · por coluna do kanban</SecHeader>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {kanban.map((e) => <EtapaLeadCard key={e.etapa} label={LeadtimePretty(e.label)} e={e} />)}
          </div>
        </div>
      )}

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
