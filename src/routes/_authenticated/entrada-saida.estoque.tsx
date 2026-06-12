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
import { FilterButton, SearchToggle } from "@/components/shared/filters";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/entrada-saida/estoque")({
  component: () => (
    <RequirePermission page="entrada_estoque">
      <EstoquePage />
    </RequirePermission>
  ),
});

const num = (v: any) => Number(v ?? 0) || 0;
const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });

function useEstoqueThreshold() {
  const { data } = useQuery({
    queryKey: ["tenant-config-threshold"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_config")
        .select("estoque_critico_threshold")
        .maybeSingle();
      if (error) throw error;
      return Number((data as any)?.estoque_critico_threshold ?? 0) || 0;
    },
    staleTime: 5 * 60 * 1000,
  });
  return data ?? 0;
}

function EstoquePage() {
  const [tab, setTab] = useState("tecidos");
  return (
    <div className="container mx-auto p-6 space-y-6">
      <Link to="/entrada-saida" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Boxes className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Estoque</h1>
            <p className="text-sm text-muted-foreground mt-1">Posição de tecidos e aviamentos.</p>
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
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
  const threshold = useEstoqueThreshold();
  const [search, setSearch] = useState("");
  const [fornecedor, setFornecedor] = useState<string>("all");
  const [categoria, setCategoria] = useState<string>("all");
  const [estoqueFilter, setEstoqueFilter] = useState<string>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["estoque-tecidos"],
    queryFn: async () => {
      const [variantesRes, ocItensRes, cadTecVarRes, modTecRes, modTecVarRes, modelosRes, modGradesRes] = await Promise.all([
        supabase.from("variantes_tecido").select("id, artigo_id, nome_variante, codigo_variante, cores(nome), artigos(id, nome, unidade_medida, rendimento, empresa_id, categoria_tecido_id, empresas(nome_fantasia), categorias_tecido(nome))"),
        supabase.from("ocs_tecido_itens").select("artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida, cancelado, oc_tecido_id, ocs_tecido!inner(status)"),
        supabase.from("cad_tecido_variantes").select("variante_tecido_id, metragem_enviada, cad_tecidos!inner(artigo_id, cad!inner(enviado_corte))"),
        supabase.from("modelo_tecidos").select("id, modelo_id, artigo_id, consumo, loss_percent"),
        supabase.from("modelo_tecido_variantes").select("variante_tecido_id, modelo_tecido_id, ordem"),
        supabase.from("modelos").select("id, data_aprovacao, enviado_cad"),
        supabase.from("modelo_grades").select("modelo_id, variante_numero, grade_total"),
      ]);

      for (const r of [variantesRes, ocItensRes, cadTecVarRes, modTecRes, modTecVarRes, modelosRes, modGradesRes]) {
        if (r.error) throw r.error;
      }

      const variantes = variantesRes.data ?? [];
      const ocItens = ocItensRes.data ?? [];
      const cadTecVar = cadTecVarRes.data ?? [];
      const modTec = modTecRes.data ?? [];
      const modTecVar = modTecVarRes.data ?? [];
      const modelos = modelosRes.data ?? [];
      const modGrades = modGradesRes.data ?? [];

      const modeloAprovadoNaoCad = new Set(
        modelos.filter((m: any) => m.data_aprovacao && !m.enviado_cad).map((m: any) => m.id),
      );
      const modTecById = new Map((modTec).map((m: any) => [m.id, m]));

      const gradeByModeloVar = new Map<string, number>();
      for (const g of modGrades as any[]) {
        if (!g.modelo_id || g.variante_numero == null) continue;
        const k = `${g.modelo_id}::${g.variante_numero}`;
        gradeByModeloVar.set(k, (gradeByModeloVar.get(k) ?? 0) + num(g.grade_total));
      }

      // Build artById from embedded artigos on variantes
      const artById = new Map<string, any>();
      for (const v of variantes as any[]) {
        if (v.artigos && v.artigo_id) artById.set(v.artigo_id, v.artigos);
      }

      type Acc = { prevReceb: number; recebido: number; baixa: number; reservado: number };
      const byVar = new Map<string, Acc>();
      const get = (id: string) => {
        if (!byVar.has(id)) byVar.set(id, { prevReceb: 0, recebido: 0, baixa: 0, reservado: 0 });
        return byVar.get(id)!;
      };

      const toMetros = (a: any, qtd: number) =>
        a?.unidade_medida === "kg" ? qtd * num(a.rendimento) : qtd;

      for (const it of ocItens) {
        if (!it.variante_tecido_id) continue;
        if ((it as any).cancelado) continue;
        const art: any = it.artigo_id ? artById.get(it.artigo_id) : undefined;
        const acc = get(it.variante_tecido_id);
        if ((it as any).ocs_tecido?.status === "encomendado") {
          acc.prevReceb += num(it.quantidade_pedida);
        }
        if ((it as any).ocs_tecido?.status === "recebido") {
          acc.recebido += toMetros(art, num(it.quantidade_recebida));
        }
      }

      for (const cv of cadTecVar) {
        if (!cv.variante_tecido_id) continue;
        if (!(cv as any).cad_tecidos?.cad?.enviado_corte) continue;
        get(cv.variante_tecido_id).baixa += num(cv.metragem_enviada);
      }

      const variantesByModTec = new Map<string, { ordem: number; varId: string }[]>();
      for (const mv of modTecVar as any[]) {
        if (!mv.variante_tecido_id || !mv.modelo_tecido_id) continue;
        const arr = variantesByModTec.get(mv.modelo_tecido_id) ?? [];
        arr.push({ ordem: num(mv.ordem), varId: mv.variante_tecido_id });
        variantesByModTec.set(mv.modelo_tecido_id, arr);
      }
      for (const [mtId, vars] of variantesByModTec) {
        const mt: any = modTecById.get(mtId);
        if (!mt || !modeloAprovadoNaoCad.has(mt.modelo_id)) continue;
        const consumoComLoss = num(mt.consumo) * (1 + num(mt.loss_percent) / 100);
        const sorted = [...vars].sort((a, b) => a.ordem - b.ordem);
        sorted.forEach((v, idx) => {
          const numeroVariante = v.ordem > 0 ? v.ordem : idx + 1;
          const gradeTotal = gradeByModeloVar.get(`${mt.modelo_id}::${numeroVariante}`) ?? 0;
          get(v.varId).reservado += consumoComLoss * gradeTotal;
        });
      }

      const rows = (variantes as any[]).map((v: any) => {
        const a: any = v.artigos ?? artById.get(v.artigo_id);
        const acc = byVar.get(v.id) ?? { prevReceb: 0, recebido: 0, baixa: 0, reservado: 0 };
        const fisico = acc.recebido - acc.baixa;
        const previsto = fisico + acc.prevReceb - acc.reservado;
        return {
          varId: v.id,
          nomeVariante: v.nome_variante || v.codigo_variante || v.cores?.nome || "—",
          artigoId: v.artigo_id,
          artigoNome: a?.nome ?? "—",
          fornecedor: a?.empresas?.nome_fantasia ?? "—",
          fornecedorId: a?.empresa_id ?? null,
          categoria: a?.categorias_tecido?.nome ?? "—",
          categoriaId: a?.categoria_tecido_id ?? null,
          prevReceb: acc.prevReceb,
          recebido: acc.recebido,
          baixa: acc.baixa,
          reservado: acc.reservado,
          fisico,
          previsto,
        };
      });

      return { rows, artigos: Array.from(artById.values()) };
    },
  });

  const fornecedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of (data?.artigos ?? []) as any[]) if (a.empresa_id) m.set(a.empresa_id, a.empresas?.nome_fantasia ?? "—");
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
      (categoria === "all" || r.categoriaId === categoria) &&
      (estoqueFilter === "all" || (estoqueFilter === "zero" ? r.fisico <= 0 : r.fisico > 0)),
    );
  }, [data, search, fornecedor, categoria, estoqueFilter]);

  // Group by artigo (key = artigoId, fallback para variantes sem artigo)
  const grouped = useMemo(() => {
    const map = new Map<string, { artigoId: string; artigoNome: string; rows: any[] }>();
    for (const r of filtered) {
      const key = r.artigoId ?? `sem-artigo-${r.varId}`;
      const g = map.get(key) ?? { artigoId: key, artigoNome: r.artigoNome, rows: [] as any[] };
      g.rows.push(r);
      map.set(key, g);
    }
    return Array.from(map.values());
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <SearchToggle value={search} onChange={setSearch} placeholder="Artigo ou variante" />
        <FilterButton
          filters={[
            { label: "Estoque", value: estoqueFilter, onChange: setEstoqueFilter, options: [{ id: "all", nome: "Todos" }, { id: "zero", nome: "Estoque Zerado" }, { id: "positive", nome: "Estoque > 0" }] },
            { label: "Fornecedor", value: fornecedor, onChange: setFornecedor, options: [{ id: "all", nome: "Todos" }, ...fornecedores] },
            { label: "Categoria", value: categoria, onChange: setCategoria, options: [{ id: "all", nome: "Todas" }, ...categorias] },
          ]}
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {error && <p className="text-sm text-destructive">Erro ao carregar estoque: {(error as Error).message}</p>}

      {grouped.map((g) => (
        <Card key={g.artigoId} className="p-4">
          <h3 className="font-semibold mb-3">{g.artigoNome}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 w-6"></th>
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
                  <VarianteRow key={r.varId} row={r} threshold={threshold} />
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

function VarianteRow({ row, threshold }: { row: any; threshold: number }) {
  const [open, setOpen] = useState(false);
  const { data: detalhe = [], isLoading } = useQuery({
    queryKey: ["estoque-tecido-detalhe-oc", row.varId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("detalhe_estoque_variante" as any, { _variante_id: row.varId });
      if (error) throw error;
      return (data ?? []) as Array<any>;
    },
  });
  const { data: pendentes = [], isLoading: loadingPend } = useQuery({
    queryKey: ["estoque-tecido-pendentes-oc", row.varId, row.artigoId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_tecido_itens")
        .select("id, quantidade_pedida, oc_tecido_id, artigo_id, ocs_tecido!inner(numero_pedido, data_prevista_entrega, status, empresas(nome_fantasia)), artigos(unidade_medida, rendimento)")
        .eq("variante_tecido_id", row.varId)
        .eq("ocs_tecido.status", "encomendado")
        .eq("cancelado" as any, false);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  return (
    <>
      <tr className={cn("border-b last:border-0 cursor-pointer", row.fisico <= threshold && "bg-destructive/10")} onClick={() => setOpen((o) => !o)}>
        <td className="py-2 pr-3 text-muted-foreground">{open ? "▾" : "▸"}</td>
        <td className="py-2 pr-3">{row.nomeVariante}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.prevReceb)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.recebido)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.baixa)}</td>
        <td className={cn("py-2 pr-3 text-right font-medium", row.fisico <= threshold && "text-destructive")}>{fmt(row.fisico)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.reservado)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.previsto)}</td>
      </tr>
      {open && (
        <tr className="bg-muted/30">
          <td></td>
          <td colSpan={7} className="py-2 pr-3 space-y-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">OCs Recebidas</p>
              {isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
              {!isLoading && detalhe.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma OC recebida para esta variante.</p>
              )}
              {detalhe.length > 0 && (
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1 pr-3">OC</th>
                      <th className="py-1 pr-3">Fornecedor</th>
                      <th className="py-1 pr-3">Entrega</th>
                      <th className="py-1 pr-3 text-right">Recebido</th>
                      <th className="py-1 pr-3 text-right">Baixado</th>
                      <th className="py-1 pr-3 text-right">Reservado</th>
                      <th className="py-1 pr-3 text-right">Sobra</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalhe.map((d: any) => {
                      const sobra = Number(d.recebido_m ?? 0) - Number(d.baixado_m ?? 0) - Number(d.reservado_m ?? 0);
                      return (
                        <tr key={d.oc_tecido_item_id} className="border-b last:border-0">
                          <td className="py-1 pr-3">#{d.numero_pedido ?? "—"}</td>
                          <td className="py-1 pr-3">{d.fornecedor ?? "—"}</td>
                          <td className="py-1 pr-3">{d.data_entrega ? new Date(d.data_entrega).toLocaleDateString("pt-BR") : "—"}</td>
                          <td className="py-1 pr-3 text-right">{fmt(Number(d.recebido_m ?? 0))}</td>
                          <td className="py-1 pr-3 text-right">{fmt(Number(d.baixado_m ?? 0))}</td>
                          <td className="py-1 pr-3 text-right">{fmt(Number(d.reservado_m ?? 0))}</td>
                          <td className={cn("py-1 pr-3 text-right font-medium", sobra <= 0 && "text-destructive")}>{fmt(sobra)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">OCs Pendentes (Prev. Recebimento)</p>
              {loadingPend && <p className="text-xs text-muted-foreground">Carregando…</p>}
              {!loadingPend && pendentes.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma OC pendente para esta variante.</p>
              )}
              {pendentes.length > 0 && (
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1 pr-3">OC</th>
                      <th className="py-1 pr-3">Fornecedor</th>
                      <th className="py-1 pr-3">Entrega Prev.</th>
                      <th className="py-1 pr-3 text-right">Qtd Pedida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendentes.map((p: any) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-1 pr-3">#{p.ocs_tecido?.numero_pedido ?? "—"}</td>
                        <td className="py-1 pr-3">{p.ocs_tecido?.empresas?.nome_fantasia ?? "—"}</td>
                        <td className="py-1 pr-3">{p.ocs_tecido?.data_prevista_entrega ? new Date(p.ocs_tecido.data_prevista_entrega).toLocaleDateString("pt-BR") : "—"}</td>
                        <td className="py-1 pr-3 text-right">{fmt(Number(p.quantidade_pedida ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ============================ AVIAMENTOS ============================ */

function AviamentosTab() {
  const threshold = useEstoqueThreshold();
  const [search, setSearch] = useState("");
  const [fornecedor, setFornecedor] = useState<string>("all");
  const [categoria, setCategoria] = useState<string>("all");
  const [estoqueFilter, setEstoqueFilter] = useState<string>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["estoque-aviamentos"],
    queryFn: async () => {
      const [aviamentosRes, ocItensRes, cadAvRes, modAvRes, modelosRes, modGradesRes] = await Promise.all([
        supabase.from("aviamentos").select("id, codigo_nome, empresa_id, categoria_aviamento_id, empresas(nome_fantasia), categorias_aviamento(nome)"),
        supabase.from("ocs_aviamento_itens").select("aviamento_id, quantidade_pedida, quantidade_recebida, oc_aviamento_id, ocs_aviamento!inner(status)"),
        supabase.from("cad_aviamentos").select("aviamento_id, quantidade_enviar, quantidade_separar, cad!inner(enviado_corte)"),
        supabase.from("modelo_aviamentos").select("modelo_id, aviamento_id, consumo"),
        supabase.from("modelos").select("id, data_aprovacao, enviado_cad"),
        supabase.from("modelo_grades").select("modelo_id, grade_total"),
      ]);

      for (const r of [aviamentosRes, ocItensRes, cadAvRes, modAvRes, modelosRes, modGradesRes]) {
        if (r.error) throw r.error;
      }

      const aviamentos = aviamentosRes;
      const ocItens = ocItensRes;
      const cadAv = cadAvRes;
      const modAv = modAvRes;
      const modelos = modelosRes;
      const modGrades = modGradesRes;

      const aprovadoNaoCad = new Set(
        (modelos.data ?? []).filter((m: any) => m.data_aprovacao && !m.enviado_cad).map((m: any) => m.id),
      );
      const gradeByModelo = new Map<string, number>();
      for (const g of (modGrades.data ?? []) as any[]) {
        if (!g.modelo_id) continue;
        gradeByModelo.set(g.modelo_id, (gradeByModelo.get(g.modelo_id) ?? 0) + num(g.grade_total));
      }

      type Acc = { prevReceb: number; recebido: number; baixa: number; reservado: number };
      const byAv = new Map<string, Acc>();
      const get = (id: string) => {
        if (!byAv.has(id)) byAv.set(id, { prevReceb: 0, recebido: 0, baixa: 0, reservado: 0 });
        return byAv.get(id)!;
      };

      for (const it of ocItens.data ?? []) {
        if (!it.aviamento_id) continue;
        const acc = get(it.aviamento_id);
        if ((it as any).ocs_aviamento?.status === "encomendado") acc.prevReceb += num(it.quantidade_pedida);
        if ((it as any).ocs_aviamento?.status === "recebido") acc.recebido += num(it.quantidade_recebida);
      }
      for (const c of cadAv.data ?? []) {
        if (!c.aviamento_id) continue;
        if (!(c as any).cad?.enviado_corte) continue;
        const separar = num((c as any).quantidade_separar);
        const baixa = separar > 0 ? separar : num(c.quantidade_enviar);
        get(c.aviamento_id).baixa += baixa;
      }
      for (const m of (modAv.data ?? []) as any[]) {
        if (!m.aviamento_id || !m.modelo_id || !aprovadoNaoCad.has(m.modelo_id)) continue;
        const gt = gradeByModelo.get(m.modelo_id) ?? 0;
        get(m.aviamento_id).reservado += num(m.consumo) * gt;
      }

      const rows = (aviamentos.data ?? []).map((a: any) => {
        const acc = byAv.get(a.id) ?? { prevReceb: 0, recebido: 0, baixa: 0, reservado: 0 };
        const fisico = acc.recebido - acc.baixa;
        const previsto = fisico + acc.prevReceb - acc.reservado;
        return {
          id: a.id,
          nome: a.codigo_nome,
          fornecedor: a.empresas?.nome_fantasia ?? "—",
          fornecedorId: a.empresa_id,
          categoria: a.categorias_aviamento?.nome ?? "—",
          categoriaId: a.categoria_aviamento_id,
          prevReceb: acc.prevReceb,
          recebido: acc.recebido,
          baixa: acc.baixa,
          reservado: acc.reservado,
          fisico,
          previsto,
        };
      });

      return { rows, aviamentos: aviamentos.data ?? [] };
    },
  });

  const fornecedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of (data?.aviamentos ?? []) as any[]) if (a.empresa_id) m.set(a.empresa_id, a.empresas?.nome_fantasia ?? "—");
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
      (categoria === "all" || r.categoriaId === categoria) &&
      (estoqueFilter === "all" || (estoqueFilter === "zero" ? r.fisico <= 0 : r.fisico > 0)),
    );
  }, [data, search, fornecedor, categoria, estoqueFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <SearchToggle value={search} onChange={setSearch} placeholder="Aviamento" />
        <FilterButton
          filters={[
            { label: "Estoque", value: estoqueFilter, onChange: setEstoqueFilter, options: [{ id: "all", nome: "Todos" }, { id: "zero", nome: "Estoque Zerado" }, { id: "positive", nome: "Estoque > 0" }] },
            { label: "Fornecedor", value: fornecedor, onChange: setFornecedor, options: [{ id: "all", nome: "Todos" }, ...fornecedores] },
            { label: "Categoria", value: categoria, onChange: setCategoria, options: [{ id: "all", nome: "Todas" }, ...categorias] },
          ]}
        />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {error && <p className="text-sm text-destructive">Erro ao carregar estoque: {(error as Error).message}</p>}

      <Card className="p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 w-6"></th>
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
                <AviamentoRow key={r.id} row={r} threshold={threshold} />
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={10} className="py-4 text-center text-muted-foreground">Nenhum aviamento encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function AviamentoRow({ row, threshold }: { row: any; threshold: number }) {
  const [open, setOpen] = useState(false);
  const { data: pendentes = [], isLoading: loadingPend } = useQuery({
    queryKey: ["estoque-aviamento-pendentes-oc", row.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_aviamento_itens")
        .select("id, quantidade_pedida, ocs_aviamento!inner(numero_pedido, data_prevista_entrega, status, empresas(nome_fantasia))")
        .eq("aviamento_id", row.id)
        .eq("ocs_aviamento.status", "encomendado");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const { data: recebidas = [], isLoading: loadingRec } = useQuery({
    queryKey: ["estoque-aviamento-recebidas-oc", row.id],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_aviamento_itens")
        .select("id, quantidade_recebida, ocs_aviamento!inner(numero_pedido, data_entrega, status, empresas(nome_fantasia))")
        .eq("aviamento_id", row.id)
        .eq("ocs_aviamento.status", "recebido");
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  return (
    <>
      <tr className={cn("border-b last:border-0 cursor-pointer", row.fisico <= threshold && "bg-destructive/10")} onClick={() => setOpen((o) => !o)}>
        <td className="py-2 pr-3 text-muted-foreground">{open ? "▾" : "▸"}</td>
        <td className="py-2 pr-3">{row.nome}</td>
        <td className="py-2 pr-3">{row.fornecedor}</td>
        <td className="py-2 pr-3">{row.categoria}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.prevReceb)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.recebido)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.baixa)}</td>
        <td className={cn("py-2 pr-3 text-right font-medium", row.fisico <= threshold && "text-destructive")}>{fmt(row.fisico)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.reservado)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.previsto)}</td>
      </tr>
      {open && (
        <tr className="bg-muted/30">
          <td></td>
          <td colSpan={9} className="py-2 pr-3 space-y-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">OCs Recebidas</p>
              {loadingRec && <p className="text-xs text-muted-foreground">Carregando…</p>}
              {!loadingRec && recebidas.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma OC recebida.</p>
              )}
              {recebidas.length > 0 && (
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1 pr-3">OC</th>
                      <th className="py-1 pr-3">Fornecedor</th>
                      <th className="py-1 pr-3">Entrega</th>
                      <th className="py-1 pr-3 text-right">Recebido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recebidas.map((r: any) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="py-1 pr-3">#{r.ocs_aviamento?.numero_pedido ?? "—"}</td>
                        <td className="py-1 pr-3">{r.ocs_aviamento?.empresas?.nome_fantasia ?? "—"}</td>
                        <td className="py-1 pr-3">{r.ocs_aviamento?.data_entrega ? new Date(r.ocs_aviamento.data_entrega).toLocaleDateString("pt-BR") : "—"}</td>
                        <td className="py-1 pr-3 text-right">{fmt(Number(r.quantidade_recebida ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">OCs Pendentes (Prev. Recebimento)</p>
              {loadingPend && <p className="text-xs text-muted-foreground">Carregando…</p>}
              {!loadingPend && pendentes.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma OC pendente.</p>
              )}
              {pendentes.length > 0 && (
                <table className="w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1 pr-3">OC</th>
                      <th className="py-1 pr-3">Fornecedor</th>
                      <th className="py-1 pr-3">Entrega Prev.</th>
                      <th className="py-1 pr-3 text-right">Qtd Pedida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendentes.map((p: any) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-1 pr-3">#{p.ocs_aviamento?.numero_pedido ?? "—"}</td>
                        <td className="py-1 pr-3">{p.ocs_aviamento?.empresas?.nome_fantasia ?? "—"}</td>
                        <td className="py-1 pr-3">{p.ocs_aviamento?.data_prevista_entrega ? new Date(p.ocs_aviamento.data_prevista_entrega).toLocaleDateString("pt-BR") : "—"}</td>
                        <td className="py-1 pr-3 text-right">{fmt(Number(p.quantidade_pedida ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
