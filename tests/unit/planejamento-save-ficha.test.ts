import { describe, it, expect } from "vitest";
import {
  aplicarColunasFicha, prepararRetryP0409, tocadosAposSalvar, draftEnviadoEfetivo, retryBloqueadoPorEnvio, contadorVoo,
  bomRecarregando, deveLimparTocadoAposSalvar, draftEnviadoComColunasDev, deveBarrarPorBomRecarregando,
} from "@/components/planejamento/planejamento-detail/save-ficha";
import { normalizarDraftSalvo } from "@/components/planejamento/planejamento-detail/helpers";
import type { TotaisBom } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";
import { mensagemErro } from "@/lib/erro-mensagem";

// F3.2 — regras do Salvar unificado do Planejamento (payload do UPDATE `modelos`, rebase pós-save e
// o retry do P0409). Fixes: receita 2419d0f do Desenvolvimento.
const totais: TotaisBom = { tecido: 57.17, forro: 16.52, entretela: 0, aviamento: 4.9, etiqueta: 1.2, custosAdicionais: 3.5, materiaisBom: 79.79, terceirizados: 0, peca: 83.29 };
const base = () => ({ nome: "X", tecidos_planejados: ["a"], proporcoes: { P: 1 }, custos_adicionais: [{ descricao: "B", valor: 3.5 }] } as Record<string, unknown>);
const op = (p: Partial<Parameters<typeof aplicarColunasFicha>[1]> = {}) => ({
  isEdit: true, podeGravarColunasDev: true, incluirDerivados: true, podeVerCustos: true,
  totais, maoObraServidor: 35, gravaBom: false, tecidosPlanejados: ["a", "s"], ...p,
});

describe("aplicarColunasFicha", () => {
  it("card novo: não mexe (a lista do Dialog vai no insert)", () => {
    expect(aplicarColunasFicha(base(), op({ isEdit: false }))).toEqual(base());
  });
  it("edição SEM permissão do Dev: omite lista, proporções e custos adicionais; nenhum custo derivado (decisão F3 #8)", () => {
    const p = aplicarColunasFicha(base(), op({ podeGravarColunasDev: false }));
    expect(p).toEqual({ nome: "X" });
  });
  it("edição com permissão, 1ª tentativa, BOM não gravado: custos derivados SIM, tecidos_planejados NÃO", () => {
    const p = aplicarColunasFicha(base(), op());
    expect(p.tecidos_planejados).toBeUndefined();
    expect(p).toMatchObject({ custo_tecido_total: 57.17, custo_forro_total: 16.52, custo_entretela_total: 0, custo_aviamento_total: 4.9 });
    expect(p.custo_peca_previsto as number).toBeCloseTo(118.29);
    expect(p.proporcoes).toEqual({ P: 1 });
  });
  it("sem ver custos: não grava custo_peca_previsto (a MO vem mascarada — Dev :1914-1930)", () => {
    expect(aplicarColunasFicha(base(), op({ podeVerCustos: false })).custo_peca_previsto).toBeUndefined();
  });
  it("retry do P0409 sem gravar o BOM (incluirDerivados=false): nenhum custo derivado", () => {
    const p = aplicarColunasFicha(base(), op({ incluirDerivados: false }));
    expect(p.custo_tecido_total).toBeUndefined();
    expect(p.custo_peca_previsto).toBeUndefined();
  });
  it("BOM gravado: tecidos_planejados = lista DERIVADA", () => {
    expect(aplicarColunasFicha(base(), op({ gravaBom: true })).tecidos_planejados).toEqual(["a", "s"]);
  });
  it("ficha não carregada (totais null): sem custos derivados", () => {
    expect(aplicarColunasFicha(base(), op({ totais: null })).custo_tecido_total).toBeUndefined();
  });
});

describe("draftEnviadoEfetivo — fix T10 I1 (aviso falso 'alguém salvou' após o próprio save do BOM)", () => {
  it("BOM gravou → a lista do draft ENVIADO vem do BOM (a que foi de fato ao banco)", () => {
    const savedDraft = { nome: "X", tecidos_planejados: ["A"] };
    const out = draftEnviadoEfetivo(savedDraft, { gravar: true, tecidosPlanejados: ["A", "B"] });
    expect(out).toEqual({ nome: "X", tecidos_planejados: ["A", "B"] });
    expect(out).not.toBe(savedDraft);
  });
  it("BOM não gravou → savedDraft sai INALTERADO (mesma referência)", () => {
    const savedDraft = { nome: "X", tecidos_planejados: ["A"] };
    const out = draftEnviadoEfetivo(savedDraft, { gravar: false, tecidosPlanejados: ["A", "B"] });
    expect(out).toBe(savedDraft);
  });
  it("BOM gravou mas a lista derivada já é IGUAL à do savedDraft → mesma referência (sem objeto novo à toa)", () => {
    const savedDraft = { nome: "X", tecidos_planejados: ["A", "B"] };
    const out = draftEnviadoEfetivo(savedDraft, { gravar: true, tecidosPlanejados: ["A", "B"] });
    expect(out).toBe(savedDraft);
  });
});

describe("tocadosAposSalvar — fix do save-em-voo", () => {
  it("mantém tocado só o que mudou DEPOIS do envio", () => {
    const out = tocadosAposSalvar({
      touched: new Set(["nome", "semana"]),
      live: { nome: "Novo 2", semana: "2" },
      enviado: { nome: "Novo", semana: "2" },
    });
    expect([...out]).toEqual(["nome"]);
  });

  // Fix I2 (revisão Opus, rodada 1 pós-rebase-cadeia F3.1 FINAL) — a fusão F3.1 final × F3.2 fazia
  // `tocadosAposSalvar`/o baseline do "não salvo" nascerem do `savedDraft` NORMALIZADO
  // (`normalizarDraftSalvo`, F3.1 final: ref.trim(), descricao_produto trim-ou-NULL). Como o rascunho
  // VIVO segue CRU (o que o usuário digitou, ex. " ABC "), a comparação NUNCA batia e `ref`/
  // `descricao_produto` ficavam tocados pra sempre — "não salvo" aceso mesmo logo após salvar.
  // Ruling do controlador: `tocadosAposSalvar` (e o baseline `resetDraftBaseline`, no orquestrador)
  // usam o rascunho CRU enviado, NÃO o normalizado — só o `baseRef` do merge usa o normalizado.
  it("com o CRU enviado (não o normalizado): ref/descricao_produto NÃO ficam tocados mesmo com espaços", () => {
    const dCru = { ref: " ABC ", descricao_produto: "   ", nome: "x" };
    // Simula o vivo IDÊNTICO ao que foi enviado (nenhuma tecla digitada durante o voo do save).
    const out = tocadosAposSalvar({
      touched: new Set(["ref", "descricao_produto"]),
      live: dCru,
      enviado: dCru, // CRU — não normalizarDraftSalvo(dCru)
    });
    expect([...out]).toEqual([]);
  });
  it("com o NORMALIZADO por engano (regressão que este fix evita): ref/descricao_produto ficam tocados pra sempre", () => {
    const dCru = { ref: " ABC ", descricao_produto: "   ", nome: "x" };
    const enviadoErrado = normalizarDraftSalvo(dCru as any);
    const out = tocadosAposSalvar({
      touched: new Set(["ref", "descricao_produto"]),
      live: dCru,
      enviado: enviadoErrado, // NORMALIZADO — o bug da fusão I2
    });
    expect([...out].sort()).toEqual(["descricao_produto", "ref"]);
  });
  it("o baseline do MERGE (baseRef) usa o normalizado — ref/descricao_produto do banco, não os digitados com espaço", () => {
    const dCru = { ref: " ABC ", descricao_produto: "   ", nome: "x" };
    const baseDoMerge = normalizarDraftSalvo(dCru as any);
    expect(baseDoMerge.ref).toBe("ABC");
    expect(baseDoMerge.descricao_produto).toBe("");
  });
});

describe("prepararRetryP0409 — fix do retry", () => {
  const b = { nome: "A", observacoes_gerais: "x", preco_venda: 10 };
  it("adota o campo do outro usuário e mantém o meu → o retry manda os DOIS", () => {
    const r = prepararRetryP0409({ base: b, live: { ...b, nome: "B" }, fresh: { ...b, observacoes_gerais: "do outro" }, touched: new Set(["nome"]), bomConflito: false });
    expect(r.proximoDraft).toEqual({ nome: "B", observacoes_gerais: "do outro", preco_venda: 10 });
    expect(r.atualizados).toBe(1);
    expect(r.podeRetentar).toBe(true);
  });
  it("conflito no MESMO campo → não retenta", () => {
    const r = prepararRetryP0409({ base: b, live: { ...b, nome: "B" }, fresh: { ...b, nome: "C" }, touched: new Set(["nome"]), bomConflito: false });
    expect(r.conflitos.map((c) => c.path)).toEqual(["nome"]);
    expect(r.podeRetentar).toBe(false);
  });
  it("BOM tocado E o BOM do servidor mudou → não retenta (vira conflito de seção 'Tecidos & BOM')", () => {
    const r = prepararRetryP0409({ base: b, live: b, fresh: { ...b, preco_venda: 12 }, touched: new Set(), bomConflito: true });
    expect(r.podeRetentar).toBe(false);
  });
  it("R5: BOM tocado mas o do servidor IGUAL (o P0409 veio de uma ação que só subiu o rev) → retenta", () => {
    const r = prepararRetryP0409({ base: b, live: b, fresh: { ...b, preco_venda: 12 }, touched: new Set(), bomConflito: false });
    expect(r.podeRetentar).toBe(true);
    expect(r.proximoDraft).toEqual({ ...b, preco_venda: 12 });
  });
  it("nada mudou → devolve o MESMO objeto ao vivo", () => {
    const live = { ...b };
    expect(prepararRetryP0409({ base: b, live, fresh: { ...b }, touched: new Set(), bomConflito: false }).proximoDraft).toBe(live);
  });
});

// Item F (fix round 2) — a mensagem do ramo "BOM ainda conferindo" (usePlanejamentoSave.ts, guard de
// `verificandoBomRef`) precisa ter acento/palavra da lista `PARECE_PT` (erro-mensagem.ts), senão o
// `mensagemErro` a troca pelo fallback genérico "Erro" em vez de mostrar o texto real ao usuário.
describe("mensagemErro — a mensagem de 'BOM conferindo' do usePlanejamentoSave passa como PT (item F)", () => {
  it("é reconhecida como PT (não cai no fallback genérico)", () => {
    const msg = "O BOM ainda está sendo conferido com o servidor — aguarde um instante e salve de novo.";
    expect(mensagemErro(new Error(msg), "Erro")).toBe(msg);
  });
});

// Item C (fix round 3 — IMPORTANTE) — o retry AUTOMÁTICO do P0409 não pode gravar o BOM/colunas do Dev num
// card que foi enviado à Explosão por outra pessoa NO MEIO do save (`_salvar_modelo_bom_core` não tem
// guarda própria no servidor). round 2 usava `motivoSomenteLeitura === "enviado"` como proxy de "já estava
// enviado" — bug: "permissao" tem precedência sobre "enviado" e o "Editar" zera o motivo mesmo com o card
// enviado, então o proxy saía sempre `false` mesmo com o card JÁ enviado ANTES do save, bloqueando retries
// seguros (o payload nunca tinha colunas do Dev de qualquer forma). round 3: a captura usa o `enviado_cad`
// REAL (não a trava derivada) E só bloqueia quando esta captura IA gravar algo do Dev.
// Fix round 4 (item 10) — 3º sinal `temCamposDevNoPayload`: cobre os CAMPOS SIMPLES do Dev da F3.1
// (modelista, pilotos, datas…), que vão no payload por `podeEditarDev` (via `aplicarRegrasCamposDev`),
// separado do BOM (`gravaBom`) e das colunas derivadas (`podeGravarColunasDev`).
const cap = (p: Partial<{ enviadoCadNaCaptura: boolean; gravaBom: boolean; podeGravarColunasDev: boolean; temCamposDevNoPayload: boolean }> = {}) => ({
  enviadoCadNaCaptura: false, gravaBom: false, podeGravarColunasDev: false, temCamposDevNoPayload: false, ...p,
});
describe("retryBloqueadoPorEnvio — item C: envio à Explosão em voo trava o retry automático SÓ com escrita do Dev", () => {
  it("não-enviado → enviado, COM escrita do Dev (bom.gravar) ⇒ bloqueia (o cenário do bug)", () => {
    expect(retryBloqueadoPorEnvio({ enviado_cad: true }, cap({ gravaBom: true }))).toBe(true);
  });
  it("não-enviado → enviado, COM escrita do Dev (podeGravarColunasDev, sem BOM tocado) ⇒ bloqueia", () => {
    expect(retryBloqueadoPorEnvio({ enviado_cad: true }, cap({ podeGravarColunasDev: true }))).toBe(true);
  });
  it("não-enviado → enviado, SEM escrita do Dev (nem BOM nem colunas) ⇒ NÃO bloqueia — payload já não levava nada do Dev", () => {
    expect(retryBloqueadoPorEnvio({ enviado_cad: true }, cap())).toBe(false);
  });
  it("enviado → enviado (já estava enviado na captura) ⇒ NÃO bloqueia, mesmo com escrita do Dev pendente", () => {
    expect(retryBloqueadoPorEnvio({ enviado_cad: true }, cap({ enviadoCadNaCaptura: true, gravaBom: true, podeGravarColunasDev: true }))).toBe(false);
  });
  it("não-enviado → não-enviado ⇒ NÃO bloqueia, independente da escrita do Dev", () => {
    expect(retryBloqueadoPorEnvio({ enviado_cad: false }, cap({ gravaBom: true, podeGravarColunasDev: true }))).toBe(false);
  });
  it("fresh.enviado_cad ausente (null/undefined) ⇒ trata como não-enviado, não bloqueia", () => {
    expect(retryBloqueadoPorEnvio({ enviado_cad: null }, cap({ gravaBom: true }))).toBe(false);
    expect(retryBloqueadoPorEnvio({}, cap({ podeGravarColunasDev: true }))).toBe(false);
  });
  // Fix round 4 (item 10, acréscimo do controlador) — caso novo: sem BOM e sem colunas derivadas, mas COM
  // campos simples do Dev (ex.: modelista) no payload ⇒ bloqueia. Sem este sinal, um retry que só gravava
  // modelista/pilotos/datas num card recém-enviado passava batido (payload tinha dado do Dev, mas nenhum
  // dos outros 2 sinais via isso).
  it("não-enviado → enviado, sem BOM e sem colunas, mas COM campos simples do Dev no payload (modelista) ⇒ bloqueia", () => {
    expect(retryBloqueadoPorEnvio({ enviado_cad: true }, cap({ temCamposDevNoPayload: true }))).toBe(true);
  });
});

// Item G (menor, fix round 3) — "save em voo" como CONTADOR (não booleano): no TanStack Query 5.x, o
// mutationFn do RETRY de um P0409 roda ANTES do onSettled do 1º ciclo. Reproduz a sequência real do
// usePlanejamentoSave: mutationFn(1ª tentativa)=+1, P0409, onError chama save.mutate() que reentra no
// mutationFn do retry=+1 (ANTES do onSettled do 1º ciclo rodar), onSettled do 1º ciclo=-1 (sobra 1, ainda
// "em voo"), retry termina, onSettled do retry=-1 (chega a 0).
describe("contadorVoo — item G: contador com piso 0, sobrevive ao retry do P0409", () => {
  it("+1 ⇒ 1 (marcarSaveEmVoo(true) na 1ª tentativa)", () => {
    expect(contadorVoo(0, true)).toBe(1);
  });
  it("sequência do retry: +1, +1, -1, -1 ⇒ termina em 0, nunca fica negativo no meio", () => {
    let c = 0;
    c = contadorVoo(c, true); // mutationFn 1ª tentativa
    expect(c).toBe(1);
    c = contadorVoo(c, true); // mutationFn do retry (reentra ANTES do onSettled de baixo)
    expect(c).toBe(2);
    c = contadorVoo(c, false); // onSettled do 1º ciclo (P0409, ANTES do retry terminar)
    expect(c).toBe(1); // > 0 ⇒ AINDA "em voo" — o retry segue protegido (era o bug do booleano: virava 0 aqui)
    c = contadorVoo(c, false); // onSettled do retry
    expect(c).toBe(0);
  });
  it("piso 0: um -1 sem +1 correspondente não fica negativo", () => {
    expect(contadorVoo(0, false)).toBe(0);
  });
});

// Fix final I1 (IMPORTANTE) — o prefill sobrescreve o BOM de outra pessoa sem P0409: o Salvar precisa esperar
// o BOM recarregar (as 5 queries de `chavesBomServidor`) antes de gravar o esqueleto Tecido 1..N do prefill.
describe("bomRecarregando — fix final I1 (o Salvar espera o BOM recarregar)", () => {
  it("nenhuma key em refetch → false (Salvar segue)", () => {
    expect(bomRecarregando([0, 0, 0, 0, 0])).toBe(false);
  });
  it("qualquer key em refetch (mesmo só 1 das 5) → true (Salvar espera)", () => {
    expect(bomRecarregando([0, 1, 0, 0, 0])).toBe(true);
  });
  it("lista vazia (modeloId nulo, sem keys) → false", () => {
    expect(bomRecarregando([])).toBe(false);
  });
});

// Fix final M1 (1ª parte) — trava que chega ENTRE editar e salvar não pode descartar a edição em silêncio.
// Porta de save-ficha.ts da F3.3 (5e32951), sem CAD (a F3.2 não tem CAD). Rebase F3.3→3adfbd3: a função voltou à
// versão da F3.3 (com `cadGravou`) — estes casos passam `cadGravou: false` (só o BOM, como na F3.2).
//
// ROUND 2 — regressão: o CHAMADOR (`useFichaTecnica.aposSalvar`) passava o `tocado` CRU
// (`colecoesTouchadasRef.current`) como 1º campo. Bug: `gravar` (`capturar()`) exige `snap!==base` além do
// toque — qualquer toque SEM mudança real no snapshot (tocar e desfazer; `updateProporcao`/`toggleGradeAuto`
// com grade zerada) tinha `tocado=true`/`bomGravou=false`, e a função (corretamente, pela sua própria regra)
// dizia "não limpa" — só que o toque nunca ia sujar nada de verdade, e o aviso "não foram salvas — a ficha
// está travada" aparecia a CADA Salvar, com o tocado preso para sempre. Fix: o chamador passa
// `sujoNaCaptura` (tocado E `snap!==base`, capturado no MESMO instante que `gravar`) em vez do `tocado` cru
// — a função pura abaixo não mudou de contrato; os casos (a)-(d) documentam o comportamento correto do
// PAR (sujoNaCaptura, gravar) que o chamador agora produz.
describe("deveLimparTocadoAposSalvar — fix final M1 (edições perdidas em silêncio)", () => {
  it("sem toque: sempre pode limpar (nada a perder)", () => {
    expect(deveLimparTocadoAposSalvar({ tocado: false, bomGravou: false, cadGravou: false })).toBe(true);
  });
  it("tocado e o BOM gravou: pode limpar", () => {
    expect(deveLimparTocadoAposSalvar({ tocado: true, bomGravou: true, cadGravou: false })).toBe(true);
  });
  it("tocado e o BOM NÃO gravou (trava chegou no meio do caminho): NÃO limpa — a edição sumiria sem aviso", () => {
    expect(deveLimparTocadoAposSalvar({ tocado: true, bomGravou: false, cadGravou: false })).toBe(false);
  });
  // (a) tocar e desfazer: sujoNaCaptura=false (snapshot voltou ao baseline) ⇒ SEM aviso, o tocado limpa.
  it("(a) tocar e desfazer: sujoNaCaptura=false, bomGravou=false ⇒ limpa sem aviso", () => {
    expect(deveLimparTocadoAposSalvar({ tocado: false, bomGravou: false, cadGravou: false })).toBe(true);
  });
  // (b) só proporção com grade zerada (updateProporcao/toggleGradeAuto, oldSum=0/grade_total=0): marca
  // colecoesTouchadasRef, mas a grade não mudou e a proporção não entra no snapshot do BOM ⇒ sujoNaCaptura=false.
  it("(b) só proporção com grade zerada: sujoNaCaptura=false, bomGravou=false ⇒ limpa sem aviso", () => {
    expect(deveLimparTocadoAposSalvar({ tocado: false, bomGravou: false, cadGravou: false })).toBe(true);
  });
  // (c) ficha suja de verdade (snapshot mudou) mas a trava chegou ENTRE a captura e a gravação
  // (podeEditarRef.current virou false na captura reusada por aposSalvar): sujoNaCaptura=true (o snapshot
  // realmente diverge), bomGravou=false (a trava zerou `gravar`) ⇒ NÃO limpa — aviso e selo aceso.
  it("(c) ficha suja e travada no meio: sujoNaCaptura=true, bomGravou=false ⇒ aviso e selo aceso", () => {
    expect(deveLimparTocadoAposSalvar({ tocado: true, bomGravou: false, cadGravou: false })).toBe(false);
  });
  // (d) ficha suja que GRAVOU: sujoNaCaptura=true e bomGravou=true (mesma condição, sem trava) ⇒ limpa.
  it("(d) ficha suja que gravou: sujoNaCaptura=true, bomGravou=true ⇒ limpa", () => {
    expect(deveLimparTocadoAposSalvar({ tocado: true, bomGravou: true, cadGravou: false })).toBe(true);
  });
});

// Fix final ROUND 2, item 2 — o guard I1 (usePlanejamentoSave.ts, `bomRecarregando` sozinho) barrava TAMBÉM
// um Salvar que nunca gravaria o BOM (refetch de foco/abertura do card) e virava `toast.error` no retry do
// P0409 que devia retentar. Agora só barra quando ESTE save IA gravar o BOM E as queries estão em refetch.
describe("deveBarrarPorBomRecarregando — fix final ROUND 2, item 2 (guard I1 sem falso positivo)", () => {
  it("ia gravar o BOM E as queries estão em refetch ⇒ barra (o cenário do I1)", () => {
    expect(deveBarrarPorBomRecarregando(true, true)).toBe(true);
  });
  it("NÃO ia gravar o BOM, mesmo com queries em refetch (refetch de foco/abertura do card) ⇒ NÃO barra", () => {
    expect(deveBarrarPorBomRecarregando(false, true)).toBe(false);
  });
  it("ia gravar o BOM, mas nada em refetch ⇒ NÃO barra (Salvar segue normalmente)", () => {
    expect(deveBarrarPorBomRecarregando(true, false)).toBe(false);
  });
  it("nem ia gravar nem está em refetch ⇒ NÃO barra", () => {
    expect(deveBarrarPorBomRecarregando(false, false)).toBe(false);
  });
});

// Fix final M1 (2ª parte) — `proporcoes`/`custos_adicionais` fora do payload (ficha travada,
// `podeGravarColunasDev=false`) não podem virar "enviado" no baseline: o servidor não os recebeu.
describe("draftEnviadoComColunasDev — fix final M1 (proporcoes/custos_adicionais fora do payload)", () => {
  const enviado = { nome: "X", proporcoes: { P: 2 }, custos_adicionais: [{ descricao: "Editado", valor: 9 }] };
  const servidor = { proporcoes: { P: 1 }, custos_adicionais: [{ descricao: "Antigo", valor: 3.5 }] };
  it("podeGravarColunasDev=true: o payload foi de fato gravado — mantém o ENVIADO", () => {
    expect(draftEnviadoComColunasDev(enviado, servidor, true)).toBe(enviado);
  });
  it("podeGravarColunasDev=false: proporcoes/custos_adicionais fora do payload → baseline mantém o valor do SERVIDOR", () => {
    const out = draftEnviadoComColunasDev(enviado, servidor, false);
    expect(out).toEqual({ nome: "X", proporcoes: { P: 1 }, custos_adicionais: [{ descricao: "Antigo", valor: 3.5 }] });
  });
  it("podeGravarColunasDev=false mas os valores já são iguais aos do servidor → mesma referência (sem objeto novo à toa)", () => {
    const igualServidor = { nome: "X", proporcoes: servidor.proporcoes, custos_adicionais: servidor.custos_adicionais };
    expect(draftEnviadoComColunasDev(igualServidor, servidor, false)).toBe(igualServidor);
  });
});

// Fix pós-T9 (re-revisão de 67e363f, item 1) — "edições perdidas em silêncio": a ficha tocada não pode ter o
// aviso "não salvo" apagado quando NADA foi de fato gravado (BOM e CAD ambos gravar=false na captura, mesmo
// tocada — cenário: permissão/carga do CAD caiu no meio do caminho, DEPOIS da captura já ter marcado `gravar`).
describe("deveLimparTocadoAposSalvar — fix pós-T9 (edições perdidas em silêncio)", () => {
  it("sem toque: sempre pode limpar (nada a perder)", () => {
    expect(deveLimparTocadoAposSalvar({ tocado: false, bomGravou: false, cadGravou: false })).toBe(true);
  });
  it("tocado e o BOM gravou: pode limpar", () => {
    expect(deveLimparTocadoAposSalvar({ tocado: true, bomGravou: true, cadGravou: false })).toBe(true);
  });
  it("tocado e o CAD gravou (mesmo sem o BOM): pode limpar", () => {
    expect(deveLimparTocadoAposSalvar({ tocado: true, bomGravou: false, cadGravou: true })).toBe(true);
  });
  it("tocado e NENHUM dos dois gravou: NÃO limpa — a edição sumiria sem aviso", () => {
    expect(deveLimparTocadoAposSalvar({ tocado: true, bomGravou: false, cadGravou: false })).toBe(false);
  });
});
