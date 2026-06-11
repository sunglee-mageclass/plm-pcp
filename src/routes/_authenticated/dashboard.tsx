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

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
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
        </TabsList>
        <TabsContent value="colecao" className="mt-4"><ColecaoTab /></TabsContent>
        <TabsContent value="estoque" className="mt-4"><EstoqueTab /></TabsContent>
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
