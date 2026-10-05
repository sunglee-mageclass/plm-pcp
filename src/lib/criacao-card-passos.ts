// urg R2 T12 (fix round 1, M1/M2/L4) — a cadeia de gravações DEPOIS do INSERT de um card NOVO no Planejamento ("+ Novo"): tecidos
// iniciais, insumos iniciais, grade, mão de obra. Cada passo é independente: todos são TENTADOS, as falhas são juntadas e quem chama
// avisa tudo de uma vez no fim (o card fica criado; nada digitado some calado por causa de um passo anterior). Puro/testável.

export type EtapaPosCriacao = "tecidos" | "insumos" | "grade" | "mo";
export type FalhaPosCriacao = { etapa: EtapaPosCriacao; erro: unknown };

const ETAPAS: readonly EtapaPosCriacao[] = ["tecidos", "insumos", "grade", "mo"];
const NOME_ETAPA: Record<EtapaPosCriacao, string> = {
  tecidos: "tecidos (Ficha/BOM)",
  insumos: "insumos",
  grade: "grade",
  mo: "mão de obra",
};
const ROTULO_ETAPA: Record<EtapaPosCriacao, string> = {
  tecidos: "Tecidos",
  insumos: "Insumos",
  grade: "Grade",
  mo: "Mão de obra",
};

/**
 * Cria o card UMA vez só: com o id já guardado (retry / 2º clique depois de um erro numa etapa seguinte) devolve o MESMO id e
 * `criadoAgora = false` (os passos de "card recém-criado" não rodam de novo). INSERT que falha não marca nada (o retry tenta de novo).
 */
export async function garantirCardCriado(
  ref: { current: string | null },
  inserir: () => Promise<string | null>,
): Promise<{ id: string | null; criadoAgora: boolean }> {
  if (ref.current) return { id: ref.current, criadoAgora: false };
  const id = await inserir();
  ref.current = id;
  return { id, criadoAgora: true };
}

/** Roda TODOS os passos em ordem; falha de um não impede os seguintes. */
export async function executarPassosPosCriacao(
  passos: { etapa: EtapaPosCriacao; run: () => Promise<unknown> }[],
): Promise<FalhaPosCriacao[]> {
  const falhas: FalhaPosCriacao[] = [];
  for (const p of passos) {
    try {
      await p.run();
    } catch (erro) {
      falhas.push({ etapa: p.etapa, erro });
    }
  }
  return falhas;
}

/** Erro único que carrega todas as falhas (o `onError` do Salvar monta o toast com `falhasDoErro`). */
export function erroPosCriacao(falhas: FalhaPosCriacao[]): Error {
  return Object.assign(new Error("passos pos-criacao do card falharam"), {
    etapaFalha: falhas[0]?.etapa,
    falhasCriacao: falhas,
  });
}

/** Falhas pós-criação de um erro: a lista combinada, ou a etapa única do formato antigo (`etapaFalha`). Outro erro => []. */
export function falhasDoErro(e: unknown): FalhaPosCriacao[] {
  const any = e as { falhasCriacao?: FalhaPosCriacao[]; etapaFalha?: string } | null | undefined;
  if (Array.isArray(any?.falhasCriacao)) return any!.falhasCriacao!;
  const et = any?.etapaFalha;
  return et && (ETAPAS as readonly string[]).includes(et)
    ? [{ etapa: et as EtapaPosCriacao, erro: e }]
    : [];
}

function juntar(nomes: string[]): string {
  return nomes.length <= 1
    ? nomes.join("")
    : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** Texto do toast de erro do card NOVO já criado. Uma etapa => textos de sempre; várias => nomeia cada uma e o motivo. */
export function textoFalhasPosCriacao(
  falhas: FalhaPosCriacao[],
  o: { podeEditarDev: boolean; motivo: (erro: unknown) => string },
): string {
  if (falhas.length === 1) {
    const f = falhas[0];
    if (f.etapa === "mo")
      return "O card foi criado, mas a mão de obra NÃO foi salva — confira e salve de novo.";
    if (f.etapa === "grade")
      return "O card foi criado, mas a grade NÃO foi salva — confira e salve de novo.";
    if (f.etapa === "tecidos") {
      return o.podeEditarDev
        ? "O card foi criado, mas os tecidos NÃO foram para a Ficha (BOM). Eles aparecem na seção Tecidos — salve o card de novo para gravá-los."
        : "O card foi criado, mas os tecidos NÃO foram para a Ficha (BOM). Peça a quem edita o Desenvolvimento para salvar a nova versão.";
    }
    return `O card foi criado, mas os insumos NÃO foram salvos — ${o.motivo(f.erro).replace(/[.\s]+$/, "")}. Adicione-os na seção Insumos do card.`;
  }
  const nomes = juntar(falhas.map((f) => NOME_ETAPA[f.etapa]));
  const motivos = falhas
    .map((f) => `${ROTULO_ETAPA[f.etapa]} — ${o.motivo(f.erro).replace(/[.\s]+$/, "")}`)
    .join("; ");
  return `O card foi criado, mas NÃO foram salvos: ${nomes}. Motivos: ${motivos}. Confira o card e refaça o que faltou.`;
}
