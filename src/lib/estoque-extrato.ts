/**
 * Extrato ("Histórico") de estoque por item — Tecido / Aviamento / Insumo (urgentes R3, plano-a Task 15).
 *
 * Módulo PURO (sem React/Supabase, sem relógio, sem fuso global). Recebe as linhas da RPC
 * `estoque_extrato_<tecido|aviamento|insumo>` (Task 14) já convertidas para camelCase (`movDeLinhaRpc`),
 * e devolve: filtro de bucket, ordem, saldo corrente, filtros de período/origem e rótulos.
 *
 * ── CONTRATO ASSUMIDO COM A RPC (Task 14; o SQL deve CASAR com isto) ─────────────────────────────
 *  • Colunas (snake → camel): bucket_variante_id→bucketVarianteId, bucket_tamanho→bucketTamanho,
 *    bucket_cor_id→bucketCorId, bucket_cor_nome→bucketCorNome, quando→quando, quando_fonte→quandoFonte,
 *    tipo, origem, quantidade, quem, ref_oc→refOc, ref_modelo→refModelo, ref_id→refId, detalhe,
 *    core_recebido→coreRecebido, core_baixa→coreBaixa, core_fisico→coreFisico.
 *  • `quantidade` é ASSINADA (+ entrada, − saída), tecido em METROS. Σ quantidade por bucket =
 *    core_recebido − core_baixa (por construção, Ruling A17); `core_*` repetem em todas as linhas do bucket.
 *    (`core_baixa` é positivo = quanto saiu; saldo = recebido − baixa; `core_fisico` = o que a tela mostra, ≥ 0.)
 *  • `quando` chega como string ISO (timestamptz serializado) ou NULL; lido com `Date.parse`.
 *    "Sem data" = `quando` NULL (ou ilegível) OU `quando_fonte = 'sem_data'` (a RPC manda os dois juntos).
 *  • `numeric` do Postgres pode chegar como number ou string numérica: tudo passa por `Number()`.
 *  • Uma chamada da RPC devolve TODOS os buckets do item (tecido = 1 bucket/variante; aviamento = por variante
 *    ou "Sem variante" = bucket_variante_id NULL; insumo = (tamanho, cor)). `filtrarBucket` isola um bucket;
 *    `montarExtrato` assume que `movs` já é UM bucket (saldo/core são por bucket).
 *  • Bucket de insumo = (bucket_tamanho, bucket_cor_nome); NULL e "" são o MESMO valor ("Sem tamanho"/"Sem cor").
 *    Para insumo `varianteId` do BucketEstoque é ignorado. Para tecido/aviamento só `varianteId` conta.
 *
 * ── DECISÕES DA LIB (onde o plano não fecha) ─────────────────────────────────────────────────────
 *  • `de`/`ate` são DIAS de calendário no fuso da loja, inclusivos (`ate` cobre o dia inteiro). Aceitam
 *    "YYYY-MM-DD" (usado como está) ou `Date` (vale o dia desse instante NO FUSO da loja). O fuso é parâmetro
 *    OBRIGATÓRIO do filtro (IANA, ex. "America/Sao_Paulo"; o componente lê `useStoreTimezone`).
 *  • Com `de`, linhas sem data ficam escondidas (contam em `saldoAnterior`); só com `ate`, sem-data aparece.
 *  • `saldoAnterior` é null sem `de`. Linhas escondidas por período/origem NUNCA mudam o `saldo` das visíveis.
 *  • Saldo acumulado é arredondado a 6 casas a cada passo (evita 0,1+0,2 = 0,30000000000000004).
 *  • Ordem: sem data primeiro; depois `quando` crescente; empate: entrada antes de saída, depois `refOc`,
 *    `refModelo` (ordem natural pt-BR, vazio primeiro); por fim a ordem de entrada (estável).
 */

export type FamiliaEstoque = "tecido" | "aviamento" | "insumo";

export type QuandoFonte = "registro" | "data_oc" | "data_envio" | "data_os" | "sem_data";

/** Linha da RPC, camelCase. */
export type MovEstoque = {
  bucketVarianteId: string | null;
  bucketTamanho: string | null;
  bucketCorId: string | null;
  bucketCorNome: string | null;
  /** ISO (timestamptz) ou null quando não há data. */
  quando: string | null;
  quandoFonte: QuandoFonte | string;
  tipo: "entrada" | "saida" | string;
  origem: string;
  /** ASSINADA: + entrada, − saída (tecido em metros). */
  quantidade: number;
  quem: string | null;
  refOc: string | null;
  refModelo: string | null;
  refId: string | null;
  detalhe: string | null;
  coreRecebido: number;
  coreBaixa: number;
  coreFisico: number;
};

export type BucketEstoque = { varianteId?: string | null; tamanho?: string | null; corNome?: string | null };

export type DiaFiltro = string | Date;

export type FiltroExtrato = {
  /** IANA do fuso da loja (obrigatório; sem global). */
  fuso: string;
  de?: DiaFiltro;
  ate?: DiaFiltro;
  /** Vazio/ausente = todas as origens. */
  origens?: string[];
};

export type LinhaExtrato = MovEstoque & { saldo: number };

export type Extrato = {
  linhas: LinhaExtrato[];
  saldoAnterior: number | null;
  saldoFinal: number;
  fisicoTela: number;
  confere: boolean;
  negativo: boolean;
};

export const ORIGEM_ROTULO: Record<string, string> = {
  oc: "Recebimento de OC",
  reposicao_troca: "Reposição de troca",
  rolo_entrada: "Rolo (entrada)",
  separacao_rolo: "Separação de rolo",
  corte: "Corte (Explosão)",
  ajuste: "Ajuste (- Metragem)",
  os: "Ordem de saída",
  explosao: "Envio à Explosão",
  explosao_ajuste: "Ajuste depois do envio",
  revenda: "Revenda (peças recebidas)",
};

/** Rótulo PT-BR da origem; origem desconhecida volta como veio (nunca esconde linha). */
export function rotuloOrigem(origem: string): string {
  return ORIGEM_ROTULO[origem] ?? origem;
}

// ───────────────────────── helpers numéricos / texto ─────────────────────────

const TOLERANCIA_CONFERE = 0.005;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 6 casas: mata o ruído de ponto flutuante sem mexer em quantidades reais (numeric(…,3)). */
function r6(n: number): number {
  const x = Math.round(n * 1e6) / 1e6;
  return x === 0 ? 0 : x; // evita -0
}

function txt(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

/** "" e null/undefined são o mesmo valor de bucket. */
function norm(v: string | null | undefined): string | null {
  return v === null || v === undefined || v === "" ? null : v;
}

// ───────────────────────── RPC → MovEstoque ─────────────────────────

/** Converte uma linha crua da RPC (snake_case) em `MovEstoque`. Campo ausente vira null (core/quantidade: 0). */
export function movDeLinhaRpc(row: Record<string, unknown>): MovEstoque {
  return {
    bucketVarianteId: txt(row.bucket_variante_id),
    bucketTamanho: txt(row.bucket_tamanho),
    bucketCorId: txt(row.bucket_cor_id),
    bucketCorNome: txt(row.bucket_cor_nome),
    quando: txt(row.quando),
    quandoFonte: txt(row.quando_fonte) ?? "sem_data",
    tipo: txt(row.tipo) ?? "",
    origem: txt(row.origem) ?? "",
    quantidade: num(row.quantidade),
    quem: txt(row.quem),
    refOc: txt(row.ref_oc),
    refModelo: txt(row.ref_modelo),
    refId: txt(row.ref_id),
    detalhe: txt(row.detalhe),
    coreRecebido: num(row.core_recebido),
    coreBaixa: num(row.core_baixa),
    coreFisico: num(row.core_fisico),
  };
}

// ───────────────────────── filtro de bucket ─────────────────────────

/** Isola um bucket do resultado da RPC (ver contrato no topo). */
export function filtrarBucket(movs: MovEstoque[], b: BucketEstoque, familia: FamiliaEstoque): MovEstoque[] {
  if (familia === "insumo") {
    const tam = norm(b.tamanho);
    const cor = norm(b.corNome);
    return movs.filter((m) => norm(m.bucketTamanho) === tam && norm(m.bucketCorNome) === cor);
  }
  // tecido: a variante; aviamento: a variante, e null/undefined = "Sem variante" (bucket NULL)
  const v = b.varianteId ?? null;
  return movs.filter((m) => (m.bucketVarianteId ?? null) === v);
}

// ───────────────────────── datas no fuso da loja ─────────────────────────

const fmtPorFuso = new Map<string, Intl.DateTimeFormat>();

function formatador(fuso: string): Intl.DateTimeFormat {
  let f = fmtPorFuso.get(fuso);
  if (!f) {
    // en-CA formata como YYYY-MM-DD
    f = new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" });
    fmtPorFuso.set(fuso, f);
  }
  return f;
}

/** Dia de calendário ("YYYY-MM-DD") de um instante no fuso dado. */
export function diaNoFuso(d: Date, fuso: string): string {
  return formatador(fuso).format(d);
}

function diaDoFiltro(v: DiaFiltro | undefined, fuso: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  return Number.isNaN(v.getTime()) ? null : diaNoFuso(v, fuso);
}

function instante(m: MovEstoque): number | null {
  if (m.quandoFonte === "sem_data" || m.quando === null || m.quando === undefined) return null;
  const t = Date.parse(m.quando);
  return Number.isNaN(t) ? null : t;
}

// ───────────────────────── ordem ─────────────────────────

const colador = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

function ordemTipo(t: string): number {
  return t === "entrada" ? 0 : 1;
}

type Item = { m: MovEstoque; t: number | null; i: number };

function comparar(a: Item, b: Item): number {
  if (a.t === null && b.t !== null) return -1; // sem data PRIMEIRO
  if (a.t !== null && b.t === null) return 1;
  if (a.t !== null && b.t !== null && a.t !== b.t) return a.t - b.t;
  const tipo = ordemTipo(a.m.tipo) - ordemTipo(b.m.tipo); // entrada antes de saída
  if (tipo !== 0) return tipo;
  const oc = colador.compare(a.m.refOc ?? "", b.m.refOc ?? "");
  if (oc !== 0) return oc;
  const mod = colador.compare(a.m.refModelo ?? "", b.m.refModelo ?? "");
  if (mod !== 0) return mod;
  return a.i - b.i; // estável
}

// ───────────────────────── extrato ─────────────────────────

/**
 * Monta o extrato de UM bucket. Saldo corrente sobre TODOS os movimentos; período/origem só escondem linhas.
 * Não muta `movs`.
 */
export function montarExtrato(movs: MovEstoque[], f: FiltroExtrato): Extrato {
  const itens: Item[] = movs.map((m, i) => ({ m, t: instante(m), i }));
  itens.sort(comparar);

  const de = diaDoFiltro(f.de, f.fuso);
  const ate = diaDoFiltro(f.ate, f.fuso);
  const origens = f.origens && f.origens.length > 0 ? new Set(f.origens) : null;

  let saldo = 0;
  let anterior = 0;
  const linhas: LinhaExtrato[] = [];

  for (const { m, t } of itens) {
    const q = num(m.quantidade);
    saldo = r6(saldo + q);
    const dia = t === null ? null : diaNoFuso(new Date(t), f.fuso);

    // antes do início do período? (sem data conta como anterior)
    const antes = de !== null && (dia === null || dia < de);
    if (antes) anterior = r6(anterior + q);

    const visivel =
      !antes &&
      (ate === null || dia === null || dia <= ate) &&
      (origens === null || origens.has(m.origem));
    if (visivel) linhas.push({ ...m, quantidade: q, saldo });
  }

  const ref = movs[0];
  const coreRecebido = ref ? num(ref.coreRecebido) : 0;
  const coreBaixa = ref ? num(ref.coreBaixa) : 0;

  return {
    linhas,
    saldoAnterior: de === null ? null : anterior,
    saldoFinal: saldo,
    fisicoTela: ref ? num(ref.coreFisico) : 0,
    confere: Math.abs(saldo - (coreRecebido - coreBaixa)) < TOLERANCIA_CONFERE,
    negativo: saldo < 0,
  };
}
