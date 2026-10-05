// Casos COMPARTILHADOS do anti-drift do CUSTO PREVISTO do BOM (contas certas C1 — migration 20261019300000; R-CD4/R-CD6):
//   tests/unit/custo-bom-antidrift.test.ts            → recomputeBlock/recomputeAviamento/recomputeEtiqueta/
//                                                        somaCustosAdicionais/pecaCom (TS, a prévia ao vivo do Sheet)
//   tests/integration/custo-previsto-servidor.test.ts → public._custo_linha/_custo_preco_tecido/_custo_preco_etiqueta/
//                                                        _custo_adicionais_soma/_custo_calcular (SQL, o que o servidor GRAVA)
// `esperado` = o valor EXATO do SQL (numeric). O TS (ponto flutuante) pode divergir até TOLERANCIA por linha (R-CD4: vale o
// servidor; o caso documentado é MEIO_CENTAVO). Toda entrada é serializável em JSON. Mudou a regra? Mude TS, SQL e AQUI.

/** R-CD4: |TS − SQL| aceito por linha/total. */
export const TOLERANCIA = 0.01;

export type ArtigoCaso = { unidade: "metro" | "kg"; preco: number | null; rendimento: number | null };

/** preco_por_metro como o gatilho `artigos_recalc_preco` DERIVA (kg com rendimento > 0 → preco/rendimento; metro → preco;
 *  kg sem rendimento → fica o que foi inserido: NULL nas fixtures). */
export function precoPorMetro(a: ArtigoCaso): number | null {
  if (a.unidade === "kg" && (a.rendimento ?? 0) > 0) return a.preco == null ? null : a.preco / (a.rendimento as number);
  if (a.unidade === "metro") return a.preco;
  return null;
}

export type CasoTecido = {
  nome: string;
  tipo: "tecido" | "forro" | "entretela";
  numero: number;
  consumo: number;
  /** loss_percent (%). */
  perda: number;
  /** artigo da linha (modelo_tecidos.artigo_id). */
  artigo: ArtigoCaso;
  /** artigos das variantes da linha (modelo_tecido_variantes → variantes_tecido.artigo_id): o preço é o MAIOR deles. */
  substitutos: ArtigoCaso[];
  /** item de OC vinculado ao (tipo, numero) — congela o preço (kg ÷ rendimento do artigo da variante do vínculo). */
  oc: { preco: number | null; cancelado: boolean; artigo: ArtigoCaso } | null;
  esperado: number;
};

const metro = (preco: number | null): ArtigoCaso => ({ unidade: "metro", preco, rendimento: null });
const kg = (preco: number | null, rendimento: number | null): ArtigoCaso => ({ unidade: "kg", preco, rendimento });

export const CASOS_TECIDO: CasoTecido[] = [
  { nome: "artigo da linha (metro)", tipo: "tecido", numero: 1, consumo: 1.35, perda: 3,
    artigo: metro(18.9), substitutos: [], oc: null, esperado: 26.28 }, // 18,90 × 1,35 × 1,03 = 26,28045
  { nome: "substitutos: o MAIOR preço das variantes (o artigo da linha não entra)", tipo: "tecido", numero: 2, consumo: 1.2, perda: 5,
    artigo: metro(10), substitutos: [metro(12.5), metro(9)], oc: null, esperado: 15.75 },
  { nome: "OC vinculada em kg com rendimento (congela; ignora o artigo)", tipo: "tecido", numero: 1, consumo: 2, perda: 0,
    artigo: kg(60, 4), substitutos: [], oc: { preco: 72, cancelado: false, artigo: kg(60, 4) }, esperado: 36 }, // 72 ÷ 4 × 2
  { nome: "OC vinculada em metro (ISABEL-like)", tipo: "tecido", numero: 1, consumo: 3.65, perda: 5,
    artigo: metro(9.5), substitutos: [], oc: { preco: 8.9, cancelado: false, artigo: metro(9.5) }, esperado: 34.11 }, // 34,10925
  { nome: "OC cancelada não congela (cai no artigo)", tipo: "tecido", numero: 1, consumo: 1, perda: 0,
    artigo: metro(11), substitutos: [], oc: { preco: 99, cancelado: true, artigo: metro(11) }, esperado: 11 },
  { nome: "OC sem preço não congela (cai no artigo)", tipo: "tecido", numero: 1, consumo: 2, perda: 0,
    artigo: metro(7.25), substitutos: [], oc: { preco: null, cancelado: false, artigo: metro(7.25) }, esperado: 14.5 },
  { nome: "artigo sem preço = 0", tipo: "tecido", numero: 1, consumo: 2, perda: 10,
    artigo: metro(null), substitutos: [], oc: null, esperado: 0 },
  { nome: "entretela em kg sem rendimento: usa o preço cheio", tipo: "entretela", numero: 1, consumo: 0.4, perda: 0,
    artigo: kg(50, null), substitutos: [], oc: null, esperado: 20 },
  { nome: "forro (metro)", tipo: "forro", numero: 1, consumo: 0.8, perda: 0,
    artigo: metro(7.5), substitutos: [], oc: null, esperado: 6 },
];

export type CasoAviamento = { nome: string; preco: number | null; consumo: number; perda: number; esperado: number };
export const CASOS_AVIAMENTO: CasoAviamento[] = [
  { nome: "aviamento com perda", preco: 0.35, consumo: 4, perda: 10, esperado: 1.54 },
  { nome: "aviamento sem preço = 0", preco: null, consumo: 3, perda: 0, esperado: 0 },
  { nome: "aviamento sem perda", preco: 2.2, consumo: 1.5, perda: 0, esperado: 3.3 },
];

/** "X"/"Y" = duas cores de teste; null = sem cor. */
export type CorCaso = "X" | "Y" | null;
export type CasoEtiqueta = {
  nome: string;
  /** modelo_etiquetas.cor_id */
  cor: CorCaso;
  variantes: { cor: CorCaso; preco: number | null }[];
  /** etiquetas.preco (gravado DEPOIS das variantes — o gatilho variantes_etiqueta_sync_preco o sobrescreve com o MAX). */
  precoBase: number | null;
  consumo: number;
  perda: number;
  esperado: number;
};
export const CASOS_ETIQUETA: CasoEtiqueta[] = [
  { nome: "com cor: MAX das variantes DA COR", cor: "X",
    variantes: [{ cor: "X", preco: 0.2 }, { cor: "X", preco: 0.25 }, { cor: "Y", preco: 0.4 }], precoBase: 0.4,
    consumo: 2, perda: 0, esperado: 0.5 },
  { nome: "sem cor e sem variante sem cor: preço base", cor: null,
    variantes: [{ cor: "X", preco: 0.2 }, { cor: "X", preco: 0.25 }], precoBase: 0.25, consumo: 3, perda: 0, esperado: 0.75 },
  { nome: "variante da cor sem preço: preço base", cor: "X",
    variantes: [{ cor: "X", preco: null }], precoBase: 0.3, consumo: 1, perda: 50, esperado: 0.45 },
  { nome: "variante da cor com preço NEGATIVO é ignorada (G-scripts L4): preço base", cor: "X",
    variantes: [{ cor: "X", preco: -0.5 }], precoBase: 0.3, consumo: 2, perda: 0, esperado: 0.6 },
  { nome: "sem cor casa com a variante sem cor", cor: null,
    variantes: [{ cor: null, preco: 0.15 }, { cor: "X", preco: 0.9 }], precoBase: 0.9, consumo: 4, perda: 0, esperado: 0.6 },
];

/** R-CD6 — `custos_adicionais` com lixo. O caso booleano (TS: Number(true)=1; SQL: 0) fica FORA (documentado no plano). */
export const CASOS_ADICIONAIS: { nome: string; custos: unknown; esperado: number }[] = [
  { nome: "número", custos: [{ descricao: "a", valor: 1.5 }], esperado: 1.5 },
  { nome: "string numérica", custos: [{ descricao: "b", valor: "2.25" }], esperado: 2.25 },
  { nome: "string numérica com espaços", custos: [{ valor: " 3 " }], esperado: 3 },
  { nome: "string com expoente", custos: [{ valor: "1e1" }], esperado: 10 },
  { nome: "string vazia", custos: [{ valor: "" }], esperado: 0 },
  { nome: "texto", custos: [{ valor: "abc" }], esperado: 0 },
  { nome: "null", custos: [{ valor: null }], esperado: 0 },
  { nome: "sem a chave valor", custos: [{ descricao: "sem valor" }], esperado: 0 },
  { nome: "não é array", custos: { valor: 5 }, esperado: 0 },
  { nome: "null inteiro", custos: null, esperado: 0 },
  { nome: "misto", custos: [{ valor: 1.5 }, { valor: "2.25" }, { valor: "abc" }, { valor: null }], esperado: 3.75 },
];

/** R-CD4 — meio centavo: preço 1,005 × 1 × 1. SQL (numeric) 1,01; TS (float: 100,49999…) 1,00 — dentro da tolerância. */
export const MEIO_CENTAVO = { preco: 1.005, consumo: 1, perda: 0, sql: 1.01, ts: 1.0 };

/** Um card inteiro: soma na ordem de pecaCom (tecido + forro + entretela + aviamento + etiqueta + M.O. + adicionais). */
export const CASO_MODELO = {
  tecidos: [CASOS_TECIDO[0], CASOS_TECIDO[1], CASOS_TECIDO[8], CASOS_TECIDO[7]], // tecido 1, tecido 2, forro 1, entretela 1
  aviamentos: [CASOS_AVIAMENTO[0]],
  etiquetas: [CASOS_ETIQUETA[0]],
  /** M.O. multi-instância (2 linhas de modelo_servico_mo). */
  maoObra: [12.3, 7.7],
  adicionais: CASOS_ADICIONAIS[CASOS_ADICIONAIS.length - 1].custos,
  esperado: { tecido: 42.03, forro: 6, entretela: 20, aviamento: 1.54, etiqueta: 0.5, mao_obra: 20, adicionais: 3.75, peca: 93.82 },
};

/**
 * urg R1 (migration 20261103171000, Ruling A3) — insumo vinculado a UM tamanho: o custo POR PECA da linha e rateado,
 * preco x consumo x fator x (1 + perda/100), fator = pecas do tamanho / grade total do modelo (`_insumo_fator_custo`, espelho
 * TS `fatorCustoInsumo` de src/lib/insumo-tamanho.ts). Sem vinculo, grade vazia ou insumo com tamanho proprio (variante com
 * tamanho: o vinculo e ignorado, Ruling A2) => fator 1 = o valor de hoje; tamanho fora da grade => 0. O SQL faz
 * `_custo_linha(preco, consumo * fator, perda)` = round(preco x consumo x fator x (1 + perda/100), 2). `esperado` = o SQL exato.
 * O insumo nao tem cor nem variante (preco = o preco base), salvo `tamanhoProprio` (1 variante sem cor com tamanho "U", mesmo preco).
 */
export const GRADE_FATOR: Record<string, number> = { "40|M": 16, "38|P": 16, "36|PP": 8, "42|G": 16, "44|GG": 8 }; // total 64
export type CasoEtiquetaFator = {
  nome: string;
  preco: number;
  consumo: number;
  perda: number;
  /** etiquetas.tamanho_vinculado */
  vinculo: string | null;
  /** grade do modelo (1 linha de modelo_grades com grade_total = soma); null = sem linha de grade */
  grade: Record<string, number> | null;
  /** insumo com variante de tamanho proprio (o vinculo e ignorado) */
  tamanhoProprio?: boolean;
  fator: number;
  esperado: number;
};
export const CASOS_ETIQUETA_FATOR: CasoEtiquetaFator[] = [
  { nome: "vinculado 40|M (16 de 64 = fator 0,25)", preco: 1, consumo: 2, perda: 0, vinculo: "40|M", grade: GRADE_FATOR,
    fator: 0.25, esperado: 0.5 }, // 1 x 2 x 0,25
  { nome: "vinculado 36|PP com perda (8 de 64 = 0,125)", preco: 0.07, consumo: 0.5, perda: 5, vinculo: "36|PP", grade: GRADE_FATOR,
    fator: 0.125, esperado: 0 }, // 0,07 x 0,5 x 0,125 x 1,05 = 0,0045937 -> 0,00
  { nome: "vinculado 38|P, preco 0,10 x 2 com 5% (0,25)", preco: 0.1, consumo: 2, perda: 5, vinculo: "38|P", grade: GRADE_FATOR,
    fator: 0.25, esperado: 0.05 }, // 0,1 x 2 x 0,25 x 1,05 = 0,0525 -> 0,05
  { nome: "vinculo AUSENTE da grade (46|XG): fator 0", preco: 1, consumo: 2, perda: 0, vinculo: "46|XG", grade: GRADE_FATOR,
    fator: 0, esperado: 0 },
  { nome: "vinculado sem grade (modelo sem linha de grade): fator 1", preco: 0.1, consumo: 1, perda: 0, vinculo: "40|M", grade: null,
    fator: 1, esperado: 0.1 },
  { nome: "sem vinculo: fator 1 (o valor de hoje)", preco: 1, consumo: 2, perda: 5, vinculo: null, grade: GRADE_FATOR,
    fator: 1, esperado: 2.1 },
  { nome: "vinculo com espacos ' 40|M ' = 40|M (btrim)", preco: 1, consumo: 2, perda: 0, vinculo: " 40|M ", grade: GRADE_FATOR,
    fator: 0.25, esperado: 0.5 },
  { nome: "insumo com tamanho proprio: vinculo ignorado, fator 1 (Ruling A2)", preco: 1, consumo: 2, perda: 0, vinculo: "40|M",
    grade: GRADE_FATOR, tamanhoProprio: true, fator: 1, esperado: 2 },
];
/** Um card com as linhas 0, 2 e 5 de CASOS_ETIQUETA_FATOR na MESMA grade: etiqueta total = 0,50 + 0,05 + 2,10. */
export const CASO_MODELO_FATOR = { linhas: [0, 2, 5], etiqueta: 2.65, peca: 2.65 };
