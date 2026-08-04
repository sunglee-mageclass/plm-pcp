// Fonte ÚNICA da Situação da Explosão — lista (entrada-saida.explosao.index.tsx) e
// detalhe (ExplosaoDetail.tsx) usam a MESMA regra, pra nunca divergir (ex.: lista mostra
// "Faltou estoque" mas o Sheet abre como se estivesse tudo certo).
export type ExplosaoSituacao = "aguardando" | "enviado" | "faltou_estoque";

/** "Faltou estoque" ⊂ "Enviado" — só é declarado quando ficou déficit no ÚLTIMO envio,
 *  persistido em `cad.deficit_corte` (regravado do zero / limpo a cada envio-reenvio
 *  por `_baixar_estoque_tecido_corte_core`). */
export function situacaoExplosao(enviadoCorte: boolean, deficitCorte: unknown): ExplosaoSituacao {
  if (!enviadoCorte) return "aguardando";
  return Array.isArray(deficitCorte) && deficitCorte.length > 0 ? "faltou_estoque" : "enviado";
}
