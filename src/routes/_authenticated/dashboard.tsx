import { createFileRoute } from "@tanstack/react-router";
import { fmtNum } from "@/lib/format";
import { useMemo, useState } from "react";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Package, Palette, Boxes, AlertTriangle, Layers, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { FilterButton } from "@/components/shared/filters";
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
    <div className="container mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral da coleção e do estoque.</p>
      </header>
      <Tabs value={active} onValueChange={setTab}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-4">
            {active === t.value && <t.Comp />}
          </TabsContent>
        ))}
      </Tabs>
    </div>
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
  const funnel = (data?.funnel ?? []).map((f: any, i: number) => ({ ...f, fill: PIE_COLORS[i % PIE_COLORS.length] }));
  const pieData = data?.pie ?? [];
  const estilistas: Opt[] = data?.filtros?.estilistas ?? [];
  const linhas: Opt[] = data?.filtros?.linhas ?? [];
  const colecoes: string[] = data?.filtros?.colecoes ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
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
                  <LabelList position="right" dataKey="name" stroke="none" />
                  <LabelList position="center" dataKey="value" stroke="none" fill="#fff" />
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


function Kpi({ label, value, icon: Icon }: { label: string; value: number; icon: any }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent><div className="text-2xl font-semibold">{value}</div></CardContent>
    </Card>
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
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Variantes de Tecido" value={totalVariantes} icon={Boxes} />
        <Kpi label="Aviamentos" value={totalAviamentos} icon={Package} />
        <Kpi label={threshold > 0 ? `Itens com estoque ≤ ${fmtNum(threshold)}` : "Itens com estoque ≤ 0"} value={zerados} icon={AlertTriangle} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Top 10 menor estoque</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3">Item</th>
                  <th className="py-2 pr-3">Tipo</th>
                  <th className="py-2 pr-3 text-right">Estoque</th>
                </tr>
              </thead>
              <tbody>
                {top10.map((r: any) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 truncate max-w-[260px]">{r.nome}</td>
                    <td className="py-2 pr-3">{r.tipo}</td>
                    <td className={"py-2 pr-3 text-right " + (Number(r.estoque) <= threshold ? "text-destructive font-medium" : "")}>
                      {fmtNum(r.estoque)}
                    </td>
                  </tr>
                ))}
                {!isLoading && top10.length === 0 && (
                  <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">Sem dados.</td></tr>
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
  const ini = isoDate(periodo?.from), fim = isoDate(periodo?.to);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["dash-producao", ini, fim, colecao, linha],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_producao", {
        p_inicio: ini,
        p_fim: fim,
        p_colecao: colecao === "all" ? undefined : colecao,
        p_linha: linha === "all" ? undefined : linha,
      });
      if (error) throw error;
      return data as any;
    },
  });

  const timeline = data?.timeline ?? [];
  const slaPorTerc = data?.slaPorTerc ?? [];
  const kpiPrazo = data?.kpiPrazo ?? { noPrazo: 0, atrasadas: 0, pct: 0 };
  const cortes = data?.cortesPorMes ?? [];
  const finalizadas = data?.finalizadasPorMes ?? [];
  const kanbanDev = data?.kanbanDev ?? [];
  const etapas = ["CAD", "Terceirizado", "Oficina", "Controle de Qualidade", "Acabamento", "Direcionamento", "Lançado"];
  // Rótulo da timeline: a etapa "Lançado" (existe registro em lancamentos) é a
  // ETAPA de lançamento — distinta do KPI "Lançados (CQ ok)" (CQ confirmado).
  const etapaLabel: Record<string, string> = { "Lançado": "Em Lançamento" };

  const colecoes: string[] = data?.filtros?.colecoes ?? [];
  const linhas: Opt[] = data?.filtros?.linhas ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <PeriodoPicker value={periodo} onChange={setPeriodo} />
        <FilterButton
          filters={[
            { label: "Coleção", value: colecao, onChange: setColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.filter(Boolean).map((c) => ({ id: c, nome: c }))] },
            { label: "Linha", value: linha, onChange: setLinha, options: [{ id: "all", nome: "Todas" }, ...linhas] },
          ]}
        />
      </div>

      <DashError show={isError} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Entregas no prazo" value={kpiPrazo.noPrazo} icon={BarChart3} />
        <Kpi label="Atrasadas" value={kpiPrazo.atrasadas} icon={AlertTriangle} />
        <Kpi label="% no prazo" value={Math.round(Number(kpiPrazo.pct) || 0)} icon={Sparkles} />
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
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">{fl("ref")}</th>
                <th className="py-2 pr-3">Nome</th>
                {etapas.map((e) => <th key={e} className="py-2 px-2 text-center text-xs">{etapaLabel[e] ?? e}</th>)}
              </tr>
            </thead>
            <tbody>
              {timeline.map((r: any) => {
                const idx = etapas.indexOf(r.etapa);
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {r.ref ?? "—"}
                        {r.versao != null && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">v{r.versao}</Badge>}
                      </span>
                    </td>
                    <td className="py-2 pr-3">{r.nome}</td>
                    {etapas.map((_, i) => (
                      <td key={i} className="py-2 px-2 text-center">
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
        <h3 className="font-semibold mb-3">SLA por terceirizado</h3>
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 pr-3">Nome</th>
              <th className="py-2 pr-3 text-right">SLA médio (dias)</th>
              <th className="py-2 pr-3 text-right">Atrasos</th>
              <th className="py-2 pr-3 text-right">Total entregue</th>
              <th className="py-2 pr-3 text-right">Taxa de Defeito</th>
            </tr>
          </thead>
          <tbody>
            {slaPorTerc.map((r: any, i: number) => {
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
                  <td className="py-2 pr-3 text-right">{fmtNum(r.slaMedio)}</td>
                  <td className={"py-2 pr-3 text-right " + (Number(r.atrasos) > 0 ? "text-destructive" : "")}>{r.atrasos}</td>
                  <td className="py-2 pr-3 text-right">{r.total}</td>
                  <td className="py-2 pr-3 text-right">
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
            {!isLoading && slaPorTerc.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">Sem entregas registradas.</td></tr>}
          </tbody>
        </table>
        </div>
      </Card>
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
      const { data, error } = await supabase.rpc("dashboard_financeiro", {
        p_inicio: inicio,
        p_fim: fim,
      });
      if (error) throw error;
      return data as any;
    },
  });

  const investido = Number(data?.investido ?? 0);
  const pago = Number(data?.pago ?? 0);
  const pendente = Number(data?.pendente ?? 0);
  const chartData = data?.chartData ?? [];

  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <PeriodoPicker value={periodo} onChange={setPeriodo} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Investido em matéria-prima</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{brl(investido)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total pago</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold text-green-600 dark:text-green-400">{brl(pago)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total pendente</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold text-yellow-600 dark:text-yellow-400">{brl(pendente)}</div></CardContent></Card>
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

  const brl = (v: number) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
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
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">{fl("ref")}</th>
                <th className="py-2 pr-3">Modelo</th>
                <th className="py-2 pr-3 text-right">Previsto (un.)</th>
                <th className="py-2 pr-3 text-right">Real (un.)</th>
                <th className="py-2 pr-3 text-right">Diferença</th>
                <th className="py-2 pr-3 text-right">%</th>
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
                  <td className="py-2 pr-3">{r.nome}</td>
                  <td className="py-2 pr-3 text-right">{brl(r.previsto)}</td>
                  <td className={"py-2 pr-3 text-right " + (r.confirmado ? "" : "text-muted-foreground italic")} title={r.confirmado ? undefined : "Ainda não confirmado em CAD — exibindo o previsto"}>{brl(r.real)}</td>
                  <td className={"py-2 pr-3 text-right " + (Number(r.diff) > 0 ? "text-destructive" : Number(r.diff) < 0 ? "text-green-600 dark:text-green-400" : "")}>{brl(r.diff)}</td>
                  <td className={"py-2 pr-3 text-right " + (Number(r.pct) > 0 ? "text-destructive" : Number(r.pct) < 0 ? "text-green-600 dark:text-green-400" : "")}>{fmtNum(r.pct)}%</td>
                </tr>
              ))}
              {!isLoading && rows.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">Sem dados.</td></tr>}
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
    </div>
  );
}
