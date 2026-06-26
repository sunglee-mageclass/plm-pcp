import { createFileRoute } from "@tanstack/react-router";
import { brl, fmtNum } from "@/lib/format";
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
import { RelatorioPrint } from "@/components/shared/RelatorioPrint";
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
      <RequirePermission anyOf={["dashboard_colecao","dashboard_estoque","dashboard_producao","dashboard_financeiro","dashboard_custos"]}>
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
        <Kpi label="Lançados (CQ ok)" value={kpis.lancados} icon={Package} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Funil de progresso</h3>
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
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Distribuição por categoria</h3>
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
  const zerados = data?.zerados ?? 0;
  const threshold = Number(data?.threshold ?? 0) || 0;
  const top10 = data?.top10 ?? [];
  const barData = data?.barData ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DashTabsList />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Variantes de Tecido" value={totalVariantes} icon={Boxes} />
        <Kpi label="Aviamentos" value={totalAviamentos} icon={Package} />
        <Kpi label={threshold > 0 ? `Itens com estoque ≤ ${fmtNum(threshold)}` : "Itens com estoque ≤ 0"} value={zerados} icon={AlertTriangle} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Estoque crítico <span className="text-sm font-normal text-muted-foreground">· 10 menores · "falta" = repor até o mínimo</span></h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm card-table">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3 text-right">Estoque</th>
                  <th className="py-2 pr-3 text-right">Falta p/ mín.</th>
                </tr>
              </thead>
              <tbody>
                {top10.map((r: any) => {
                  const falta = Math.max(0, threshold - Number(r.estoque ?? 0));
                  return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 truncate max-w-[260px]">{r.nome}</td>
                    <td className="py-2 pr-3" data-label="Tipo">{r.tipo}</td>
                    <td className={"py-2 pr-3 text-right " + (Number(r.estoque) <= threshold ? "text-destructive font-medium" : "")} data-label="Estoque">
                      {fmtNum(r.estoque)}
                    </td>
                    <td className={"py-2 pr-3 text-right " + (falta > 0 ? "text-destructive font-medium" : "text-muted-foreground")} data-label="Falta p/ mín.">
                      {falta > 0 ? fmtNum(falta) : "—"}
                    </td>
                  </tr>
                  );
                })}
                {!isLoading && top10.length === 0 && (
                  <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">Sem dados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold mb-3">Estoque por categoria de tecido</h3>
          <div style={{ width: "100%", height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="categoria" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="total" fill={PIE_COLORS[0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
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
          <BarChart data={data} layout="vertical" margin={{ left: 24, right: 24 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
            <XAxis type="number" allowDecimals={false} />
            <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 11 }} interval={0} />
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

function ProducaoTab() {
  const fl = useFieldLabels();
  const [periodo, setPeriodo] = useState<Periodo>(undefined);
  const [colecao, setColecao] = useState("all");
  const [linha, setLinha] = useState("all");
  const [servico, setServico] = useState("all");
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
  // Oficina e Acabamento são subtipos de Terceirizado (serviços) — não etapas próprias.
  const etapas = ["CAD", "Terceirizado", "Controle de Qualidade", "Direcionamento", "Lançado"];
  // Rótulo da timeline: a etapa "Lançado" (existe registro em lancamentos) é a
  // ETAPA de lançamento — distinta do KPI "Lançados (CQ ok)" (CQ confirmado).
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

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">Cortes por mês <span className="font-normal">· por data de entrega do corte</span></h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <MonthBarCard title="Modelos cortados" data={cortes} dataKey="modelos" name="Modelos" color={PIE_COLORS[0]} empty="Sem cortes no período." loading={isLoading} />
          <MonthBarCard title="Grade total cortada" subtitle="peças" data={cortes} dataKey="grade" name="Grade total" color={PIE_COLORS[1]} empty="Sem cortes no período." loading={isLoading} />
        </div>
      </div>

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
          <table className="w-full text-sm card-table">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">{fl("ref")}</th>
                <th className="py-2 pr-3">Nome</th>
                {etapas.map((e) => <th key={e} className="py-2 px-2 text-center text-xs">{etapaLabel[e] ?? e}</th>)}
              </tr>
            </thead>
            <tbody>
              {timeline.map((r: any) => {
                // Oficina/Acabamento caem sob Terceirizado na timeline.
                const etapaAtual = (r.etapa === "Oficina" || r.etapa === "Acabamento") ? "Terceirizado" : r.etapa;
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
            {slaSort.sorted.map((r: any, i: number) => {
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
      </Card>

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
          {
            titulo: "Cortes por mês", icone: "▦",
            descricao: "Por data de entrega do corte",
            grafico: (cortes as any[]).length > 0 ? <PBar2
              a={{ titulo: "Modelos cortados", node: <PBar data={cortes} xKey="mes" barKey="modelos" color={PIE_COLORS[0]} width={320} height={160} fmtL={nfInt} /> }}
              b={{ titulo: "Grade total cortada", node: <PBar data={cortes} xKey="mes" barKey="grade" color={PIE_COLORS[1]} width={320} height={160} fmtL={nfInt} /> }} /> : undefined,
            colunas: [{ key: "mes", label: "Mês" }, { key: "modelos", label: "Modelos", align: "right" }, { key: "grade", label: "Grade total", align: "right" }],
            linhas: (cortes as any[]).map((d) => ({ mes: d.mes, modelos: nfInt(d.modelos), grade: nfInt(d.grade) })), zebra: true,
          },
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
              <BarChart data={data?.aging ?? []}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="faixa" />
                <YAxis tickFormatter={(v) => v.toLocaleString("pt-BR")} />
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
              <BarChart data={data?.topFornecedores ?? []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis type="number" tickFormatter={(v) => Number(v).toLocaleString("pt-BR")} />
                <YAxis type="category" dataKey="nome" width={110} />
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
        <h3 className="font-semibold mb-3">Custo médio por peça por coleção</h3>
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="colecao" />
              <YAxis tickFormatter={(v) => v.toLocaleString("pt-BR")} />
              <Tooltip formatter={(v: any) => brl(Number(v))} />
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
