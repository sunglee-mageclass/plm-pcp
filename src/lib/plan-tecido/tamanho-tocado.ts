// "Tamanho em" nos cards do Plan. Tecido — Tarefa 4 do plano `.superpowers/sdd/2026-09-29-tamanho-em/plan.md`.
// PURO (sem React/Supabase). Monta o PAYLOAD do `salvar_plan_tecido` para o "Tamanho em" dos slots COM card:
//
// - O servidor (`_salvar_plan_tecido_core`, migration 20261011100000) só grava `modelos.tamanho_tipo` quando o slot com
//   card vem com `tamanho_tipo_tocado: true` — assim um Salvar da árvore inteira nunca sobrescreve o valor que outra tela
//   (Planejamento, Produto Acabado/Importado) mudou depois que esta tela abriu ("última edição manda" só no campo tocado).
//   A marca vai SÓ no slot com card cujo valor difere da BASE (a última árvore conhecida do servidor, `planBaseRef`).
// - Card TRAVADO pela Integração (invariante #14 — a trava cobre SEMPRE `tamanho_tipo`): o slot CONTINUA no payload
//   (o save apaga e regrava a árvore inteira: tirar o slot apagaria materiais/distribuição/slot_oc — ruling #1 do
//   G-plano), só SEM a marca, e o valor do rascunho volta ao da base (= o do modelo). `revertidos` lista esses cards
//   para o toast ("só se a pessoa mexeu": só entra quem tinha valor diferente da base).
// - Slot SEM card: o valor é da vaga (P-119 A) e vai como está — nada a marcar.
//
// A marca `tamanho_tipo_tocado` NUNCA entra no estado local (só no payload): `local` é a árvore com os revertidos
// aplicados e sem marca nenhuma — é o que a tela deve mostrar e o que vira a nova base depois do Salvar.
import type { PtArvore, PtSlot } from "./types";

export type TamanhoTipoSlot = "letra" | "numero";
export type SlotPayloadTamanho = PtSlot & { tamanho_tipo_tocado?: true };
export type MarcaTamanho = {
  /** Árvore para o PAYLOAD (slots com card alterados levam `tamanho_tipo_tocado: true`). */
  arvore: PtArvore;
  /** Árvore para o ESTADO LOCAL: os revertidos aplicados, sem marca nenhuma. */
  local: PtArvore;
  /** modelo_ids marcados como tocados (o Salvar grava no modelo). */
  tocados: string[];
  /** Slots de card travado cujo valor foi trocado — voltaram ao valor da base (do modelo). */
  revertidos: { modeloId: string; nome: string }[];
};

const valido = (t: unknown): t is TamanhoTipoSlot => t === "letra" || t === "numero";

function valoresDaBase(base: PtArvore | null | undefined): Map<string, PtSlot["tamanho_tipo"]> {
  const m = new Map<string, PtSlot["tamanho_tipo"]>();
  if (!base) return m;
  for (const sub of base.subcolecoes)
    for (const ln of sub.linhas)
      for (const s of ln.slots)
        if (s.modelo_id) m.set(s.modelo_id, s.tamanho_tipo ?? null);
  return m;
}

/**
 * Marca o "Tamanho em" tocado nos slots com card. `base` = última árvore conhecida do servidor (`planBaseRef`); sem
 * base, nada é marcado (sem referência não dá para afirmar que a pessoa mexeu). Slot com card que não está na base
 * (não deveria ocorrer) também não é marcado. Valor nulo/inválido no rascunho nunca é marcado (o servidor recusaria
 * com P0001). Não muta a entrada; slot sem mudança mantém a mesma referência nas duas árvores.
 */
export function marcarTamanhoTocado(
  arvore: PtArvore,
  base: PtArvore | null | undefined,
  travado?: (modeloId: string) => boolean,
): MarcaTamanho {
  const daBase = valoresDaBase(base);
  const tocados: string[] = [];
  const revertidos: { modeloId: string; nome: string }[] = [];
  const mapear = (paraPayload: boolean): PtArvore => ({
    ...arvore,
    subcolecoes: arvore.subcolecoes.map((sub) => ({
      ...sub,
      linhas: sub.linhas.map((ln) => ({
        ...ln,
        slots: ln.slots.map((slot): PtSlot => {
          const mid = slot.modelo_id;
          if (!mid || !daBase.has(mid)) return slot;
          const vBase = daBase.get(mid) ?? null;
          const vDraft = slot.tamanho_tipo ?? null;
          if (vDraft === vBase || !valido(vDraft)) return slot;
          if (travado?.(mid)) {
            if (paraPayload) revertidos.push({ modeloId: mid, nome: slot.nome ?? slot.ref ?? "Modelo" });
            return { ...slot, tamanho_tipo: vBase };
          }
          if (!paraPayload) return slot;
          tocados.push(mid);
          return { ...slot, tamanho_tipo: vDraft, tamanho_tipo_tocado: true } as SlotPayloadTamanho;
        }),
      })),
    })),
  });
  const payload = mapear(true);
  const local = mapear(false);
  return { arvore: payload, local, tocados, revertidos };
}

/** Toast do Salvar quando o card foi travado pela Integração enquanto a pessoa editava (mesmo tom de
 *  `toastDescartadasPelaIntegracao` do Planejamento). */
export function textoTamanhoRevertido(revertidos: readonly { nome: string }[]): string {
  const nomes = revertidos.map((r) => r.nome);
  const lista = nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return `O "Tamanho em" de ${lista} foi travado pela Integração enquanto você editava — essa alteração não foi salva.`;
}
