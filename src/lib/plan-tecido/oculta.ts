// Ocultar cor POR PRODUTO (F1 A2, dono 06/nov) — operações puras sobre UM material. A flag `oculta` mora na variante
// (por slot; coluna plan_tecido_variantes.oculta). Oculta ⇒ peças zeradas (sai da lista e da demanda); "+ adicionar cor" a
// re-lista e DESOCULTA (nunca duplica). Usadas pelo MaterialBlock; testadas sem React.
import type { PtMaterial, PtVariante } from "./types";
import { varKey } from "./calc";

const comboKey = (cid?: string | null, aid?: string | null) => `${cid ?? ""}|${aid ?? ""}`;

/** Oculta a cor `alvo` (por varKey) neste material: flag + peças e distribuição zeradas. */
export function ocultarNoMaterial(m: PtMaterial, alvo: PtVariante): PtMaterial {
  return { ...m, variantes: m.variantes.map((x) => {
    if (varKey(x) !== varKey(alvo)) return x;
    const { distribuicao: _d, ...resto } = x;
    return { ...resto, oculta: true, grades: {}, grade_total: 0 };
  }) };
}

/** Cor OCULTA do material com a mesma identidade (variante real, ou cor+apelido). */
export function acharOculta(m: PtMaterial, varianteId: string | null, corId: string | null, apelidoId: string | null): PtVariante | undefined {
  return m.variantes.find((x) => x.oculta && ((varianteId && x.variante_tecido_id === varianteId) ||
    (comboKey(corId, apelidoId) !== "|" && comboKey(x.cor_id, x.cor_apelido_id) === comboKey(corId, apelidoId))));
}

/** Desoculta `alvo` (por referência) — volta com peças 0, assumindo a identidade `ident` (a opção escolhida no menu). Renumera. */
export function desocultarNoMaterial(m: PtMaterial, alvo: PtVariante, ident: Partial<PtVariante> = {}): PtMaterial {
  return { ...m, variantes: m.variantes.map((x) => (x === alvo ? { ...x, ...ident, oculta: false, grades: {}, grade_total: 0 } : x)).map((v, i) => ({ ...v, ordem: i + 1 })) };
}
