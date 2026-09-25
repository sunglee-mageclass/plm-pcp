// Distribuição por produto no Plan. Tecido — "atende a" (forro/Tecido 2… × cores do Tecido 1) e a NORMALIZAÇÃO do slot
// (spec R2, R3, R4, R6, R14–R16). PURO. A normalização é a ÚNICA porta que deriva o pç: roda no carregamento
// (computeFreshArvore) e em todo `patch` do PlanTecidoSheet; é idempotente (devolve o MESMO objeto quando nada muda).
import type { PtArvore, PtMaterial, PtSlot, PtVariante } from "./types";
import { buildMateriaisAplicar, varKey } from "./calc";
import { normalizarDistribuicao, tamanhosDoTipo, temDistribuicao, tipoDoProduto, totaisDaDistribuicao } from "@/lib/distribuicao-produto";

/** Tecido 1 = `tipo='tecido' AND numero=1` (o mesmo critério do servidor e do `_plan_tecido_gravar_bom_core`). */
export const ehTecido1 = (m: Pick<PtMaterial, "tipo" | "numero">): boolean => m.tipo === "tecido" && Number(m.numero) === 1;

/** Chave salva no "atende a" → chave ATUAL de uma cor do T1. A cor planejada (`plan:cor|apelido`) que virou variante
 *  real é re-casada por cor + apelido (R16). */
export function resolverChaveT1(k: string, t1: PtVariante[]): string | null {
  for (const v of t1) if (varKey(v) === k) return k;
  if (k.startsWith("plan:")) {
    const [cor, ap] = k.slice(5).split("|");
    const v = t1.find((x) => (x.cor_id ?? "") === (cor ?? "") && (x.cor_apelido_id ?? "") === (ap ?? ""));
    return v ? varKey(v) : null;
  }
  return null;
}

export type Atendimento = {
  /** chave da cor do bloco → chaves das cores do T1 que ela atende (na ordem do T1) */
  porCor: Map<string, string[]>;
  /** chave da cor do T1 → chave da cor do bloco que a atende */
  servidaPor: Map<string, string>;
  /** cores do bloco com lista escolhida à mão */
  manual: Set<string>;
};

/** Regra do "atende a" de UM bloco (R14): (1) listas à mão, na ordem das cores do bloco, vencem; (2) cor sem lista
 *  (automático) atende as cores do T1 de MESMA cor base ainda livres; cada cor do T1 é atendida por no máximo 1. */
export function atendimentoDoBloco(t1: PtVariante[], bloco: PtVariante[]): Atendimento {
  const servidaPor = new Map<string, string>();
  const manual = new Set<string>();
  for (const b of bloco) {
    if (!Array.isArray(b.atende)) continue;
    const kb = varKey(b);
    manual.add(kb);
    for (const k of b.atende) {
      const kt = resolverChaveT1(String(k), t1);
      if (kt && !servidaPor.has(kt)) servidaPor.set(kt, kb);
    }
  }
  for (const b of bloco) {
    const kb = varKey(b);
    if (manual.has(kb) || !b.cor_id) continue;
    for (const v of t1) {
      const kt = varKey(v);
      if (!servidaPor.has(kt) && !!v.cor_id && v.cor_id === b.cor_id) servidaPor.set(kt, kb);
    }
  }
  const porCor = new Map<string, string[]>(bloco.map((b) => [varKey(b), [] as string[]]));
  for (const v of t1) {
    const kt = varKey(v);
    const kb = servidaPor.get(kt);
    if (kb) porCor.get(kb)?.push(kt);
  }
  return { porCor, servidaPor, manual };
}

/** pç de UMA cor do bloco = Σ pç (e Σ por tamanho) das cores do T1 que ela atende; null = não atende nenhuma
 *  (pç digitado como hoje — R14). */
export function pcAtendido(t1: PtVariante[], servidas: string[]): { grade_total: number; grades: Record<string, number> } | null {
  if (servidas.length === 0) return null;
  const set = new Set(servidas);
  let grade_total = 0;
  const grades: Record<string, number> = {};
  for (const v of t1) {
    if (!set.has(varKey(v))) continue;
    grade_total += Number(v.grade_total) || 0;
    for (const [t, q] of Object.entries(v.grades ?? {})) grades[t] = (grades[t] ?? 0) + (Number(q) || 0);
  }
  return { grade_total, grades };
}

/** Lista explícita depois de marcar/desmarcar uma cor do T1 no popover: parte do conjunto EFETIVO de hoje. */
export function alternarAtende(at: Atendimento, kb: string, kt: string): string[] {
  const atuais = at.porCor.get(kb) ?? [];
  return atuais.includes(kt) ? atuais.filter((x) => x !== kt) : [...atuais, kt];
}

/** Só ids de variante REAL (o BOM — `complementa_variante_ids uuid[]` — não aceita cor planejada). */
export const complementaReal = (servidas: string[]): string[] => servidas.filter((k) => !k.startsWith("plan:"));

export type OpcoesDist = { ligado: boolean; tamanhos: string[] };

// Comparação CANÔNICA (Lote A fix1 · C1): o jsonb do Postgres devolve as chaves de objeto REORDENADAS
// (por tamanho da chave, depois por bytes) — comparar por JSON.stringify direto (chaves na ordem de
// inserção) acusava mudança onde não havia, deixando o slot "sujo" para sempre. Ordena as chaves de
// objeto recursivamente; arrays mantêm a ordem (são dado, não mapa).
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = canon(o[k]);
    return out;
  }
  return v;
}
const igual = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/** Deriva o pç do slot (R6): (1) cada cor do T1 com distribuição → células não-manuais recalculadas (proporção × Base),
 *  `grades`/`grade_total` = totais; distribuição que esvazia fica `{}` SEM zerar o pç (R10); (2) cada cor de outro
 *  bloco que atende ≥ 1 cor do T1 → pç = soma. Módulo desligado ⇒ o MESMO slot. Nada mudou ⇒ o MESMO slot. */
export function normalizarSlotDistribuicao(slot: PtSlot, o: OpcoesDist): PtSlot {
  if (!o.ligado) return slot;
  const iT1 = slot.materiais.findIndex(ehTecido1);
  if (iT1 < 0) return slot;
  const tams = o.tamanhos.length ? tamanhosDoTipo(o.tamanhos, tipoDoProduto(slot.tamanho_tipo)) : [];
  const t1Vars: PtVariante[] = slot.materiais[iT1].variantes.map((v) => {
    if (!temDistribuicao(v.distribuicao)) return v;
    const d = normalizarDistribuicao(v.distribuicao, slot.proporcoes, tams);
    if (!temDistribuicao(d)) return { ...v, distribuicao: {} };
    const tot = totaisDaDistribuicao(d);
    return { ...v, distribuicao: d, grades: tot.grades, grade_total: tot.total };
  });
  const materiais = slot.materiais.map((m, i) => {
    if (i === iT1) return { ...m, variantes: t1Vars };
    const at = atendimentoDoBloco(t1Vars, m.variantes);
    return {
      ...m,
      variantes: m.variantes.map((b) => {
        const pc = pcAtendido(t1Vars, at.porCor.get(varKey(b)) ?? []);
        return pc ? { ...b, grade_total: pc.grade_total, grades: pc.grades } : b;
      }),
    };
  });
  return igual(materiais, slot.materiais) ? slot : { ...slot, materiais };
}

/** A árvore inteira (carregamento e `patch`). Devolve a MESMA árvore quando nenhum slot mudou. */
export function normalizarArvoreDistribuicao(arv: PtArvore, o: OpcoesDist): PtArvore {
  if (!o.ligado) return arv;
  let mudou = false;
  const subcolecoes = arv.subcolecoes.map((sub) => {
    let mSub = false;
    const linhas = sub.linhas.map((ln) => {
      let mLn = false;
      const slots = ln.slots.map((s) => {
        const n = normalizarSlotDistribuicao(s, o);
        if (n !== s) mLn = true;
        return n;
      });
      if (!mLn) return ln;
      mSub = true;
      return { ...ln, slots };
    });
    if (!mSub) return sub;
    mudou = true;
    return { ...sub, linhas };
  });
  return mudou ? { ...arv, subcolecoes } : arv;
}

// recalculadasT1 (Lote A fix1 · M5): quantos SLOTS tiveram o Tecido 1 recalculado (a distribuição mudou o pç do
// próprio bloco T1) — permite a T5 mostrar um aviso próprio ("Distribuição recalculada — salve para gravar")
// quando só o T1 mudou (sem nenhuma cor de forro/Tecido 2 afetada).
export type EfeitoCarga = { arvore: PtArvore; base: PtArvore; tocados: string[]; recalculadasForaT1: number; recalculadasT1: number; sujo: boolean };

/** Carga do Plan. Tecido (G-plano R3 — PR12). Normaliza a árvore CRUA (o que o banco tem). Se a normalização MUDOU algum
 *  slot (pç derivado da distribuição ou do "atende a" ≠ o gravado), o slot fica "não salvo": a base do merge colab segue
 *  a CRUA, os slots mudados entram como tocados e o Sheet mostra o aviso — assim, depois do 1º Salvar, o número do card é
 *  o mesmo que o Resumo/Modo Plano/Fazer pedido (servidor) leem. Sem mudança ⇒ nada sujo. Sem permissão ⇒ só o aviso. */
export function efeitoDaCarga(cru: PtArvore, o: OpcoesDist, podeEditar: boolean): EfeitoCarga {
  const arvore = normalizarArvoreDistribuicao(cru, o);
  if (arvore === cru) return { arvore, base: cru, tocados: [], recalculadasForaT1: 0, recalculadasT1: 0, sujo: false };
  const tocados: string[] = [];
  let slotsMudados = 0;
  let foraT1 = 0;
  let t1Mudou = 0;
  cru.subcolecoes.forEach((sub, i) => sub.linhas.forEach((ln, j) => ln.slots.forEach((s, k) => {
    const n = arvore.subcolecoes[i].linhas[j].slots[k];
    if (n === s) return;
    slotsMudados++;
    if (s.id) tocados.push(s.id);
    s.materiais.forEach((m, mi) => {
      if (ehTecido1(m)) {
        const nm = n.materiais[mi];
        if (nm && !igual(nm.variantes, m.variantes)) t1Mudou++;
        return;
      }
      m.variantes.forEach((v, vi) => {
        const nv = n.materiais[mi]?.variantes[vi];
        if (nv && (Number(nv.grade_total) !== Number(v.grade_total) || !igual(nv.grades ?? {}, v.grades ?? {}))) foraT1++;
      });
    });
  })));
  return { arvore, base: cru, tocados, recalculadasForaT1: foraT1, recalculadasT1: t1Mudou, sujo: podeEditar && slotsMudados > 0 };
}

/** Payload de `plan_tecido_aplicar_ao_modelo`/`plan_tecido_criar_card(s)` = o de sempre (`buildMateriaisAplicar`, fonte
 *  única) + `complementa_variante_ids` em cada cor de bloco que NÃO é o T1, SÓ com o módulo ligado (R3/R4). Sem o módulo a
 *  chave não vai e o servidor PRESERVA o casamento que o BOM já tinha. */
export function materiaisParaAplicar(slot: PtSlot, ligado: boolean) {
  const base = buildMateriaisAplicar(slot);
  if (!ligado) return base;
  const t1 = slot.materiais.find(ehTecido1);
  if (!t1) return base;
  return base.map((m, i) => {
    const orig = slot.materiais[i];
    if (!orig || ehTecido1(orig)) return m;
    const at = atendimentoDoBloco(t1.variantes, orig.variantes);
    return {
      ...m,
      variantes: m.variantes.map((pv, j) => ({
        ...pv,
        complementa_variante_ids: complementaReal(at.porCor.get(varKey(orig.variantes[j])) ?? []),
      })),
    };
  });
}
