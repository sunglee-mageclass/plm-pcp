import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Rocket, Camera, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { brl, fmtNum } from "@/lib/format";
import { varianteLabel } from "@/lib/variante";
import { precoInfo } from "@/lib/preco";
import { cqLiberado } from "@/lib/cq-status";
import { ResumoVenda } from "@/components/shared/ResumoVenda";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FilterButton, SearchToggle, AgrupamentoButton } from "@/components/shared/filters";
import { DateField } from "@/components/shared/DateField";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useSort } from "@/components/shared/sort";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { useFilterState } from "@/hooks/useFilterState";
import { useAgrupamentoState } from "@/hooks/useAgrupamentoState";
import { useGridCols, GRID_COLS_OPTIONS, GRID_COLS_CLASS, useCompactCards } from "@/hooks/useGridCols";
import { LayoutGrid } from "lucide-react";

import { RequirePermission, useReadOnly } from "@/components/RequirePermission";
import { RevisaoErroBadge, VerificarRevisao } from "@/components/producao/RevisaoErro";
import { EmptyState } from "@/components/shared/EmptyState";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { ImagePreview } from "@/components/shared/ImagePreview";
export const Route = createFileRoute("/_authenticated/expedicao/lancamentos")({
  component: () => (
    <RequirePermission page="producao_lancamentos">
      <LancamentosPage />
    </RequirePermission>
  ),
});

type VarInfo = { num: number; label: string; gradeTotal: number };
type LancCard = {
  modelo_id: string;
  cad_id: string;
  ref: string | null;
  nome: string | null;
  colecao: string | null;
  subcolecao: string | null;
  semana: string | null;
  data_lancamento: string | null;
  linha: string | null;
  markup: number | null;
  markup_editado: number | null;
  preco_venda: number | null;
  mes: string | null;
  ano: string | null;
  mes_id: string | null;
  ano_id: string | null;
  linha_id: string | null;
  categoria_nome: string | null;
  categoria_principal_id: string | null;
  grupo_id: string | null;
  grupo_nome: string | null;
  subcategoria1_id: string | null;
  subcategoria1_nome: string | null;
  conjunto_id: string | null;
  origem: string | null;
  versao: number;
  fotos_modelo: string[];
  variantes: VarInfo[];
  gradeTotal: number;
  cqId: string | null;
  fotoByNum: Record<string, boolean>;
  revisao_pendente?: any;
};

// Data ISO (yyyy-MM-dd) → dd/MM/yyyy sem passar por new Date() (evita deslocar 1 dia por fuso).
const fmtDataBR = (s: string | null) => (s ? s.split("-").reverse().join("/") : null);

function LancamentosPage() {
  const fl = useFieldLabels();
  const readOnly = useReadOnly();
  const gridRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useGridCols("lancamentos");
  const compact = useCompactCards(gridRef, cols);
  const [q, setQ] = useState("");
  const [fColecao, setFColecao] = useFilterState("lancamentos", "Coleção", []);
  const [fSubcolecao, setFSubcolecao] = useFilterState("lancamentos", "Subcoleção", []);
  const [fCat, setFCat] = useFilterState("lancamentos", "Categoria", []);
  const [fSub1, setFSub1] = useFilterState("lancamentos", "Subcategoria", []);
  const [fLinha, setFLinha] = useFilterState("lancamentos", "Linha", []);
  const [fMes, setFMes] = useFilterState("lancamentos", "Mês", []);
  const [fAno, setFAno] = useFilterState("lancamentos", "Ano", []);
  const [fGrupo, setFGrupo] = useFilterState("lancamentos", "Grupo", []);
  const [fRep, setFRep] = useFilterState("lancamentos", "Repetição", []);
  const [fSemana, setFSemana] = useFilterState("lancamentos", "Lançamento nº", []);
  const [fOrigem, setFOrigem] = useFilterState("lancamentos", "Origem", []);
  const [fDe, setFDe] = useState(""); // data de lançamento — início do período
  const [fAte, setFAte] = useState(""); // data de lançamento — fim do período
  const agrup = useAgrupamentoState("lancamentos");
  const groupByCat = agrup.isOn("categoria");
  const groupByLinha = agrup.isOn("linha");
  const groupBySub1 = agrup.isOn("sub1");
  const groupByRep = agrup.isOn("repeticao");

  const { data: meses = [] } = useQuery({
    queryKey: ["opt", "meses"],
    queryFn: async () => (await supabase.from("meses").select("id, nome:mes").order("ordem")).data ?? [],
  });
  const { data: anos = [] } = useQuery({
    queryKey: ["opt", "anos"],
    queryFn: async () => (await supabase.from("anos").select("id, nome:ano").order("ano")).data ?? [],
  });

  const { data: cards = [], isLoading } = useQuery<LancCard[]>({
    queryKey: ["lancamentos-cards", meses, anos],
    queryFn: async () => {
      // Produtos: enviados ao CAD + CQ CONFIRMADO + LANÇADOS (gate explícito no card).
      const { data: modelos, error } = await supabase
        .from("modelos")
        .select("id, ref, nome, conjunto_id, colecao, subcolecao, semana, data_lancamento, mes_id, ano_id, linha_id, versao, preco_venda, markup_editado, revisao_pendente, fotos_modelo, categoria_principal_id, subcategoria1_id, origem, linha:linha_id(nome, markup), categorias_produto:categoria_principal_id(nome, grupo_id, grupo:grupo_id(nome)), subcategorias1_produto:subcategoria1_id(nome), cad(id, controle_qualidade(id, status, status_pos, fotografado_variantes), producao_terceirizados(ativo, categorias_terceirizado(etapa)))")
        .eq("enviado_cad", true)
        .eq("lancado", true);
      if (error) throw error;

      // CQ liberado = Pré confirmado + (se há pós-costura) Pós confirmado, igual ao
      // Direcionamento (@/lib/cq-status). Antes exigia só o Pré.
      const list = (modelos ?? []).filter((m: any) => m.cad?.[0]?.id && cqLiberado(m.cad[0]));
      const modeloIds = list.map((m: any) => m.id);
      const cadIds = list.map((m: any) => m.cad[0].id);

      // Grades cadastradas (por variante) + variantes do Tecido Principal.
      const [gradesRes, tecRes] = await Promise.all([
        cadIds.length
          ? supabase.from("cad_grades").select("cad_id, variante_numero, grade_total_real").in("cad_id", cadIds)
          : Promise.resolve({ data: [] as any[] }),
        cadIds.length
          ? supabase
              .from("cad_tecidos")
              .select("cad_id, tipo, numero, cad_tecido_variantes(ordem, variantes_tecido:variante_tecido_id(nome_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome)))")
              .in("cad_id", cadIds)
              .eq("tipo", "tecido")
              .eq("numero", 1)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      // Grade REAL do CQ (cad_grades.grade_total_real). Como os cards já são CQ
      // CONFIRMADO, a grade real reflete o que será de fato usado (desconta defeitos),
      // não a planejada — que era o errado.
      const gradeByCad = new Map<string, { num: number; total: number }[]>();
      (gradesRes.data ?? []).forEach((g: any) => {
        const arr = gradeByCad.get(g.cad_id) ?? [];
        arr.push({ num: Number(g.variante_numero), total: Number(g.grade_total_real ?? 0) });
        gradeByCad.set(g.cad_id, arr);
      });
      const tecByCad = new Map<string, any>();
      (tecRes.data ?? []).forEach((t: any) => tecByCad.set(t.cad_id, t));

      const mesMap = new Map((meses as any[]).map((m) => [m.id, m.nome]));
      const anoMap = new Map((anos as any[]).map((a) => [a.id, a.nome]));

      return list.map((m: any): LancCard => {
        const cadId = m.cad[0].id;
        const tec = tecByCad.get(cadId);
        const gradeRows = gradeByCad.get(cadId) ?? [];
        const gradeByNum = new Map(gradeRows.map((g) => [g.num, g.total]));
        const variantes: VarInfo[] = ((tec?.cad_tecido_variantes ?? []) as any[])
          .filter((v) => v.ordem != null)
          .map((v) => {
            const vt = v.variantes_tecido;
            const lbl = varianteLabel({ nome: vt?.nome_variante, cor: vt?.cor?.nome, apelido: vt?.apelido?.nome });
            return { num: Number(v.ordem), label: lbl !== "—" ? `${v.ordem} - ${lbl}` : `${v.ordem}`, gradeTotal: gradeByNum.get(Number(v.ordem)) ?? 0 };
          })
          .sort((a, b) => a.num - b.num);
        const gradeTotal = gradeRows.reduce((s, g) => s + g.total, 0);
        const cqRow = m.cad?.[0]?.controle_qualidade?.[0];
        const fv = cqRow?.fotografado_variantes ?? {};
        const fotoByNum: Record<string, boolean> = {};
        variantes.forEach((v) => { fotoByNum[String(v.num)] = fv?.[String(v.num)] === true; });
        return {
          modelo_id: m.id,
          cad_id: cadId,
          ref: m.ref,
          nome: m.nome,
          colecao: m.colecao,
          subcolecao: m.subcolecao ?? null,
          semana: m.semana ?? null,
          data_lancamento: m.data_lancamento ?? null,
          linha: m.linha?.nome ?? null,
          markup: m.linha?.markup ?? null,
          markup_editado: m.markup_editado ?? null,
          preco_venda: m.preco_venda ?? null,
          mes: m.mes_id ? (mesMap.get(m.mes_id) ?? null) : null,
          ano: m.ano_id ? (anoMap.get(m.ano_id) ?? null) : null,
          mes_id: m.mes_id,
          ano_id: m.ano_id,
          linha_id: m.linha_id,
          categoria_nome: m.categorias_produto?.nome ?? null,
          categoria_principal_id: m.categoria_principal_id ?? null,
          grupo_id: m.categorias_produto?.grupo_id ?? null,
          grupo_nome: m.categorias_produto?.grupo?.nome ?? null,
          subcategoria1_id: m.subcategoria1_id ?? null,
          subcategoria1_nome: (m as any).subcategorias1_produto?.nome ?? null,
          versao: Number(m.versao ?? 1),
          conjunto_id: (m as { conjunto_id?: string | null }).conjunto_id ?? null,
          origem: m.origem ?? null,
          fotos_modelo: Array.isArray(m.fotos_modelo) ? m.fotos_modelo : [],
          variantes,
          gradeTotal,
          cqId: cqRow?.id ?? null,
          fotoByNum,
          revisao_pendente: m.revisao_pendente,
        };
      });
    },
  });

  const colecoes = useMemo(() => Array.from(new Set(cards.map((c) => c.colecao).filter(Boolean))) as string[], [cards]);
  const linhas = useMemo(() => {
    const m = new Map<string, string>();
    cards.forEach((c) => { if (c.linha_id && c.linha) m.set(c.linha_id, c.linha); });
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [cards]);
  const grupos = useMemo(() => {
    const m = new Map<string, string>();
    cards.forEach((c) => { if (c.grupo_id && c.grupo_nome) m.set(c.grupo_id, c.grupo_nome); });
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [cards]);

  const subcolecoes = useMemo(() => {
    const s = new Set<string>();
    cards.forEach((c) => c.subcolecao && s.add(c.subcolecao));
    return Array.from(s).sort();
  }, [cards]);

  const categorias = useMemo(() => {
    const m = new Map<string, string>();
    cards.forEach((c) => { if (c.categoria_principal_id && c.categoria_nome) m.set(c.categoria_principal_id, c.categoria_nome); });
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [cards]);

  const sub1s = useMemo(() => {
    const m = new Map<string, string>();
    cards.forEach((c) => { if (c.subcategoria1_id && c.subcategoria1_nome) m.set(c.subcategoria1_id, c.subcategoria1_nome); });
    return Array.from(m, ([id, nome]) => ({ id, nome }));
  }, [cards]);

  const filtered = cards.filter((c) => {
    if (q && !`${c.ref ?? ""} ${c.nome ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (fColecao.length && !fColecao.includes(c.colecao ?? "")) return false;
    if (fSubcolecao.length && !fSubcolecao.includes(c.subcolecao ?? "")) return false;
    if (fCat.length && !fCat.includes(c.categoria_principal_id ?? "")) return false;
    if (fSub1.length && !fSub1.includes(c.subcategoria1_id ?? "")) return false;
    if (fLinha.length && !fLinha.includes(c.linha_id ?? "")) return false;
    if (fGrupo.length && !fGrupo.includes(c.grupo_id ?? "")) return false;
    if (fMes.length && !fMes.includes(c.mes_id ?? "")) return false;
    if (fAno.length && !fAno.includes(c.ano_id ?? "")) return false;
    if (fSemana.length && !fSemana.includes(c.semana ?? "")) return false;
    // Período de lançamento — compara ISO (yyyy-MM-dd) lexicograficamente.
    if (fDe && (!c.data_lancamento || c.data_lancamento < fDe)) return false;
    if (fAte && (!c.data_lancamento || c.data_lancamento > fAte)) return false;
    if (fRep.length && !fRep.some((v) => (v === "rep" ? (c.versao ?? 1) > 1 : v === "uni" ? (c.versao ?? 1) <= 1 : false))) return false;
    if (fOrigem.length && !fOrigem.includes(c.origem ?? "interno")) return false;
    return true;
  });

  // Badge de filtros ativos = multi-selects com ≥1 marcado + o Período (De/Até) como 1.
  const filtroCount =
    [fGrupo, fColecao, fSubcolecao, fCat, fSub1, fLinha, fMes, fAno, fSemana, fRep, fOrigem].filter((v) => v.length > 0).length +
    (fDe || fAte ? 1 : 0);
  const limparFiltros = () => {
    setFGrupo([]); setFColecao([]); setFSubcolecao([]); setFCat([]); setFSub1([]);
    setFLinha([]); setFMes([]); setFAno([]); setFSemana([]); setFRep([]); setFOrigem([]);
    setFDe(""); setFAte("");
  };

  // Ordenação dos cards. ref/nome/colecao/linha/categoria_nome/gradeTotal já são
  // valores CRUS no card (não formatados), então não precisam de accessors.
  // `sorted` substitui `filtered` na renderização.
  const s = useSort(filtered, undefined);
  const sorted = s.sorted;

  // Custo unitário (real senão previsto) por modelo — p/ markup real, preço e o
  // "poder de venda" (preço efetivo × grade).
  const modeloIdsAll = useMemo(() => cards.map((c) => c.modelo_id).sort(), [cards]);
  const { data: custoMap = {} } = useQuery({
    queryKey: ["lanc-custo-unit", modeloIdsAll],
    enabled: modeloIdsAll.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("custo_unitario_modelos" as any, { _ids: modeloIdsAll });
      if (error) throw error;
      return (data ?? {}) as Record<string, { previsto: number; real: number; confirmado: boolean }>;
    },
  });
  // EXPERIMENTAL (acompanhamento): custo real TOTAL por variante (Σ metragem×preço da variante).
  // Separado do custo oficial — mostrado em itálico no card.
  const { data: custoRealTotalMap = {} } = useQuery({
    queryKey: ["lanc-custo-real-total", modeloIdsAll],
    enabled: modeloIdsAll.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("custo_real_total_variantes" as any, { _ids: modeloIdsAll });
      if (error) throw error;
      return (data ?? {}) as Record<string, number>;
    },
  });
  // Custo real senão previsto (paridade com o Planejamento). Em Lançamentos o real
  // já costuma estar fechado (CQ confirmado), mas o fallback evita zerar preço/poder
  // de venda num raro CAD sem real.
  const piFor = (c: LancCard) => {
    const cu = (custoMap as any)[c.modelo_id];
    return precoInfo(cu?.real || cu?.previsto, c.markup, c.preco_venda, c.markup_editado);
  };
  const computeResumo = (items: LancCard[]) => {
    let poder = 0, somaMk = 0, nMk = 0;
    for (const c of items) {
      const p = piFor(c);
      poder += p.efetivo * (Number(c.gradeTotal) || 0);
      if (p.markupReal > 0) { somaMk += p.markupReal; nMk++; }
    }
    return { poder, qtd: items.length, markupMedio: nMk > 0 ? somaMk / nMk : 0 };
  };
  const resumo = computeResumo(sorted);

  // Agrupamentos combináveis: por linha, categoria e/ou repetição. Aninhamento
  // amplo→fino (linha › categoria › repetição); toggles independentes. Cada nó
  // carrega o próprio resumo (poder de venda etc.).
  type Split = { key: string; nome: string; items: LancCard[] };
  const byLinha = (items: LancCard[]): Split[] => {
    const map = new Map<string, LancCard[]>();
    items.forEach((c) => {
      const key = c.linha_id ?? "__none__";
      const arr = map.get(key);
      if (arr) arr.push(c); else map.set(key, [c]);
    });
    return Array.from(map.entries())
      .map(([key, its]) => ({ key, nome: key === "__none__" ? "Sem linha" : (its[0].linha ?? "Sem linha"), items: its }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  };
  const byCat = (items: LancCard[]): Split[] => {
    const map = new Map<string, LancCard[]>();
    items.forEach((c) => {
      const key = c.categoria_nome ?? "__none__";
      const arr = map.get(key);
      if (arr) arr.push(c); else map.set(key, [c]);
    });
    return Array.from(map.entries())
      .map(([key, its]) => ({ key, nome: key === "__none__" ? "Sem categoria" : key, items: its }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  };
  const bySub1 = (items: LancCard[]): Split[] => {
    const map = new Map<string, LancCard[]>();
    items.forEach((c) => {
      const key = c.subcategoria1_id ?? "__none__";
      const arr = map.get(key);
      if (arr) arr.push(c); else map.set(key, [c]);
    });
    return Array.from(map.entries())
      .map(([key, its]) => ({ key, nome: key === "__none__" ? "Sem subcategoria" : (its[0].subcategoria1_nome ?? "Sem subcategoria"), items: its }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  };
  const byRep = (items: LancCard[]): Split[] => {
    const reps = items.filter((c) => (c.versao ?? 1) > 1);
    const unis = items.filter((c) => (c.versao ?? 1) <= 1);
    const out: Split[] = [];
    if (reps.length) out.push({ key: "rep", nome: "Repetidos", items: reps });
    if (unis.length) out.push({ key: "uni", nome: "Únicos", items: unis });
    return out;
  };
  const splitters: ((items: LancCard[]) => Split[])[] = [
    groupByLinha ? byLinha : null,
    groupByCat ? byCat : null,
    groupBySub1 ? bySub1 : null,
    groupByRep ? byRep : null,
  ].filter(Boolean) as ((items: LancCard[]) => Split[])[];
  type Grupo = { key: string; nome: string; resumo: ReturnType<typeof computeResumo>; items?: LancCard[]; subgroups?: Grupo[] };
  const buildGroups = (items: LancCard[], depth: number): Grupo[] =>
    splitters[depth](items).map((g) => {
      const node: Grupo = { key: g.key, nome: g.nome, resumo: computeResumo(g.items) };
      if (depth + 1 < splitters.length) node.subgroups = buildGroups(g.items, depth + 1);
      else node.items = g.items;
      return node;
    });
  const groups: Grupo[] | null = splitters.length ? buildGroups(sorted, 0) : null;

  const renderLancCard = (c: LancCard) => {
    const pi = piFor(c);
    return (
      <LancamentoCard
        key={c.modelo_id}
        card={c}
        markup={pi.markupExibir > 0 ? pi.markupExibir : null}
        preco={pi.efetivo > 0 ? pi.efetivo : null}
        custoRealTotal={Number((custoRealTotalMap as any)[c.modelo_id] ?? 0) || null}
        compact={compact}
        readOnly={readOnly}
      />
    );
  };

  // Render recursivo dos grupos (profundidade arbitrária). Título encolhe com a
  // profundidade; nós internos ganham barra/indentação à esquerda.
  const HEADER_CLS = ["text-lg font-semibold", "text-base font-semibold", "text-sm font-semibold text-muted-foreground"];
  const renderGroup = (g: Grupo, depth: number) => (
    <section key={g.key}>
      <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 ${depth === 0 ? "mb-3" : "mb-2"}`}>
        <h2 className={HEADER_CLS[Math.min(depth, HEADER_CLS.length - 1)]}>{g.nome}</h2>
        <ResumoVenda {...g.resumo} />
      </div>
      {g.subgroups ? (
        <div className="space-y-5 border-l pl-3">{g.subgroups.map((sg) => renderGroup(sg, depth + 1))}</div>
      ) : (
        <div className={GRID_COLS_CLASS[cols]}>{g.items!.map(renderLancCard)}</div>
      )}
    </section>
  );

  // Sentinela "__none__" = ordem padrão. (Radix Select v2 PROÍBE SelectItem com
  // value "" — daí o sentinela.) Sem accessor "__none__" nem campo homônimo no card,
  // useSort lê undefined p/ todos → comparador estável → mantém a ordem original.
  const SORT_NONE = "__none__";
  const SORT_COLS: { key: string; label: string }[] = [
    { key: SORT_NONE, label: "Padrão" },
    { key: "ref", label: fl("ref") },
    { key: "nome", label: "Nome" },
    { key: "colecao", label: "Coleção" },
    { key: "linha", label: "Linha" },
    { key: "categoria_nome", label: "Categoria" },
    { key: "gradeTotal", label: "Grade total" },
  ];

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Rocket className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight">Lançamentos</h1>
            <p className="text-sm text-muted-foreground">Produtos com Controle de Qualidade confirmado.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 max-sm:w-full max-sm:justify-end">
          <SearchToggle value={q} onChange={setQ} placeholder={`${fl("ref")} ou nome…`} />
          <AgrupamentoButton
            groups={[
              { label: "Linha", active: groupByLinha, onToggle: () => agrup.toggle("linha", !groupByLinha) },
              { label: "Categoria", active: groupByCat, onToggle: () => agrup.toggle("categoria", !groupByCat) },
              { label: "Subcategoria", active: groupBySub1, onToggle: () => agrup.toggle("sub1", !groupBySub1) },
              { label: "Repetição", active: groupByRep, onToggle: () => agrup.toggle("repeticao", !groupByRep) },
            ]}
          />
          <FilterButton
            screen="lancamentos"
            activeCount={filtroCount}
            onClear={limparFiltros}
            filters={[
              { label: "Grupo", value: fGrupo, onChange: setFGrupo, options: grupos },
              { label: "Coleção", value: fColecao, onChange: setFColecao, options: colecoes.map((c) => ({ id: c, nome: c })) },
              { label: "Subcoleção", value: fSubcolecao, onChange: setFSubcolecao, options: subcolecoes.map((c) => ({ id: c, nome: c })) },
              { label: "Categoria", value: fCat, onChange: setFCat, options: categorias },
              { label: "Subcategoria", value: fSub1, onChange: setFSub1, options: sub1s },
              { label: "Linha", value: fLinha, onChange: setFLinha, options: linhas },
              { label: "Mês", value: fMes, onChange: setFMes, options: (meses as any[]).map((m) => ({ id: m.id, nome: m.nome })) },
              { label: "Ano", value: fAno, onChange: setFAno, options: (anos as any[]).map((a) => ({ id: a.id, nome: a.nome })) },
              { label: "Lançamento nº", value: fSemana, onChange: setFSemana, options: ["1", "2", "3", "4", "5"].map((n) => ({ id: n, nome: n })) },
              { label: "Repetição", value: fRep, onChange: setFRep, options: [{ id: "rep", nome: "Repetidos" }, { id: "uni", nome: "Únicos" }] },
              { label: "Origem", value: fOrigem, onChange: setFOrigem, options: [
                { id: "interno", nome: "Interno" },
                { id: "revenda", nome: "Revenda" },
              ] },
            ]}
          >
            {/* Período de lançamento (data_lancamento). Renderizado abaixo dos dropdowns. */}
            <div className="grid grid-cols-2 gap-x-5 gap-y-1 border-t pt-3">
              <div className="grid gap-1">
                <Label className="text-xs">Lançado de</Label>
                <DateField value={fDe} onChange={(e) => setFDe(e.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs">Lançado até</Label>
                <DateField value={fAte} onChange={(e) => setFAte(e.target.value)} />
              </div>
            </div>
          </FilterButton>
        </div>
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        <ResumoVenda {...resumo} />
        <div className="flex items-center gap-1.5 ml-auto">
          <Label className="text-xs text-muted-foreground">Ordenar por</Label>
          <Select
            value={s.sortKey ?? SORT_NONE}
            // `toggle(v)` define a chave em ASC ao trocar de coluna; "Padrão"
            // (SORT_NONE) volta à ordem original. A direção é invertida pelo botão
            // ao lado (Radix não re-dispara onValueChange p/ a mesma opção).
            onValueChange={(v) => { if (v !== (s.sortKey ?? SORT_NONE)) s.toggle(v); }}
          >
            <SelectTrigger className="h-8 w-[140px]"><SelectValue placeholder="Padrão" /></SelectTrigger>
            <SelectContent>
              {SORT_COLS.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {s.sortKey && s.sortKey !== SORT_NONE && (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 max-md:h-11 max-md:w-11 shrink-0"
              onClick={() => s.toggle(s.sortKey!)}
              aria-label={s.sortDir === "asc" ? "Ordenar decrescente" : "Ordenar crescente"}
              title={s.sortDir === "asc" ? "Crescente" : "Decrescente"}
            >
              {s.sortDir === "asc" ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
            </Button>
          )}
        </div>
        <div className="hidden lg:flex items-center gap-1.5">
          <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          <Label className="text-xs text-muted-foreground">Colunas</Label>
          <Select value={String(cols)} onValueChange={(v) => setCols(Number(v))}>
            <SelectTrigger className="h-8 w-16"><SelectValue /></SelectTrigger>
            <SelectContent>
              {GRID_COLS_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!isLoading && filtered.length === 0 && (
        <EmptyState icon={Rocket} title="Nenhum produto com CQ confirmado" description="Quando o CQ aprovar produtos, eles aparecerão aqui prontos para lançamento." />
      )}

      <div ref={gridRef}>
        {groups ? (
          <div className="space-y-8">
            {groups.map((g) => renderGroup(g, 0))}
          </div>
        ) : (
          <div className={GRID_COLS_CLASS[cols]}>{sorted.map(renderLancCard)}</div>
        )}
      </div>
    </div>
  );
}

function RelThumb({ path, refLabel }: { path: string | null; refLabel: string | null }) {
  const url = useSignedUrl(path, "modelos");
  const inner = (
    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded border bg-muted/40">
      {url ? <img src={url} alt={refLabel ?? ""} className="h-full w-full object-cover" /> : <span className="text-[9px] text-muted-foreground">Sem foto</span>}
    </div>
  );
  return (
    <div className="w-16 text-center">
      {url ? <ImagePreview src={url} alt={refLabel ?? ""}>{inner}</ImagePreview> : inner}
      <p className="mt-0.5 truncate font-mono text-[10px] text-primary">{refLabel ?? "—"}</p>
    </div>
  );
}

function RelacionadosLancamento({ conjuntoId, modeloId }: { conjuntoId: string | null; modeloId: string }) {
  const { data: membros = [] } = useQuery({
    queryKey: ["lanc-relacionados", conjuntoId, modeloId],
    enabled: !!conjuntoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos").select("id, ref, fotos_modelo")
        .eq("conjunto_id" as any, conjuntoId as string).neq("id", modeloId);
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; ref: string | null; fotos_modelo: string[] | null }[];
    },
  });
  if (!conjuntoId || membros.length === 0) return null;
  return (
    <div className="mt-1 border-t pt-2">
      <p className="mb-1 text-xs font-semibold text-muted-foreground">Produto relacionado</p>
      <div className="flex flex-wrap gap-2">
        {membros.map((m) => <RelThumb key={m.id} path={m.fotos_modelo?.[0] ?? null} refLabel={m.ref} />)}
      </div>
    </div>
  );
}

function LancamentoCard(props: { card: LancCard; markup: number | null; preco: number | null; custoRealTotal: number | null; compact: boolean; readOnly: boolean }) {
  const { card, compact, readOnly, markup, preco, custoRealTotal } = props;
  const qc = useQueryClient();
  const [foto, setFoto] = useState<Record<string, boolean>>(card.fotoByNum);
  useEffect(() => { setFoto(card.fotoByNum); }, [card.cqId, JSON.stringify(card.fotoByNum)]);

  const { data: modeloFoto } = useQuery({
    queryKey: ["modelo-foto", card.fotos_modelo?.[0]],
    enabled: !!card.fotos_modelo?.[0],
    staleTime: 55 * 60 * 1000, // signed URL vale 1h — não revalidar a cada filtro/remontagem
    queryFn: async () => (await supabase.storage.from("modelos").createSignedUrl(card.fotos_modelo[0], 3600)).data?.signedUrl ?? null,
  });
  const img = modeloFoto ?? null;

  // Câmera em 3 níveis: nenhuma foto → sem ícone; parcial → cinza; todas → verde.
  const total = card.variantes.length;
  const count = card.variantes.filter((v) => foto[String(v.num)]).length;
  const camColor = count === 0 ? null : count === total ? "text-[var(--tone-success-fg)]" : "text-muted-foreground";

  const saveFoto = useMutation({
    mutationFn: async (next: Record<string, boolean>) => {
      if (!card.cqId) throw new Error("Sem Controle de Qualidade para este modelo.");
      const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v).map(([k]) => [k, true]));
      const { error } = await supabase.from("controle_qualidade").update({ fotografado_variantes: clean } as never).eq("id", card.cqId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lancamentos-cards"] }),
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar foto")),
  });

  const toggle = (num: number) => {
    if (readOnly) return;
    const next = { ...foto, [String(num)]: !foto[String(num)] };
    setFoto(next);
    saveFoto.mutate(next);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Card className="overflow-hidden flex flex-col cursor-pointer transition hover:ring-1 hover:ring-primary/40">
          <div className="aspect-square bg-muted relative">
            {img ? (
              <img src={img} alt={card.ref ?? ""} loading="lazy" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">Sem foto</div>
            )}
            {compact && camColor && (
              <span className="absolute top-2 left-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-background/80">
                <Camera className={"h-3.5 w-3.5 " + camColor} />
              </span>
            )}
          </div>

          {compact && (
            <div className="p-2 space-y-0.5">
              <p className="font-mono text-primary text-[11px] truncate">{card.ref ?? "—"}</p>
              {preco != null && <p className="text-[11px] font-medium truncate">{brl(preco)}</p>}
              {preco != null && card.gradeTotal > 0 && (
                <p className="text-[10px] text-muted-foreground truncate">PV: {brl(preco * card.gradeTotal)}</p>
              )}
            </div>
          )}

          {!compact && (
            <div className="p-3 space-y-1 flex-1 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-primary">{card.ref ?? "—"}</p>
                <div className="flex items-center gap-1">
                  <VersaoBadge versao={card.versao} />
                  <RevisaoErroBadge revisao={card.revisao_pendente} etapa="lancamentos" />
                  {camColor && <Camera className={"h-4 w-4 " + camColor} />}
                </div>
              </div>
              <p className="font-semibold text-sm leading-tight line-clamp-2">{card.nome ?? "—"}</p>
              <p className="text-muted-foreground truncate">{[card.colecao, card.subcolecao].filter(Boolean).join(" · ") || "—"}</p>
              {(card.semana || card.data_lancamento) && (
                <p className="text-muted-foreground truncate">
                  {[card.semana ? `Lançamento ${card.semana}` : null, fmtDataBR(card.data_lancamento)].filter(Boolean).join(" · ")}
                </p>
              )}
              <p className="text-muted-foreground truncate">{[card.linha, card.categoria_nome, card.subcategoria1_nome].filter(Boolean).join(" · ") || "—"}</p>
              <p className="text-muted-foreground">{[card.mes, card.ano].filter(Boolean).join(" / ") || "—"}</p>
              {markup != null && <p className="text-muted-foreground">Markup: {fmtNum(markup)}</p>}
              {preco != null && <p className="font-medium">Preço avulso: {brl(preco)}</p>}
              {preco != null && card.gradeTotal > 0 && (
                <p className="text-muted-foreground">Poder de venda: {brl(preco * card.gradeTotal)}</p>
              )}
              {custoRealTotal != null && custoRealTotal > 0 && (
                <p className="text-xs italic text-muted-foreground" title="Experimental — Σ(metragem × preço da variante). Não entra no custo oficial.">
                  Custo real total (acomp.): {brl(custoRealTotal)}
                </p>
              )}
              {card.variantes.length > 0 && (
                <div className="pt-1 mt-1 border-t space-y-0.5">
                  {card.variantes.map((v) => (
                    <div key={v.num} className="flex items-center justify-between gap-2">
                      <span className="truncate">{v.label}</span>
                      <span className="tabular-nums text-muted-foreground shrink-0">{v.gradeTotal}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-2 pt-0.5 border-t font-medium">
                    <span>Grade total</span>
                    <span className="tabular-nums">{card.gradeTotal}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </DialogTrigger>

      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Fotos por variante — {card.ref ?? "—"}</DialogTitle>
        </DialogHeader>
        <VerificarRevisao modeloId={card.modelo_id} etapa="lancamentos" revisao={card.revisao_pendente} />
        <div className="space-y-1">
          {card.variantes.length === 0 && <p className="text-sm text-muted-foreground">Sem variantes no Tecido Principal.</p>}
          {card.variantes.map((v) => {
            const on = !!foto[String(v.num)];
            return (
              <div key={v.num} className="flex items-center justify-between gap-2 rounded px-2 py-1 max-md:py-2 hover:bg-muted/50">
                <span className="text-sm truncate">{v.label}</span>
                <Button
                  type="button"
                  size="icon"
                  variant={on ? "default" : "outline"}
                  className={"h-8 w-8 max-md:h-11 max-md:w-11 shrink-0 " + (on ? "bg-[var(--tone-success-fg)] hover:bg-[var(--tone-success-fg)]/90" : "")}
                  disabled={readOnly || saveFoto.isPending || !card.cqId}
                  onClick={() => toggle(v.num)}
                  title={on ? "Fotografada" : "Sem foto"}
                >
                  <Camera className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
        <RelacionadosLancamento conjuntoId={card.conjunto_id} modeloId={card.modelo_id} />
      </DialogContent>
    </Dialog>
  );
}
