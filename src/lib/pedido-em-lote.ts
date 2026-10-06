// [urg R13] Pedido em lote no Produto Acabado e no Produto Importado — lógica PURA (sem React, sem supabase).
//
// O "Fazer pedido" nasceu dentro de cada card (`ProdutoCard` / `ProdutoImportadoCard`). O diálogo em lote
// (`components/shared/PedidoEmLoteDialog`) cria uma OC por produto marcado, em SEQUÊNCIA, usando as MESMAS funções
// que o card usa para montar o payload e para recusar (`erroDoPedido*`, `montarDadosOc*` nos `shared.ts` de cada
// família). Aqui ficam só as regras que o lote acrescenta:
//   - elegibilidade (quem fica de fora e por quê, em PT);
//   - resumo (nº de pedidos e total em R$, sem R$ para quem não vê custos);
//   - a sequência de criação, em que a falha de um produto NÃO para os outros.

/** Texto que o card já usa quando há conflito de edição pendente na coleção — fonte única do card e do lote. */
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
  /** Já existe OC vinculada (a RPC recusaria: 1 OC ativa por produto). */
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
  /** ESTE produto tem conflito de edição pendente (a trava global do card vale para todos; aqui só o texto muda). */
  conflitoDoProduto: boolean;
};

export type ContextoPedido = {
  /** Há conflito pendente em QUALQUER produto do canvas — a mesma trava do botão do card (bloqueia todo mundo). */
  conflitoPendente: boolean;
};

/**
 * Todos os motivos pelos quais o produto NÃO entra no lote (lista vazia = elegível), na ordem em que a tela os mostra.
 * Reúne o que o card já recusa (conflito, soma das variantes, validação da família) e o que o lote exige a mais
 * (fornecedor, valor, quantidade, grade) — o card segue como era.
 */
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

/** Uma linha do diálogo. `motivos` vazio = elegível. `valor` já é o total do pedido (a conta do card) — `null` = sem cálculo. */
export type ItemPedidoLote = {
  id: string;
  nome: string;
  ref: string | null;
  pecas: number;
  valor: number | null;
  motivos: MotivoPedido[];
};

export const elegivel = (i: ItemPedidoLote): boolean => i.motivos.length === 0;
export const textoMotivos = (motivos: readonly MotivoPedido[]): string => motivos.map((x) => x.texto).join(" ");

/** Marcação inicial: todos os elegíveis (rodapé = compra total) OU só os elegíveis entre os `ids` escolhidos (barra de selecionados). */
export function marcadosIniciais(itens: readonly ItemPedidoLote[], ids?: ReadonlySet<string> | null): Set<string> {
  return new Set(itens.filter((i) => elegivel(i) && (!ids || ids.has(i.id))).map((i) => i.id));
}

/** Liga/desliga UM produto. Quem não é elegível nunca entra na marcação. */
export function alternarMarca(itens: readonly ItemPedidoLote[], marcados: ReadonlySet<string>, id: string): Set<string> {
  const alvo = itens.find((i) => i.id === id);
  const prox = new Set(marcados);
  if (!alvo || !elegivel(alvo)) { prox.delete(id); return prox; }
  if (prox.has(id)) prox.delete(id); else prox.add(id);
  return prox;
}

/** Marca (ou desmarca) todos os elegíveis de uma vez. */
export function marcarTodos(itens: readonly ItemPedidoLote[], marcar: boolean): Set<string> {
  return marcar ? new Set(itens.filter(elegivel).map((i) => i.id)) : new Set();
}

/** Os itens que de fato vão virar pedido: marcados E elegíveis, na ordem da lista. */
export function itensDoPedido(itens: readonly ItemPedidoLote[], marcados: ReadonlySet<string>): ItemPedidoLote[] {
  return itens.filter((i) => marcados.has(i.id) && elegivel(i));
}

export type ResumoLote = { pedidos: number; pecas: number; total: number | null };

/** Resumo do que está marcado. `mostrarValor=false` (sem permissão de ver custos) → `total: null`: a tela não mostra R$. */
export function resumoDoLote(itens: readonly ItemPedidoLote[], marcados: ReadonlySet<string>, mostrarValor: boolean): ResumoLote {
  const sel = itensDoPedido(itens, marcados);
  const pecas = sel.reduce((s, i) => s + (Number(i.pecas) || 0), 0);
  if (!mostrarValor) return { pedidos: sel.length, pecas, total: null };
  const total = Math.round(sel.reduce((s, i) => s + (Number(i.valor) || 0), 0) * 100) / 100;
  return { pedidos: sel.length, pecas, total };
}

/** Singular/plural PT-BR — "1 pedido" / "3 pedidos". */
export const pedidosTexto = (n: number): string => `${n} ${n === 1 ? "pedido" : "pedidos"}`;

// ── Sequência de criação ────────────────────────────────────────────────────────────────────────────────────────

export type OcCriada = { ocId: string | null; ocNumero: string | null };
export type ResultadoPedidoItem =
  | { id: string; nome: string; ok: true; ocId: string | null; ocNumero: string | null }
  | { id: string; nome: string; ok: false; erro: string };
export type ResultadoLote = { itens: ResultadoPedidoItem[]; criados: number; falhas: number };

/**
 * Cria os pedidos UM POR VEZ (a ordem da lista). A falha de um produto NÃO para os outros: o erro vira texto em PT
 * (`mensagemDoErro`) e o laço segue. Nunca lança — quem chama lê `criados`/`falhas`. `onProgresso` roda ANTES de cada item
 * (`feitos` = quantos já terminaram, com ou sem erro); `onResultado` roda DEPOIS de cada um.
 */
export async function executarPedidosEmSequencia(
  itens: ReadonlyArray<{ id: string; nome: string }>,
  criar: (item: { id: string; nome: string }) => Promise<OcCriada>,
  opcoes: {
    mensagemDoErro: (e: unknown) => string;
    onProgresso?: (feitos: number, total: number, atual: { id: string; nome: string }) => void;
    /** Roda DEPOIS de cada item, com o resultado dele (ok ou falha) — a tela vai pintando a lista conforme anda. */
    onResultado?: (r: ResultadoPedidoItem) => void;
  },
): Promise<ResultadoLote> {
  const out: ResultadoPedidoItem[] = [];
  let feitos = 0;
  for (const item of itens) {
    opcoes.onProgresso?.(feitos, itens.length, item);
    try {
      const oc = await criar(item);
      out.push({ id: item.id, nome: item.nome, ok: true, ocId: oc?.ocId ?? null, ocNumero: oc?.ocNumero ?? null });
    } catch (e) {
      let erro: string;
      try { erro = opcoes.mensagemDoErro(e); } catch { erro = "Falha ao criar o pedido."; }
      out.push({ id: item.id, nome: item.nome, ok: false, erro });
    }
    feitos += 1;
    opcoes.onResultado?.(out[out.length - 1]);
  }
  const criados = out.filter((r) => r.ok).length;
  return { itens: out, criados, falhas: out.length - criados };
}

/**
 * O pedido de UM produto dentro do lote — a MESMA ordem do "Fazer pedido" do card: recusas (já tem OC, conflito, soma das
 * variantes…) → salvar o produto ANTES (só se ele tem edição pendente: quem não mexeu não é regravado, P-135 B) → criar a OC.
 * `produto` é lido AGORA do estado vivo da tela (`undefined` = sumiu da lista). `erro` cria o erro de validação que `mensagemErro`
 * mostra verbatim (`erroValidacao`). Pura: quem chama injeta o salvar e o criar.
 */
export async function criarPedidoDoProduto<P, S, R>(o: {
  produto: P | undefined;
  recusa: (p: P) => string | null;
  sujo: (p: P) => boolean;
  salvar: (p: P) => Promise<S>;
  criar: (p: P, salvo: S | undefined) => Promise<R>;
  erro: (mensagem: string) => Error;
}): Promise<R> {
  const p = o.produto;
  if (p === undefined) throw o.erro("Este produto não está mais na lista.");
  const motivo = o.recusa(p);
  if (motivo) throw o.erro(motivo);
  const salvo = o.sujo(p) ? await o.salvar(p) : undefined;
  return o.criar(p, salvo);
}

/** "3 pedidos criados · 1 falhou" — a linha do toast e do topo do resultado. */
export function textoResumoResultado(r: Pick<ResultadoLote, "criados" | "falhas">): string {
  const criados = r.criados === 0 ? "Nenhum pedido criado" : `${pedidosTexto(r.criados)} ${r.criados === 1 ? "criado" : "criados"}`;
  if (r.falhas === 0) return criados;
  return `${criados} · ${r.falhas} ${r.falhas === 1 ? "falhou" : "falharam"}`;
}
