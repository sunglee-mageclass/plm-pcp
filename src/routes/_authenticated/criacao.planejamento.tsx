import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette, Plus, Search, Upload, Trash2, Copy, ImageIcon, Layers, Group, LayoutGrid, ArrowLeft, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";


import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NumberInput } from "@/components/shared/NumberInput";
import { precoInfo } from "@/lib/preco";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { useGridCols, GRID_COLS_OPTIONS, GRID_COLS_CLASS, useCompactCards } from "@/hooks/useGridCols";
import { useFieldLabels } from "@/hooks/useFieldLabels";
import { brl, fmtNum } from "@/lib/format";
import { FilterButton, SearchToggle } from "@/components/shared/filters";
import { useSort } from "@/components/shared/sort";
import { EmptyState } from "@/components/shared/EmptyState";
import { MobileActionBar } from "@/components/shared/MobileActionBar";

import { RequirePermission } from "@/components/RequirePermission";
import { VersaoBadge } from "@/components/shared/VersaoBadge";
export const Route = createFileRoute("/_authenticated/criacao/planejamento")({
  component: () => (
    <RequirePermission page="criacao_planejamento">
      <PlanejamentoPage />
    </RequirePermission>
  ),
});

const BUCKET = "modelos";

/**
 * Sincroniza tecidos_planejados (Planejamento) com modelo_tecidos tipo "tecido" (Desenvolvimento).
 * - Preserva blocos não-tecido (forro/entretela/etc).
 * - Se o artigo de um numero mudou, limpa variantes daquela linha.
 * - Remove tecidos cujo numero não está mais em planejados.
 * - Insere novos com consumo=0.
 */
async function syncTecidosToDesenvolvimento(modeloId: string, planejados: string[]) {
  const { data: existing, error: eFetch } = await supabase
    .from("modelo_tecidos")
    .select("id, artigo_id, numero, tipo")
    .eq("modelo_id", modeloId)
    .eq("tipo", "tecido");
  if (eFetch) throw eFetch;
  const rows = (existing ?? []) as any[];

  // Casa por ARTIGO (e não por posição): assim REORDENAR ou REMOVER um tecido no
  // Planejamento NÃO apaga as variantes/cores e o consumo já preenchidos no
  // Desenvolvimento — só reposiciona (numero) ou insere/remove o que mudou.
  const usedIds = new Set<string>();
  for (let i = 0; i < planejados.length; i++) {
    const numero = i + 1;
    const artigoId = planejados[i];
    const match = rows.find((r) => r.artigo_id === artigoId && !usedIds.has(r.id));
    if (match) {
      usedIds.add(match.id);
      if (match.numero !== numero) {
        const { error } = await supabase.from("modelo_tecidos").update({ numero }).eq("id", match.id);
        if (error) throw error;
      }
    } else {
      const { error } = await supabase.from("modelo_tecidos").insert({
        modelo_id: modeloId, tipo: "tecido", numero, artigo_id: artigoId,
        consumo: 0, loss_percent: 0, custo_previsto: 0,
      });
      if (error) throw error;
    }
  }

  // Remove só os tecidos cujo artigo NÃO está mais planejado (aí sim apaga as
  // variantes deles).
  const toDelete = rows.filter((r) => !usedIds.has(r.id));
  if (toDelete.length > 0) {
    const ids = toDelete.map((r) => r.id);
    await supabase.from("modelo_tecido_variantes").delete().in("modelo_tecido_id", ids);
    await supabase.from("modelo_tecidos").delete().in("id", ids);
  }
}


type Opt = { id: string; nome: string };
type Modelo = {
  id: string;
  nome: string | null;
  estilista_id: string | null;
  linha_id: string | null;
  colecao: string | null;
  semana: string | null;
  mes_id: string | null;
  ano_id: string | null;
  categoria_principal_id: string | null;
  categoria_secundaria_id: string | null;
  status_planejamento: string | null;
  fotos_modelo: string[] | null;
  fotos_referencia: string[] | null;
  desenho_tecnico_url: string | null;
  croqui_url: string | null;
  observacoes_gerais: string | null;
  versao: number;
  modelo_base_id: string | null;
  preco_venda: number | null;
};

const STATUS_OPTS = [
  { value: "em_planejamento", label: "Em Planejamento", color: "bg-amber-500" },
  { value: "reprovado", label: "Reprovado", color: "bg-red-500" },
  { value: "planejado", label: "Planejado", color: "bg-emerald-500" },
];
const statusMeta = (s: string | null) => STATUS_OPTS.find((o) => o.value === s) ?? STATUS_OPTS[0];


async function uploadFile(file: File, prefix: string) {
  const { tenantPrefix, sanitizeStorageName } = await import("@/lib/storage-tenant");
  const tenant = await tenantPrefix();
  const path = `${tenant}/${prefix}/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

function useOpts(table: string, key = "nome") {
  return useQuery({
    queryKey: ["opt", table, key],
    queryFn: async () => {
      const { data, error } = await supabase.from(table as any).select(`id, ${key}`).order(key);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ id: r.id, nome: r[key] })) as Opt[];
    },
  });
}

type CatOpt = { id: string; nome: string; grupo_id: string | null };

function PlanejamentoPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [fStatus, setFStatus] = useState("all");
  const [fEstilista, setFEstilista] = useState("all");
  const [fSemana, setFSemana] = useState("");
  const [fMes, setFMes] = useState("all");
  const [fAno, setFAno] = useState("all");
  const [fCat, setFCat] = useState("all");
  const [fColecao, setFColecao] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [openBatch, setOpenBatch] = useState(false);
  const [groupByCat, setGroupByCat] = useState(true);
  const [cols, setCols] = useGridCols("planejamento");
  const gridRef = useRef<HTMLDivElement>(null);
  const compact = useCompactCards(gridRef, cols);
  const fl = useFieldLabels();

  const { data: estilistas = [] } = useQuery({
    queryKey: ["colab-estilistas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("id, nome").eq("tipo", "estilista").order("nome");
      if (error) throw error;
      return (data ?? []) as Opt[];
    },
  });
  const { data: meses = [] } = useOpts("meses", "mes");
  const { data: anos = [] } = useOpts("anos", "ano");
  const { data: grupos = [] } = useOpts("grupos_produto");
  const { data: categorias = [] } = useQuery({
    queryKey: ["opt", "categorias_produto", "com-grupo"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_produto").select("id, nome, grupo_id").order("nome");
      if (error) throw error;
      return (data ?? []) as CatOpt[];
    },
  });
  const { data: linhas = [] } = useQuery({
    queryKey: ["opt", "linhas", "com-markup"],
    queryFn: async () => {
      const { data, error } = await supabase.from("linhas").select("id, nome, markup").order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; markup: number | null }[];
    },
  });
  const { data: artigos = [] } = useQuery({
    queryKey: ["artigos-planejamento"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("id, nome, unidade_medida, preco_por_metro")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string; unidade_medida: string | null; preco_por_metro: number | null }[];
    },
  });

  const { data: modelos = [] } = useQuery({
    queryKey: ["modelos-planejamento"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("modelos")
        .select("id, nome, estilista_id, linha_id, colecao, semana, mes_id, ano_id, categoria_principal_id, categoria_secundaria_id, status_planejamento, fotos_modelo, fotos_referencia, desenho_tecnico_url, croqui_url, observacoes_gerais, versao, modelo_base_id, preco_venda")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Modelo[];
    },
  });

  const modeloIdsAll = useMemo(() => modelos.map((m) => m.id).sort(), [modelos]);

  // Custo unitário (real senão previsto) e grade planejada por modelo — p/ o preço
  // efetivo e o "poder de venda" (preço × grade).
  const { data: custoMap = {} } = useQuery({
    queryKey: ["plan-custo-unit", modeloIdsAll],
    enabled: modeloIdsAll.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("custo_unitario_modelos" as any, { _ids: modeloIdsAll });
      if (error) throw error;
      return (data ?? {}) as Record<string, { previsto: number; real: number; confirmado: boolean }>;
    },
  });
  const { data: gradeByModelo = {} } = useQuery({
    queryKey: ["plan-grade-total", modeloIdsAll],
    enabled: modeloIdsAll.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("modelo_grades").select("modelo_id, grade_total").in("modelo_id", modeloIdsAll);
      if (error) throw error;
      const m: Record<string, number> = {};
      for (const r of (data ?? []) as any[]) m[r.modelo_id] = (m[r.modelo_id] ?? 0) + Number(r.grade_total ?? 0);
      return m;
    },
  });

  const colecoes = useMemo(() => {
    const s = new Set<string>();
    modelos.forEach((m) => m.colecao && s.add(m.colecao));
    return Array.from(s).sort();
  }, [modelos]);

  const filtered = modelos.filter((m) => {
    if (search && !(m.nome ?? "").toLowerCase().includes(search.toLowerCase())) return false;
    if (fStatus !== "all" && m.status_planejamento !== fStatus) return false;
    if (fEstilista !== "all" && m.estilista_id !== fEstilista) return false;
    if (fSemana && m.semana !== fSemana) return false;
    if (fMes !== "all" && m.mes_id !== fMes) return false;
    if (fAno !== "all" && m.ano_id !== fAno) return false;
    if (fCat !== "all" && m.categoria_principal_id !== fCat) return false;
    if (fColecao !== "all" && m.colecao !== fColecao) return false;
    return true;
  });

  const estMap = Object.fromEntries(estilistas.map((e) => [e.id, e.nome]));
  const catMap = Object.fromEntries(categorias.map((c) => [c.id, c.nome]));
  const linhaMap = Object.fromEntries(linhas.map((l) => [l.id, l.nome]));
  const linhaMarkupMap = Object.fromEntries(linhas.map((l) => [l.id, l.markup]));
  // Preço/markup efetivos de um modelo (custo × markup da linha → sugerido → venda).
  const piFor = (m: Modelo) =>
    precoInfo((custoMap as any)[m.id]?.real, m.linha_id ? linhaMarkupMap[m.linha_id] : 0, m.preco_venda);
  const mesMap = Object.fromEntries(meses.map((x) => [x.id, x.nome]));

  // Ordenação dos cards. Como nome/estilista/categoria/coleção/linha/status são
  // exibidos formatados (ou via mapa de id→nome), ordenamos pelo VALOR CRU usando
  // accessors. `sorted` substitui o array `filtered` na renderização e no agrupamento.
  // estMap/catMap/linhaMap são recriados a cada render (Object.fromEntries), logo
  // dependemos das listas estáveis (estilistas/categorias/linhas) p/ não recriar o
  // objeto de accessors — e assim o useMemo do useSort não recomputa em todo render.
  const sortAccessors = useMemo(() => ({
    estilista: (m: Modelo) => (m.estilista_id ? estMap[m.estilista_id] : null),
    categoria: (m: Modelo) => (m.categoria_principal_id ? catMap[m.categoria_principal_id] : null),
    linha: (m: Modelo) => (m.linha_id ? linhaMap[m.linha_id] : null),
    status: (m: Modelo) => statusMeta(m.status_planejamento).label,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [estilistas, categorias, linhas]);
  // `opts` precisa ser estável (referência) — senão o useMemo interno do useSort,
  // que tem `opts` nas deps, recomputa a ordenação a cada render.
  const sortOpts = useMemo(() => ({ accessors: sortAccessors }), [sortAccessors]);
  const s = useSort(filtered, sortOpts);
  const sorted = s.sorted;

  // Resumo (influenciado pelos filtros): poder de venda = Σ (preço efetivo × grade);
  // markup médio real = média aritmética do markup real dos modelos que o têm.
  const resumo = useMemo(() => {
    let poder = 0, somaMk = 0, nMk = 0;
    for (const m of sorted) {
      const p = piFor(m);
      poder += p.efetivo * numOr0((gradeByModelo as any)[m.id]);
      if (p.markupReal > 0) { somaMk += p.markupReal; nMk++; }
    }
    return { poder, qtd: sorted.length, markupMedio: nMk > 0 ? somaMk / nMk : 0 };
  }, [sorted, custoMap, gradeByModelo, linhas]);

  // Sentinela "__none__" = ordem padrão. (Radix Select v2 PROÍBE SelectItem com
  // value "" — daí o sentinela.) Como não existe accessor "__none__" nem campo
  // homônimo no Modelo, useSort lê undefined p/ todos → comparador estável →
  // devolve a ordem original (created_at desc da query). Tratamos como "sem ordenação".
  const SORT_NONE = "__none__";
  const SORT_COLS: { key: string; label: string }[] = [
    { key: SORT_NONE, label: "Padrão" },
    { key: "nome", label: "Nome" },
    { key: "estilista", label: fl("estilista") },
    { key: "colecao", label: fl("colecao") },
    { key: "categoria", label: "Categoria" },
    { key: "linha", label: "Linha" },
    { key: "semana", label: "Semana" },
    { key: "status", label: "Status" },
  ];

  const renderCard = (m: Modelo) => (
    <ModeloCard
      key={m.id}
      modelo={m}
      estilistaNome={m.estilista_id ? estMap[m.estilista_id] : null}
      categoriaNome={m.categoria_principal_id ? catMap[m.categoria_principal_id] : null}
      linhaNome={m.linha_id ? linhaMap[m.linha_id] : null}
      markup={(() => { const p = piFor(m); return p.markupExibir > 0 ? p.markupExibir : null; })()}
      preco={(() => { const p = piFor(m); return p.efetivo > 0 ? p.efetivo : null; })()}
      mesNome={m.mes_id ? mesMap[m.mes_id] : null}
      onOpen={() => setOpenId(m.id)}
      compact={compact}
    />
  );

  // Agrupa por categoria principal (cards sem categoria caem em "Sem categoria").
  const grouped = (() => {
    const map = new Map<string, Modelo[]>();
    sorted.forEach((m) => {
      const key = m.categoria_principal_id ?? "__none__";
      const arr = map.get(key);
      if (arr) arr.push(m);
      else map.set(key, [m]);
    });
    return Array.from(map.entries())
      .map(([key, items]) => ({
        key,
        nome: key === "__none__" ? "Sem categoria" : catMap[key] ?? "Sem categoria",
        items,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  })();

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Palette className="h-7 w-7 shrink-0 text-primary mt-0.5" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold truncate">Planejamento</h1>
            <p className="text-sm text-muted-foreground">Cards de modelos em planejamento.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">

          <SearchToggle value={search} onChange={setSearch} placeholder="Pesquisar por nome…" />
          <FilterButton
            filters={[
              { label: "Status", value: fStatus, onChange: setFStatus, options: [{ id: "all", nome: "Todos" }, ...STATUS_OPTS.map((s) => ({ id: s.value, nome: s.label }))] },
              { label: fl("estilista"), value: fEstilista, onChange: setFEstilista, options: [{ id: "all", nome: "Todos" }, ...estilistas] },
              { label: "Semana", value: fSemana || "all", onChange: (v) => setFSemana(v === "all" ? "" : v), options: [{ id: "all", nome: "Todas" }, ...["1","2","3","4","5"].map((s) => ({ id: s, nome: s }))] },
              { label: "Mês de Planejamento", value: fMes, onChange: setFMes, options: [{ id: "all", nome: "Todos" }, ...meses] },
              { label: "Ano", value: fAno, onChange: setFAno, options: [{ id: "all", nome: "Todos" }, ...anos] },
              { label: "Categoria", value: fCat, onChange: setFCat, options: [{ id: "all", nome: "Todas" }, ...categorias] },
              { label: fl("colecao"), value: fColecao, onChange: setFColecao, options: [{ id: "all", nome: "Todas" }, ...colecoes.map((c) => ({ id: c, nome: c }))] },
            ]}
          />
          <Button className="max-sm:hidden" variant="outline" onClick={() => setOpenBatch(true)} aria-label="Vários Cards"><Layers className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Vários Cards</span></Button>
          <Button className="max-sm:hidden" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" /><span className="sm:hidden">Novo</span><span className="hidden sm:inline">Novo Modelo</span></Button>
        </div>
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant={groupByCat ? "default" : "outline"}
          size="sm"
          onClick={() => setGroupByCat((v) => !v)}
        >
          <Group className="h-4 w-4 mr-1" /> Agrupar por categoria
        </Button>
        <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
          <span>Poder de venda: <strong className="text-foreground tabular-nums">{brl(resumo.poder)}</strong></span>
          <span aria-hidden>·</span>
          <span>Markup médio real: <strong className="text-foreground tabular-nums">{resumo.markupMedio > 0 ? resumo.markupMedio.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}</strong></span>
          <span aria-hidden>·</span>
          <span><strong className="text-foreground tabular-nums">{resumo.qtd}</strong> {resumo.qtd === 1 ? "modelo" : "modelos"}</span>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <Label className="text-xs text-muted-foreground">Ordenar por</Label>
          <Select
            value={s.sortKey ?? SORT_NONE}
            // `toggle(v)` define a chave em ASC ao trocar de coluna; "Padrão"
            // (SORT_NONE) volta à ordem original. A direção (ASC/DESC) é invertida
            // pelo botão ao lado, não aqui (Radix não re-dispara onValueChange p/ a
            // mesma opção, então o toggle de direção precisa de um controle próprio).
            onValueChange={(v) => { if (v !== (s.sortKey ?? SORT_NONE)) s.toggle(v); }}
          >
            <SelectTrigger className="h-8 w-[140px]"><SelectValue placeholder="Padrão" /></SelectTrigger>
            <SelectContent>
              {SORT_COLS.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {/* Botão de direção: só aparece com uma coluna real escolhida. Inverte
              ASC↔DESC re-chamando toggle na MESMA chave (ramo que a UI de Select
              sozinha nunca alcançava). */}
          {s.sortKey && s.sortKey !== SORT_NONE && (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
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

      <div ref={gridRef}>
      {filtered.length === 0 ? (
        <EmptyState icon={Palette} title="Nenhum modelo encontrado" description="Crie um modelo usando o botão Novo Modelo." />
      ) : groupByCat ? (
        <div className="space-y-8">
          {grouped.map((g) => (
            <section key={g.key}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold">{g.nome}</h2>
                <Badge variant="secondary">{g.items.length}</Badge>
              </div>
              <div className={GRID_COLS_CLASS[cols]}>{g.items.map(renderCard)}</div>
            </section>
          ))}
        </div>
      ) : (
        <div className={GRID_COLS_CLASS[cols]}>{sorted.map(renderCard)}</div>
      )}
      </div>

      {(openNew || openId) && (
        <ModeloDialog
          modeloId={openId}
          estilistas={estilistas}
          linhas={linhas}
          meses={meses}
          anos={anos}
          grupos={grupos}
          categorias={categorias}
          artigos={artigos}
          onClose={() => { setOpenNew(false); setOpenId(null); }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["modelos-planejamento"] })}
        />
      )}

      {openBatch && (
        <BatchCardsDialog
          meses={meses}
          anos={anos}
          grupos={grupos}
          categorias={categorias}
          onClose={() => setOpenBatch(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["modelos-planejamento"] })}
        />
      )}

      <MobileActionBar>
        <Button variant="outline" onClick={() => setOpenBatch(true)}><Layers className="h-4 w-4 mr-1" /> Vários Cards</Button>
        <Button className="ml-auto" onClick={() => setOpenNew(true)}><Plus className="h-4 w-4 mr-1" /> Novo Modelo</Button>
      </MobileActionBar>
    </div>
  );
}


function ModeloCard({ modelo, estilistaNome, categoriaNome, linhaNome, markup, preco, mesNome, onOpen, compact }: {
  modelo: Modelo; estilistaNome: string | null; categoriaNome: string | null; linhaNome: string | null; markup: number | null; preco: number | null; mesNome: string | null; onOpen: () => void; compact?: boolean;
}) {
  // Hierarquia da capa: Foto do Modelo -> Desenho Técnico -> Croqui -> vazio.
  const cover = (modelo.fotos_modelo?.[0]) || modelo.desenho_tecnico_url || modelo.croqui_url || null;
  const url = useSignedUrlBucket(cover);
  const coverIsPdf = /\.pdf$/i.test(cover ?? "");
  const meta = statusMeta(modelo.status_planejamento);
  return (
    <Card className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow" onClick={onOpen}>
      <div className="aspect-[3/4] bg-muted flex items-center justify-center overflow-hidden">
        {!url ? (
          <ImageIcon className="h-10 w-10 text-muted-foreground" />
        ) : coverIsPdf ? (
          <iframe src={`${url}#toolbar=0&navpanes=0&scrollbar=0`} title="" className="w-full h-full pointer-events-none" />
        ) : (
          <img src={url} alt={modelo.nome ?? ""} className="w-full h-full object-cover" />
        )}
      </div>
      {!compact && (
      <div className="p-3 space-y-1.5">
        <h3 className="font-semibold text-sm leading-tight truncate">{modelo.nome || "Sem nome"}</h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge className={`${meta.color} text-white`}>{meta.label}</Badge>
          <VersaoBadge versao={modelo.versao} />
        </div>
        <p className="text-xs text-muted-foreground truncate">{estilistaNome ?? "—"}</p>
        <p className="text-xs text-muted-foreground truncate">{modelo.colecao ?? "Sem coleção"}</p>
        <p className="text-xs text-muted-foreground truncate">{mesNome ?? "—"}</p>
        <p className="text-xs text-muted-foreground truncate">{categoriaNome ?? "Sem categoria"}</p>
        <p className="text-xs text-muted-foreground truncate">{linhaNome ?? "Sem linha"}</p>
        {markup != null && <p className="text-xs text-muted-foreground truncate">Markup: {Number(markup).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</p>}
        {preco != null && <p className="text-xs font-medium truncate">{brl(preco)}</p>}
      </div>
      )}
    </Card>
  );
}

/* Signed URL hook scoped to modelos bucket */
const _cache = new Map<string, { url: string; exp: number }>();
function useSignedUrlBucket(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    const key = `${BUCKET}:${path}`;
    const cached = _cache.get(key);
    const now = Date.now();
    if (cached && cached.exp > now + 60_000) { setUrl(cached.url); return; }
    supabase.storage.from(BUCKET).createSignedUrl(path, 3600).then(({ data }) => {
      if (!alive || !data?.signedUrl) return;
      _cache.set(key, { url: data.signedUrl, exp: now + 3600_000 });
      setUrl(data.signedUrl);
    });
    return () => { alive = false; };
  }, [path]);
  return url;
}


/* ============ DIALOG ============ */

type Draft = {
  nome: string;
  estilista_id: string | null;
  linha_id: string | null;
  colecao: string;
  semana: string;
  mes_id: string | null;
  ano_id: string | null;
  categoria_principal_id: string | null;
  categoria_secundaria_id: string | null;
  subcategoria1_id: string | null;
  subcategoria2_id: string | null;
  preco_venda: number | null;
  tecidos_planejados: string[];
  status_planejamento: string;
  croqui_url: string;
  desenho_tecnico_url: string;
  fotos_modelo: string[];
  fotos_referencia: string[];
  observacoes_gerais: string;
  versao: number;
  modelo_base_id: string | null;
};
const emptyDraft = (): Draft => ({
  nome: "", estilista_id: null, linha_id: null, colecao: "", semana: "", mes_id: null, ano_id: null,
  categoria_principal_id: null, categoria_secundaria_id: null,
  subcategoria1_id: null, subcategoria2_id: null, preco_venda: null,
  tecidos_planejados: [],
  status_planejamento: "em_planejamento", croqui_url: "", desenho_tecnico_url: "", fotos_modelo: [], fotos_referencia: [],
  observacoes_gerais: "",
  versao: 1, modelo_base_id: null,
});

type ArtigoOpt = { id: string; nome: string; unidade_medida: string | null; preco_por_metro: number | null };

type LinhaOpt = { id: string; nome: string; markup: number | null };
type SubOpt = { id: string; nome: string; categoria_id: string | null };

const numOr0 = (v: any) => Number(v ?? 0) || 0;

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground border-b pb-1.5">{titulo}</h3>
      {children}
    </section>
  );
}

/** Campo somente-leitura (label + valor) no mesmo estilo dos inputs do form. */
function CampoRO({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <div className="h-9 px-3 flex items-center rounded-md border bg-muted text-sm tabular-nums">{value}</div>
    </div>
  );
}

function ModeloDialog({
  modeloId, estilistas, linhas, meses, anos, grupos, categorias, artigos, onClose, onSaved,
}: {
  modeloId: string | null; estilistas: Opt[]; linhas: LinhaOpt[]; meses: Opt[]; anos: Opt[];
  grupos: Opt[]; categorias: CatOpt[];
  artigos: ArtigoOpt[];
  onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!modeloId;
  const qc = useQueryClient();
  const fl = useFieldLabels();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  // Grupo é transiente (não é coluna do modelo) — filtra as Categorias na cascata.
  const [grupoSel, setGrupoSel] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  // Estoque por artigo (físico/disponível) para mostrar ao selecionar o tecido.
  const { data: estoqueArr = [] } = useQuery({
    queryKey: ["estoque-tecido-por-artigo"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("estoque_tecido_por_artigo" as any);
      if (error) throw error;
      return (data ?? []) as Array<{ artigo_id: string; fisico_m: number; reservado_m: number; disponivel_m: number }>;
    },
  });
  const estoqueMap = useMemo(
    () => Object.fromEntries(estoqueArr.map((e) => [e.artigo_id, e])),
    [estoqueArr],
  ) as Record<string, EstoqueArtigo>;

  // Subcategorias 1 e 2 (filhas da Categoria) — Setor "Informações Gerais".
  const { data: sub1Opts = [] } = useQuery({
    queryKey: ["opt", "subcategorias1_produto"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subcategorias1_produto").select("id, nome, categoria_id").order("nome");
      if (error) throw error;
      return (data ?? []) as SubOpt[];
    },
  });
  const { data: sub2Opts = [] } = useQuery({
    queryKey: ["opt", "subcategorias2_produto"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subcategorias2_produto").select("id, nome, categoria_id").order("nome");
      if (error) throw error;
      return (data ?? []) as SubOpt[];
    },
  });

  // Custo total unitário do modelo (real de Serviços senão previsto de Desenvolvimento).
  const { data: custoData } = useQuery({
    queryKey: ["plan-custo-unit", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("custo_unitario_modelos" as any, { _ids: [modeloId] });
      if (error) throw error;
      return ((data ?? {}) as any)[modeloId as string] as { previsto: number; real: number; confirmado: boolean } | undefined;
    },
  });

  // Cálculo de preço (Setor "Preço") — mesma lógica usada na lista e nos Lançamentos.
  const custoReal = !!custoData?.confirmado;
  const { custo, markupLinha: markup, preco, sugerido: precoSug, markupReal } =
    precoInfo(custoData?.real, linhas.find((l) => l.id === draft.linha_id)?.markup, draft.preco_venda);

  // Pré-preenche o Preço para venda com o sugerido (uma vez por modelo); não sobrescreve
  // valor salvo nem edição do usuário.
  const precoPrefilled = useRef(false);
  useEffect(() => { precoPrefilled.current = false; }, [modeloId]);
  useEffect(() => {
    if (!precoPrefilled.current && numOr0(draft.preco_venda) <= 0 && precoSug > 0) {
      precoPrefilled.current = true;
      setDraft((d) => ({ ...d, preco_venda: precoSug }));
    }
  }, [precoSug, draft.preco_venda]);

  // "Ordem de Criação enviada" = gate p/ o Desenvolvimento (botão, não mais o status).
  const [enviada, setEnviada] = useState(false);

  useQuery({
    queryKey: ["modelo", modeloId],
    enabled: !!modeloId,
    queryFn: async () => {
      if (!modeloId) return null;
      const { data, error } = await supabase.from("modelos").select("*").eq("id", modeloId).maybeSingle();
      if (error) throw error;
      if (data) {
        setDraft({
          nome: data.nome ?? "",
          estilista_id: data.estilista_id,
          linha_id: (data as any).linha_id ?? null,
          colecao: data.colecao ?? "",
          semana: data.semana ?? "",
          mes_id: data.mes_id,
          ano_id: data.ano_id,
          categoria_principal_id: data.categoria_principal_id,
          categoria_secundaria_id: data.categoria_secundaria_id,
          subcategoria1_id: (data as any).subcategoria1_id ?? null,
          subcategoria2_id: (data as any).subcategoria2_id ?? null,
          preco_venda: (data as any).preco_venda ?? null,
          tecidos_planejados: (data as any).tecidos_planejados ?? [],
          status_planejamento: data.status_planejamento ?? "em_planejamento",
          croqui_url: (data as any).croqui_url ?? "",
          desenho_tecnico_url: (data as any).desenho_tecnico_url ?? "",
          fotos_modelo: data.fotos_modelo ?? [],
          fotos_referencia: data.fotos_referencia ?? [],
          observacoes_gerais: data.observacoes_gerais ?? "",
          versao: (data as any).versao ?? 1,
          modelo_base_id: (data as any).modelo_base_id ?? null,
        });
        // Pré-seleciona o Grupo da categoria carregada (deriva de categorias_produto.grupo_id).
        setGrupoSel(categorias.find((c) => c.id === data.categoria_principal_id)?.grupo_id ?? null);
        setEnviada(!!(data as any).ordem_criacao_enviada);
      }
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, key }: { file: File; key: "fotos_modelo" | "fotos_referencia" }) => {
      const path = await uploadFile(file, key);
      return { path, key };
    },
    onSuccess: ({ path, key }) => setDraft((d) => ({ ...d, [key]: [...d[key], path] })),
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const uploadDesenho = useMutation({
    mutationFn: async (file: File) => uploadFile(file, "desenho_tecnico"),
    onSuccess: (path) => setDraft((d) => ({ ...d, desenho_tecnico_url: path })),
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const uploadCroqui = useMutation({
    mutationFn: async (file: File) => uploadFile(file, "croqui"),
    onSuccess: (path) => setDraft((d) => ({ ...d, croqui_url: path })),
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload: any = {
        ...draft,
        croqui_url: draft.croqui_url || null,
        desenho_tecnico_url: draft.desenho_tecnico_url || null,
        preco_venda: numOr0(draft.preco_venda) > 0 ? numOr0(draft.preco_venda) : null,
      };
      if (isEdit && modeloId) {
        const { error } = await supabase.from("modelos").update(payload).eq("id", modeloId);
        if (error) throw error;
        await syncTecidosToDesenvolvimento(modeloId, draft.tecidos_planejados);
      } else {
        const { data: inserted, error } = await supabase.from("modelos").insert(payload).select("id").single();
        if (error) throw error;
        if (inserted?.id) await syncTecidosToDesenvolvimento(inserted.id, draft.tecidos_planejados);
      }
    },
    onSuccess: () => {
      toast.success("Modelo salvo");
      qc.invalidateQueries({ queryKey: ["modelo"] });
      qc.invalidateQueries({ queryKey: ["modelo-tecidos"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro")),
  });

  // Enviar/Cancelar Ordem de Criação: gate explícito pro Desenvolvimento (independe do Salvar).
  const enviar = useMutation({
    mutationFn: async (send: boolean) => {
      if (!modeloId) throw new Error("Salve o modelo primeiro.");
      const payload = send
        ? { ordem_criacao_enviada: true, ordem_criacao_enviada_at: new Date().toISOString(), status_planejamento: "planejado" }
        : { ordem_criacao_enviada: false, ordem_criacao_enviada_at: null };
      const { error } = await supabase.from("modelos").update(payload).eq("id", modeloId);
      if (error) throw error;
    },
    onMutate: (send: boolean) => setEnviada(send),
    onError: (e: any, send: boolean) => { setEnviada(!send); toast.error(mensagemErro(e, "Erro")); },
    onSuccess: (_d, send: boolean) => {
      toast.success(send ? "Ordem de Criação enviada" : "Envio cancelado");
      qc.invalidateQueries({ queryKey: ["modelos-planejamento"] });
      qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
    },
  });

  const duplicate = useMutation({
    mutationFn: async () => {
      if (!modeloId) return;
      // Raiz da família de versões: o original (cópias apontam para ele via modelo_base_id).
      const root = draft.modelo_base_id ?? modeloId;
      // Próxima versão = maior versão existente na família + 1.
      const { data: fam, error: eFam } = await supabase
        .from("modelos")
        .select("versao")
        .or(`id.eq.${root},modelo_base_id.eq.${root}`);
      if (eFam) throw eFam;
      const maxV = (fam ?? []).reduce((m, r: any) => Math.max(m, r.versao ?? 1), 1);
      // A cópia mantém o nome do original; a versão é que diferencia.
      const { versao: _v, modelo_base_id: _b, ...rest } = draft;
      const payload: any = {
        ...rest,
        status_planejamento: "em_planejamento",
        versao: maxV + 1,
        modelo_base_id: root,
      };
      const { error } = await supabase.from("modelos").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Card duplicado"); onSaved(); onClose(); },
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  const del = useMutation({
    mutationFn: async () => {
      if (!modeloId) return;
      const { error } = await supabase.from("modelos").delete().eq("id", modeloId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Modelo excluído"); onSaved(); onClose(); },
    onError: (e: any) => toast.error(mensagemErro(e)),
  });

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:w-[70vw] sm:max-w-3xl overflow-y-auto max-sm:pb-24 max-sm:[&>button]:hidden">
        <SheetHeader>
          <SheetTitle>{isEdit ? draft.nome || "Modelo" : "Novo Modelo"}</SheetTitle>
        </SheetHeader>

        <div className="space-y-6 mt-4">
          {/* SETOR 1 — Informações Gerais do Produto */}
          <Secao titulo="Informações Gerais do Produto">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label>Status</Label>
                <Select value={draft.status_planejamento} onValueChange={(v) => setDraft((d) => ({ ...d, status_planejamento: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <FieldText label="Nome do Modelo" value={draft.nome} onChange={(v) => setDraft((d) => ({ ...d, nome: v }))} />
              {draft.versao > 1 && (
                <div className="grid gap-1">
                  <Label>Versão</Label>
                  <Input value={`v${draft.versao}`} readOnly disabled />
                </div>
              )}
              <FieldSelect label={fl("estilista")} value={draft.estilista_id} onChange={(v) => setDraft((d) => ({ ...d, estilista_id: v }))} options={estilistas} />
              <FieldSelect
                label="Grupo"
                value={grupoSel}
                onChange={(v) => {
                  setGrupoSel(v);
                  // Se a categoria atual não pertence ao novo grupo, limpa categoria + subs.
                  const cat = categorias.find((c) => c.id === draft.categoria_principal_id);
                  if (cat && cat.grupo_id !== v) setDraft((d) => ({ ...d, categoria_principal_id: null, subcategoria1_id: null, subcategoria2_id: null }));
                }}
                options={grupos}
              />
              <FieldSelect
                label="Categoria"
                value={draft.categoria_principal_id}
                onChange={(v) => {
                  // Mantém o Grupo coerente e reseta as subcategorias (pertencem à categoria).
                  const cat = categorias.find((c) => c.id === v);
                  if (cat?.grupo_id) setGrupoSel(cat.grupo_id);
                  setDraft((d) => ({ ...d, categoria_principal_id: v, subcategoria1_id: null, subcategoria2_id: null }));
                }}
                options={grupoSel ? categorias.filter((c) => c.grupo_id === grupoSel) : categorias}
              />
              <FieldSelect
                label="Subcategoria 1"
                value={draft.subcategoria1_id}
                onChange={(v) => setDraft((d) => ({ ...d, subcategoria1_id: v }))}
                options={sub1Opts.filter((s) => s.categoria_id === draft.categoria_principal_id)}
              />
              <FieldSelect
                label="Subcategoria 2"
                value={draft.subcategoria2_id}
                onChange={(v) => setDraft((d) => ({ ...d, subcategoria2_id: v }))}
                options={sub2Opts.filter((s) => s.categoria_id === draft.categoria_principal_id)}
              />
            </div>
          </Secao>

          {/* SETOR 2 — Coleção */}
          <Secao titulo="Coleção">
            <div className="grid sm:grid-cols-2 gap-3">
              <FieldText label={fl("colecao")} value={draft.colecao} onChange={(v) => setDraft((d) => ({ ...d, colecao: v }))} />
              <FieldSelect label={fl("linha")} value={draft.linha_id} onChange={(v) => setDraft((d) => ({ ...d, linha_id: v }))} options={linhas} />
              <div className="grid gap-1">
                <Label>Semana</Label>
                <Select value={draft.semana || ""} onValueChange={(v) => setDraft((d) => ({ ...d, semana: v }))}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {["1","2","3","4","5"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <FieldSelect label="Mês de Planejamento" value={draft.mes_id} onChange={(v) => setDraft((d) => ({ ...d, mes_id: v }))} options={meses} />
              <FieldSelect label="Ano" value={draft.ano_id} onChange={(v) => setDraft((d) => ({ ...d, ano_id: v }))} options={anos} />
            </div>
          </Secao>

          {/* SETOR 3 — Preço */}
          <Secao titulo="Preço">
            <div className="grid sm:grid-cols-2 gap-3">
              <CampoRO label={custoReal ? "Custo (real)" : "Custo (previsto)"} value={custo > 0 ? brl(custo) : "—"} />
              <CampoRO label="Markup" value={markup > 0 ? markup.toLocaleString("pt-BR") : "—"} />
              <CampoRO label="Preço" value={preco > 0 ? brl(preco) : "—"} />
              <CampoRO label="Preço sugerido" value={precoSug > 0 ? brl(precoSug) : "—"} />
              <div className="grid gap-1">
                <Label>Preço para venda</Label>
                <NumberInput
                  value={draft.preco_venda && draft.preco_venda > 0 ? draft.preco_venda : ""}
                  placeholder={precoSug > 0 ? brl(precoSug) : undefined}
                  onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, preco_venda: numOr0(v) > 0 ? Number(v) : null })); }}
                />
              </div>
              <CampoRO label="Markup real" value={markupReal > 0 ? markupReal.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"} />
            </div>
          </Secao>

          {/* SETOR 4 — Tecido Planejado */}
          <Secao titulo="Tecido Planejado">
            <MultiArtigosField
              label=""
              value={draft.tecidos_planejados}
              onChange={(v) => setDraft((d) => ({ ...d, tecidos_planejados: v }))}
              artigos={artigos}
              estoque={estoqueMap}
            />
          </Secao>

          {/* SETOR 5 — Anexos */}
          <Secao titulo="Anexos">
            <div className="grid sm:grid-cols-2 gap-4">
              <SingleFileField
                label="Foto do Croqui"
                path={draft.croqui_url}
                onUpload={(f) => uploadCroqui.mutate(f)}
                onRemove={() => setDraft((d) => ({ ...d, croqui_url: "" }))}
              />
              <SingleFileField
                label="Desenho Técnico"
                path={draft.desenho_tecnico_url}
                onUpload={(f) => uploadDesenho.mutate(f)}
                onRemove={() => setDraft((d) => ({ ...d, desenho_tecnico_url: "" }))}
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <PhotoList label="Foto do Modelo" paths={draft.fotos_modelo}
                onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_modelo" })}
                onRemove={(i) => setDraft((d) => ({ ...d, fotos_modelo: d.fotos_modelo.filter((_, j) => j !== i) }))} />
              <PhotoList label="Foto de Referência" paths={draft.fotos_referencia}
                onAdd={(f) => uploadMutation.mutate({ file: f, key: "fotos_referencia" })}
                onRemove={(i) => setDraft((d) => ({ ...d, fotos_referencia: d.fotos_referencia.filter((_, j) => j !== i) }))} />
            </div>
          </Secao>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:justify-end bg-background border-t pt-3 mt-4 sm:sticky sm:bottom-0 max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:flex-nowrap max-sm:px-4 max-sm:py-3 max-sm:mt-0">
          {/* Voltar: desktop "Cancelar" texto, mobile ícone de voltar. */}
          <Button variant="outline" onClick={onClose} aria-label="Voltar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
            <ArrowLeft className="h-4 w-4 sm:hidden" />
            <span className="max-sm:sr-only">Cancelar</span>
          </Button>
          {isEdit && (
            <>
              {/* Duplicar/Excluir: só-ícone no mobile, texto no desktop. */}
              <Button variant="outline" onClick={() => duplicate.mutate()} disabled={duplicate.isPending} aria-label="Duplicar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
                <Copy className="h-4 w-4 sm:mr-1" />
                <span className="max-sm:sr-only">Duplicar</span>
              </Button>
              <Button variant="destructive" onClick={() => setConfirmDel(true)} aria-label="Excluir" className="shrink-0 max-sm:aspect-square max-sm:px-0">
                <Trash2 className="h-4 w-4 sm:mr-1" />
                <span className="max-sm:sr-only">Excluir</span>
              </Button>
            </>
          )}
          {isEdit && (enviada ? (
            <Button variant="outline" className="max-sm:ml-auto" onClick={() => enviar.mutate(false)} disabled={enviar.isPending}>
              Cancelar Envio
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="max-sm:ml-auto"
              onClick={() => enviar.mutate(true)}
              disabled={enviar.isPending || draft.status_planejamento !== "planejado"}
              title={draft.status_planejamento !== "planejado" ? "Defina o status como Planejado primeiro" : undefined}
            >
              Enviar Ordem de Criação
            </Button>
          ))}
          <Button className="max-sm:ml-auto" onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
        </div>

        <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir modelo?</AlertDialogTitle>
              <AlertDialogDescription>Esta ação não pode ser desfeita.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => del.mutate()}>Excluir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}

/* ============ BATCH — criar vários cards ============ */

type CatRow = {
  categoria_id: string | null;
  quantidade: string; // mantido como texto p/ permitir apagar/digitar livremente
};

// Quantidade digitada → inteiro (vazio/invalid = 0).
const parseQtd = (s: string) => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const emptyCatRow = (): CatRow => ({
  categoria_id: null,
  quantidade: "1",
});

function BatchCardsDialog({
  meses, anos, grupos, categorias, onClose, onSaved,
}: {
  meses: Opt[]; anos: Opt[]; grupos: Opt[]; categorias: CatOpt[];
  onClose: () => void; onSaved: () => void;
}) {
  const grupoMap = Object.fromEntries(grupos.map((g) => [g.id, g.nome]));
  // Rótulo "Grupo › Categoria" (a lista é plana; sem o grupo, categorias homônimas confundem).
  const catLabel = (c: CatOpt) => (c.grupo_id && grupoMap[c.grupo_id] ? `${grupoMap[c.grupo_id]} › ${c.nome}` : c.nome);
  // Campos compartilhados por todos os cards (mesmo "core" do Novo Modelo,
  // sem nome/estilista/tecido/fotos).
  const [colecao, setColecao] = useState("");
  const [status, setStatus] = useState("em_planejamento");
  const [semana, setSemana] = useState("");
  const [mesId, setMesId] = useState<string | null>(null);
  const [anoId, setAnoId] = useState<string | null>(null);
  const [rows, setRows] = useState<CatRow[]>([emptyCatRow()]);

  const total = rows.reduce(
    (sum, r) => sum + (r.categoria_id ? parseQtd(r.quantidade) : 0),
    0,
  );

  const setRow = (i: number, patch: Partial<CatRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyCatRow()]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  // Cada categoria só pode aparecer uma vez (sem subcategoria no Planejamento).
  const usedCats = (exceptIdx: number) =>
    new Set(
      rows
        .filter((r, j) => j !== exceptIdx && r.categoria_id)
        .map((r) => r.categoria_id as string),
    );

  const create = useMutation({
    mutationFn: async () => {
      const payloads: any[] = [];
      const combos = new Set<string>();
      for (const r of rows) {
        if (!r.categoria_id) continue;
        const qtd = parseQtd(r.quantidade);
        if (qtd < 1)
          throw new Error("A quantidade de cada categoria deve ser ao menos 1.");
        if (combos.has(r.categoria_id))
          throw new Error("Há categorias repetidas. Some as quantidades.");
        combos.add(r.categoria_id);
        for (let n = 0; n < qtd; n++) {
          payloads.push({
            nome: "",
            estilista_id: null,
            colecao,
            semana,
            mes_id: mesId,
            ano_id: anoId,
            categoria_principal_id: r.categoria_id,
            tecidos_planejados: [],
            status_planejamento: status,
            fotos_modelo: [],
            fotos_referencia: [],
            observacoes_gerais: "",
            versao: 1,
            modelo_base_id: null,
          });
        }
      }
      if (payloads.length === 0) throw new Error("Selecione ao menos uma categoria.");
      // tenant_id é preenchido pelo trigger set_tenant_id.
      const { error } = await supabase.from("modelos").insert(payloads);
      if (error) throw error;
      return payloads.length;
    },
    onSuccess: (n) => {
      toast.success(`${n} ${n === 1 ? "card criado" : "cards criados"}`);
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao criar cards")),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!grid-rows-[auto_minmax(0,1fr)_auto] max-sm:!overflow-hidden">
        <DialogHeader className="max-sm:shrink-0">
          <DialogTitle>Criar vários cards</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 max-sm:min-h-0 max-sm:min-w-0 max-sm:overflow-y-auto">
          <div>
            <p className="text-sm font-medium mb-2">Campos compartilhados</p>
            <p className="text-xs text-muted-foreground mb-3">Aplicados a todos os cards criados.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <FieldText label="Coleção" value={colecao} onChange={setColecao} />
              <div className="grid gap-1">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label>Semana</Label>
                <Select value={semana || ""} onValueChange={setSemana}>
                  <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                  <SelectContent>
                    {["1","2","3","4","5"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <FieldSelect label="Mês de Planejamento" value={mesId} onChange={(v) => setMesId(v)} options={meses} />
              <FieldSelect label="Ano" value={anoId} onChange={(v) => setAnoId(v)} options={anos} />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Categorias</p>
            <p className="text-xs text-muted-foreground mb-3">
              Selecione a categoria e a quantidade de cards.
            </p>
            <div className="space-y-2">
              {rows.map((r, i) => {
                const used = usedCats(i);
                const opts = categorias.filter(
                  (c) => !used.has(c.id) || c.id === r.categoria_id,
                );
                return (
                  <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                    <div className="grid gap-1 flex-1 min-w-[150px]">
                      <Label className="text-xs">Categoria</Label>
                      <Select
                        value={r.categoria_id ?? ""}
                        onValueChange={(v) => setRow(i, { categoria_id: v })}
                      >
                        <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                        <SelectContent>
                          {opts.map((c) => <SelectItem key={c.id} value={c.id}>{catLabel(c)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1 w-20">
                      <Label className="text-xs">Qtd</Label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={r.quantidade}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === "" || /^\d+$/.test(v)) setRow(i, { quantidade: v });
                        }}
                        onBlur={() => {
                          const n = parseQtd(r.quantidade);
                          setRow(i, { quantidade: String(n > 0 ? n : 1) });
                        }}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(i)}
                      disabled={rows.length === 1}
                      aria-label="Remover categoria"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={addRow}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar categoria
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            Total: <span className="font-medium text-foreground">{total}</span>{" "}
            {total === 1 ? "card" : "cards"} serão criados.
          </p>
        </div>

        <DialogFooter className="gap-2 max-sm:shrink-0 max-sm:flex-row max-sm:items-center max-sm:border-t max-sm:bg-background max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:py-3">
          <Button variant="outline" onClick={onClose} aria-label="Voltar" className="shrink-0 max-sm:aspect-square max-sm:px-0">
            <ArrowLeft className="h-4 w-4 sm:hidden" />
            <span className="max-sm:sr-only">Cancelar</span>
          </Button>
          <Button className="max-sm:ml-auto" onClick={() => create.mutate()} disabled={create.isPending || total === 0}>
            {create.isPending ? "Criando…" : `Criar ${total} ${total === 1 ? "card" : "cards"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type EstoqueArtigo = { fisico_m: number; reservado_m: number; disponivel_m: number };
const fmtMetros = (n: number) => `${fmtNum(n)} m`;

function MultiArtigosField({ label, value, onChange, artigos, estoque }: {
  label: string; value: string[]; onChange: (v: string[]) => void; artigos: ArtigoOpt[];
  estoque: Record<string, EstoqueArtigo>;
}) {
  const available = artigos.filter((a) => !value.includes(a.id));
  const byId = Object.fromEntries(artigos.map((a) => [a.id, a]));
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-1 mb-1">
        {value.length === 0 && <span className="text-xs text-muted-foreground">Nenhum tecido selecionado</span>}
        {value.map((id) => {
          const a = byId[id];
          const e = estoque[id];
          return (
            <Badge key={id} variant="secondary" className="gap-1">
              {a ? (a.unidade_medida ? `${a.nome} [${a.unidade_medida}]` : a.nome) : id}
              {a?.preco_por_metro != null && (
                <span className="text-[10px] opacity-70">· {brl(a.preco_por_metro)}/m</span>
              )}
              {e && (
                <span className={`text-[10px] ${e.disponivel_m <= 0 ? "text-destructive font-medium" : "opacity-70"}`}>
                  · disp. {fmtMetros(e.disponivel_m)}
                </span>
              )}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== id))}
                className="ml-1 hover:text-destructive"
                aria-label="Remover"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}
      </div>
      {available.length > 0 && (
        <Select value="" onValueChange={(v) => v && onChange([...value, v])}>
          <SelectTrigger><SelectValue placeholder="Adicionar tecido…" /></SelectTrigger>
          <SelectContent>
            {available.map((a) => {
              const e = estoque[a.id];
              return (
                <SelectItem key={a.id} value={a.id}>
                  <span className="flex flex-col">
                    <span>{a.unidade_medida ? `${a.nome} [${a.unidade_medida}]` : a.nome}</span>
                    <span className="text-xs text-muted-foreground">Preço/m: {a.preco_por_metro != null ? brl(a.preco_por_metro) : "—"}</span>
                    {e && (
                      <span className={`text-xs ${e.disponivel_m <= 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        Estoque: {fmtMetros(e.fisico_m)} · disp.: {fmtMetros(e.disponivel_m)}
                      </span>
                    )}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}


function FieldText({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function FieldSelect({ label, value, onChange, options }: {
  label: string; value: string | null; onChange: (v: string) => void; options: Opt[];
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Select value={value ?? ""} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
function PhotoList({ label, paths, onAdd, onRemove }: {
  label: string; paths: string[]; onAdd: (f: File) => void; onRemove: (i: number) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {paths.map((p, i) => (
          <FileThumb key={i} path={p} onRemove={() => onRemove(i)} />
        ))}
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
          <Upload className="h-4 w-4" /> Adicionar
          <input type="file" accept="image/*,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && onAdd(e.target.files[0])} />
        </label>
      </div>
    </div>
  );
}
/* Miniatura de anexo (imagem OU PDF) com preview + zoom ao clicar (abre grande). */
function FileThumb({ path, onRemove }: { path: string; onRemove?: () => void }) {
  const isPdf = /\.pdf$/i.test(path);
  const url = useSignedUrlBucket(path);
  const [zoom, setZoom] = useState(false);
  return (
    <div className="relative h-20 w-20 rounded border overflow-hidden bg-muted group">
      <div
        role="button"
        tabIndex={0}
        onClick={() => url && setZoom(true)}
        onKeyDown={(e) => { if (url && (e.key === "Enter" || e.key === " ")) setZoom(true); }}
        className="h-full w-full cursor-zoom-in flex items-center justify-center"
        title="Abrir"
      >
        {!url ? (
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        ) : isPdf ? (
          <iframe src={`${url}#toolbar=0&navpanes=0&scrollbar=0`} title="PDF" className="h-full w-full pointer-events-none" />
        ) : (
          <img src={url} className="h-full w-full object-cover" alt="" />
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute top-0.5 right-0.5 bg-background/80 rounded p-0.5 opacity-0 group-hover:opacity-100 z-10"
          aria-label="Remover"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-w-5xl p-1 border-none bg-transparent shadow-none [&>button]:!text-white [&>button]:top-2 [&>button]:right-2">
          {isPdf ? (
            <iframe src={url ?? ""} title="PDF" className="w-full h-[85vh] rounded-md bg-white" />
          ) : (
            <img src={url ?? ""} alt="" className="max-w-full max-h-[85vh] object-contain rounded-md shadow-2xl" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* Anexo único (imagem ou PDF) com preview + zoom — Croqui / Desenho Técnico. */
function SingleFileField({ label, path, onUpload, onRemove }: {
  label: string; path: string; onUpload: (f: File) => void; onRemove: () => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        {path && <FileThumb path={path} onRemove={onRemove} />}
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
          <Upload className="h-4 w-4" /> {path ? "Trocar arquivo" : "Enviar arquivo"}
          <input
            type="file"
            accept="image/*,application/pdf,.jpg,.jpeg,.png,.webp,.gif,.avif,.bmp,.pdf"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
        </label>
      </div>
    </div>
  );
}
