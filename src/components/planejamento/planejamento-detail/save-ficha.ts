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

/**
 * Fix final M1 (2ª parte) — `proporcoes`/`custos_adicionais` fora do payload NÃO podem virar "enviado" no
 * baseline. Cenário: a ficha (BOM) está travada no meio do caminho (`podeGravarColunasDev=false` — a trava
 * "cad"/"enviado" chegou ENTRE a captura e o Salvar, ou o usuário nunca teve permissão de gravar colunas do
 * Dev) — `aplicarColunasFicha` (acima) faz `delete payload.proporcoes; delete payload.custos_adicionais`, e o
 * mesmo vale por `aplicarRegrasCamposDev` quando `!podeEditarDev`. O servidor NUNCA recebe esses 2 campos, mas
 * `savedDraft` (o `d` congelado no início do `mutationFn`) ainda carrega o valor EDITADO localmente — sem este
 * fix, `resetDraftBaseline(enviadoEfetivo)` adotaria esse valor como "o que está salvo", e o selo "não salvo"
 * apagaria mesmo com o servidor guardando o valor ANTIGO. Fix: quando `podeGravarColunasDev` é false, o
 * baseline mantém `proporcoes`/`custos_adicionais` do valor do SERVIDOR (`servidor`, o draft ainda carregado
 * ANTES deste save — `baseRef.current.draft`/`draftFromModeloRow(modeloData)`), não o do draft enviado.
 */
export function draftEnviadoComColunasDev<T extends { proporcoes: Record<string, number>; custos_adicionais: unknown[] }>(
  enviadoEfetivo: T, servidor: Pick<T, "proporcoes" | "custos_adicionais">, podeGravarColunasDev: boolean,
): T {
  if (podeGravarColunasDev) return enviadoEfetivo;
  if (igual(enviadoEfetivo.proporcoes, servidor.proporcoes) && igual(enviadoEfetivo.custos_adicionais, servidor.custos_adicionais)) {
    return enviadoEfetivo;
  }
  return { ...enviadoEfetivo, proporcoes: servidor.proporcoes, custos_adicionais: servidor.custos_adicionais };
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

/**
 * Item C (fix round 3 — IMPORTANTE) — a versão anterior usava `enviadoNaCaptura = motivoSomenteLeitura ===
 * "enviado"` como proxy de "o card JÁ estava enviado na captura". Bug: "permissao" tem PRECEDÊNCIA sobre
 * "enviado" na trava ÚNICA (`motivoSomenteLeitura`, useFichaTecnica.ts), e o "Editar" (`editandoDev=true` no
 * PD) transforma o motivo em "cad"/null mesmo com o card enviado — nos dois casos `motivoSomenteLeitura` NUNCA
 * é `"enviado"`, então `enviadoNaCaptura` saía sempre `false`, mesmo com o card JÁ enviado ANTES do save.
 * Cenário que dava errado: card JÁ enviado, usuário sem edição do Dev (ou em "Editar") — o payload já não
 * tinha colunas do Dev (era exatamente o comportamento certo), mas QUALQUER P0409 nesse save (ex.: Lançar e
 * logo em seguida Salvar) caía no bloqueio (`fresh.enviado_cad=true` e `capturadoEnviado` sempre `false`),
 * mostrava o toast falso de "enviado por outra pessoa" e não fazia o retry — mesmo o retry sendo seguro (o
 * payload não grava nada do Dev de qualquer forma).
 *
 * Fix (a): `enviadoCadNaCaptura` agora vem do valor REAL de `modelos.enviado_cad` no início do Salvar (lido
 * do cache já populado pela query `["modelo", modeloId]` do orquestrador — `usePlanejamentoSave.ts`, sem
 * query nova), não mais da trava derivada.
 * Fix (b): o bloqueio exige as DUAS condições — (1) não estava enviado na captura e o `fresh` já está
 * enviado (a mudança aconteceu DURANTE este save) E (2) esta captura IA gravar algo do Dev
 * (`bom.gravar || podeGravarColunasDev`, também capturados no início do save). Sem (2), o payload nunca teve
 * colunas do Dev — o retry é seguro e não deve ser bloqueado.
 *
 * Fix round 4 (item 10, acréscimo do controlador) — condição (2) também cobre os CAMPOS SIMPLES do Dev da
 * F3.1 (modelista, pilotos, datas, obs. técnicas…), que vão no payload por `podeEditarDev` via
 * `aplicarRegrasCamposDev` (helpers.ts ~:109-122) — não só o BOM/colunas derivadas. A decisão F3 #1 trava
 * esses campos depois do envio à Explosão; sem este 3º sinal, um retry que só gravava campos simples do Dev
 * (sem BOM, sem `podeGravarColunasDev`) passava batido num card recém-enviado.
 */
export function retryBloqueadoPorEnvio(
  fresh: { enviado_cad?: boolean | null },
  capturado: { enviadoCadNaCaptura: boolean; gravaBom: boolean; podeGravarColunasDev: boolean; temCamposDevNoPayload: boolean },
): boolean {
  const passouAEnviado = !!fresh.enviado_cad && !capturado.enviadoCadNaCaptura;
  const iaGravarDoDev = capturado.gravaBom || capturado.podeGravarColunasDev || capturado.temCamposDevNoPayload;
  return passouAEnviado && iaGravarDoDev;
}

/**
 * Fix final I1 (IMPORTANTE) — o prefill sobrescreve o BOM de outra pessoa sem P0409. Cenário: A abre um card
 * com o BOM do servidor vazio (fica com o prefill PENDENTE — Tecido 1..N a partir de `tecidos_planejados`,
 * sem marcar tocado). B salva o BOM completo pelo Dev — o merge de A avança `revRef` e o `aoMudarNoServidor`
 * do ramo SEM toque (`!bom.colecoesTouchadasRef.current`) só invalida (não confere/não espera). A clica
 * Salvar ANTES de o refetch do BOM (disparado por essa invalidação) chegar — as 5 queries de
 * `chavesBomServidor` ainda estão em voo (`isFetching`), mas nada no `mutationFn` aguarda isso: o `.eq("rev")`
 * passa (o `rev` de A já está atualizado pelo merge) com `capturar().gravar=true` (prefill pendente), e o
 * esqueleto Tecido 1..N é gravado por cima do BOM que B acabou de completar.
 * Fix: `usePlanejamentoSave.mutationFn` chama isto logo depois da checagem de `verificandoBomRef` (R5) que já
 * existe — se QUALQUER key de `chavesBomServidor` está em refetch, lança a MESMA mensagem PT ("BOM sendo
 * conferido") do fix round 2 item F (já passa no `mensagemErro`), e o Salvar não segue.
 */
export function bomRecarregando(isFetchingPorKey: number[]): boolean {
  return isFetchingPorKey.some((n) => n > 0);
}

/**
 * Fix final ROUND 2, item 2 — o guard I1 acima (`bomRecarregando` sozinho) tinha falso positivo: barrava
 * QUALQUER Salvar com as 5 queries do BOM em refetch, mesmo um que NUNCA gravaria o BOM (refetch de foco da
 * aba, abertura do card que dispara o `enabled` das queries, ou um Salvar que só toca preço/MO com o BOM
 * intocado). Dois efeitos colaterais: (a) trava um Salvar legítimo sem motivo — o BOM local não seria
 * regravado de qualquer forma; (b) no retry do P0409 (`fichaRef.current.bomPendenteDeGravar()` também é
 * conferido no `onError`, mas o `mutationFn` do retry reentra por AQUI primeiro), o retry que devia
 * simplesmente tentar de novo cai num `throw new Error(...)` que o `mensagemErro` traduz e o `onError`
 * mostra como `toast.error` — o P0409 nunca chega a retentar.
 * Fix: o guard só faz sentido quando ESTE save IA gravar o BOM (`bomPendenteDeGravar()` — tocado OU prefill
 * pendente, mesma condição de `capturar().gravar`, sem depender de `podeEditar`/carga). Continua cobrindo o
 * cenário do I1: `gravar=true` (o `.eq("rev")` prestes a passar com o esqueleto Tecido 1..N) só é possível
 * quando `bomPendenteDeGravar()` também é `true` (`capturar().gravar` exige a MESMA condição — ver
 * `useFichaTecnica.capturar`), então barrar SÓ nesse caso não abre a janela do bug original.
 */
export function deveBarrarPorBomRecarregando(bomPendenteDeGravar: boolean, bomRecarregandoAgora: boolean): boolean {
  return bomPendenteDeGravar && bomRecarregandoAgora;
}

/**
 * Item G (menor, fix round 3) — "save em voo" como CONTADOR, não booleano. Extraído p/ ser testável sem
 * montar hooks (mesmo espírito de `retryBloqueadoPorEnvio`). No TanStack Query 5.x, o `mutationFn` do RETRY
 * de um P0409 roda ANTES do `onSettled` do 1º ciclo — com um booleano simples (`marcarSaveEmVoo(true/false)`
 * setando direto), a sequência real (+true no 1º mutationFn, +true de novo no mutationFn do retry, SÓ DEPOIS
 * o onSettled do 1º ciclo chamando false) fazia esse `onSettled` desligar a flag NO MEIO do retry, que ainda
 * estava rodando (`persistirBom`, MO, `marcar_revisao_por_mudanca`). Contador com PISO 0: `true` soma 1,
 * `false` subtrai 1 sem nunca ir negativo (um `onSettled` "sobrando" — ex.: erro antes do 1º
 * `marcarSaveEmVoo(true)` chegar a rodar — não deixa dívida que exigiria 2 `true`s pra sair de "em voo").
 * "Em voo" = contador > 0 (ver `useFichaTecnica.ts`, `saveEmVooContadorRef`).
 */
export function contadorVoo(atual: number, marcar: boolean): number {
  return Math.max(0, atual + (marcar ? 1 : -1));
}

/**
 * Fix final M1 (1ª parte) — trava que chega ENTRE editar e salvar descarta a edição em silêncio. Porta de
 * `save-ficha.ts` da F3.3 (commit `5e32951`, worktree `f33-cad-acoes`, sem a parte do CAD — a F3.2 não tem
 * CAD, só BOM). Cenário: B toca o BOM (Tecidos/Aviamentos/Insumos/Grade); ENTRE a captura e o Salvar, o card é
 * enviado à Explosão por outra pessoa e a ficha destrava→trava ("cad"/"enviado") — `capturar().gravar` fica
 * `false` mesmo com o toque (`useFichaTecnica.capturar` exige `podeEditarRef.current` ANTES de olhar
 * `colecoesTouchadasRef`). `aposSalvar` (useFichaTecnica.ts) chamava `bom.limparTocado()` incondicional quando
 * `!bomMudouEmVoo` — e como `bomMudouEmVoo` também exige `tocado` (aqui É true, mas nada foi de fato enviado
 * ao servidor), o "não salvo" apagava e as edições do BOM somem com o toast "Modelo salvo".
 * Regra: NÃO limpe o tocado (nem rebaseie, nem mova a referência) quando havia BOM tocado que DEVERIA ter
 * sido gravado e este Salvar NÃO gravou. Só quando o que estava tocado FOI gravado (ou nunca houve toque) é
 * seguro limpar — aí `bomMudouEmVoo` decide se rebaseia no ENVIADO ou limpa de vez (como já fazia).
 */
export function deveLimparTocadoAposSalvar(i: { tocado: boolean; bomGravou: boolean }): boolean {
  if (!i.tocado) return true;
  return i.bomGravou;
}
