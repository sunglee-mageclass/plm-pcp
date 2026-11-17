// F7 Armário · Task D3 — DIALOG de variantes disponíveis da subcoleção (mini-cards arrastáveis para a grade).
//
// INTERFACE PARA A D4 (montagem):
//  1. <VariantesDialog colecaoId colecao subcolecao armarioId onFechar onAdicionar? chavesNaGrade? />
//     - É um Dialog NÃO-MODAL (`modal={false}`, sem overlay) ancorado à direita: a grade fica visível e recebe o drop.
//       Clicar fora NÃO fecha (arrastar pra grade é "fora"); fecha só pelo X/Esc -> `onFechar()`.
//     - A D4 monta o `DndContext` + o droppable da grade ACIMA deste componente (o React context atravessa o portal do Dialog).
//  2. ARRASTE: cada mini-card normal usa `useDraggable` com
//        id   = `variante:${chaveVariante(item)}`  (VARIANTE_DRAG_PREFIXO + chave)
//        data = { tipo: "variante", item: VarianteItem }      -> na D4: `active.data.current?.tipo === "variante"`
//     A alça de arraste é o corpo do card (foto+textos); o botão "+" fica fora da alça. Use sensor de ponteiro com
//     `activationConstraint.distance` para o clique simples passar.
//  3. CLIQUE (alternativa/teclado): `onAdicionar(item)` — botão "+" em cada card normal (só aparece se a prop existir).
//  4. `chavesNaGrade` (opcional): cards cuja chave já está na grade ficam "Na grade" e NÃO arrastáveis (índice único).
//  5. "Em desenvolvimento" (produto sem cor cadastrada): card esmaecido, badge, NÃO arrastável e SEM "+": não usa
//     `useDraggable` (componente `EmDesenvolvimentoCard`), cursor not-allowed.
//  6. "Já em outro armário": badge âmbar + tooltip com os nomes; NÃO bloqueia (continua arrastável/clicável).
//  7. Depois de salvar a montagem, invalide `["armario-variantes-disponiveis"]` (ja_em_outro muda).
//  8. FILTROS (Task 5, além da lupa): Grupo > Categoria > Subcategoria (cascata com poda), Cor, Linha, Estado e Planejamento.
//     Todos LOCAIS sobre a lista carregada: as opções derivam dos próprios mini-cards (só o que existe nesta subcoleção),
//     combinam em E entre si e com a lupa. Acessórios entra pela mesma árvore (grupo_id/eh_acessorio vêm da RPC).
//  Também exportados: `VarianteItem`, `achatarVariantes` (puro), `useVariantesDisponiveis`, `VarianteDraggableCard`.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical, Loader2, Plus, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FilterButton, type FilterOption } from "@/components/shared/filters";
import { corApelidoLabel } from "@/lib/variante";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ModeloThumb } from "@/components/plan-tecido/ModeloThumb";
import { chaveVariante, rotuloVariante, type ArmarioOrigem } from "@/lib/armario/variante-chave";
import { mensagemArmario } from "@/lib/armario/mensagem";

export const VARIANTE_DRAG_PREFIXO = "variante:";

/** Formato bruto devolvido pela RPC `armario_variantes_disponiveis`. */
export interface VarianteRpc {
  variante_tecido_id: string | null;
  produto_variante_id: string | null;
  cor_id: string | null;
  cor_apelido_id: string | null;
  cor_nome: string | null;
  cor_apelido_nome: string | null;
  ordem: number;
  ja_em_outro: boolean;
  armarios_com: { id: string; nome: string }[];
}
/** Campos do MODELO (mini-card) que a RPC devolve para os filtros. Sempre presentes (null sem dado); opcionais no tipo p/ não quebrar quem monta item à mão. */
export interface FacetasModelo {
  categoria_principal_id?: string | null;
  categoria_nome?: string | null;
  subcategoria1_id?: string | null;
  subcategoria1_nome?: string | null;
  grupo_id?: string | null;
  grupo_nome?: string | null;
  /** Grupo Acessórios (`_grupo_eh_acessorio` no banco ≡ `ehGrupoAcessorio` no TS). */
  eh_acessorio?: boolean;
  linha_id?: string | null;
  linha_nome?: string | null;
  /** Normalizado pela RPC: 'em_planejamento' | 'planejado' | 'reprovado'. */
  status_planejamento?: string | null;
  mes_id?: string | null;
  mes_ordem?: number | null;
  ano_id?: string | null;
  ano?: number | string | null;
}
export interface ModeloDisponivelRpc extends FacetasModelo {
  modelo_id: string;
  nome: string;
  ref: string | null;
  foto_path: string | null;
  origem: ArmarioOrigem;
  em_desenvolvimento: boolean;
  variantes: VarianteRpc[];
}

/** Uma variante (produto × cor) pronta para virar mini-card / item de armário. `chave` = `chaveVariante` (identidade estável). */
export interface VarianteItem extends FacetasModelo {
  chave: string;
  modelo_id: string;
  nome: string;
  ref: string | null;
  foto_path: string | null;
  origem: ArmarioOrigem;
  variante_tecido_id: string | null;
  produto_variante_id: string | null;
  cor_id: string | null;
  cor_apelido_id: string | null;
  cor_nome: string | null;
  cor_apelido_nome: string | null;
  ja_em_outro: boolean;
  armarios_com: { id: string; nome: string }[];
}

/** Entrada da lista do dialog: variante normal OU produto "em desenvolvimento" (1 card, sem variantes). */
export type EntradaDialog =
  | { tipo: "variante"; chave: string; item: VarianteItem }
  | { tipo: "em_desenvolvimento"; chave: string; modelo: Omit<ModeloDisponivelRpc, "variantes"> };

const facetasDe = (m: FacetasModelo): FacetasModelo => ({
  categoria_principal_id: m.categoria_principal_id ?? null, categoria_nome: m.categoria_nome ?? null,
  subcategoria1_id: m.subcategoria1_id ?? null, subcategoria1_nome: m.subcategoria1_nome ?? null,
  grupo_id: m.grupo_id ?? null, grupo_nome: m.grupo_nome ?? null, eh_acessorio: !!m.eh_acessorio,
  linha_id: m.linha_id ?? null, linha_nome: m.linha_nome ?? null, status_planejamento: m.status_planejamento ?? null,
  mes_id: m.mes_id ?? null, mes_ordem: m.mes_ordem ?? null, ano_id: m.ano_id ?? null, ano: m.ano ?? null,
});

/** Achata a resposta da RPC: produto com N cores -> N entradas; em_desenvolvimento -> 1 entrada não arrastável. Puro. */
export function achatarVariantes(modelos: ModeloDisponivelRpc[]): EntradaDialog[] {
  const out: EntradaDialog[] = [];
  for (const m of modelos) {
    const fac = facetasDe(m);
    if (m.em_desenvolvimento || !m.variantes?.length) {
      const { variantes: _v, ...modelo } = m;
      out.push({ tipo: "em_desenvolvimento", chave: `dev:${m.modelo_id}`, modelo: { ...modelo, ...fac } });
      continue;
    }
    for (const v of m.variantes) {
      const item: VarianteItem = {
        chave: "",
        modelo_id: m.modelo_id, nome: m.nome, ref: m.ref, foto_path: m.foto_path, origem: m.origem,
        variante_tecido_id: v.variante_tecido_id ?? null, produto_variante_id: v.produto_variante_id ?? null,
        cor_id: v.cor_id ?? null, cor_apelido_id: v.cor_apelido_id ?? null,
        cor_nome: v.cor_nome ?? null, cor_apelido_nome: v.cor_apelido_nome ?? null,
        ja_em_outro: !!v.ja_em_outro, armarios_com: v.armarios_com ?? [],
        ...fac,
      };
      item.chave = chaveVariante(item);
      out.push({ tipo: "variante", chave: item.chave, item });
    }
  }
  return out;
}

const normaliza = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Filtro por nome/REF/cor (sem acento, sem caixa). Puro. */
export function filtrarEntradas(entradas: EntradaDialog[], busca: string): EntradaDialog[] {
  const q = normaliza(busca);
  if (!q) return entradas;
  return entradas.filter((e) => {
    const base = e.tipo === "variante" ? e.item : e.modelo;
    const cor = e.tipo === "variante" ? `${e.item.cor_nome ?? ""} ${e.item.cor_apelido_nome ?? ""}` : "";
    return normaliza(`${base.nome} ${base.ref ?? ""} ${cor}`).includes(q);
  });
}

// ───────── Filtros por faceta (Task 5) ─────────

/** Seleção de cada dropdown multi: array de ids; vazio = sem filtro. */
export interface FiltrosVariantes {
  grupo: string[];
  categoria: string[];
  sub1: string[];
  cor: string[];
  linha: string[];
  estado: string[];
  planejamento: string[];
}
export const FILTROS_VAZIOS: FiltrosVariantes = { grupo: [], categoria: [], sub1: [], cor: [], linha: [], estado: [], planejamento: [] };

/** Estado do mini-card: sem cor cadastrada / pronto para usar / variante que já está em outro armário (não bloqueia). */
export type EstadoVariante = "em_desenvolvimento" | "disponivel" | "ja_em_outro";
export const ESTADO_ROTULO: Record<EstadoVariante, string> = {
  em_desenvolvimento: "Em desenvolvimento (sem cor)",
  disponivel: "Disponível",
  ja_em_outro: "Já em outro armário",
};
const ESTADO_ORDEM: EstadoVariante[] = ["disponivel", "ja_em_outro", "em_desenvolvimento"];
/** Rótulos do `status_planejamento` normalizado pela RPC; valor desconhecido aparece cru. */
export const PLANEJAMENTO_ROTULO: Record<string, string> = {
  em_planejamento: "Em planejamento", planejado: "Planejado", reprovado: "Reprovado",
};

const facetasDaEntrada = (e: EntradaDialog): FacetasModelo => (e.tipo === "variante" ? e.item : e.modelo);
/** Chave estável de uma cor no filtro: cor base + apelido (ids; vazio = sem). */
export const chaveCor = (corId?: string | null, apelidoId?: string | null) => `${corId ?? ""}|${apelidoId ?? ""}`;
const chaveCorDe = (e: EntradaDialog) => (e.tipo === "variante" ? chaveCor(e.item.cor_id, e.item.cor_apelido_id) : null);
const temCor = (i: VarianteItem) => !!(i.cor_id || i.cor_apelido_id || i.cor_nome || i.cor_apelido_nome);

export function estadoDaEntrada(e: EntradaDialog): EstadoVariante {
  if (e.tipo === "em_desenvolvimento") return "em_desenvolvimento";
  return e.item.ja_em_outro ? "ja_em_outro" : "disponivel";
}

const porNome = (a: FilterOption, b: FilterOption) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" });
function distintos(pares: Iterable<[string, string]>): FilterOption[] {
  const m = new Map<string, string>();
  for (const [id, nome] of pares) if (!m.has(id)) m.set(id, nome);
  return [...m].map(([id, nome]) => ({ id, nome })).sort(porNome);
}
const noGrupo = (e: EntradaDialog, grupo: string[]) => !grupo.length || grupo.includes(facetasDaEntrada(e).grupo_id ?? "");
const naCategoria = (e: EntradaDialog, cat: string[]) => !cat.length || cat.includes(facetasDaEntrada(e).categoria_principal_id ?? "");

/** Aplica os filtros (E entre os dropdowns; OU dentro de cada um). Puro. */
export function filtrarPorFacetas(entradas: EntradaDialog[], f: FiltrosVariantes): EntradaDialog[] {
  if (!contarFiltrosAtivos(f)) return entradas;
  return entradas.filter((e) => {
    const x = facetasDaEntrada(e);
    if (f.grupo.length && !f.grupo.includes(x.grupo_id ?? "")) return false;
    if (f.categoria.length && !f.categoria.includes(x.categoria_principal_id ?? "")) return false;
    if (f.sub1.length && !f.sub1.includes(x.subcategoria1_id ?? "")) return false;
    if (f.linha.length && !f.linha.includes(x.linha_id ?? "")) return false;
    if (f.planejamento.length && !f.planejamento.includes(x.status_planejamento ?? "")) return false;
    if (f.estado.length && !f.estado.includes(estadoDaEntrada(e))) return false;
    // Cor: só a variante que TEM a cor escolhida fica (o produto continua visível se ≥1 variante casar); "em desenvolvimento" não tem cor.
    if (f.cor.length) { const k = chaveCorDe(e); if (k === null || !f.cor.includes(k)) return false; }
    return true;
  });
}

export function contarFiltrosAtivos(f: FiltrosVariantes): number {
  return (Object.values(f) as string[][]).filter((v) => v.length > 0).length;
}

export interface OpcoesFiltros {
  grupos: FilterOption[];
  categorias: FilterOption[];
  subcategorias: FilterOption[];
  cores: FilterOption[];
  linhas: FilterOption[];
  estados: FilterOption[];
  planejamentos: FilterOption[];
}

/**
 * Opções de cada dropdown = só o que EXISTE na lista carregada. Cascata: Categoria só mostra as dos grupos marcados;
 * Subcategoria só as dos grupos E categorias marcados (nada marcado = todas as presentes). Puro.
 */
export function opcoesDosFiltros(entradas: EntradaDialog[], f: FiltrosVariantes): OpcoesFiltros {
  const fx = entradas.map((e) => ({ e, x: facetasDaEntrada(e) }));
  const grupos = distintos(fx.filter(({ x }) => x.grupo_id).map(({ x }) => [x.grupo_id!, x.grupo_nome ?? "(sem nome)"]));
  const categorias = distintos(fx
    .filter(({ e, x }) => x.categoria_principal_id && noGrupo(e, f.grupo))
    .map(({ x }) => [x.categoria_principal_id!, x.categoria_nome ?? "(sem nome)"]));
  const subcategorias = distintos(fx
    .filter(({ e, x }) => x.subcategoria1_id && noGrupo(e, f.grupo) && naCategoria(e, f.categoria))
    .map(({ x }) => [x.subcategoria1_id!, x.subcategoria1_nome ?? "(sem nome)"]));
  const cores = distintos(entradas
    .flatMap((e) => (e.tipo === "variante" && temCor(e.item) ? [[chaveCor(e.item.cor_id, e.item.cor_apelido_id), corApelidoLabel(e.item.cor_nome, e.item.cor_apelido_nome) || "(sem nome)"] as [string, string]] : [])));
  const linhas = distintos(fx.filter(({ x }) => x.linha_id).map(({ x }) => [x.linha_id!, x.linha_nome ?? "(sem nome)"]));
  const presentes = new Set(entradas.map(estadoDaEntrada));
  const estados = ESTADO_ORDEM.filter((k) => presentes.has(k)).map((k) => ({ id: k, nome: ESTADO_ROTULO[k] }));
  const planejamentos = distintos(fx.filter(({ x }) => x.status_planejamento).map(({ x }) => [x.status_planejamento!, PLANEJAMENTO_ROTULO[x.status_planejamento!] ?? x.status_planejamento!]));
  return { grupos, categorias, subcategorias, cores, linhas, estados, planejamentos };
}

/** PODA da cascata: tira de Categoria/Subcategoria os ids que saíram das opções (idempotente; só remove). Puro. */
export function podarFiltros(entradas: EntradaDialog[], f: FiltrosVariantes): FiltrosVariantes {
  const catOk = new Set(opcoesDosFiltros(entradas, f).categorias.map((o) => o.id));
  const comCat = { ...f, categoria: f.categoria.filter((id) => catOk.has(id)) };
  const subOk = new Set(opcoesDosFiltros(entradas, comCat).subcategorias.map((o) => o.id));
  const sub1 = f.sub1.filter((id) => subOk.has(id));
  return comCat.categoria.length === f.categoria.length && sub1.length === f.sub1.length ? f : { ...comCat, sub1 };
}

export function useVariantesDisponiveis(colecaoId: string | null, subcolecao: string | null, armarioId: string | null) {
  return useQuery({
    queryKey: ["armario-variantes-disponiveis", colecaoId, subcolecao ?? "", armarioId],
    queryFn: async (): Promise<ModeloDisponivelRpc[]> => {
      const { data, error } = await supabase.rpc("armario_variantes_disponiveis" as never, {
        _colecao_id: colecaoId, _subcolecao: subcolecao ?? "", _armario_id: armarioId,
      } as never);
      if (error) throw error;
      return (data ?? []) as unknown as ModeloDisponivelRpc[];
    },
  });
}

const CARD = "relative flex items-stretch gap-1 rounded-lg border bg-card p-2";

function AvisoOutroArmario({ armarios }: { armarios: { id: string; nome: string }[] }) {
  const nomes = armarios.map((a) => a.nome).join(", ");
  const rotulo = nomes ? `Já em outro armário: ${nomes}` : "Já em outro armário";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          data-testid="aviso-ja-em-outro"
          aria-label={rotulo}
          className="border-amber-500/60 bg-amber-500/10 text-[10px] font-medium text-amber-700 dark:text-amber-300"
        >
          já em outro armário
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{rotulo}</TooltipContent>
    </Tooltip>
  );
}

function Textos({ nome, refx, cor }: { nome: string; refx: string | null; cor?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium leading-tight" title={nome}>{nome}</p>
      <p className="truncate text-xs text-muted-foreground">{refx ? `REF ${refx}` : "sem REF"}</p>
      {cor !== undefined && <p className="truncate text-xs">{cor}</p>}
    </div>
  );
}

/** Mini-card ARRASTÁVEL de uma variante (origem do DnD). id do draggable = `variante:${chave}`. */
export function VarianteDraggableCard({
  item, naGrade = false, onAdicionar,
}: { item: VarianteItem; naGrade?: boolean; onAdicionar?: (item: VarianteItem) => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: `${VARIANTE_DRAG_PREFIXO}${item.chave}`,
    data: { tipo: "variante", item },
    disabled: naGrade,
  });
  return (
    <div
      ref={setNodeRef}
      data-testid="variante-card"
      data-chave={item.chave}
      data-na-grade={naGrade ? "true" : undefined}
      className={`${CARD} ${isDragging ? "opacity-40" : ""} ${naGrade ? "opacity-60" : ""}`}
    >
      <div
        data-testid="variante-alca"
        {...(naGrade ? {} : attributes)}
        {...(naGrade ? {} : listeners)}
        className={`flex min-w-0 flex-1 items-center gap-2 touch-none ${naGrade ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
      >
        {!naGrade && <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
        <ModeloThumb path={item.foto_path} className="h-14 w-14" alt={item.nome} />
        <Textos nome={item.nome} refx={item.ref} cor={rotuloVariante(item)} />
      </div>
      <div className="flex shrink-0 flex-col items-end justify-between gap-1">
        {naGrade ? <Badge variant="secondary" className="text-[10px]">Na grade</Badge> : item.ja_em_outro ? <AvisoOutroArmario armarios={item.armarios_com} /> : <span />}
        {onAdicionar && !naGrade && (
          <Button type="button" size="iconSm" variant="outline" aria-label={`Adicionar ${item.nome} ${rotuloVariante(item)}`} onClick={() => onAdicionar(item)}>
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Produto sem nenhuma cor cadastrada: aparece (o usuário vê que existe), mas NÃO arrasta — sem `useDraggable`, sem "+". */
export function EmDesenvolvimentoCard({ modelo }: { modelo: Omit<ModeloDisponivelRpc, "variantes"> }) {
  return (
    <div
      data-testid="variante-card-em-desenvolvimento"
      aria-disabled="true"
      title="Cadastre a cor do produto para poder adicioná-lo ao armário"
      className={`${CARD} cursor-not-allowed opacity-50`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ModeloThumb path={modelo.foto_path} className="h-14 w-14" alt={modelo.nome} />
        <Textos nome={modelo.nome} refx={modelo.ref} />
      </div>
      <div className="flex shrink-0 items-start">
        <Badge variant="secondary" className="text-[10px]">Em desenvolvimento</Badge>
      </div>
    </div>
  );
}

export interface VariantesDialogProps {
  colecaoId: string | null;
  colecao: string;
  subcolecao: string | null;
  armarioId: string | null;
  onFechar: () => void;
  /** Clique no "+" do card (alternativa ao arraste). Sem a prop o botão não aparece. */
  onAdicionar?: (item: VarianteItem) => void;
  /** Chaves (`chaveVariante`) já presentes na grade: o card vira "Na grade" e não arrasta. */
  chavesNaGrade?: ReadonlySet<string>;
}

export function VariantesDialog({ colecaoId, colecao, subcolecao, armarioId, onFechar, onAdicionar, chavesNaGrade }: VariantesDialogProps) {
  const [busca, setBusca] = useState("");
  const [filtros, setFiltros] = useState<FiltrosVariantes>(FILTROS_VAZIOS);
  const { data, isLoading, isError, error } = useVariantesDisponiveis(colecaoId, subcolecao, armarioId);
  const entradas = useMemo(() => achatarVariantes(data ?? []), [data]);
  const visiveis = useMemo(() => filtrarPorFacetas(filtrarEntradas(entradas, busca), filtros), [entradas, busca, filtros]);
  const opcoes = useMemo(() => opcoesDosFiltros(entradas, filtros), [entradas, filtros]);
  const nVariantes = entradas.filter((e) => e.tipo === "variante").length;
  const nVisiveis = visiveis.filter((e) => e.tipo === "variante").length;
  const nFiltros = contarFiltrosAtivos(filtros);
  // Mudar Grupo/Categoria poda os ids de Categoria/Subcategoria que deixaram de existir nas opções.
  const setCampo = (campo: keyof FiltrosVariantes) => (v: string[]) => setFiltros((prev) => podarFiltros(entradas, { ...prev, [campo]: v }));
  // Dropdown com <2 opções (e sem seleção) não filtra nada: some para não poluir.
  const defs: { label: string; campo: keyof FiltrosVariantes; options: FilterOption[] }[] = [
    { label: "Grupo", campo: "grupo", options: opcoes.grupos },
    { label: "Categoria", campo: "categoria", options: opcoes.categorias },
    { label: "Subcategoria", campo: "sub1", options: opcoes.subcategorias },
    { label: "Cor", campo: "cor", options: opcoes.cores },
    { label: "Linha", campo: "linha", options: opcoes.linhas },
    { label: "Estado", campo: "estado", options: opcoes.estados },
    { label: "Planejamento", campo: "planejamento", options: opcoes.planejamentos },
  ];
  const filtrosConfig = defs
    .filter((d) => d.options.length >= 2 || filtros[d.campo].length > 0)
    .map((d) => ({ label: d.label, value: filtros[d.campo], onChange: setCampo(d.campo), options: d.options }));

  return (
    <Dialog open modal={false} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent
        // Painel flutuante à direita: a grade atrás continua visível e recebe o drop (não-modal, sem overlay).
        className="left-auto right-4 top-4 h-[calc(100dvh-2rem)] max-h-none w-[min(420px,calc(100vw-2rem))] max-w-none translate-x-0 translate-y-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-3 overflow-hidden data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100"
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Variantes disponíveis</DialogTitle>
          <DialogDescription>
            {colecao}{subcolecao ? ` · ${subcolecao}` : ""} — arraste para a grade{onAdicionar ? " ou use o +" : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, REF ou cor"
              aria-label="Buscar variantes"
              className="pl-8"
            />
          </div>
          {filtrosConfig.length > 0 && (
            <FilterButton filters={filtrosConfig} activeCount={nFiltros} onClear={() => setFiltros(FILTROS_VAZIOS)} />
          )}
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
          ) : isError ? (
            <p className="text-sm text-destructive">{mensagemArmario(error, "Não foi possível carregar as variantes. Tente novamente.")}</p>
          ) : entradas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum produto nesta subcoleção.</p>
          ) : visiveis.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {nFiltros > 0 ? "Nada encontrado com a busca e os filtros aplicados." : <>Nada encontrado para “{busca}”.</>}
              </p>
              {nFiltros > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setFiltros(FILTROS_VAZIOS)}>Limpar filtros</Button>
              )}
            </div>
          ) : (
            <TooltipProvider delayDuration={150}>
              <p className="mb-2 text-xs text-muted-foreground">
                {nVisiveis < nVariantes ? `${nVisiveis} de ${nVariantes}` : nVariantes} {nVariantes === 1 ? "variante" : "variantes"}
              </p>
              <div className="flex flex-col gap-2 pb-2">
                {visiveis.map((e) =>
                  e.tipo === "variante" ? (
                    <VarianteDraggableCard key={e.chave} item={e.item} naGrade={chavesNaGrade?.has(e.chave)} onAdicionar={onAdicionar} />
                  ) : (
                    <EmDesenvolvimentoCard key={e.chave} modelo={e.modelo} />
                  ),
                )}
              </div>
            </TooltipProvider>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
