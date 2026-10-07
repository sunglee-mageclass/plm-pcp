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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// T5 (front) — ESTADO da mini na tentativa: tipos, leitura do servidor, igualdade, herança, travas, ação do Salvar, payload, ↺ e
// resumo pós-Salvar. Tudo PURO. NÃO muda o cálculo acima (linhasUmaPeca/alocarTecido são o espelho da SQL). A mini mora em
// `TentativaPT.mini` (src/lib/peca-teste.ts): `null` = tentativa sem cabeçalho (nada escolhido). O servidor (`salvar_peca_teste`,
// 199400) é a fonte da verdade; aqui só prevemos o que a tela precisa mostrar/mandar.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** FOTO de uma linha na hora da baixa (o que saiu do estoque). Só existe com baixa ativa OU tentativa histórica com baixa. */
export type MiniFoto = {
  rotulo: string | null;
  variante: string | null;
  unidade: "m" | "un" | null;
  consumo: number | null;
  loss_percent: number | null;
  necessaria: number | null;
  a_enviar: number | null;
  baixado: number | null;
  faltou: number | null;
  fontes: { oc_tecido_item_id: string | null; rotulo: string | null; metros: number }[];
};

/** Ajuste de UMA linha da mini (`null` = segue o BOM / o calculado) + a foto da baixa quando houver. */
export type MiniAjuste = {
  chave: string;
  familia: "tecido" | "aviamento" | "insumo";
  consumo: number | null;
  loss_percent: number | null;
  a_enviar: number | null;
  variante_aviamento_id: string | null;
  oc_tecido_item_id: string | null;
  foto?: MiniFoto | null;
};

/** Mini explosão (1 peça) de uma tentativa, como a seção a vê. `baixa_em` NOT NULL = baixa ATIVA (trava a mini). */
export type MiniPT = {
  tamanho: string | null;
  /** "cor da peça" = variante do Tecido 1. */
  variante_tecido_id: string | null;
  mesma_oc: boolean;
  baixa_em: string | null;
  baixa_por_nome: string | null;
  /** já houve baixa nesta tentativa (ativa ou estornada/histórica): impede apagar a tentativa vazia. */
  tem_historico: boolean;
  linhas: MiniAjuste[];
};

const strOuNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function fotoDoServidor(raw: any): MiniFoto | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    rotulo: strOuNull(raw.rotulo),
    variante: strOuNull(raw.variante),
    unidade: raw.unidade === "m" || raw.unidade === "un" ? raw.unidade : null,
    consumo: numOuNull(raw.consumo),
    loss_percent: numOuNull(raw.loss_percent),
    necessaria: numOuNull(raw.necessaria),
    a_enviar: numOuNull(raw.a_enviar),
    baixado: numOuNull(raw.baixado),
    faltou: numOuNull(raw.faltou),
    fontes: (Array.isArray(raw.fontes) ? raw.fontes : []).map((f: any) => ({
      oc_tecido_item_id: strOuNull(f?.oc_tecido_item_id),
      rotulo: strOuNull(f?.rotulo),
      metros: Number(f?.metros ?? 0) || 0,
    })),
  };
}

/** Lê o jsonb `mini` de uma tentativa de `peca_teste_modelo` (tolerante: null/forma estranha = null). */
export function miniDoServidor(raw: unknown): MiniPT | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, any>;
  return {
    tamanho: strOuNull(r.tamanho),
    variante_tecido_id: strOuNull(r.variante_tecido_id),
    mesma_oc: r.mesma_oc === false ? false : true,
    baixa_em: strOuNull(r.baixa_em),
    baixa_por_nome: strOuNull(r.baixa_por_nome),
    tem_historico: r.tem_historico === true,
    linhas: (Array.isArray(r.linhas) ? r.linhas : [])
      .filter((l: any) => l && typeof l.chave === "string" && l.chave !== "")
      .map((l: any): MiniAjuste => {
        const foto = fotoDoServidor(l.foto);
        return {
          chave: l.chave,
          familia: l.familia === "aviamento" || l.familia === "insumo" ? l.familia : "tecido",
          consumo: numOuNull(l.consumo),
          loss_percent: numOuNull(l.loss_percent),
          a_enviar: numOuNull(l.a_enviar),
          variante_aviamento_id: strOuNull(l.variante_aviamento_id),
          oc_tecido_item_id: strOuNull(l.oc_tecido_item_id),
          ...(foto ? { foto } : {}),
        };
      }),
  };
}

const temAjuste = (l: MiniAjuste): boolean =>
  l.consumo !== null || l.loss_percent !== null || l.a_enviar !== null || l.variante_aviamento_id !== null || l.oc_tecido_item_id !== null;

/** Só as linhas que TÊM algum ajuste (o servidor só guarda estas), em ordem de chave. */
export function ajustesDe(m: MiniPT | null | undefined): MiniAjuste[] {
  return (m?.linhas ?? []).filter(temAjuste).sort((a, b) => cmpStr(a.chave, b.chave));
}

/** Mini "sem dado": nada escolhido, "mesma OC" no padrão, nenhum ajuste e sem baixa. `null` também é vazia. */
export function miniVazia(m: MiniPT | null | undefined): boolean {
  return !m || (m.tamanho === null && m.variante_tecido_id === null && m.mesma_oc === true && m.baixa_em === null && !m.tem_historico && ajustesDe(m).length === 0);
}

const q4 = (n: number | null): number | null => (n === null ? null : arredondar(n, 4));

/** Igualdade do que o USUÁRIO controla (cabeçalho + ajustes). Ignora a foto, a baixa e o histórico — esses são do servidor.
 *  `null` e mini vazia são iguais (o servidor só tem cabeçalho quando há dado). */
export function miniIgual(a: MiniPT | null | undefined, b: MiniPT | null | undefined): boolean {
  const x = a ?? miniNova(), y = b ?? miniNova();
  if (x.tamanho !== y.tamanho || x.variante_tecido_id !== y.variante_tecido_id || x.mesma_oc !== y.mesma_oc) return false;
  const aa = ajustesDe(x), bb = ajustesDe(y);
  if (aa.length !== bb.length) return false;
  return aa.every((p, i) => {
    const q = bb[i];
    return p.chave === q.chave && q4(p.consumo) === q4(q.consumo) && p.loss_percent === q.loss_percent && q4(p.a_enviar) === q4(q.a_enviar)
      && p.variante_aviamento_id === q.variante_aviamento_id && p.oc_tecido_item_id === q.oc_tecido_item_id;
  });
}

/** Mini vazia COM mesma_oc padrão — ponto de partida para editar uma tentativa que ainda não tem mini. */
export function miniNova(): MiniPT {
  return { tamanho: null, variante_tecido_id: null, mesma_oc: true, baixa_em: null, baixa_por_nome: null, tem_historico: false, linhas: [] };
}

/** Herança da nova tentativa depois de uma reprova (P-347): tamanho, cor, "mesma OC" e o item de OC/rolo escolhido de cada linha.
 *  NÃO herda consumo, % loss, "a enviar" nem variante de aviamento, nem foto/baixa. Sem nada a herdar = `null`. */
export function herdarMini(anterior: MiniPT | null | undefined): MiniPT | null {
  if (!anterior) return null;
  const linhas: MiniAjuste[] = ajustesDe(anterior)
    .filter((l) => l.oc_tecido_item_id !== null)
    .map((l) => ({ chave: l.chave, familia: l.familia, consumo: null, loss_percent: null, a_enviar: null, variante_aviamento_id: null, oc_tecido_item_id: l.oc_tecido_item_id }));
  const herdada: MiniPT = {
    tamanho: anterior.tamanho, variante_tecido_id: anterior.variante_tecido_id, mesma_oc: anterior.mesma_oc,
    baixa_em: null, baixa_por_nome: null, tem_historico: false, linhas,
  };
  return miniVazia(herdada) ? null : herdada;
}

/** Visão mínima da tentativa que as regras da mini precisam (evita ciclo com `peca-teste.ts`). */
export type TentativaDaMini = { data_saida: string | null; aprovacao: "aprovado" | "reprovado" | null; mini: MiniPT | null };

/** A mini está TRAVADA (sem inputs): baixa salva E Data de saída no rascunho, ou a tentativa já foi decidida (aprovada trava; reprovada é
 *  histórico). `base` = a tentativa como o SERVIDOR a tem (decisão SALVA — decidir só no rascunho ainda não trava, como no servidor). */
export function miniTravada(draft: TentativaDaMini, base: TentativaDaMini | null | undefined): boolean {
  if (base && base.aprovacao !== null) return true;
  return !!base?.mini?.baixa_em && !!draft.data_saida;
}

export type AcaoNoSalvar = "baixa" | "estorno" | "estorno_e_baixa" | "sem_baixa_falta_tamanho_cor";

/** Tamanho escolhido e (cor escolhida OU card sem Tecido 1): condição do servidor para baixar. */
export function miniPronta(m: MiniPT | null | undefined, semTecido1 = false): boolean {
  return !!m && m.tamanho !== null && (m.variante_tecido_id !== null || semTecido1);
}

/** O que o Salvar fará nesta tentativa (espelho da máquina de estados de `_peca_teste_mini_aplicar`). `semTecido1` = o card não tem Tecido 1
 *  (só o tamanho é exigido). Aprovada/reprovada (decisão SALVA) = mini imutável = `null`. */
export function acaoNoSalvar(draft: TentativaDaMini, base: TentativaDaMini | null | undefined, opts: { semTecido1?: boolean } = {}): AcaoNoSalvar | null {
  if (base && base.aprovacao !== null) return null;
  const pronta = miniPronta(draft.mini, opts.semTecido1);
  if (base?.mini?.baixa_em) {
    if (!draft.data_saida) return "estorno";
    if (!miniIgual(draft.mini, base.mini)) return pronta ? "estorno_e_baixa" : "estorno";
    return null;
  }
  if (!draft.data_saida) return null;
  return pronta ? "baixa" : "sem_baixa_falta_tamanho_cor";
}

/** `confere` do Salvar: o "a enviar" EFETIVO que a pessoa VIU por chave, com 4 casas (o servidor recusa com P0409 se divergir). */
export function confereDasLinhas(linhas: readonly { chave: string; a_enviar: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of linhas) out[l.chave] = arredondar(num(l.a_enviar), 4);
  return out;
}

/** Trocar o tamanho OU a cor refaz o pré-preenchimento a partir do BOM: zera TODOS os ajustes e mantém "mesma OC". */
export function trocarTamanhoOuCor(mini: MiniPT | null | undefined, patch: { tamanho?: string | null; variante_tecido_id?: string | null }): MiniPT {
  const m = mini ?? miniNova();
  return {
    ...m,
    tamanho: patch.tamanho !== undefined ? patch.tamanho || null : m.tamanho,
    variante_tecido_id: patch.variante_tecido_id !== undefined ? patch.variante_tecido_id || null : m.variante_tecido_id,
    linhas: [],
  };
}

export type CampoAjuste = "consumo" | "loss_percent" | "a_enviar" | "variante_aviamento_id" | "oc_tecido_item_id";

/** Grava o ajuste de UMA linha (cria a linha se ainda não existe; linha que volta a não ter nenhum ajuste sai). `null` = volta a seguir o BOM. */
export function ajustarLinha(mini: MiniPT | null | undefined, chave: string, familia: MiniAjuste["familia"], patch: Partial<Pick<MiniAjuste, CampoAjuste>>): MiniPT {
  const m = mini ?? miniNova();
  const atual = m.linhas.find((l) => l.chave === chave);
  const novo: MiniAjuste = { chave, familia, consumo: null, loss_percent: null, a_enviar: null, variante_aviamento_id: null, oc_tecido_item_id: null, ...atual, ...patch };
  const resto = m.linhas.filter((l) => l.chave !== chave);
  return { ...m, linhas: temAjuste(novo) ? [...resto, novo] : resto };
}

/** ↺ "voltar ao calculado": tira o ajuste do(s) campo(s) da linha (por padrão só o "a enviar"). */
export function voltarAoCalculado(mini: MiniPT | null | undefined, chave: string, campos: readonly CampoAjuste[] = ["a_enviar"]): MiniPT {
  const m = mini ?? miniNova();
  const atual = m.linhas.find((l) => l.chave === chave);
  if (!atual) return m;
  const patch: Partial<Record<CampoAjuste, null>> = {};
  for (const c of campos) patch[c] = null;
  return ajustarLinha(m, chave, atual.familia, patch);
}

/** Formato da chave `mini` de `salvar_peca_teste` (por tentativa). `confere` só quando o Salvar fará a baixa. */
export type MiniPayload = {
  tamanho: string | null;
  variante_tecido_id: string | null;
  mesma_oc: boolean;
  ajustes: {
    chave: string;
    familia: MiniAjuste["familia"];
    consumo: number | null;
    loss_percent: number | null;
    a_enviar: number | null;
    variante_aviamento_id: string | null;
    oc_tecido_item_id: string | null;
  }[];
  confere?: Record<string, number>;
};

export function miniParaPayload(m: MiniPT | null | undefined, confere?: Record<string, number> | null): MiniPayload {
  const mini = m ?? miniNova();
  return {
    tamanho: mini.tamanho,
    variante_tecido_id: mini.variante_tecido_id,
    mesma_oc: mini.mesma_oc,
    ajustes: ajustesDe(mini).map((l) => ({
      chave: l.chave, familia: l.familia, consumo: l.consumo, loss_percent: l.loss_percent, a_enviar: l.a_enviar,
      variante_aviamento_id: l.variante_aviamento_id, oc_tecido_item_id: l.oc_tecido_item_id,
    })),
    ...(confere ? { confere } : {}),
  };
}

/** Texto curto da mini para o rótulo de conflito do merge ("Tam. M · cor … · 2 ajustes"). */
export function resumoMini(m: MiniPT | null | undefined): string {
  if (!m || (m.tamanho === null && m.variante_tecido_id === null && ajustesDe(m).length === 0)) return "—";
  const partes: string[] = [];
  if (m.tamanho !== null) partes.push(`Tam. ${m.tamanho.includes("|") ? m.tamanho.split("|")[1] : m.tamanho}`);
  if (m.variante_tecido_id !== null) partes.push("cor escolhida");
  const n = ajustesDe(m).length;
  if (n > 0) partes.push(`${n} ${n === 1 ? "ajuste" : "ajustes"}`);
  if (!m.mesma_oc) partes.push("OC escolhida à mão");
  return partes.join(" · ") || "—";
}

// ───────────────────────────── prévia de FALTA (sem gravar) ─────────────────────────────

export type EstoqueMini = {
  modo: "por_oc" | "automatico";
  tecidos: {
    tipo: string; numero: number; ordem: number; variante_tecido_id: string;
    vinculos: { oc_tecido_item_id: string; rotulo: string | null; is_rolo: boolean; prioridade: number; quantidade_m: number; saldo: number }[];
    fifo: { oc_tecido_item_id: string; rotulo: string | null; is_rolo: boolean; saldo: number }[];
  }[];
  aviamentos: { aviamento_id: string; variantes: { variante_aviamento_id: string | null; rotulo: string | null; cor_id: string | null; fisico: number }[] }[];
  insumos: { etiqueta_id: string; tamanho: string | null; cor_id: string | null; fisico: number }[];
};

/** Lê o jsonb de `peca_teste_mini_estoque` (`null` = sem permissão / loja sem Entrada e Saída / outro tenant). */
export function estoqueMiniDoServidor(raw: unknown): EstoqueMini | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);
  return {
    modo: r.modo === "automatico" ? "automatico" : "por_oc",
    tecidos: arr(r.tecidos).map((t) => ({
      tipo: String(t.tipo), numero: Number(t.numero), ordem: Number(t.ordem), variante_tecido_id: String(t.variante_tecido_id),
      vinculos: arr(t.vinculos).map((v) => ({
        oc_tecido_item_id: String(v.oc_tecido_item_id), rotulo: strOuNull(v.rotulo), is_rolo: v.is_rolo === true,
        prioridade: Number(v.prioridade ?? 0), quantidade_m: num(v.quantidade_m), saldo: num(v.saldo),
      })),
      fifo: arr(t.fifo).map((f) => ({ oc_tecido_item_id: String(f.oc_tecido_item_id), rotulo: strOuNull(f.rotulo), is_rolo: f.is_rolo === true, saldo: num(f.saldo) })),
    })),
    aviamentos: arr(r.aviamentos).map((a) => ({
      aviamento_id: String(a.aviamento_id),
      variantes: arr(a.variantes).map((v) => ({ variante_aviamento_id: strOuNull(v.variante_aviamento_id), rotulo: strOuNull(v.rotulo), cor_id: strOuNull(v.cor_id), fisico: num(v.fisico) })),
    })),
    insumos: arr(r.insumos).map((i) => ({ etiqueta_id: String(i.etiqueta_id), tamanho: strOuNull(i.tamanho), cor_id: strOuNull(i.cor_id), fisico: num(i.fisico) })),
  };
}

export type FaltaPreview = { chave: string; familia: MiniLinha["familia"]; rotulo: string; unidade: "m" | "un"; faltou: number };

/**
 * Prévia (SÓ leitura) do "faltou" que o Salvar vai registrar: baixa o que há e sobra a falta (Ruling 4), como o servidor. Linhas processadas
 * NA ORDEM dada (a mesma da baixa): o que uma linha consome já não está disponível para a seguinte. Tecido usa `alocarTecido` (régua do
 * corte). Insumo/aviamento sem leitura de estoque para o bucket = sem prévia (não afirma falta que não conhece; o servidor registra a real).
 */
export function faltasPreview(linhas: readonly MiniLinha[], estoque: EstoqueMini | null | undefined, modo?: "por_oc" | "automatico", mesmaOc = true): FaltaPreview[] {
  if (!estoque) return [];
  const m = modo ?? estoque.modo;
  const gasto = new Map<string, number>(); // item de OC / bucket de aviamento / bucket de insumo -> já consumido nesta prévia
  const out: FaltaPreview[] = [];
  for (const l of linhas) {
    const quer = num(l.a_enviar);
    if (!(quer > 0)) continue;
    let baixado = 0;
    if (l.familia === "tecido") {
      const t = estoque.tecidos.find((x) => x.tipo === l.tipo && x.numero === l.numero && x.ordem === l.ordem && x.variante_tecido_id === l.variante_tecido_id);
      if (t) {
        const livre = (id: string, saldo: number) => Math.max(0, saldo - (gasto.get(`t:${id}`) ?? 0));
        const r = alocarTecido({
          modo: m, mesma_oc: mesmaOc, itemEscolhido: l.oc_tecido_item_id, metros: quer,
          vinculos: t.vinculos.map((v) => ({ oc_tecido_item_id: v.oc_tecido_item_id, quantidade_m: v.quantidade_m, prioridade: v.prioridade })),
          fifo: t.fifo.map((f) => ({ oc_tecido_item_id: f.oc_tecido_item_id, saldo: livre(f.oc_tecido_item_id, f.saldo) })),
        });
        for (const f of r.fontes) gasto.set(`t:${f.oc_tecido_item_id}`, (gasto.get(`t:${f.oc_tecido_item_id}`) ?? 0) + f.metros);
        baixado = r.baixado;
      }
    } else if (l.familia === "aviamento") {
      const v = estoque.aviamentos.find((a) => a.aviamento_id === l.aviamento_id)?.variantes.find((x) => x.variante_aviamento_id === l.variante_aviamento_id);
      if (!v) continue;
      const k = `a:${l.aviamento_id}:${l.variante_aviamento_id ?? "-"}`;
      baixado = Math.min(quer, Math.max(0, v.fisico - (gasto.get(k) ?? 0)));
      gasto.set(k, (gasto.get(k) ?? 0) + baixado);
    } else {
      const i = estoque.insumos.find((x) => x.etiqueta_id === l.etiqueta_id && x.cor_id === l.cor_id && x.tamanho === l.tamanho_bucket);
      if (!i) continue;
      const k = `i:${l.etiqueta_id}:${l.tamanho_bucket ?? "-"}:${l.cor_id ?? "-"}`;
      baixado = Math.min(quer, Math.max(0, i.fisico - (gasto.get(k) ?? 0)));
      gasto.set(k, (gasto.get(k) ?? 0) + baixado);
    }
    const faltou = arredondar(quer - baixado, 4);
    if (faltou > 0) out.push({ chave: l.chave, familia: l.familia, rotulo: l.rotulo, unidade: l.unidade, faltou });
  }
  return out;
}

// ───────────────────────────── resumo pós-Salvar (toasts) ─────────────────────────────

/** Estado mínimo de uma trilha para o resumo (subconjunto de `TrilhaPT`). */
export type TrilhaDoResumo = {
  mo_linha_id: string;
  categoria_nome: string;
  tentativas: { numero: number; data_saida: string | null; aprovacao: "aprovado" | "reprovado" | null; mini: MiniPT | null }[];
};
export type ResumoPosSalvar = { baixas: string[]; estornos: string[]; faltas: string[]; semTamanhoCor: string[] };

function qtdFrase(n: number, un: string | null): string {
  const s = String(arredondar(n, 4)).replace(".", ",");
  return un === "m" ? `${s} m` : un === "un" ? `${s} un` : s;
}

/** Compara o estado de ANTES e o RELIDO DEPOIS do Salvar (por linha de M.O. + nº da tentativa) e lista o que aconteceu, para os toasts.
 *  Item = "<serviço> · tentativa N"; falta = "<serviço> · <linha> <qtd>". */
export function resumoPosSalvar(antes: readonly TrilhaDoResumo[], depois: readonly TrilhaDoResumo[], opts: { semTecido1?: boolean } = {}): ResumoPosSalvar {
  const out: ResumoPosSalvar = { baixas: [], estornos: [], faltas: [], semTamanhoCor: [] };
  for (const d of depois) {
    const a = antes.find((x) => x.mo_linha_id === d.mo_linha_id);
    for (const td of [...d.tentativas].sort((x, y) => x.numero - y.numero)) {
      const ta = a?.tentativas.find((x) => x.numero === td.numero);
      const nome = `${d.categoria_nome} · tentativa ${td.numero}`;
      const baixouAntes = !!ta?.mini?.baixa_em, baixaAgora = !!td.mini?.baixa_em;
      if (!baixouAntes && baixaAgora) {
        out.baixas.push(nome);
        for (const l of td.mini?.linhas ?? []) {
          const f = l.foto;
          if (f && (f.faltou ?? 0) > 0) out.faltas.push(`${d.categoria_nome} · ${f.rotulo ?? "item"}${f.variante ? ` ${f.variante}` : ""} ${qtdFrase(f.faltou as number, f.unidade)}`);
        }
      } else if (baixouAntes && !baixaAgora) {
        out.estornos.push(nome);
      } else if (!baixaAgora && td.data_saida && td.aprovacao === null && !miniPronta(td.mini, opts.semTecido1)) {
        // data de saída preenchida e sem tamanho/cor: só avisa quando ESTE Salvar mexeu na tentativa (data ou mini)
        const mexeu = !ta || ta.data_saida !== td.data_saida || !miniIgual(ta.mini, td.mini);
        if (mexeu) out.semTamanhoCor.push(nome);
      }
    }
  }
  return out;
}
