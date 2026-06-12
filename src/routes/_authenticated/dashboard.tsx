import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BarChart3, Package, Palette, Boxes, AlertTriangle, Layers, Sparkles } from "lucide-react";
import { FilterButton } from "@/components/shared/filters";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell, FunnelChart, Funnel, LabelList,
} from "recharts";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/dashboard")({
  component: () => (
    <RequirePermission anyOf={["dashboard_colecao","dashboard_estoque","dashboard_producao","dashboard_financeiro","dashboard_custos"]}>
      <Dashboard />
    </RequirePermission>
  ),
});

const PIE_COLORS = ["hsl(217 91% 60%)", "hsl(142 71% 45%)", "hsl(45 93% 47%)", "hsl(0 84% 60%)", "hsl(280 70% 60%)", "hsl(190 80% 50%)", "hsl(20 90% 55%)", "hsl(160 60% 45%)"];

function Dashboard() {
  const [tab, setTab] = useState("colecao");
  return (
    <div className="container mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral da coleção e do estoque.</p>
      </header>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="colecao">Coleção</TabsTrigger>
          <TabsTrigger value="estoque">Estoque</TabsTrigger>
          <TabsTrigger value="producao">Produção</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="custos">Custos</TabsTrigger>
        </TabsList>
        <TabsContent value="colecao" className="mt-4">{tab === "colecao" && <ColecaoTab />}</TabsContent>
        <TabsContent value="estoque" className="mt-4">{tab === "estoque" && <EstoqueTab />}</TabsContent>
        <TabsContent value="producao" className="mt-4">{tab === "producao" && <ProducaoTab />}</TabsContent>
        <TabsContent value="financeiro" className="mt-4">{tab === "financeiro" && <FinanceiroTab />}</TabsContent>
        <TabsContent value="custos" className="mt-4">{tab === "custos" && <CustosTab />}</TabsContent>
      </Tabs>
    </div>
  );
}

type Opt = { id: string; nome: string };

/* ============================ COLEÇÃO ============================ */

function ColecaoTab() {
  const [mes, setMes] = useState("all");
  const [ano, setAno] = useState("all");
  const [semana, setSemana] = useState("");
  const [colecao, setColecao] = useState("all");
  const [estilista, setEstilista] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["dash-colecao", mes, ano, semana, colecao, estilista],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_colecao", {
        p_mes: mes === "all" ? undefined : mes,
        p_ano: ano === "all" ? undefined : ano,
        p_semana: semana ? Number(semana) : undefined,
        p_colecao: colecao === "all" ? undefined : colecao,
        p_estilista: estilista === "all" ? undefined : estilista,
      });
      if (error) throw error;
      return data as any;
    },
  });

  const kpis = data?.kpis ?? { total: 0, planejamento: 0, desenvolvimento: 0, producao: 0, lancados: 0 };
  const funnel = (data?.funnel ?? []).map((f: any, i: number) => ({ ...f, fill: PIE_COLORS[i % PIE_COLORS.length] }));
  const pieData = data?.pie ?? [];
  const meses: Opt[] = data?.filtros?.meses ?? [];
  const anos: Opt[] = data?.filtros?.anos ?? [];
  const estilistas: Opt[] = data?.filtros?.estilistas ?? [];
  const colecoes: string[] = data?.filtros?.colecoes ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <FilterButton
          filters={[
            { label: "Mês", value: mes, onChange: setMes, options: [{ id: "all", nome: "Todos" }, ...meses] },
            { label: "Ano", value: ano, onChange: setAno, options: [{ id: "all", nome: "Todos" }, ...anos] },
            { label: "Semana", value: semana || "all", onChange: (v) => setSemana(v === "all" ? "" : v), options: [{ id: "all", nome: "Todas" }, ...["1","2","3","4","5"].map((s) => ({ id: s, nome: s }))] },
            { label: "Coleção", value: colecao, onChange: setColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.map((c) => ({ id: c, nome: c }))] },
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
  const { data, isLoading } = useQuery({
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
        <Kpi label={threshold > 0 ? `Itens com estoque ≤ ${threshold.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}` : "Itens com estoque ≤ 0"} value={zerados} icon={AlertTriangle} />
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
                      {Number(r.estoque).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
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
    </div>
  );
}

/* ============================ PRODUÇÃO ============================ */

function ProducaoTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["dash-producao"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_producao");
      if (error) throw error;
      return data as any;
    },
  });

  const timeline = data?.timeline ?? [];
  const slaPorTerc = data?.slaPorTerc ?? [];
  const kpiPrazo = data?.kpiPrazo ?? { noPrazo: 0, atrasadas: 0, pct: 0 };
  const etapas = ["CAD", "Terceirizado", "Oficina", "Controle de Qualidade", "Acabamento", "Direcionamento", "Lançado"];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Entregas no prazo" value={kpiPrazo.noPrazo} icon={BarChart3} />
        <Kpi label="Atrasadas" value={kpiPrazo.atrasadas} icon={AlertTriangle} />
        <Kpi label="% no prazo" value={Math.round(Number(kpiPrazo.pct) || 0)} icon={Sparkles} />
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Timeline por REF</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">REF</th>
                <th className="py-2 pr-3">Nome</th>
                {etapas.map((e) => <th key={e} className="py-2 px-2 text-center text-xs">{e}</th>)}
              </tr>
            </thead>
            <tbody>
              {timeline.map((r: any) => {
                const idx = etapas.indexOf(r.etapa);
                return (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{r.ref}</td>
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
                  <td className="py-2 pr-3 text-right">{Number(r.slaMedio ?? 0).toFixed(1)}</td>
                  <td className={"py-2 pr-3 text-right " + (Number(r.atrasos) > 0 ? "text-destructive" : "")}>{r.atrasos}</td>
                  <td className="py-2 pr-3 text-right">{r.total}</td>
                  <td className="py-2 pr-3 text-right">
                    {produzidas > 0 ? (
                      <span
                        className={"inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium " + badgeCls}
                        title={`${defeito} defeito${defeito === 1 ? "" : "s"} / ${produzidas} peça${produzidas === 1 ? "" : "s"}`}
                      >
                        {taxa.toFixed(1).replace(".", ",")}%
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
      </Card>
    </div>
  );
}

/* ============================ FINANCEIRO ============================ */

function FinanceiroTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["dash-financeiro"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_financeiro");
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
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Investido em matéria-prima</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{brl(investido)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total pago</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold text-green-600 dark:text-green-400">{brl(pago)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total pendente</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold text-yellow-600 dark:text-yellow-400">{brl(pendente)}</div></CardContent></Card>
      </div>
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Contas a pagar — próximos 6 meses</h3>
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
    </div>
  );
}

/* ============================ CUSTOS ============================ */

function CustosTab() {
  const [colecao, setColecao] = useState("all");
  const [mes, setMes] = useState("all");
  const [categoria, setCategoria] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["dash-custos", colecao, mes, categoria],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_custos", {
        p_colecao: colecao === "all" ? undefined : colecao,
        p_mes: mes === "all" ? undefined : mes,
        p_categoria: categoria === "all" ? undefined : categoria,
      });
      if (error) throw error;
      return data as any;
    },
  });

  const rows = data?.rows ?? [];
  const chartData = data?.chartData ?? [];
  const meses: Opt[] = data?.filtros?.meses ?? [];
  const categorias: Opt[] = data?.filtros?.categorias ?? [];
  const colecoes: string[] = data?.filtros?.colecoes ?? [];

  const brl = (v: number) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <FilterButton
          filters={[
            { label: "Coleção", value: colecao, onChange: setColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.map((c) => ({ id: c, nome: c }))] },
            { label: "Mês", value: mes, onChange: setMes, options: [{ id: "all", nome: "Todos" }, ...meses] },
            { label: "Categoria", value: categoria, onChange: setCategoria, options: [{ id: "all", nome: "Todas" }, ...categorias] },
          ]}
        />
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Custo previsto vs real</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">REF</th>
                <th className="py-2 pr-3">Modelo</th>
                <th className="py-2 pr-3 text-right">Previsto</th>
                <th className="py-2 pr-3 text-right">Real</th>
                <th className="py-2 pr-3 text-right">Diferença</th>
                <th className="py-2 pr-3 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{r.ref}</td>
                  <td className="py-2 pr-3">{r.nome}</td>
                  <td className="py-2 pr-3 text-right">{brl(r.previsto)}</td>
                  <td className="py-2 pr-3 text-right">{brl(r.real)}</td>
                  <td className={"py-2 pr-3 text-right " + (Number(r.diff) > 0 ? "text-destructive" : Number(r.diff) < 0 ? "text-green-600 dark:text-green-400" : "")}>{brl(r.diff)}</td>
                  <td className={"py-2 pr-3 text-right " + (Number(r.pct) > 0 ? "text-destructive" : Number(r.pct) < 0 ? "text-green-600 dark:text-green-400" : "")}>{Number(r.pct ?? 0).toFixed(1)}%</td>
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
