// Tipos + helpers puros do rascunho (draft) do planejador Produto Importado (Fase 1 —
// TELA NAVEGÁVEL, sem persistência ainda). Espelha o padrão de
// `src/components/produto-acabado/shared.ts` (mesma família de telas), mas para a
// entidade NOVA `produtos_importados` (compra do exterior — moeda/câmbio/frete/etapas de
// pagamento; ver `src/lib/moeda.ts`, FONTE ÚNICA da aritmética consumida aqui).
//
// NADA de aritmética própria neste arquivo além de "moldar" o draft pros helpers de
// `moeda.ts` — a conta em si (custo landed, rateio por peso, cadeia de markup) mora lá.
import { ratearPorPeso, custoLanded, cadeiaMarkup, type EntradaLanded, type EtapaPagamento, type ResultadoLanded } from "@/lib/moeda";
import type { Conflito } from "@/lib/colab/merge";

export type VarianteImportadoDraft = {
  ordem: number;
  cor_id: string | null;
  cor_apelido_id: string | null;
  peso: number;
  qtd: number;
  /** true quando o usuário editou a qtd desta variante à mão — trava o rateio automático
   *  por peso NESTA variante (mesma ideia de `ehDistribuicaoProporcional`/preservar edição
   *  manual do Produto Acabado, mas por-variante aqui em vez de "tudo ou nada"). */
  _touched?: boolean;
};

export type EtapaImportadoDraft = {
  ordem: number;
  rotulo: string;
  base: "mercadoria" | "frete";
  percentual: number;
  data_vencimento: string | null;
  cotacao: number;
};

export type ProdutoImportadoDraft = {
  id?: string | null;
  // Colab (Fase 3, set/2026, ver migração 20260916230000): rev otimista POR PRODUTO — bumpa a
  // cada UPDATE em `produtos_importados` (trigger `trg_colab_rev_prod_importado`). Metadado
  // READ-ONLY — NUNCA entra em `chaveDirty` (espelha `ProdutoDraft.rev`, Produto Acabado).
  // Rascunho local (`id` "novo-...", nunca persistido) nasce com `rev: 0` — a RPC não checa
  // `_rev_base` quando `_id IS NULL` (ver migração), então o valor é inofensivo até salvar.
  rev: number;
  /** `modelos.id` do card materializado (espelho 1:1) — null se ainda não tem card no
   *  Planejamento. Usado pela ação "Replicar card(s)": só drafts JÁ PERSISTIDOS e com
   *  `modelo_id` preenchido podem ser replicados (a RPC `replicar_produtos_importados`
   *  ignora silenciosamente quem não tem card). */
  modelo_id?: string | null;
  /** Família de produtos (colecao_mixes). Read-only aqui — associada pelo EditarMixDialog (#4b). */
  mix_id?: string | null;
  nome: string;
  grupo_id: string | null;
  categoria_id: string | null;
  subcategoria1_id: string | null;
  subcategoria2_id: string | null;
  colecao_id: string | null;
  subcolecao: string | null;
  semana: string | null;
  empresa_id: string | null;
  representante_id: string | null;
  ref_fornecedor: string;
  /** REF real só existe depois de persistido (fase seguinte) — nasce null no draft local. */
  ref?: string | null;
  composicao: string;
  foto_url: string | null;
  data_pedido: string | null;
  data_prevista: string | null;
  data_entrega: string | null;
  /** peso/proporção por TAMANHO — mesma forma de `ProdutoDraft.grade_proporcao` (Produto Acabado). */
  grade_proporcao: Record<string, number>;
  qtd_total: number;
  /** moeda de compra (M1) — ex. RMB. */
  moeda_compra: string;
  /** moeda intermediária (M2) — ex. USD; null = cadeia DIRETA (M1 → BRL sem escala). */
  moeda_intermediaria: string | null;
  /** valor unitário do produto, na moeda M1. */
  valor_unitario_m1: number;
  /** cotação de referência M1→M2 (só exibição da seção 4 — a autoritativa por-etapa mora em `etapas`). */
  cotacao_ref: number;
  peso_kg: number;
  /** frete por peça, já em M2 (peso_kg × transporte_m2 vira `freteUnitarioM2` do landed). */
  transporte_m2: number;
  desconto_pct: number;
  /** cotação final ÚNICA M2→BRL (ou M1→BRL numa cadeia direta, cotação 1). */
  cotacao_final: number;
  markup_atacado: number | null;
  markup_varejo: number | null;
  /** D14/R1 (Integração): preço FIXO exato por canal (null = deriva do markup). VAI no payload do salvar_produto_importado
   *  (montarPayload) e grava no SALVAR da tela, na transação do _rev_base — nada grava antes do Salvar. */
  preco_atacado_fixo: number | null;
  preco_varejo_fixo: number | null;
  /** M-1 (Integração, Fix round 1) — `modelos.preco_venda` do espelho, READ-ONLY (embed).
   *  Quando o varejo está travado, é o valor CONGELADO que a API de fato lê (B1 freeze) — a tela
   *  mostra ELE em vez de um preço vivo derivado do custo (que pode ter mudado com o produto
   *  travado). `null` = sem espelho ainda (produto não materializado). NUNCA entra em `chaveDirty`
   *  (read-only, embed) nem no payload de `montarPayload`. */
  modeloPrecoVenda: number | null;
  variantes: VarianteImportadoDraft[];
  etapas: EtapaImportadoDraft[];
};

/** Draft novo com os defaults do design spec: RMB→USD, 1 variante vazia, 3 etapas
 *  (sinal 30% mercadoria, saldo 70% mercadoria, frete 100% frete) — cada Σ% já fecha
 *  100 por base, então `validarDraft` passa de cara num produto recém-criado. */
export function emptyDraft(colecaoId: string | null, subcolecao: string | null): ProdutoImportadoDraft {
  return {
    id: null,
    rev: 0,
    modelo_id: null,
    mix_id: null,
    nome: "",
    grupo_id: null,
    categoria_id: null,
    subcategoria1_id: null,
    subcategoria2_id: null,
    colecao_id: colecaoId,
    subcolecao,
    semana: null,
    empresa_id: null,
    representante_id: null,
    ref_fornecedor: "",
    ref: null,
    composicao: "",
    foto_url: null,
    data_pedido: null,
    data_prevista: null,
    data_entrega: null,
    grade_proporcao: {},
    qtd_total: 0,
    moeda_compra: "RMB",
    moeda_intermediaria: "USD",
    valor_unitario_m1: 0,
    cotacao_ref: 0,
    peso_kg: 0,
    transporte_m2: 0,
    desconto_pct: 0,
    cotacao_final: 0,
    markup_atacado: null,
    markup_varejo: null,
    preco_atacado_fixo: null,
    preco_varejo_fixo: null,
    modeloPrecoVenda: null,
    variantes: [{ ordem: 1, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 0, _touched: false }],
    etapas: [
      { ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 30, data_vencimento: null, cotacao: 0 },
      { ordem: 2, rotulo: "Saldo", base: "mercadoria", percentual: 70, data_vencimento: null, cotacao: 0 },
      { ordem: 3, rotulo: "Frete", base: "frete", percentual: 100, data_vencimento: null, cotacao: 0 },
    ],
  };
}

/** Só os campos que a TELA edita — usado como snapshot do dirty-guard/merge colab, espelha
 *  `chaveDirty` de `produto-acabado/shared.ts`. NÃO inclui `rev` (read-only, bumpa sozinho no
 *  refetch — incluir aqui faria qualquer merge "sujar" o produto à toa) nem `modelo_id`/`mix_id`
 *  (read-only, associados por outros fluxos — Criar card / EditarMixDialog — não pela edição do
 *  card). `etapas`/`variantes` entram como VALOR (array) — o merge trata como campo grão-grosso
 *  (conflito all-or-nothing no array inteiro se ambos os lados mexeram nele); não há merge por
 *  linha de etapa/variante aqui, aceitável (ver comentário no Sheet). */
export function chaveDirty(d: ProdutoImportadoDraft) {
  return {
    id: d.id,
    nome: d.nome,
    grupo_id: d.grupo_id,
    categoria_id: d.categoria_id,
    subcategoria1_id: d.subcategoria1_id,
    subcategoria2_id: d.subcategoria2_id,
    empresa_id: d.empresa_id,
    representante_id: d.representante_id,
    ref_fornecedor: d.ref_fornecedor,
    ref: d.ref,
    composicao: d.composicao,
    foto_url: d.foto_url,
    data_pedido: d.data_pedido,
    data_prevista: d.data_prevista,
    data_entrega: d.data_entrega,
    grade_proporcao: d.grade_proporcao,
    qtd_total: d.qtd_total,
    moeda_compra: d.moeda_compra,
    moeda_intermediaria: d.moeda_intermediaria,
    valor_unitario_m1: d.valor_unitario_m1,
    cotacao_ref: d.cotacao_ref,
    peso_kg: d.peso_kg,
    transporte_m2: d.transporte_m2,
    desconto_pct: d.desconto_pct,
    cotacao_final: d.cotacao_final,
    markup_atacado: d.markup_atacado,
    markup_varejo: d.markup_varejo,
    preco_atacado_fixo: d.preco_atacado_fixo,
    preco_varejo_fixo: d.preco_varejo_fixo,
    variantes: d.variantes,
    etapas: d.etapas,
  };
}

/** Σ qtd de todas as variantes (mesma ideia de `somaPecas`, Produto Acabado) — usada pro
 *  modo BIDIRECIONAL: editar a qtd de 1 variante recalcula `qtd_total` = Σ variantes. */
export function qtdTotalDeVariantes(variantes: VarianteImportadoDraft[]): number {
  return variantes.reduce((s, v) => s + (Number(v.qtd) || 0), 0);
}

/** Aplica `ratearPorPeso(qtd_total, pesos)` às variantes NÃO-touched do draft — as
 *  `_touched` (o usuário editou a qtd à mão) preservam o valor atual. Devolve a lista de
 *  variantes atualizada (não muta `draft`). Se TODAS estiverem touched, devolve como está
 *  (nada a ratear). */
export function recalcVariantesPorPeso(draft: Pick<ProdutoImportadoDraft, "variantes" | "qtd_total">): VarianteImportadoDraft[] {
  const { variantes, qtd_total } = draft;
  const naoTouched = variantes.filter((v) => !v._touched);
  if (naoTouched.length === 0) return variantes;
  // Qtd disponível pro rateio automático = total menos o que já foi fixado manualmente.
  const qtdTouched = variantes.filter((v) => v._touched).reduce((s, v) => s + (Number(v.qtd) || 0), 0);
  const qtdParaRatear = Math.max(0, (Number(qtd_total) || 0) - qtdTouched);
  const pesos = Object.fromEntries(naoTouched.map((v) => [String(v.ordem), v.peso]));
  const rateado = ratearPorPeso(qtdParaRatear, pesos);
  return variantes.map((v) => (v._touched ? v : { ...v, qtd: rateado[String(v.ordem)] ?? 0 }));
}

/** Monta a `EntradaLanded` do draft e chama `custoLanded` (moeda.ts) — NÃO reimplementa a
 *  conta aqui, só molda o shape. `freteUnitarioM2` = peso_kg × transporte_m2 (seção 5). */
export function custoDoDraft(draft: ProdutoImportadoDraft): ResultadoLanded {
  const etapas: EtapaPagamento[] = draft.etapas.map((e) => ({ base: e.base, percentual: e.percentual, cotacao: e.cotacao }));
  const entrada: EntradaLanded = {
    valorUnitarioM1: draft.valor_unitario_m1,
    qtdTotal: draft.qtd_total,
    freteUnitarioM2: (Number(draft.peso_kg) || 0) * (Number(draft.transporte_m2) || 0),
    descontoPct: draft.desconto_pct,
    etapas,
    cotacaoFinal: draft.cotacao_final,
  };
  return custoLanded(entrada);
}

/** Cadeia de markup (custo → atacado → varejo) a partir do `unitarioBrl` calculado por
 *  `custoDoDraft` — mesma fonte única `cadeiaMarkup` do moeda.ts. */
export function precosDoDraft(draft: ProdutoImportadoDraft, resultado?: ResultadoLanded): { atacado: number; varejo: number } {
  const unitarioBrl = (resultado ?? custoDoDraft(draft)).unitarioBrl;
  const c = cadeiaMarkup(unitarioBrl, draft.markup_atacado ?? 0, draft.markup_varejo ?? 0);
  // D14: o preço FIXO manda ("última edição manda" — mesma regra do servidor).
  return { atacado: draft.preco_atacado_fixo ?? c.atacado, varejo: draft.preco_varejo_fixo ?? c.varejo };
}

/** Σ% por base (mercadoria/frete) das etapas de pagamento. */
export function somaPercentualPorBase(etapas: EtapaImportadoDraft[], base: "mercadoria" | "frete"): number {
  return etapas.filter((e) => e.base === base).reduce((s, e) => s + (Number(e.percentual) || 0), 0);
}

/** Resumo agregado de uma lista de drafts (barra de resumo do planejador). Tudo em BRL
 *  landed × quantidade — o "poder de compra/venda" da coleção. Custos e preços vêm da mesma
 *  fonte única (custoDoDraft/precosDoDraft → moeda.ts). */
export type ResumoImportado = { produtos: number; pecas: number; custoTotalBrl: number; atacadoTotalBrl: number; varejoTotalBrl: number };
export function resumoDrafts(drafts: ProdutoImportadoDraft[]): ResumoImportado {
  let pecas = 0, custoTotalBrl = 0, atacadoTotalBrl = 0, varejoTotalBrl = 0;
  for (const d of drafts) {
    const qtd = Number(d.qtd_total) || 0;
    const custo = custoDoDraft(d);
    const precos = precosDoDraft(d, custo);
    pecas += qtd;
    custoTotalBrl += custo.unitarioBrl * qtd;
    atacadoTotalBrl += precos.atacado * qtd;
    varejoTotalBrl += precos.varejo * qtd;
  }
  return { produtos: drafts.length, pecas, custoTotalBrl, atacadoTotalBrl, varejoTotalBrl };
}

/** Monta o payload `{dados, variantes, etapas}` esperado por `salvar_produto_importado`
 *  a partir do draft. `dados` só leva os escalares do produto (nada de `id`/`variantes`/
 *  `etapas`/`ref`/`_touched` — a RPC ignora chaves extras, mas mantemos o shape enxuto);
 *  datas já são string "YYYY-MM-DD" ou null no draft — passam direto. Markups vazios (0 ou
 *  null) viram `null` (a RPC trata `null` como "sem markup configurado", preservando o
 *  valor atual do modelo espelho em vez de zerar o preço). */
export function montarPayload(draft: ProdutoImportadoDraft): {
  dados: Record<string, unknown>;
  variantes: Omit<VarianteImportadoDraft, "_touched">[];
  etapas: EtapaImportadoDraft[];
} {
  const dados = {
    nome: draft.nome,
    // REF: só envia se o usuário digitou uma manual (senão null → o trigger gera a automática).
    ref: draft.ref || null,
    grupo_id: draft.grupo_id,
    categoria_id: draft.categoria_id,
    subcategoria1_id: draft.subcategoria1_id,
    subcategoria2_id: draft.subcategoria2_id,
    colecao_id: draft.colecao_id,
    subcolecao: draft.subcolecao,
    semana: draft.semana,
    empresa_id: draft.empresa_id,
    representante_id: draft.representante_id,
    ref_fornecedor: draft.ref_fornecedor || null,
    composicao: draft.composicao || null,
    grade_proporcao: draft.grade_proporcao,
    qtd_total: draft.qtd_total,
    foto_url: draft.foto_url,
    data_pedido: draft.data_pedido,
    data_prevista: draft.data_prevista,
    data_entrega: draft.data_entrega,
    moeda_compra: draft.moeda_compra,
    moeda_intermediaria: draft.moeda_intermediaria,
    valor_unitario_m1: draft.valor_unitario_m1,
    cotacao_ref: draft.cotacao_ref,
    peso_kg: draft.peso_kg,
    transporte_m2: draft.transporte_m2,
    desconto_pct: draft.desconto_pct,
    cotacao_final: draft.cotacao_final,
    markup_atacado: draft.markup_atacado || null,
    markup_varejo: draft.markup_varejo || null,
    // D14/R1 (Integração): preço FIXO exato por canal — o _salvar_produto_importado_core grava NESTA transação (a do _rev_base):
    // fixo zera o markup do canal; sem fixo, markup não-nulo limpa o fixo; sem os dois, o fixo fica.
    preco_atacado_fixo: draft.preco_atacado_fixo ?? null,
    preco_varejo_fixo: draft.preco_varejo_fixo ?? null,
  };
  const variantes = draft.variantes.map(({ ordem, cor_id, cor_apelido_id, peso, qtd }) => ({ ordem, cor_id, cor_apelido_id, peso, qtd }));
  const etapas = draft.etapas.map(({ ordem, rotulo, base, percentual, data_vencimento, cotacao }) => ({ ordem, rotulo, base, percentual, data_vencimento, cotacao }));
  return { dados, variantes, etapas };
}

/** Validação client-side do draft para SALVAR (rascunho) — retorna a MENSAGEM do primeiro problema,
 *  ou `null` se está tudo certo. Regras LENIENTES: nome obrigatório; Σ% de mercadoria = 100 e Σ% de
 *  frete = 100 QUANDO há etapas da base. NÃO exige `qtd_total > 0` — um produto pode ser salvo como
 *  rascunho (a quantidade se preenche depois; só o "Fazer pedido" exige qtd, ver `validarParaPedido`).
 *  Isso corrige a "falha ao salvar" (um produto recém-criado tem qtd 0 e bloqueava o save de todos). */
export function validarDraft(draft: ProdutoImportadoDraft): string | null {
  if (!draft.nome.trim()) return "Informe o nome do produto.";
  const somaMerc = somaPercentualPorBase(draft.etapas, "mercadoria");
  if (draft.etapas.some((e) => e.base === "mercadoria") && somaMerc !== 100) {
    return `Σ% das etapas de mercadoria (${somaMerc}%) precisa fechar 100%.`;
  }
  const somaFrete = somaPercentualPorBase(draft.etapas, "frete");
  if (draft.etapas.some((e) => e.base === "frete") && somaFrete !== 100) {
    return `Σ% das etapas de frete (${somaFrete}%) precisa fechar 100%.`;
  }
  return null;
}

/** Validação ESTRITA para "Fazer pedido" (gerar a OC) — tudo do `validarDraft` + exige qtd_total > 0
 *  (não faz sentido pedir 0 peças). Usada só no fluxo de OC, não no salvar do rascunho. */
export function validarParaPedido(draft: ProdutoImportadoDraft): string | null {
  const base = validarDraft(draft);
  if (base) return base;
  if (!(Number(draft.qtd_total) > 0)) return "Qtd total precisa ser maior que zero.";
  return null;
}

// ── Integração F4 — Fix round 1 (I-1/I-2/M-1/M-3/M-4) ────────────────────────────────────────
// Ruling da revisão: o payload NUNCA pode reenviar um campo travado editado antes do lock chegar —
// isso 42501 o save do produto INTEIRO (nome/ref/foto) OU, pior, passa silenciosamente e reescreve o
// preço fixo travado (markup varejo digitado antes do lock: D12 no banco deixa "limpar o fixo" passar
// mesmo travado). Mirror do `omitirColunasTravadas`/`resolverColunasTravadas` do Sheet do Planejamento
// (usePlanejamentoSave.ts) — aqui os campos são os do DRAFT do Importado, não os de `modelos`: nome,
// ref, foto_url e o PAR {preco_varejo_fixo, markup_varejo} (D34/R8 — trava é só o varejo; atacado livre).

/** Colunas do draft do Importado que o gatilho `fn_integracao_trava_espelho` de fato guarda —
 *  espelha 1:1 as colunas checadas em `produtos_importados` (nome/ref/foto_url) + o PAR do
 *  preço varejo (preco_varejo_fixo/markup_varejo, D34: SÓ varejo — atacado nunca trava). `variantes`
 *  (Fix round 2, N-1) é tratado à parte — `fn_integracao_trava_variantes` é um gatilho DIFERENTE
 *  (na tabela de variantes, não em `produtos_importados`), comparando o conjunto DISTINCT de
 *  (cor_id, cor_apelido_id) — não um `===` de valor escalar como os demais campos. */
export type CampoTravavel = "nome" | "ref" | "foto_url" | "preco_varejo_fixo" | "markup_varejo";
/** Mapa "coluna travada pela Integração" (`travaIntegracao.has(...)`, `src/lib/integracao/trava.ts`,
 *  chaves de `modelos`) → campo(s) do DRAFT deste produto que ela cobre. `preco_venda` cobre os 2
 *  campos do par (M-3: tratados como uma unidade — nunca só um dos dois). */
export const CAMPOS_TRAVAVEIS_POR_COLUNA: Record<string, readonly CampoTravavel[]> = {
  nome: ["nome"],
  ref: ["ref"],
  fotos_modelo: ["foto_url"],
  preco_venda: ["preco_varejo_fixo", "markup_varejo"],
};

export type AvisoTrava = { campo: CampoTravavel | "variantes"; rotulo: string };
export type ResolucaoTravaProduto = {
  /** Patch com o valor do SERVIDOR para cada campo travado presente no draft — aplicado
   *  INCONDICIONALMENTE (revert do draft vivo + base do próximo merge/baseline), mesmo quando o
   *  valor enviado já batia com o servidor (evita "não salvo" fantasma no próximo refetch). */
  paraServidor: Partial<Record<CampoTravavel, unknown>>;
  /** N-1 (Fix round 2) — patch SEPARADO pras variantes (array, não escalar): presente só quando as
   *  cores do draft divergem das cores do servidor E `variantes` está travado (SEMPRE_TRAVADO —
   *  `travaAtual` sempre tem essa coluna quando há QUALQUER lock). Reverte o array INTEIRO ao do
   *  servidor — a trava compara o conjunto de cores, não célula a célula, então um revert parcial
   *  (só as cores) ainda arriscaria fikar com uma `ordem` órfã; o array completo do servidor é o
   *  único estado GARANTIDO de bater com `variantes_chaves` travado. */
  variantesParaServidor: VarianteImportadoDraft[] | null;
  /** R2-2 (Fix round 3, ruling do coordenador) — junto do revert de `variantes`, reverte
   *  `qtd_total` ao valor do SERVIDOR também — sem isto a soma das variantes revertidas podia
   *  divergir de `qtd_total` (o draft mantinha o total editado enquanto as variantes voltavam pro
   *  servidor), gerando um estado LOCALMENTE inconsistente (e, no PA, um `P0001 soma variantes
   *  difere total` no servidor — achado do re-review). `null` quando `variantesParaServidor` é
   *  `null` (nada revertido). */
  qtdTotalParaServidor: number | null;
  /** Só os campos EDITADOS nesta sessão (via `touched`) cujo valor divergia do servidor — vira o
   *  toast PT "essa alteração não foi salva" (uma coluna canonizada mas não tocada não avisa). */
  avisos: AvisoTrava[];
};
const ROTULO_CAMPO_TRAVADO: Record<CampoTravavel, string> = {
  nome: "Nome", ref: "REF", foto_url: "Foto", preco_varejo_fixo: "Valor varejo", markup_varejo: "Markup Varejo",
};
/** Conjunto DISTINCT de "cor_id|cor_apelido_id" ordenado — espelha `_sku_variante_key` +
 *  `ARRAY(SELECT DISTINCT ... ORDER BY 1)` de `fn_integracao_trava_variantes` (m4:253-318) byte a
 *  byte o bastante pra decidir SE o conjunto mudou (não precisa ser a key exata do SQL — só a
 *  comparação de igualdade de conjunto, que é o que o gatilho faz). */
function coresDistintas(variantes: readonly Pick<VarianteImportadoDraft, "cor_id" | "cor_apelido_id">[]): string[] {
  return [...new Set(variantes.map((v) => `${v.cor_id ?? ""}|${v.cor_apelido_id ?? ""}`))].sort();
}
/** PURA — dado o draft que SERIA enviado, o draft do servidor (última leitura confiável,
 *  `baseServidorRef`), o lock ATUAL (`travaIntegracao`, `Set` de colunas de `modelos`/trava.ts) e o
 *  conjunto de campos TOCADOS nesta sessão (diff de `chaveDirty` vs a base), devolve: (a) o patch que
 *  reverte cada campo travado ao valor do servidor — SEMPRE os 2 do par junto (M-3: preço fixo e
 *  markup do varejo são uma unidade; travar um implica reverter os dois, nunca só um) — (b) o revert
 *  de `variantes` quando as cores mudaram e a trava está ativa (N-1, Fix round 2 — `variantes` está
 *  em `SEMPRE_TRAVADO`, então `travaAtual` sempre a contém quando HÁ qualquer lock no produto) — e
 *  (c) os avisos PT (só os campos/variantes tocados cujo valor enviado divergia do servidor). Nunca
 *  lê/grava nada — quem chama aplica o patch no payload/draft/baseline. */
export function resolverTravaImportado(o: {
  enviado: ProdutoImportadoDraft;
  servidor: ProdutoImportadoDraft | null | undefined;
  travaAtual: ReadonlySet<string> | null | undefined;
  touched: ReadonlySet<string>;
}): ResolucaoTravaProduto {
  const { enviado, servidor, travaAtual, touched } = o;
  if (!travaAtual || travaAtual.size === 0 || !servidor) return { paraServidor: {}, variantesParaServidor: null, qtdTotalParaServidor: null, avisos: [] };
  const paraServidor: Partial<Record<CampoTravavel, unknown>> = {};
  const avisos: AvisoTrava[] = [];
  const camposJaVistos = new Set<CampoTravavel>();
  for (const coluna of travaAtual) {
    const campos = CAMPOS_TRAVAVEIS_POR_COLUNA[coluna];
    if (!campos) continue; // coluna travada que este draft nem tem por esta via (ex.: tamanho_tipo/sku — outra classe; "variantes" tratado abaixo)
    for (const campo of campos) {
      if (camposJaVistos.has(campo)) continue; // 2 colunas do lock nunca mapeiam pro mesmo campo aqui, mas defensivo
      camposJaVistos.add(campo);
      const valorServidor = servidor[campo];
      paraServidor[campo] = valorServidor; // M-3/I-1: sempre reverte, incondicional — vira a base do merge
      // M-3: o PAR do preço varejo entra como aviso se QUALQUER um dos dois foi tocado (não só o
      // que mudou) — "digitou markup, o preço tinha sido o tocado antes" ainda é uma edição perdida
      // do canal varejo como um todo.
      const camposDoPar = coluna === "preco_venda" ? (["preco_varejo_fixo", "markup_varejo"] as const) : ([campo] as const);
      const tocadoNoSentidoDoPar = camposDoPar.some((c) => touched.has(c));
      if (!tocadoNoSentidoDoPar) continue;
      const valorEnviado = enviado[campo];
      if (valorEnviado === valorServidor) continue;
      avisos.push({ campo, rotulo: ROTULO_CAMPO_TRAVADO[campo] });
    }
  }
  // N-1 (Fix round 2) — variantes: SEMPRE travado (SEMPRE_TRAVADO), então `travaAtual.has("variantes")`
  // é verdade sempre que há QUALQUER lock. Compara o CONJUNTO de cores (não célula a célula — D11: qtd/
  // peso ficam livres) contra o servidor; se divergiu, reverte o array INTEIRO (única forma de garantir
  // que o conjunto bate com `variantes_chaves` travado) e avisa só se `variantes` foi tocado.
  // R2-2 (Fix round 3) — reverte `qtd_total` JUNTO (mesmo `if`), pro total continuar consistente com a
  // soma das variantes revertidas — sem isto o PA batia num `P0001 soma variantes difere total` no
  // servidor no próximo Salvar (achado do re-review, `qtd_total` local ficava desalinhado do array
  // revertido). Aviso PT muda de texto quando isto acontece ("Cores e quantidades..."), pra não
  // implicar que só as cores foram descartadas.
  let variantesParaServidor: VarianteImportadoDraft[] | null = null;
  let qtdTotalParaServidor: number | null = null;
  if (travaAtual.has("variantes")) {
    const coresEnviado = coresDistintas(enviado.variantes);
    const coresServidor = coresDistintas(servidor.variantes);
    if (JSON.stringify(coresEnviado) !== JSON.stringify(coresServidor)) {
      variantesParaServidor = servidor.variantes;
      qtdTotalParaServidor = servidor.qtd_total;
      if (touched.has("variantes") || touched.has("qtd_total")) {
        avisos.push({ campo: "variantes", rotulo: "Cores e quantidades das variantes" });
      }
    }
  }
  return { paraServidor, variantesParaServidor, qtdTotalParaServidor, avisos };
}
/** PT — "Nome foi travado…"/"Valor varejo e Markup Varejo foram travados…"/"Cores e quantidades das
 *  variantes foram travadas…" — espelha `toastDescartadasPelaIntegracao` (usePlanejamentoSave.ts),
 *  mesma gramática. R2-2 (Fix round 3): o rótulo "Cores e quantidades das variantes" já vem no PLURAL
 *  do `resolverTravaImportado`/`resolverTravaAcabado` acima — combinado sozinho ele fica
 *  "Cores e quantidades das variantes foi travado" com a gramática padrão (`rotulos.length<=1` singular),
 *  então esse caso pede o texto exato do ruling ("foram travadas") — tratado à parte aqui. */
export function toastTravaImportado(avisos: readonly AvisoTrava[]): string {
  if (avisos.length === 1 && avisos[0].campo === "variantes") {
    return "Cores e quantidades das variantes foram travadas pela Integração enquanto você editava — essa alteração não foi salva.";
  }
  const rotulos = avisos.map((a) => a.rotulo);
  const lista = rotulos.length <= 1 ? (rotulos[0] ?? "") : `${rotulos.slice(0, -1).join(", ")} e ${rotulos[rotulos.length - 1]}`;
  const verbo = rotulos.length <= 1 ? "foi travado" : "foram travados";
  return `${lista} ${verbo} pela Integração enquanto você editava — essa alteração não foi salva.`;
}
/** Aplica `resolverTravaImportado` a um draft — devolve o draft JÁ revertido para os campos
 *  travados (nunca muta `draft`). Usado pelo `salvarUmProduto` ANTES de `montarPayload`, e pelo
 *  Sheet pra reverter o rascunho vivo/baseline com o MESMO patch (M-3/I-1: um único ponto de
 *  verdade — o payload e a tela nunca podem divergir sobre "o que o servidor realmente tem"). */
export function aplicarResolucaoTrava(draft: ProdutoImportadoDraft, resolucao: ResolucaoTravaProduto): ProdutoImportadoDraft {
  if (Object.keys(resolucao.paraServidor).length === 0 && !resolucao.variantesParaServidor) return draft;
  return {
    ...draft,
    ...resolucao.paraServidor,
    ...(resolucao.variantesParaServidor ? { variantes: resolucao.variantesParaServidor } : {}),
    ...(resolucao.qtdTotalParaServidor != null ? { qtd_total: resolucao.qtdTotalParaServidor } : {}),
  } as ProdutoImportadoDraft;
}

/** M-4 — markup varejo EXIBIDO: o gravado (`draft.markup_varejo`) OU, quando há preço fixo, o
 *  DERIVADO (preço ÷ base) — espelha `markupVarejoExib` do Produto Acabado (`ProdutoCard.tsx`),
 *  "digitar o preço preenche o markup em vez de deixá-lo vazio". `baseImp <= 0` não deriva (sem
 *  base não dá pra calcular markup). */
export function markupVarejoExibido(draft: Pick<ProdutoImportadoDraft, "markup_varejo" | "preco_varejo_fixo">, baseImp: number): number | null {
  if (draft.markup_varejo != null) return draft.markup_varejo;
  if (draft.preco_varejo_fixo != null && baseImp > 0) return draft.preco_varejo_fixo / baseImp;
  return null;
}
/** Espelho para o atacado (mesma fórmula; D34 nunca trava, mas M-4 pede paridade visual com o
 *  varejo — os dois campos devem se comportar igual quando o usuário digita o preço). */
export function markupAtacadoExibido(draft: Pick<ProdutoImportadoDraft, "markup_atacado" | "preco_atacado_fixo">, baseImp: number): number | null {
  if (draft.markup_atacado != null) return draft.markup_atacado;
  if (draft.preco_atacado_fixo != null && baseImp > 0) return draft.preco_atacado_fixo / baseImp;
  return null;
}

// M-3 (Fix round 1, ruling da revisão) — o merge 3-vias genérico (`mergeDraft`, `@/lib/colab/merge`)
// trata `preco_varejo_fixo`/`markup_varejo` como 2 campos INDEPENDENTES. Mas o servidor (J2, a mesma
// regra 4-casos que `montarPayload`/`precosDoDraft` espelham) trata o par como UMA unidade: definir um
// zera o outro. Cenário do achado: A edita markup varejo (toca só `markup_varejo`); B salva um preço
// varejo fixo; o merge adota o `preco_varejo_fixo` de B silenciosamente (não tocado por A) e ACUSA
// conflito só em `markup_varejo`; A resolve "manter meu" e o draft fica com OS DOIS setados (preço 298
// E markup 3) — um estado que o `_salvar_produto_importado_core` NUNCA produz sozinho (regra 4: fixo
// presente ganha, markup vira null). No próximo Salvar o servidor aplica a regra, o markup some, e como
// a baseline local tinha guardado "markup 3" (o que foi ENVIADO), ela nunca mais bate com o servidor —
// "não salvo" para sempre. Fix: depois do `mergeDraft` normal, uma passada de ACOPLAMENTO — qualquer
// conflito em preco_varejo_fixo OU markup_varejo vira conflito nos DOIS (o usuário decide o CANAL
// inteiro, "manter meu" ou "usar o novo" nunca deixa a dupla inconsistente); e quando NENHUM dos dois
// conflita mas o valor final ainda tem os dois setados (ex.: o "meu" tinha os dois desde antes — draft
// legado), NORMALIZA como o servidor faria (fixo manda, markup→null) — nunca deixa a dupla junta.
//
// Fix round 2 (N-2, re-review) — REGRESSÃO no acoplamento original: o conflito ESPELHADO usava
// `(o.valor as any)[campoEspelhado]` (o que o MERGE já tinha adotado do fresh pro campo espelhado —
// ou seja, o valor DO OUTRO usuário) como `meu`, e `origem.dele` (o `dele` do OUTRO campo do par) como
// `dele` — os dois errados. Cenário provado pelo harness `rr-m3b.ts`: A digita Valor 310 (toca só
// `preco_varejo_fixo`); B salva Markup 2. O acoplamento antigo dava ao campo espelhado
// (`markup_varejo`) `{meu: 2 (o QUE B TEM, adotado pelo merge — não é "meu" de A!), dele: null}` —
// "usar o novo" nos dois campos mandava `{vf: null, vm: null}`, apagando o markup 2 que B tinha
// SALVO DE VERDADE. Fix: passa `draft`/`fresh` explícitos (não só o `valor` pós-merge) — o campo
// espelhado usa `meu = draft[campoEspelhado]` (o que ESTE usuário realmente tinha, tocado ou não) e
// `dele = fresh[campoEspelhado]` (o que o SERVIDOR realmente tem nesse campo — nunca o `dele` do outro
// campo do par). `valor[campoEspelhado]` (o "meu" que a UI mostra ANTES de resolver) também volta a
// ser `draft[campoEspelhado]`, não o que o merge cru tinha adotado do fresh.
export type ParVarejo = { preco_varejo_fixo: number | null; markup_varejo: number | null };
export function acoplarParVarejo<T extends ParVarejo>(o: { valor: T; conflitos: Conflito[]; draft: ParVarejo; fresh: ParVarejo }): { valor: T; conflitos: Conflito[] } {
  const temConflitoFixo = o.conflitos.some((c) => c.path === "preco_varejo_fixo");
  const temConflitoMarkup = o.conflitos.some((c) => c.path === "markup_varejo");
  let conflitos = o.conflitos;
  let valor = o.valor;
  if (temConflitoFixo !== temConflitoMarkup) {
    // Só um dos dois conflitou — espelha um conflito NOVO no outro campo do par, construído das
    // FONTES CORRETAS (N-2): meu = o que ESTE draft tinha nesse campo, dele = o que o SERVIDOR
    // (fresh) tem nesse MESMO campo — nunca o valor/campo do OUTRO lado do par.
    const campoEspelhado = temConflitoFixo ? "markup_varejo" : "preco_varejo_fixo";
    conflitos = [...o.conflitos, { path: campoEspelhado, meu: o.draft[campoEspelhado], dele: o.fresh[campoEspelhado] }];
    // O "meu" que a tela mostra antes de resolver também é o do MEU draft (N-2) — o merge cru pode
    // ter adotado o fresh nesse campo (não tocado por mim), mas aqui o par virou conflito — a UI
    // precisa mostrar o que EU tinha, não o que já foi silenciosamente sobrescrito.
    valor = { ...valor, [campoEspelhado]: o.draft[campoEspelhado] };
  }
  const aindaConflitando = conflitos.some((c) => c.path === "preco_varejo_fixo" || c.path === "markup_varejo");
  if (!aindaConflitando && valor.preco_varejo_fixo != null && valor.markup_varejo != null) {
    // Draft convergiu SEM conflito mas ainda tem os 2 setados (legado/canonização) — normaliza como
    // o servidor faria (regra 1 do J2: fixo presente ganha, markup vira null) pra nunca mostrar um
    // estado impossível de bater com o que `_salvar_produto_importado_core` vai persistir.
    valor = { ...valor, markup_varejo: null };
  }
  return { valor, conflitos };
}
/** Mesmo acoplamento para o par do atacado (paridade — D34 nunca trava o atacado, mas o par ainda é
 *  uma unidade do lado do servidor/merge, mesma regra J2). Mesmo fix N-2 do varejo acima. */
export type ParAtacado = { preco_atacado_fixo: number | null; markup_atacado: number | null };
export function acoplarParAtacado<T extends ParAtacado>(o: { valor: T; conflitos: Conflito[]; draft: ParAtacado; fresh: ParAtacado }): { valor: T; conflitos: Conflito[] } {
  const temConflitoFixo = o.conflitos.some((c) => c.path === "preco_atacado_fixo");
  const temConflitoMarkup = o.conflitos.some((c) => c.path === "markup_atacado");
  let conflitos = o.conflitos;
  let valor = o.valor;
  if (temConflitoFixo !== temConflitoMarkup) {
    const campoEspelhado = temConflitoFixo ? "markup_atacado" : "preco_atacado_fixo";
    conflitos = [...o.conflitos, { path: campoEspelhado, meu: o.draft[campoEspelhado], dele: o.fresh[campoEspelhado] }];
    valor = { ...valor, [campoEspelhado]: o.draft[campoEspelhado] };
  }
  const aindaConflitando = conflitos.some((c) => c.path === "preco_atacado_fixo" || c.path === "markup_atacado");
  if (!aindaConflitando && valor.preco_atacado_fixo != null && valor.markup_atacado != null) {
    valor = { ...valor, markup_atacado: null };
  }
  return { valor, conflitos };
}

// M-3 (Fix round 2, ruling do coordenador) — a normalização em `acoplarPar*` só roda quando NÃO há
// conflito (draft convergiu sozinho). O caso do achado é o OPOSTO: HÁ conflito (nos 2 campos, já
// acoplados acima), e o usuário RESOLVE ("manter meu" ou "usar o novo") — em cada lado, ele escolhe UM
// valor por campo, mas os 2 campos continuam sendo escolhidos INDEPENDENTEMENTE pelo `<ColabBanner>`
// genérico (2 linhas na lista de conflitos, 1 por campo). Se ele escolhe "manter meu" nos dois, o
// resultado pode ser {fixo:298, markup:3} de novo (ambos os "meu" do draft) — exatameente o estado
// impossível que a regra do servidor nunca produz. Fix: depois que os 2 campos do par foram resolvidos
// (ambos escolhidos, "meu" ou "dele" — não necessariamente a MESMA escolha nos dois), aplica a MESMA
// regra "última edição manda" do servidor (J2 regra 1): se o valor final tem AMBOS setados, o
// FIXO manda e o MARKUP vira null (mesma regra de normalização já usada quando não há conflito) —
// dessa forma "manter meu" (298/3) e "usar o novo" (null/null, se o servidor tinha limpo os dois)
// SEMPRE convergem pro que o servidor vai persistir, nunca ficando "não salvo" para sempre.
export function normalizarParVarejoAposResolucao<T extends ParVarejo>(valor: T): T {
  if (valor.preco_varejo_fixo != null && valor.markup_varejo != null) return { ...valor, markup_varejo: null };
  return valor;
}
export function normalizarParAtacadoAposResolucao<T extends ParAtacado>(valor: T): T {
  if (valor.preco_atacado_fixo != null && valor.markup_atacado != null) return { ...valor, markup_atacado: null };
  return valor;
}

// Fix round 3 (R2-1, ruling do coordenador) — REGRESSÃO do fix acima: `onResolver` normalizava o par
// INCONDICIONALMENTE a cada clique, mesmo com o OUTRO campo do mesmo par ainda pendente no banner.
// Cenário (S4 do re-review 2, harness `rr2-harness.ts`): base markup 2.5; A digita fixo 310 (toca só
// preco_atacado_fixo); B salva markup 3. O merge lista o conflito do MARKUP primeiro (não tocado por A,
// mas o campo espelhado pelo acoplamento). A clica "usar o novo" no markup PRIMEIRO — o draft vira
// {fixo: 310 (intocado, ainda "meu"), markup: 3 (de B, "usar o novo")} — e a normalização incondicional
// já rodava AQUI, apagando o markup de B (fixo manda) ANTES do campo fixo ser resolvido. Quando A resolve
// o fixo em seguida, o markup de B já tinha sumido — o EXATO cenário que N-2 (fix round 2) corrigiu nos
// valores `meu`/`dele`, reintroduzido pela normalização precoce.
/** PURA — dado os campos do par (`["preco_x_fixo","markup_x"]`) e a lista de conflitos RESTANTES deste
 *  produto DEPOIS desta resolução (ou seja, já sem o campo que acabou de ser clicado), devolve se é
 *  seguro normalizar o par agora: só quando NENHUM dos 2 campos do par continua pendente na lista. */
export function devePodeNormalizarPar(camposDoPar: readonly string[], conflitosRestantes: readonly Conflito[]): boolean {
  return !conflitosRestantes.some((c) => camposDoPar.includes(c.path));
}
/** Campos do par (varejo/atacado) que `campo` pertence — `null` se `campo` não é um dos 4 campos de
 *  preço/markup (ex.: nome/ref/foto/variantes, que não têm par). Usado por `onResolver` (Sheet) e pelo
 *  replay de teste pra decidir SE/QUAL normalização rodar após um clique. */
export function parDoCampo(campo: string): readonly ["preco_varejo_fixo", "markup_varejo"] | readonly ["preco_atacado_fixo", "markup_atacado"] | null {
  if (campo === "preco_varejo_fixo" || campo === "markup_varejo") return ["preco_varejo_fixo", "markup_varejo"] as const;
  if (campo === "preco_atacado_fixo" || campo === "markup_atacado") return ["preco_atacado_fixo", "markup_atacado"] as const;
  return null;
}
