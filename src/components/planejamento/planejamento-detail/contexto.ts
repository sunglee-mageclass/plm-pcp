// De onde o PlanejamentoDetail foi aberto (fonte ÚNICA do tipo e das decisões que dependem dele).
//  - "planejamento": a própria página /criacao/planejamento (padrão).
//  - "produto-acabado": Sheet por cima do planejador Produto Acabado.
//  - "integracao": Sheet por cima da Integração (R14, P-199 A).
//  - "desenvolvimento": card do quadro do Desenvolvimento (R7). Só muda o breadcrumb; o resto age como "planejamento".
export type ContextoDetalhe = "planejamento" | "produto-acabado" | "integracao" | "desenvolvimento";
export const CONTEXTO_PADRAO: ContextoDetalhe = "planejamento";

/** Aberto POR CIMA de outra tela? Então "Criar produto acabado" fecha o Sheet em vez de navegar para fora dela. */
export const abertoPorCima = (c: ContextoDetalhe): boolean => c === "produto-acabado" || c === "integracao";
/** "Ver no Produto Acabado" só faz sentido fora do próprio planejador Produto Acabado. */
export const mostraVerNoProdutoAcabado = (c: ContextoDetalhe): boolean => c !== "produto-acabado";
/** Rótulo da tela no breadcrumb do Sheet ("Estilo & Engenharia › <tela> › nome"). */
export const rotuloTelaBreadcrumb = (c: ContextoDetalhe): string =>
  c === "desenvolvimento" ? "Desenvolvimento" : "Planejamento de Produto";
