import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Boxes, ArrowLeft, Search, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { printWithImages } from "@/lib/print";
import { RelatorioPrint } from "@/components/shared/RelatorioPrint";
import { cn } from "@/lib/utils";
import { fmtNum } from "@/lib/format";
import { labelVarianteRow } from "@/lib/variante";
import { FilterButton, SearchToggle } from "@/components/shared/filters";
import { useSort, SortTh } from "@/components/shared/sort";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/entrada-saida/estoque")({
  component: () => (
    <RequirePermission page="entrada_estoque">
      <EstoquePage />
    </RequirePermission>
  ),
});

const num = (v: any) => Number(v ?? 0) || 0;
const fmt = (v: number) => fmtNum(v);
const fmtEnd = (e: any) => [e?.rua && `Rua ${e.rua}`, e?.prateleira && `Prat. ${e.prateleira}`].filter(Boolean).join(" ") || "—";
const endCompact = (e: any) => `${e?.rua || "?"}/${e?.prateleira || "?"}`;


function EstoquePage() {
  const [tab, setTab] = useState("tecidos");
  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsContent value="tecidos"><TecidosTab /></TabsContent>
        <TabsContent value="aviamentos"><AviamentosTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// Cabeçalho compartilhado: título à esquerda + abas/ações (children) à direita, na mesma
// linha do título (desktop). Renderizado dentro de cada aba (que tem o toolbar per-tab).
function EstoqueHeader({ children }: { children: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex items-start gap-3">
        <Boxes className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Estoque</h1>
          <p className="text-sm text-muted-foreground mt-1">Posição de tecidos e aviamentos.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

/* ============================= TECIDOS ============================= */

function TecidosTab() {
  const [search, setSearch] = useState("");
  const [fornecedor, setFornecedor] = useState<string>("all");
  const [categoria, setCategoria] = useState<string>("all");
  const [estoqueFilter, setEstoqueFilter] = useState<string>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["estoque-tecidos"],
    queryFn: async () => {
      const [variantesRes, ocItensRes, baixasRes, modTecRes, modTecVarRes, modelosRes, modGradesRes, osItensRes] = await Promise.all([
        supabase.from("variantes_tecido").select("id, artigo_id, nome_variante, codigo_variante, rua, prateleira, enderecos, cores(nome), apelido:cor_apelido_id(nome), artigos(id, nome, unidade_medida, rendimento, empresa_id, categoria_tecido_id, empresas(nome_fantasia), categorias_tecido(nome))"),
        (supabase.from("ocs_tecido_itens") as any).select("id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida, cancelado, estoque_zerado, substitui_item_id, oc_tecido_id, ocs_tecido!oc_tecido_id!inner(status, is_rolo, rolo_origem_item_id)"),
        // Baixa real = ledger estoque_tecido_baixas (consumo de estoque RECEBIDO no
        // corte, capado no saldo) — fonte única de baixa, por ITEM de OC.
        supabase.from("estoque_tecido_baixas" as any).select("oc_tecido_item_id, variante_tecido_id, quantidade"),
        supabase.from("modelo_tecidos").select("id, modelo_id, artigo_id, consumo, loss_percent"),
        supabase.from("modelo_tecido_variantes").select("variante_tecido_id, modelo_tecido_id, ordem, multiplicador"),
        supabase.from("modelos").select("id, status_desenvolvimento, cad(enviado_corte)"),
        supabase.from("modelo_grades").select("modelo_id, variante_numero, grade_total"),
        // OS Tecido (baixa manual do modo só-estoque): somada ao motor de estoque.
        supabase.from("ordens_saida_tecido_itens" as any).select("variante_tecido_id, reserva, baixa, ordens_saida_tecido!inner(baixado)"),
      ]);

      for (const r of [variantesRes, ocItensRes, baixasRes, modTecRes, modTecVarRes, modelosRes, modGradesRes, osItensRes]) {
        if (r.error) throw r.error;
      }

      const variantes = variantesRes.data ?? [];
      const ocItens = ocItensRes.data ?? [];
      const baixas = (baixasRes.data ?? []) as any[];
      const modTec = modTecRes.data ?? [];
      const modTecVar = modTecVarRes.data ?? [];
      const modelos = modelosRes.data ?? [];
      const modGrades = modGradesRes.data ?? [];
      const osTecItens = (osItensRes.data ?? []) as any[];

      // 1ª reserva: vale desde o Desenvolvimento (BOM preenchido), exceto reprovados,
      // e persiste até o corte ser confirmado (enviado_corte) — depois vira baixa.
      const modeloReservavel = new Set(
        modelos
          .filter((m: any) =>
            (m.status_desenvolvimento ?? "").toLowerCase() !== "reprovado" &&
            !((m.cad ?? []) as any[]).some((c: any) => c.enviado_corte),
          )
          .map((m: any) => m.id),
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

      // Baixa (ledger) por ITEM de OC.
      const baixaByItem = new Map<string, number>();
      for (const b of baixas) {
        if (!b.oc_tecido_item_id) continue;
        baixaByItem.set(b.oc_tecido_item_id, (baixaByItem.get(b.oc_tecido_item_id) ?? 0) + num(b.quantidade));
      }

      // Variantes com algum item zerado → liberam a reserva (decisão: zerar = resolvido).
      const variantesZeradas = new Set<string>();

      // Itens de OC já DESTRINCHADOS em rolos NÃO contam no estoque — só os rolos contam
      // (a OC vira só registro do pedido). Evita "duplicar" OC + rolos e independe da
      // baixa de separação estar exata (órfãos não inflam o físico pela OC).
      const origemComRolos = new Set<string>();
      for (const it of ocItens) {
        const oc = (it as any).ocs_tecido;
        if (oc?.is_rolo && oc?.rolo_origem_item_id) origemComRolos.add(oc.rolo_origem_item_id);
      }

      for (const it of ocItens) {
        if (!it.variante_tecido_id) continue;
        if ((it as any).cancelado) continue;
        if (origemComRolos.has((it as any).id)) continue; // origem destrinchada: conta só os rolos
        const art: any = it.artigo_id ? artById.get(it.artigo_id) : undefined;
        const acc = get(it.variante_tecido_id);
        if ((it as any).ocs_tecido?.status === "encomendado") {
          acc.prevReceb += num(it.quantidade_pedida);
        }
        if ((it as any).ocs_tecido?.status === "recebido") {
          // Item "estoque zerado": fica FORA do físico (recebido E baixa dele),
          // assim a sobra/negativo some sem afetar itens não-zerados da mesma variante.
          if ((it as any).estoque_zerado) { variantesZeradas.add(it.variante_tecido_id); continue; }
          // quantidade_recebida null = recebeu o pedido cheio (COALESCE(recebida, pedida)).
          // EXCEÇÃO: item substituto de troca (substitui_item_id) ainda a receber
          // (recebida null) conta 0 no físico — não é estoque-fantasma antes de chegar.
          acc.recebido += toMetros(art, num(it.quantidade_recebida ?? ((it as any).substitui_item_id ? 0 : it.quantidade_pedida)));
          // Baixa do próprio item (ledger), capada no saldo recebido → físico do item ≥ 0.
          acc.baixa += num(baixaByItem.get((it as any).id) ?? 0);
        }
      }

      const variantesByModTec = new Map<string, { ordem: number; varId: string; mult: number }[]>();
      for (const mv of modTecVar as any[]) {
        if (!mv.variante_tecido_id || !mv.modelo_tecido_id) continue;
        const arr = variantesByModTec.get(mv.modelo_tecido_id) ?? [];
        arr.push({ ordem: num(mv.ordem), varId: mv.variante_tecido_id, mult: num(mv.multiplicador) || 1 });
        variantesByModTec.set(mv.modelo_tecido_id, arr);
      }
      for (const [mtId, vars] of variantesByModTec) {
        const mt: any = modTecById.get(mtId);
        if (!mt || !modeloReservavel.has(mt.modelo_id)) continue;
        const consumoComLoss = num(mt.consumo) * (1 + num(mt.loss_percent) / 100);
        const sorted = [...vars].sort((a, b) => a.ordem - b.ordem);
        sorted.forEach((v, idx) => {
          const numeroVariante = v.ordem > 0 ? v.ordem : idx + 1;
          const gradeTotal = gradeByModeloVar.get(`${mt.modelo_id}::${numeroVariante}`) ?? 0;
          get(v.varId).reservado += consumoComLoss * gradeTotal * (v.mult || 1);
        });
      }

      // OS Tecido: baixado → soma em baixa (reduz físico); aberta → soma em reservado.
      for (const oi of osTecItens) {
        if (!oi.variante_tecido_id) continue;
        if (oi.ordens_saida_tecido?.baixado) get(oi.variante_tecido_id).baixa += num(oi.baixa);
        else get(oi.variante_tecido_id).reservado += num(oi.reserva);
      }

      const rows = (variantes as any[]).map((v: any) => {
        const a: any = v.artigos ?? artById.get(v.artigo_id);
        const acc = byVar.get(v.id) ?? { prevReceb: 0, recebido: 0, baixa: 0, reservado: 0 };
        // Artigo em kg: estoque/reserva/baixa trabalham em METROS (× rendimento).
        // acc.prevReceb está na unidade do artigo (kg p/ kg); acc.recebido já em metros.
        const isKg = a?.unidade_medida === "kg";
        const rend = num(a?.rendimento) || 1;
        const prevRecebKg = acc.prevReceb;
        const prevRecebM = isKg ? acc.prevReceb * rend : acc.prevReceb;
        const recebidoM = acc.recebido;
        const recebidoKg = isKg && rend ? acc.recebido / rend : acc.recebido;
        // Físico por item (recebido − baixa, com itens zerados fora) → nunca negativo
        // por causa de sobra/zerado; baixa de OS pode reduzir.
        const fisico = recebidoM - acc.baixa;
        // Variante zerada libera a reserva (não mostra previsto negativo por reserva).
        const reservado = variantesZeradas.has(v.id) ? 0 : acc.reservado;
        const previsto = fisico + prevRecebM - reservado;
        return {
          varId: v.id,
          nomeVariante: labelVarianteRow(v),
          enderecos: (Array.isArray(v.enderecos) && v.enderecos.length > 0)
            ? v.enderecos
            : ((v.rua || v.prateleira) ? [{ rua: v.rua, prateleira: v.prateleira }] : []),
          artigoId: v.artigo_id,
          artigoNome: a?.nome ?? "—",
          fornecedor: a?.empresas?.nome_fantasia ?? "—",
          fornecedorId: a?.empresa_id ?? null,
          categoria: a?.categorias_tecido?.nome ?? "—",
          categoriaId: a?.categoria_tecido_id ?? null,
          isKg,
          prevRecebKg,
          prevRecebM,
          recebidoKg,
          recebidoM,
          baixa: acc.baixa,
          reservado,
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

  // Ordenação clicável (valores crus por variante; cabeçalho da tabela desktop +
  // <Select> "Ordenar por" nos cards mobile). Aplicada ANTES de agrupar por artigo,
  // pra ordenar as variantes dentro de cada grupo.
  const { sorted, sortKey, sortDir, toggle } = useSort<any>(filtered, { key: "nomeVariante" });
  const sortState = { sortKey, sortDir, toggle };

  // Group by artigo (key = artigoId, fallback para variantes sem artigo)
  const grouped = useMemo(() => {
    const map = new Map<string, { artigoId: string; artigoNome: string; rows: any[] }>();
    for (const r of sorted) {
      const key = r.artigoId ?? `sem-artigo-${r.varId}`;
      const g = map.get(key) ?? { artigoId: key, artigoNome: r.artigoNome, rows: [] as any[] };
      g.rows.push(r);
      map.set(key, g);
    }
    return Array.from(map.values());
  }, [sorted]);

  return (
    <div className="space-y-4">
      <EstoqueHeader>
        <TabsList>
          <TabsTrigger value="tecidos">Tecidos</TabsTrigger>
          <TabsTrigger value="aviamentos"><span className="sm:hidden">Aviam.</span><span className="hidden sm:inline">Aviamentos</span></TabsTrigger>
        </TabsList>
        <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => printWithImages()}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir
        </Button>
        <SearchToggle value={search} onChange={setSearch} placeholder="Tecido ou variante" />
        <FilterButton
          filters={[
            { label: "Estoque", value: estoqueFilter, onChange: setEstoqueFilter, options: [{ id: "all", nome: "Todos" }, { id: "zero", nome: "Estoque Zerado" }, { id: "positive", nome: "Estoque > 0" }] },
            { label: "Fornecedor", value: fornecedor, onChange: setFornecedor, options: [{ id: "all", nome: "Todos" }, ...fornecedores] },
            { label: "Categoria", value: categoria, onChange: setCategoria, options: [{ id: "all", nome: "Todas" }, ...categorias] },
          ]}
        />
      </EstoqueHeader>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {error && <p className="text-sm text-destructive">Erro ao carregar estoque: {(error as Error).message}</p>}

      {/* Mobile: ordenação por <Select> (cards não têm cabeçalho clicável) */}
      <div className="md:hidden flex items-center gap-2">
        <Label className="text-xs text-muted-foreground shrink-0">Ordenar por</Label>
        <Select value={sortKey ?? "nomeVariante"} onValueChange={(v) => toggle(v)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="nomeVariante">Variante</SelectItem>
            <SelectItem value="prevRecebM">Prev. Receb.</SelectItem>
            <SelectItem value="recebidoM">Recebido</SelectItem>
            <SelectItem value="fisico">Físico Real</SelectItem>
            <SelectItem value="reservado">Reservado</SelectItem>
            <SelectItem value="previsto">Previsto</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {grouped.map((g) => (
        <Card key={g.artigoId} className="p-4">
          <h3 className="font-semibold mb-3">{g.artigoNome}</h3>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "4%" }} />
                <col style={{ width: "26%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
              </colgroup>
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3"></th>
                  <SortTh label="Variante" sortKey="nomeVariante" sortState={sortState} className="py-2 pr-3" />
                  <SortTh label="Prev. Receb." sortKey="prevRecebM" sortState={sortState} className="py-2 pr-3" align="right" />
                  <SortTh label="Recebido" sortKey="recebidoM" sortState={sortState} className="py-2 pr-3" align="right" />
                  <SortTh label="Físico Real" sortKey="fisico" sortState={sortState} className="py-2 pr-3" align="right" />
                  <SortTh label="Reservado" sortKey="reservado" sortState={sortState} className="py-2 pr-3" align="right" />
                  <SortTh label="Previsto" sortKey="previsto" sortState={sortState} className="py-2 pr-3" align="right" />
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r: any) => (
                  <VarianteRow key={r.varId} row={r} />
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile: cards por variante (some o scroll horizontal) */}
          <div className="md:hidden space-y-2">
            {g.rows.map((r: any) => (
              <VarianteCard key={r.varId} row={r} />
            ))}
          </div>
        </Card>
      ))}

      {!isLoading && grouped.length === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma variante encontrada.</p>
      )}

      <RelatorioPrint
        titulo="Posição de Estoque — Tecidos"
        dataStr={new Date().toLocaleDateString("pt-BR")}
        colunas={[
          { key: "artigo", label: "Tecido" },
          { key: "variante", label: "Variante" },
          { key: "fisico", label: "Físico", align: "right" },
          { key: "reservado", label: "Reservado", align: "right" },
          { key: "previsto", label: "Previsto", align: "right" },
        ]}
        linhas={grouped.flatMap((g) => g.rows.map((r: any) => ({
          artigo: g.artigoNome,
          variante: r.nomeVariante,
          fisico: `${fmt(r.fisico)} m`,
          reservado: `${fmt(r.reservado)} m`,
          previsto: `${fmt(r.previsto)} m`,
        })))}
      />
    </div>
  );
}

// Detalhe de estoque por OC de uma variante (compartilhado entre a linha desktop
// e o card mobile). A RPC traz recebidas (verde) e pendentes/encomendado (amarelo),
// com a reserva calculada p/ ambas; o físico nunca fica negativo quando zerado.
function useEstoqueVarianteDetalhe(varId: string, open: boolean, reservadoTotal: number) {
  const { data: detalhe = [], isLoading } = useQuery({
    queryKey: ["estoque-tecido-detalhe-oc", varId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("detalhe_estoque_variante" as any, { _variante_id: varId });
      if (error) throw error;
      return (data ?? []) as Array<any>;
    },
  });
  // Parte da reserva total não atribuída a nenhuma OC (modelos sem vínculo). Só informa.
  const reservaSemOc =
    Number(reservadoTotal ?? 0) - detalhe.reduce((s: number, d: any) => s + Number(d.reservado_m ?? 0), 0);
  const ocRows = detalhe.map((d: any) => {
    const recebido = Number(d.recebido_m ?? 0);
    const baixa = Number(d.baixado_m ?? 0);
    const reservado = Number(d.reservado_m ?? 0);
    const prevReceb = Number(d.prev_receb_m ?? 0);
    const fisico = d.estoque_zerado ? Math.max(0, recebido - baixa) : recebido - baixa;
    return {
      key: d.oc_tecido_item_id,
      status: d.recebida ? ("recebida" as const) : ("pendente" as const),
      zerado: !!d.estoque_zerado,
      oc: d.numero_pedido, fornecedor: d.fornecedor, entrega: d.data_entrega,
      prevReceb, recebido, baixa, fisico, reservado, previsto: fisico + prevReceb - reservado,
    };
  });
  return { ocRows, reservaSemOc, isLoading };
}

function VarianteRow({ row }: { row: any }) {
  const [open, setOpen] = useState(false);
  const { ocRows, reservaSemOc, isLoading } = useEstoqueVarianteDetalhe(row.varId, open, row.reservado);
  const loadingPend = false;

  return (
    <>
      <tr className="border-b last:border-0 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <td className="py-2 pr-3 text-muted-foreground">{open ? "▾" : "▸"}</td>
        <td className="py-2 pr-3">
          {row.nomeVariante}
          <span className="ml-1 text-[10px] text-muted-foreground">[{row.isKg ? "kg→m" : "m"}]</span>
          {row.enderecos.length > 0 && (
            <span className="ml-2 text-[10px] text-muted-foreground whitespace-nowrap" title={row.enderecos.map(fmtEnd).join(" | ")}>
              📍 {endCompact(row.enderecos[0])}{row.enderecos.length > 1 ? ` +${row.enderecos.length - 1}` : ""}
            </span>
          )}
        </td>
        <td className="py-2 pr-3 text-right">
          {row.isKg ? (
            <div className="leading-tight">
              <div>{fmt(row.prevRecebKg)} kg</div>
              <div className="text-xs text-muted-foreground">{fmt(row.prevRecebM)} m</div>
            </div>
          ) : (`${fmt(row.prevRecebM)} m`)}
        </td>
        <td className="py-2 pr-3 text-right">
          {row.isKg ? (
            <div className="leading-tight">
              <div>{fmt(row.recebidoKg)} kg</div>
              <div className="text-xs text-muted-foreground">{fmt(row.recebidoM)} m</div>
            </div>
          ) : (`${fmt(row.recebidoM)} m`)}
        </td>
        <td className="py-2 pr-3 text-right font-medium">{fmt(row.fisico)} m</td>
        <td className="py-2 pr-3 text-right">{fmt(row.reservado)} m</td>
        <td className="py-2 pr-3 text-right">{fmt(row.previsto)} m</td>
      </tr>
      {open && (
        <tr className="bg-muted/30">
          <td></td>
          <td colSpan={6} className="py-2 pr-3 space-y-2">
            <div className="text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-muted-foreground">Endereços:</span>
              {row.enderecos.length > 0
                ? row.enderecos.map((e: any, i: number) => <span key={i} className="whitespace-nowrap">📍 {fmtEnd(e)}</span>)
                : <span className="text-muted-foreground">—</span>}
            </div>
            <p className="text-xs font-semibold text-muted-foreground">Estoque por OC</p>
            {(isLoading || loadingPend) && <p className="text-xs text-muted-foreground">Carregando…</p>}
            {!isLoading && !loadingPend && ocRows.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma OC para esta variante.</p>
            )}
            {ocRows.length > 0 && (
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1 pr-3">OC</th>
                    <th className="py-1 pr-3">Fornecedor</th>
                    <th className="py-1 pr-3">Entrega</th>
                    <th className="py-1 pr-3 text-right">Prev. Receb.</th>
                    <th className="py-1 pr-3 text-right">Recebido</th>
                    <th className="py-1 pr-3 text-right">Físico Real</th>
                    <th className="py-1 pr-3 text-right">Reservado</th>
                    <th className="py-1 pr-3 text-right">Previsto</th>
                  </tr>
                </thead>
                <tbody>
                  {ocRows.map((d) => (
                    <tr key={d.key} className={cn("border-b last:border-0", d.status === "recebida" ? "bg-emerald-50" : "bg-amber-50")}>
                      <td className="py-1 pr-3 whitespace-nowrap">
                        #{d.oc ?? "—"}
                        <span className={cn("ml-1 text-[9px] uppercase", d.status === "recebida" ? "text-emerald-700" : "text-amber-700")}>
                          {d.status}
                        </span>
                        {d.zerado && (
                          <Badge className="ml-1.5 h-4 px-1 text-[9px] bg-emerald-500 hover:bg-emerald-500">Zerado</Badge>
                        )}
                      </td>
                      <td className="py-1 pr-3">{d.fornecedor ?? "—"}</td>
                      <td className="py-1 pr-3">{d.entrega ? new Date(d.entrega).toLocaleDateString("pt-BR") : "—"}</td>
                      <td className="py-1 pr-3 text-right">{fmt(d.prevReceb)} m</td>
                      <td className="py-1 pr-3 text-right">{fmt(d.recebido)} m</td>
                      <td className="py-1 pr-3 text-right font-medium">{fmt(d.fisico)} m</td>
                      <td className="py-1 pr-3 text-right">{fmt(d.reservado)} m</td>
                      <td className="py-1 pr-3 text-right">{fmt(d.previsto)} m</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!isLoading && reservaSemOc > 0.01 && (
              <p className="text-xs text-muted-foreground mt-1 italic">
                <span className="font-medium not-italic text-foreground">{fmt(reservaSemOc)}</span>{" "}
                m reservado(s) por modelos sem OC atribuída (não consta nas linhas acima).
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// Card mobile da variante (mesma fonte de dados do VarianteRow, via hook).
function VarianteCard({ row }: { row: any }) {
  const [open, setOpen] = useState(false);
  const { ocRows, reservaSemOc, isLoading } = useEstoqueVarianteDetalhe(row.varId, open, row.reservado);
  return (
    <div className="rounded-lg border p-3">
      <button type="button" className="w-full text-left" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium truncate">
              {row.nomeVariante} <span className="text-[10px] text-muted-foreground">[{row.isKg ? "kg→m" : "m"}]</span>
            </div>
            {row.enderecos.length > 0 && (
              <div className="text-[10px] text-muted-foreground truncate">
                📍 {endCompact(row.enderecos[0])}{row.enderecos.length > 1 ? ` +${row.enderecos.length - 1}` : ""}
              </div>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-lg font-semibold leading-none">
              {fmt(row.fisico)} <span className="text-xs font-normal">m</span>
            </div>
            <div className="text-[10px] text-muted-foreground">Físico Real</div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Prev. Receb.</span><span>{row.isKg ? `${fmt(row.prevRecebKg)} kg` : `${fmt(row.prevRecebM)} m`}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Recebido</span><span>{row.isKg ? `${fmt(row.recebidoKg)} kg` : `${fmt(row.recebidoM)} m`}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Reservado</span><span>{fmt(row.reservado)} m</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Previsto</span><span>{fmt(row.previsto)} m</span></div>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">{open ? "▾ ocultar OCs / endereços" : "▸ ver OCs / endereços"}</div>
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <div className="text-xs">
            <span className="font-semibold text-muted-foreground">Endereços: </span>
            {row.enderecos.length > 0 ? row.enderecos.map((e: any) => fmtEnd(e)).join(" · ") : "—"}
          </div>
          <p className="text-xs font-semibold text-muted-foreground">Estoque por OC</p>
          {isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
          {!isLoading && ocRows.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma OC para esta variante.</p>}
          {ocRows.map((d) => (
            <div key={d.key} className={cn("rounded border p-2 text-xs", d.status === "recebida" ? "bg-emerald-50" : "bg-amber-50")}>
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  #{d.oc ?? "—"}{" "}
                  <span className={cn("text-[9px] uppercase", d.status === "recebida" ? "text-emerald-700" : "text-amber-700")}>{d.status}</span>
                  {d.zerado && <Badge className="ml-1 h-4 px-1 text-[9px] bg-emerald-500 hover:bg-emerald-500">Zerado</Badge>}
                </span>
                <span className="font-semibold">{fmt(d.fisico)} m</span>
              </div>
              <div className="text-muted-foreground">{d.fornecedor ?? "—"}{d.entrega ? ` · ${new Date(d.entrega).toLocaleDateString("pt-BR")}` : ""}</div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                <span>Prev: {fmt(d.prevReceb)} m</span>
                <span>Receb: {fmt(d.recebido)} m</span>
                <span>Reserv: {fmt(d.reservado)} m</span>
                <span>Prev.: {fmt(d.previsto)} m</span>
              </div>
            </div>
          ))}
          {!isLoading && reservaSemOc > 0.01 && (
            <p className="text-xs italic text-muted-foreground">
              <span className="font-medium not-italic text-foreground">{fmt(reservaSemOc)}</span> m reservado(s) por modelos sem OC atribuída.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================ AVIAMENTOS ============================ */

function AviamentosTab() {
  const [search, setSearch] = useState("");
  const [fornecedor, setFornecedor] = useState<string>("all");
  const [categoria, setCategoria] = useState<string>("all");
  const [estoqueFilter, setEstoqueFilter] = useState<string>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["estoque-aviamentos"],
    queryFn: async () => {
      // Fonte ÚNICA: RPC canônica estoque_aviamento (mesma definição do dashboard e da
      // trava de saldo da OS). Antes eram 7 queries + agregação no cliente, que divergia
      // do dashboard (M2). fisico já vem clampado >=0; previsto = fisico + prev - reserva.
      const { data, error } = await supabase.rpc("estoque_aviamento" as any);
      if (error) throw error;
      const rows = ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        nome: r.nome,
        fornecedor: r.fornecedor ?? "—",
        fornecedorId: r.fornecedor_id,
        categoria: r.categoria ?? "—",
        categoriaId: r.categoria_id,
        prevReceb: Number(r.prev_receb ?? 0),
        recebido: Number(r.recebido ?? 0),
        baixa: Number(r.baixa ?? 0),
        reservado: Number(r.reservado ?? 0),
        fisico: Number(r.fisico ?? 0),
        previsto: Number(r.previsto ?? 0),
      }));
      return { rows };
    },
  });

  const fornecedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of (data?.rows ?? []) as any[]) if (r.fornecedorId) m.set(r.fornecedorId, r.fornecedor ?? "—");
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [data]);
  const categorias = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of (data?.rows ?? []) as any[]) if (r.categoriaId) m.set(r.categoriaId, r.categoria ?? "—");
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

  // Ordenação clicável (cabeçalho desktop + <Select> "Ordenar por" nos cards mobile).
  const { sorted, sortKey, sortDir, toggle } = useSort<any>(filtered, { key: "nome" });
  const sortState = { sortKey, sortDir, toggle };

  return (
    <div className="space-y-4">
      <EstoqueHeader>
        <TabsList>
          <TabsTrigger value="tecidos">Tecidos</TabsTrigger>
          <TabsTrigger value="aviamentos"><span className="sm:hidden">Aviam.</span><span className="hidden sm:inline">Aviamentos</span></TabsTrigger>
        </TabsList>
        <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => printWithImages()}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir
        </Button>
        <SearchToggle value={search} onChange={setSearch} placeholder="Aviamento" />
        <FilterButton
          filters={[
            { label: "Estoque", value: estoqueFilter, onChange: setEstoqueFilter, options: [{ id: "all", nome: "Todos" }, { id: "zero", nome: "Estoque Zerado" }, { id: "positive", nome: "Estoque > 0" }] },
            { label: "Fornecedor", value: fornecedor, onChange: setFornecedor, options: [{ id: "all", nome: "Todos" }, ...fornecedores] },
            { label: "Categoria", value: categoria, onChange: setCategoria, options: [{ id: "all", nome: "Todas" }, ...categorias] },
          ]}
        />
      </EstoqueHeader>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {error && <p className="text-sm text-destructive">Erro ao carregar estoque: {(error as Error).message}</p>}

      <Card className="p-4">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "4%" }} />
              <col style={{ width: "18%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "12%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3"></th>
                <SortTh label="Aviamento" sortKey="nome" sortState={sortState} className="py-2 pr-3" />
                <SortTh label="Fornecedor" sortKey="fornecedor" sortState={sortState} className="py-2 pr-3" />
                <SortTh label="Categoria" sortKey="categoria" sortState={sortState} className="py-2 pr-3" />
                <SortTh label="Prev. Receb." sortKey="prevReceb" sortState={sortState} className="py-2 pr-3" align="right" />
                <SortTh label="Recebido" sortKey="recebido" sortState={sortState} className="py-2 pr-3" align="right" />
                <SortTh label="Físico Real" sortKey="fisico" sortState={sortState} className="py-2 pr-3" align="right" />
                <SortTh label="Reservado" sortKey="reservado" sortState={sortState} className="py-2 pr-3" align="right" />
                <SortTh label="Previsto" sortKey="previsto" sortState={sortState} className="py-2 pr-3" align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r: any) => (
                <AviamentoRow key={r.id} row={r} />
              ))}
              {!isLoading && sorted.length === 0 && (
                <tr><td colSpan={9} className="py-4 text-center text-muted-foreground">Nenhum aviamento encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Mobile: cards por aviamento */}
        <div className="md:hidden space-y-2">
          {/* Mobile: ordenação por <Select> (cards não têm cabeçalho clicável) */}
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground shrink-0">Ordenar por</Label>
            <Select value={sortKey ?? "nome"} onValueChange={(v) => toggle(v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nome">Aviamento</SelectItem>
                <SelectItem value="fornecedor">Fornecedor</SelectItem>
                <SelectItem value="categoria">Categoria</SelectItem>
                <SelectItem value="prevReceb">Prev. Receb.</SelectItem>
                <SelectItem value="recebido">Recebido</SelectItem>
                <SelectItem value="fisico">Físico Real</SelectItem>
                <SelectItem value="reservado">Reservado</SelectItem>
                <SelectItem value="previsto">Previsto</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {sorted.map((r: any) => (
            <AviamentoCard key={r.id} row={r} />
          ))}
          {!isLoading && sorted.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhum aviamento encontrado.</p>
          )}
        </div>
      </Card>

      <RelatorioPrint
        titulo="Posição de Estoque — Aviamentos"
        dataStr={new Date().toLocaleDateString("pt-BR")}
        colunas={[
          { key: "nome", label: "Aviamento" },
          { key: "fornecedor", label: "Fornecedor" },
          { key: "categoria", label: "Categoria" },
          { key: "fisico", label: "Físico", align: "right" },
          { key: "reservado", label: "Reservado", align: "right" },
          { key: "previsto", label: "Previsto", align: "right" },
        ]}
        linhas={filtered.map((r: any) => ({
          nome: r.nome,
          fornecedor: r.fornecedor ?? "—",
          categoria: r.categoria ?? "—",
          fisico: fmt(r.fisico),
          reservado: fmt(r.reservado),
          previsto: fmt(r.previsto),
        }))}
      />
    </div>
  );
}

// Detalhe de OCs de um aviamento (recebidas + pendentes), compartilhado entre a
// linha desktop e o card mobile.
function useEstoqueAviamentoDetalhe(aviamentoId: string, open: boolean) {
  const { data: pendentes = [], isLoading: loadingPend } = useQuery({
    queryKey: ["estoque-aviamento-pendentes-oc", aviamentoId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_aviamento_itens")
        .select("id, quantidade_pedida, ocs_aviamento!inner(numero_pedido, data_prevista_entrega, status, empresas(nome_fantasia))")
        .eq("aviamento_id", aviamentoId)
        .eq("ocs_aviamento.status", "encomendado")
        .eq("cancelado" as any, false);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const { data: recebidas = [], isLoading: loadingRec } = useQuery({
    queryKey: ["estoque-aviamento-recebidas-oc", aviamentoId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_aviamento_itens")
        .select("id, quantidade_recebida, ocs_aviamento!inner(numero_pedido, data_entrega, status, empresas(nome_fantasia))")
        .eq("aviamento_id", aviamentoId)
        .eq("ocs_aviamento.status", "recebido")
        .eq("cancelado" as any, false);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  return { pendentes, recebidas, loadingPend, loadingRec };
}

function AviamentoRow({ row }: { row: any }) {
  const [open, setOpen] = useState(false);
  const { pendentes, recebidas, loadingPend, loadingRec } = useEstoqueAviamentoDetalhe(row.id, open);
  return (
    <>
      <tr className="border-b last:border-0 cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <td className="py-2 pr-3 text-muted-foreground">{open ? "▾" : "▸"}</td>
        <td className="py-2 pr-3">{row.nome}</td>
        <td className="py-2 pr-3">{row.fornecedor}</td>
        <td className="py-2 pr-3">{row.categoria}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.prevReceb)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.recebido)}</td>
        <td className="py-2 pr-3 text-right font-medium">{fmt(row.fisico)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.reservado)}</td>
        <td className="py-2 pr-3 text-right">{fmt(row.previsto)}</td>
      </tr>
      {open && (
        <tr className="bg-muted/30">
          <td></td>
          <td colSpan={8} className="py-2 pr-3 space-y-3">
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

// Card mobile do aviamento (mesma fonte de dados do AviamentoRow, via hook).
function AviamentoCard({ row }: { row: any }) {
  const [open, setOpen] = useState(false);
  const { pendentes, recebidas, loadingPend, loadingRec } = useEstoqueAviamentoDetalhe(row.id, open);
  return (
    <div className="rounded-lg border p-3">
      <button type="button" className="w-full text-left" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-medium truncate">{row.nome}</div>
            <div className="text-[10px] text-muted-foreground truncate">{row.fornecedor ?? "—"}{row.categoria ? ` · ${row.categoria}` : ""}</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-lg font-semibold leading-none">{fmt(row.fisico)}</div>
            <div className="text-[10px] text-muted-foreground">Físico Real</div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Prev. Receb.</span><span>{fmt(row.prevReceb)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Recebido</span><span>{fmt(row.recebido)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Reservado</span><span>{fmt(row.reservado)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Previsto</span><span>{fmt(row.previsto)}</span></div>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">{open ? "▾ ocultar OCs" : "▸ ver OCs"}</div>
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">OCs Recebidas</p>
            {loadingRec && <p className="text-xs text-muted-foreground">Carregando…</p>}
            {!loadingRec && recebidas.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma OC recebida.</p>}
            {recebidas.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded border bg-emerald-50 px-2 py-1 text-xs">
                <span className="min-w-0 truncate">#{r.ocs_aviamento?.numero_pedido ?? "—"} · {r.ocs_aviamento?.empresas?.nome_fantasia ?? "—"}{r.ocs_aviamento?.data_entrega ? ` · ${new Date(r.ocs_aviamento.data_entrega).toLocaleDateString("pt-BR")}` : ""}</span>
                <span className="shrink-0 font-medium">{fmt(Number(r.quantidade_recebida ?? 0))}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-muted-foreground">OCs Pendentes</p>
            {loadingPend && <p className="text-xs text-muted-foreground">Carregando…</p>}
            {!loadingPend && pendentes.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma OC pendente.</p>}
            {pendentes.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded border bg-amber-50 px-2 py-1 text-xs">
                <span className="min-w-0 truncate">#{p.ocs_aviamento?.numero_pedido ?? "—"} · {p.ocs_aviamento?.empresas?.nome_fantasia ?? "—"}{p.ocs_aviamento?.data_prevista_entrega ? ` · ${new Date(p.ocs_aviamento.data_prevista_entrega).toLocaleDateString("pt-BR")}` : ""}</span>
                <span className="shrink-0 font-medium">{fmt(Number(p.quantidade_pedida ?? 0))}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
