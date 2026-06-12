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
  return (
    <div className="container mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Visão geral da coleção e do estoque.</p>
      </header>
      <Tabs defaultValue="colecao">
        <TabsList>
          <TabsTrigger value="colecao">Coleção</TabsTrigger>
          <TabsTrigger value="estoque">Estoque</TabsTrigger>
          <TabsTrigger value="producao">Produção</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="custos">Custos</TabsTrigger>
        </TabsList>
        <TabsContent value="colecao" className="mt-4"><ColecaoTab /></TabsContent>
        <TabsContent value="estoque" className="mt-4"><EstoqueTab /></TabsContent>
        <TabsContent value="producao" className="mt-4"><ProducaoTab /></TabsContent>
        <TabsContent value="financeiro" className="mt-4"><FinanceiroTab /></TabsContent>
        <TabsContent value="custos" className="mt-4"><CustosTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================ COLEÇÃO ============================ */

function ColecaoTab() {
  const [mes, setMes] = useState("all");
  const [ano, setAno] = useState("all");
  const [semana, setSemana] = useState("");
  const [colecao, setColecao] = useState("all");
  const [estilista, setEstilista] = useState("all");

  const { data, isLoading } = useQuery({
    queryKey: ["dash-colecao"],
    queryFn: async () => {
      const [modelos, cads, lanc, meses, anos, estilistas, categorias] = await Promise.all([
        supabase.from("modelos").select("id, status_planejamento, status_desenvolvimento, enviado_cad, data_aprovacao, mes_id, ano_id, semana, colecao, estilista_id, categoria_principal_id"),
        supabase.from("cad").select("id, modelo_id, enviado_corte"),
        supabase.from("lancamentos").select("id, modelo_id"),
        supabase.from("meses").select("id, nome"),
        supabase.from("anos").select("id, nome"),
        supabase.from("colaboradores").select("id, nome"),
        supabase.from("categorias_produto").select("id, nome"),
      ]);
      return {
        modelos: modelos.data ?? [],
        cads: cads.data ?? [],
        lancamentos: lanc.data ?? [],
        meses: meses.data ?? [],
        anos: anos.data ?? [],
        estilistas: estilistas.data ?? [],
        categorias: categorias.data ?? [],
      };
    },
  });

  const filtered = useMemo(() => {
    const ms = data?.modelos ?? [];
    return ms.filter((m: any) =>
      (mes === "all" || m.mes_id === mes) &&
      (ano === "all" || m.ano_id === ano) &&
      (!semana || String(m.semana ?? "") === semana) &&
      (colecao === "all" || m.colecao === colecao) &&
      (estilista === "all" || m.estilista_id === estilista),
    );
  }, [data, mes, ano, semana, colecao, estilista]);

  const colecoes = useMemo(() => {
    const s = new Set<string>();
    for (const m of data?.modelos ?? []) if ((m as any).colecao) s.add((m as any).colecao);
    return Array.from(s);
  }, [data]);

  const cadsByModelo = useMemo(() => {
    const m = new Map<string, any>();
    for (const c of data?.cads ?? []) if ((c as any).modelo_id) m.set((c as any).modelo_id, c);
    return m;
  }, [data]);
  const lancByModelo = useMemo(() => {
    const s = new Set<string>();
    for (const l of data?.lancamentos ?? []) if ((l as any).modelo_id) s.add((l as any).modelo_id);
    return s;
  }, [data]);

  const kpis = useMemo(() => {
    let planejamento = 0, desenvolvimento = 0, producao = 0, lancados = 0;
    for (const m of filtered as any[]) {
      if (lancByModelo.has(m.id)) lancados++;
      const cad = cadsByModelo.get(m.id);
      if (cad?.enviado_corte) producao++;
      if (m.data_aprovacao && !m.enviado_cad) desenvolvimento++;
      if (!m.data_aprovacao && m.status_planejamento) planejamento++;
    }
    return { total: filtered.length, planejamento, desenvolvimento, producao, lancados };
  }, [filtered, cadsByModelo, lancByModelo]);

  const funnel = useMemo(() => {
    const planejados = filtered.length;
    const aprovados = (filtered as any[]).filter((m) => m.data_aprovacao).length;
    const producao = (filtered as any[]).filter((m) => cadsByModelo.get(m.id)?.enviado_corte).length;
    const lancados = (filtered as any[]).filter((m) => lancByModelo.has(m.id)).length;
    return [
      { name: "Planejados", value: planejados, fill: PIE_COLORS[0] },
      { name: "Aprovados", value: aprovados, fill: PIE_COLORS[1] },
      { name: "Produção", value: producao, fill: PIE_COLORS[2] },
      { name: "Lançados", value: lancados, fill: PIE_COLORS[3] },
    ];
  }, [filtered, cadsByModelo, lancByModelo]);

  const pieData = useMemo(() => {
    const m = new Map<string, number>();
    const catName = new Map<string, string>((data?.categorias ?? []).map((c: any) => [c.id, c.nome]));
    for (const x of filtered as any[]) {
      const k = catName.get(x.categoria_principal_id) ?? "Sem categoria";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m, ([name, value]) => ({ name, value }));
  }, [filtered, data]);

  return (
    <div className="space-y-4">
      <Card className="p-4 grid gap-3 sm:grid-cols-5">
        <FilterSelect label="Mês" value={mes} onChange={setMes} options={[{ id: "all", nome: "Todos" }, ...(data?.meses ?? []) as any[]]} />
        <FilterSelect label="Ano" value={ano} onChange={setAno} options={[{ id: "all", nome: "Todos" }, ...(data?.anos ?? []) as any[]]} />
        <div>
          <Label>Semana</Label>
          <Input value={semana} onChange={(e) => setSemana(e.target.value)} placeholder="ex. 12" />
        </div>
        <div>
          <Label>Coleção</Label>
          <Select value={colecao} onValueChange={setColecao}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {colecoes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <FilterSelect label="Estilista" value={estilista} onChange={setEstilista} options={[{ id: "all", nome: "Todos" }, ...(data?.estilistas ?? []) as any[]]} />
      </Card>

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
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
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

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { id: string; nome: string }[] }) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
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
      const [variantes, aviamentos, artigos, ocTec, ocAvi, cadTecVar, cadAvi, categorias] = await Promise.all([
        supabase.from("variantes_tecido").select("id, artigo_id, nome_variante, codigo_variante, cores(nome)"),
        supabase.from("aviamentos").select("id, codigo_nome, categoria_aviamento_id"),
        supabase.from("artigos").select("id, nome, unidade_medida, rendimento, categoria_tecido_id, categorias_tecido(nome)"),
        supabase.from("ocs_tecido_itens").select("artigo_id, variante_tecido_id, quantidade_recebida"),
        supabase.from("ocs_aviamento_itens").select("aviamento_id, quantidade_recebida"),
        supabase.from("cad_tecido_variantes").select("variante_tecido_id, metragem_enviada, cad_tecidos!inner(cad!inner(enviado_corte))"),
        supabase.from("cad_aviamentos").select("aviamento_id, quantidade_enviar, cad!inner(enviado_corte)"),
        supabase.from("categorias_tecido").select("id, nome"),
      ]);
      return {
        variantes: variantes.data ?? [],
        aviamentos: aviamentos.data ?? [],
        artigos: artigos.data ?? [],
        ocTec: ocTec.data ?? [],
        ocAvi: ocAvi.data ?? [],
        cadTecVar: cadTecVar.data ?? [],
        cadAvi: cadAvi.data ?? [],
        categorias: categorias.data ?? [],
      };
    },
  });

  const computed = useMemo(() => {
    if (!data) return null;
    const num = (v: any) => Number(v ?? 0) || 0;
    const artById = new Map<string, any>((data.artigos as any[]).map((a) => [a.id, a]));

    const toMetros = (a: any, qtd: number) => a?.unidade_medida === "kg" ? qtd * num(a.rendimento) : qtd;

    // Tecidos por variante
    const tecRec = new Map<string, number>();
    const tecBaixa = new Map<string, number>();
    for (const it of data.ocTec as any[]) {
      if (!it.variante_tecido_id) continue;
      const art = artById.get(it.artigo_id);
      tecRec.set(it.variante_tecido_id, (tecRec.get(it.variante_tecido_id) ?? 0) + toMetros(art, num(it.quantidade_recebida)));
    }
    for (const cv of data.cadTecVar as any[]) {
      if (!cv.variante_tecido_id || !cv.cad_tecidos?.cad?.enviado_corte) continue;
      tecBaixa.set(cv.variante_tecido_id, (tecBaixa.get(cv.variante_tecido_id) ?? 0) + num(cv.metragem_enviada));
    }
    const tecRows = (data.variantes as any[]).map((v) => {
      const a = artById.get(v.artigo_id);
      const rec = tecRec.get(v.id) ?? 0;
      const baixa = tecBaixa.get(v.id) ?? 0;
      return {
        id: v.id,
        nome: `${a?.nome ?? "—"} · ${v.nome_variante || v.codigo_variante || v.cores?.nome || "—"}`,
        categoria: a?.categorias_tecido?.nome ?? "Sem categoria",
        estoque: rec - baixa,
      };
    });

    // Aviamentos
    const aviRec = new Map<string, number>();
    const aviBaixa = new Map<string, number>();
    for (const it of data.ocAvi as any[]) {
      if (!it.aviamento_id) continue;
      aviRec.set(it.aviamento_id, (aviRec.get(it.aviamento_id) ?? 0) + num(it.quantidade_recebida));
    }
    for (const c of data.cadAvi as any[]) {
      if (!c.aviamento_id || !c.cad?.enviado_corte) continue;
      aviBaixa.set(c.aviamento_id, (aviBaixa.get(c.aviamento_id) ?? 0) + num(c.quantidade_enviar));
    }
    const aviRows = (data.aviamentos as any[]).map((a) => ({
      id: a.id,
      nome: a.codigo_nome,
      categoria: "Aviamento",
      estoque: (aviRec.get(a.id) ?? 0) - (aviBaixa.get(a.id) ?? 0),
    }));

    const all = [...tecRows.map((r) => ({ ...r, tipo: "Tecido" })), ...aviRows.map((r) => ({ ...r, tipo: "Aviamento" }))];
    const zerados = all.filter((r) => r.estoque <= 0).length;
    const top10 = [...all].sort((a, b) => a.estoque - b.estoque).slice(0, 10);

    // Estoque por categoria de tecido
    const porCat = new Map<string, number>();
    for (const r of tecRows) porCat.set(r.categoria, (porCat.get(r.categoria) ?? 0) + Math.max(0, r.estoque));
    const barData = Array.from(porCat, ([categoria, total]) => ({ categoria, total }));

    return {
      totalVariantes: data.variantes.length,
      totalAviamentos: data.aviamentos.length,
      zerados,
      top10,
      barData,
    };
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Variantes de Tecido" value={computed?.totalVariantes ?? 0} icon={Boxes} />
        <Kpi label="Aviamentos" value={computed?.totalAviamentos ?? 0} icon={Package} />
        <Kpi label="Itens com estoque ≤ 0" value={computed?.zerados ?? 0} icon={AlertTriangle} />
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
                {(computed?.top10 ?? []).map((r: any) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 truncate max-w-[260px]">{r.nome}</td>
                    <td className="py-2 pr-3">{r.tipo}</td>
                    <td className={"py-2 pr-3 text-right " + (r.estoque <= 0 ? "text-destructive font-medium" : "")}>
                      {r.estoque.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
                {!isLoading && (computed?.top10.length ?? 0) === 0 && (
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
              <BarChart data={computed?.barData ?? []}>
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
      const [cads, modelos, terc, ofic, acab, cq, dirc, lanc, terceirizados] = await Promise.all([
        supabase.from("cad").select("id, modelo_id, enviado_corte"),
        supabase.from("modelos").select("id, ref, nome"),
        supabase.from("producao_terceirizados").select("cad_id, terceirizado_id, ativo, data_enviado, data_prevista, data_entregue"),
        supabase.from("producao_oficina").select("cad_id, data_enviado, data_prevista, data_entregue"),
        supabase.from("producao_acabamento").select("cad_id, terceirizado_id, ativo, data_enviado, data_prevista, data_entregue"),
        supabase.from("controle_qualidade").select("cad_id, data_recebimento_entregue"),
        supabase.from("direcionamento").select("cad_id"),
        supabase.from("lancamentos").select("modelo_id"),
        supabase.from("terceirizados").select("id, nome"),
      ]);
      return {
        cads: cads.data ?? [], modelos: modelos.data ?? [], terc: terc.data ?? [],
        ofic: ofic.data ?? [], acab: acab.data ?? [], cq: cq.data ?? [],
        dirc: dirc.data ?? [], lanc: lanc.data ?? [], terceirizados: terceirizados.data ?? [],
      };
    },
  });

  const timeline = useMemo(() => {
    if (!data) return [];
    const modById = new Map((data.modelos as any[]).map((m) => [m.id, m]));
    const tercSet = new Set((data.terc as any[]).filter((t) => t.ativo).map((t) => t.cad_id));
    const oficSet = new Set((data.ofic as any[]).filter((o) => o.data_enviado).map((o) => o.cad_id));
    const cqSet = new Set((data.cq as any[]).map((c) => c.cad_id));
    const acabSet = new Set((data.acab as any[]).filter((a) => a.ativo).map((a) => a.cad_id));
    const dirSet = new Set((data.dirc as any[]).map((d) => d.cad_id));
    const lancSet = new Set((data.lanc as any[]).map((l) => l.modelo_id));

    return (data.cads as any[]).map((c) => {
      const mod = modById.get(c.modelo_id) as any;
      let etapa = "CAD";
      if (lancSet.has(c.modelo_id)) etapa = "Lançado";
      else if (dirSet.has(c.id)) etapa = "Direcionamento";
      else if (acabSet.has(c.id)) etapa = "Acabamento";
      else if (cqSet.has(c.id)) etapa = "Controle de Qualidade";
      else if (oficSet.has(c.id)) etapa = "Oficina";
      else if (tercSet.has(c.id)) etapa = "Terceirizado";
      return { id: c.id, ref: mod?.ref ?? "—", nome: mod?.nome ?? "—", etapa };
    });
  }, [data]);

  const etapas = ["CAD", "Terceirizado", "Oficina", "Controle de Qualidade", "Acabamento", "Direcionamento", "Lançado"];

  const slaPorTerc = useMemo(() => {
    if (!data) return [];
    const byTerc = new Map<string, { nome: string; dias: number[]; atrasos: number; total: number }>();
    const nome = new Map((data.terceirizados as any[]).map((t) => [t.id, t.nome]));
    const all = [...(data.terc as any[]), ...(data.acab as any[])];
    for (const t of all) {
      if (!t.terceirizado_id) continue;
      const row = byTerc.get(t.terceirizado_id) ?? { nome: nome.get(t.terceirizado_id) ?? "—", dias: [] as number[], atrasos: 0, total: 0 };
      if (t.data_enviado && t.data_entregue) {
        const d = (new Date(t.data_entregue).getTime() - new Date(t.data_enviado).getTime()) / 86400000;
        row.dias.push(d);
        row.total++;
        if (t.data_prevista && new Date(t.data_entregue) > new Date(t.data_prevista)) row.atrasos++;
      }
      byTerc.set(t.terceirizado_id, row);
    }
    return Array.from(byTerc.values()).map((r) => ({
      ...r,
      slaMedio: r.dias.length ? r.dias.reduce((a, b) => a + b, 0) / r.dias.length : 0,
    }));
  }, [data]);

  const kpiPrazo = useMemo(() => {
    if (!data) return { noPrazo: 0, atrasadas: 0, pct: 0 };
    const all = [...(data.terc as any[]), ...(data.acab as any[])].filter((t) => t.data_entregue && t.data_prevista);
    const atras = all.filter((t) => new Date(t.data_entregue) > new Date(t.data_prevista)).length;
    const noPrazo = all.length - atras;
    return { noPrazo, atrasadas: atras, pct: all.length ? (noPrazo / all.length) * 100 : 0 };
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Entregas no prazo" value={kpiPrazo.noPrazo} icon={BarChart3} />
        <Kpi label="Atrasadas" value={kpiPrazo.atrasadas} icon={AlertTriangle} />
        <Kpi label="% no prazo" value={Math.round(kpiPrazo.pct)} icon={Sparkles} />
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
              {timeline.map((r) => {
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
            </tr>
          </thead>
          <tbody>
            {slaPorTerc.map((r, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-2 pr-3">{r.nome}</td>
                <td className="py-2 pr-3 text-right">{r.slaMedio.toFixed(1)}</td>
                <td className={"py-2 pr-3 text-right " + (r.atrasos > 0 ? "text-destructive" : "")}>{r.atrasos}</td>
                <td className="py-2 pr-3 text-right">{r.total}</td>
              </tr>
            ))}
            {!isLoading && slaPorTerc.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">Sem entregas registradas.</td></tr>}
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
      const [parcelas, ocTec, ocAvi, ocAviItens, aviamentos] = await Promise.all([
        supabase.from("parcelas").select("valor, data_vencimento, data_pagamento, status"),
        supabase.from("ocs_tecido").select("status, valor_real_total"),
        supabase.from("ocs_aviamento").select("id, status"),
        supabase.from("ocs_aviamento_itens").select("oc_aviamento_id, aviamento_id, quantidade_recebida"),
        supabase.from("aviamentos").select("id, preco"),
      ]);
      return {
        parcelas: parcelas.data ?? [],
        ocTec: ocTec.data ?? [],
        ocAvi: ocAvi.data ?? [],
        ocAviItens: ocAviItens.data ?? [],
        aviamentos: aviamentos.data ?? [],
      };
    },
  });

  const stats = useMemo(() => {
    if (!data) return { investido: 0, pago: 0, pendente: 0, chartData: [] as any[] };
    const num = (v: any) => Number(v ?? 0) || 0;

    const investidoTec = (data.ocTec as any[]).filter((o) => o.status === "recebido").reduce((s, o) => s + num(o.valor_real_total), 0);
    const aviPreco = new Map<string, number>((data.aviamentos as any[]).map((a) => [a.id, num(a.preco)]));
    const ocAviRecebidas = new Set((data.ocAvi as any[]).filter((o) => o.status === "recebido").map((o) => o.id));
    const investidoAvi = (data.ocAviItens as any[])
      .filter((i) => ocAviRecebidas.has(i.oc_aviamento_id))
      .reduce((s, i) => s + num(i.quantidade_recebida) * (aviPreco.get(i.aviamento_id) ?? 0), 0);
    const investido = investidoTec + investidoAvi;

    const pago = (data.parcelas as any[]).filter((p) => p.status === "pago" || p.data_pagamento).reduce((s, p) => s + num(p.valor), 0);
    const pendente = (data.parcelas as any[]).filter((p) => !(p.status === "pago" || p.data_pagamento)).reduce((s, p) => s + num(p.valor), 0);

    const today = new Date();
    const months: { key: string; mes: string; total: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
      months.push({ key: k, mes: label, total: 0 });
    }
    for (const p of data.parcelas as any[]) {
      if (p.status === "pago" || p.data_pagamento) continue;
      const k = String(p.data_vencimento).slice(0, 7);
      const row = months.find((m) => m.key === k);
      if (row) row.total += num(p.valor);
    }
    return { investido, pago, pendente, chartData: months };
  }, [data]);

  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Investido em matéria-prima</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold">{brl(stats.investido)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total pago</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold text-green-600 dark:text-green-400">{brl(stats.pago)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Total pendente</CardTitle></CardHeader><CardContent><div className="text-2xl font-semibold text-yellow-600 dark:text-yellow-400">{brl(stats.pendente)}</div></CardContent></Card>
      </div>
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Contas a pagar — próximos 6 meses</h3>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={stats.chartData}>
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
    queryKey: ["dash-custos"],
    queryFn: async () => {
      const [modelos, cads, cadTec, cadAvi, aviamentos, artigos, meses, categorias] = await Promise.all([
        supabase.from("modelos").select("id, ref, nome, custo_peca_previsto, colecao, mes_id, categoria_principal_id"),
        supabase.from("cad").select("id, modelo_id"),
        supabase.from("cad_tecidos").select("id, cad_id, artigo_id, consumo_cad, loss_percent_cad, custo_cad"),
        supabase.from("cad_aviamentos").select("cad_id, aviamento_id, consumo, quantidade_enviar"),
        supabase.from("aviamentos").select("id, preco"),
        supabase.from("artigos").select("id, preco_por_metro"),
        supabase.from("meses").select("id, nome"),
        supabase.from("categorias_produto").select("id, nome"),
      ]);
      return {
        modelos: modelos.data ?? [], cads: cads.data ?? [], cadTec: cadTec.data ?? [],
        cadAvi: cadAvi.data ?? [], aviamentos: aviamentos.data ?? [], artigos: artigos.data ?? [],
        meses: meses.data ?? [], categorias: categorias.data ?? [],
      };
    },
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const num = (v: any) => Number(v ?? 0) || 0;
    const cadByModelo = new Map<string, string>();
    for (const c of data.cads as any[]) if (c.modelo_id) cadByModelo.set(c.modelo_id, c.id);

    const aviPreco = new Map<string, number>((data.aviamentos as any[]).map((a) => [a.id, num(a.preco)]));
    const artPreco = new Map<string, number>((data.artigos as any[]).map((a) => [a.id, num(a.preco_por_metro)]));

    const custoRealByCad = new Map<string, number>();
    for (const t of data.cadTec as any[]) {
      const base = t.custo_cad != null ? num(t.custo_cad) : num(t.consumo_cad) * (1 + num(t.loss_percent_cad) / 100) * (artPreco.get(t.artigo_id) ?? 0);
      custoRealByCad.set(t.cad_id, (custoRealByCad.get(t.cad_id) ?? 0) + base);
    }
    for (const a of data.cadAvi as any[]) {
      const q = a.quantidade_enviar != null ? num(a.quantidade_enviar) : num(a.consumo);
      const v = q * (aviPreco.get(a.aviamento_id) ?? 0);
      custoRealByCad.set(a.cad_id, (custoRealByCad.get(a.cad_id) ?? 0) + v);
    }

    return (data.modelos as any[]).map((m) => {
      const cadId = cadByModelo.get(m.id);
      const previsto = num(m.custo_peca_previsto);
      const real = cadId ? (custoRealByCad.get(cadId) ?? 0) : 0;
      const diff = real - previsto;
      const pct = previsto ? (diff / previsto) * 100 : 0;
      return { id: m.id, ref: m.ref, nome: m.nome, colecao: m.colecao, mes_id: m.mes_id, categoria_principal_id: m.categoria_principal_id, previsto, real, diff, pct };
    });
  }, [data]);

  const colecoes = useMemo(() => Array.from(new Set(rows.map((r) => r.colecao).filter(Boolean))), [rows]);

  const filtered = useMemo(() => rows.filter((r) =>
    (colecao === "all" || r.colecao === colecao) &&
    (mes === "all" || r.mes_id === mes) &&
    (categoria === "all" || r.categoria_principal_id === categoria),
  ), [rows, colecao, mes, categoria]);

  const chartData = useMemo(() => {
    const m = new Map<string, { colecao: string; soma: number; n: number }>();
    for (const r of filtered) {
      if (!r.colecao || !r.real) continue;
      const row = m.get(r.colecao) ?? { colecao: r.colecao, soma: 0, n: 0 };
      row.soma += r.real; row.n++; m.set(r.colecao, row);
    }
    return Array.from(m.values()).map((r) => ({ colecao: r.colecao, medio: r.n ? r.soma / r.n : 0 }));
  }, [filtered]);

  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <div className="space-y-4">
      <Card className="p-4 grid gap-3 sm:grid-cols-3">
        <div>
          <Label>Coleção</Label>
          <Select value={colecao} onValueChange={setColecao}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {colecoes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <FilterSelect label="Mês" value={mes} onChange={setMes} options={[{ id: "all", nome: "Todos" }, ...(data?.meses ?? []) as any[]]} />
        <FilterSelect label="Categoria" value={categoria} onChange={setCategoria} options={[{ id: "all", nome: "Todas" }, ...(data?.categorias ?? []) as any[]]} />
      </Card>

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
              {filtered.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{r.ref}</td>
                  <td className="py-2 pr-3">{r.nome}</td>
                  <td className="py-2 pr-3 text-right">{brl(r.previsto)}</td>
                  <td className="py-2 pr-3 text-right">{brl(r.real)}</td>
                  <td className={"py-2 pr-3 text-right " + (r.diff > 0 ? "text-destructive" : r.diff < 0 ? "text-green-600 dark:text-green-400" : "")}>{brl(r.diff)}</td>
                  <td className={"py-2 pr-3 text-right " + (r.pct > 0 ? "text-destructive" : r.pct < 0 ? "text-green-600 dark:text-green-400" : "")}>{r.pct.toFixed(1)}%</td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">Sem dados.</td></tr>}
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
