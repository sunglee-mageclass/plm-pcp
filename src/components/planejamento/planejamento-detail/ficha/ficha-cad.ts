// F3.3 (Planejamento unificado) — contas PURAS da seção "CAD" do Sheet do Planejamento de Produto. PORTADAS (cópia) do
// `PanelContent` do Desenvolvimento (src/components/desenvolvimento/ModeloDetailPanel.tsx), que fica INTOCADO até a F5
// (decisão travada 8). Cada função cita a faixa de origem; as diferenças deliberadas estão marcadas "F3.3 (T…)" e
// registradas no plano F3.3 (§7). Sem React e sem Supabase — testadas em tests/unit/ficha-cad.test.ts. Tipos e
// `calcCusto` vêm de src/components/producao/cad/types.ts (só importados).
import { gradeMapa, gradeTotal, pecasDoInsumo, tamanhoEfetivoInsumo } from "@/lib/insumo-tamanho";
import { gradeEfetivaPar } from "@/lib/casar-variantes-grade";
import {
  calcCusto,
  type TecidoRow as CadTecidoRow,
  type VarianteRow as CadVarianteRow,
  type TipoTec,
} from "@/components/producao/cad/types";
import type { AviamentoRow, EtiquetaInfo, GradeRow, ModeloEtiquetaRow, TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import { montarAviamentosPayload, montarGradesPayload, roundNumeric, type TecidoRowDb, type VarianteRowDb } from "./ficha-calc";

export type { CadTecidoRow, CadVarianteRow, TipoTec };

// Linhas cruas do CAD — o MESMO select do Dev (ModeloDetailPanel.tsx:529-532), embutido a partir de `cad`.
export type CadVarianteRowDb = {
  id: string; variante_tecido_id: string | null; ordem: number | null; multiplicador: number | null;
  quantidade_folhas: number | null; metragem_planejada: number | null; metragem_enviada: number | null;
  complementa_variante_ids: string[] | null;
  variantes_tecido?: {
    nome_variante: string | null; codigo_variante: string | null;
    cor?: { nome: string | null } | null; apelido?: { nome: string | null } | null;
  } | null;
};
export type CadTecidoRowDb = {
  id: string; numero: number; tipo: string; artigo_id: string | null;
  consumo_cad: number | null; loss_percent_cad: number | null; custo_cad: number | null; tamanho_folha: number | null;
  artigos?: {
    nome: string | null; preco_por_metro: number | null; unidade_medida: string | null;
    etiqueta_lavagem_urls: string[] | null; largura_estimada: number | null;
  } | null;
  cad_tecido_variantes?: CadVarianteRowDb[] | null;
};
export type CadRowDb = { id: string; cad_tecidos?: CadTecidoRowDb[] | null };
/** O que a carga precisa do cadastro de artigos (subconjunto de `ArtigoFicha`, useFichaDados). */
export type ArtigoCad = { nome: string; preco_por_metro: number | null; largura_estimada: number | null };
export type RotulosVariante = Record<string, { nome: string | null; cor: string | null; apelido: string | null }>;
/** O que muda no bloco e precisa ir à linha do CAD (propagação BOM → CAD). */
export type PatchBlocoCad = { consumo?: number; loss_percent?: number; artigo_id?: string | null };
type CtxCad = { artigoMap: Record<string, ArtigoCad>; frozen: Record<string, number> };

const TIPO_ORDEM: Record<string, number> = { tecido: 0, forro: 1, entretela: 2 };
const ordenar = (rows: CadTecidoRow[]) =>
  [...rows].sort((a, b) => (TIPO_ORDEM[a.tipo] ?? 9) - (TIPO_ORDEM[b.tipo] ?? 9) || a.numero - b.numero);
/** Preço/m da linha: o congelado pela OC vinculada (`tipo|numero`, Dev :1059-1060) ou o do artigo. */
const precoTec = (frozen: Record<string, number>, tipo: string, numero: number, artigoPpm: number) =>
  Number(frozen[`${tipo}|${numero}`] ?? artigoPpm);

function varianteDoBom(v: VarianteRowDb): CadVarianteRow {
  return {
    variante_tecido_id: v.variante_tecido_id,
    variante_nome: null, variante_cor: null, variante_apelido: null,
    multiplicador: Number(v.multiplicador ?? 1) || 1,
    ordem: v.ordem ?? 0,
    quantidade_folhas: 0, metragem_planejada: 0, metragem_enviada: 0,
    complementa_variante_ids: v.complementa_variante_ids ?? null,
  };
}

function linhaDoBom(mt: TecidoRowDb, variantes: VarianteRowDb[], ctx: CtxCad): CadTecidoRow {
  const art = mt.artigo_id ? ctx.artigoMap[mt.artigo_id] : undefined;
  const preco = precoTec(ctx.frozen, mt.tipo, mt.numero, Number(art?.preco_por_metro ?? 0));
  const consumo = Number(mt.consumo ?? 0);
  const loss = Number(mt.loss_percent ?? 0);
  return {
    numero: mt.numero, tipo: mt.tipo as TipoTec, artigo_id: mt.artigo_id,
    consumo_cad: consumo, loss_percent_cad: loss, custo_cad: calcCusto(consumo, loss, preco),
    tamanho_folha: 0, preco, largura: Number(art?.largura_estimada ?? 0),
    artigo_nome: art?.nome ?? null, etiqueta_lavagem_urls: [],
    variantes: variantes.filter((v) => v.modelo_tecido_id === mt.id).map(varianteDoBom),
  };
}

/**
 * Carga do CAD (Dev :1040-1174). Com CAD no servidor: as linhas dele (valores e rótulos) + os blocos/variantes do BOM
 * que o CAD ainda não tem (zerados — Dev :1110-1145). Sem CAD: semeia do BOM, folhas/metragem zeradas (:1146-1168).
 * Ordem: Tecido → Forro → Entretela, por número (:1170-1171).
 */
export function hidratarCad(i: {
  cad: CadRowDb | null;
  bomTecidos: TecidoRowDb[];
  bomVariantes: VarianteRowDb[];
  artigoMap: Record<string, ArtigoCad>;
  frozen: Record<string, number>;
}): CadTecidoRow[] {
  const ctx: CtxCad = { artigoMap: i.artigoMap, frozen: i.frozen };
  const doServidor = i.cad?.cad_tecidos ?? [];
  if (doServidor.length === 0) return ordenar(i.bomTecidos.map((mt) => linhaDoBom(mt, i.bomVariantes, ctx)));
  const linhas: CadTecidoRow[] = doServidor.map((t) => ({
    id: t.id, numero: t.numero, tipo: t.tipo as TipoTec, artigo_id: t.artigo_id,
    consumo_cad: Number(t.consumo_cad ?? 0), loss_percent_cad: Number(t.loss_percent_cad ?? 0),
    custo_cad: Number(t.custo_cad ?? 0), tamanho_folha: Number(t.tamanho_folha ?? 0),
    preco: precoTec(i.frozen, t.tipo, t.numero, Number(t.artigos?.preco_por_metro ?? 0)),
    largura: Number(t.artigos?.largura_estimada ?? 0),
    artigo_nome: t.artigos?.nome
      ? (t.artigos.unidade_medida ? `${t.artigos.nome} [${t.artigos.unidade_medida}]` : t.artigos.nome)
      : null,
    etiqueta_lavagem_urls: (t.artigos?.etiqueta_lavagem_urls ?? []) as string[],
    variantes: (t.cad_tecido_variantes ?? []).map((v): CadVarianteRow => ({
      id: v.id,
      variante_tecido_id: v.variante_tecido_id,
      variante_nome: v.variantes_tecido?.nome_variante ?? v.variantes_tecido?.codigo_variante ?? null,
      variante_cor: v.variantes_tecido?.cor?.nome ?? null,
      variante_apelido: v.variantes_tecido?.apelido?.nome ?? null,
      multiplicador: Number(v.multiplicador ?? 1) || 1,
      ordem: v.ordem ?? 0,
      quantidade_folhas: Number(v.quantidade_folhas ?? 0),
      metragem_planejada: Number(v.metragem_planejada ?? 0),
      metragem_enviada: Number(v.metragem_enviada ?? 0),
      complementa_variante_ids: v.complementa_variante_ids ?? null,
    })),
  }));
  for (const mt of i.bomTecidos) {
    const existente = linhas.find((t) => t.tipo === mt.tipo && t.numero === mt.numero);
    if (!existente) { linhas.push(linhaDoBom(mt, i.bomVariantes, ctx)); continue; }
    const tem = new Set(existente.variantes.map((v) => v.variante_tecido_id).filter(Boolean));
    let acrescentou = false;
    for (const v of i.bomVariantes.filter((x) => x.modelo_tecido_id === mt.id)) {
      if (v.variante_tecido_id && !tem.has(v.variante_tecido_id)) { existente.variantes.push(varianteDoBom(v)); acrescentou = true; }
    }
    if (acrescentou) existente.variantes.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  }
  return ordenar(linhas);
}

/** Todas as variantes de todos os blocos, sem repetição, ordenadas (Dev :1274-1278) — rótulos da seção CAD. */
export function idsVariantesDosBlocos(blocks: TecidoBlock[]): string[] {
  const s = new Set<string>();
  blocks.forEach((b) => b.variantes.forEach((v) => { if (v) s.add(v); }));
  return Array.from(s).sort();
}

function variantesDoBloco(b: TecidoBlock): { variante_tecido_id: string; ordem: number; multiplicador: number; complementa_variante_ids: string[] | null }[] {
  const out: { variante_tecido_id: string; ordem: number; multiplicador: number; complementa_variante_ids: string[] | null }[] = [];
  b.variantes.forEach((vid, i) => {
    if (vid) out.push({
      variante_tecido_id: vid,
      ordem: i + 1,
      multiplicador: Number(b.multiplicadores?.[i] ?? 1) || 1,
      complementa_variante_ids: (b.complementas?.[i] as string[] | null) ?? null,
    });
  });
  return out;
}

/**
 * Sincronia BOM → CAD depois da carga (Dev :1314-1386): as variantes de cada linha seguem as do bloco do mesmo
 * tipo+número (ordem, multiplicador, casamento e rótulo; nova entra zerada; removida sai; o digitado das que ficam é
 * preservado). F3.3 (T4): bloco COM artigo sem linha no CAD ganha a linha já (a MESMA que a carga criaria — Dev
 * :1116-1133); linha SEM `id` (ainda não gravada) sai quando o bloco perde o artigo; linha com `id` (do servidor)
 * nunca sai — paridade. Devolve `prev` (mesma referência) quando nada muda — sem laço de efeito.
 */
export function sincronizarCadComBlocos(prev: CadTecidoRow[], blocks: TecidoBlock[], rotulos: RotulosVariante, ctx: CtxCad): CadTecidoRow[] {
  let changed = false;
  const next: CadTecidoRow[] = [];
  for (const cadTec of prev) {
    const block = blocks.find((b) => b.tipo === cadTec.tipo && b.numero === cadTec.numero);
    if (!block) { next.push(cadTec); continue; }
    if (!cadTec.id && !block.artigo_id) { changed = true; continue; }
    const have = new Map(cadTec.variantes.map((v) => [v.variante_tecido_id, v]));
    let mudou = false;
    const nextVariantes = variantesDoBloco(block).map(({ variante_tecido_id, ordem, multiplicador, complementa_variante_ids }) => {
      const existing = have.get(variante_tecido_id);
      const info = rotulos[variante_tecido_id];
      const nome = info?.nome ?? existing?.variante_nome ?? null;
      const cor = info?.cor ?? existing?.variante_cor ?? null;
      const apelido = info?.apelido ?? existing?.variante_apelido ?? null;
      if (existing) {
        const compChanged = JSON.stringify(existing.complementa_variante_ids ?? null) !== JSON.stringify(complementa_variante_ids);
        if (existing.ordem !== ordem || existing.multiplicador !== multiplicador || compChanged
          || existing.variante_nome !== nome || existing.variante_cor !== cor || existing.variante_apelido !== apelido) {
          mudou = true;
          return { ...existing, ordem, multiplicador, complementa_variante_ids, variante_nome: nome, variante_cor: cor, variante_apelido: apelido };
        }
        return existing;
      }
      mudou = true;
      return {
        variante_tecido_id, variante_nome: nome, variante_cor: cor, variante_apelido: apelido,
        multiplicador, ordem, quantidade_folhas: 0, metragem_planejada: 0, metragem_enviada: 0, complementa_variante_ids,
      } as CadVarianteRow;
    });
    if (nextVariantes.length !== cadTec.variantes.length) mudou = true;
    if (!mudou && nextVariantes.every((v, k) => v === cadTec.variantes[k])) { next.push(cadTec); continue; }
    changed = true;
    next.push({ ...cadTec, variantes: nextVariantes });
  }
  for (const b of blocks) {
    if (!b.artigo_id || next.some((t) => t.tipo === b.tipo && t.numero === b.numero)) continue;
    changed = true;
    const art = ctx.artigoMap[b.artigo_id];
    const preco = precoTec(ctx.frozen, b.tipo, b.numero, Number(art?.preco_por_metro ?? 0));
    const consumo = b.consumo || 0;
    const loss = b.loss_percent || 0;
    next.push({
      numero: b.numero, tipo: b.tipo, artigo_id: b.artigo_id,
      consumo_cad: consumo, loss_percent_cad: loss, custo_cad: calcCusto(consumo, loss, preco),
      tamanho_folha: 0, preco, largura: Number(art?.largura_estimada ?? 0),
      artigo_nome: art?.nome ?? null, etiqueta_lavagem_urls: [],
      variantes: variantesDoBloco(b).map((v) => ({
        ...v,
        variante_nome: rotulos[v.variante_tecido_id]?.nome ?? null,
        variante_cor: rotulos[v.variante_tecido_id]?.cor ?? null,
        variante_apelido: rotulos[v.variante_tecido_id]?.apelido ?? null,
        quantidade_folhas: 0, metragem_planejada: 0, metragem_enviada: 0,
      })),
    });
  }
  return changed ? ordenar(next) : prev;
}

/**
 * Propagação BOM → CAD (Dev :2441-2456): consumo/%loss do bloco vão para a linha do mesmo tipo+número, com o custo
 * recalculado. F3.3 (T4): trocar o artigo do bloco leva artigo/preço/largura/nome à linha (no Dev a linha ficava com o
 * artigo antigo e as variantes do novo). Só roda por AÇÃO do usuário (handlers/Importar) — nunca muda o CAD sozinho.
 */
export function propagarBlocoParaCad(prev: CadTecidoRow[], tipo: string, numero: number, patch: PatchBlocoCad, ctx: CtxCad): CadTecidoRow[] {
  let changed = false;
  const next = prev.map((t) => {
    if (t.tipo !== tipo || t.numero !== numero) return t;
    let linha = t;
    if (patch.artigo_id && patch.artigo_id !== t.artigo_id) {
      const art = ctx.artigoMap[patch.artigo_id];
      linha = {
        ...linha, artigo_id: patch.artigo_id, artigo_nome: art?.nome ?? null, etiqueta_lavagem_urls: [],
        preco: precoTec(ctx.frozen, t.tipo, t.numero, Number(art?.preco_por_metro ?? 0)),
        largura: Number(art?.largura_estimada ?? 0),
      };
    }
    if (patch.consumo !== undefined && patch.consumo !== linha.consumo_cad) linha = { ...linha, consumo_cad: patch.consumo };
    if (patch.loss_percent !== undefined && patch.loss_percent !== linha.loss_percent_cad) linha = { ...linha, loss_percent_cad: patch.loss_percent };
    if (linha === t) return t;
    changed = true;
    return { ...linha, custo_cad: calcCusto(linha.consumo_cad, linha.loss_percent_cad, linha.preco) };
  });
  return changed ? next : prev;
}

/** Edição da linha na seção CAD (Dev :1180-1186): recalcula o custo. */
export function atualizarLinhaCad(prev: CadTecidoRow[], i: number, patch: Partial<CadTecidoRow>): CadTecidoRow[] {
  const next = [...prev];
  const merged = { ...next[i], ...patch };
  merged.custo_cad = calcCusto(merged.consumo_cad, merged.loss_percent_cad, merged.preco);
  next[i] = merged;
  return next;
}

/** Edição da variante na seção CAD (Dev :1212-1220). */
export function atualizarVarianteCad(prev: CadTecidoRow[], i: number, j: number, patch: Partial<CadVarianteRow>): CadTecidoRow[] {
  const next = [...prev];
  const variantes = [...next[i].variantes];
  variantes[j] = { ...variantes[j], ...patch };
  next[i] = { ...next[i], variantes };
  return next;
}

/**
 * Folhas/metragem automáticas (Dev :1222-1269, idêntico ao CadEditor): peças da variante = grade da posição (ou, na
 * complementar casada, a Σ das grades das cores do Tecido 1 — `gradeEfetivaPar`) × multiplicador; folhas = peças ÷
 * Σproporção; metragem = peças × consumo × (1 + %loss); folha = (Σ peças × consumo ÷ Σ folhas) ÷ largura.
 */
export function calcularFolhasAuto(prev: CadTecidoRow[], grades: GradeRow[], proporcoes: Record<string, number>): CadTecidoRow[] {
  const somaProp = Object.values(proporcoes ?? {}).reduce((a: number, b) => a + (Number(b) || 0), 0);
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const gradeDe = (n: number) => grades.find((g) => g.variante_numero === n)?.grade_total ?? 0;
  const porVarianteT1 = new Map<string, number>();
  prev.find((b) => b.tipo === "tecido" && b.numero === 1)?.variantes.forEach((v) => {
    if (v.variante_tecido_id) porVarianteT1.set(v.variante_tecido_id, gradeDe(v.ordem));
  });
  let changed = false;
  const next = prev.map((t) => {
    const lossFactor = 1 + (Number(t.loss_percent_cad) || 0) / 100;
    let baseMetragem = 0;
    const isTecido1 = t.tipo === "tecido" && t.numero === 1;
    const variantes = t.variantes.map((v) => {
      const mult = Number(v.multiplicador ?? 1) || 1;
      const pecas = gradeEfetivaPar({ isTecido1, complementaIds: v.complementa_variante_ids, gradePosicao: gradeDe(v.ordem), gradePorVarianteTecido1: porVarianteT1 }) * mult;
      const quantidade_folhas = somaProp > 0 ? round2(pecas / somaProp) : 0;
      const base = pecas * (t.consumo_cad || 0);
      baseMetragem += base;
      const metragem_planejada = round2(base * lossFactor);
      if (v.quantidade_folhas !== quantidade_folhas || v.metragem_planejada !== metragem_planejada) changed = true;
      return { ...v, quantidade_folhas, metragem_planejada };
    });
    const totalFolhas = variantes.reduce((a, v) => a + v.quantidade_folhas, 0);
    const media = totalFolhas > 0 ? baseMetragem / totalFolhas : 0;
    const largura = Number(t.largura || 0);
    const tamanho_folha = largura > 0 ? round2(media / largura) : 0;
    if (t.tamanho_folha !== tamanho_folha) changed = true;
    return { ...t, variantes, tamanho_folha };
  });
  return changed ? next : prev;
}

/** Selo da seção CAD (Dev :1280-1295): o que falta para o CAD ser usável. Vazio sem linha. */
export function faltasCad(cad: CadTecidoRow[]): string[] {
  if (cad.length === 0) return [];
  const faltas = new Set<string>();
  for (const t of cad) {
    if (Number(t.consumo_cad ?? 0) <= 0) faltas.add("consumo");
    if (Number(t.largura ?? 0) <= 0) faltas.add("largura do tecido");
    for (const v of t.variantes) if (Number(v.metragem_planejada ?? 0) <= 0) faltas.add("metragem planejada");
  }
  return Array.from(faltas);
}

/**
 * F3.3 — linhas que ESTE Salvar pode gravar. Linha que o servidor não tem (sem `id` e fora do BOM do servidor — ex.:
 * Tecido 1 pré-preenchido pela lista num card sem BOM) só vai quando o BOM também grava; senão o CAD ganharia um tecido
 * que o BOM não tem.
 */
export function linhasParaGravar(cad: CadTecidoRow[], o: { bomGravado: boolean; chavesBomServidor: ReadonlySet<string> }): CadTecidoRow[] {
  return cad.filter((t) => !!t.id || o.bomGravado || o.chavesBomServidor.has(`${t.tipo}|${t.numero}`));
}

export type CadPayload = {
  _tecidos: {
    artigo_id: string | null; numero: number; tipo: TipoTec;
    consumo_cad: number; loss_percent_cad: number; custo_cad: number; tamanho_folha: number;
    variantes: { variante_tecido_id: string | null; ordem: number; multiplicador: number; quantidade_folhas: number; metragem_planejada: number; metragem_enviada: number }[];
  }[];
  _grades: GradeRow[];
  _aviamentos: { aviamento_id: string; variante_aviamento_id: string | null; numero: number; consumo: number; quantidade_enviar: number; quantidade_separar: number }[];
  _etiquetas: { etiqueta_id: string; cor_id: string | null; consumo: number; quantidade_planejada: number; quantidade_enviar: number; enviar_por_tamanho: Record<string, number> }[];
  _proporcoes: Record<string, number>;
  _observacoes_molde: null;
  _data_previsao_corte: null;
};
/**
 * O CAD capturado no início do Salvar (vai no `BomCapturado.cad` — ficha-calc.ts). `estado` = todas as linhas da tela
 * (re-base do "não salvo"); `linhas` = as que ESTE Salvar grava (`linhasParaGravar` — referência do conflito depois de
 * gravar); `payload` só quando `gravar`.
 */
export type CadCapturado = { estado: CadTecidoRow[]; linhas: CadTecidoRow[]; snapshot: string; gravar: boolean; payload: CadPayload | null };

/**
 * urg R1 (T7) — `etiqueta_id` → tamanho EFETIVO do insumo (vínculo que vale: só p/ insumo sem tamanho próprio; ver
 * `tamanhoEfetivoInsumo`), só das etiquetas usadas nas linhas. Insumo fora do catálogo carregado = sem vínculo.
 */
export function tamanhoPorEtiquetaDe(
  etiquetas: ModeloEtiquetaRow[], etiquetaMap: Record<string, EtiquetaInfo>,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const e of etiquetas) {
    if (!e.etiqueta_id || Object.prototype.hasOwnProperty.call(out, e.etiqueta_id)) continue;
    const info = etiquetaMap[e.etiqueta_id];
    out[e.etiqueta_id] = info
      ? tamanhoEfetivoInsumo({
        tamanho_vinculado: info.tamanho_vinculado ?? null,
        formato_tamanho: info.formato_tamanho ?? null,
        variantes: (info.variantes ?? []).map((v) => ({ tamanho: v.tamanho ?? null })),
      })
      : null;
  }
  return out;
}

/**
 * Argumentos do `salvar_cad_completo` (Dev :2067-2117): grade só das variantes com valor; aviamentos e etiquetas com a
 * quantidade = consumo × grade total geral (fórmula do `_enviar_modelo_para_cad_core`); `enviar_por_tamanho: {}` e
 * `_observacoes_molde: null` — paridade (o apagamento desses ajustes da Explosão é tarefa própria — decisão F3 #7).
 */
export function montarCadPayload(i: {
  cad: CadTecidoRow[]; grades: GradeRow[]; aviamentos: AviamentoRow[]; etiquetas: ModeloEtiquetaRow[]; proporcoes: Record<string, number>;
  /** urg R1 (T7): `etiqueta_id` → tamanho EFETIVO do insumo (`tamanhoEfetivoInsumo`); null/ausente = sem vínculo. */
  tamanhoPorEtiqueta?: Record<string, string | null>;
}): CadPayload {
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  const gradeTotalGeral = i.grades.reduce((s, g) => s + (g.grade_total || 0), 0);
  // Insumo vinculado a um tamanho conta só as peças daquele tamanho (urg R1; espelho do `_enviar_modelo_para_cad_core`).
  const mapaGrade = gradeMapa(i.grades);
  const totalGrade = gradeTotal(i.grades);
  const porTam = i.tamanhoPorEtiqueta ?? {};
  const pecasEtiqueta = (etiquetaId: string): number => {
    const tam = Object.prototype.hasOwnProperty.call(porTam, etiquetaId) ? porTam[etiquetaId] : null;
    return pecasDoInsumo(tam ?? null, mapaGrade, totalGrade);
  };
  return {
    _tecidos: i.cad.map((t) => ({
      artigo_id: t.artigo_id, numero: t.numero, tipo: t.tipo,
      consumo_cad: t.consumo_cad, loss_percent_cad: t.loss_percent_cad, custo_cad: t.custo_cad, tamanho_folha: t.tamanho_folha,
      variantes: t.variantes.map((v) => ({
        variante_tecido_id: v.variante_tecido_id, ordem: v.ordem, multiplicador: Number(v.multiplicador ?? 1) || 1,
        quantidade_folhas: v.quantidade_folhas, metragem_planejada: v.metragem_planejada, metragem_enviada: v.metragem_enviada,
      })),
    })),
    _grades: montarGradesPayload(i.grades).filter(
      (g) => (g.grade_total || 0) > 0 || Object.values(g.grades || {}).some((v) => (Number(v) || 0) > 0),
    ),
    _aviamentos: montarAviamentosPayload(i.aviamentos).map((a, k) => ({
      aviamento_id: a.aviamento_id, variante_aviamento_id: a.variante_aviamento_id || null, numero: k + 1, consumo: a.consumo || 0,
      quantidade_enviar: round4((a.consumo || 0) * gradeTotalGeral), quantidade_separar: round4((a.consumo || 0) * gradeTotalGeral),
    })),
    _etiquetas: i.etiquetas.filter((e) => e.etiqueta_id).map((e) => ({
      etiqueta_id: e.etiqueta_id as string, cor_id: e.cor_id ?? null, consumo: Number(e.consumo ?? 0),
      quantidade_planejada: round4(Number(e.consumo ?? 0) * pecasEtiqueta(e.etiqueta_id as string)),
      quantidade_enviar: round4(Number(e.consumo ?? 0) * pecasEtiqueta(e.etiqueta_id as string)),
      enviar_por_tamanho: {},
    })),
    _proporcoes: i.proporcoes ?? {},
    _observacoes_molde: null,
    _data_previsao_corte: null,
  };
}

/** "Não salvo" do CAD: o que o usuário edita e o Salvar grava — sem ids, rótulos, preço, largura e custo (derivados). */
export function snapshotCad(cad: CadTecidoRow[]): string {
  return JSON.stringify(cad.map((t) => ({
    tipo: t.tipo, numero: t.numero, artigo_id: t.artigo_id,
    consumo_cad: t.consumo_cad, loss_percent_cad: t.loss_percent_cad, tamanho_folha: t.tamanho_folha,
    variantes: t.variantes.map((v) => ({
      variante_tecido_id: v.variante_tecido_id, ordem: v.ordem, multiplicador: v.multiplicador,
      quantidade_folhas: v.quantidade_folhas, metragem_planejada: v.metragem_planejada, metragem_enviada: v.metragem_enviada,
      complementa_variante_ids: v.complementa_variante_ids ?? null,
    })),
  })));
}

/**
 * Assinatura do que é DO CAD (folha, qtd de folhas, metragens) e ≠ 0, por tipo+número+variante, em ordem estável e na
 * escala do BANCO (o cálculo automático gera 4,17 folhas; o servidor devolve 4 — sem isso o eco do próprio Salvar
 * acenderia "Tecidos & BOM"). Consumo/%loss/artigo/variantes/multiplicador são do BOM (já na `assinaturaBom`); linha/
 * variante zerada = ausente (a carga cria zeradas as que o CAD não tem — sem isso toda carga "divergiria"). Arredonda
 * como o `numeric`/`integer` do Postgres guarda com o MESMO `roundNumeric` da assinatura do BOM (ficha-calc.ts, fix
 * round 2/3 da F3.2 — meio p/ longe do zero, decompõe por `toExponential()` em vez de concatenar `abs + "e" + casas`
 * nas bordas de valores muito pequenos; fix round 1, M1 — o resultado final NUNCA é NaN, nem em valores enormes tipo
 * 1e19/1e21 ou ±Infinity, que agora caem em 0). Escalas do banco (cópia, 24/set):
 * `cad_tecido_variantes.quantidade_folhas` INTEGER (o `salvar_cad_completo` faz `::numeric` e o INSERT arredonda);
 * `metragem_planejada`/`metragem_enviada` e `cad_tecidos.tamanho_folha` NUMERIC(10,2).
 */
export function assinaturaCad(cad: CadTecidoRow[]): string {
  const partes: string[] = [];
  for (const t of cad) {
    const folha = roundNumeric(Number(t.tamanho_folha) || 0, 2);
    if (folha > 0) partes.push(`t|${t.tipo}|${t.numero}|${folha}`);
    for (const v of t.variantes) {
      const qf = roundNumeric(Number(v.quantidade_folhas) || 0, 0);
      const mp = roundNumeric(Number(v.metragem_planejada) || 0, 2);
      const me = roundNumeric(Number(v.metragem_enviada) || 0, 2);
      if (qf > 0 || mp > 0 || me > 0) partes.push(`v|${t.tipo}|${t.numero}|${v.variante_tecido_id ?? ""}|${qf}|${mp}|${me}`);
    }
  }
  return partes.sort().join(";");
}

/** Assinatura do CAD do SERVIDOR (linha crua de `plan-ficha-cad`); sem CAD = "". */
export function assinaturaCadServidor(cad: CadRowDb | null): string {
  return assinaturaCad(hidratarCad({ cad, bomTecidos: [], bomVariantes: [], artigoMap: {}, frozen: {} }));
}

/** O CAD do servidor diverge da referência (o que o usuário tinha do servidor ao editar)? Sem referência = diverge. */
export function cadDivergeDaReferencia(referencia: string | null, cad: CadRowDb | null): boolean {
  return referencia === null || assinaturaCadServidor(cad) !== referencia;
}

/**
 * Fix round 1 (revisão Opus das T5+T6, I1) — a carga do CAD (`useFichaCad`, efeito ligado ao `cargaSeq` do BOM)
 * esperava só o `bomFetching`, sem olhar se a ficha estava TOCADA enquanto o refetch corria: uma carga sem toque
 * sobe o `cargaSeq` (Dev/`useFichaBom`); antes do próximo render começa outro refetch (ex.: o eco pós-save); o
 * usuário edita o consumo NESSA janela — a ficha fica tocada; quando o refetch chega, o BOM vai para o R5a
 * (`useFichaBom` :178 — compara, não sobrescreve, e NÃO sobe `cargaSeq` de novo), mas a carga do CAD, que só olhava
 * `cargaSeq`/`bomFetching`, aplicava a chave já pendente do PRIMEIRO `cargaSeq` — sobrescrevendo o CAD local (com a
 * edição do usuário) pelo do servidor e movendo `aplicadaRef`. No Salvar, o BOM ia novo (tocado) e o CAD velho
 * (sobrescrito), e `salvar_cad_completo` devolvia o consumo velho ao BOM em silêncio — exatamente o problema que
 * justificava a trava "tem CAD" que a Task 6 removeu.
 * Fix: com a ficha TOCADA (na chave NOVA, já sem `bomFetching` em curso — os dados do render já são os que a carga
 * do BOM usou), não hidrata — só marca a chave como aplicada (fora desta função pura, no efeito do `useFichaCad`),
 * p/ não ficar pendente para sempre (senão a próxima carga sem toque aplicaria um CAD potencialmente velho, ou o
 * `cargaPendenteRef` ficaria preso em `true`). `bomFetching` continua bloqueando (guarda de DISPONIBILIDADE — o
 * refetch ainda não resolveu, os dados do render podem estar em trânsito) — só o "tocado" é o gate NOVO.
 */
export function deveAplicarCargaCad(i: { chave: string; aplicada: string; tocado: boolean; bomFetching: boolean }): boolean {
  if (i.chave === i.aplicada || i.bomFetching) return false;
  return !i.tocado;
}

/**
 * O Salvar grava o CAD? Paridade com o Dev (decisão F3 #7: "todo Salvar regrava", ModeloDetailPanel.tsx:2067) com
 * guardas: (1) ficha editável (carregada, com permissão, sem trava pós-Explosão) e CAD carregado; (2) há linha a
 * gravar — `salvar_cad_completo` com lista vazia apagaria o CAD (funcoes.sql:6779); (3) D2: antes da Ordem de Criação o
 * Planejamento NÃO cria o CAD (FK `cad.modelo_id` NO ACTION — o card não se excluiria mais); (4) sem toque, só na 1ª
 * tentativa e sem recarga em curso: o estado local pode estar VELHO (o `.eq("rev")` passou, mas a recarga pedida pelo
 * Realtime ainda não chegou) e o CAD regravaria grade e consumo velhos no BOM (funcoes.sql:6797-6810, :6878-6881). Com
 * toque, a conferência com o servidor (R5/R5a da F3.2, agora com o CAD) já protege — e o BOM grava junto (§3 P2).
 * `tocado` = a ficha foi tocada OU o BOM grava neste Salvar (quem chama — `capturarCad`, useFichaTecnica — junta os dois).
 * `recarregando` = recarga EM CURSO (`bomFetching`) OU pedida e ainda não aplicada ao CAD (`cadVelhoRef`, R1 do G-plano
 * F3.3 — quem chama junta os dois; §7 T22).
 */
export function deveGravarCad(i: {
  podeEditar: boolean; cadHidratado: boolean; cadExiste: boolean; ordemEnviada: boolean;
  linhas: number; tocado: boolean; retry: boolean; recarregando: boolean;
}): boolean {
  if (!i.podeEditar || !i.cadHidratado || i.linhas === 0) return false;
  if (!i.cadExiste && !i.ordemEnviada) return false;
  if (i.tocado) return true;
  return !i.retry && !i.recarregando;
}
