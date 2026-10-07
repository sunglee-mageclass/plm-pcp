import { tamanhoEfetivoInsumo } from "@/lib/insumo-tamanho";
// Mini explosao da Peca Teste (urg R11) — NUCLEO de calculo PURO (sem React/Supabase). Espelho TS da SQL da 199300
// (`_peca_teste_mini_linhas`, `_peca_teste_insumo_tam_bucket`, `_peca_teste_tecido_baixar`) e predicado da R12
// (`_peca_teste_mini_feita`). Anti-drift SQL x TS: tests/fixtures/peca-teste-mini-casos.ts
// (+ tests/integration/urgd-r11-regras.test.ts). Mudou a regra? Mude TS, SQL e a fixture.
//
// Regras fixadas pela fixture:
//  - BOM para 1 PECA (entradas: tamanho T e variante V do Tecido 1, ordem N):
//    * Tecido: por bloco (tipo, numero) e variante v, pecas = gradeEfetiva(1 peca) x multiplicador; so entra se pecas > 0.
//      Tecido 1 -> so a variante de ordem N; complementar SEM casamento -> a de ordem N; casada -> 1 se V em
//      complementa_variante_ids. consumo_ef = ajuste ?? bloco.consumo; loss_ef = ajuste ?? bloco.loss_percent;
//      necessaria = round(pecas x consumo_ef x (1 + loss_ef/100), 2) m.
//    * Aviamento: toda linha entra. necessaria = round(consumo x 1, 4) un (sem loss). variante padrao: a da cor de V (unica) ->
//      a do BOM -> a unica -> NULL. Card sem Tecido 1 pula o passo 1.
//    * Insumo: tam = tamanho vinculado do insumo. Com tam != NULL e tam != T -> fica FORA (nao entra nesta peca).
//      necessaria = round(consumo x 1, 4). Bucket de estoque (etiqueta, tam_bucket, cor_id), tam_bucket = T se o insumo tem
//      tamanho proprio (regra ce_sem) senao NULL.
//    * a_enviar_ef = ajuste.a_enviar ?? necessaria (todas as familias).
//  - Arredondamento DECIMAL (casa com round() do Postgres no meio centavo).
//  - Alocacao do tecido = regua do corte (`_baixar_estoque_tecido_corte_core`): por_oc = vinculos por (prioridade, item) com
//    teto quantidade_m, depois FIFO fora dos vinculados; automatico = FIFO; desmarcado = so o item escolhido. Tudo por saldo do item.

// ───────────────────────────── arredondamento ─────────────────────────────

/** round(x, casas) DECIMAL — casa com o round(numeric) do Postgres (half-up no decimal, nao no binario). */
export function arredondar(x: number, casas: number): number {
  if (!Number.isFinite(x)) return 0;
  // tira o ruido binario (toFixed(10)) e desloca a virgula por notacao cientifica (half-away-from-zero do Math.round no decimal).
  const sinal = x < 0 ? -1 : 1;
  const m = Math.round(Number(`${Math.abs(x).toFixed(10)}e${casas}`));
  return sinal * Number(`${m}e-${casas}`);
}

// ───────────────────────────── chaves ─────────────────────────────

export function chaveTecido(tipo: string, numero: number, ordem: number, varianteTecidoId: string): string {
  return `t:${tipo}:${numero}:${ordem}:${varianteTecidoId}`;
}
export function chaveAviamento(aviamentoId: string, k: number): string {
  return `a:${aviamentoId}:${k}`;
}
export function chaveInsumo(etiquetaId: string, corId: string | null, k: number): string {
  return `i:${etiquetaId}:${corId ?? "-"}:${k}`;
}

// ───────────────────────────── bucket do insumo (regra ce_sem) ─────────────────────────────

/** tamanho_bucket do insumo: T se o insumo TEM tamanho proprio (formato != 'nenhum' E alguma variante com tamanho), senao NULL.
 *  Espelho de `_peca_teste_insumo_tam_bucket`. `formato` null = 'ambos' (nao 'nenhum'). trim = so espacos ASCII (btrim). */
export function tamanhoBucketInsumo(
  tamanho: string | null,
  formato: string | null,
  variantes: { tamanho: string | null }[],
): string | null {
  if (tamanho == null) return null;
  const temTamanhoProprio =
    (formato ?? "ambos") !== "nenhum" &&
    variantes.some((v) => v.tamanho != null && v.tamanho.replace(/^ +| +$/g, "") !== "");
  return temTamanhoProprio ? tamanho : null;
}

// ───────────────────────────── BOM para 1 peca ─────────────────────────────

export type AjusteLinha = {
  consumo?: number | null;
  loss_percent?: number | null;
  a_enviar?: number | null;
  variante_aviamento_id?: string | null;
  oc_tecido_item_id?: string | null;
};

export type BlocoTecido = {
  tipo: string;
  numero: number;
  consumo: number | null;
  loss_percent: number | null;
  /** variantes do bloco (ordem + multiplicador + casamento com o Tecido 1). */
  variantes: {
    ordem: number;
    variante_tecido_id: string | null;
    multiplicador: number | null;
    complementa_variante_ids: string[] | null;
    nome_variante?: string | null;
  }[];
};

export type LinhaAviamentoBom = {
  aviamento_id: string;
  numero: number | null;
  consumo: number | null;
  variante_aviamento_id: string | null;
  /** variantes do aviamento (para resolver a variante padrao pela cor de V e pela unica). */
  variantes: { variante_aviamento_id: string; cor_id: string | null; rotulo?: string | null }[];
  nome?: string | null;
};

export type LinhaInsumoBom = {
  etiqueta_id: string;
  cor_id: string | null;
  numero: number | null;
  consumo: number | null;
  /** valor CRU de `etiquetas.tamanho_vinculado` (a efetividade e resolvida aqui pela regra de insumo-tamanho, como `_insumo_tamanho_de`). */
  tamanho_vinculado: string | null;
  formato_tamanho: string | null;
  variantes_etiqueta: { tamanho: string | null }[];
  nome?: string | null;
};

export type ModeloBom = {
  /** blocos de tecido/forro/entretela; o Tecido 1 = (tipo 'tecido', numero 1). */
  tecidos: BlocoTecido[];
  aviamentos: LinhaAviamentoBom[];
  insumos: LinhaInsumoBom[];
  /** cor da variante V do Tecido 1 (para a variante padrao do aviamento); null se card sem Tecido 1 / V. */
  corDeV: string | null;
};

export type MiniLinha = {
  chave: string;
  familia: "tecido" | "aviamento" | "insumo";
  rotulo: string;
  variante_rotulo: string | null;
  unidade: "m" | "un";
  tipo: string | null;
  numero: number | null;
  ordem: number | null;
  variante_tecido_id: string | null;
  pecas: number;
  aviamento_id: string | null;
  variante_aviamento_id: string | null;
  etiqueta_id: string | null;
  cor_id: string | null;
  tamanho_bucket: string | null;
  consumo: number;
  loss_percent: number;
  necessaria: number;
  a_enviar: number;
  oc_tecido_item_id: string | null;
};

const num = (x: unknown): number => (x == null ? 0 : Number(x) || 0);

/** pecas (1 peca) de uma variante v de um bloco; espelha gradeEfetivaPar com grade {ordem N:1}, porVarianteT1 {V:1}. */
function pecasDaVariante(
  v: BlocoTecido["variantes"][number],
  isTecido1: boolean,
  ordemN: number | null,
  varianteV: string | null,
): number {
  const base = isTecido1
    ? (v.ordem === ordemN ? 1 : 0) // Tecido 1: so a variante de ordem N
    : (() => {
        const ids = (v.complementa_variante_ids ?? []).filter(Boolean);
        if (ids.length === 0) return v.ordem === ordemN ? 1 : 0; // complementar sem casamento
        return varianteV != null && ids.includes(varianteV) ? 1 : 0; // casada
      })();
  return base * (v.multiplicador == null ? 1 : Number(v.multiplicador) || 0);
}

/**
 * Linhas da mini para 1 peca. `ordemN` = ordem da variante escolhida V no Tecido 1; `varianteV` = id dela (null = card sem
 * Tecido 1 / sem V no BOM). `ajustes` = mapa chave -> AjusteLinha (NULL = segue o BOM). Espelho de `_peca_teste_mini_linhas`.
 */
export function linhasUmaPeca(
  bom: ModeloBom,
  tamanho: string | null,
  ordemN: number | null,
  varianteV: string | null,
  ajustes: Record<string, AjusteLinha>,
): MiniLinha[] {
  const out: MiniLinha[] = [];
  const aj = (chave: string): AjusteLinha => ajustes[chave] ?? {};

  // ── Tecido ──
  for (const b of bom.tecidos) {
    const isTecido1 = b.tipo === "tecido" && b.numero === 1;
    for (const v of b.variantes) {
      if (v.variante_tecido_id == null) continue;
      const pecas = pecasDaVariante(v, isTecido1, ordemN, varianteV);
      if (!(pecas > 0)) continue;
      const chave = chaveTecido(b.tipo, b.numero, v.ordem, v.variante_tecido_id);
      const a = aj(chave);
      const consumo = a.consumo != null ? Number(a.consumo) : num(b.consumo);
      const loss = a.loss_percent != null ? Number(a.loss_percent) : num(b.loss_percent);
      const necessaria = arredondar(pecas * consumo * (1 + loss / 100), 2);
      const aEnviar = a.a_enviar != null ? Number(a.a_enviar) : necessaria;
      out.push({
        chave, familia: "tecido",
        rotulo: b.tipo === "tecido" ? `Tecido ${b.numero}` : rotuloTipoTecido(b.tipo, b.numero),
        variante_rotulo: v.nome_variante ?? null,
        unidade: "m", tipo: b.tipo, numero: b.numero, ordem: v.ordem,
        variante_tecido_id: v.variante_tecido_id,
        pecas, aviamento_id: null, variante_aviamento_id: null, etiqueta_id: null, cor_id: null,
        tamanho_bucket: null, consumo, loss_percent: loss, necessaria,
        a_enviar: aEnviar, oc_tecido_item_id: a.oc_tecido_item_id ?? null,
      });
    }
  }

  // ── Aviamento ── (chave com k = contagem por aviamento na ordem numero)
  const kAvi = new Map<string, number>();
  const aviOrd = [...bom.aviamentos].sort(cmpNumero);
  for (const l of aviOrd) {
    const k = (kAvi.get(l.aviamento_id) ?? 0) + 1;
    kAvi.set(l.aviamento_id, k);
    const chave = chaveAviamento(l.aviamento_id, k);
    const a = aj(chave);
    const consumo = a.consumo != null ? Number(a.consumo) : num(l.consumo);
    const necessaria = arredondar(consumo * 1, 4);
    const aEnviar = a.a_enviar != null ? Number(a.a_enviar) : necessaria;
    const variante =
      a.variante_aviamento_id !== undefined
        ? a.variante_aviamento_id
        : variantePadraoAviamento(l, bom.corDeV);
    const rotVar = l.variantes.find((x) => x.variante_aviamento_id === variante)?.rotulo ?? null;
    out.push({
      chave, familia: "aviamento", rotulo: l.nome ?? "Aviamento",
      variante_rotulo: rotVar,
      unidade: "un", tipo: null, numero: l.numero ?? null, ordem: null, variante_tecido_id: null,
      pecas: 1, aviamento_id: l.aviamento_id, variante_aviamento_id: variante ?? null,
      etiqueta_id: null, cor_id: null, tamanho_bucket: null,
      consumo, loss_percent: 0, necessaria, a_enviar: aEnviar, oc_tecido_item_id: null,
    });
  }

  // ── Insumo ──
  const kIns = new Map<string, number>();
  const insOrd = [...bom.insumos].sort(cmpNumero);
  for (const l of insOrd) {
    const key = `${l.etiqueta_id}|${l.cor_id ?? "-"}`;
    const k = (kIns.get(key) ?? 0) + 1;
    kIns.set(key, k);
    const tam = tamanhoEfetivoInsumo({ // vinculo efetivo (espelho de _insumo_tamanho_de): so vale se o insumo nao tem tamanho proprio
      tamanho_vinculado: l.tamanho_vinculado, formato_tamanho: l.formato_tamanho, variantes: l.variantes_etiqueta,
    });
    if (tam != null && tam !== tamanho) continue; // insumo vinculado a OUTRO tamanho: fora desta peca
    const chave = chaveInsumo(l.etiqueta_id, l.cor_id, k);
    const a = aj(chave);
    const consumo = a.consumo != null ? Number(a.consumo) : num(l.consumo);
    const necessaria = arredondar(consumo * 1, 4);
    const aEnviar = a.a_enviar != null ? Number(a.a_enviar) : necessaria;
    const bucket = tamanhoBucketInsumo(tamanho, l.formato_tamanho, l.variantes_etiqueta);
    out.push({
      chave, familia: "insumo", rotulo: l.nome ?? "Insumo",
      variante_rotulo: null,
      unidade: "un", tipo: null, numero: l.numero ?? null, ordem: null, variante_tecido_id: null,
      pecas: 1, aviamento_id: null, variante_aviamento_id: null,
      etiqueta_id: l.etiqueta_id, cor_id: l.cor_id, tamanho_bucket: bucket,
      consumo, loss_percent: 0, necessaria, a_enviar: aEnviar, oc_tecido_item_id: null,
    });
  }

  return out;
}

function cmpNumero(a: { numero: number | null }, b: { numero: number | null }): number {
  return (a.numero ?? 0) - (b.numero ?? 0);
}

function rotuloTipoTecido(tipo: string, numero: number): string {
  if (tipo === "forro") return `Forro ${numero}`;
  if (tipo === "entretela") return `Entretela ${numero}`;
  return `${tipo} ${numero}`;
}

/** variante padrao do aviamento: a da cor de V (se unica) -> a do BOM -> a unica -> NULL. Card sem Tecido 1 pula o passo 1. */
export function variantePadraoAviamento(l: LinhaAviamentoBom, corDeV: string | null): string | null {
  if (corDeV != null) {
    const daCor = l.variantes.filter((v) => v.cor_id === corDeV);
    if (daCor.length === 1) return daCor[0].variante_aviamento_id;
  }
  if (l.variante_aviamento_id != null) return l.variante_aviamento_id;
  if (l.variantes.length === 1) return l.variantes[0].variante_aviamento_id;
  return null;
}

// ───────────────────────────── alocacao do tecido (regua do corte) ─────────────────────────────

export type OcLink = { oc_tecido_item_id: string; quantidade_m: number; prioridade: number };
export type OcLote = { oc_tecido_item_id: string; saldo: number };

export type FonteTecido = { oc_tecido_item_id: string; metros: number };

/**
 * Aloca `metros` para 1 variante, como `_baixar_estoque_tecido_corte_core`:
 *  - marcado + por_oc: vinculos por (prioridade, item) com teto quantidade_m (0 = restante), depois FIFO fora dos usados;
 *  - marcado + automatico: so FIFO;
 *  - desmarcado (itemEscolhido != null): SO esse item, sem fallback.
 * `fifo` ja vem na ordem do corte (data_entrega NULLS LAST, created_at). Saldos como saldo_oc_item_m (>0).
 * Retorna as fontes (so metros > 0) e o total baixado.
 */
export function alocarTecido(args: {
  modo: "por_oc" | "automatico";
  mesma_oc: boolean;
  itemEscolhido: string | null; // desmarcado: so esse item
  metros: number;
  vinculos: OcLink[];
  fifo: OcLote[]; // saldo por item, ja ordenado FIFO
}): { baixado: number; fontes: FonteTecido[] } {
  const fontes: FonteTecido[] = [];
  let restante = num(args.metros);
  if (!(restante > 0)) return { baixado: 0, fontes };

  // desmarcado: so o item escolhido (saldo do fifo), sem fallback.
  if (!args.mesma_oc) {
    if (args.itemEscolhido == null) return { baixado: 0, fontes };
    const saldo = num(args.fifo.find((f) => f.oc_tecido_item_id === args.itemEscolhido)?.saldo);
    const usar = Math.min(restante, saldo);
    if (usar > 0) fontes.push({ oc_tecido_item_id: args.itemEscolhido, metros: usar });
    return { baixado: somaFontes(fontes), fontes };
  }

  const usados = new Set<string>();

  // fase 1: vinculos (so por_oc), por (prioridade, item).
  if (args.modo === "por_oc") {
    const vinc = [...args.vinculos].sort(
      (a, b) => a.prioridade - b.prioridade || cmpStr(a.oc_tecido_item_id, b.oc_tecido_item_id),
    );
    for (const vl of vinc) {
      if (restante <= 0) break;
      usados.add(vl.oc_tecido_item_id); // marcado como usado MESMO com saldo 0 (igual ao corte)
      const saldo = num(args.fifo.find((f) => f.oc_tecido_item_id === vl.oc_tecido_item_id)?.saldo);
      if (saldo <= 0) continue;
      const limite = vl.quantidade_m > 0 ? vl.quantidade_m : restante;
      const usar = Math.min(restante, saldo, limite);
      if (usar <= 0) continue;
      fontes.push({ oc_tecido_item_id: vl.oc_tecido_item_id, metros: usar });
      restante -= usar;
    }
  }

  // fase 2: FIFO fora dos usados.
  if (restante > 0) {
    for (const lote of args.fifo) {
      if (restante <= 0) break;
      if (usados.has(lote.oc_tecido_item_id)) continue;
      const saldo = num(lote.saldo);
      if (saldo <= 0) continue;
      const usar = Math.min(restante, saldo);
      fontes.push({ oc_tecido_item_id: lote.oc_tecido_item_id, metros: usar });
      restante -= usar;
    }
  }

  return { baixado: somaFontes(fontes), fontes };
}

function somaFontes(fontes: FonteTecido[]): number {
  return fontes.reduce((s, f) => s + f.metros, 0);
}
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ───────────────────────────── predicado da R12 ─────────────────────────────

export type TentativaMini = {
  numero: number;
  /** a mini da tentativa tem baixa ATIVA (baixa_em nao nulo). null/false = sem baixa / sem mini. */
  baixa_ativa: boolean;
};

/**
 * `_peca_teste_mini_feita`: a tentativa ATUAL da trilha (maior numero) tem baixa ativa. Trilha virtual/reprovada sem a
 * proxima = false. Espelho de `_peca_teste_mini_feita(_mo_linha_id, _categoria_id)`.
 */
export function miniExplosaoFeita(trilha: readonly TentativaMini[]): boolean {
  if (trilha.length === 0) return false;
  let atual: TentativaMini | null = null;
  for (const t of trilha) if (atual == null || t.numero > atual.numero) atual = t;
  return !!atual && atual.baixa_ativa === true;
}
