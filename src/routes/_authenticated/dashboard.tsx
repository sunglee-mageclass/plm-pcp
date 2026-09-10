import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PAGE_URLS } from "@/lib/nav";
import { cqLiberado } from "@/lib/cq-status";
import { ehOrigemComprada } from "@/lib/origem";
import { cn } from "@/lib/utils";
import { brl, brlAbrev, fmtNum, fmtPct, fmtInt } from "@/lib/format";
import { useIsMobile } from "@/hooks/use-mobile";
import { SegmentedTabs, MobileFilterBar, KpiCardMobile, ChartSheet } from "@/components/dashboard/mobile";
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
import { BarChart3, Package, Palette, Boxes, AlertTriangle, Layers, Sparkles, Printer, CheckCircle2, ClipboardCheck, Factory, DollarSign, Tag, ArrowUp, ArrowDown, Minus, Check, X, Timer, Gauge, ChevronDown, ChevronRight, Split } from "lucide-react";
import { format } from "date-fns";
import { FilterButton } from "@/components/shared/filters";
import { Button } from "@/components/ui/button";
import { PeriodoPicker, type Periodo } from "@/components/shared/PeriodoPicker";
import {
  CHART_SERIE, CHART_SEQ, CHART_AGE,
  TONE_BG, TONE_FG, type Tone,
} from "@/lib/chart-colors";
import {
  FASES, idealLookup, itemTotais, heroStats, seqIndexRatio, seqTextToken, bulletScaleMax,
  metaConfig, splitFaseSub, promoverExtintos, detalharOutros,
  type HeroStats, type FaseTotais,
} from "@/lib/leadtime";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
 LabelList,
} from "recharts";

import { RequirePermission } from "@/components/RequirePermission";
import { ModuleGuard } from "@/components/ModuleGuard";
import { useAuth } from "@/hooks/useAuth";
export const Route = createFileRoute("/_authenticated/dashboard")({
  component: () => (
    <ModuleGuard module="dashboard">
      <RequirePermission anyOf={["dashboard_desenvolvimento","dashboard_producao_qualidade","dashboard_comercial_colecao","dashboard_custo_financeiro","dashboard_leadtime"]}>
        <Dashboard />
      </RequirePermission>
    </ModuleGuard>
  ),
});

// Cores de gráfico: fonte ÚNICA em src/lib/chart-colors.ts (tokens --chart-* de styles.css,
// §R). Série única = CHART_SERIE (1 matiz navy); ordinal = CHART_SEQ; idade do WIP = CHART_AGE.

const isoDate = (d?: Date) => (d ? format(d, "yyyy-MM-dd") : undefined);

const DASH_TABS = [
  { value: "desenvolvimento", label: "Desenvolvimento", Comp: DesenvolvimentoTab },
  { value: "producao_qualidade", label: "Produção & Qualidade", Comp: ProducaoQualidadeTab },
  { value: "comercial_colecao", label: "Comercial & Coleção", Comp: ComercialColecaoTab },
  { value: "custo_financeiro", label: "Custo & Financeiro", Comp: CustoFinanceiroTab },
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
          <h1 className="font-display text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Visão geral da coleção e do estoque.</p>
        </div>
      </header>
      <Tabs value={active} onValueChange={setTab}>
        {/* Mobile: segmented control rolável (Onda A — as abas ficavam apertadas no celular;
            o dropdown foi trocado por pílulas roláveis, ativa em navy). Desktop: o TabsList vai
            DENTRO da toolbar de cada aba (mr-auto), via <DashTabsList />. */}
        <div className="md:hidden">
          <SegmentedTabs tabs={tabs.map((t) => ({ value: t.value, label: t.label }))} value={active} onChange={setTab} />
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


// Estágios do destrinche por LINHA — MESMOS rótulos dos KPI cards da aba (a soma dos 4 =
// total da linha). São ORDINAIS (planejamento → lançados), então usam a rampa SEQUENCIAL
// navy (§R: ordinal = 1 matiz claro→escuro), não matizes cicladas. Drive a barra empilhada;
// as colunas da tabela só usam os rótulos. Casa com os campos de porLinha da RPC.



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

// Bloco de DETALHE recolhido por padrão (o "detalhamento a 1 clique" das abas por gestor —
// mesma filosofia do Leadtime: resumo primeiro, lista extensa só quando o gestor quer investigar).
function DetalheExpansivel({ titulo, sub, children }: { titulo: string; sub?: string; children: ReactNode }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {aberto ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="font-semibold">{titulo}</span>
        {sub && <span className="text-sm font-normal text-muted-foreground">· {sub}</span>}
      </button>
      {aberto && <div className="border-t p-4">{children}</div>}
    </Card>
  );
}

/* ============================ ESTOQUE ============================ */


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


// Produção por CATEGORIA DE SERVIÇO (Corte/Oficina/PL/…). Uma chamada por seleção à RPC
// dashboard_producao_servicos; herda o filtro global da aba (período/coleção/linha) por props.
//   • Em produção (foto atual): categoria=Todas => barras POR SERVIÇO (quem tem mais WIP agora);
//     categoria específica => barras POR IDADE (dias desde o envio, escala sequencial).
//   • Entregue (série temporal): barras por MÊS da data_entregue.
// Toggle Modelos | Peças = as 2 visões de cada gráfico.


/* ============================ FINANCEIRO ============================ */

// Rótulo do tipo de OC de uma parcela a pagar (o cadastro de parcela não tem fornecedor
// denormalizado — Onda B usa o tipo da OC + o nº da parcela, sem RPC/join novo).
const TIPO_OC_LABEL: Record<string, string> = {
  tecido: "OC de Tecido",
  aviamento: "OC de Aviamento",
  etiqueta: "OC de Insumo",
  p_acabado: "OC Produto Acabado",
};

/* ================== CUSTO & FINANCEIRO (visão por gestor) ================== */

// Aba "Custo & Financeiro" (visão por gestor de controladoria): abre com "Ação de hoje" (a pagar
// em aberto + vencendo 30d, estoque parado R$, investido em MP, % pago) + custo previsto×real top-4
// divergentes + a pagar próximos meses. Só RPCs existentes (dashboard_financeiro/estoque_parado/
// custos) — zero banco. "A vencer 30 dias" deriva do aging (Vencido + 0–30 dias).
function CustoFinanceiroTab() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [periodo, setPeriodo] = useState<Periodo>(undefined);
  const ini = isoDate(periodo?.from), fim = isoDate(periodo?.to);

  const fin = useQuery({
    queryKey: ["dash-financeiro", ini, fim],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_financeiro" as never, { p_inicio: ini, p_fim: fim } as never);
      if (error) throw error;
      return data as any;
    },
  });
  const parado = useQuery({
    queryKey: ["dash-estoque-parado"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_estoque_parado" as never);
      if (error) throw error;
      return data as any;
    },
  });
  const custos = useQuery({
    queryKey: ["dash-custos", ini, fim, "all", "all", "all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_custos" as never, {
        p_inicio: ini, p_fim: fim, p_colecao: undefined, p_categoria: undefined, p_linha: undefined,
      } as never);
      if (error) throw error;
      return data as any;
    },
  });

  const investido = Number(fin.data?.investido ?? 0);
  const pago = Number(fin.data?.pago ?? 0);
  const pendente = Number(fin.data?.pendente ?? 0);
  const pctPago = pago + pendente > 0 ? Math.round((pago / (pago + pendente)) * 100) : 0;
  const aging: any[] = fin.data?.aging ?? [];
  // "A vencer em 30 dias" = já vencido + a vencer nos próximos 30 dias (do aging, snapshot atual).
  const vencendo30 = useMemo(() => {
    const get = (f: string) => Number((aging.find((a) => a.faixa === f)?.total) ?? 0);
    return get("Vencido") + get("0–30 dias");
  }, [aging]);
  const chartData: any[] = fin.data?.chartData ?? [];
  const estoqueParado = Number(parado.data?.total ?? 0);

  // Top-4 modelos com maior divergência custo previsto×real (só confirmados; dados já em rows).
  const rowsCusto: any[] = custos.data?.rows ?? [];
  const topDiverg = useMemo(
    () => rowsCusto.filter((r) => r.confirmado).slice().sort((a, b) => Math.abs(Number(b.pct) || 0) - Math.abs(Number(a.pct) || 0)).slice(0, 4),
    [rowsCusto],
  );

  const isLoading = fin.isLoading || parado.isLoading || custos.isLoading;
  const isError = fin.isError || parado.isError || custos.isError;

  // ——— KPIs "Ação de hoje" ———
  const kpis = (
    <>
      <Kpi label="A pagar (em aberto)" value={brl(pendente)} icon={DollarSign} tone={vencendo30 > 0 ? "warning" : undefined} sub={`${brl(vencendo30)} vencidos ou a vencer em 30 dias`} />
      <Kpi label="Estoque parado" value={brl(estoqueParado)} icon={Boxes} tone={estoqueParado > 0 ? "warning" : "success"} sub="tecido físico sem uso nem reserva" />
      <Kpi label="Investido em MP" value={brl(investido)} icon={Package} sub="tecido + aviamento recebidos no período" />
      <Card className="p-4">
        <h3 className="text-xs font-medium text-muted-foreground mb-2">% pago</h3>
        <div className="flex items-center gap-3">
          <div className="text-3xl font-bold leading-none tabular-nums" style={{ color: TONE_FG[pctPago >= 70 ? "success" : pctPago >= 40 ? "warning" : "danger"] }}>{pctPago}%</div>
          <div className="text-[11px] text-muted-foreground">{brl(pago)} pago de {brl(pago + pendente)}</div>
        </div>
      </Card>
    </>
  );

  // ——— Custo previsto × real (top-4 divergentes) ———
  const cardDiverg = (
    <Card className="p-4 cursor-pointer transition-colors hover:border-primary/40" role="button" tabIndex={0}
      onClick={() => navigate({ to: PAGE_URLS.criacao_desenvolvimento })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate({ to: PAGE_URLS.criacao_desenvolvimento }); } }}>
      <h3 className="font-semibold mb-3">Custo previsto × real — onde estourou <span className="text-sm font-normal text-muted-foreground">· top 4 divergentes</span></h3>
      {topDiverg.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum modelo confirmado com divergência no período.</p>
      ) : (
        <div className="space-y-1.5">
          {topDiverg.map((r) => {
            const pct = Number(r.pct) || 0;
            const tone: Tone = pct > 15 ? "danger" : pct > 0 ? "warning" : "success";
            return (
              <div key={r.id} className="flex items-center gap-2.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-sm">
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums" style={{ background: TONE_BG[tone], color: TONE_FG[tone] }}>{pct > 0 ? "+" : ""}{fmtInt(pct)}%</span>
                <span className="min-w-0 flex-1 truncate">{r.ref ? `${r.ref} · ` : ""}{r.nome}</span>
                <span className="shrink-0 text-xs text-muted-foreground">prev {fmtInt(r.previsto)} → real {fmtInt(r.real)}</span>
              </div>
            );
          })}
          <p className="pt-1 text-xs text-muted-foreground">variação = (real − previsto) ÷ previsto</p>
        </div>
      )}
    </Card>
  );

  // ——— A pagar próximos meses ———
  const cardAPagar = (
    <MonthBarCard title="A pagar — próximos meses" subtitle="parcelas em aberto por mês de vencimento (R$)" data={chartData} dataKey="total" name="A pagar" color={CHART_SERIE} empty="Sem parcelas em aberto." loading={fin.isLoading} />
  );

  if (isMobile) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><MobileFilterBar periodo={periodo} onPeriodo={setPeriodo} /></div>
        <div className="grid grid-cols-2 gap-2.5">
          <KpiCardMobile compact label="A pagar (aberto)" value={brlAbrev(pendente)} valueTitle={brl(pendente)} sub={`${brlAbrev(vencendo30)} em 30d`} />
          <KpiCardMobile compact label="Estoque parado" value={brlAbrev(estoqueParado)} valueTitle={brl(estoqueParado)} sub="sem uso/reserva" />
          <KpiCardMobile compact label="Investido em MP" value={brlAbrev(investido)} valueTitle={brl(investido)} sub="no período" />
          <KpiCardMobile compact label="% pago" value={`${pctPago}%`} sub={`${brlAbrev(pago)} pago`} />
        </div>
        {cardDiverg}
        {cardAPagar}
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        <DashError show={isError} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DashTabsList />
        <div className="hidden md:contents"><PeriodoPicker value={periodo} onChange={setPeriodo} /></div>
        <MobileFilterBar className="md:hidden" periodo={periodo} onPeriodo={setPeriodo} />
      </div>
      <SecHeader icon={Sparkles}>Ação de hoje</SecHeader>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{kpis}</div>
      <div className="grid gap-4 lg:grid-cols-2">{cardDiverg}{cardAPagar}</div>
      <DetalheExpansivel titulo="Custo previsto × real — todos os modelos" sub={`${rowsCusto.length} modelo(s)`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm card-table">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">REF</th>
                <th className="py-2 pr-3">Modelo</th>
                <th className="py-2 pr-3 text-right">Previsto</th>
                <th className="py-2 pr-3 text-right">Real</th>
                <th className="py-2 pr-3 text-right">Δ variação</th>
              </tr>
            </thead>
            <tbody>
              {[...rowsCusto].sort((a, b) => Math.abs(Number(b.pct) || 0) - Math.abs(Number(a.pct) || 0)).map((r) => {
                const pct = Number(r.pct) || 0;
                const cor = pct > 15 ? "var(--tone-danger-fg)" : pct > 0 ? "var(--tone-warning-fg)" : pct < 0 ? "var(--tone-success-fg)" : "var(--muted-foreground)";
                return (
                  <tr key={r.id} className="border-t">
                    <td className="py-2 pr-3 num" data-label="REF">{r.ref ?? "—"}{r.versao ? <span className="text-muted-foreground"> v{r.versao}</span> : null}</td>
                    <td className="py-2 pr-3" data-label="Modelo">{r.nome}{!r.confirmado && <span className="text-[11px] text-muted-foreground"> · previsto</span>}</td>
                    <td className="py-2 pr-3 text-right num" data-label="Previsto">{brl(r.previsto)}</td>
                    <td className="py-2 pr-3 text-right num" data-label="Real">{r.confirmado ? brl(r.real) : "—"}</td>
                    <td className="py-2 pr-3 text-right num font-semibold" data-label="Δ variação" style={{ color: cor }}>{r.confirmado ? `${pct > 0 ? "+" : ""}${fmtInt(pct)}%` : "—"}</td>
                  </tr>
                );
              })}
              {rowsCusto.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">Sem dados de custo no filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </DetalheExpansivel>
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


/* ============================ COMERCIAL ============================ */

// Poder de venda / margem por Coleção e Linha — POTENCIAL (grade planejada) vs
// REALIZADO (grade real do CQ). Cálculo no FRONT reusando @/lib/preco (fonte ÚNICA
// de preço; não replicar em SQL); sem RPC nova — custo_unitario_modelos (tenant-safe)
// + queries RLS por tenant. Espelha o "poder de venda" do Planejamento/Lançamentos.

// Nome PRÓPRIO (distinto do `fmtPct` de src/lib/format.ts, 1 casa decimal) — este é
// 0 casas + fallback "—" p/ v<=0, usado só nesta aba Comercial.
const fmtPctComercial = (v: number) => (v > 0 ? `${fmtInt(v)}%` : "—");
const fmtMkp = (v: number) => (v > 0 ? `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}×` : "—");

// Tabela com DOIS grupos de colunas claramente separados: Planejado (orçamento, grade
// planejada) vs Realizado (feito, grade real). Cor + borda separam as duas contas.

/* ================== COMERCIAL & COLEÇÃO (visão por gestor) ================== */

// Aba "Comercial & Coleção" (visão por gestor comercial): abre com o RESULTADO da coleção (poder
// de venda, margem, lucro, ticket) + poder de venda por linha (planejado × realizado, barras %) +
// margem por linha vs a faixa cadastrada (markup_min/ideal). Mesma matemática da ComercialTab
// (preco.ts, fonte única) — reusa o padrão de agregação por linha; ZERO RPC nova (só
// custo_unitario_modelos + grade, já usados). Detalhe completo abre na aba "Comercial" (tabelas).
function ComercialColecaoTab() {
  const isMobile = useIsMobile();
  const [fColecao, setFColecao] = useState("all");
  const [fSubcolecao, setFSubcolecao] = useState("all");

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
    queryKey: ["comercial-col-modelos", fColecao, fSubcolecao],
    queryFn: async () => {
      // embed estende a ComercialTab com markup_min/markup_max (faixa da linha) p/ o status por faixa.
      let q = supabase.from("modelos").select("id, colecao, linha_id, preco_venda, markup_editado, linha:linha_id(nome, markup, markup_min, markup_max)");
      if (fColecao !== "all") q = q.eq("colecao", fColecao);
      if (fSubcolecao !== "all") q = q.eq("subcolecao", fSubcolecao);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const ids = useMemo(() => modelos.map((m) => m.id).sort(), [modelos]);

  const { data: custoMap = {}, isFetching: custoLoading } = useQuery({
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

  // Agrega por LINHA (mesma matemática da ComercialTab) + guarda a faixa (min/ideal) e a grade
  // para o ticket. tot = total geral.
  type LinRow = { key: string; nome: string; pvPlan: number; pvReal: number; lucroPlan: number; lucroReal: number; gradePlan: number; gradeReal: number; markupMin: number | null; markupIdeal: number | null; };
  const { porLinha, porColecao, tot } = useMemo(() => {
    const ml = new Map<string, LinRow>();
    const mc = new Map<string, LinRow>();
    let tPvPlan = 0, tPvReal = 0, tLuPlan = 0, tLuReal = 0, tGp = 0, tGr = 0;
    const acc = (map: Map<string, LinRow>, key: string, nome: string, m: any, pvP: number, pvR: number, luP: number, luR: number, gp: number, gr: number) => {
      let r = map.get(key);
      if (!r) r = { key, nome, pvPlan: 0, pvReal: 0, lucroPlan: 0, lucroReal: 0, gradePlan: 0, gradeReal: 0, markupMin: m.linha?.markup_min ?? null, markupIdeal: m.linha?.markup ?? null };
      r.pvPlan += pvP; r.pvReal += pvR; r.lucroPlan += luP; r.lucroReal += luR; r.gradePlan += gp; r.gradeReal += gr;
      map.set(key, r);
    };
    for (const m of modelos) {
      const cu = (custoMap as any)[m.id];
      const custo = Number(cu?.real) || Number(cu?.previsto) || 0;
      const pi = precoInfo(custo, m.linha?.markup, m.preco_venda, m.markup_editado);
      const gp = Number((gradePlan as any)[m.id]) || 0;
      const gr = Number((gradeReal as any)[m.id]) || 0;
      const pvP = pi.efetivo * gp, pvR = pi.efetivo * gr, luP = (pi.efetivo - custo) * gp, luR = (pi.efetivo - custo) * gr;
      acc(ml, m.linha_id ?? "__none__", (m.linha?.nome as string) || "Sem linha", m, pvP, pvR, luP, luR, gp, gr);
      acc(mc, m.colecao ?? "__none__", m.colecao || "Sem coleção", m, pvP, pvR, luP, luR, gp, gr);
      tPvPlan += pvP; tPvReal += pvR; tLuPlan += luP; tLuReal += luR; tGp += gp; tGr += gr;
    }
    const rows = Array.from(ml.values()).sort((a, b) => b.pvPlan - a.pvPlan);
    const rowsCol = Array.from(mc.values()).sort((a, b) => b.pvPlan - a.pvPlan);
    const custoRealT = tPvReal - tLuReal, custoPlanT = tPvPlan - tLuPlan;
    const tot = {
      pvPlan: tPvPlan, pvReal: tPvReal, lucroPlan: tLuPlan, lucroReal: tLuReal, gradePlan: tGp, gradeReal: tGr,
      margemPlan: tPvPlan > 0 ? (tLuPlan / tPvPlan) * 100 : 0,
      margemReal: tPvReal > 0 ? (tLuReal / tPvReal) * 100 : 0,
      markupReal: custoRealT > 0 ? tPvReal / custoRealT : (custoPlanT > 0 ? tPvPlan / custoPlanT : 0),
      // ticket = poder de venda ÷ peças (real quando há grade real; senão planejado).
      ticket: tGr > 0 ? tPvReal / tGr : (tGp > 0 ? tPvPlan / tGp : 0),
    };
    return { porLinha: rows, porColecao: rowsCol, tot };
  }, [modelos, custoMap, gradePlan, gradeReal]);

  // % da meta (poder de venda realizado ÷ planejado) — barras por linha.
  const pctMeta = tot.pvPlan > 0 ? Math.round((tot.pvReal / tot.pvPlan) * 100) : 0;
  const maxPv = useMemo(() => Math.max(1, ...porLinha.map((r) => r.pvPlan)), [porLinha]);

  // markup real por linha × faixa cadastrada (min/ideal). Status: ideal (≥ ideal) / min (≥ min,
  // < ideal) / abaixo (< min) / indef (sem faixa ou sem markup).
  const markupRealDe = (r: LinRow) => { const c = r.pvReal - r.lucroReal; return c > 0 ? r.pvReal / c : 0; };
  const statusFaixa = (mkp: number, min: number | null, ideal: number | null): "ideal" | "min" | "abaixo" | "indef" => {
    if (mkp <= 0 || (min == null && ideal == null)) return "indef";
    if (ideal != null && mkp >= ideal) return "ideal";
    if (min != null && mkp >= min) return "min";
    return "abaixo";
  };
  const toneFaixa: Record<string, Tone> = { ideal: "success", min: "warning", abaixo: "danger", indef: "info" };
  const txtFaixa: Record<string, string> = { ideal: "no ideal ou acima", min: "abaixo do ideal", abaixo: "abaixo do mínimo · revisar preço", indef: "faixa não definida" };

  const isLoad = isLoading || custoLoading;
  const filtros = [
    { label: "Coleção", value: fColecao, onChange: setFColecao, options: [{ id: "all", nome: "Todas" }, ...opts.colecoes.map((c) => ({ id: c, nome: c }))], single: true as const },
    { label: "Subcoleção", value: fSubcolecao, onChange: setFSubcolecao, options: [{ id: "all", nome: "Todas" }, ...opts.subcolecoes.map((c) => ({ id: c, nome: c }))], single: true as const },
  ];

  const kpis = (
    <>
      <Kpi label="Poder de venda" value={brl(tot.pvPlan)} icon={Tag} sub={`realizado ${brl(tot.pvReal)} · ${pctMeta}% da meta`} tone={pctMeta >= 80 ? "success" : pctMeta >= 50 ? "warning" : "danger"} />
      <Kpi label="Margem média" value={fmtPctComercial(tot.margemReal || tot.margemPlan)} icon={Sparkles} sub={tot.margemReal > 0 ? `markup real ${fmtMkp(tot.markupReal)}` : "planejado (sem realizado ainda)"} />
      <Kpi label="Lucro bruto" value={brl(tot.lucroPlan)} icon={DollarSign} sub={`realizado ${brl(tot.lucroReal)}`} />
      <Kpi label="Ticket médio" value={brl(tot.ticket)} icon={Layers} sub="preço médio por peça" />
    </>
  );

  const cardPvLinha = (
    <Card className="p-4">
      <h3 className="font-semibold mb-3">Poder de venda por linha <span className="text-sm font-normal text-muted-foreground">· planejado (barra) · realizado (%)</span></h3>
      {porLinha.length === 0 ? <p className="text-sm text-muted-foreground">Sem dados.</p> : (
        <div className="space-y-2.5">
          {porLinha.slice(0, 8).map((r) => {
            const pct = r.pvPlan > 0 ? Math.round((r.pvReal / r.pvPlan) * 100) : 0;
            return (
              <div key={r.key}>
                <div className="flex justify-between text-sm"><span className="truncate">{r.nome}</span><span className="font-semibold tabular-nums">{brlAbrev(r.pvPlan)} · <span style={{ color: TONE_FG[pct >= 80 ? "success" : pct >= 50 ? "warning" : "danger"] }}>{pct}%</span></span></div>
                <div className="mt-1 h-2.5 overflow-hidden rounded bg-muted"><div className="h-full rounded" style={{ width: `${Math.max(2, Math.round((r.pvPlan / maxPv) * 100))}%`, background: CHART_SERIE }} /></div>
              </div>
            );
          })}
          <p className="pt-1 text-xs text-muted-foreground">largura = poder de venda planejado; % = realizado sobre planejado</p>
        </div>
      )}
    </Card>
  );

  const cardMargem = (
    <Card className="p-4">
      <h3 className="font-semibold mb-3">Margem por linha — dentro da faixa? <span className="text-sm font-normal text-muted-foreground">· markup real vs faixa da linha</span></h3>
      {porLinha.length === 0 ? <p className="text-sm text-muted-foreground">Sem dados.</p> : (
        <div className="space-y-1.5">
          {porLinha.slice(0, 8).map((r) => {
            const mkp = markupRealDe(r);
            const st = statusFaixa(mkp, r.markupMin, r.markupIdeal);
            return (
              <div key={r.key} className="flex items-center gap-2.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-sm">
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums" style={{ background: TONE_BG[toneFaixa[st]], color: TONE_FG[toneFaixa[st]] }}>{fmtMkp(mkp)}</span>
                <span className="min-w-0 flex-1 truncate">{r.nome}</span>
                <span className="shrink-0 text-xs" style={{ color: TONE_FG[toneFaixa[st]] }}>{txtFaixa[st]}</span>
              </div>
            );
          })}
          <p className="pt-1 text-xs text-muted-foreground">faixa da linha = markup mínimo · ideal (cadastrados em Atributos → Linha)</p>
        </div>
      )}
    </Card>
  );

  if (isMobile) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2"><MobileFilterBar filters={filtros} /></div>
        <div className="grid grid-cols-2 gap-2.5">
          <KpiCardMobile compact label="Poder de venda" value={brlAbrev(tot.pvPlan)} valueTitle={brl(tot.pvPlan)} sub={`${pctMeta}% da meta`} />
          <KpiCardMobile compact label="Margem média" value={fmtPctComercial(tot.margemReal || tot.margemPlan)} sub={tot.margemReal > 0 ? `markup ${fmtMkp(tot.markupReal)}` : "planejado"} />
          <KpiCardMobile compact label="Lucro bruto" value={brlAbrev(tot.lucroPlan)} valueTitle={brl(tot.lucroPlan)} sub={`real. ${brlAbrev(tot.lucroReal)}`} />
          <KpiCardMobile compact label="Ticket médio" value={brl(tot.ticket)} sub="preço médio/peça" />
        </div>
        {cardPvLinha}
        {cardMargem}
        {isLoad && <p className="text-sm text-muted-foreground">Carregando…</p>}
        <DashError show={isError} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DashTabsList />
        <FilterButton screen="dashboard-comercial-colecao" filters={filtros} />
      </div>
      <SecHeader icon={Tag}>Resultado da coleção</SecHeader>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{kpis}</div>
      <div className="grid gap-4 lg:grid-cols-2">{cardPvLinha}{cardMargem}</div>
      <DetalheExpansivel titulo="Por coleção — planejado × realizado" sub="poder de venda, lucro, margem e markup">
        <div className="overflow-x-auto">
          <table className="w-full text-sm card-table">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Coleção</th>
                <th className="py-2 pr-3 text-right">PV plan.</th>
                <th className="py-2 pr-3 text-right">PV real.</th>
                <th className="py-2 pr-3 text-right">Lucro real.</th>
                <th className="py-2 pr-3 text-right">Margem real.</th>
                <th className="py-2 pr-3 text-right">Markup real.</th>
              </tr>
            </thead>
            <tbody>
              {porColecao.map((r) => {
                const cReal = r.pvReal - r.lucroReal;
                const margemReal = r.pvReal > 0 ? (r.lucroReal / r.pvReal) * 100 : 0;
                const markupReal = cReal > 0 ? r.pvReal / cReal : 0;
                return (
                  <tr key={r.key} className="border-t">
                    <td className="py-2 pr-3" data-label="Coleção">{r.nome}</td>
                    <td className="py-2 pr-3 text-right num" data-label="PV plan.">{brlAbrev(r.pvPlan)}</td>
                    <td className="py-2 pr-3 text-right num" data-label="PV real.">{brlAbrev(r.pvReal)}</td>
                    <td className="py-2 pr-3 text-right num" data-label="Lucro real.">{brlAbrev(r.lucroReal)}</td>
                    <td className="py-2 pr-3 text-right num" data-label="Margem real.">{fmtPctComercial(margemReal)}</td>
                    <td className="py-2 pr-3 text-right num" data-label="Markup real.">{fmtMkp(markupReal)}</td>
                  </tr>
                );
              })}
              {porColecao.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">Sem dados no filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </DetalheExpansivel>
      {isLoad && <p className="text-sm text-muted-foreground">Carregando…</p>}
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
function BulletSection({ icon, titulo, etapas, labelDe, preservarOrdem }: { icon: any; titulo: string; etapas: any[]; labelDe: (e: any) => string; preservarOrdem?: boolean }) {
  if (etapas.length === 0) return null;
  const badness = (e: any) => {
    const ideal = Number(e.idealDias) || 0;
    if (e.slaCol) return (100 - (Number(e.pctNoPrazo) || 0)) / 100;
    return ideal > 0 ? (Number(e.duracaoMedia) || 0) / ideal : 0;
  };
  // `preservarOrdem` = mantém a ordem RECEBIDA (ex.: a sequência do kanban configurado, que é uma
  // progressão, não um ranking). Sem ela, ordena do PIOR pro melhor (prioriza o gargalo).
  const ord = preservarOrdem ? [...etapas] : [...etapas].sort((a, b) => badness(b) - badness(a));
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

/* ====================== DESENVOLVIMENTO (visão por gestor) ====================== */

// Aba "Desenvolvimento" (visão por gestor de Criação): abre com a RESPOSTA (Ação de hoje:
// travados vs SLA, em atenção, prontos p/ lançar, maior gargalo) + top-4 "o que destravar"
// + modelos por etapa do kanban + funil da coleção. Listas longas viram top-N; o detalhe
// completo abre clicando (→ tela de Desenvolvimento). Consome só RPCs existentes:
//   - dashboard_leadtime_itens (por-item, duracoes etapa→dias; filtro client-side) — base do
//     gargalo, travados/atenção e "o que destravar";
//   - dashboard_producao (kanbanDev por etapa; filtro coleção/período server-side);
//   - dashboard_colecao (funnel).
function DesenvolvimentoTab() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const irParaDesenvolvimento = () => navigate({ to: PAGE_URLS.criacao_desenvolvimento });

  // Filtro: Coleção + Subcoleção. Coleção afina TUDO (server-side no kanban/funil + client-side
  // nos itens). Subcoleção afina só o que é client-side (KPIs de topo + "o que destravar") — o
  // kanban e o funil vêm por COLEÇÃO da RPC (não têm recorte por subcoleção); os cards marcam
  // isso no subtítulo ("· por coleção") p/ não parecer contradição. SEM PeriodoPicker aqui: o
  // leadtime_itens não é filtrado por período, então um período moveria kanban/funil mas não os
  // KPIs — incoerência evitada removendo o controle (o gestor de Dev filtra por coleção).
  const [colecao, setColecao] = useState("all");
  const [subcol, setSubcol] = useState("all");

  const det = useQuery({
    queryKey: ["dash-leadtime-itens"],
    queryFn: async () => { const { data, error } = await supabase.rpc("dashboard_leadtime_itens" as never); if (error) throw error; return data as any; },
  });
  const skel = useQuery({
    queryKey: ["dash-leadtime"],
    queryFn: async () => { const { data, error } = await supabase.rpc("dashboard_leadtime" as never); if (error) throw error; return data as any; },
  });
  const prod = useQuery({
    queryKey: ["dash-producao", undefined, undefined, colecao, "all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_producao" as never, {
        p_inicio: undefined, p_fim: undefined, p_colecao: colecao === "all" ? undefined : colecao, p_linha: undefined,
      } as never);
      if (error) throw error;
      return data as any;
    },
  });
  const col = useQuery({
    queryKey: ["dash-colecao", undefined, undefined, colecao, "all", "all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_colecao" as never, {
        p_inicio: undefined, p_fim: undefined, p_colecao: colecao === "all" ? undefined : colecao, p_estilista: undefined, p_linha: undefined,
      } as never);
      if (error) throw error;
      return data as any;
    },
  });
  // Escopo dos cards por-coleção: quando há Subcoleção ativa, os KPIs de topo são por Subcoleção
  // mas kanban/funil seguem por Coleção — o subtítulo avisa (evita comparação enganosa).
  const escopoColecao = subcol !== "all" ? " · por coleção" : "";

  const etapas: any[] = skel.data?.etapas ?? [];
  const itens: any[] = det.data?.itens ?? [];
  const slaServico: string | null = det.data?.slaServico ?? null;
  const lookup = idealLookup(etapas);

  const uniq = (vals: any[]) => Array.from(new Set(vals.filter((v) => v != null && v !== ""))).sort();
  const colecoes = uniq(itens.map((i) => i.colecao));
  const subcols = uniq(itens.map((i) => i.subcolecao));
  const filtItens = itens.filter(
    (i) =>
      (colecao === "all" || (i.colecao ?? "") === colecao) &&
      (subcol === "all" || (i.subcolecao ?? "") === subcol),
  );

  // Ideal por etapa de um item (na etapa do SLA, usa o SLA da Subcategoria do item).
  const idealDe = (it: any, etapaKey: string) =>
    etapaKey === slaServico && it.sub1_sla != null ? Number(it.sub1_sla) : (lookup.get(etapaKey) ?? 0);

  // Por item: soma de dias e "excesso" (dias acima da meta somados pelas etapas concluídas).
  const comExcesso = filtItens.map((it) => {
    let total = 0, excesso = 0, piorEtapa = "", piorRatio = 0;
    for (const [etapaKey, diasRaw] of Object.entries(it.duracoes ?? {})) {
      const dias = Number(diasRaw); if (!(dias > 0)) continue;
      total += dias;
      const ideal = idealDe(it, etapaKey);
      if (ideal > 0 && dias > ideal) {
        excesso += dias - ideal;
        const ratio = dias / ideal;
        if (ratio > piorRatio) { piorRatio = ratio; piorEtapa = etapaKey; }
      }
    }
    return { it, total, excesso, piorEtapa, piorRatio };
  });

  // KPIs "Ação de hoje" derivados dos itens filtrados:
  //  - Travados vs SLA = itens com ≥1 etapa acima de 1,5× a meta (vermelho).
  //  - Em atenção = itens acima da meta mas ≤1,5× (amarelo), sem nenhum vermelho.
  const travados = comExcesso.filter((x) => x.piorRatio > 1.5).length;
  const atencao = comExcesso.filter((x) => x.piorRatio > 1 && x.piorRatio <= 1.5).length;

  // Maior gargalo (mesma lógica do LeadtimeTab): pior razão real/meta entre as etapas
  // configuradas, preferindo as com ≥3 modelos p/ um outlier não dominar.
  const hero = heroStats(filtItens, lookup, slaServico);
  const statByEtapa = (etapaKey: string, idealFixo: number) => {
    let s = 0, n = 0;
    for (const it of filtItens) {
      const d = it.duracoes?.[etapaKey]; if (d == null) continue;
      n++; s += Number(d);
    }
    const media = n ? Math.round((s / n) * 10) / 10 : 0;
    return { media, n, ratio: idealFixo > 0 ? media / idealFixo : 0 };
  };
  const kanbanLabelByKey = new Map<string, string>();
  for (const s of normalizeKanbanStatuses(skel.data?.kanbanOrder)) kanbanLabelByKey.set("kanban:" + s.key, s.label);
  for (const s of DEFAULT_STATUSES) if (!kanbanLabelByKey.has("kanban:" + s.key)) kanbanLabelByKey.set("kanban:" + s.key, s.label);
  const etapaLabel = (e: any) => (String(e.etapa).startsWith("kanban:") ? (kanbanLabelByKey.get(e.etapa) ?? e.label) : e.label);
  const gargalo = etapas
    .filter((e) => (Number(e.idealDias) || 0) > 0 && e.etapa !== slaServico)
    .map((e) => ({ label: etapaLabel(e), ideal: Number(e.idealDias) || 0, ...statByEtapa(e.etapa, Number(e.idealDias) || 0) }))
    .filter((e) => e.n > 0)
    .sort((a, b) => (b.n >= 3 ? b.ratio : 0) - (a.n >= 3 ? a.ratio : 0) || b.ratio - a.ratio)[0];

  // "No status Aprovado": modelos na coluna "aprovado" do kanban. A RPC dashboard_producao já
  // exclui os lançados desse balde (CASE WHEN m.lancado THEN 'Lançado' vem primeiro), então são
  // aprovados AINDA não lançados — mas NÃO garante CQ/Direcionamento feitos; por isso o rótulo
  // diz "no status Aprovado", não "prontos p/ lançar" (seria promessa que o dado não sustenta).
  const kanbanDev: any[] = prod.data?.kanbanDev ?? [];
  const aprovados = (() => {
    // Prefere a coluna com key exata "aprovado"; só então cai no match por label (evita pegar
    // "Pré-aprovado" ou outra coluna cujo label contenha "aprovad").
    const aprovado = kanbanDev.find((k) => k.key === "aprovado") ?? kanbanDev.find((k) => /aprovad/i.test(String(k.label)));
    return aprovado ? Number(aprovado.modelos ?? 0) : 0;
  })();

  // Top-4 "o que destravar" = itens com maior EXCESSO acumulado vs meta (os que mais atrasam).
  const topDestravar = [...comExcesso]
    .filter((x) => x.excesso > 0)
    .sort((a, b) => b.excesso - a.excesso)
    .slice(0, 4);

  const funnel: any[] = col.data?.funnel ?? [];
  const funnelTopo = Number(funnel[0]?.value ?? 0) || 1;

  const isLoading = det.isLoading || skel.isLoading || prod.isLoading;
  const isError = det.isError || skel.isError || prod.isError;

  const filtros = [
    { label: "Coleção", value: colecao, onChange: setColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.map((c) => ({ id: String(c), nome: String(c) }))], single: true as const },
    { label: "Subcoleção", value: subcol, onChange: setSubcol, options: [{ id: "all", nome: "Todas" }, ...subcols.map((c) => ({ id: String(c), nome: String(c) }))], single: true as const },
  ];

  // Rótulo curto da etapa "pior" de um item, p/ o top-4.
  const piorEtapaLabel = (etapaKey: string) => {
    if (!etapaKey) return "—";
    if (etapaKey.startsWith("kanban:")) return kanbanLabelByKey.get(etapaKey) ?? etapaKey.slice(7);
    const e = etapas.find((x) => x.etapa === etapaKey);
    return e?.label ?? etapaKey;
  };

  // ——— Faixa "Ação de hoje" (4 KPIs) ———
  const kpisAcao = (
    <>
      <Kpi label="Travados vs SLA" value={travados} icon={AlertTriangle} tone={travados > 0 ? "danger" : "success"} sub="etapa acima de 1,5× a meta" />
      <Kpi label="Em atenção" value={atencao} icon={Timer} tone={atencao > 0 ? "warning" : "success"} sub="perto de estourar o SLA" />
      <Kpi label="No status Aprovado" value={aprovados} icon={CheckCircle2} sub={`aprovados, não lançados${escopoColecao}`} />
      <Kpi
        label="Maior gargalo"
        value={gargalo ? gargalo.label : "—"}
        icon={Gauge}
        tone={gargalo && gargalo.ratio > 1.5 ? "danger" : gargalo && gargalo.ratio > 1 ? "warning" : "success"}
        sub={gargalo ? `${fmtNum(gargalo.media)}d · meta ${fmtNum(gargalo.ideal)} · ${gargalo.ideal > 0 ? Math.round((gargalo.ratio - 1) * 100) : 0}%` : "sem dados"}
      />
    </>
  );

  // ——— Top-4 "o que destravar" (card clicável → tela de Desenvolvimento) ———
  const cardDestravar = (
    <Card className="p-4 cursor-pointer transition-colors hover:border-primary/40" onClick={irParaDesenvolvimento}
      role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); irParaDesenvolvimento(); } }}>
      <h3 className="font-semibold mb-3">O que destravar agora <span className="text-sm font-normal text-muted-foreground">· top 4 por atraso acumulado</span></h3>
      {topDestravar.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum modelo acima da meta no filtro atual. 🎉</p>
      ) : (
        <div className="space-y-1.5">
          {topDestravar.map(({ it, excesso, piorEtapa }) => (
            <div key={it.modelo_id} className="flex items-center gap-2.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-sm">
              <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums"
                style={{ background: "var(--tone-danger-bg)", color: "var(--tone-danger-fg)" }}>+{fmtNum(excesso)}d</span>
              <span className="min-w-0 flex-1 truncate">{it.ref ? `${it.ref} · ` : ""}{it.nome}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{piorEtapaLabel(piorEtapa)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2.5 text-xs font-medium text-primary">Ver no Desenvolvimento →</div>
    </Card>
  );

  // ——— Funil da coleção ———
  const cardFunil = (
    <Card className="p-4">
      <h3 className="font-semibold mb-3">Funil da coleção <span className="text-sm font-normal text-muted-foreground">· quanto já avançou{escopoColecao}</span></h3>
      {funnel.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem dados de funil.</p>
      ) : (
        <div className="space-y-2">
          {funnel.map((f, i) => {
            const pct = Math.round((Number(f.value ?? 0) / funnelTopo) * 100);
            const tone = i === 0 ? "" : pct >= 70 ? "" : pct >= 45 ? "warn" : "bad";
            return (
              <div key={f.name}>
                <div className="flex justify-between text-sm"><span>{f.name}</span><span className="font-semibold tabular-nums">{fmtNum(f.value)} · {pct}%</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded bg-muted">
                  <div className="h-full rounded" style={{ width: `${pct}%`, background: tone === "bad" ? "var(--tone-danger-fg)" : tone === "warn" ? "var(--tone-warning-fg)" : CHART_SERIE }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );

  if (isMobile) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <MobileFilterBar filters={filtros} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <KpiCardMobile compact label="Travados vs SLA" value={fmtInt(travados)} sub="acima de 1,5× a meta" />
          <KpiCardMobile compact label="Em atenção" value={fmtInt(atencao)} sub="perto do SLA" />
          <KpiCardMobile compact label="No status Aprovado" value={fmtInt(aprovados)} sub={`aprovados, não lançados${escopoColecao}`} />
          <KpiCardMobile compact label="Maior gargalo" value={gargalo ? gargalo.label : "—"} valueTitle={gargalo?.label} sub={gargalo ? `${fmtNum(gargalo.media)}d · meta ${fmtNum(gargalo.ideal)}` : "—"} />
        </div>
        {cardDestravar}
        {cardFunil}
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        <DashError show={isError} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DashTabsList />
        <FilterButton screen="dashboard-desenvolvimento" filters={filtros} />
      </div>

      <SecHeader icon={Sparkles}>Ação de hoje</SecHeader>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{kpisAcao}</div>

      <div className="grid gap-4 lg:grid-cols-2">
        {cardDestravar}
        <EtapaBarCard title={`Modelos por etapa do kanban${escopoColecao}`} data={kanbanDev} dataKey="modelos" name="Modelos" color={CHART_SERIE} />
      </div>

      <SecHeader icon={Layers}>Meta da coleção</SecHeader>
      <div className="grid gap-4 lg:grid-cols-2">
        {cardFunil}
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Ritmo ponta a ponta <span className="text-sm font-normal text-muted-foreground">· média vs meta</span></h3>
          <div className="text-3xl font-bold leading-none tabular-nums">
            {hero.n ? fmtNum(hero.mediaTotal) : "—"} <span className="text-base font-semibold text-muted-foreground">dias</span>
          </div>
          {hero.n > 0 && (
            <p className="mt-1.5 text-sm" style={{ color: hero.delta > 0.05 ? "var(--tone-danger-fg)" : hero.delta < -0.05 ? "var(--tone-success-fg)" : "var(--muted-foreground)" }}>
              {hero.delta > 0.05 ? `+${fmtNum(hero.delta)}d` : hero.delta < -0.05 ? `−${fmtNum(-hero.delta)}d` : "no alvo"} vs meta {fmtNum(hero.mediaMeta)}d
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-muted-foreground">{hero.n} modelo(s) · {hero.pctDentro}% dentro da meta</p>
        </Card>
      </div>

      <DetalheExpansivel titulo="Modelos por categoria" sub="distribuição da coleção">
        {(() => {
          const pie: any[] = col.data?.pie ?? [];
          const totPie = pie.reduce((s, p) => s + Number(p.total || 0), 0) || 1;
          return pie.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem dados de categoria no filtro.</p>
          ) : (
            <div className="space-y-2">
              {[...pie].sort((a, b) => Number(b.total) - Number(a.total)).map((p) => {
                const pct = Math.round((Number(p.total || 0) / totPie) * 100);
                return (
                  <div key={p.nome}>
                    <div className="flex justify-between text-sm"><span className="truncate">{p.nome}</span><span className="font-semibold tabular-nums">{fmtInt(p.total)} · {pct}%</span></div>
                    <div className="mt-1 h-2 overflow-hidden rounded bg-muted"><div className="h-full rounded" style={{ width: `${pct}%`, background: CHART_SERIE }} /></div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </DetalheExpansivel>

      {!isLoading && itens.length === 0 && (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          Sem dados de desenvolvimento ainda. Os números populam conforme os modelos avançam no fluxo.
        </p>
      )}
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <DashError show={isError} />
    </div>
  );
}

/* ====================== PRODUÇÃO & QUALIDADE (visão por gestor) ====================== */

// Aba "Produção & Qualidade" (visão por gestor de PCP): abre com "Ação de hoje" (CQ pendente,
// Direcionamento a fazer, Entregas no prazo, Defeito médio) + WIP na rua por idade + ranking de
// oficinas + Meta da coleção (peças produzidas, finalizados/mês, defeito no tempo). Só RPCs
// existentes + 2 contagens client-side (CQ/Direcionamento) que ESPELHAM o predicado das telas
// (expedicao.cq.index / expedicao.direcionamento.index) — nenhuma RPC nova.
function ProducaoQualidadeTab() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const go = (url: string) => navigate({ to: url });

  const [periodo, setPeriodo] = useState<Periodo>(undefined);
  const [colecao, setColecao] = useState("all");
  const [linha, setLinha] = useState("all");
  const ini = isoDate(periodo?.from), fim = isoDate(periodo?.to);

  // dashboard_producao: entregas no prazo, defeito por mês, finalizados por mês, filtros.
  const prod = useQuery({
    queryKey: ["dash-producao", ini, fim, colecao, linha],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_producao" as never, {
        p_inicio: ini, p_fim: fim, p_colecao: colecao === "all" ? undefined : colecao,
        p_linha: linha === "all" ? undefined : linha,
      } as never);
      if (error) throw error;
      return data as any;
    },
  });
  // dashboard_producao_servicos com categoria=Todas → WIP na rua por idade (todas as categorias).
  const servs = useQuery({
    queryKey: ["dash-prod-servicos", ini, fim, colecao, linha, "all"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_producao_servicos" as never, {
        p_inicio: ini, p_fim: fim, p_colecao: colecao === "all" ? undefined : colecao,
        p_linha: linha === "all" ? undefined : linha, p_categoria: undefined,
      } as never);
      if (error) throw error;
      return data as any;
    },
  });
  // ranking_servicos: usado p/ o ranking de OFICINAS (filtra pela categoria cujo nome ~ "oficina").
  const rank = useQuery({
    queryKey: ["dash-ranking-oficinas"],
    queryFn: async () => {
      const cats = await supabase.rpc("ranking_servicos" as never, { p_categoria: undefined } as never);
      if (cats.error) throw cats.error;
      const lista: any[] = (cats.data as any)?.categorias ?? [];
      // Assume UMA categoria de serviço cujo nome ~ "oficina" (o caso comum). Se houver mais de
      // uma ("Oficina Interna"/"Externa"), pega a 1ª — o ranking cobriria só essa; refinar por
      // seletor se surgir a necessidade.
      const oficina = lista.find((c) => /oficina/i.test(String(c.nome)));
      if (!oficina) return { ranking: [], temOficina: false } as any;
      const { data, error } = await supabase.rpc("ranking_servicos" as never, { p_categoria: oficina.id } as never);
      if (error) throw error;
      return { ranking: (data as any)?.ranking ?? [], temOficina: true } as any;
    },
  });

  // CQ pendente — contagem client-side ESPELHANDO expedicao.cq.index.tsx (mesmo select, mesmo gate
  // por origem, mesmo statusGeral). Só conta os pendentes; não monta a lista.
  const cqPend = useQuery({
    queryKey: ["dash-pq-cq-pendente"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("origem, cad(enviado_corte, producao_terceirizados(data_entregue, quantidade_enviada, quantidade_recebida, quantidade_defeito, ativo, categorias_terceirizado(etapa)), controle_qualidade(status, status_pos))")
        .or("enviado_cad.eq.true,origem.eq.revenda,origem.eq.importado");
      if (error) throw error;
      const finalizado = (t: any) =>
        !!t.data_entregue && Number(t.quantidade_enviada) > 0 &&
        (Number(t.quantidade_recebida) > 0 || Number(t.quantidade_defeito) > 0);
      const etapaDe = (t: any) => t.categorias_terceirizado?.etapa ?? "ate_costura";
      let n = 0;
      for (const m of (data ?? []) as any[]) {
        const cad = m.cad?.[0];
        const tercs = (cad?.producao_terceirizados ?? []).filter((t: any) => t.ativo !== false);
        const pre = tercs.filter((t: any) => etapaDe(t) === "ate_costura");
        const enviadoCorte = cad?.enviado_corte === true;
        const temCad = !!cad;
        const preFinalizado = pre.length > 0 && pre.every(finalizado);
        // Gate de entrada IGUAL à tela de CQ.
        const entra = m.origem === "revenda" ? enviadoCorte
          : ehOrigemComprada(m.origem) ? temCad
          : enviadoCorte && preFinalizado;
        if (!entra) continue;
        const statusPre = (cad?.controle_qualidade?.[0]?.status ?? "pendente") as string;
        if (statusPre !== "confirmado") n++; // statusGeral === 'pendente'
      }
      return n;
    },
  });

  // Direcionamento a fazer — contagem client-side ESPELHANDO expedicao.direcionamento.index.tsx
  // (cqLiberado + direcionamento_status === 'pendente').
  const dirPend = useQuery({
    queryKey: ["dash-pq-dir-pendente"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("cad(direcionamento_status, producao_terceirizados(ativo, categorias_terceirizado(etapa)), controle_qualidade(status, status_pos))")
        .or("enviado_cad.eq.true,origem.eq.revenda,origem.eq.importado");
      if (error) throw error;
      let n = 0;
      for (const m of (data ?? []) as any[]) {
        const cad = m.cad?.[0];
        if (cqLiberado(cad) && (cad?.direcionamento_status ?? "pendente") === "pendente") n++;
      }
      return n;
    },
  });

  const kpiPrazo = prod.data?.kpiPrazo ?? { noPrazo: 0, atrasadas: 0, pct: 0 };
  const slaPorTerc: any[] = prod.data?.slaPorTerc ?? [];
  const defeitoMes: any[] = prod.data?.defeitoPorMes ?? [];
  const defeitoMedio = useMemo(
    () => (defeitoMes.length ? defeitoMes.reduce((s, d) => s + Number(d.taxa || 0), 0) / defeitoMes.length : 0),
    [defeitoMes],
  );
  const finalizadas: any[] = prod.data?.finalizadasPorMes ?? [];
  const pecasProduzidas = useMemo(() => finalizadas.reduce((s, f) => s + Number(f.grade || 0), 0), [finalizadas]);
  const porIdade: any[] = servs.data?.emProducaoPorIdade ?? [];
  const wipTotal = useMemo(() => porIdade.reduce((s, b) => s + Number(b.pecas || 0), 0), [porIdade]);
  const rankTop4: any[] = (rank.data?.ranking ?? []).slice().sort((a: any, b: any) => Number(a.desvio) - Number(b.desvio)).slice(0, 4);

  const isLoading = prod.isLoading || servs.isLoading;
  const isError = prod.isError || servs.isError;

  const filtros = [
    { label: "Coleção", value: colecao, onChange: setColecao, options: [{ id: "all", nome: "Todas" }, ...(prod.data?.filtros?.colecoes ?? []).filter(Boolean).map((c: any) => ({ id: String(c), nome: String(c) }))], single: true as const },
    { label: "Linha", value: linha, onChange: setLinha, options: [{ id: "all", nome: "Todas" }, ...(prod.data?.filtros?.linhas ?? []).map((l: any) => ({ id: String(l.id), nome: String(l.nome) }))], single: true as const },
  ];

  // ——— KPIs "Ação de hoje" ———
  const kpisAcao = (
    <>
      <Card className="p-4 cursor-pointer transition-colors hover:border-primary/40" role="button" tabIndex={0}
        onClick={() => go(PAGE_URLS.producao_cq)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(PAGE_URLS.producao_cq); } }}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">CQ pendente</span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: TONE_BG[(cqPend.data ?? 0) > 0 ? "warning" : "success"], color: TONE_FG[(cqPend.data ?? 0) > 0 ? "warning" : "success"] }}><ClipboardCheck className="h-4 w-4" /></span>
        </div>
        <div className="mt-2 text-3xl font-bold leading-none" style={{ color: TONE_FG[(cqPend.data ?? 0) > 0 ? "warning" : "success"] }}>{cqPend.isLoading ? "…" : fmtInt(cqPend.data ?? 0)}</div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">itens aguardando CQ · todas as coleções</div>
      </Card>
      <Card className="p-4 cursor-pointer transition-colors hover:border-primary/40" role="button" tabIndex={0}
        onClick={() => go(PAGE_URLS.producao_direcionamento)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(PAGE_URLS.producao_direcionamento); } }}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">Direcionamento a fazer</span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: TONE_BG[(dirPend.data ?? 0) > 0 ? "danger" : "success"], color: TONE_FG[(dirPend.data ?? 0) > 0 ? "danger" : "success"] }}><Split className="h-4 w-4" /></span>
        </div>
        <div className="mt-2 text-3xl font-bold leading-none" style={{ color: TONE_FG[(dirPend.data ?? 0) > 0 ? "danger" : "success"] }}>{dirPend.isLoading ? "…" : fmtInt(dirPend.data ?? 0)}</div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">CQ liberado, sem separar · todas as coleções</div>
      </Card>
      <Card className="p-4">
        <h3 className="text-xs font-medium text-muted-foreground mb-2">Entregas no prazo</h3>
        <div className="flex items-center gap-3">
          <div className="text-3xl font-bold leading-none tabular-nums" style={{ color: TONE_FG[kpiPrazo.pct >= 80 ? "success" : kpiPrazo.pct >= 50 ? "warning" : "danger"] }}>{kpiPrazo.pct}%</div>
          <div className="text-[11px] text-muted-foreground">{fmtInt(kpiPrazo.noPrazo)} no prazo · {fmtInt(kpiPrazo.atrasadas)} atrasadas</div>
        </div>
      </Card>
      <Kpi label="Defeito médio" value={fmtPct(defeitoMedio)} icon={AlertTriangle} tone={defeitoMedio > 5 ? "danger" : defeitoMedio > 2 ? "warning" : "success"} sub="defeito ÷ recebido (média dos meses)" />
    </>
  );

  // ——— Peças na produção, por tempo fora (o antigo "WIP por idade" — jargão trocado por título
  // que se explica: peças enviadas às oficinas/serviços e ainda não retornadas, por tempo fora) ———
  const cardWip = (
    <Card className="p-4">
      <h3 className="font-semibold mb-3">Peças na produção — há quanto tempo estão fora <span className="text-sm font-normal text-muted-foreground">· {fmtInt(wipTotal)} peças fora, na oficina/serviço</span></h3>
      {porIdade.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada em produção no momento.</p>
      ) : (
        <div className="space-y-2">
          {porIdade.map((b) => {
            const pct = wipTotal > 0 ? Math.round((Number(b.pecas || 0) / wipTotal) * 100) : 0;
            return (
              <div key={b.bucket}>
                <div className="flex justify-between text-sm"><span>{b.bucket}</span><span className="font-semibold tabular-nums">{fmtInt(b.pecas)} · {fmtInt(b.modelos)} mod.</span></div>
                <div className="mt-1 h-2.5 overflow-hidden rounded bg-muted"><div className="h-full rounded" style={{ width: `${pct}%`, background: CHART_AGE[Number(b.ordem)] ?? CHART_SERIE }} /></div>
              </div>
            );
          })}
          <p className="pt-1 text-xs text-muted-foreground">peças paradas há +30 dias = risco de atraso</p>
        </div>
      )}
    </Card>
  );

  // ——— Ranking de oficinas (top-4) ———
  const cardRanking = (
    <Card className="p-4 cursor-pointer transition-colors hover:border-primary/40" role="button" tabIndex={0}
      onClick={() => go(PAGE_URLS.producao_terceirizados)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(PAGE_URLS.producao_terceirizados); } }}>
      <h3 className="font-semibold mb-3">Oficinas — quem entrega melhor <span className="text-sm font-normal text-muted-foreground">· top 4 · menor desvio do prazo</span></h3>
      {rank.data && !rank.data.temOficina ? (
        <p className="text-sm text-muted-foreground">Nenhuma categoria de serviço "Oficina" cadastrada.</p>
      ) : rankTop4.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem entregas de oficina no período.</p>
      ) : (
        <div className="space-y-1.5">
          {rankTop4.map((r, i) => {
            const dias = Number(r.desvio || 0);
            const tone = dias <= 0 ? "success" : dias <= 3 ? "warning" : "danger";
            return (
              <div key={r.fornecedor + i} className="flex items-center gap-2.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-sm">
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums" style={{ background: TONE_BG[tone], color: TONE_FG[tone] }}>{fmtNum(r.pctDentro)}%</span>
                <span className="min-w-0 flex-1 truncate">{r.fornecedor}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{dias <= 0 ? "no prazo" : `+${fmtNum(dias)}d`}</span>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-2.5 text-xs font-medium text-primary">Ver Serviços →</div>
    </Card>
  );

  if (isMobile) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <MobileFilterBar periodo={periodo} onPeriodo={setPeriodo} filters={filtros} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <KpiCardMobile compact label="CQ pendente" value={cqPend.isLoading ? "…" : fmtInt(cqPend.data ?? 0)} sub="aguardando · todas coleções" />
          <KpiCardMobile compact label="Direcionamento" value={dirPend.isLoading ? "…" : fmtInt(dirPend.data ?? 0)} sub="a fazer · todas coleções" />
          <KpiCardMobile compact label="Entregas no prazo" value={`${kpiPrazo.pct}%`} sub={`${fmtInt(kpiPrazo.atrasadas)} atrasadas`} />
          <KpiCardMobile compact label="Defeito médio" value={fmtPct(defeitoMedio)} sub="defeito ÷ recebido" />
        </div>
        {cardWip}
        {cardRanking}
        <MonthBarCard title="Peças finalizadas por mês" subtitle={`total ${fmtInt(pecasProduzidas)} peças`} data={finalizadas} dataKey="grade" name="Peças" color={CHART_SERIE} empty="Sem produção finalizada." loading={prod.isLoading} />
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        <DashError show={isError} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DashTabsList />
        <div className="hidden md:contents"><PeriodoPicker value={periodo} onChange={setPeriodo} /><FilterButton screen="dashboard-producao-qualidade" filters={filtros} /></div>
        <MobileFilterBar className="md:hidden" periodo={periodo} onPeriodo={setPeriodo} filters={filtros} />
      </div>

      <SecHeader icon={Sparkles}>Ação de hoje</SecHeader>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{kpisAcao}</div>

      <div className="grid gap-4 lg:grid-cols-2">
        {cardWip}
        {cardRanking}
      </div>

      <SecHeader icon={Layers}>Meta da coleção</SecHeader>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="font-semibold mb-1">Peças produzidas <span className="text-sm font-normal text-muted-foreground">· grade total finalizada</span></h3>
          <div className="text-3xl font-bold leading-none tabular-nums">{fmtInt(pecasProduzidas)}</div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">soma das grades dos modelos finalizados no período</p>
        </Card>
        <MonthBarCard title="Peças finalizadas por mês" data={finalizadas} dataKey="grade" name="Peças" color={CHART_SERIE} empty="Sem produção finalizada." loading={prod.isLoading} />
      </div>
      <MonthBarCard title="Taxa de defeito no tempo" subtitle="defeito ÷ recebido, por mês (%)" data={defeitoMes} dataKey="taxa" name="Defeito %" color={CHART_SERIE} empty="Sem dados de defeito." loading={prod.isLoading} />

      <DetalheExpansivel titulo="SLA por serviço" sub="prazo médio, atrasos e defeito por prestador">
        <div className="overflow-x-auto">
          <table className="w-full text-sm card-table">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Prestador</th>
                <th className="py-2 pr-3">Serviço</th>
                <th className="py-2 pr-3 text-right">SLA médio</th>
                <th className="py-2 pr-3 text-right">Atrasos</th>
                <th className="py-2 pr-3 text-right">Entregas</th>
                <th className="py-2 pr-3 text-right">Defeito</th>
              </tr>
            </thead>
            <tbody>
              {[...slaPorTerc].sort((a, b) => Number(b.atrasos || 0) - Number(a.atrasos || 0)).map((r, i) => (
                <tr key={(r.nome ?? "") + (r.tipo ?? "") + i} className="border-t">
                  <td className="py-2 pr-3" data-label="Prestador">{r.nome}</td>
                  <td className="py-2 pr-3" data-label="Serviço">{r.tipo}</td>
                  <td className="py-2 pr-3 text-right num" data-label="SLA médio">{r.slaMedio != null ? `${fmtNum(r.slaMedio)}d` : "—"}</td>
                  <td className="py-2 pr-3 text-right num" data-label="Atrasos" style={{ color: Number(r.atrasos) > 0 ? "var(--tone-danger-fg)" : undefined }}>{fmtInt(r.atrasos)}</td>
                  <td className="py-2 pr-3 text-right num" data-label="Entregas">{fmtInt(r.total)}</td>
                  <td className="py-2 pr-3 text-right num" data-label="Defeito">{fmtNum(r.taxaDefeito)}%</td>
                </tr>
              ))}
              {slaPorTerc.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">Sem entregas de serviço no filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </DetalheExpansivel>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      <DashError show={isError} />
    </div>
  );
}

function LeadtimeTab() {
  // Filtro GLOBAL do Leadtime: move os cards (médias) E a tabela (detalhamento) juntos.
  const [colecao, setColecao] = useState("all");
  const [subcol, setSubcol] = useState("all");
  const [semana, setSemana] = useState("all");
  // Sub-aba por ORIGEM: interno (fluxo completo) · acabado · importado (comprados, fluxo curto).
  // Fluxos diferentes NUNCA se misturam nas médias/heatmap — o filtro de origem entra no filtItens,
  // então todo o resto (bullets, hero, gargalo, heatmap) reflete só a origem escolhida.
  const [origem, setOrigem] = useState<"interno" | "revenda" | "importado">("interno");
  const isMobile = useIsMobile();
  // Mobile (Padrão A): tocar num KPI-card ou no card "Onde o tempo é gasto" abre o sheet de bullets.
  const [bulletsOpen, setBulletsOpen] = useState(false);

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
  // Contagem por origem p/ os rótulos das sub-abas (antes do filtro de origem).
  const preFilt = itens.filter(
    (i) =>
      (colecao === "all" || (i.colecao ?? "") === colecao) &&
      (subcol === "all" || (i.subcolecao ?? "") === subcol) &&
      (semana === "all" || (i.semana ?? "") === semana),
  );
  const contaOrigem = (o: string) => preFilt.filter((i) => (i.origem ?? "interno") === o).length;
  const filtItens = preFilt.filter((i) => (i.origem ?? "interno") === origem);

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
  // Só exibe etapas COM dados na origem atual (nModelos>0) — evita mostrar "Planejamento/Modelagem"
  // vazios num comprado, que não passa por Desenvolvimento. + a etapa sintética "compra" (comprados).
  const comDados = (e: any) => Number(e.nModelos) > 0;
  const compraStat = statOf("compra", 0);
  const compra = compraStat.nModelos > 0 ? [{ etapa: "compra", label: "Compra (OC → recebimento)", tipo: "macro", idealDias: 0, ...compraStat, slaCol: false }] : [];
  const planejamento = etapas.filter((e) => e.etapa === "planejamento").map(withStats).filter(comDados);
  // Kanban do Desenvolvimento: só as colunas do BOARD ATUAL da loja, na ordem configurada
  // (ordKb). Status que NÃO estão mais no board (históricos de modelos antigos — variam POR LOJA;
  // loja que nunca mexeu no board não tem nenhum) são agrupados numa linha "Etapas antigas" no
  // fim, para não FURAR a ordem configurada com posições 999 embaralhadas.
  const kanbanTodos = etapas.filter((e) => e.tipo === "kanban").map(withStats).filter(comDados);
  const kanbanBoard = kanbanTodos.filter((e) => ordKb(e.etapa) < 999).sort((a, b) => ordKb(a.etapa) - ordKb(b.etapa));
  const kanbanAntigos = kanbanTodos.filter((e) => ordKb(e.etapa) >= 999);
  const kanban = [...kanbanBoard];
  if (kanbanAntigos.length > 0) {
    const nMax = Math.max(...kanbanAntigos.map((e) => Number(e.nModelos) || 0));
    kanban.push({
      etapa: "kanban:__antigas__",
      label: `Etapas antigas (${kanbanAntigos.length})`,
      tipo: "kanban",
      idealDias: 0, // sem meta — são status fora do board atual
      duracaoMedia: kanbanAntigos.reduce((s, e) => s + (Number(e.duracaoMedia) || 0), 0),
      nModelos: nMax,
      foraSla: 0,
      pctNoPrazo: 0,
      slaCol: false,
      _antigas: kanbanAntigos.map((e) => kanbanLabel(e.etapa)).join(", "),
    } as any);
  }
  const macro = [
    ...compra,
    ...etapas
      .filter((e) => (e.tipo === "macro" && e.etapa !== "planejamento") || e.tipo === "servico")
      .sort((a, b) => ordProd(a) - ordProd(b)).map(withStats).filter(comDados),
  ];

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

  const filtrosLead = [
    { label: "Coleção", value: colecao, onChange: setColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.map((c) => ({ id: String(c), nome: String(c) }))], single: true as const },
    { label: "Subcoleção", value: subcol, onChange: setSubcol, options: [{ id: "all", nome: "Todas" }, ...subcols.map((c) => ({ id: String(c), nome: String(c) }))], single: true as const },
    { label: "Lançamento nº", value: semana, onChange: setSemana, options: [{ id: "all", nome: "Todas" }, ...semanas.map((c) => ({ id: String(c), nome: "Lan " + c }))], single: true as const },
  ];

  const subOrigens: { key: "interno" | "revenda" | "importado"; label: string }[] = [
    { key: "interno", label: "Interno" },
    { key: "revenda", label: "Acabado" },
    { key: "importado", label: "Importado" },
  ];
  const ehComprado = origem !== "interno";
  const vazioOrigem = !isLoading && filtItens.length === 0;

  // ——— Mobile (Padrão A): pilha de KPI-cards; tocar abre o bullet chart no ChartSheet ———
  if (isMobile) {
    const gOver = gargalo && gargalo.ratio > 1;
    const acima = hero.delta > 0.05, abaixo = hero.delta < -0.05;
    const bullets = (
      <div className="space-y-1">
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: "var(--tone-success-bg)" }} aria-hidden />no prazo</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: "var(--tone-warning-bg)" }} aria-hidden />atenção</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-4 rounded-sm" style={{ background: "var(--tone-danger-bg)" }} aria-hidden />atrasado</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-0.5" style={{ background: "var(--foreground)" }} aria-hidden />meta</span>
        </div>
        {origem === "interno" && <BulletSection icon={ClipboardCheck} titulo="Planejamento" etapas={planejamento} labelDe={(e) => e.label} />}
        {origem === "interno" && <BulletSection icon={Palette} titulo="Desenvolvimento" etapas={kanban} labelDe={(e) => e.etapa === "kanban:__antigas__" ? e.label : kanbanLabel(e.etapa)} preservarOrdem />}
        <BulletSection icon={Factory} titulo={origem === "interno" ? "Produção" : "Fluxo do produto comprado"} etapas={macro} labelDe={(e) => e.label} />
      </div>
    );
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <MobileFilterBar filters={filtrosLead} />
        </div>
        <div className="flex flex-wrap gap-1">
          {subOrigens.map((o) => (
            <button key={o.key} type="button" onClick={() => setOrigem(o.key)}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium", origem === o.key ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}>
              {o.label} · {contaOrigem(o.key)}
            </button>
          ))}
        </div>
        {filtItens.length > 0 && (
          <div className="space-y-2.5">
            <KpiCardMobile
              label="Lead time médio ponta a ponta"
              value={<>{hero.n ? fmtNum(hero.mediaTotal) : "—"} <span className="text-sm font-semibold text-muted-foreground">dias</span></>}
              delta={hero.n ? { dir: acima ? "up" : abaixo ? "down" : "flat", text: acima ? `+${fmtNum(hero.delta)}d vs meta ${fmtNum(hero.mediaMeta)}d` : abaixo ? `−${fmtNum(-hero.delta)}d vs meta ${fmtNum(hero.mediaMeta)}d` : `no alvo · meta ${fmtNum(hero.mediaMeta)}d` } : undefined}
              sub={`${hero.n} modelo(s) · ${filtroTxt}`}
              onOpen={() => setBulletsOpen(true)}
              tapLabel="ver etapas"
            />
            <KpiCardMobile
              label="Maior gargalo"
              compact
              value={gargalo ? gargalo.label : "—"}
              delta={gargalo ? { dir: gOver ? "up" : "flat", text: `${fmtNum(gargalo.media)}d · ${fmtNum(gargalo.ratio)}× a meta (${fmtNum(gargalo.ideal)}d)`, color: gOver ? "var(--destructive)" : "var(--success)" } : undefined}
              onOpen={() => setBulletsOpen(true)}
              tapLabel="ver etapas"
            />
            <KpiCardMobile
              label="Dentro da meta ponta a ponta"
              value={<>{hero.n ? hero.pctDentro : "—"}<span className="text-sm font-semibold text-muted-foreground">%</span></>}
              sub={`${hero.dentroMeta} de ${hero.n} modelo(s) ≤ meta`}
              onOpen={() => setBulletsOpen(true)}
              tapLabel="ver etapas"
            />
          </div>
        )}
        {/* Onda B: heatmap larga → cartões por modelo (6 chips, pior no topo). Só interno (fluxo de
            6 fases); comprado tem fluxo curto já coberto pelos bullets. */}
        {!ehComprado && filtItens.length > 0 && <LeadtimeMobileCards itens={filtItens} lookup={lookup} slaServico={slaServico} />}
        {vazioOrigem && (
          <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
            Sem dados de leadtime para {subOrigens.find((o) => o.key === origem)?.label} no filtro atual. As etapas populam conforme os modelos avançam.
          </p>
        )}
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        <DashError show={isError} />
        <ChartSheet
          open={bulletsOpen}
          onOpenChange={setBulletsOpen}
          title="Onde o tempo é gasto"
          subtitle="Barra = duração real · tique = meta · faixas ok/atenção/atrasado"
        >
          {bullets}
        </ChartSheet>
      </div>
    );
  }

  const OrigemTabs = () => (
    <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
      {subOrigens.map((o) => {
        const n = contaOrigem(o.key);
        const on = origem === o.key;
        return (
          <button key={o.key} type="button" onClick={() => setOrigem(o.key)}
            className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition-colors", on ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
            {o.label} <span className="text-xs text-muted-foreground">· {n}</span>
          </button>
        );
      })}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <DashTabsList />
        <FilterButton screen="leadtime" filters={filtrosLead} />
      </div>

      <OrigemTabs />

      {/* Hero: a mensagem primeiro (§R R8) — total ponta-a-ponta, gargalo, % dentro da meta. */}
      {filtItens.length > 0 && <LeadtimeHero hero={hero} gargalo={gargalo} filtroTxt={filtroTxt} />}

      {/* Onde o tempo é gasto — bullets por etapa (§R R7), do pior pro melhor. Ordem de fluxo:
          Interno: Planejamento → Desenvolvimento (kanban) → Produção. Comprado: só Produção
          (Compra → CQ → Direcionamento → Lançamento) — sem planejamento/kanban. */}
      {!ehComprado && <BulletSection icon={ClipboardCheck} titulo="Planejamento" etapas={planejamento} labelDe={(e) => e.label} />}
      {!ehComprado && <BulletSection icon={Palette} titulo="Desenvolvimento · por coluna do kanban" etapas={kanban} labelDe={(e) => e.etapa === "kanban:__antigas__" ? e.label : kanbanLabel(e.etapa)} preservarOrdem />}
      <BulletSection icon={Factory} titulo={ehComprado ? "Fluxo do produto comprado" : "Produção"} etapas={macro} labelDe={(e) => e.label} />

      {/* Heatmap detalhado por modelo × etapas: só p/ INTERNO (as 6 fases + kanban/serviços são do
          fluxo de desenvolvimento). Comprado tem fluxo curto — os bullets acima já o mostram por
          inteiro (Compra → CQ → Direc → Lançar); um heatmap de 6 fases mostraria só colunas vazias. */}
      {!ehComprado && filtItens.length > 0 && <LeadtimeHeatmap itens={filtItens} lookup={lookup} slaServico={slaServico} kanbanOrder={skel.data?.kanbanOrder} categorias={cats.data ?? []} />}

      {vazioOrigem && (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          Sem dados de leadtime para {subOrigens.find((o) => o.key === origem)?.label} no filtro atual. As etapas populam conforme os modelos avançam.
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
// `tip` (opcional) SUBSTITUI o title auto-montado — usado no balde (Histórico/Outros) p/ ITEMIZAR
// o conteúdo daquela célula ("Aprovado (antigo): 31,90d · …", §R). Sem `tip` = title padrão.
function SubCell({ valor, meta, label, edge, strong, tip }: { valor: number | undefined; meta: number | null; label: string; edge?: boolean; strong?: boolean; tip?: string }) {
  const cls = "py-2 px-2 text-center align-middle" + (edge ? (strong ? " border-l-2" : " border-l") : "");
  if (valor == null) return <td className={cls + " text-muted-foreground/50"} title={tip}>—</td>;
  if (meta == null) {
    return (
      <td className={cls}>
        <span
          className="inline-flex min-w-[36px] items-center justify-center rounded bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground"
          title={tip ?? `${label}: ${fmtNum(valor)}d · sem meta na config`}
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
        title={tip ?? `${label}: ${fmtNum(valor)}d · meta ${fmtNum(meta)}d · ${fmtNum(ratio)}×`}
      >
        {fmtInt(valor)}
        {over && <span aria-hidden>▲</span>}
      </span>
    </td>
  );
}

// Onda B · MOBILE do "Detalhamento por item": a tabela larga (heatmap 6 fases) não cabe no
// polegar → vira SMALL MULTIPLES de CARTÕES (Few): 1 card por modelo, ref + nome + total (com ▲
// se acima da meta), e uma linha de 6 CHIPS coloridos pela razão real/meta (mesma rampa navy do
// heatmap; ▲ na fase acima da meta — status leva ícone, nunca só cor). Pior no topo; >50 = "mostrar
// mais". Mesma matemática do desktop (itemTotais/seqIndexRatio), sem RPC nova.
const LT_CHIP_SHORT = ["Planej", "Desenv", "Serv", "CQ", "Direc", "Lanç"] as const;
function LeadtimeMobileCards({ itens, lookup, slaServico }: {
  itens: any[]; lookup: Map<string, number>; slaServico: string | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const LIMIT = 50;
  const rows = itens
    .map((it) => ({ it, ...itemTotais(it, lookup, slaServico) }))
    .sort((a, b) => b.total - a.total); // pior (maior lead time) primeiro
  const visible = showAll ? rows : rows.slice(0, LIMIT);
  return (
    <div className="space-y-3">
      <SecHeader icon={ClipboardCheck}>Detalhamento por item</SecHeader>
      <p className="-mt-1 text-xs text-muted-foreground">
        18 etapas em 6 fases · cor = razão real/meta (mais intenso = mais acima); <span aria-hidden>▲</span> = acima da meta ·
        ordenado pelo maior lead time. Toque num chip para dias/meta/razão.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>no/abaixo da meta</span>
        {CHART_SEQ.map((c, i) => (
          <span key={i} className="inline-block h-3 w-5 rounded-sm border" style={{ background: c }} aria-hidden />
        ))}
        <span>muito acima →</span>
        <span className="ml-1"><span aria-hidden>▲</span> acima da meta</span>
      </div>
      {visible.map(({ it, total, meta, porFase }) => {
        const over = meta > 0 && total > meta;
        return (
          <div key={it.modelo_id} className={"rounded-xl border bg-card p-3" + (over ? " border-destructive/60" : "")}>
            <div className="flex items-baseline justify-between gap-2">
              <div className="min-w-0">
                {it.ref && <div className="font-mono text-[10px] text-muted-foreground">{it.ref}</div>}
                <div className="truncate text-sm font-semibold" title={[it.ref, it.nome].filter(Boolean).join(" · ")}>{it.nome || it.ref || "—"}</div>
              </div>
              <div className="shrink-0 whitespace-nowrap font-bold tabular-nums" style={over ? { color: "var(--destructive)" } : undefined}>
                {fmtInt(total)}d{over && <span aria-hidden> ▲</span>}
              </div>
            </div>
            <div className="mt-2 flex gap-1">
              {FASES.map((f, i) => {
                const fase = porFase[f.key];
                if (!fase) {
                  return (
                    <span key={f.key} className="flex-1 rounded-md border bg-muted px-0.5 py-1 text-center text-muted-foreground/60">
                      <span className="block text-[11px] font-semibold">{LT_CHIP_SHORT[i]}</span>
                      <span className="block text-xs font-bold">—</span>
                    </span>
                  );
                }
                const ratio = fase.meta > 0 ? fase.valor / fase.meta : 0;
                const idx = seqIndexRatio(ratio);
                const chipOver = ratio > 1;
                return (
                  <span
                    key={f.key}
                    className="flex-1 rounded-md px-0.5 py-1 text-center"
                    style={{ background: CHART_SEQ[idx], color: seqTextToken(idx) }}
                    title={`${f.label}: ${fmtNum(fase.valor)}d · meta ${fmtNum(fase.meta)}d · ${fmtNum(ratio)}×`}
                  >
                    <span className="block text-[11px] font-semibold">{LT_CHIP_SHORT[i]}{chipOver && <span aria-hidden> ▲</span>}</span>
                    <span className="block text-xs font-bold tabular-nums">{fmtInt(fase.valor)}</span>
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
      {rows.length === 0 && (
        <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">Nenhum item no filtro.</p>
      )}
      {!showAll && rows.length > LIMIT && (
        <Button variant="outline" className="w-full" onClick={() => setShowAll(true)}>
          Mostrar mais ({rows.length - LIMIT})
        </Button>
      )}
    </div>
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

  // ——— Rótulos das sub-colunas / balde ———
  // Status do kanban: label EXATO do board → DEFAULT_STATUSES → key humanizada (só 1ª letra, SEM
  // title-case — lição do 7ad7f2b: title-case corrompe acento/conector "Aprovação"→"AprovaçãO").
  const board = normalizeKanbanStatuses(kanbanOrder);
  const labelKanban = (k: string) => {
    const hit = board.find((s) => s.key === k) ?? DEFAULT_STATUSES.find((s) => s.key === k);
    if (hit) return hit.label;
    const h = k.replace(/_/g, " ");
    return h.charAt(0).toUpperCase() + h.slice(1);
  };
  const catById = new Map(categorias.map((c) => [c.id, c]));
  // Rótulo de UMA chave de duração (p/ tooltip itemizado do balde): kanban / categoria de serviço
  // (com "(inativa)" quando desativada) / macro "servicos" / cad_corte.
  const labelDaKey = (key: string): string => {
    if (key.startsWith("kanban:")) return labelKanban(key.slice("kanban:".length));
    if (key.startsWith("servico_cat:")) {
      const cat = catById.get(key.slice("servico_cat:".length));
      return cat ? cat.nome + (cat.ativo ? "" : " (inativa)") : "Categoria removida";
    }
    if (key === "servicos") return "Tempo em produção";
    if (key === "cad_corte") return "Explosão";
    return key;
  };

  // ——— Sub-colunas de Desenvolvimento ———
  // Board (status atuais, SEMPRE — mesmo sem dado, na ordem) + status EXTINTOS PROMOVIDOS (peso ≥
  // PROMO_HISTORICO_FRAC da fase → rótulo "<Label> (antigo)"). O resíduo cai no balde "Histórico".
  const devBoardCols = board.map((s) => ({
    key: "kanban:" + s.key, label: s.label, meta: metaConfig("kanban:" + s.key, lookup), antigo: false,
  }));
  const devBoardKeys = devBoardCols.map((c) => c.key);
  const devPromoCols = promoverExtintos(itens, "desenvolvimento", devBoardKeys).map((key) => ({
    key, label: labelDaKey(key) + " (antigo)", meta: metaConfig(key, lookup), antigo: true,
  }));
  const devCols = [...devBoardCols, ...devPromoCols];
  const devKeys = devCols.map((c) => c.key);
  const devOutros = rows.some((r) => splitFaseSub(r.it, "desenvolvimento", devKeys).outros > 1e-9);

  // ——— Sub-colunas de Serviços ———
  // Explosão (marco configurável — colore pela razão QUANDO há ideal na config) vira coluna
  // PRÓPRIA quando presente no filtro, seguida das categorias ATIVAS com dado (ordem do cadastro).
  // O balde "Outros" fica só com o macro "servicos" (antigo) + categorias inativas/removidas.
  const cadCortePresente = rows.some((r) => Number((r.it?.duracoes ?? {})["cad_corte"]) > 0);
  const cadCorteCol = { key: "cad_corte", label: "Explosão", meta: metaConfig("cad_corte", lookup) };
  const servPresent = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.it?.duracoes ?? {})) if (k.startsWith("servico_cat:")) servPresent.add(k);
  const servCatCols = [...servPresent]
    .map((k) => ({ k, cat: catById.get(k.slice("servico_cat:".length)) }))
    .filter((x): x is { k: string; cat: { id: string; nome: string; ativo: boolean; ordem: number } } => !!x.cat && x.cat.ativo)
    .sort((a, b) => (a.cat.ordem - b.cat.ordem) || a.cat.nome.localeCompare(b.cat.nome))
    .map((x) => ({ key: x.k, label: x.cat.nome, meta: metaConfig(x.k, lookup) }));
  const servCols = [...(cadCortePresente ? [cadCorteCol] : []), ...servCatCols];
  const servKeys = servCols.map((c) => c.key);
  const servOutros = rows.some((r) => splitFaseSub(r.it, "servicos", servKeys).outros > 1e-9);

  // ——— Tooltips ITEMIZADOS do balde (header = agregado do filtro; célula = 1 item; §R) ———
  const devHistItens = (det: { key: string; valor: number }[]) =>
    det.map((d) => `${labelDaKey(d.key)} (antigo): ${fmtNum(d.valor)}d`).join(" · ") || "sem tempo no filtro";
  const servOutrosItens = (det: { key: string; valor: number }[]) =>
    det.map((d) => `${labelDaKey(d.key)}: ${fmtNum(d.valor)}d`).join(" · ") || "sem tempo no filtro";
  const devHistHeadTip = "Histórico — status fora do board atual: " + devHistItens(detalharOutros(itens, "desenvolvimento", devKeys));
  const servOutrosHeadTip = "Outros — macro de Produção + categorias inativas/removidas: " + servOutrosItens(detalharOutros(itens, "servicos", servKeys));

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
        {" "}Em Desenvolvimento, um status extinto que ainda pesa vira coluna <strong>"(antigo)"</strong> própria e o resto
        soma em <strong>Histórico</strong>; em Serviços, <strong>Explosão</strong> tem coluna própria e{" "}
        <strong>Outros</strong> guarda o macro de Produção + categorias inativas (passe o mouse no cabeçalho ou na célula p/ o detalhamento).
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
                        <th key={c.key} style={subTop} className={subHeadCell + (i === 0 ? " border-l-2" : "")} title={c.antigo ? c.label + " · status fora do board atual (histórico promovido)" : c.label}>
                          <span className="mx-auto block max-w-[96px] truncate">{c.label}</span>
                        </th>
                      ))}
                      {devOutros && <th style={subTop} className={subHeadCell} title={devHistHeadTip}>Histórico</th>}
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
                      {servOutros && <th style={subTop} className={subHeadCell} title={servOutrosHeadTip}>Outros</th>}
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
                        {devOutros && (
                          <SubCell
                            valor={devSplit!.outros || undefined}
                            meta={null}
                            label="Histórico"
                            tip={"Histórico (fora do board): " + devHistItens(detalharOutros(it, "desenvolvimento", devKeys))}
                          />
                        )}
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
                        {servOutros && (
                          <SubCell
                            valor={servSplit!.outros || undefined}
                            meta={null}
                            label="Outros"
                            tip={"Outros: " + servOutrosItens(detalharOutros(it, "servicos", servKeys))}
                          />
                        )}
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
