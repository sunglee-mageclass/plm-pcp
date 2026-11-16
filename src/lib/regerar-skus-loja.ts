/**
 * "Regerar todos os SKUs da loja" (Config da Loja, admin) - regras PURAS do laco em PAGINAS (migration 20261201120000). O statement_timeout de 8 s do
 * role authenticated nao aceita uma chamada para a loja inteira: a previa e a gravacao andam em paginas pequenas (padrao 25 produtos, teto duro 50
 * no servidor); se uma pagina estourar o tempo, a MESMA pagina e repetida com METADE do tamanho (minimo 5); falhas repetidas param com a posicao
 * para "continuar de onde parou". A chamada real (supabase.rpc) e INJETADA (`chamar`) - aqui nao ha I/O, so o laco, a leitura tolerante do jsonb,
 * os contadores e os filtros do Dialog de previa.
 */

export const TAMANHO_PAGINA_PADRAO = 25;
export const TAMANHO_PAGINA_MAXIMO = 50;
export const TAMANHO_PAGINA_MINIMO = 5;

export type MotivoPulo = "integracao" | "ja_exportado" | "sem_ref" | "sem_tamanho" | "sem_formato" | "outra_loja";
export type EstadoItem = "muda" | "igual" | "conflito" | "pulado" | "erro" | "desatualizado" | "gravado";
export type AcaoLinha = "muda" | "novo" | "sai" | "conflito";

export type LinhaPrevia = {
  varianteKey: string;
  corNome: string | null;
  apelidoNome: string | null;
  tamanhoKey: string;
  acao: AcaoLinha;
  skuDe: string | null;
  skuPara: string | null;
  mensagem: string | null;
};
export type ItemPrevia = {
  modeloId: string;
  nome: string;
  ref: string;
  origem: string | null;
  tamanhoTipo: "letra" | "numero" | null;
  estado: "muda" | "igual" | "conflito" | "pulado" | "erro";
  motivo: MotivoPulo | null;
  assinatura: string | null;
  criados: number;
  atualizados: number;
  removidos: number;
  manuais: number;
  conflitos: number;
  linhas: LinhaPrevia[];
  erro: { codigo: string; detalhe: string } | null;
};
export type PaginaPrevia = { formatoOk: boolean; totalModelos: number | null; itens: ItemPrevia[]; proximo: string | null };

const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const texto = (v: unknown): string | null => (typeof v === "string" ? v : null);
const inteiro = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);
const MOTIVOS: readonly string[] = ["integracao", "ja_exportado", "sem_ref", "sem_tamanho", "sem_formato", "outra_loja"];
const ACOES: readonly string[] = ["muda", "novo", "sai", "conflito"];

/** Lê UMA página de `regerar_skus_loja_previa`. Tolerante: estado/ação desconhecidos viram `erro` (o item nunca é gravado). */
export function lerPaginaPrevia(raw: unknown): PaginaPrevia {
  const o = objeto(raw);
  const itens = (Array.isArray(o.itens) ? o.itens : []).map(objeto).map((i): ItemPrevia => {
    const estado = texto(i.estado);
    const conhecido = estado === "muda" || estado === "igual" || estado === "conflito" || estado === "pulado" || estado === "erro";
    const motivo = texto(i.motivo);
    const linhas = (Array.isArray(i.linhas) ? i.linhas : []).map(objeto).filter((l) => ACOES.includes(String(l.acao))).map((l): LinhaPrevia => ({
      varianteKey: texto(l.variante_key) ?? "", corNome: texto(l.cor_nome), apelidoNome: texto(l.apelido_nome), tamanhoKey: texto(l.tamanho_key) ?? "",
      acao: l.acao as AcaoLinha, skuDe: texto(l.sku_de), skuPara: texto(l.sku_para), mensagem: texto(l.mensagem),
    }));
    const assinatura = texto(i.assinatura);
    const semAssinatura = estado === "muda" && !(assinatura && /^[0-9a-f]{32}$/.test(assinatura));
    return {
      modeloId: texto(i.modelo_id) ?? "",
      nome: texto(i.nome) ?? "Produto sem nome",
      ref: texto(i.ref) ?? "",
      origem: texto(i.origem),
      tamanhoTipo: i.tamanho_tipo === "letra" || i.tamanho_tipo === "numero" ? i.tamanho_tipo : null,
      estado: conhecido && !semAssinatura ? (estado as ItemPrevia["estado"]) : "erro",
      motivo: motivo && MOTIVOS.includes(motivo) ? (motivo as MotivoPulo) : null,
      assinatura: assinatura && /^[0-9a-f]{32}$/.test(assinatura) ? assinatura : null,
      criados: inteiro(i.criados), atualizados: inteiro(i.atualizados), removidos: inteiro(i.removidos), manuais: inteiro(i.manuais),
      conflitos: inteiro(i.conflitos),
      linhas,
      erro: estado === "erro" ? { codigo: texto(i.codigo) ?? "", detalhe: texto(i.detalhe) ?? "" }
        : !conhecido || semAssinatura ? { codigo: "", detalhe: "resposta desconhecida do servidor" } : null,
    };
  });
  return {
    formatoOk: o.formato_ok === true,
    totalModelos: typeof o.total_modelos === "number" ? o.total_modelos : null,
    itens,
    proximo: texto(o.proximo),
  };
}

/** Estouro de tempo do banco/gateway: SQLSTATE 57014 (statement_timeout) ou o texto do Postgres/PostgREST. */
export function ehTimeout(e: unknown): boolean {
  const o = objeto(e);
  const code = String(o.code ?? "");
  const msg = String(o.message ?? (typeof e === "string" ? e : "")).toLowerCase();
  return code === "57014" || code === "504" || code === "408" || /statement timeout|canceling statement|timed out|gateway time-?out/.test(msg);
}
/** A pagina que estourou o tempo volta com a METADE (nunca abaixo do minimo). */
export const metadeDaPagina = (n: number): number => Math.max(TAMANHO_PAGINA_MINIMO, Math.floor(n / 2));
const limitaPagina = (n: number): number => Math.min(TAMANHO_PAGINA_MAXIMO, Math.max(TAMANHO_PAGINA_MINIMO, Math.trunc(n)));

export type FalhaLaco = { erro: unknown; tempo: boolean };
export type ResultadoPrevia = {
  status: "completo" | "cancelado" | "falha";
  itens: ItemPrevia[];
  /** cursor para continuar de onde parou (null = terminou) */
  proximo: string | null;
  formatoOk: boolean;
  total: number | null;
  /** tamanho de pagina em uso ao terminar/parar (o que ja recuou continua recuado) */
  tamanho: number;
  falha?: FalhaLaco;
};

/**
 * Percorre a loja em paginas (`chamar` = uma chamada de `regerar_skus_loja_previa`). Timeout na pagina => repete a MESMA pagina com a metade (min 5);
 * com o minimo ja usado => para (`falha`, `tempo: true`) mantendo o cursor. Qualquer outro erro => para (`falha`). `cancelado()` e consultado ANTES de
 * cada chamada. `continuarDe` retoma de um cursor (a lista anterior e passada em `jaTem`). Nada e gravado aqui (so leitura).
 */
export async function calcularPrevia(o: {
  tenantId: string;
  chamar: (a: { tenantId: string; apos: string | null; limite: number }) => Promise<unknown>;
  tamanhoInicial?: number;
  continuarDe?: string | null;
  jaTem?: ItemPrevia[];
  total?: number | null;
  cancelado?: () => boolean;
  aoPagina?: (p: { itens: ItemPrevia[]; feitos: number; total: number | null }) => void;
  aoRecuar?: (novoTamanho: number) => void;
}): Promise<ResultadoPrevia> {
  let tamanho = limitaPagina(o.tamanhoInicial ?? TAMANHO_PAGINA_PADRAO);
  let apos: string | null = o.continuarDe ?? null;
  let total: number | null = o.total ?? null;
  const itens: ItemPrevia[] = [...(o.jaTem ?? [])];
  const formatoOk = true;
  for (;;) {
    if (o.cancelado?.()) return { status: "cancelado", itens, proximo: apos, formatoOk, total, tamanho };
    let pagina: PaginaPrevia;
    try {
      pagina = lerPaginaPrevia(await o.chamar({ tenantId: o.tenantId, apos, limite: tamanho }));
    } catch (erro) {
      if (ehTimeout(erro) && tamanho > TAMANHO_PAGINA_MINIMO) {
        tamanho = metadeDaPagina(tamanho);
        o.aoRecuar?.(tamanho);
        continue; // a MESMA pagina (mesmo `apos`), menor
      }
      return { status: "falha", itens, proximo: apos, formatoOk, total, tamanho, falha: { erro, tempo: ehTimeout(erro) } };
    }
    if (!pagina.formatoOk) return { status: "completo", itens: [], proximo: null, formatoOk: false, total: pagina.totalModelos, tamanho };
    if (pagina.totalModelos !== null) total = pagina.totalModelos;
    itens.push(...pagina.itens);
    o.aoPagina?.({ itens: pagina.itens, feitos: itens.length, total });
    apos = pagina.proximo;
    if (!apos) return { status: "completo", itens, proximo: null, formatoOk, total, tamanho };
  }
}

// ---------- gravacao ----------
export type ResultadoItem = {
  modeloId: string;
  nome: string;
  ref: string;
  estado: "gravado" | "desatualizado" | "pulado" | "erro";
  motivo: MotivoPulo | null;
  criados: number;
  atualizados: number;
  removidos: number;
  conflitos: number;
  erro: { codigo: string; detalhe: string } | null;
};
export type ResultadoPagina = { resultados: ResultadoItem[] };
export function lerResultadoAplicar(raw: unknown): ResultadoPagina {
  const o = objeto(raw);
  const resultados = (Array.isArray(o.resultados) ? o.resultados : []).map(objeto).map((r): ResultadoItem => {
    const estado = texto(r.estado);
    const conhecido = estado === "gravado" || estado === "desatualizado" || estado === "pulado" || estado === "erro";
    const motivo = texto(r.motivo);
    return {
      modeloId: texto(r.modelo_id) ?? "", nome: texto(r.nome) ?? "", ref: texto(r.ref) ?? "",
      estado: conhecido ? (estado as ResultadoItem["estado"]) : "erro",
      motivo: motivo && MOTIVOS.includes(motivo) ? (motivo as MotivoPulo) : null,
      criados: inteiro(r.criados), atualizados: inteiro(r.atualizados), removidos: inteiro(r.removidos), conflitos: inteiro(r.conflitos),
      erro: estado === "erro" ? { codigo: texto(r.codigo) ?? "", detalhe: texto(r.detalhe) ?? "" } : conhecido ? null : { codigo: "", detalhe: "resposta desconhecida do servidor" },
    };
  });
  return { resultados };
}

/** Só os produtos 'muda' (com assinatura) vão ao servidor — 'conflito' puro/'igual'/'pulado'/'erro' não têm o que gravar. */
export const itensParaGravar = (itens: readonly ItemPrevia[]): ItemPrevia[] => itens.filter((i) => i.estado === "muda" && !!i.assinatura);

export type ResultadoGravacao = {
  status: "completo" | "cancelado" | "falha";
  resultados: ResultadoItem[];
  /** produtos que ainda NAO foram enviados (a falha/cancelamento deixou) */
  restantes: ItemPrevia[];
  tamanho: number;
  falha?: FalhaLaco;
};
/**
 * Grava em lotes (`chamar` = uma chamada de `regerar_skus_loja_aplicar`). Mesma regra de tempo da previa: o lote que estourar o tempo volta com a metade
 * (min 5) — reenviar e IDEMPOTENTE no servidor (mesma assinatura = 0 operacoes). Cada lote e atomico POR PRODUTO; os lotes ja gravados FICAM se
 * cancelar/falhar. `cancelado()` e consultado antes de cada lote.
 */
export async function gravarEmLotes(o: {
  tenantId: string;
  itens: readonly ItemPrevia[];
  chamar: (a: { tenantId: string; itens: { modelo_id: string; assinatura: string }[] }) => Promise<unknown>;
  tamanhoInicial?: number;
  cancelado?: () => boolean;
  aoLote?: (p: { resultados: ResultadoItem[]; feitos: number; total: number }) => void;
  aoRecuar?: (novoTamanho: number) => void;
}): Promise<ResultadoGravacao> {
  let tamanho = limitaPagina(o.tamanhoInicial ?? TAMANHO_PAGINA_PADRAO);
  const total = o.itens.length;
  let restantes = [...o.itens];
  const resultados: ResultadoItem[] = [];
  while (restantes.length > 0) {
    if (o.cancelado?.()) return { status: "cancelado", resultados, restantes, tamanho };
    const lote = restantes.slice(0, tamanho);
    try {
      const r = lerResultadoAplicar(await o.chamar({ tenantId: o.tenantId, itens: lote.map((i) => ({ modelo_id: i.modeloId, assinatura: i.assinatura as string })) }));
      resultados.push(...r.resultados);
      restantes = restantes.slice(lote.length);
      o.aoLote?.({ resultados: r.resultados, feitos: total - restantes.length, total });
    } catch (erro) {
      if (ehTimeout(erro) && tamanho > TAMANHO_PAGINA_MINIMO) {
        tamanho = metadeDaPagina(tamanho);
        o.aoRecuar?.(tamanho);
        continue;
      }
      return { status: "falha", resultados, restantes, tamanho, falha: { erro, tempo: ehTimeout(erro) } };
    }
  }
  return { status: "completo", resultados, restantes: [], tamanho };
}

// ---------- resumo / filtros do Dialog ----------
export type ResumoPrevia = {
  /** SKUs que mudam de valor */
  mudam: number;
  novos: number;
  removidos: number;
  manuaisPreservados: number;
  conflitos: number;
  produtosMudam: number;
  produtosIguais: number;
  produtosConflito: number;
  produtosErro: number;
  pulados: Record<MotivoPulo, number>;
  totalPulados: number;
};
const PULOS_ZERO = (): Record<MotivoPulo, number> => ({ integracao: 0, ja_exportado: 0, sem_ref: 0, sem_tamanho: 0, sem_formato: 0, outra_loja: 0 });
export function resumirPrevia(itens: readonly ItemPrevia[]): ResumoPrevia {
  const r: ResumoPrevia = {
    mudam: 0, novos: 0, removidos: 0, manuaisPreservados: 0, conflitos: 0, produtosMudam: 0, produtosIguais: 0, produtosConflito: 0, produtosErro: 0,
    pulados: PULOS_ZERO(), totalPulados: 0,
  };
  for (const i of itens) {
    if (i.estado === "pulado") {
      r.totalPulados++;
      if (i.motivo) r.pulados[i.motivo]++;
      continue;
    }
    if (i.estado === "erro") { r.produtosErro++; continue; }
    r.manuaisPreservados += i.manuais;
    r.conflitos += i.conflitos;
    if (i.estado === "igual") r.produtosIguais++;
    else if (i.estado === "conflito") r.produtosConflito++;
    else if (i.estado === "muda") {
      r.produtosMudam++;
      r.mudam += i.atualizados;
      r.novos += i.criados;
      r.removidos += i.removidos;
    }
  }
  return r;
}
/** N do botão "Regerar N SKUs em M produtos": tudo que o servidor vai gravar (muda + novos + removidos) nos produtos 'muda'. */
export function totalAGravar(itens: readonly ItemPrevia[]): { skus: number; produtos: number } {
  const g = itensParaGravar(itens);
  return { skus: g.reduce((s, i) => s + i.criados + i.atualizados + i.removidos, 0), produtos: g.length };
}

export type FiltroPrevia = "muda" | "conflito" | "pulados" | "igual" | "erro";
export const FILTROS_PREVIA: { valor: FiltroPrevia; rotulo: string }[] = [
  { valor: "muda", rotulo: "Só os que mudam" }, { valor: "conflito", rotulo: "Conflitos" }, { valor: "pulados", rotulo: "Pulados" },
  { valor: "igual", rotulo: "Iguais" }, { valor: "erro", rotulo: "Com erro" },
];
export function filtrarItens(itens: readonly ItemPrevia[], f: FiltroPrevia): ItemPrevia[] {
  switch (f) {
    case "muda": return itens.filter((i) => i.estado === "muda");
    case "conflito": return itens.filter((i) => i.conflitos > 0 && (i.estado === "muda" || i.estado === "conflito"));
    case "pulados": return itens.filter((i) => i.estado === "pulado");
    case "igual": return itens.filter((i) => i.estado === "igual");
    case "erro": return itens.filter((i) => i.estado === "erro");
  }
}

export const TEXTO_MOTIVO_PULO: Record<MotivoPulo, string> = {
  integracao: "Integrável / Integrado",
  ja_exportado: "Já exportado",
  sem_ref: "Sem REF",
  sem_tamanho: "Sem “Tamanho em”",
  sem_formato: "Loja sem Formato do SKU",
  outra_loja: "De outra loja",
};
export const ROTULO_ACAO_LINHA: Record<AcaoLinha, string> = { muda: "muda", novo: "novo", sai: "sai", conflito: "conflito" };

/** Total de produtos que a gravacao terminou: gravados/desatualizados/pulados/erros (para o resumo final). */
export function resumirGravacao(resultados: readonly ResultadoItem[]) {
  const por = (e: ResultadoItem["estado"]) => resultados.filter((r) => r.estado === e);
  return {
    gravados: por("gravado"),
    desatualizados: por("desatualizado"),
    pulados: por("pulado"),
    erros: por("erro"),
    skusGravados: por("gravado").reduce((s, r) => s + r.criados + r.atualizados + r.removidos, 0),
  };
}

/** Mensagem PT quando o laço da PRÉVIA para: tempo esgotado repetido (o texto do erro vem de `mensagemErro` na tela). A prévia só LÊ — "nada foi gravado" só vale aqui. */
export const TEXTO_FALHA_TEMPO =
  "O servidor demorou demais mesmo com poucos produtos por vez. Nada foi gravado nesta fase. Tente de novo em instantes — dá para continuar de onde parou.";

/** Mensagem PT quando o laço da GRAVAÇÃO para por tempo esgotado: os lotes já gravados FICAM (não use o texto da prévia, que diz "nada foi gravado"). */
export const TEXTO_FALHA_TEMPO_GRAVACAO =
  "O servidor demorou demais mesmo com poucos produtos por vez. Os produtos já gravados ficam como estão. Tente de novo em instantes — dá para continuar de onde parou.";

/** A loja tem Formato do SKU? Mesmo predicado do servidor (`regerar_skus_loja_previa`/`_skus_plano`): `sku_config` nulo OU `partes = []` = sem Formato. */
export function temFormatoSku(cfg: unknown): boolean {
  const o = objeto(cfg);
  if (Object.keys(o).length === 0 && !(cfg && typeof cfg === "object")) return false;
  return JSON.stringify(o.partes ?? null) !== "[]";
}
