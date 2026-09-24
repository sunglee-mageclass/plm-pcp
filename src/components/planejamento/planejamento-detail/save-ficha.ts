// F3.2 — regras PURAS do Salvar unificado do Planejamento (usePlanejamentoSave.ts). Testadas em
// tests/unit/planejamento-save-ficha.test.ts. Os dois fixes vêm da receita do Desenvolvimento
// (commit 2419d0f): re-basear no ENVIADO (não no ao vivo) e mandar no retry o draft MESCLADO.
import { igual, mergeDraft, type Conflito } from "@/lib/colab/merge";
import { pecaCom, type TotaisBom, type BomCapturado } from "./ficha/ficha-calc";

export type OpcoesColunasFicha = {
  isEdit: boolean;
  /** habilitada (interno) E carregada E `canEdit("criacao_desenvolvimento")` E sem trava. */
  podeGravarColunasDev: boolean;
  /** true na 1ª tentativa OU quando ESTE save grava o BOM (os derivados saem do mesmo BOM gravado — R5); false no retry
   *  do P0409 SEM gravar o BOM (o BOM local, não tocado, pode estar velho frente ao do servidor). */
  incluirDerivados: boolean;
  /** `criacao_planejamento:custos` OU `criacao_desenvolvimento:custos` (decisão F3 #2). */
  podeVerCustos: boolean;
  totais: TotaisBom | null;
  /** Σ das linhas de MO do SERVIDOR (baseline) — o Dev grava custo_peca_previsto com ela e corrige depois (:1921-1930, :2140-2150). */
  maoObraServidor: number;
  gravaBom: boolean;
  tecidosPlanejados: string[];
};

/** Ajusta (in place) o payload do UPDATE `modelos` com as colunas do Desenvolvimento. */
export function aplicarColunasFicha(payload: Record<string, unknown>, o: OpcoesColunasFicha): Record<string, unknown> {
  if (!o.isEdit) return payload;
  // A lista NÃO é mais editada à mão no card existente: só vai quando o BOM grava (derivada dos blocos).
  delete payload.tecidos_planejados;
  if (!o.podeGravarColunasDev) {
    delete payload.proporcoes;
    delete payload.custos_adicionais;
    return payload;
  }
  if (o.incluirDerivados && o.totais) {
    payload.custo_tecido_total = o.totais.tecido;
    payload.custo_forro_total = o.totais.forro;
    payload.custo_entretela_total = o.totais.entretela;
    payload.custo_aviamento_total = o.totais.aviamento;
    if (o.podeVerCustos) payload.custo_peca_previsto = pecaCom(o.totais, o.maoObraServidor);
  }
  if (o.gravaBom) payload.tecidos_planejados = o.tecidosPlanejados;
  return payload;
}

/**
 * Fix T10 I1 — "alguém salvou agora" falso depois do PRÓPRIO save do BOM. O UPDATE do header leva
 * `tecidos_planejados` DERIVADO do BOM (`aplicarColunasFicha`, só quando `bom.gravar`) — mas o draft
 * ENVIADO (`savedDraft`, congelado no início do `mutationFn`) ainda carrega o valor de ANTES do save
 * (a lista não é recalculada no draft, só no payload). Sem este fix, `baseRef`/`resetDraftBaseline`/
 * `tocadosAposSalvar` comparam com um baseline desatualizado e o refetch de `["modelo"]` (que já tem a
 * lista NOVA) aparece como "atualizados=['tecidos_planejados']" no merge — um aviso de conflito contra
 * o PRÓPRIO write. Fix: quando o BOM gravou, o draft ENVIADO efetivo adota `bom.tecidosPlanejados` (a
 * lista que FOI de fato ao banco); quando não gravou, `savedDraft` sai inalterado.
 */
export function draftEnviadoEfetivo<T extends { tecidos_planejados: string[] }>(savedDraft: T, bom: Pick<BomCapturado, "gravar" | "tecidosPlanejados">): T {
  if (!bom.gravar) return savedDraft;
  if (igual(savedDraft.tecidos_planejados, bom.tecidosPlanejados)) return savedDraft;
  return { ...savedDraft, tecidos_planejados: bom.tecidosPlanejados };
}

/** Depois do save: segue "tocado" só o campo que mudou DEPOIS do envio (tecla digitada em voo). */
export function tocadosAposSalvar<T extends Record<string, any>>(o: { touched: ReadonlySet<string>; live: T; enviado: T }): Set<string> {
  const out = new Set<string>();
  for (const k of o.touched) if (!igual(o.live[k], o.enviado[k])) out.add(k);
  return out;
}

/**
 * Merge do P0409 + decisão de retentar. O chamador DEVE espelhar `proximoDraft` no draftLiveRef ANTES do retry.
 * `bomConflito` (R5 do G-plano conjunto) = o BOM está tocado E o BOM do SERVIDOR mudou de verdade — um P0409 que veio
 * de uma ação do próprio usuário que só subiu o `rev` (Mover para…, Ordem, Lançar, aprovar MO) retenta normalmente.
 * (O Duplicar NÃO tem lista aqui: usa o `camposParaDuplicar` da F3.1 com a lista única `CAMPOS_DEV_DRAFT`.)
 */
export function prepararRetryP0409<T extends Record<string, any>>(o: { base: T; live: T; fresh: T; touched: ReadonlySet<string>; bomConflito: boolean }): {
  proximoDraft: T; conflitos: Conflito[]; atualizados: number; podeRetentar: boolean;
} {
  const md = mergeDraft({ base: o.base, draft: o.live, fresh: o.fresh, touched: o.touched });
  const mudou = md.atualizados.length > 0 || md.conflitos.length > 0;
  return {
    proximoDraft: mudou ? md.valor : o.live,
    conflitos: md.conflitos,
    atualizados: md.atualizados.length,
    podeRetentar: md.conflitos.length === 0 && !o.bomConflito,
  };
}
