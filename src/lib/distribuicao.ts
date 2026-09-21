// Cálculo puro da tela Distribuição (grade × lojas → poder de venda). Sem I/O, testável.
//
// Estrutura de UMA tabela: uma grade-base proporcional por tamanho + cores + peças/mês (globais da
// tabela), e N lojas, cada uma com uma "base" (multiplicador) + markup. O VALOR MÉDIO tem uma
// loja de REFERÊNCIA (a 1ª onde o usuário digita um valor); as outras derivam por referência×markup.

export type LinhaLoja = {
  loja_id: string;
  base: number;              // multiplicador da grade-base
  markup: number | null;     // markup da loja (null/1 = referência)
  valorRef: number | null;   // valor médio DIGITADO (só a loja-referência tem)
};

export type TabelaDistribuicao = {
  gradeBase: Record<string, number>; // { "34|PPP": 1, ... } proporção por tamanho
  cores: number;
  pecasMes: number;
  lojas: LinhaLoja[];
};

export type LinhaCalculada = {
  loja_id: string;
  grade: Record<string, number>; // grade da loja por tamanho (base × gradeBase)
  total: number;                 // Σ tamanhos
  coresOut: number;              // total × cores
  pecasMesOut: number;           // coresOut × pecasMes
  valorMedio: number;            // referência OU referência × markup
  poderVenda: number;            // valorMedio × pecasMesOut
  ehReferencia: boolean;
};

/** true se a loja é a REFERÊNCIA de valor: a 1ª (na ordem) que tem valorRef digitado (>0). */
export function indiceReferencia(lojas: LinhaLoja[]): number {
  return lojas.findIndex((l) => (l.valorRef ?? 0) > 0);
}

/** grade da loja por tamanho = base × gradeBase[tam] (inteiro). */
export function gradeDaLoja(gradeBase: Record<string, number>, base: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [tam, prop] of Object.entries(gradeBase)) out[tam] = Math.round((prop || 0) * (base || 0));
  return out;
}

/** total da grade = Σ dos tamanhos. */
export function totalGrade(grade: Record<string, number>): number {
  return Object.values(grade).reduce((a, b) => a + (b || 0), 0);
}

/** Calcula todas as linhas da tabela. O valor médio de referência é o `valorRef` da loja-ref;
 *  as demais = valorRef_da_ref × markup da própria loja. Sem referência → valor médio 0. */
export function calcularTabela(t: TabelaDistribuicao): LinhaCalculada[] {
  const idxRef = indiceReferencia(t.lojas);
  const valorRefBase = idxRef >= 0 ? (t.lojas[idxRef].valorRef ?? 0) : 0;

  return t.lojas.map((l, i) => {
    const grade = gradeDaLoja(t.gradeBase, l.base);
    const total = totalGrade(grade);
    const coresOut = total * (t.cores || 0);
    const pecasMesOut = coresOut * (t.pecasMes || 0);
    const ehRef = i === idxRef;
    const valorMedio = ehRef
      ? valorRefBase
      : valorRefBase > 0
        ? round2(valorRefBase * (l.markup ?? 0))
        : 0;
    const poderVenda = round2(valorMedio * pecasMesOut);
    return { loja_id: l.loja_id, grade, total, coresOut, pecasMesOut, valorMedio, poderVenda, ehReferencia: ehRef };
  });
}

export type TotaisTabela = {
  gradePorTam: Record<string, number>;
  total: number;
  cores: number;
  pecasMes: number;
  poderVenda: number;
};

/** Totais das colunas (rodapé). */
export function calcularTotais(gradeBase: Record<string, number>, linhas: LinhaCalculada[]): TotaisTabela {
  const gradePorTam: Record<string, number> = {};
  for (const tam of Object.keys(gradeBase)) gradePorTam[tam] = 0;
  let total = 0, cores = 0, pecasMes = 0, poderVenda = 0;
  for (const l of linhas) {
    for (const [tam, q] of Object.entries(l.grade)) gradePorTam[tam] = (gradePorTam[tam] ?? 0) + (q || 0);
    total += l.total;
    cores += l.coresOut;
    pecasMes += l.pecasMesOut;
    poderVenda += l.poderVenda;
  }
  return { gradePorTam, total, cores, pecasMes, poderVenda: round2(poderVenda) };
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}
