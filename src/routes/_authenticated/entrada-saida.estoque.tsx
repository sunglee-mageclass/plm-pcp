import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Boxes, ArrowLeft, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/entrada-saida/estoque")({
  component: EstoquePage,
});

const num = (v: any) => Number(v ?? 0) || 0;
const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

function EstoquePage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <Link to="/entrada-saida" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <header className="flex items-center gap-3">
        <Boxes className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Estoque</h1>
          <p className="text-sm text-muted-foreground">Posição de tecidos e aviamentos.</p>
        </div>
      </header>

      <Tabs defaultValue="tecidos">
        <TabsList>
          <TabsTrigger value="tecidos">Tecidos</TabsTrigger>
          <TabsTrigger value="aviamentos">Aviamentos</TabsTrigger>
        </TabsList>
        <TabsContent value="tecidos" className="mt-4"><TecidosTab /></TabsContent>
        <TabsContent value="aviamentos" className="mt-4"><AviamentosTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================= TECIDOS ============================= */

function TecidosTab() {
  const [search, setSearch] = useState("");
  const [fornecedor, setFornecedor] = useState<string>("all");
  const [categoria, setCategoria] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["estoque-tecidos"],
    queryFn: async () => {
      const [artigos, variantes, ocItens, cadTecVar, modTec, modTecVar, modelos] = await Promise.all([
        supabase.from("artigos").select("id, nome, unidade_medida, rendimento, empresa_id, categoria_tecido_id, empresas(nome), categorias_tecido(nome)"),
        supabase.from("variantes_tecido").select("id, artigo_id, nome_variante, codigo_variante, cores(nome)"),
        supabase.from("ocs_tecido_itens").select("artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida, oc_tecido_id, ocs_tecido!inner(status)"),
        supabase.from("cad_tecido_variantes").select("variante_tecido_id, metragem_enviada, cad_tecidos!inner(artigo_id, cad!inner(enviado_corte))"),
        supabase.from("modelo_tecidos").select("id, modelo_id, artigo_id, consumo, loss_percent"),
        supabase.from("modelo_tecido_variantes").select("variante_tecido_id, modelo_tecido_id"),
        supabase.from("modelos").select("id, data_aprovacao, enviado_cad"),
      ]);

      const modeloAprovadoNaoCad = new Set(
        (modelos.data ?? []).filter((m: any) => m.data_aprovacao && !m.enviado_cad).map((m: any) => m.id),
      );
      const modTecById = new Map((modTec.data ?? []).map((m: any) => [m.id, m]));

      // Grades para reservado: precisamos do total de peças por variante. Como o "reservado" envolve metragem planejada,
      // usamos consumo*(1+loss) por peça. Como não há grade por variante no modelo (variante é só identidade),
      // aplicamos uma aproximação: reservado_metragem_por_artigo = consumo*(1+loss) * grade_total_modelo / num_variantes.
      // Simplificação aceitável quando a grade é distribuída entre variantes do artigo do modelo.
      const modGrades = await supabase.from("modelo_grades").select("modelo_id, variante_numero, grade_total");
      const gradeTotalByModelo = new Map<string, number>();
      for (const g of (modGrades.data ?? []) as any[]) {
        if (!g.modelo_id) continue;
        gradeTotalByModelo.set(g.modelo_id, (gradeTotalByModelo.get(g.modelo_id) ?? 0) + num(g.grade_total));
      }

      // Map por variante: previsao_receb (metros), recebido (metros), baixa (metros)
      type Acc = { previsto: number; recebido: number; baixa: number; reservado: number };
      const byVar = new Map<string, Acc>();
      const get = (id: string) => {
        if (!byVar.has(id)) byVar.set(id, { previsto: 0, recebido: 0, baixa: 0, reservado: 0 });
        return byVar.get(id)!;
      };

      const artById = new Map((artigos.data ?? []).map((a: any) => [a.id, a]));
      const toMetros = (a: any, qtd: number) =>
        a?.unidade_medida === "kg" ? qtd * num(a.rendimento) : qtd;

      for (const it of ocItens.data ?? []) {
        if (!it.variante_tecido_id) continue;
        const art: any = artById.get(it.artigo_id);
        const acc = get(it.variante_tecido_id);
        if ((it as any).ocs_tecido?.status === "encomendado") {
          acc.previsto += toMetros(art, num(it.quantidade_pedida));
        }
        acc.recebido += toMetros(art, num(it.quantidade_recebida));
      }

      for (const cv of cadTecVar.data ?? []) {
        if (!cv.variante_tecido_id) continue;
        if (!(cv as any).cad_tecidos?.cad?.enviado_corte) continue;
        get(cv.variante_tecido_id).baixa += num(cv.metragem_enviada);
      }

      // Reservado: modelos aprovados e não enviados ao CAD
      // Conta variantes por modelo_tecido para distribuir
      const variantesByModTec = new Map<string, string[]>();
      for (const mv of (modTecVar.data ?? []) as any[]) {
        if (!mv.variante_tecido_id || !mv.modelo_tecido_id) continue;
        const arr = variantesByModTec.get(mv.modelo_tecido_id) ?? [];
        arr.push(mv.variante_tecido_id);
        variantesByModTec.set(mv.modelo_tecido_id, arr);
      }
      for (const [mtId, vars] of variantesByModTec) {
        const mt: any = modTecById.get(mtId);
        if (!mt || !modeloAprovadoNaoCad.has(mt.modelo_id)) continue;
        const consumoComLoss = num(mt.consumo) * (1 + num(mt.loss_percent) / 100);
        const gradeTotal = gradeTotalByModelo.get(mt.modelo_id) ?? 0;
        const metragemTotal = consumoComLoss * gradeTotal;
        const por = vars.length ? metragemTotal / vars.length : 0;
        for (const vId of vars) get(vId).reservado += por;
      }

      // Build rows grouped by artigo
      const variantesArr = variantes.data ?? [];
      const rows = variantesArr.map((v: any) => {
        const a: any = artById.get(v.artigo_id);
        const acc = byVar.get(v.id) ?? { previsto: 0, recebido: 0, baixa: 0, reservado: 0 };
        const fisico = acc.recebido - acc.baixa;
        const previsto = fisico - acc.reservado;
        return {
          varId: v.id,
          nomeVariante: v.nome_variante || v.codigo_variante || v.cores?.nome || "—",
          artigoId: v.artigo_id,
          artigoNome: a?.nome ?? "—",
          fornecedor: a?.empresas?.nome ?? "—",
          fornecedorId: a?.empresa_id ?? null,
          categoria: a?.categorias_tecido?.nome ?? "—",
          categoriaId: a?.categoria_tecido_id ?? null,
          ...acc,
          fisico,
          previsto,
        };
      });

      return { rows, artigos: artigos.data ?? [] };
    },
  });

  const fornecedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of (data?.artigos ?? []) as any[]) if (a.empresa_id) m.set(a.empresa_id, a.empresas?.nome ?? "—");
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [data]);

  const categorias = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of (data?.artigos ?? []) as any[]) if (a.categoria_tecido_id) m.set(a.categoria_tecido_id, a.categorias_tecido?.nome ?? "—");
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [data]);

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    const s = search.toLowerCase();
    return rows.filter((r: any) =>
      (!s || r.artigoNome.toLowerCase().includes(s) || r.nomeVariante.toLowerCase().includes(s)) &&
      (fornecedor === "all" || r.fornecedorId === fornecedor) &&
      (categoria === "all" || r.categoriaId === categoria),
    );
  }, [data, search, fornecedor, categoria]);

  // Group by artigo
  const grouped = useMemo(() => {
    const map = new Map<string, { artigoNome: string; rows: any[] }>();
    for (const r of filtered) {
      const g = map.get(r.artigoId) ?? { artigoNome: r.artigoNome, rows: [] as any[] };
      g.rows.push(r);
      map.set(r.artigoId, g);
    }
    return Array.from(map.values());
  }, [filtered]);

  return (
    <div className="space-y-4">
      <Card className="p-4 grid gap-3 sm:grid-cols-4">
        <div>
          <Label>Pesquisar</Label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Artigo ou variante" />
          </div>
        </div>
        <div>
          <Label>Fornecedor</Label>
          <Select value={fornecedor} onValueChange={setFornecedor}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Categoria</Label>
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {grouped.map((g) => (
        <Card key={g.artigoNome} className="p-4">
          <h3 className="font-semibold mb-3">{g.artigoNome}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3">Variante</th>
                  <th className="py-2 pr-3 text-right">Prev. Receb.</th>
                  <th className="py-2 pr-3 text-right">Recebido</th>
                  <th className="py-2 pr-3 text-right">Baixa Real</th>
                  <th className="py-2 pr-3 text-right">Físico Real</th>
                  <th className="py-2 pr-3 text-right">Reservado</th>
                  <th className="py-2 pr-3 text-right">Previsto</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r: any) => (
                  <tr key={r.varId} className={cn("border-b last:border-0", r.fisico <= 0 && "bg-destructive/10")}>
                    <td className="py-2 pr-3">{r.nomeVariante}</td>
                    <td className="py-2 pr-3 text-right">{fmt(r.previsto + 0 || r.previsto)}</td>
                    <td className="py-2 pr-3 text-right">{fmt(r.recebido)}</td>
                    <td className="py-2 pr-3 text-right">{fmt(r.baixa)}</td>
                    <td className={cn("py-2 pr-3 text-right font-medium", r.fisico <= 0 && "text-destructive")}>{fmt(r.fisico)}</td>
                    <td className="py-2 pr-3 text-right">{fmt(r.reservado)}</td>
                    <td className="py-2 pr-3 text-right">{fmt(r.previsto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {!isLoading && grouped.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma variante encontrada.</p>
      )}
    </div>
  );
}

/* ============================ AVIAMENTOS ============================ */

function AviamentosTab() {
  const [search, setSearch] = useState("");
  const [fornecedor, setFornecedor] = useState<string>("all");
  const [categoria, setCategoria] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["estoque-aviamentos"],
    queryFn: async () => {
      const [aviamentos, ocItens, cadAv, modAv, modelos, modGrades] = await Promise.all([
        supabase.from("aviamentos").select("id, codigo_nome, empresa_id, categoria_aviamento_id, empresas(nome), categorias_aviamento(nome)"),
        supabase.from("ocs_aviamento_itens").select("aviamento_id, quantidade_pedida, quantidade_recebida, oc_aviamento_id, ocs_aviamento!inner(status)"),
        supabase.from("cad_aviamentos").select("aviamento_id, quantidade_enviar, cad!inner(enviado_corte)"),
        supabase.from("modelo_aviamentos").select("modelo_id, aviamento_id, consumo"),
        supabase.from("modelos").select("id, data_aprovacao, enviado_cad"),
        supabase.from("modelo_grades").select("modelo_id, grade_total"),
      ]);

      const aprovadoNaoCad = new Set(
        (modelos.data ?? []).filter((m: any) => m.data_aprovacao && !m.enviado_cad).map((m: any) => m.id),
      );
      const gradeByModelo = new Map<string, number>();
      for (const g of (modGrades.data ?? []) as any[]) {
        if (!g.modelo_id) continue;
        gradeByModelo.set(g.modelo_id, (gradeByModelo.get(g.modelo_id) ?? 0) + num(g.grade_total));
      }

      type Acc = { previsto: number; recebido: number; baixa: number; reservado: number };
      const byAv = new Map<string, Acc>();
      const get = (id: string) => {
        if (!byAv.has(id)) byAv.set(id, { previsto: 0, recebido: 0, baixa: 0, reservado: 0 });
        return byAv.get(id)!;
      };

      for (const it of ocItens.data ?? []) {
        if (!it.aviamento_id) continue;
        const acc = get(it.aviamento_id);
        if ((it as any).ocs_aviamento?.status === "encomendado") acc.previsto += num(it.quantidade_pedida);
        acc.recebido += num(it.quantidade_recebida);
      }
      for (const c of cadAv.data ?? []) {
        if (!c.aviamento_id) continue;
        if (!(c as any).cad?.enviado_corte) continue;
        get(c.aviamento_id).baixa += num(c.quantidade_enviar);
      }
      for (const m of (modAv.data ?? []) as any[]) {
        if (!m.aviamento_id || !m.modelo_id || !aprovadoNaoCad.has(m.modelo_id)) continue;
        const gt = gradeByModelo.get(m.modelo_id) ?? 0;
        get(m.aviamento_id).reservado += num(m.consumo) * gt;
      }

      const rows = (aviamentos.data ?? []).map((a: any) => {
        const acc = byAv.get(a.id) ?? { previsto: 0, recebido: 0, baixa: 0, reservado: 0 };
        const fisico = acc.recebido - acc.baixa;
        const previsto = fisico - acc.reservado;
        return {
          id: a.id,
          nome: a.codigo_nome,
          fornecedor: a.empresas?.nome ?? "—",
          fornecedorId: a.empresa_id,
          categoria: a.categorias_aviamento?.nome ?? "—",
          categoriaId: a.categoria_aviamento_id,
          ...acc,
          fisico,
          previsto,
        };
      });

      return { rows, aviamentos: aviamentos.data ?? [] };
    },
  });

  const fornecedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of (data?.aviamentos ?? []) as any[]) if (a.empresa_id) m.set(a.empresa_id, a.empresas?.nome ?? "—");
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [data]);
  const categorias = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of (data?.aviamentos ?? []) as any[]) if (a.categoria_aviamento_id) m.set(a.categoria_aviamento_id, a.categorias_aviamento?.nome ?? "—");
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [data]);

  const filtered = useMemo(() => {
    const rows = data?.rows ?? [];
    const s = search.toLowerCase();
    return rows.filter((r: any) =>
      (!s || r.nome.toLowerCase().includes(s)) &&
      (fornecedor === "all" || r.fornecedorId === fornecedor) &&
      (categoria === "all" || r.categoriaId === categoria),
    );
  }, [data, search, fornecedor, categoria]);

  return (
    <div className="space-y-4">
      <Card className="p-4 grid gap-3 sm:grid-cols-4">
        <div>
          <Label>Pesquisar</Label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Aviamento" />
          </div>
        </div>
        <div>
          <Label>Fornecedor</Label>
          <Select value={fornecedor} onValueChange={setFornecedor}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Categoria</Label>
          <Select value={categoria} onValueChange={setCategoria}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      <Card className="p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3">Aviamento</th>
                <th className="py-2 pr-3">Fornecedor</th>
                <th className="py-2 pr-3">Categoria</th>
                <th className="py-2 pr-3 text-right">Prev. Receb.</th>
                <th className="py-2 pr-3 text-right">Recebido</th>
                <th className="py-2 pr-3 text-right">Baixa</th>
                <th className="py-2 pr-3 text-right">Físico Real</th>
                <th className="py-2 pr-3 text-right">Reservado</th>
                <th className="py-2 pr-3 text-right">Previsto</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r: any) => (
                <tr key={r.id} className={cn("border-b last:border-0", r.fisico <= 0 && "bg-destructive/10")}>
                  <td className="py-2 pr-3">{r.nome}</td>
                  <td className="py-2 pr-3">{r.fornecedor}</td>
                  <td className="py-2 pr-3">{r.categoria}</td>
                  <td className="py-2 pr-3 text-right">{fmt(r.previsto + 0 || r.previsto)}</td>
                  <td className="py-2 pr-3 text-right">{fmt(r.recebido)}</td>
                  <td className="py-2 pr-3 text-right">{fmt(r.baixa)}</td>
                  <td className={cn("py-2 pr-3 text-right font-medium", r.fisico <= 0 && "text-destructive")}>{fmt(r.fisico)}</td>
                  <td className="py-2 pr-3 text-right">{fmt(r.reservado)}</td>
                  <td className="py-2 pr-3 text-right">{fmt(r.previsto)}</td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={9} className="py-4 text-center text-muted-foreground">Nenhum aviamento encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
