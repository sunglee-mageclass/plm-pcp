// [urg R13] OC por fornecedor com VÁRIOS produtos (Produto Acabado e Produto Importado) — lógica PURA
// (sem React, sem supabase). O assistente `components/shared/PedidoOcLoteWizard` usa só estas funções.
//
// Modelo (P-354..P-363): 1 OC por fornecedor (PA: empresa+representante; PI: + moeda), com N produtos; parcelas sobre o
// TOTAL da OC (P-355); acabado e importado nunca se misturam (P-356); sem limite de produtos por OC (P-357). Quem monta o
// item e o número é o SERVIDOR (`fazer_pedido_p_acabado` / `fazer_pedido_importado`, 1 transação, tudo ou nada); aqui só:
//   - elegibilidade (quem fica de fora e por quê, em PT) — espelho de `_oc_produto_motivos`;
//   - agrupamento por fornecedor (prévia) e prévia da sigla do nº da OC — espelho de `_oc_lote_sigla`;
//   - herança do cabeçalho entre as páginas (como o `FazerPedidoWizard` do Plan. Tecido);
//   - totais (sem R$ para quem não vê custos) e a montagem do `_pedidos` enviado ao servidor.

import { cadeiaValores, ehGrupoAcessorio, norm3 } from "@/lib/produto-acabado";
import { contarParcelasPrazo } from "@/components/oc-p-acabado/shared";

export type FamiliaPedido = "acabado" | "importado";

// ── Elegibilidade (espelho de `_oc_produto_motivos`; mesma ordem e mesmo critério do `motivosForaDoPedido` de 93ce43e1) ──

/** Texto que o card já usa quando há conflito de edição pendente na coleção — fonte única do card e do assistente. */
export const TEXTO_CONFLITO_PEDIDO = "Há conflitos de edição pendentes nesta coleção — resolva-os antes de fazer o pedido.";
const TEXTO_CONFLITO_DO_PRODUTO = "Este produto tem conflito de edição pendente — resolva-o antes de fazer o pedido.";

export type CodigoMotivoPedido =
  | "ja_tem_oc"
  | "conflito"
  | "sem_nome"
  | "sem_fornecedor"
  | "sem_quantidade"
  | "sem_variantes"
  | "soma_nao_bate"
  | "grade_vazia"
  | "sem_valor"
  | "validacao";

export type MotivoPedido = { codigo: CodigoMotivoPedido; texto: string };

/** O que a elegibilidade precisa saber de um produto — cada família preenche (adaptadores nos `shared.ts`). */
export type EntradaPedido = {
  /** Já existe OC vinculada (o servidor recusaria: 1 OC ativa por produto). */
  temOc: boolean;
  ocNumero?: string | null;
  nome: string;
  empresaId: string | null;
  /** Valor unitário de compra (PA: `valor_unitario`; PI: `valor_unitario_m1`). */
  valorUnitario: number;
  qtdTotal: number;
  somaVariantes: number;
  nVariantes: number;
  /** Só exige proporção de grade quem NÃO é acessório (acessório = célula única "UN"). */
  precisaGrade: boolean;
  /** Σ dos pesos positivos da proporção de grade por tamanho. */
  somaPesosGrade: number;
  /** Recusa própria da família que o card já aplica (PI: `validarDraft` — Σ% das etapas, cotação das etapas). */
  erroDaFamilia: string | null;
  /** ESTE produto tem conflito de edição pendente (a trava global vale para todos; aqui só o texto muda). */
  conflitoDoProduto: boolean;
};

export type ContextoPedido = {
  /** Há conflito pendente em QUALQUER produto do canvas — a mesma trava do botão do card (bloqueia todo mundo). */
  conflitoPendente: boolean;
};

/** Todos os motivos pelos quais o produto NÃO entra no pedido (lista vazia = elegível), na ordem em que a tela os mostra. */
export function motivosForaDoPedido(e: EntradaPedido, ctx: ContextoPedido): MotivoPedido[] {
  const m: MotivoPedido[] = [];
  if (e.temOc) m.push({ codigo: "ja_tem_oc", texto: e.ocNumero ? `Já tem a OC ${e.ocNumero} vinculada.` : "Já tem OC vinculada." });
  if (ctx.conflitoPendente || e.conflitoDoProduto) {
    m.push({ codigo: "conflito", texto: e.conflitoDoProduto ? TEXTO_CONFLITO_DO_PRODUTO : TEXTO_CONFLITO_PEDIDO });
  }
  if (!e.nome.trim()) m.push({ codigo: "sem_nome", texto: "Falta o nome do produto." });
  if (!e.empresaId) m.push({ codigo: "sem_fornecedor", texto: "Falta escolher o fornecedor." });
  if (!(Number(e.qtdTotal) > 0)) m.push({ codigo: "sem_quantidade", texto: "Falta a quantidade total." });
  if (e.nVariantes === 0) m.push({ codigo: "sem_variantes", texto: "Falta ao menos uma cor (variante)." });
  else if (Number(e.qtdTotal) > 0 && e.somaVariantes !== e.qtdTotal) {
    m.push({ codigo: "soma_nao_bate", texto: `A soma das variantes (${e.somaVariantes}) não bate com a Qtd total (${e.qtdTotal}).` });
  }
  if (e.precisaGrade && !(e.somaPesosGrade > 0)) m.push({ codigo: "grade_vazia", texto: "Falta a proporção de grade (tamanhos)." });
  if (!(Number(e.valorUnitario) > 0)) m.push({ codigo: "sem_valor", texto: "Falta o valor unitário." });
  if (e.erroDaFamilia) m.push({ codigo: "validacao", texto: e.erroDaFamilia });
  return m;
}

export const textoMotivos = (motivos: readonly MotivoPedido[]): string => motivos.map((x) => x.texto).join(" ");

// ── Produto como o assistente o vê ───────────────────────────────────────────────────────────────────────────────

/** Um produto do canvas, já avaliado pelo adaptador da família (rascunho VIVO da tela, não o salvo). */
export type ProdutoPedido = {
  id: string;
  nome: string;
  ref: string | null;
  /** Nome do fornecedor para exibir (empresa, e o representante quando houver). */
  fornecedorNome: string;
  /** Nome fantasia da EMPRESA (base da sigla do nº da OC, como o servidor). Ausente = `fornecedorNome`. */
  empresaNome?: string | null;
  empresaId: string | null;
  representanteId: string | null;
  /** Só importado: moeda da compra e moeda intermediária (mesma moeda = mesma OC; moedas diferentes → OCs separadas, P-363). */
  moedaCompra?: string | null;
  moedaIntermediaria?: string | null;
  grupoNome: string;
  categoriaNome: string;
  /** Quando o adaptador tem os ids, a sigla compara por id (como o servidor); senão, pelo nome. */
  grupoId?: string | null;
  categoriaId?: string | null;
  /** Nomes das cores (variantes) — só exibição. */
  cores: string[];
  pecas: number;
  /** PA: `valor_unitario`; PI: `valor_unitario_m1`. */
  valorUnitario: number;
  /** PA: `desconto_pct`; PI: 0. */
  descontoPct: number;
  /** Tem edição não salva — é salvo ANTES de criar o pedido (como o "Fazer pedido" do card, P-135). */
  sujo: boolean;
  entrada: EntradaPedido;
};

/** Total do produto no pedido: PA pela `cadeiaValores` (bruto → com desconto); PI pelo valor em M1 (qtd × unitário). */
export function totalDoProduto(p: Pick<ProdutoPedido, "pecas" | "valorUnitario" | "descontoPct">, familia: FamiliaPedido): number {
  const qtd = Number(p.pecas) || 0;
  const vu = Number(p.valorUnitario) || 0;
  if (familia === "importado") return Math.round(qtd * vu * 100) / 100;
  return cadeiaValores(qtd, vu, Number(p.descontoPct) || 0).totalDesc;
}

// ── Agrupamento por fornecedor (prévia) ──────────────────────────────────────────────────────────────────────────

export type GrupoFornecedor = {
  /** PA: `empresa|representante`; PI: + `|moeda_compra|moeda_intermediaria`. Único por grupo. */
  chave: string;
  empresaId: string;
  representanteId: string | null;
  moedaCompra: string | null;
  moedaIntermediaria: string | null;
  fornecedorNome: string;
  /** Base da sigla do nº da OC (empresa, sem o representante). */
  empresaNome: string;
  /** Na ordem em que apareceram na lista. */
  produtos: ProdutoPedido[];
};

export type ProdutoBloqueado = { produto: ProdutoPedido; motivos: MotivoPedido[] };

export type AgrupamentoPedido = {
  grupos: GrupoFornecedor[];
  /** Só falta o fornecedor (o resto está certo) — listados à parte, não geram OC. */
  semFornecedor: ProdutoPedido[];
  /** Não entram: já têm OC, grade vazia, sem valor… (com o motivo em PT). */
  bloqueados: ProdutoBloqueado[];
};

export function chaveFornecedor(p: Pick<ProdutoPedido, "empresaId" | "representanteId" | "moedaCompra" | "moedaIntermediaria">, familia: FamiliaPedido): string {
  const base = `${p.empresaId ?? ""}|${p.representanteId ?? ""}`;
  return familia === "importado" ? `${base}|${p.moedaCompra ?? ""}|${p.moedaIntermediaria ?? ""}` : base;
}

/**
 * Separa o que entra do que fica de fora. Ordem (a do mockup aprovado): quem tem QUALQUER motivo além do fornecedor vai para
 * `bloqueados` (com todos os motivos); quem só não tem fornecedor vai para `semFornecedor`; o resto agrupa por fornecedor.
 * Nunca mistura famílias: o chamador passa só produtos da mesma família (P-356).
 */
export function agruparPorFornecedor(produtos: readonly ProdutoPedido[], familia: FamiliaPedido, ctx: ContextoPedido = { conflitoPendente: false }): AgrupamentoPedido {
  const grupos: GrupoFornecedor[] = [];
  const porChave = new Map<string, GrupoFornecedor>();
  const semFornecedor: ProdutoPedido[] = [];
  const bloqueados: ProdutoBloqueado[] = [];
  for (const p of produtos) {
    const motivos = motivosForaDoPedido(p.entrada, ctx);
    const outros = motivos.filter((m) => m.codigo !== "sem_fornecedor");
    if (outros.length > 0) { bloqueados.push({ produto: p, motivos }); continue; }
    if (motivos.length > 0 || !p.empresaId) { semFornecedor.push(p); continue; }
    const chave = chaveFornecedor(p, familia);
    let g = porChave.get(chave);
    if (!g) {
      g = {
        chave, empresaId: p.empresaId, representanteId: p.representanteId ?? null,
        moedaCompra: p.moedaCompra ?? null, moedaIntermediaria: p.moedaIntermediaria ?? null,
        fornecedorNome: p.fornecedorNome, empresaNome: p.empresaNome || p.fornecedorNome, produtos: [],
      };
      porChave.set(chave, g);
      grupos.push(g);
    }
    g.produtos.push(p);
  }
  return { grupos, semFornecedor, bloqueados };
}

// ── Sigla do nº da OC (espelho de `_oc_lote_sigla`; P-361) ───────────────────────────────────────────────────────

/**
 * Prévia da SIGLA do nº da OC (o número sequencial `-NNNNN` vem do banco): fornecedor (3 letras, `FOR` se vazio) +
 *   `ACE` se TODOS os itens são acessórios | G1+C2 (1ª letra do grupo + 2 da categoria) se todos têm o mesmo grupo e a mesma
 *   categoria | `DIV` nos demais. Com 1 item reproduz `previewNumeroOc`/`fn_oc_p_acabado_numero` byte a byte.
 */
export function previewSiglaOcLote(
  fornecedorNome: string | null | undefined,
  itens: ReadonlyArray<{ grupoNome: string; categoriaNome: string; grupoId?: string | null; categoriaId?: string | null }>,
): string {
  const forn = norm3(fornecedorNome) || "FOR";
  if (itens.length === 0) return forn + "DIV";
  if (itens.every((i) => ehGrupoAcessorio(i.grupoNome))) return forn + "ACE";
  const chaveG = (i: (typeof itens)[number]) => i.grupoId ?? `n:${i.grupoNome}`;
  const chaveC = (i: (typeof itens)[number]) => i.categoriaId ?? `n:${i.categoriaNome}`;
  const igual = itens.every((i) => chaveG(i) === chaveG(itens[0]) && chaveC(i) === chaveC(itens[0]));
  if (!igual) return forn + "DIV";
  return forn + norm3(itens[0].grupoNome).slice(0, 1) + norm3(itens[0].categoriaNome).slice(0, 2);
}

/** "BELDIV-NNNNN" — o texto da prévia ("Nº gerado ao criar"). */
export const numeroPrevia = (sigla: string): string => `${sigla}-NNNNN`;

// ── Respostas (cabeçalho por OC) e herança entre as páginas ──────────────────────────────────────────────────────

export type CabecalhoOc = {
  /** ISO yyyy-MM-dd. */
  dataPedido: string;
  /** ISO yyyy-MM-dd — OBRIGATÓRIA. */
  dataPrevista: string;
  /** Texto livre ("30/60/90"); parcelas = quantos números (sobre o TOTAL da OC, P-355). */
  prazo: string;
};

export type RespostaOc = {
  /** Desmarcar PULA a OC inteira. */
  incluida: boolean;
  cabecalho: CabecalhoOc;
  /** Produto desmarcado = fora da OC (`false`); ausente = incluído. */
  produtosForaIds: ReadonlySet<string>;
};

export const cabecalhoInicial = (hoje: string): CabecalhoOc => ({ dataPedido: hoje, dataPrevista: "", prazo: "" });

export function respostasIniciais(grupos: readonly GrupoFornecedor[], hoje: string): RespostaOc[] {
  return grupos.map(() => ({ incluida: true, cabecalho: cabecalhoInicial(hoje), produtosForaIds: new Set<string>() }));
}

/** "Próxima" HERDA o que está vazio na página seguinte (data prevista e prazo); o que a pessoa já digitou lá fica. */
export function herdarCabecalho(atual: CabecalhoOc, proximo: CabecalhoOc): CabecalhoOc {
  return {
    dataPedido: proximo.dataPedido || atual.dataPedido,
    dataPrevista: proximo.dataPrevista || atual.dataPrevista,
    prazo: proximo.prazo || atual.prazo,
  };
}

/** Passa de `de` para `de + 1` aplicando a herança (devolve novo array; não muda o original). */
export function avancarHerdando(respostas: readonly RespostaOc[], de: number): RespostaOc[] {
  if (de < 0 || de + 1 >= respostas.length) return [...respostas];
  const out = [...respostas];
  out[de + 1] = { ...out[de + 1], cabecalho: herdarCabecalho(out[de].cabecalho, out[de + 1].cabecalho) };
  return out;
}

/** "aplicar este cabeçalho a todas": copia datas e prazo da página `de` para todas as outras (sobrescreve). */
export function aplicarCabecalhoATodas(respostas: readonly RespostaOc[], de: number): RespostaOc[] {
  const origem = respostas[de]?.cabecalho;
  if (!origem) return [...respostas];
  return respostas.map((r, i) => (i === de ? r : { ...r, cabecalho: { ...origem } }));
}

/** Nº de parcelas a pagar que o servidor vai gerar do prazo — a MESMA conta das outras OCs (`contarParcelasPrazo`). */
export const parcelasDoPrazo = (prazo: string): number => contarParcelasPrazo(prazo);

export const textoParcelas = (prazo: string): string => `${parcelasDoPrazo(prazo)} parcela(s), sobre o total da OC`;

// ── Seleção dentro de uma OC e totais ────────────────────────────────────────────────────────────────────────────

/** Produtos que de fato entram na OC (os não desmarcados), na ordem da lista. */
export function produtosDaOc(g: GrupoFornecedor, r: RespostaOc): ProdutoPedido[] {
  return g.produtos.filter((p) => !r.produtosForaIds.has(p.id));
}

/** Liga/desliga UM produto de uma OC (devolve novo array). */
export function alternarProdutoNaOc(respostas: readonly RespostaOc[], indice: number, produtoId: string): RespostaOc[] {
  return respostas.map((r, i) => {
    if (i !== indice) return r;
    const fora = new Set(r.produtosForaIds);
    if (fora.has(produtoId)) fora.delete(produtoId); else fora.add(produtoId);
    return { ...r, produtosForaIds: fora };
  });
}

export type TotaisOc = { produtos: number; pecas: number; total: number | null };

/** Totais de UMA OC. `mostrarValor=false` (sem permissão de ver custos) → `total: null`: a tela não mostra R$. */
export function totaisDaOc(g: GrupoFornecedor, r: RespostaOc, familia: FamiliaPedido, mostrarValor: boolean): TotaisOc {
  const ps = produtosDaOc(g, r);
  const pecas = ps.reduce((s, p) => s + (Number(p.pecas) || 0), 0);
  if (!mostrarValor) return { produtos: ps.length, pecas, total: null };
  const total = Math.round(ps.reduce((s, p) => s + totalDoProduto(p, familia), 0) * 100) / 100;
  return { produtos: ps.length, pecas, total };
}

/** A OC entra no pedido: marcada E com ao menos 1 produto marcado. */
export const ocEntra = (g: GrupoFornecedor, r: RespostaOc): boolean => r.incluida && produtosDaOc(g, r).length > 0;

export type TotaisLote = { ocs: number; produtos: number; pecas: number; total: number | null };

/** Totais do que está marcado em todo o lote (só as OCs que entram). */
export function totaisDoLote(grupos: readonly GrupoFornecedor[], respostas: readonly RespostaOc[], familia: FamiliaPedido, mostrarValor: boolean): TotaisLote {
  let ocs = 0, produtos = 0, pecas = 0, total = 0;
  grupos.forEach((g, i) => {
    const r = respostas[i];
    if (!r || !ocEntra(g, r)) return;
    const t = totaisDaOc(g, r, familia, mostrarValor);
    ocs += 1; produtos += t.produtos; pecas += t.pecas; total += t.total ?? 0;
  });
  return { ocs, produtos, pecas, total: mostrarValor ? Math.round(total * 100) / 100 : null };
}

/** Singular/plural PT-BR — "1 pedido" / "3 pedidos". */
export const pedidosTexto = (n: number): string => `${n} ${n === 1 ? "pedido" : "pedidos"}`;
export const produtosTexto = (n: number): string => `${n} ${n === 1 ? "produto" : "produtos"}`;

// ── Validação e montagem do `_pedidos` ───────────────────────────────────────────────────────────────────────────

export const TEXTO_DATA_PREVISTA_OBRIGATORIA = "Preencha a data de entrega";

export type ErroPagina = { indice: number; mensagem: string };

/** Erros das OCs que ENTRAM (a OC desmarcada não é conferida). Hoje: Data prevista de entrega obrigatória. */
export function errosDoLote(grupos: readonly GrupoFornecedor[], respostas: readonly RespostaOc[]): ErroPagina[] {
  const erros: ErroPagina[] = [];
  grupos.forEach((g, i) => {
    const r = respostas[i];
    if (!r || !ocEntra(g, r)) return;
    if (!r.cabecalho.dataPrevista) erros.push({ indice: i, mensagem: TEXTO_DATA_PREVISTA_OBRIGATORIA });
  });
  return erros;
}

/** Um pedido (uma OC) do `_pedidos` de `fazer_pedido_p_acabado` / `fazer_pedido_importado`. */
export type PedidoOc = {
  empresa_id: string;
  representante_id: string | null;
  data_pedido: string | null;
  data_prevista: string;
  prazo_pagamento: string | null;
  produto_ids: string[];
  /** Só importado. */
  moeda_compra?: string | null;
  moeda_intermediaria?: string | null;
};

/** O que `onCriar` devolve por OC criada (o `[{oc_id, numero, produto_ids}]` do servidor). */
export type OcCriadaLote = { oc_id: string; numero: string; produto_ids: string[] };

/**
 * `_pedidos` exato do contrato do servidor. OC desmarcada, ou sem nenhum produto marcado, fica FORA. O servidor confere tudo de
 * novo (elegibilidade, fornecedor, moeda) e monta os itens do produto SALVO — aqui só vão ids e cabeçalho.
 */
export function montarPedidos(grupos: readonly GrupoFornecedor[], respostas: readonly RespostaOc[], familia: FamiliaPedido): PedidoOc[] {
  const out: PedidoOc[] = [];
  grupos.forEach((g, i) => {
    const r = respostas[i];
    if (!r || !ocEntra(g, r)) return;
    const pedido: PedidoOc = {
      empresa_id: g.empresaId,
      representante_id: g.representanteId,
      data_pedido: r.cabecalho.dataPedido || null,
      data_prevista: r.cabecalho.dataPrevista,
      prazo_pagamento: r.cabecalho.prazo.trim() ? r.cabecalho.prazo.trim() : null,
      produto_ids: produtosDaOc(g, r).map((p) => p.id),
    };
    if (familia === "importado") {
      pedido.moeda_compra = g.moedaCompra;
      pedido.moeda_intermediaria = g.moedaIntermediaria;
    }
    out.push(pedido);
  });
  return out;
}

/** Produtos que vão num pedido E têm edição não salva: são salvos ANTES de criar (uma vez cada). */
export function produtosASalvar(grupos: readonly GrupoFornecedor[], respostas: readonly RespostaOc[]): ProdutoPedido[] {
  const vistos = new Set<string>();
  const out: ProdutoPedido[] = [];
  grupos.forEach((g, i) => {
    const r = respostas[i];
    if (!r || !ocEntra(g, r)) return;
    for (const p of produtosDaOc(g, r)) {
      if (p.sujo && !vistos.has(p.id)) { vistos.add(p.id); out.push(p); }
    }
  });
  return out;
}

/** Falha ao salvar um produto com edição pendente ANTES do pedido: nada foi criado. */
export class SalvarProdutoError extends Error {
  constructor(public readonly produto: ProdutoPedido, public readonly causa: unknown) {
    super(`Não foi possível salvar o produto antes do pedido: ${produto.nome}`);
    this.name = "SalvarProdutoError";
  }
}

/**
 * A ordem do "Criar": (1) salva, UM A UM, os produtos com edição pendente que vão num pedido (os já salvos nesta sessão — `jaSalvos`
 * — não são regravados numa nova tentativa); (2) UMA chamada `onCriar` com o `_pedidos` inteiro (tudo ou nada). Falhou o salvar =
 * `SalvarProdutoError` e nada é criado; falhou o criar = o erro de `onCriar` sobe e os produtos seguem salvos. Sem pedido = `[]`.
 */
export async function criarPedidosDoLote(o: {
  grupos: readonly GrupoFornecedor[];
  respostas: readonly RespostaOc[];
  familia: FamiliaPedido;
  jaSalvos: Set<string>;
  onSalvarProduto: (p: ProdutoPedido) => Promise<unknown>;
  onCriar: (pedidos: PedidoOc[]) => Promise<OcCriadaLote[]>;
}): Promise<OcCriadaLote[]> {
  const pedidos = montarPedidos(o.grupos, o.respostas, o.familia);
  if (pedidos.length === 0) return [];
  for (const p of produtosASalvar(o.grupos, o.respostas)) {
    if (o.jaSalvos.has(p.id)) continue;
    try {
      await o.onSalvarProduto(p);
    } catch (e) {
      throw new SalvarProdutoError(p, e);
    }
    o.jaSalvos.add(p.id);
  }
  return o.onCriar(pedidos);
}

/** Marcação inicial na barra de selecionados / card: só os produtos cujos ids estão em `ids` (ausente = todos). */
export function filtrarPorIds<T extends { id: string }>(produtos: readonly T[], ids?: ReadonlySet<string> | null): T[] {
  return ids ? produtos.filter((p) => ids.has(p.id)) : [...produtos];
}

// ── Resultado e cache ────────────────────────────────────────────────────────────────────────────────────────────

/** "3 OCs criadas" / "1 OC criada" — a linha do toast e do topo do resultado. */
export const textoOcsCriadas = (n: number): string => (n === 1 ? "1 OC criada" : `${n} OCs criadas`);

/** queryKeys a invalidar depois de criar (prefixo cobre as variantes: colecaoId, abas, contagem das abas, a OC aberta). */
export function chavesCacheDoPedido(familia: FamiliaPedido): ReadonlyArray<readonly string[]> {
  return familia === "acabado"
    ? [["produtos-acabados"], ["ocs_p_acabado"], ["oc-p-acabado"], ["sidebar-badges"]]
    : [["produtos-importados"], ["ocs_importado"], ["oc-importado"], ["sidebar-badges"]];
}
