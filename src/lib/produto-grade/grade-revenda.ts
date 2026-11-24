// PR-GRADE-2 — EDIÇÃO da grade de tamanhos de UM produto REVENDA na Lista tipo Excel (PURO: sem React; o banco entra por parâmetro).
//
// Por que SÓ a revenda edita na lista: o INTERNO (e o IMPORTADO) gravam a grade pelo `salvar_modelo_bom`, que APAGA o BOM inteiro e o
// reinsere (persistir-bom.ts) — editar só a grade pela lista reconstruiria a ficha (frágil: pode apagar o BOM). A REVENDA tem a RPC
// dedicada `salvar_grade_revenda` (a MESMA do Sheet): estado COMPLETO só da grade, não toca o BOM. Interno/importado = só-leitura +
// botão "abrir no Sheet na seção da grade".
//
// Regras (todas as do Sheet, reaproveitando as funções dele — nada de regra de save duplicada):
//  - payload = estado COMPLETO da grade (`linhasGradeComprado`; linha ausente = apagada) montado sobre a grade do SERVIDOR lida AGORA
//    (`lerGradeServidorComprado`: `rev` + grade num SELECT só) com as células EDITADAS por cima — nunca regrava grade velha;
//  - CAS por `rev` (`_rev_base` = o `rev` de quando a grade foi lida) + conferência de CONTEÚDO (`gradeCompradoMudouNoServidor`): a RPC
//    não sobe o `rev`, então duas pessoas salvando só a grade só se enxergam pelo conteúdo. Qualquer diferença = P0409 (a tela recarrega
//    SÓ aquela grade e avisa; o rascunho fica para a pessoa conferir);
//  - trava: sem permissão, tela só-leitura ou card enviado à Explosão (mais estrito que o Sheet, que ainda deixa o Planejamento editar).
import {
  gradeCompradoDoServidor,
  gradeCompradoMudouNoServidor,
  linhasGradeComprado,
} from "@/components/planejamento/planejamento-detail/comprado";
import type { GradeRowDb } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";
import { resolverPermissoesSheet } from "@/components/planejamento/planejamento-detail/permissoes-sheet";
import { MOTIVO_SEM_PERMISSAO } from "@/lib/grade-bloqueio";
import { ehOrigemComprada, normalizarOrigem } from "@/lib/origem";
import { ConflitoProdutoError } from "./salvar";

export const MOTIVO_ENVIADO_EXPLOSAO =
  "Produto enviado à Explosão: a grade só muda pelo botão Editar do card.";
export const MOTIVO_IMPORTADO =
  "A grade do importado grava junto com a ficha do Desenvolvimento — só quem edita o Desenvolvimento a altera.";
export const MOTIVO_SEM_PERMISSAO_GRADE = "Sem permissão para editar esta grade.";
export const TEXTO_CONFLITO_GRADE =
  "Outra pessoa alterou a grade deste produto agora há pouco. A grade foi atualizada — confira as suas quantidades e salve de novo.";
/** Texto do botão que abre o Sheet já na seção da grade (interno/importado). */
export const TEXTO_ABRIR_SHEET_GRADE = "Editar a grade no Sheet";

/** Seção do Sheet (`Secao id`) que tem a grade: comprado = "grade_revenda"; interno = "grade" (mesma regra de `PlanejamentoDetail`). */
export function secaoGradeDaOrigem(origem: string | null | undefined): "grade_revenda" | "grade" {
  return ehOrigemComprada(normalizarOrigem(origem)) ? "grade_revenda" : "grade";
}

/** A grade deste produto pode ser EDITADA na lista? Só a REVENDA (RPC dedicada); interno/importado abrem o Sheet. */
export function gradeEditavelNaLista(origem: string | null | undefined): boolean {
  return normalizarOrigem(origem) === "revenda";
}

/**
 * Por que a grade da REVENDA não edita (ou `null` = edita). Precedência: tela inteira só-leitura > enviado à Explosão > sem permissão.
 * Permissão = a do Sheet (`compartilhadoBloqueado`: Planejamento OU Desenvolvimento ainda destravado); o banco recusa o resto (42501).
 */
export function motivoGradeRevendaSomenteLeitura(i: {
  readOnly: boolean;
  enviadoCad: boolean | null | undefined;
  canEdit: (chave: string) => boolean;
}): string | null {
  if (i.readOnly) return MOTIVO_SEM_PERMISSAO;
  if (i.enviadoCad) return MOTIVO_ENVIADO_EXPLOSAO;
  const podeEditarDev = i.canEdit("criacao_desenvolvimento");
  const perm = resolverPermissoesSheet({
    podeEditarPlanejamento: i.canEdit("criacao_planejamento"),
    podeEditarDev,
    devBloqueado: !podeEditarDev,
  });
  return perm.compartilhadoBloqueado ? MOTIVO_SEM_PERMISSAO_GRADE : null;
}

export type GradePorCor = Record<number, Record<string, number>>;

const SEP = "::";
/** Chave de UMA célula no rascunho (`useCardDraft` é plano): `<variante_numero>::<tamanho>` — o tamanho pode ter "|" ("36|PP"). */
export const chaveCelula = (num: number, tam: string) => `${num}${SEP}${tam}`;
export function separarChave(chave: string): { num: number; tam: string } {
  const i = chave.indexOf(SEP);
  return { num: Number(chave.slice(0, i)), tam: chave.slice(i + SEP.length) };
}

/** A grade do servidor → mapa PLANO de células (cores × tamanhos, vazio = 0): é a `base` do rascunho. */
export function celulasDaGrade(
  grades: GradePorCor,
  nums: readonly number[],
  tamanhos: readonly string[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const num of nums)
    for (const t of tamanhos) out[chaveCelula(num, t)] = Number(grades[num]?.[t]) || 0;
  return out;
}

/** Quantidade digitada → inteiro ≥ 0 (igual ao `setCelulaGradeRevenda` do Sheet). */
export const qtdValida = (v: unknown) => Math.max(0, Math.trunc(Number(v)) || 0);

/** Grade do SERVIDOR (linhas) + células editadas por cima → estado COMPLETO (`{variante_numero: {tamanho: qtd}}`). Linhas órfãs ficam. */
export function aplicarMudancas(
  servidor: readonly GradeRowDb[],
  mudancas: Record<string, number>,
): GradePorCor {
  const out = gradeCompradoDoServidor([...servidor]);
  for (const [k, v] of Object.entries(mudancas)) {
    const { num, tam } = separarChave(k);
    out[num] = { ...(out[num] ?? {}), [tam]: qtdValida(v) };
  }
  return out;
}

export type EntradaSalvarGrade = {
  modeloId: string;
  /** `rev` de `modelos` de quando a grade foi LIDA (ou o que esta própria sessão já subiu). `null` = não sabemos: vira conflito (relê). */
  revBase: number | null | undefined;
  /** A grade como a pessoa a VIU (a última leitura do servidor): se o servidor já não é isto, alguém salvou no meio. */
  conferida: GradePorCor;
  /** SÓ as células editadas (`chave → qtd`). */
  mudancas: Record<string, number>;
  /** `lerGradeServidorComprado` (rev + grade num SELECT; rev ≠ revBase ⇒ P0409; erro ⇒ lança). Injetável nos testes. */
  lerServidor: (modeloId: string, revBase: number) => Promise<GradeRowDb[]>;
  /** `supabase.rpc`. */
  rpc: (nome: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
};

/**
 * Salva a grade de UM produto REVENDA pela RPC dedicada (a do Sheet). Lança `ConflitoProdutoError` (P0409) se o `rev` ou a grade do
 * servidor já não são os que a pessoa viu — NADA é gravado nesse caso. Devolve o estado COMPLETO que foi enviado.
 */
export async function salvarGradeRevenda(o: EntradaSalvarGrade): Promise<GradePorCor> {
  if (o.revBase == null) throw new ConflitoProdutoError(TEXTO_CONFLITO_GRADE);
  const servidor = await o.lerServidor(o.modeloId, o.revBase);
  if (gradeCompradoMudouNoServidor(JSON.stringify(o.conferida), servidor))
    throw new ConflitoProdutoError(TEXTO_CONFLITO_GRADE);
  const estado = aplicarMudancas(servidor, o.mudancas);
  const { error } = await o.rpc("salvar_grade_revenda", {
    _modelo_id: o.modeloId,
    _grades: linhasGradeComprado(estado),
    _rev_base: o.revBase,
  });
  if (error) throw error;
  return estado;
}
