// F3.2 (Planejamento unificado) — contas PURAS do BOM no Sheet do Planejamento de Produto.
// PORTADAS (cópia) do `PanelContent` do Desenvolvimento (src/components/desenvolvimento/
// ModeloDetailPanel.tsx), que fica INTOCADO até a F5 (decisão travada 8). Cada bloco cita a faixa
// de origem. Sem React e sem Supabase — testadas em tests/unit/ficha-calc.test.ts.
import { somaCustosAdicionais } from "@/lib/custo";
import {
  makeEmptyBlocks,
  type AviamentoRow,
  type GradeRow,
  type ModeloEtiquetaRow,
  type OcAlloc,
  type TecidoBlock,
} from "@/components/desenvolvimento/modelo-detail/types";
import type { GradeVarianteInfo } from "@/components/desenvolvimento/modelo-detail/ModeloGradeSection";

/** Estado editável do BOM (o que o Sheet mostra e o Salvar grava). */
export type EstadoBom = {
  blocks: TecidoBlock[];
  aviamentos: AviamentoRow[];
  etiquetas: ModeloEtiquetaRow[];
  grades: GradeRow[];
};

/** Marcadores do #Erro nas etapas seguintes (`marcar_revisao_por_mudanca`, Dev :2198-2204). */
export type FlagsBom = { grade: boolean; consumo: boolean; aviamentos: boolean };

// Linhas cruas do banco — MESMOS selects do Dev (ModeloDetailPanel.tsx:433-514).
export type TecidoRowDb = { id: string; tipo: string; numero: number; artigo_id: string | null; consumo: number | null; loss_percent: number | null; custo_previsto: number | null };
export type VarianteRowDb = { modelo_tecido_id: string; variante_tecido_id: string | null; ordem: number | null; multiplicador: number | null; complementa_variante_ids: string[] | null; variantes_tecido?: { artigo_id: string | null } | null };
export type OcLinkRowDb = { tipo: string; numero: number; ordem: number; oc_tecido_item_id: string; quantidade_m: number | null; prioridade: number | null };
export type AviamentoRowDb = { id: string; aviamento_id: string | null; variante_aviamento_id: string | null; consumo: number | null; loss_percent: number | null; custo_previsto: number | null };
export type EtiquetaRowDb = { id: string; etiqueta_id: string | null; cor_id: string | null; consumo: number | null; loss_percent: number | null; custo_previsto: number | null };
export type GradeRowDb = { variante_numero: number; grades: Record<string, number> | null; grade_total: number | null };

// ── "Não salvo" ──────────────────────────────────────────────────────────────────────────────
/**
 * Serializa o BOM IGNORANDO `id` (ids de LINHA voláteis: `salvar_modelo_bom` apaga e re-insere a
 * cada save — Dev :86-94) e `custo_previsto` (DERIVADO de preço × consumo × loss; os preços chegam
 * em queries próprias e recalculam o custo DEPOIS da carga — não é edição do usuário).
 */
export function snapshotBom(e: EstadoBom): string {
  try {
    return JSON.stringify(e, (k, v) => (k === "id" || k === "custo_previsto" ? undefined : v));
  } catch {
    return String(e);
  }
}

// ── Decisão da carga (F3.2, fix round 1 — I1/I2) ─────────────────────────────────────────────
/**
 * "Hidrata agora?" — extraída de `useFichaBom` (o efeito único de carga) p/ ser testável sem
 * montar hooks. As 5 queries do BOM podem resolver em commits separados (`bomFetching`); com
 * QUALQUER uma delas em refetch, a carga não deve mexer no estado (nem hidratar, nem comparar
 * com `aoRecarregarComTocado`) — senão mistura o cache velho de umas com o novo de outra. Regras,
 * em ordem: desabilitada ⇒ não; alguma query em refetch ⇒ não; algum dos 5 arrays de dados ainda
 * não chegou (`undefined`, primeira carga) ⇒ não; senão ⇒ sim (o chamador decide comparar
 * [tocado] ou hidratar [não tocado] — os dois ramos exigem o BOM estável).
 */
export function deveHidratarCarga(i: {
  habilitada: boolean;
  bomFetching: boolean;
  tecidosData: unknown;
  ocLinksData: unknown;
  aviamentosData: unknown;
  etiquetasData: unknown;
  gradesData: unknown;
}): boolean {
  if (!i.habilitada) return false;
  if (i.bomFetching) return false;
  if (!i.tecidosData || !i.ocLinksData || !i.aviamentosData || !i.etiquetasData || !i.gradesData) return false;
  return true;
}

// ── Carga (Dev :870-946, :948-957, :976-984, :1029-1038) ────────────────────────────────────
export function hidratarBlocos(i: {
  tecidos: TecidoRowDb[];
  variantes: VarianteRowDb[];
  ocLinks: OcLinkRowDb[];
  planejados: string[];
}): TecidoBlock[] {
  const empty = makeEmptyBlocks();
  const linksByKey = new Map<string, OcAlloc[]>();
  for (const l of i.ocLinks) {
    const key = `${l.tipo}-${l.numero}-${l.ordem}`;
    const arr = linksByKey.get(key) ?? [];
    arr.push({ oc_tecido_item_id: l.oc_tecido_item_id, quantidade_m: Number(l.quantidade_m ?? 0), prioridade: Number(l.prioridade ?? 1) });
    linksByKey.set(key, arr);
  }
  linksByKey.forEach((arr) => arr.sort((a, b) => a.prioridade - b.prioridade));
  for (const t of i.tecidos) {
    const idx = empty.findIndex((b) => b.tipo === t.tipo && b.numero === t.numero);
    if (idx < 0) continue;
    const variantes = Array(10).fill(null) as (string | null)[];
    const multiplicadores = Array(10).fill(1) as number[];
    const oc_links = Array.from({ length: 10 }, () => [] as OcAlloc[]);
    const complementas = Array(10).fill(null) as (string[] | null)[];
    const varArtigos = new Set<string>();
    for (const v of i.variantes.filter((x) => x.modelo_tecido_id === t.id)) {
      const ord = (v.ordem ?? 1) - 1;
      if (ord >= 0 && ord < 10) {
        variantes[ord] = v.variante_tecido_id;
        multiplicadores[ord] = Number(v.multiplicador ?? 1) || 1;
        oc_links[ord] = linksByKey.get(`${t.tipo}-${t.numero}-${v.ordem ?? ord + 1}`) ?? [];
        complementas[ord] = Array.isArray(v.complementa_variante_ids) && v.complementa_variante_ids.length ? v.complementa_variante_ids : null;
      }
      const aid = v.variantes_tecido?.artigo_id;
      if (aid) varArtigos.add(aid);
    }
    // Substitutos: TODO artigo de variante salva que não é o principal (pool estrito, Dev :915-922).
    const artigoIdsExtra = t.tipo === "tecido" || t.tipo === "forro"
      ? Array.from(varArtigos).filter((aid) => aid && aid !== t.artigo_id)
      : [];
    empty[idx] = {
      id: t.id, tipo: t.tipo as TecidoBlock["tipo"], numero: t.numero,
      artigo_id: t.artigo_id, artigoIdsExtra,
      consumo: Number(t.consumo ?? 0), loss_percent: Number(t.loss_percent ?? 0), custo_previsto: Number(t.custo_previsto ?? 0),
      variantes, multiplicadores, oc_links, complementas,
    };
  }
  // G-mockup R5 — o Dev (:935-944) pré-preenche Tecido N com `tecidos_planejados[N-1]` SEMPRE que o
  // bloco está vazio; como a lista derivada inclui substitutos, um card com substituto reabria com
  // "Tecido 2" fantasma. Aqui SÓ quando o BOM está VAZIO (card do Planejamento que ainda não tem BOM).
  if (i.tecidos.length === 0) {
    i.planejados.forEach((artigoId, k) => {
      const idx = empty.findIndex((b) => b.tipo === "tecido" && b.numero === k + 1);
      if (idx >= 0 && artigoId && !empty[idx].artigo_id) empty[idx] = { ...empty[idx], artigo_id: artigoId };
    });
  }
  return empty;
}

export function hidratarAviamentos(rows: AviamentoRowDb[]): AviamentoRow[] {
  return rows.map((a) => ({
    id: a.id, aviamento_id: a.aviamento_id, variante_aviamento_id: a.variante_aviamento_id ?? null,
    consumo: Number(a.consumo ?? 0), loss_percent: Number(a.loss_percent ?? 0), custo_previsto: Number(a.custo_previsto ?? 0),
  }));
}

export function hidratarEtiquetas(rows: EtiquetaRowDb[]): ModeloEtiquetaRow[] {
  return rows.map((e) => ({
    id: e.id, etiqueta_id: e.etiqueta_id, cor_id: e.cor_id,
    consumo: Number(e.consumo ?? 0), loss_percent: Number(e.loss_percent ?? 0), custo_previsto: Number(e.custo_previsto ?? 0),
  }));
}

export function hidratarGrades(rows: GradeRowDb[]): GradeRow[] {
  return rows.map((g) => ({ variante_numero: g.variante_numero, grades: (g.grades ?? {}) as Record<string, number>, grade_total: g.grade_total ?? 0 }));
}

// ── Grade (Dev :1430-1468) ───────────────────────────────────────────────────────────────────
/** Variantes do Tecido 1 em ordem, parando no 1º buraco (Dev :1430-1439). */
export function tecido1VarianteIds(blocks: TecidoBlock[]): string[] {
  const t1 = blocks.find((b) => b.tipo === "tecido" && b.numero === 1);
  if (!t1) return [];
  const out: string[] = [];
  for (const v of t1.variantes) {
    if (!v) break;
    out.push(v);
  }
  return out;
}

/** Variante nova HERDA a grade da 1ª com quantidade; monotônica (devolve `prev` se nada muda). */
export function herdarGrades(prev: GradeRow[], nVariantesTecido1: number): GradeRow[] {
  if (nVariantesTecido1 === 0 || prev.length === 0) return prev;
  const base = prev.find((g) => (g.grade_total || 0) > 0) ?? prev[0];
  let changed = false;
  const next = [...prev];
  for (let n = 1; n <= nVariantesTecido1; n++) {
    if (!next.some((g) => g.variante_numero === n)) {
      next.push({ variante_numero: n, grades: { ...base.grades }, grade_total: base.grade_total });
      changed = true;
    }
  }
  return changed ? next.sort((a, b) => a.variante_numero - b.variante_numero) : prev;
}

// ── Casar variantes (Dev :1488-1564) ─────────────────────────────────────────────────────────
export function paresComplementares(blocks: TecidoBlock[]): { t1id: string; compVarId: string }[] {
  const out: { t1id: string; compVarId: string }[] = [];
  blocks.forEach((b) => {
    if (b.tipo === "tecido" && b.numero === 1) return;
    (b.complementas ?? []).forEach((t1ids, i) => {
      const compVarId = b.variantes[i];
      if (!compVarId || !t1ids) return;
      t1ids.forEach((t1id) => { if (t1id) out.push({ t1id, compVarId }); });
    });
  });
  return out;
}

export function tecido1VariantesInfo(i: {
  ids: string[];
  labels: Record<string, string>;
  varianteArtigoMap: Record<string, string>;
  nomeArtigo: (artigoId: string | undefined) => string | undefined;
  pares: { t1id: string; compVarId: string }[];
  compLabels: Record<string, string>;
}): GradeVarianteInfo[] {
  const artigosNoPool = new Set(i.ids.map((id) => i.varianteArtigoMap[id]).filter(Boolean));
  const multiTecido = artigosNoPool.size > 1;
  return i.ids.map((id, k) => {
    const partes = Array.from(new Set(
      i.pares
        .filter((p) => p.t1id === id)
        .map((p) => [i.nomeArtigo(i.varianteArtigoMap[p.compVarId]), i.compLabels[p.compVarId]].filter(Boolean).join(" · "))
        .filter(Boolean),
    ));
    return {
      numero: k + 1,
      label: i.labels[id] ?? "",
      tecido: multiTecido ? (i.nomeArtigo(i.varianteArtigoMap[id]) ?? undefined) : undefined,
      complemento: partes.length > 0 ? partes.join(", ") : undefined,
    };
  });
}

// ── Totais (Dev :1388-1401) ──────────────────────────────────────────────────────────────────
export type TotaisBom = {
  tecido: number; forro: number; entretela: number; aviamento: number; etiqueta: number;
  custosAdicionais: number;
  /** Materiais do BOM (tecido+forro+entretela+aviamento+etiqueta) — SEM custos adicionais e SEM M.O. */
  materiaisBom: number;
  terceirizados: number;
  /** Custo de 1 Peça (Dev): materiais + M.O. + custos adicionais. */
  peca: number;
};

export function totaisBom(i: {
  blocks: TecidoBlock[]; aviamentos: AviamentoRow[]; etiquetas: ModeloEtiquetaRow[];
  custosAdicionais: unknown; maoObra: number;
}): TotaisBom {
  const sum = (tipo: TecidoBlock["tipo"]) => i.blocks.filter((b) => b.tipo === tipo).reduce((s, b) => s + (b.custo_previsto || 0), 0);
  const tecido = sum("tecido");
  const forro = sum("forro");
  const entretela = sum("entretela");
  const aviamento = i.aviamentos.reduce((s, r) => s + (r.custo_previsto || 0), 0);
  const etiqueta = i.etiquetas.reduce((s, r) => s + (r.custo_previsto || 0), 0);
  const custosAdicionais = somaCustosAdicionais(i.custosAdicionais);
  const terceirizados = Number(i.maoObra) || 0;
  const t = { tecido, forro, entretela, aviamento, etiqueta, custosAdicionais, materiaisBom: tecido + forro + entretela + aviamento + etiqueta, terceirizados, peca: 0 };
  return { ...t, peca: pecaCom(t, terceirizados) };
}

/** Custo de 1 Peça com OUTRA mão de obra — mesma ordem de soma do Dev (:1399). */
export function pecaCom(t: Pick<TotaisBom, "tecido" | "forro" | "entretela" | "aviamento" | "etiqueta" | "custosAdicionais">, maoObra: number): number {
  return t.tecido + t.forro + t.entretela + t.aviamento + t.etiqueta + (Number(maoObra) || 0) + t.custosAdicionais;
}

// ── Derivações do Salvar (Dev :1937-1948, :1973-2025, :2038-2060) ────────────────────────────
/** `tecidos_planejados` DERIVADO: principais dos blocos Tecido (por número) + substitutos usados. */
export function tecidosPlanejadosDerivados(blocks: TecidoBlock[], varianteArtigoMap: Record<string, string>): string[] {
  const out: string[] = [];
  const push = (id?: string | null) => { if (id && !out.includes(id)) out.push(id); };
  blocks.filter((b) => b.tipo === "tecido" && !!b.artigo_id).sort((a, b) => a.numero - b.numero).forEach((b) => push(b.artigo_id));
  blocks.filter((b) => b.tipo === "tecido").sort((a, b) => a.numero - b.numero).forEach((b) => b.variantes.forEach((v) => push(v ? varianteArtigoMap[v] : null)));
  return out;
}

export type TecidoPayload = {
  artigo_id: string; numero: number; tipo: TecidoBlock["tipo"];
  consumo: number; loss_percent: number; custo_previsto: number;
  variantes: (string | null)[]; multiplicadores: number[]; complementas: (string[] | null)[];
  oc_links: { ordem: number; variante_tecido_id: string; oc_tecido_item_id: string; quantidade_m: number; prioridade: number }[];
};

export function montarTecidosPayload(blocks: TecidoBlock[]): TecidoPayload[] {
  return blocks.filter((b) => b.artigo_id).map((b) => {
    const t1 = b.tipo === "tecido" && b.numero === 1;
    return {
      artigo_id: b.artigo_id as string, numero: b.numero, tipo: b.tipo,
      consumo: b.consumo || 0, loss_percent: b.loss_percent || 0, custo_previsto: b.custo_previsto || 0,
      variantes: b.variantes,
      // Tecido 1 é sempre 1:1 (âncora) e nunca casa; complementares levam multiplicador e casamento.
      multiplicadores: t1 ? b.variantes.map(() => 1) : b.multiplicadores.map((m) => Number(m) || 1),
      complementas: t1 ? b.variantes.map(() => null) : b.variantes.map((_, i) => {
        const a = b.complementas?.[i];
        return a && a.length ? a : null;
      }),
      oc_links: b.variantes.flatMap((vid, i) => {
        const allocs = b.oc_links?.[i] ?? [];
        if (!vid) return [];
        return allocs.filter((al) => al.oc_tecido_item_id).map((al) => ({
          ordem: i + 1, variante_tecido_id: vid, oc_tecido_item_id: al.oc_tecido_item_id,
          quantidade_m: al.quantidade_m ?? 0, prioridade: al.prioridade ?? 1,
        }));
      }),
    };
  });
}

export type AviamentoPayload = { aviamento_id: string; variante_aviamento_id: string | null; numero: number; consumo: number; loss_percent: number; custo_previsto: number };

export function montarAviamentosPayload(rows: AviamentoRow[]): AviamentoPayload[] {
  return rows.filter((r) => r.aviamento_id).map((r, i) => ({
    aviamento_id: r.aviamento_id as string, variante_aviamento_id: r.variante_aviamento_id || null, numero: i + 1,
    consumo: r.consumo || 0, loss_percent: r.loss_percent || 0, custo_previsto: r.custo_previsto || 0,
  }));
}

export function montarGradesPayload(grades: GradeRow[]): GradeRow[] {
  return grades.map((g) => ({ variante_numero: g.variante_numero, grades: g.grades, grade_total: g.grade_total }));
}

export type EtiquetaRowPayload = { modelo_id: string; etiqueta_id: string; cor_id: string | null; numero: number; consumo: number; loss_percent: number; custo_previsto: number };
export type OpEtiqueta = { tipo: "atualizar"; id: string; row: EtiquetaRowPayload } | { tipo: "inserir"; row: EtiquetaRowPayload };

/** Diff por id de `modelo_etiquetas` (etiqueta não reserva estoque — fora da RPC do BOM, como no Dev). */
export function planoEtiquetas(rows: ModeloEtiquetaRow[], idsServidor: string[], modeloId: string): { ops: OpEtiqueta[]; apagar: string[] } {
  const validas = rows.filter((r) => r.etiqueta_id);
  const mantidos = new Set(validas.filter((r) => r.id).map((r) => r.id as string));
  const ops: OpEtiqueta[] = validas.map((r, i) => {
    const row: EtiquetaRowPayload = {
      modelo_id: modeloId, etiqueta_id: r.etiqueta_id as string, cor_id: r.cor_id || null, numero: i + 1,
      consumo: r.consumo || 0, loss_percent: r.loss_percent || 0, custo_previsto: r.custo_previsto || 0,
    };
    return r.id ? { tipo: "atualizar", id: r.id, row } : { tipo: "inserir", row };
  });
  return { ops, apagar: idsServidor.filter((id) => !mantidos.has(id)) };
}

// ── Card novo / Duplicar (G-mockup R3, decisão F3 #9) ────────────────────────────────────────
/** Artigo dos blocos Tecido, por número (sem substitutos, sem forro/entretela). */
export function artigosTecidoPrincipais(blocks: TecidoBlock[]): string[] {
  return blocks.filter((b) => b.tipo === "tecido" && !!b.artigo_id).sort((a, b) => a.numero - b.numero).map((b) => b.artigo_id as string);
}

/** BOM inicial = Tecido 1..3 só com o artigo (o Dev só mostra 3 blocos por tipo). */
export function blocosTecidosIniciais(artigoIds: string[]): TecidoPayload[] {
  return artigoIds.filter(Boolean).slice(0, 3).map((artigo_id, i) => ({
    artigo_id, numero: i + 1, tipo: "tecido",
    consumo: 0, loss_percent: 0, custo_previsto: 0,
    variantes: [], multiplicadores: [], complementas: [], oc_links: [],
  }));
}

// ── Selos e pools ────────────────────────────────────────────────────────────────────────────
export type ResumoBom = { nTecidos: number; todosBlocosComArtigoTemVariante: boolean; nAviamentos: number; nInsumos: number; gradeTotalGeral: number };

export function resumoBom(e: EstadoBom): ResumoBom {
  return {
    nTecidos: e.blocks.filter((b) => b.tipo === "tecido" && !!b.artigo_id).length,
    todosBlocosComArtigoTemVariante: e.blocks.filter((b) => !!b.artigo_id).every((b) => b.variantes.some((v) => !!v)),
    nAviamentos: e.aviamentos.filter((r) => !!r.aviamento_id).length,
    nInsumos: e.etiquetas.filter((x) => !!x.etiqueta_id).length,
    gradeTotalGeral: e.grades.reduce((s, g) => s + (g.grade_total || 0), 0),
  };
}

/** Artigos cujas variantes o Sheet precisa conhecer (Dev :780-790): lista + forros/entretelas + blocos. */
export function relevantArtigoIds(i: { planejados: string[]; extras: string[]; blocks: TecidoBlock[] }): string[] {
  const s = new Set<string>();
  i.planejados.forEach((id) => id && s.add(id));
  i.extras.forEach((id) => id && s.add(id));
  i.blocks.forEach((b) => {
    if (b.artigo_id) s.add(b.artigo_id);
    (b.artigoIdsExtra ?? []).forEach((x) => x && s.add(x));
  });
  return Array.from(s).sort();
}

// ── Captura do Salvar ────────────────────────────────────────────────────────────────────────
export type BomCapturado = {
  estado: EstadoBom;
  snapshot: string;
  /** Vai gravar o BOM? = pode editar E tocou E difere do baseline ("carregado E sujo"). */
  gravar: boolean;
  flags: FlagsBom;
  idsEtiquetasServidor: string[];
  tecidosPlanejados: string[];
  /** Totais SEM mão de obra (a MO entra no Salvar). null = ficha não carregada / sem permissão / somente leitura. */
  totais: TotaisBom | null;
};

// ── R5 (G-plano conjunto) — o BOM do SERVIDOR mudou de verdade? ─────────────────────────────────────
/**
 * Estado do BOM como a CARGA do Sheet o monta a partir das linhas do servidor (hidratação + herança de grade —
 * as MESMAS funções da carga), p/ comparar com o estado do servidor sobre o qual o usuário está editando.
 */
export function estadoBomDoServidor(i: {
  tecidos: TecidoRowDb[]; variantes: VarianteRowDb[]; ocLinks: OcLinkRowDb[];
  aviamentos: AviamentoRowDb[]; etiquetas: EtiquetaRowDb[]; grades: GradeRowDb[]; planejados: string[];
}): EstadoBom {
  const blocks = hidratarBlocos({ tecidos: i.tecidos, variantes: i.variantes, ocLinks: i.ocLinks, planejados: i.planejados });
  return {
    blocks,
    aviamentos: hidratarAviamentos(i.aviamentos),
    etiquetas: hidratarEtiquetas(i.etiquetas),
    grades: herdarGrades(hidratarGrades(i.grades), tecido1VarianteIds(blocks).length),
  };
}

function gradeOrdenada(g: Record<string, number> | null | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(g ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// ── T2/T7 m3 — a assinatura arredonda como o BANCO guarda ──────────────────────────────────────
/**
 * Arredondamento determinístico idêntico ao `numeric` do Postgres (`round(x, n)`): meio para longe
 * do zero (half-away-from-zero) — NÃO o "half to even"/round-to-even do `Math.round` de negativos e
 * NÃO o binário do float puro. Sem isso, a assinatura local (JS) e o eco relido do servidor (que já
 * passou pelo `numeric` do Postgres) podem arredondar o MESMO valor de formas diferentes na borda
 * .5 e acender um "Tecidos & BOM" falso.
 */
function roundNumeric(x: number, casas: number): number {
  const f = 10 ** casas;
  return (Math.sign(x) || 1) * Math.round(Math.abs(x) * f) / f;
}

/** `modelo_tecidos`/`modelo_aviamentos`.consumo e `modelo_etiquetas`.consumo — NUMERIC(10,4). */
const r4 = (x: number) => roundNumeric(Number(x) || 0, 4);
/** `modelo_tecidos`/`modelo_aviamentos`.loss_percent — NUMERIC(5,2); `modelo_etiquetas`.loss_percent — NUMERIC(10,2) (mesma escala de 2 casas). */
const r2 = (x: number) => roundNumeric(Number(x) || 0, 2);

/** A grade "tem valor" pelo MESMO critério do RPC (`_salvar_modelo_bom_core`, funcoes.sql:7695-7717):
 *  `grade_total > 0` OU alguma célula > 0. Linha sem valor é DESCARTADA pelo INSERT — não pode entrar
 *  na assinatura (senão a herança que a recria no eco, ou a ausência dela no enviado, vira falso conflito). */
function gradeTemValor(g: GradeRow): boolean {
  if ((g.grade_total || 0) > 0) return true;
  return Object.values(g.grades ?? {}).some((v) => Number(v) > 0);
}

/** Slot NÃO-nulo do bloco (M1, fix round 1): ordem + variante + multiplicador + casamento. Um slot SEM
 *  variante nunca é lido pelo RPC (que só grava `modelo_tecido_variantes` para índices com variante —
 *  `_salvar_modelo_bom_core`), então multiplicador/casamento "velhos" sobrando num slot vazio (troca de
 *  artigo do bloco só zera `variantes`, `ModeloTecidosSection.tsx:360`; ou substituto removido) não podem
 *  entrar na assinatura — o próprio banco os ignora. */
function slotsDoBloco(t: TecidoPayload): { ordem: number; variante: string; multiplicador: number; complemento: string[] | null }[] {
  return t.variantes
    .map((v, i) => (v ? { ordem: i + 1, variante: v, multiplicador: t.multiplicadores[i] ?? 1, complemento: t.complementas[i] ?? null } : null))
    .filter((s): s is { ordem: number; variante: string; multiplicador: number; complemento: string[] | null } => s !== null);
}

/**
 * "Assinatura" do BOM = o que `salvar_modelo_bom` + etiquetas GRAVARIAM (as MESMAS funções do Salvar), sem os custos
 * derivados e com as chaves da grade em ordem estável (o jsonb do servidor reordena). Linha vazia, casamento vazio e
 * alocação de OC sem OC somem dos dois lados — só acusa diferença que o banco de fato guarda.
 *
 * M1 (fix round 1, R5 falso-positivo pós-Salvar): a referência aqui é o estado ENVIADO, mas o RPC NORMALIZA o
 * que grava — o eco relido nunca é byte-a-byte igual ao payload enviado, mesmo sem ninguém mais ter mexido.
 * Dois casos concretos: (a) grade de uma variante zerada é DESCARTADA pelo INSERT (`gradeTemValor`) e a
 * herança de grade (`estadoBomDoServidor`) a RECRIA copiando a 1ª — filtramos pelo MESMO critério do RPC
 * ANTES de reaplicar a herança dos dois lados, então a linha "some" nos dois. (b) multiplicador/casamento
 * ficam num slot SEM variante (troca de artigo zera só `variantes`; substituto removido) — o RPC nunca lê
 * esse slot, então a assinatura só considera slots com variante (`slotsDoBloco`).
 */
export function assinaturaBom(e: EstadoBom): string {
  const nVariantesT1 = tecido1VarianteIds(e.blocks).length;
  const gradesComValor = herdarGrades(e.grades.filter(gradeTemValor), nVariantesT1);
  return JSON.stringify({
    tecidos: montarTecidosPayload(e.blocks).map((t) => ({
      artigo_id: t.artigo_id, numero: t.numero, tipo: t.tipo,
      consumo: r4(t.consumo), loss_percent: r2(t.loss_percent),
      slots: slotsDoBloco(t),
      oc_links: t.oc_links,
    })),
    aviamentos: montarAviamentosPayload(e.aviamentos).map(({ custo_previsto: _c, consumo, loss_percent, ...a }) => ({
      ...a, consumo: r4(consumo), loss_percent: r2(loss_percent),
    })),
    etiquetas: e.etiquetas.filter((r) => r.etiqueta_id).map((r) => ({
      etiqueta_id: r.etiqueta_id, cor_id: r.cor_id || null, consumo: r4(r.consumo || 0), loss_percent: r2(r.loss_percent || 0),
    })),
    grades: montarGradesPayload(gradesComValor)
      .map((g) => ({ variante_numero: g.variante_numero, grades: gradeOrdenada(g.grades), grade_total: g.grade_total }))
      .sort((a, b) => a.variante_numero - b.variante_numero),
  });
}

/** O BOM do servidor diverge da referência (o que o usuário tinha do servidor ao editar)? Sem referência = diverge. */
export function bomDivergeDaReferencia(referencia: string | null, servidor: EstadoBom): boolean {
  return referencia === null || assinaturaBom(servidor) !== referencia;
}
