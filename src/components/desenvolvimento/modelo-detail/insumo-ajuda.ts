// urg R1 — texto de ajuda da linha de insumo VINCULADO a um tamanho (ModeloEtiquetasSection). Puro, testável.
// Comprado (revenda/importado, Ruling A7): a prévia de custo da linha é cheia (a grade do comprado não chega ao hook) e o
// valor que vale é o do servidor — o texto não promete "só as peças desse tamanho" para o custo.
export function textoAjudaInsumoVinculado(rotulo: string, comprado: boolean): string {
  return comprado
    ? `Vinculado ao tamanho ${rotulo} — custo previsto calculado no servidor para o tamanho vinculado.`
    : `Vinculado ao tamanho ${rotulo} — qtd = consumo × peças desse tamanho.`;
}

/** O aviso "fora da grade" só vale quando a grade do modelo está ao alcance (interno); no comprado fica oculto. */
export function mostraAvisoForaDaGrade(foraDaGrade: boolean, comprado: boolean): boolean {
  return foraDaGrade && !comprado;
}
