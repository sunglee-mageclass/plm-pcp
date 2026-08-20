/**
 * Fonte ÚNICA da matemática da GRADE AUTOMÁTICA (régua bidirecional) — item do dono (ago/2026).
 *
 * Extraído da conta que estava INLINE e DUPLICADA no Desenvolvimento (ModeloDetailPanel) e no
 * CAD (pcp.cad.$modeloId), com pequenas divergências e SEM teste. O Desenvolvimento é a
 * referência que já funciona nos dois sentidos ao vivo; aqui a regra dele vira helper puro e
 * testado, e o CAD passa a reusar exatamente a mesma conta (ganhando o sentido total→células
 * que faltava). Regra = "regra existente" do Dev (arredondamento simples + resíduo no MAIOR
 * peso), NÃO o método do maior-resto de `splitMaiorResto` (esse é o espelho do SQL
 * `_split_maior_resto`, para produto acabado/OC — outra superfície).
 *
 * Os três sentidos:
 *  - distribuiTotal:  total → células, Σ === total EXATO (resíduo no tamanho de maior proporção;
 *                     sem proporção divide IGUAL; total 0 zera).  [editar a Grade Total]
 *  - distribuiAncora: célula digitada vira ÂNCORA (unit = qty / prop da célula), demais por
 *                     proporção; a âncora mantém o valor exato.   [editar uma célula, modo auto]
 *  - redistribuiPorEscala: round(unit * prop) por tamanho, Σ recomputado. [mudar a proporção]
 */

export type Grade = Record<string, number>;

const num = (v: unknown): number => Number(v) || 0;

/** Σ das células (ignora não-numérico). */
export function somaGrade(g: Grade | null | undefined): number {
  if (!g) return 0;
  return Object.values(g).reduce((s, v) => s + num(v), 0);
}

/** Σ das proporções nos tamanhos ativos. */
export function somaProporcao(tamanhos: string[], proporcoes: Grade | null | undefined): number {
  return tamanhos.reduce((s, t) => s + num(proporcoes?.[t]), 0);
}

/**
 * Distribui `total` pelos `tamanhos` conforme `proporcoes`, garantindo Σ células === total.
 *  - Σprop > 0 e total > 0: round(prop/Σprop * total) por tamanho; a diferença de arredondamento
 *    vai para o tamanho de MAIOR proporção (clamp ≥ 0).
 *  - Σprop == 0 e total > 0: divide IGUALMENTE (floor + resto nos primeiros) — mantém o total
 *    editável mesmo sem proporção (ex.: grade veio do "Aplicar ao modelo" sem proporção).
 *  - total <= 0: zera todas as células.
 */
export function distribuiTotal(total: number, tamanhos: string[], proporcoes: Grade | null | undefined): Grade {
  const props = proporcoes ?? {};
  const soma = somaProporcao(tamanhos, props);
  const next: Grade = {};
  if (soma > 0 && total > 0) {
    tamanhos.forEach((t) => { next[t] = Math.round((num(props[t]) / soma) * total); });
    const arred = tamanhos.reduce((s, t) => s + (next[t] || 0), 0);
    const diff = total - arred;
    if (diff !== 0) {
      let maxTam = tamanhos[0];
      let maxProp = -Infinity;
      tamanhos.forEach((t) => { const p = num(props[t]); if (p > maxProp) { maxProp = p; maxTam = t; } });
      next[maxTam] = Math.max(0, (next[maxTam] || 0) + diff);
    }
  } else if (total > 0 && tamanhos.length > 0) {
    const base = Math.floor(total / tamanhos.length);
    const resto = total - base * tamanhos.length;
    tamanhos.forEach((t, i) => { next[t] = base + (i < resto ? 1 : 0); });
  } else {
    tamanhos.forEach((t) => { next[t] = 0; });
  }
  return next;
}

/**
 * Âncora: a célula `tamAncora=qty` define a "unidade" (qty / proporção dela) e os DEMAIS
 * tamanhos são preenchidos por proporção. A âncora mantém EXATAMENTE o valor digitado.
 * Pré-condição do chamador (modo auto): qty > 0 e proporcoes[tamAncora] > 0.
 */
export function distribuiAncora(qty: number, tamAncora: string, tamanhos: string[], proporcoes: Grade | null | undefined): Grade {
  const props = proporcoes ?? {};
  const unit = qty / num(props[tamAncora]);
  const next: Grade = {};
  tamanhos.forEach((t) => { next[t] = Math.round(unit * num(props[t])); });
  next[tamAncora] = qty; // preserva o valor exato da âncora
  return next;
}

/**
 * Redistribui mantendo a ESCALA dada (`unit` = total ÷ Σprop anterior). Σ é recomputado pelo
 * chamador (pode diferir do total se a soma das proporções mudou). Usado ao editar a proporção
 * com o modo automático ligado.
 */
export function redistribuiPorEscala(unit: number, tamanhos: string[], proporcoes: Grade | null | undefined): Grade {
  const props = proporcoes ?? {};
  const next: Grade = {};
  tamanhos.forEach((t) => { next[t] = Math.round(unit * num(props[t])); });
  return next;
}
