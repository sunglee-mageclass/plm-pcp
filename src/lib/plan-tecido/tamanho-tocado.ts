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
import { igual } from "./atendimento";

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

type BaseIdx = { porId: Map<string, PtSlot>; porModelo: Map<string, PtSlot> };
function indexarBase(base: PtArvore | null | undefined): BaseIdx {
  const porId = new Map<string, PtSlot>();
  const porModelo = new Map<string, PtSlot>();
  if (!base) return { porId, porModelo };
  for (const sub of base.subcolecoes)
    for (const ln of sub.linhas)
      for (const s of ln.slots) {
        if (s.id) porId.set(s.id, s);
        if (s.modelo_id) porModelo.set(s.modelo_id, s);
      }
  return { porId, porModelo };
}

/** Slot da BASE correspondente: por `slot.id` PRIMEIRO (fix I-1 da revisão T4 — um card recém-criado pelo "Criar cards"
 *  ainda é a VAGA na base, com o mesmo id e sem modelo_id; buscar só por modelo_id perdia a troca feita antes do
 *  próximo Salvar), com fallback por modelo_id. */
export function slotDaBase(base: PtArvore | null | undefined, slot: PtSlot): PtSlot | undefined {
  const idx = indexarBase(base);
  return (slot.id ? idx.porId.get(slot.id) : undefined) ?? (slot.modelo_id ? idx.porModelo.get(slot.modelo_id) : undefined);
}

export type OpcoesMarca = {
  /** Card travado pela Integração (a trava cobre SEMPRE `tamanho_tipo`). */
  travado?: (modeloId: string) => boolean;
  /** Fix I-2 da revisão T4: só slots que a PESSOA editou (`touchedSlotIdsRef`) podem ser marcados/revertidos. Um slot
   *  não tocado cujo valor difere da base (ex.: retry do P0409 com rascunho velho contra base nova — outra tela trocou
   *  o "Tamanho em") nunca vira "tocado": sem isto o Salvar sobrescreveria a troca alheia. Ausente = sem filtro. */
  touchedIds?: ReadonlySet<string>;
};

/**
 * Marca o "Tamanho em" tocado nos slots com card. `base` = última árvore conhecida do servidor (`planBaseRef`); sem
 * base, nada é marcado (sem referência não dá para afirmar que a pessoa mexeu). Slot com card sem correspondente na
 * base (nem por id, nem por modelo_id) também não é marcado. Valor nulo/inválido no rascunho nunca é marcado (o
 * servidor recusaria com P0001). Não muta a entrada; slot sem mudança mantém a mesma referência nas duas árvores.
 */
export function marcarTamanhoTocado(
  arvore: PtArvore,
  base: PtArvore | null | undefined,
  opts: OpcoesMarca = {},
): MarcaTamanho {
  const idx = indexarBase(base);
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
          if (!mid) return slot;
          if (opts.touchedIds && !(slot.id && opts.touchedIds.has(slot.id))) return slot;
          const b = (slot.id ? idx.porId.get(slot.id) : undefined) ?? idx.porModelo.get(mid);
          if (!b) return slot;
          const vBase = b.tamanho_tipo ?? null;
          const vDraft = slot.tamanho_tipo ?? null;
          if (vDraft === vBase || !valido(vDraft)) return slot;
          if (opts.travado?.(mid)) {
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

/** Fix M-3 da revisão T4: o slot difere da base SÓ no "Tamanho em" (troca de rótulo). O auto-aplicar do Salvar pula esse
 *  slot — reenviar o BOM do card por uma troca que não mexe em tecido/cor/pç reescreveria o BOM e bumparia o `rev` do
 *  modelo à toa (e podia abrir o diálogo de sobrescrita). Sem base correspondente ⇒ false (aplica como antes). */
export function soTamanhoMudou(slot: PtSlot, baseSlot: PtSlot | undefined): boolean {
  if (!baseSlot) return false;
  if ((slot.tamanho_tipo ?? null) === (baseSlot.tamanho_tipo ?? null)) return false;
  const sem = (s: PtSlot) => ({ ...s, tamanho_tipo: null, tamanho_tipo_tocado: undefined });
  return igual(sem(slot), sem(baseSlot));
}

/** Toast do Salvar quando o card foi travado pela Integração enquanto a pessoa editava (mesmo tom de
 *  `toastDescartadasPelaIntegracao` do Planejamento). */
export function textoTamanhoRevertido(revertidos: readonly { nome: string }[]): string {
  const nomes = revertidos.map((r) => r.nome);
  const lista = nomes.length <= 1 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return `O "Tamanho em" de ${lista} foi travado pela Integração enquanto você editava — essa alteração não foi salva.`;
}
