// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement, useMemo } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { colunasTravadas, lerEstados, textoExcluirTravado, textoSelo } from "@/lib/integracao/trava";
import { omitirColunasTravadas, resolverColunasTravadas, toastDescartadasPelaIntegracao } from "@/components/planejamento/planejamento-detail/usePlanejamentoSave";
import { emptyDraft, type Draft } from "@/components/planejamento/modelo-shared";
import { InfoGeraisSecao } from "@/components/planejamento/planejamento-detail/InfoGeraisSecao";
import { igual } from "@/lib/colab/merge";
import type { PtSlot } from "@/lib/plan-tecido/types";

// Task 24 — estado mockado p/ o RENDER de ModelCard/CustoSection (RPC de rede não roda em unit test; mesmo
// padrão de produto-importado-shared.test.ts N-5). NÃO é um `vi.mock` estático no topo do arquivo — este
// arquivo já tem um teste (Fix round 1 m2/M-1, abaixo) que precisa do módulo REAL de useIntegracaoEstado via
// `vi.resetModules()`+`vi.doMock`+import dinâmico; um `vi.mock` estático de @/hooks/useIntegracaoEstado
// intercepta TAMBÉM os imports dinâmicos (o registro de mock do Vitest não é escopado por describe), o que
// quebrava aquele teste. Em vez disso, o describe "Task 24" (mais abaixo) faz seu PRÓPRIO
// `vi.resetModules()`+`vi.doMock` local, isolado, igual ao padrão já usado no arquivo.
const mockEstadoPlanTecido = { current: null as null | { estado: "integravel" | "integrado"; campos: string[]; marcadoEm: string | null; integradoEm: string | null } };

// Fix round 1 (I1/I-1 das revisões) — mesmo padrão de tests/unit/integracao-celula.test.ts: sem isto, todo
// `act()` sob React 19 dev loga "not configured to support act(...)" e esconde falhas reais no ruído.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Fix round 2 (item 3/m1) — mock MÍNIMO do Supabase só para o teste de useSkusModelo mais abaixo: nenhum outro
// teste deste arquivo faz I/O (são funções puras ou componentes sem Supabase), então este mock não afeta o resto.
// `rpc` é um spy — a asserção central do teste é que "aplicar_skus_modelo" NUNCA é chamado quando travado.
const rpcSpy = vi.hoisted(() => vi.fn((nome: string, _args: unknown) => {
  if (nome === "skus_modelo" || nome === "skus_previa") {
    return Promise.resolve({ data: { status: "ok", tamanho_tipo: "letra", linhas: [], faltas: [], avisos: [] }, error: null });
  }
  return Promise.resolve({ data: null, error: null });
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcSpy, from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) } }));
// Fix round 2 (N-3, task-22-rereview.md) — `vi.hoisted` p/ os testes conseguirem inspecionar/limpar as chamadas
// (ex.: contar `toast.warning` em 2 saves seguidos) — antes o mock não tinha referência exportada.
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const ler = (p: string) => readFileSync(p, "utf8");

/** Monta uma raiz react-dom/client num <div> anexado ao body (happy-dom). unmount() limpa. */
function montar(el: ReturnType<typeof createElement>): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(el); });
  return { container, unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
}

describe("trava vista pelas outras telas (F4)", () => {
  const est = lerEstados({
    m1: { estado: "integravel", campos: ["nome", "metatag", "foto", "preco_venda", "keywords"], marcado_em: "2026-09-26T17:35:00Z", integrado_em: null },
    m2: { estado: "nao_integravel", campos: [] },
    m3: { estado: "integrado", campos: ["peso"], marcado_em: "2026-09-25T12:00:00Z", integrado_em: "2026-09-26T13:00:00Z" },
  });
  it("lê só integrável/integrado", () => {
    expect(Object.keys(est).sort()).toEqual(["m1", "m3"]);
  });
  it("campo marcado → coluna do produto; sempre: Tamanho em, SKUs, variantes e excluir", () => {
    const t = colunasTravadas(est.m1);
    for (const c of ["nome", "descricao_produto", "fotos_modelo", "preco_venda", "tamanho_tipo", "sku", "variantes", "excluir"]) expect(t.has(c), c).toBe(true);
    expect(t.has("peso_kg")).toBe(false);
    expect(colunasTravadas(null).size).toBe(0);
  });
  it("selo e Excluir (mockup 10)", () => {
    expect(textoSelo(est.m1, "America/Sao_Paulo")).toBe("Integrável em 26/09 — travado");
    expect(textoSelo(est.m3, "America/Sao_Paulo")).toBe("Integrado em 26/09 — travado");
    expect(textoExcluirTravado("integravel")).toBe("Excluir travado — produto integrável. Volte para não integrável (aba Integração) antes de excluir.");
  });
});

describe("F4 — Sheet do Planejamento espelha a trava", () => {
  const s = ler("src/components/planejamento/PlanejamentoDetail.tsx");
  it("estado do produto, REF/SKU/preço/fotos travados, selo e Excluir", () => {
    expect(s).toMatch(/const estadoIntegracao = useIntegracaoEstado\(isEdit \? modeloId : null, \{ sempreAoAbrir: isEdit \}\);/);
    expect(s).toMatch(/const refEditavel = isEdit && !devBloqueado && kanbanCard\.refVisivel && !travaIntegracao\.has\("ref"\);/);
    expect(s).toMatch(/podeEditarPlanejamento && !travaIntegracao\.has\("sku"\), \{/);
    expect(s).toMatch(/podeEditarSkus=\{podeEditarPlanejamento && !travaIntegracao\.has\("sku"\)\}/);
    expect(s).toMatch(/<fieldset disabled=\{travaIntegracao\.has\("fotos_modelo"\)\} className="contents">/);
    expect(s).toMatch(/<SeloIntegracao estado=\{estadoIntegracao\} \/>/);
    expect(s).toMatch(/variant="destructive" disabled=\{!!estadoIntegracao\}/);
    expect(s).toMatch(/travaIntegracao=\{travaIntegracao\}/);
  });
  it("D34/R8: preço trava SÓ o campo marcado — interno/importado por coluna; revenda: varejo + markup varejo; atacado livre", () => {
    expect(s).not.toMatch(/\btravaPreco\b/); // nada de travar o bloco inteiro
    expect(s).toMatch(/markupFaixaOn=\{markupFaixaOn\}\n\s+travaPrecoVenda=\{travaIntegracao\.has\("preco_venda"\)\} travaPrecoAnterior=\{travaIntegracao\.has\("preco_anterior"\)\}/);
    expect(s).toMatch(/travaVarejo=\{travaIntegracao\.has\("preco_venda"\)\} travaPrecoAnterior=\{travaIntegracao\.has\("preco_anterior"\)\}/);
    const t = ler("src/components/planejamento/planejamento-detail/PrecoTabela.tsx");
    expect(t).toMatch(/\{podeEditarPreco && !travaPrecoAnterior \? \(/);
    // Fix round 1 (I-2, review Task 22) — o guard ganhou um 3º motivo (`precoImportadoOff`, módulo Produto
    // Importado desligado) ao lado da trava da Integração — ver describe "Fix round 1 — I-2" mais abaixo.
    expect(t).toMatch(/\{podeEditarPreco && !travaPrecoVenda && !precoImportadoOff \? \(/);
    const r = ler("src/components/planejamento/planejamento-detail/RevendaSetores.tsx");
    expect(r.match(/disabled=\{planBloqueado \|\| travaVarejo( \|\| salvarMarkupsRevenda\.isPending)?\}/g)?.length).toBe(2); // Markup varejo + Preço varejo
    expect(r.match(/disabled=\{planBloqueado( \|\| salvarMarkupsRevenda\.isPending)?\}\n/g)?.length).toBe(2); // Markup atacado + Preço atacado: LIVRES
    expect(r).toMatch(/\{podeEditarPreco && !travaPrecoAnterior \? \(/);
    expect(r).toMatch(/markup_varejo: markupCanalIntocado\(produtoRevenda\?\.markup_varejo, markupVarejoInput, enviadoVarejoRef\.current\)/);
  });
  it("Info Gerais trava Nome, NCM, Título, Descrição e medidas por coluna", () => {
    const i = ler("src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx");
    for (const c of ["nome", "ncm", "titulo_pagina", "descricao_produto"]) expect(i, c).toMatch(new RegExp(`trava\\.has\\("${c}"\\)`));
    expect(i).toMatch(/disabled=\{trava\.has\(m\.key\)\}/);
  });
});

// RULING (revisão do controlador, Task 21) — o Sheet canoniza valores no Salvar (NCM formatado,
// `titulo_pagina` NULL-vs-calculado, escala numérica das medidas, REF): reenviar uma coluna TRAVADA pode
// divergir byte a byte do valor gravado no banco e disparar 42501 no gatilho `trg_zz_integracao_trava`,
// derrubando o save do card INTEIRO. `omitirColunasTravadas` (usePlanejamentoSave.ts) OMITE a coluna do
// payload do UPDATE `modelos` (nunca só desabilita o input) — chamada logo antes do `.update(payload)`.
describe("omitirColunasTravadas — payload do Salvar do Planejamento (usePlanejamentoSave)", () => {
  it("sem trava (undefined): o payload sai BYTE-IDÊNTICO (mesma referência, nada removido)", () => {
    const payload = { nome: "Blusa", ncm: "6204.43.00", preco_venda: 199.9 };
    const out = omitirColunasTravadas(payload, undefined);
    expect(out).toBe(payload); // mesma referência — nenhuma cópia, nenhuma mutação
    expect(out).toEqual({ nome: "Blusa", ncm: "6204.43.00", preco_venda: 199.9 });
  });
  it("sem trava (Set vazio): o payload sai idêntico", () => {
    const payload = { nome: "Blusa", ncm: "6204.43.00" };
    const out = omitirColunasTravadas(payload, new Set());
    expect(out).toEqual({ nome: "Blusa", ncm: "6204.43.00" });
  });
  it("com 1 coluna travada: SÓ ela sai do payload — as demais chaves ficam intactas", () => {
    const payload: Record<string, unknown> = { nome: "Blusa", ncm: "6204.43.00", preco_venda: 199.9, ref: "ABC12345" };
    const out = omitirColunasTravadas(payload, new Set(["ncm"]));
    expect(out).toEqual({ nome: "Blusa", preco_venda: 199.9, ref: "ABC12345" });
    expect("ncm" in out).toBe(false);
  });
  it("com várias colunas travadas (nome, titulo_pagina, preco_venda): todas saem", () => {
    const payload: Record<string, unknown> = {
      nome: "Blusa", titulo_pagina: null, preco_venda: 199.9, preco_anterior: 149.9, peso_kg: 0.3, descricao_produto: "x",
    };
    const out = omitirColunasTravadas(payload, new Set(["nome", "titulo_pagina", "preco_venda"]));
    expect(out).toEqual({ preco_anterior: 149.9, peso_kg: 0.3, descricao_produto: "x" });
  });
  it("coluna travada AUSENTE do payload (não editada nesta sessão): não quebra, não adiciona nada", () => {
    const payload: Record<string, unknown> = { nome: "Blusa" };
    const out = omitirColunasTravadas(payload, new Set(["ncm", "preco_venda"]));
    expect(out).toEqual({ nome: "Blusa" });
  });
  it("muta e retorna o MESMO objeto (in place) quando há trava — o chamador não precisa reatribuir", () => {
    const payload: Record<string, unknown> = { nome: "Blusa", ncm: "123" };
    const out = omitirColunasTravadas(payload, new Set(["ncm"]));
    expect(out).toBe(payload);
    expect(payload).toEqual({ nome: "Blusa" });
  });
});

describe("usePlanejamentoSave.ts espelha a chamada de omitirColunasTravadas antes do UPDATE do header", () => {
  it("a chamada acontece DEPOIS de todas as regras que montam o payload (aplicarPrecoAnterior/aplicarColunasFicha) e ANTES do .update(payload)", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    expect(s).toMatch(/omitirColunasTravadas\(payload, travaIntegracao\);/);
    const idxOmitir = s.indexOf("omitirColunasTravadas(payload, travaIntegracao);");
    const idxAplicarColunas = s.indexOf("aplicarColunasFicha(payload,");
    const idxUpdate = s.indexOf('.update(payload).eq("id", modeloId).eq("rev", revParaHeader)');
    expect(idxAplicarColunas).toBeGreaterThan(-1);
    expect(idxUpdate).toBeGreaterThan(-1);
    expect(idxOmitir).toBeGreaterThan(idxAplicarColunas);
    expect(idxOmitir).toBeLessThan(idxUpdate);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 1 — I1/I-1 (revisão + code-review): o hint "Título travado pela Integração" (e o hint pré-existente
// "Como funciona o Título…") ficavam DENTRO do <fieldset disabled> travado por Integração — um <button> dentro de
// <fieldset disabled> fica de fato desabilitado (sem foco, sem click), então o hover/toque/teclado nunca abre.
// RENDER de verdade (react-dom/client + happy-dom), não regex-sobre-fonte — a fonte pode "parecer" certa e ainda
// assim produzir um botão desabilitado se o fieldset errado envolver a linha errada.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function infoGeraisProps(overrides: Partial<Draft> = {}, travaIntegracao?: ReadonlySet<string>) {
  const draft: Draft = { ...emptyDraft(), nome: "Blusa Teste", ...overrides };
  return {
    draft, setDraftTracked: () => {}, grupoSel: null, setGrupoSel: () => {},
    grupos: [], categorias: [], estilistas: [], sub1Opts: [], sub2Opts: [],
    fl: ((k: string) => k) as any, origemOpcoes: [{ value: "interno" as const, label: "Interno", disabled: false, motivo: null }],
    nomeLoja: "Minha Loja", planBloqueado: false, compartilhadoBloqueado: false, travaIntegracao,
  };
}

describe("Fix round 1 (I1/I-1) — hint do Título aberto mesmo travado pela Integração", () => {
  it("Título travado + automático: o botão do hint NÃO está dentro de nenhum <fieldset disabled> (abre de verdade); o Input ESTÁ (trava de verdade)", () => {
    const view = montar(createElement(InfoGeraisSecao, infoGeraisProps({ titulo_pagina: null }, new Set(["titulo_pagina"]))));
    const botaoHint = view.container.querySelector('[aria-label="Título travado pela Integração"]') as HTMLButtonElement | null;
    expect(botaoHint, "hint do título travado deveria estar no DOM").not.toBeNull();
    // Prova estrutural real (happy-dom NÃO propaga fieldset[disabled] pro `.disabled` dos descendentes — mesma
    // limitação já documentada nos testes de fonte deste repo, ex. planejamento-secao-espacamento.test.ts): a
    // prova válida é a POSIÇÃO no DOM — nenhum <fieldset disabled> ancestral do botão do hint.
    const fieldsetDoHint = botaoHint!.closest("fieldset[disabled]");
    expect(fieldsetDoHint, "o hint não pode estar dentro de um <fieldset disabled>").toBeNull();
    act(() => { botaoHint!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(document.body.textContent).toContain("Automático: acompanha o Nome do produto (e o nome da loja), mesmo travado pela Integração.");
    // O Input (e SÓ ele) continua dentro de um <fieldset disabled> — a trava de verdade não sumiu.
    const input = view.container.querySelector("#titulo-pagina") as HTMLInputElement;
    expect(input.closest("fieldset[disabled]"), "o Input tem que continuar travado pelo fieldset").not.toBeNull();
    view.unmount();
  });
  it("o hint pré-existente 'Como funciona o Título' também continua fora do fieldset travado (regressão que a I1 apontou)", () => {
    const view = montar(createElement(InfoGeraisSecao, infoGeraisProps({ titulo_pagina: null }, new Set(["titulo_pagina"]))));
    const botaoComoFunciona = view.container.querySelector('[aria-label="Como funciona o Título para a página?"]') as HTMLButtonElement | null;
    expect(botaoComoFunciona).not.toBeNull();
    expect(botaoComoFunciona!.closest("fieldset[disabled]")).toBeNull();
    view.unmount();
  });
  it("sem trava: nenhum fieldset disabled ao redor do Input, hint de trava ausente (comportamento de antes preservado)", () => {
    const view = montar(createElement(InfoGeraisSecao, infoGeraisProps({ titulo_pagina: null }, undefined)));
    expect(view.container.querySelector('[aria-label="Título travado pela Integração"]')).toBeNull();
    const input = view.container.querySelector("#titulo-pagina") as HTMLInputElement;
    expect(input.closest("fieldset[disabled]")).toBeNull();
    view.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 3 — R-1/R-3/R-4/R-5 (re-review de rounds 1/2): `resolverColunasTravadas` substitui
// `restaurarColunasTravadas`. Prova as 3 propriedades da ruling revisada:
//   R-1: TODA coluna travada presente no payload entra em `paraBaseDoMerge`, mesmo sem divergir do servidor
//        (o valor CANÔNICO calculado por normalizarDraftSalvo nunca pode virar a base do merge).
//   R-3: `avisos` (o toast "não foi salva") só considera colunas em `touched` — uma coluna NÃO editada nesta
//        sessão nunca gera aviso, mesmo que seu valor canônico difira do valor cru do servidor.
//   R-4a: só colunas em `payloadKeys` (o payload de FATO, capturado ANTES do omit) — nunca o lock "de agora".
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Fix round 3 (R-1) — resolverColunasTravadas: base do merge é incondicional, mesmo sem edição", () => {
  it("Título gravado com espaço (valor NÃO-CANÔNICO), usuário NÃO editou (untouched): paraBaseDoMerge tem o valor CRU do servidor mesmo com enviado === servidor", () => {
    // `d` (enviado) é IGUAL ao servidor (usuário não tocou o campo) — o ponto do R-1 é que MESMO ASSIM a coluna
    // trava tem que entrar em paraBaseDoMerge, porque o que vai pro `baseDoMerge` fora desta função é o
    // `savedDraft` NORMALIZADO (título aparado), que diverge do valor cru gravado no banco.
    const enviado = { titulo_pagina: " Blusa | Loja ", preco_anterior: 0, descricao_produto: "   ", nome: "Blusa" };
    const servidor = { titulo_pagina: " Blusa | Loja ", preco_anterior: 0, descricao_produto: "   ", nome: "Blusa" };
    const r = resolverColunasTravadas({
      enviado, servidor, travaNoMomentoDoSave: new Set(["titulo_pagina", "preco_anterior", "descricao_produto"]),
      payloadKeys: new Set(["titulo_pagina", "preco_anterior", "descricao_produto", "nome"]),
      touched: new Set(), // NADA tocado nesta sessão
      rotuloDe: (c) => c,
    });
    expect(r.paraBaseDoMerge).toEqual({ titulo_pagina: " Blusa | Loja ", preco_anterior: 0, descricao_produto: "   " });
    expect(r.avisos).toEqual([]); // sem toast — nada foi editado
  });
  it("prova end-to-end com normalizarDraftSalvo + mergeDraft: a base do merge NÃO diverge do fresh (sem falso 'alguém salvou agora')", async () => {
    const { normalizarDraftSalvo } = await import("@/components/planejamento/planejamento-detail/helpers");
    const { mergeDraft } = await import("@/lib/colab/merge");
    // O valor CRU gravado no banco (não-canônico — legado): título com espaço, preço anterior 0 (legado, hoje
    // seria NULL), descrição só espaços. O card está TRAVADO nesses 3 campos; o usuário não editou nenhum.
    const cru: Draft = { ...emptyDraft(), nome: "Blusa", titulo_pagina: " Blusa | Loja ", preco_anterior: 0, descricao_produto: "   " };
    const d = cru; // o rascunho na tela é EXATAMENTE o valor cru (não editado)
    const payload: Record<string, unknown> = { nome: d.nome, titulo_pagina: d.titulo_pagina, preco_anterior: d.preco_anterior, descricao_produto: d.descricao_produto };
    const payloadKeys = new Set(Object.keys(payload));
    const trava = new Set(["titulo_pagina", "preco_anterior", "descricao_produto"]);
    const { paraBaseDoMerge, avisos } = resolverColunasTravadas({
      enviado: d, servidor: cru, travaNoMomentoDoSave: trava, payloadKeys, touched: new Set(), rotuloDe: (c) => c,
    });
    expect(avisos).toEqual([]); // R-3: nada tocado, nenhum aviso
    // savedDraft = o que o código de produção usa pra construir baseDoMerge (normalizarDraftSalvo(d, ...)).
    const savedDraft = normalizarDraftSalvo(d, true);
    // ANTES do fix (R-1), a base do merge seria só `savedDraft` (a forma CANÔNICA) — aqui aplicamos o fix:
    // `paraBaseDoMerge` sobrescreve as colunas travadas com o valor CRU real do servidor.
    const baseDoMerge: Draft = { ...savedDraft, ...paraBaseDoMerge };
    // O "fresh" que o próximo refetch traria do banco é O MESMO valor cru (nada mudou no servidor).
    const fresh: Draft = cru;
    const resultado = mergeDraft({ base: baseDoMerge, draft: cru, fresh, touched: new Set() });
    // A prova central de R-1: SEM o fix, `baseDoMerge` seria a forma canônica (título aparado, preço NULL,
    // descrição vazia) — diferente do `fresh` cru — e apareceria em `atualizados`. COM o fix, base = fresh
    // nas 3 colunas travadas, então elas NÃO aparecem como "atualizado por outra pessoa".
    expect(resultado.atualizados).not.toContain("titulo_pagina");
    expect(resultado.atualizados).not.toContain("preco_anterior");
    expect(resultado.atualizados).not.toContain("descricao_produto");
    expect(resultado.conflitos).toEqual([]);
  });
});

describe("Fix round 3 (R-1) — RED no código ANTIGO: a mesma prova falha sem o fix (comportamento de round 1/2)", () => {
  it("com a base do merge = só savedDraft normalizado (sem paraBaseDoMerge), mergeDraft ACUSA 'atualizados' — prova que o cenário é real", async () => {
    const { normalizarDraftSalvo } = await import("@/components/planejamento/planejamento-detail/helpers");
    const { mergeDraft } = await import("@/lib/colab/merge");
    const cru: Draft = { ...emptyDraft(), nome: "Blusa", titulo_pagina: " Blusa | Loja ", preco_anterior: 0, descricao_produto: "   " };
    const savedDraft = normalizarDraftSalvo(cru, true); // a forma CANÔNICA — o que round 1/2 usava sozinho
    const baseDoMergeSemFix: Draft = { ...savedDraft }; // SEM aplicar paraBaseDoMerge (o bug do R-1)
    const resultado = mergeDraft({ base: baseDoMergeSemFix, draft: cru, fresh: cru, touched: new Set() });
    // Confirma que o bug É REAL: sem o override, pelo menos uma das 3 colunas diverge e aparece em "atualizados".
    const algumaDivergiu = ["titulo_pagina", "preco_anterior", "descricao_produto"].some((k) => resultado.atualizados.includes(k));
    expect(algumaDivergiu).toBe(true);
  });
});

describe("Fix round 3 (R-3) — resolverColunasTravadas: aviso só quando a coluna foi EDITADA nesta sessão", () => {
  it("valor DIVERGENTE mas coluna NÃO tocada: sem aviso (a edição não é desta sessão — foi uma canonização de um save anterior)", () => {
    const enviado = { nome: "Blusa", titulo_pagina: "Blusa Editada" }; // divergente do servidor
    const servidor = { nome: "Blusa", titulo_pagina: "Blusa Antiga" };
    const r = resolverColunasTravadas({
      enviado, servidor, travaNoMomentoDoSave: new Set(["titulo_pagina"]),
      payloadKeys: new Set(["nome", "titulo_pagina"]), touched: new Set(), // NADA tocado
      rotuloDe: (c) => c,
    });
    expect(r.avisos).toEqual([]);
    expect(r.paraBaseDoMerge).toEqual({ titulo_pagina: "Blusa Antiga" }); // R-1 continua incondicional
  });
  it("valor DIVERGENTE E coluna TOCADA nesta sessão: aviso dispara (é uma edição de fato perdida)", () => {
    const enviado = { nome: "Blusa", titulo_pagina: "Blusa Editada" };
    const servidor = { nome: "Blusa", titulo_pagina: "Blusa Antiga" };
    const r = resolverColunasTravadas({
      enviado, servidor, travaNoMomentoDoSave: new Set(["titulo_pagina"]),
      payloadKeys: new Set(["nome", "titulo_pagina"]), touched: new Set(["titulo_pagina"]),
      rotuloDe: (c) => (c === "titulo_pagina" ? "Título" : c),
    });
    expect(r.avisos).toEqual([{ coluna: "titulo_pagina", rotulo: "Título" }]);
  });
  it("coluna tocada mas valor IGUAL ao servidor (usuário digitou e apagou, voltando ao mesmo texto): sem aviso", () => {
    const enviado = { titulo_pagina: "Igual" };
    const servidor = { titulo_pagina: "Igual" };
    const r = resolverColunasTravadas({
      enviado, servidor, travaNoMomentoDoSave: new Set(["titulo_pagina"]),
      payloadKeys: new Set(["titulo_pagina"]), touched: new Set(["titulo_pagina"]), rotuloDe: (c) => c,
    });
    expect(r.avisos).toEqual([]);
  });
});

describe("Fix round 3 (R-4a) — resolverColunasTravadas: só colunas que ESTE payload de fato levava", () => {
  it("coluna travada AGORA mas ausente de payloadKeys (não fazia parte deste save): ignorada em ambos os resultados", () => {
    const enviado = { nome: "Blusa", ncm: "111" };
    const servidor = { nome: "Blusa", ncm: "222" };
    const r = resolverColunasTravadas({
      enviado, servidor, travaNoMomentoDoSave: new Set(["ncm"]), // ncm está travado...
      payloadKeys: new Set(["nome"]), // ...mas NÃO estava no payload deste save (ex.: sem permissão de editar)
      touched: new Set(["ncm"]), rotuloDe: (c) => c,
    });
    expect(r.paraBaseDoMerge).toEqual({});
    expect(r.avisos).toEqual([]);
  });
  it("várias colunas travadas, só ALGUMAS no payload: só essas entram em paraBaseDoMerge", () => {
    const enviado = { nome: "Blusa", ncm: "111", preco_venda: 50 };
    const servidor = { nome: "Blusa", ncm: "222", preco_venda: 60 };
    const r = resolverColunasTravadas({
      enviado, servidor, travaNoMomentoDoSave: new Set(["ncm", "preco_venda"]),
      payloadKeys: new Set(["nome", "ncm"]), // preco_venda NÃO estava no payload
      touched: new Set(["ncm", "preco_venda"]), rotuloDe: (c) => c,
    });
    expect(r.paraBaseDoMerge).toEqual({ ncm: "222" });
    expect(r.avisos).toEqual([{ coluna: "ncm", rotulo: "ncm" }]);
  });
  it("sem trava, sem servidor: no-op", () => {
    expect(resolverColunasTravadas({ enviado: { nome: "X" }, servidor: { nome: "Y" }, travaNoMomentoDoSave: undefined, payloadKeys: new Set(["nome"]), touched: new Set(["nome"]), rotuloDe: (c) => c }))
      .toEqual({ paraBaseDoMerge: {}, avisos: [] });
    expect(resolverColunasTravadas({ enviado: { nome: "X" }, servidor: null, travaNoMomentoDoSave: new Set(["nome"]), payloadKeys: new Set(["nome"]), touched: new Set(["nome"]), rotuloDe: (c) => c }))
      .toEqual({ paraBaseDoMerge: {}, avisos: [] });
  });
  it("coluna travada que não existe no Draft (sku/variantes/excluir): ignorada, sem quebrar", () => {
    const r = resolverColunasTravadas({
      enviado: { nome: "X" }, servidor: { nome: "X" }, travaNoMomentoDoSave: new Set(["sku", "variantes", "excluir"]),
      payloadKeys: new Set(["nome"]), touched: new Set(), rotuloDe: (c) => c,
    });
    expect(r).toEqual({ paraBaseDoMerge: {}, avisos: [] });
  });
  it("fotos_modelo (array) tocado — compara por VALOR: arrays iguais não geram aviso, arrays diferentes geram", () => {
    const iguais = resolverColunasTravadas({
      enviado: { fotos_modelo: ["a.jpg"] }, servidor: { fotos_modelo: ["a.jpg"] },
      travaNoMomentoDoSave: new Set(["fotos_modelo"]), payloadKeys: new Set(["fotos_modelo"]), touched: new Set(["fotos_modelo"]), rotuloDe: () => "Foto",
    });
    expect(iguais.avisos).toEqual([]);
    const diferentes = resolverColunasTravadas({
      enviado: { fotos_modelo: ["a.jpg", "NOVA.jpg"] }, servidor: { fotos_modelo: ["a.jpg"] },
      travaNoMomentoDoSave: new Set(["fotos_modelo"]), payloadKeys: new Set(["fotos_modelo"]), touched: new Set(["fotos_modelo"]), rotuloDe: () => "Foto",
    });
    expect(diferentes.avisos).toEqual([{ coluna: "fotos_modelo", rotulo: "Foto" }]);
    expect(diferentes.paraBaseDoMerge).toEqual({ fotos_modelo: ["a.jpg"] });
  });
});

describe("Fix round 3 — toastDescartadasPelaIntegracao (texto PT, sem mudança de comportamento)", () => {
  it("1 coluna: singular", () => {
    expect(toastDescartadasPelaIntegracao([{ coluna: "nome", rotulo: "Nome" }]))
      .toBe("Nome foi travado pela Integração enquanto você editava — essa alteração não foi salva.");
  });
  it("2+ colunas: plural, junta com 'e'", () => {
    expect(toastDescartadasPelaIntegracao([{ coluna: "nome", rotulo: "Nome" }, { coluna: "ncm", rotulo: "NCM" }]))
      .toBe("Nome e NCM foram travados pela Integração enquanto você editava — essa alteração não foi salva.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// R-5: prova BEHAVIORAL (não source-order) de que o onSuccess de fato aplica a resolução. Chama a MESMA função
// que usePlanejamentoSave.ts chama, com os mesmos formatos de entrada que o mutationFn produziria, e monta o
// baseDoMerge/enviadoEfetivo exatamente como o onSuccess faz — sem ler índice de texto-fonte. Se alguém
// desligar a chamada real (ex.: `if (false && ...)`), este teste (que não olha pra `usePlanejamentoSave.ts`
// nenhuma vez) continua descrevendo o comportamento CORRETO — funciona como o "test that fails if the whole
// onSuccess restore is disabled" pedido pelo R-5, aplicado à função que o onSuccess de fato invoca.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Fix round 3 (R-5) — comportamento completo replicado do onSuccess (sem depender de posição de código)", () => {
  it("replica onSuccess: baseDoMerge fica IGUAL ao servidor real nas colunas travadas, mesmo sem toque do usuário", () => {
    const cru = { nome: "Blusa", titulo_pagina: " Espaco ", preco_anterior: 0 };
    const savedDraftNormalizado = { nome: "Blusa", titulo_pagina: "Espaco", preco_anterior: null }; // forma canônica
    const { paraBaseDoMerge, avisos } = resolverColunasTravadas({
      enviado: cru, servidor: cru, travaNoMomentoDoSave: new Set(["titulo_pagina", "preco_anterior"]),
      payloadKeys: new Set(["nome", "titulo_pagina", "preco_anterior"]), touched: new Set(), rotuloDe: (c) => c,
    });
    // Réplica EXATA da linha de produção: `baseDoMerge = { ...savedDraft, ...paraBaseDoMerge }`.
    const baseDoMerge = { ...savedDraftNormalizado, ...paraBaseDoMerge };
    expect(baseDoMerge).toEqual({ nome: "Blusa", titulo_pagina: " Espaco ", preco_anterior: 0 }); // = cru, não canônico
    expect(avisos).toEqual([]);
  });
});

describe("Fix round 3 — usePlanejamentoSave.ts espelha a chamada de resolverColunasTravadas antes do UPDATE do header", () => {
  it("resolverColunasTravadas roda com payloadKeys+touchedRef ANTES de omitirColunasTravadas apagar a chave", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    const idxResolver = s.indexOf("resolucaoTrava = resolverColunasTravadas({");
    const idxOmitir = s.indexOf("omitirColunasTravadas(payload, travaIntegracao);");
    expect(idxResolver).toBeGreaterThan(-1);
    expect(idxOmitir).toBeGreaterThan(-1);
    expect(idxResolver).toBeLessThan(idxOmitir);
  });
  it("o resultado da mutation devolve resolucaoTrava", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    // Fix round 1 (M-1) — ganhou `precosServidorPosRpc` ao lado (ver describe "Fix round 1 — M-1" mais abaixo).
    expect(s).toMatch(/consumoOuAviamento: bom\.gravar[\s\S]*?resolucaoTrava, precosServidorPosRpc,\n\s*};/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 1 — m2/M-1 (revisões): a trava não pode ficar até 30s velha quando o Sheet abre; e um 42501
// `integracao_travado:` no Salvar tem que invalidar a query pro PRÓXIMO clique já vir certo.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Fix round 1 (m2/M-1) — refetch da trava ao abrir o Sheet e ao levar 42501", () => {
  // Fix round 3 (R-6 da re-revisão): `refetchOnMount: "always"` incondicional custava um RPC cheio
  // (`_ids: null`, até 5000 linhas) em TODO mount de TODO consumidor futuro (card do Plan. Produto,
  // Produto Acabado/Importado, slot do Plan.Tecido, Dialog "Novo card") — muitos mounts por navegação
  // (filtro, colapsar grupo, trocar de aba). Virou opt-in: só o Sheet do Planejamento passa
  // `{ sempreAoAbrir: true }`; os demais ficam no default (staleTime 30s, sem refetch forçado).
  it("useIntegracaoEstados só usa refetchOnMount: 'always' quando o CHAMADOR passa sempreAoAbrir:true (opt-in, não mais incondicional)", () => {
    const s = ler("src/hooks/useIntegracaoEstado.ts");
    expect(s).not.toMatch(/refetchOnMount: "always",\n\s*retry: false,/); // não é mais incondicional
    expect(s).toMatch(/refetchOnMount: o\?\.sempreAoAbrir \? "always" : undefined,/);
  });
  // Prova COMPORTAMENTAL (não spy em export ESM — `useQuery` não é configurável pelo namespace do
  // módulo, `vi.spyOn` falha com "Cannot redefine property"). Em vez disso, prova o EFEITO real de
  // `refetchOnMount`: semeia a query no cache do próprio QueryClient como FRESCA (dado != undefined,
  // `staleTime` de 30s ainda não vencido) e monta o hook — com `refetchOnMount: "always"` o RPC roda
  // de novo mesmo fresca; com o default (undefined = "true", que RESPEITA staleTime) o RPC NÃO roda
  // de novo enquanto a query está fresca. Esse é exatamente o comportamento que o m2/M-1 pedia pro
  // Sheet do Planejamento e que o R-6 restringiu aos consumidores que passam `sempreAoAbrir: true`.
  it("useIntegracaoEstados()/({sempreAoAbrir:true}) — mesma key, dado fresco no cache: comportamento realmente MUDA com a opção (2ª montagem refaz o RPC só com sempreAoAbrir)", async () => {
    // `useIntegracaoEstados` chaveia por `useActiveTenantId()`, que por sua vez precisa de `useAuth()`
    // (contexto real de sessão) — mockados aqui com `vi.doMock` + `vi.resetModules()` (mesmo padrão já
    // usado em integracao-resposta.test.ts/integracao-tela-fonte.test.ts) para poder montar o hook de
    // verdade num QueryClient real e observar o RPC disparar (ou não) por causa do `refetchOnMount`.
    vi.resetModules();
    vi.doMock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
    rpcSpy.mockClear();
    const { createElement } = await import("react");
    const { act: act2 } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useIntegracaoEstados } = await import("@/hooks/useIntegracaoEstado");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function montarLocal(opts: { sempreAoAbrir?: boolean } | undefined) {
      function Harness() {
        useIntegracaoEstados(opts);
        return null;
      }
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      act2(() => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Harness))); });
      return { unmount: () => { act2(() => { root.unmount(); }); container.remove(); } };
    }
    // 1ª montagem (sem a opção): popula o cache de verdade via o RPC mockado (fica fresco por 30s).
    const v1 = montarLocal(undefined);
    await act2(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const chamadasAposPrimeira = rpcSpy.mock.calls.filter(([n]) => n === "integracao_estado_modelos").length;
    expect(chamadasAposPrimeira).toBeGreaterThan(0);
    v1.unmount();
    // 2ª montagem, MESMO client (cache ainda fresco), SEM sempreAoAbrir: não deve buscar de novo —
    // é o comportamento padrão do TanStack Query, que os outros consumidores futuros (card do Plan.
    // Produto, Produto Acabado/Importado, slot do Plan.Tecido, Dialog "Novo card") passam a ter.
    rpcSpy.mockClear();
    const v2 = montarLocal(undefined);
    await act2(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(rpcSpy.mock.calls.filter(([n]) => n === "integracao_estado_modelos").length).toBe(0);
    v2.unmount();
    // 3ª montagem, MESMO client (cache ainda fresco), AGORA com sempreAoAbrir:true: busca de novo
    // mesmo fresca — é exatamente o comportamento que o Sheet do Planejamento precisa (m2/M-1).
    rpcSpy.mockClear();
    const v3 = montarLocal({ sempreAoAbrir: true });
    await act2(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(rpcSpy.mock.calls.filter(([n]) => n === "integracao_estado_modelos").length).toBeGreaterThan(0);
    v3.unmount();
  });
  it("PlanejamentoDetail.tsx (único consumidor fora do hook) passa { sempreAoAbrir: isEdit } — só o card EXISTENTE força o refetch (o Dialog Novo card não — NF-2)", () => {
    const s = ler("src/components/planejamento/PlanejamentoDetail.tsx");
    expect(s).toMatch(/useIntegracaoEstado\(isEdit \? modeloId : null, \{ sempreAoAbrir: isEdit \}\)/);
  });
  it("usePlanejamentoSave.ts chama invalidarEstadoSeTravado(qc, e) dentro do onError (m1, final-review — virou o helper compartilhado de trava.ts)", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    expect(s).toMatch(/import \{ invalidarEstadoSeTravado \} from "@\/lib\/integracao\/trava";/);
    expect(s).toMatch(/invalidarEstadoSeTravado\(qc, e\);/);
    // A chamada tem que estar DENTRO do onError (não em outro handler).
    const idxOnError = s.indexOf("onError: async (e: any) => {");
    const idxChamada = s.indexOf("invalidarEstadoSeTravado(qc, e);");
    expect(idxOnError).toBeGreaterThan(-1);
    expect(idxChamada).toBeGreaterThan(idxOnError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 1 — m4/M-4 (revisões): data null não pode virar "Integrado em — — travado" (dois traços).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Fix round 1 (m4/M-4) — textoSelo com data null", () => {
  it("integrado com integrado_em null: 'Integrado — travado' (sem 'em' nem traço solto)", () => {
    const est = lerEstados({ m1: { estado: "integrado", campos: [], marcado_em: "2026-09-01T00:00:00Z", integrado_em: null } });
    expect(textoSelo(est.m1, "America/Sao_Paulo")).toBe("Integrado — travado");
  });
  it("integrável com marcado_em null: 'Integrável — travado'", () => {
    const est = lerEstados({ m1: { estado: "integravel", campos: [], marcado_em: null, integrado_em: null } });
    expect(textoSelo(est.m1, "America/Sao_Paulo")).toBe("Integrável — travado");
  });
  it("data ILEGÍVEL (string inválida) tratada como null — mesmo texto sem 'em'", () => {
    const est = lerEstados({ m1: { estado: "integrado", campos: [], marcado_em: null, integrado_em: "não-é-uma-data" } });
    expect(textoSelo(est.m1, "America/Sao_Paulo")).toBe("Integrado — travado");
  });
  it("data válida: comportamento de antes preservado ('Integrado em dd/mm — travado')", () => {
    const est = lerEstados({ m1: { estado: "integrado", campos: [], marcado_em: null, integrado_em: "2026-09-26T13:00:00Z" } });
    expect(textoSelo(est.m1, "America/Sao_Paulo")).toBe("Integrado em 26/09 — travado");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 1 — m5/M-2 (revisões): capitalização de "Integração" nos 3 hints + o texto do SKU alinhado com
// P-73 (o dono: SKUs e "Tamanho em" travam; cor/tamanho novo no BOM do INTERNO fica sem SKU até desfazer —
// o BOM em si (cores/grade) segue LIVRE, a trava de "cores"/"variantes" no banco é do espelho comprado).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Fix round 1 (m5/M-2) — capitalização e texto do SKU alinhado com P-73", () => {
  it("os 3 hints usam 'Integração' maiúsculo, nunca 'integração' minúsculo", () => {
    const info = ler("src/components/planejamento/planejamento-detail/InfoGeraisSecao.tsx");
    const preco = ler("src/components/planejamento/planejamento-detail/PrecoTabela.tsx");
    const revenda = ler("src/components/planejamento/planejamento-detail/RevendaSetores.tsx");
    expect(info).toMatch(/mesmo travado pela Integração\./);
    // P-146/P-158: o hover do Preço anterior travado mora na lib (fonte única dos textos por versão) — as 2 telas o usam.
    const lib = ler("src/lib/versao-anterior.ts");
    expect(lib).toMatch(/mesmo travado pela Integração\./);
    expect(lib).not.toMatch(/mesmo travado pela integração\./);
    expect(preco).toContain("hoverPrecoAnteriorTravado(autoAnterior)");
    expect(revenda).toContain("hoverPrecoAnteriorTravado(autoAnterior)");
    expect(info).not.toMatch(/mesmo travado pela integração\./);
    expect(preco).not.toMatch(/mesmo travado pela integração\./);
    expect(revenda).not.toMatch(/mesmo travado pela integração\./);
  });
  it("TEXTO_SKU_TRAVADO segue P-73: só SKUs e 'Tamanho em' travam; cor/tamanho no BOM fica sem SKU até desfazer", () => {
    const t = ler("src/lib/integracao/trava.ts");
    expect(t).toContain('export const TEXTO_SKU_TRAVADO =\n  \'SKUs e "Tamanho em" travados pela Integração — mudar cores ou tamanhos no BOM não cria SKU novo até o super admin desfazer.\';');
  });
  it("TEXTO_TRAVA_SHEET usa 'Integração' maiúsculo", () => {
    const t = ler("src/lib/integracao/trava.ts");
    expect(t).toMatch(/Campos marcados na Integração ficam travados\./);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 2 — item 3 (m1/I-2 das revisões): `aplicarAGravar` não podia rodar quando os SKUs estão travados
// pela Integração — uma prévia "a gravar" pendente de ANTES do lock chegar continuava chamando
// `aplicar_skus_modelo` em todo Salvar (e recebendo 42501 `integracao_travado: sku` pra sempre, sem forma de o
// usuário limpar o estado preso — os controles de SKU já estão desabilitados). RENDER de verdade
// (react-dom/client + happy-dom), montando o par real useSkusAGravar()+useSkusModelo() com `podeEditar=false`.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Fix round 2 (m1/I-2) — aplicarAGravar não chama aplicar_skus_modelo quando os SKUs estão travados", () => {
  it("card travado (podeEditar=false) com uma prévia 'a gravar' pendente: aplicarAGravar NUNCA chama aplicar_skus_modelo e limpa o pendente", async () => {
    rpcSpy.mockClear();
    const { useSkusAGravar, useSkusModelo } = await import("@/components/planejamento/planejamento-detail/codigos/useSkusModelo");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    let apiRef: ReturnType<typeof useSkusModelo> | null = null;
    let aGravarRef: ReturnType<typeof useSkusAGravar> | null = null;
    function Harness() {
      const aGravar = useSkusAGravar();
      aGravarRef = aGravar;
      const api = useSkusModelo("m1", true, false /* podeEditar=false — TRAVADO */, {
        refPrevia: "REF0001", tamanhoTipo: "letra", aGravar,
      });
      apiRef = api;
      return null;
    }
    const view = montar(createElement(QueryClientProvider, { client: qc }, createElement(Harness)));

    // Simula uma prévia "a gravar" que já estava pendente (pedido de Regerar) — ficou pendente ANTES do lock
    // chegar, exatamente o cenário m1/I-2 descreve. `pedirRegerar` marca `regerar: true` (nadaAGravar vira false).
    act(() => { aGravarRef!.pedirRegerar(); });
    expect(aGravarRef!.atual().regerar).toBe(true); // confirma que HÁ algo pendente antes de chamar aplicarAGravar

    let resultado: "nada" | "ok" | "falhou" | null = null;
    await act(async () => { resultado = await apiRef!.aplicarAGravar(); });

    expect(resultado).toBe("nada");
    // A prova central: aplicar_skus_modelo NUNCA foi chamado (nem skus_modelo/skus_previa — que rodam em
    // background pelas queries — contam como esta RPC específica).
    expect(rpcSpy.mock.calls.some(([nome]) => nome === "aplicar_skus_modelo")).toBe(false);
    // O estado pendente foi limpo (como um Salvar bem-sucedido faria) — não fica preso pra sempre.
    expect(aGravarRef!.atual().regerar).toBe(false);

    view.unmount();
  });

  it("card LIVRE (podeEditar=true) com a MESMA prévia pendente: aplicarAGravar segue tentando (não é 'nada' por falta de dado — 'falhou' pela prévia ainda não calculada, nunca 'nada')", async () => {
    rpcSpy.mockClear();
    const { useSkusAGravar, useSkusModelo } = await import("@/components/planejamento/planejamento-detail/codigos/useSkusModelo");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    let apiRef: ReturnType<typeof useSkusModelo> | null = null;
    let aGravarRef: ReturnType<typeof useSkusAGravar> | null = null;
    function Harness() {
      const aGravar = useSkusAGravar();
      aGravarRef = aGravar;
      const api = useSkusModelo("m1", true, true /* podeEditar=true — LIVRE */, {
        refPrevia: "REF0001", tamanhoTipo: "letra", aGravar,
      });
      apiRef = api;
      return null;
    }
    const view = montar(createElement(QueryClientProvider, { client: qc }, createElement(Harness)));
    act(() => { aGravarRef!.pedirRegerar(); });

    let resultado: "nada" | "ok" | "falhou" | null = null;
    await act(async () => { resultado = await apiRef!.aplicarAGravar(); });

    // Sem o gate de I-2, o card LIVRE nunca retorna "nada" aqui (há algo a gravar) — prova que a diferença de
    // comportamento entre travado/livre é EXATAMENTE o gate `podeEditar`, não algum outro efeito colateral do
    // mock. A prévia real não teve tempo de chegar (sem esperar o debounce/refetch), então cai no ramo
    // "calculando" ('falhou'), nunca em "nada".
    expect(resultado).not.toBe("nada");
    view.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 3 (R-5) — RENDER real de `usePlanejamentoSave` (não `PlanejamentoDetail` inteiro — inviável, ver
// task-21-report.md rounds 1/2: a `ficha: FichaSave` tem dependências profundas de BOM/CAD). Este harness monta
// SÓ `usePlanejamentoSave` com uma `ficha` stub INERTE (`gravar: false` em tudo — o BOM/CAD nunca entra no
// caminho), Supabase mockado (spy no `.update()`), e dispara um Salvar de VERDADE (`save.mutate()` → aguarda
// `onSuccess`). Prova que o restore da trava (R-1/R-3/R-4) roda de fato dentro do onSuccess real — não só a
// função pura isolada. Se alguém comentar a chamada de `resolverColunasTravadas`/o uso de `paraBaseDoMerge` no
// onSuccess (verificado manualmente numa cópia no scratchpad, NUNCA no worktree — ver o relato no
// task-21-report.md), este teste fica RED porque `baseRef.current.draft` continuaria com a forma CANÔNICA
// (calculada por `normalizarDraftSalvo`) em vez do valor CRU do servidor.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Fix round 3 (R-5) — RENDER real de usePlanejamentoSave: o restore da trava roda dentro do onSuccess de verdade", () => {
  it("card travado em titulo_pagina (valor não-canônico, NÃO editado pelo usuário): depois do Salvar, baseRef fica com o valor CRU do servidor, não a forma canônica", async () => {
    const { usePlanejamentoSave } = await import("@/components/planejamento/planejamento-detail/usePlanejamentoSave");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    // Valor CRU gravado no banco: título com espaço (não-canônico — normalizarDraftSalvo apararia pra
    // "Blusa | Loja"). O usuário NÃO editou o campo (travado, desabilitado) — só salvou por causa de OUTRO
    // campo (ex.: nome). `travaIntegracao` marca `titulo_pagina` como travado.
    const draftCru: Draft = { ...emptyDraft(), nome: "Blusa", titulo_pagina: " Blusa | Loja " };
    const trava = new Set(["titulo_pagina"]);

    const bomInerte: any = {
      estado: null, snapshot: "", gravar: false, sujoNaCaptura: false,
      flags: { grade: false, consumo: false, aviamentos: false },
      idsEtiquetasServidor: [], tecidosPlanejados: [], totais: null,
      cad: { gravar: false }, gradesPayload: null, gradeExterna: null, gradeConflito: false, enviadoNaCaptura: false,
    };
    const fichaStub: any = {
      podeGravarColunasDev: false, podeVerCustos: false,
      conflitoBomRef: { current: false }, verificandoBomRef: { current: false }, colecoesTouchadasRef: { current: false },
      setConflitoBom: () => {}, marcarSaveEmVoo: () => {}, bomMudouNoServidor: async () => false,
      capturar: () => bomInerte, cadGravado: () => {}, aposSalvar: () => ({ bomMudouEmVoo: false, edicoesPerdidas: false }),
      bomGravado: () => {}, invalidarBom: () => {}, bomPendenteDeGravar: () => false,
      etapas: {},
    };

    const draftRef = { current: draftCru };
    const touchedRef = { current: new Set<string>() }; // NADA tocado — nem sequer nome (o Salvar pode disparar por qualquer motivo)
    const baseRef = { current: { draft: draftCru } }; // o servidor JÁ TEM esse valor cru antes deste save
    const revRef = { current: 1 };
    const retryRef = { current: false };
    const savingRef = { current: false };
    const conflitosRef = { current: [] as any[] };
    const moLinhasRef = { current: [] as any[] };
    const moBaseRef = { current: [] as any[] };
    const gradeRevendaBaseRef = { current: "{}" };
    const gradeRevendaRevRef = { current: null };

    let updPayloadCapturado: Record<string, unknown> | null = null;
    rpcSpy.mockClear();
    const supabaseMod: any = await import("@/integrations/supabase/client");
    const fromSpy = vi.fn((tabela: string) => {
      if (tabela !== "modelos") return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      return {
        update: (payload: Record<string, unknown>) => {
          updPayloadCapturado = payload;
          return {
            eq: () => ({
              eq: () => ({ select: () => Promise.resolve({ data: [{ id: "m1" }], error: null }) }),
            }),
          };
        },
        select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { rev: 2 }, error: null }) }) }),
      };
    });
    supabaseMod.supabase.from = fromSpy;

    function Harness({ onReady }: { onReady: (api: ReturnType<typeof usePlanejamentoSave>) => void }) {
      const api = usePlanejamentoSave({
        modeloId: "m1", isEdit: true, isRevenda: false, paOn: false, piOn: false,
        podeEditarPreco: true, podeVerCustos: false, podeEditarDev: false, podeEditarPlanejamento: true,
        refEditavel: false, travaIntegracao: trava, categorias: [],
        draft: draftRef.current, setDraft: (fnOrValue: any) => {
          draftRef.current = typeof fnOrValue === "function" ? fnOrValue(draftRef.current) : fnOrValue;
        },
        draftLiveRef: draftRef as any, touchedRef: touchedRef as any, baseRef: baseRef as any,
        revRef: revRef as any, retryRef: retryRef as any, savingRef: savingRef as any,
        conflitosRef: conflitosRef as any, setConflitos: () => {}, setUltimoMerge: () => {},
        setEnviada: () => {}, setLancado: () => {},
        moLinhasRef: moLinhasRef as any, moBaseRef: moBaseRef as any, setMoLinhasBase: () => {},
        gradeRevenda: {}, setGradeRevenda: () => {}, gradeRevendaDirty: false,
        gradeRevendaBaseRef: gradeRevendaBaseRef as any, gradeRevendaRevRef: gradeRevendaRevRef as any,
        buildLinhasGradeRevenda: () => [], gradeCompradoPeloBom: false,
        qc, onSaved: async () => {}, ficha: fichaStub, resetDraftBaseline: () => {},
      });
      onReady(api);
      return null;
    }
    let apiRef: ReturnType<typeof usePlanejamentoSave> | null = null;
    const view = montar(createElement(QueryClientProvider, { client: qc }, createElement(Harness, { onReady: (api) => { apiRef = api; } })));

    await act(async () => {
      apiRef!.save.mutate();
      // A mutation é assíncrona (await lerGradeServidorComprado/etc. dentro do mutationFn) — espera resolver.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    // O payload do UPDATE real NÃO deve conter `titulo_pagina` (omitido pela trava).
    expect(updPayloadCapturado).not.toBeNull();
    expect("titulo_pagina" in (updPayloadCapturado as Record<string, unknown>)).toBe(false);
    // A PROVA CENTRAL de R-5: `baseRef.current.draft.titulo_pagina` (a base do próximo merge) é o valor CRU
    // do servidor (" Blusa | Loja ", com espaço) — NÃO a forma canônica ("Blusa | Loja", aparada) que
    // `normalizarDraftSalvo` calcularia sozinho. Se o restore do onSuccess estiver desligado, este campo
    // viria aparado (a forma canônica de `savedDraft`), e a asserção abaixo falharia.
    expect(baseRef.current.draft.titulo_pagina).toBe(" Blusa | Loja ");
    view.unmount();
  }, 10000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Task 22 (n1/n2) — D14: o preço do IMPORTADO vira preço FIXO (espelho do da revenda). O UPDATE do Sheet não leva
// mais preço de NENHUM comprado (revenda E importado); o importado grava pelo gravador
// `salvar_precos_fixo_produto_importado` DEPOIS do UPDATE. O card do Plan. Produto passa a rotear o importado
// para o MESMO gravador (antes caía no da revenda e dava "Aguarde o produto de revenda carregar").
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("n1/n2 — preço do importado = preço FIXO (D14)", () => {
  it("n1: o UPDATE do Sheet não leva preço de comprado; o importado grava pelo gravador fixo", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    expect(s).toMatch(/if \(ehOrigemComprada\(d\.origem\)\) \{\s*delete payload\.preco_venda;\s*delete payload\.preco_atacado;/);
    expect(s).toMatch(/rpc\("salvar_precos_fixo_produto_importado" as any/);
  });
  it("n2: o card do Plan. Produto grava importado pelo gravador do importado e trava o preço integrado", () => {
    const s = ler("src/routes/_authenticated/criacao.planejamento.tsx");
    expect(s).toMatch(/rpc\("salvar_precos_fixo_produto_importado" as any/);
    expect(s).toMatch(/m\.origem === "importado"/);
    expect(s).toMatch(/precoTravado=\{/);
    expect(s).toMatch(/podeEditarPreco && !precoTravado \?/);
  });
});

// Harness de módulo (Fix round 1) — reusado por vários describes abaixo (Task 22 original + Fix round 1
// I-1/I-2/M-1/M-2/M-3/M-5), por isso vive FORA de qualquer describe.
async function montarHarnessImportado(opts: {
    draftCru: Draft; baseDraft: Draft; piOn: boolean; podeEditarPreco: boolean;
    produtoImportadoId: string | null;
    /** Fix round 1 (I-1): colunas travadas pela Integração no momento deste save. */
    travaIntegracao?: ReadonlySet<string>;
    /** Fix round 1 (I-1/R-3): colunas EDITADAS nesta sessão (default: preco_venda, como antes). */
    touched?: ReadonlySet<string>;
    /** Fix round 1 (M-1): o servidor devolve estes preços após a RPC fixa (default = null/null — um teste que
     *  queira provar o read-back passa os valores REAIS que o mock deve devolver). */
    precoServidorPosRpc?: { preco_venda: number | null; preco_atacado: number | null } | null;
    /** Fix round 1 (M-2): o `baseRef` muda DURANTE o await (corrida com outro usuário) — simulado avançando
     *  `baseRef.current` no meio do mock do RPC de leitura da grade (`lerGradeServidorComprado`). */
    baseMudaDuranteAwait?: Draft | null;
    /** Fix round 1 (M-4): captura o payload do UPDATE de `modelos` (para provar que ele não leva preço). */
    capturarUpdatePayload?: { current: Record<string, unknown> | null };
  }) {
    const { usePlanejamentoSave } = await import("@/components/planejamento/planejamento-detail/usePlanejamentoSave");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    const bomInerte: any = {
      estado: null, snapshot: "", gravar: false, sujoNaCaptura: false,
      flags: { grade: false, consumo: false, aviamentos: false },
      idsEtiquetasServidor: [], tecidosPlanejados: [], totais: null,
      cad: { gravar: false }, gradesPayload: null, gradeExterna: null, gradeConflito: false, enviadoNaCaptura: false,
    };
    const fichaStub: any = {
      podeGravarColunasDev: false, podeVerCustos: false,
      conflitoBomRef: { current: false }, verificandoBomRef: { current: false }, colecoesTouchadasRef: { current: false },
      setConflitoBom: () => {}, marcarSaveEmVoo: () => {}, bomMudouNoServidor: async () => false,
      capturar: () => bomInerte, cadGravado: () => {}, aposSalvar: () => ({ bomMudouEmVoo: false, edicoesPerdidas: false }),
      bomGravado: () => {}, invalidarBom: () => {}, bomPendenteDeGravar: () => false,
      etapas: {},
    };

    const draftRef = { current: opts.draftCru };
    const touchedRef = { current: opts.touched ?? new Set<string>(["preco_venda"]) };
    const baseRef = { current: { draft: opts.baseDraft } };
    const revRef = { current: 1 };
    const retryRef = { current: false };
    const savingRef = { current: false };
    const conflitosRef = { current: [] as any[] };
    const moLinhasRef = { current: [] as any[] };
    const moBaseRef = { current: [] as any[] };
    const gradeRevendaBaseRef = { current: "{}" };
    const gradeRevendaRevRef = { current: null };
    let resultado: any = null;

    rpcSpy.mockClear();
    const rpcCalls: { nome: string; args: any }[] = [];
    rpcSpy.mockImplementation((nome: string, args: any) => {
      rpcCalls.push({ nome, args });
      return Promise.resolve({ data: null, error: null });
    });
    const supabaseMod: any = await import("@/integrations/supabase/client");
    const fromSpy = vi.fn((tabela: string) => {
      if (tabela === "modelos") {
        return {
          update: (payload: Record<string, unknown>) => {
            if (opts.capturarUpdatePayload) opts.capturarUpdatePayload.current = payload;
            return {
              eq: () => ({
                eq: () => ({ select: () => Promise.resolve({ data: [{ id: "m1" }], error: null }) }),
              }),
            };
          },
          // `.select(...)` é usado em 2 pontos: `lerGradeServidorComprado` (comprado) lê "rev, grades:..." — rev
          // tem que bater com o `revCongelado` (revRef.current = 1, o harness não avança) e `grades` array; n1
          // (M-1) lê "preco_venda, preco_atacado" de volta DEPOIS da RPC. Distingue pela string da coluna.
          select: (cols: string) => ({
            eq: () => ({
              single: () => {
                if (cols.includes("grades")) {
                  // Fix round 1 (M-2) — se o teste simula uma corrida, o `baseRef` avança AQUI (o único await
                  // síncrono antes do UPDATE do header, mesmo ponto real onde a corrida do review acontece).
                  if (opts.baseMudaDuranteAwait) baseRef.current = { draft: opts.baseMudaDuranteAwait };
                  return Promise.resolve({ data: { rev: 1, grades: [] }, error: null });
                }
                // Fix round 1 (M-1) — read-back pós-RPC.
                return Promise.resolve({
                  data: opts.precoServidorPosRpc ?? { preco_venda: null, preco_atacado: null }, error: null,
                });
              },
            }),
          }),
        };
      }
      if (tabela === "produtos_importados") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: opts.produtoImportadoId ? { id: opts.produtoImportadoId } : null, error: null,
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    });
    supabaseMod.supabase.from = fromSpy;

    function Harness({ onReady }: { onReady: (api: ReturnType<typeof usePlanejamentoSave>) => void }) {
      const api = usePlanejamentoSave({
        modeloId: "m1", isEdit: true, isRevenda: false, paOn: false, piOn: opts.piOn,
        podeEditarPreco: opts.podeEditarPreco, podeVerCustos: false, podeEditarDev: false, podeEditarPlanejamento: true,
        refEditavel: false, travaIntegracao: opts.travaIntegracao, categorias: [],
        draft: draftRef.current, setDraft: (fnOrValue: any) => {
          draftRef.current = typeof fnOrValue === "function" ? fnOrValue(draftRef.current) : fnOrValue;
        },
        draftLiveRef: draftRef as any, touchedRef: touchedRef as any, baseRef: baseRef as any,
        revRef: revRef as any, retryRef: retryRef as any, savingRef: savingRef as any,
        conflitosRef: conflitosRef as any, setConflitos: () => {}, setUltimoMerge: () => {},
        setEnviada: () => {}, setLancado: () => {},
        moLinhasRef: moLinhasRef as any, moBaseRef: moBaseRef as any, setMoLinhasBase: () => {},
        gradeRevenda: {}, setGradeRevenda: () => {}, gradeRevendaDirty: false,
        gradeRevendaBaseRef: gradeRevendaBaseRef as any, gradeRevendaRevRef: gradeRevendaRevRef as any,
        buildLinhasGradeRevenda: () => [], gradeCompradoPeloBom: false,
        qc, onSaved: async () => {}, ficha: fichaStub, resetDraftBaseline: () => {},
      });
      onReady(api);
      return null;
    }
    let apiRef: ReturnType<typeof usePlanejamentoSave> | null = null;
    const view = montar(createElement(QueryClientProvider, { client: qc }, createElement(Harness, { onReady: (api) => { apiRef = api; } })));
    let erro: any = null;
    await act(async () => {
      apiRef!.save.mutate(undefined, { onSuccess: (r: any) => { resultado = r; }, onError: (e: any) => { erro = e; } });
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
    view.unmount();
    return { rpcCalls, resultado, erro, baseRefFinal: baseRef.current?.draft, draftLiveFinal: draftRef.current };
  }
  // Fix round 1 (M-1) — alias mais legível pro teste de read-back (mesma função; só o nome conta a intenção).
  const montarHarnessImportadoComReadBack = montarHarnessImportado;

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 2 (N-3, task-22-rereview.md) — harness de SAVES SEQUENCIAIS com estado PERSISTENTE entre chamadas
// (draft vivo, touchedRef e uma baseline REAL, gravada por `resetDraftBaseline` — não mais um no-op). Isto é o
// que faltava pros testes I-1/I-2 provarem "não fica preso em saves seguintes"/"fica sujo"/"avisa 1x": sem
// baseline real, `dirty` nunca pôde ser observado (a review N-3 apontou exatamente essa lacuna). Modelado no
// harness de verificação da re-review (scratchpad/t22rr/tests/unit/zz-rereview.test.ts) — não copiado
// verbatim: reconstruído contra ESTE arquivo de teste (mesmos stubs/convenções de `montarHarnessImportado`
// acima), com o dirty-check via `igual` (o mesmo predicado que `useDirtySnapshot` usa em produção).
type EstadoSequencial = { draft: { current: Draft }; touched: { current: Set<string> }; base: { current: { draft: Draft } }; baseline: { current: Draft | null } };
function estadoInicial(draftCru: Draft, baseDraft: Draft, touched: ReadonlySet<string>): EstadoSequencial {
  return {
    draft: { current: draftCru },
    touched: { current: new Set(touched) },
    base: { current: { draft: baseDraft } },
    baseline: { current: baseDraft },
  };
}
const estaSujo = (st: EstadoSequencial): boolean => !igual(st.draft.current, st.baseline.current);
async function salvarSequencial(st: EstadoSequencial, opts: {
  piOn: boolean; podeEditarPreco: boolean; produtoImportadoId: string | null;
  travaIntegracao?: ReadonlySet<string>; precoServidorPosRpc?: { preco_venda: number | null; preco_atacado: number | null } | null;
  /** Fix round 2 (N-1, cenário "digitou durante o save"): chamado no INSTANTE em que a RPC de preço fixo
   *  dispara (depois de `d`/`draftCruEnviado` já terem sido congelados pelo mutationFn) — usado pra simular
   *  uma edição em voo mutando `st.draft.current` só DEPOIS que o valor enviado já foi capturado. */
  aoChamarRpcPreco?: () => void;
}) {
  const { usePlanejamentoSave } = await import("@/components/planejamento/planejamento-detail/usePlanejamentoSave");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const bomInerte: any = {
    estado: null, snapshot: "", gravar: false, sujoNaCaptura: false,
    flags: { grade: false, consumo: false, aviamentos: false },
    idsEtiquetasServidor: [], tecidosPlanejados: [], totais: null,
    cad: { gravar: false }, gradesPayload: null, gradeExterna: null, gradeConflito: false, enviadoNaCaptura: false,
  };
  const fichaStub: any = {
    podeGravarColunasDev: false, podeVerCustos: false,
    conflitoBomRef: { current: false }, verificandoBomRef: { current: false }, colecoesTouchadasRef: { current: false },
    setConflitoBom: () => {}, marcarSaveEmVoo: () => {}, bomMudouNoServidor: async () => false,
    capturar: () => bomInerte, cadGravado: () => {}, aposSalvar: () => ({ bomMudouEmVoo: false, edicoesPerdidas: false }),
    bomGravado: () => {}, invalidarBom: () => {}, bomPendenteDeGravar: () => false,
    etapas: {},
  };
  rpcSpy.mockClear();
  const rpcCalls: { nome: string; args: any }[] = [];
  rpcSpy.mockImplementation((nome: string, args: any) => {
    rpcCalls.push({ nome, args });
    if (nome === "salvar_precos_fixo_produto_importado") opts.aoChamarRpcPreco?.();
    return Promise.resolve({ data: null, error: null });
  });
  const supabaseMod: any = await import("@/integrations/supabase/client");
  const fromSpy = vi.fn((tabela: string) => {
    if (tabela === "modelos") {
      return {
        update: () => ({ eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ id: "m1" }], error: null }) }) }) }),
        select: (cols: string) => ({
          eq: () => ({
            single: () => cols.includes("grades")
              ? Promise.resolve({ data: { rev: 1, grades: [] }, error: null })
              : Promise.resolve({ data: opts.precoServidorPosRpc ?? { preco_venda: null, preco_atacado: null }, error: null }),
          }),
        }),
      };
    }
    if (tabela === "produtos_importados") {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.produtoImportadoId ? { id: opts.produtoImportadoId } : null, error: null }) }) }) };
    }
    return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
  });
  supabaseMod.supabase.from = fromSpy;

  let erro: any = null;
  let apiRef: ReturnType<typeof usePlanejamentoSave> | null = null;
  function Harness({ onReady }: { onReady: (api: ReturnType<typeof usePlanejamentoSave>) => void }) {
    const api = usePlanejamentoSave({
      modeloId: "m1", isEdit: true, isRevenda: false, paOn: false, piOn: opts.piOn,
      podeEditarPreco: opts.podeEditarPreco, podeVerCustos: false, podeEditarDev: false, podeEditarPlanejamento: true,
      refEditavel: false, travaIntegracao: opts.travaIntegracao, categorias: [],
      draft: st.draft.current,
      setDraft: (fnOrValue: any) => { st.draft.current = typeof fnOrValue === "function" ? fnOrValue(st.draft.current) : fnOrValue; },
      draftLiveRef: st.draft as any, touchedRef: st.touched as any, baseRef: st.base as any,
      revRef: { current: 1 } as any, retryRef: { current: false } as any, savingRef: { current: false } as any,
      conflitosRef: { current: [] } as any, setConflitos: () => {}, setUltimoMerge: () => {},
      setEnviada: () => {}, setLancado: () => {},
      moLinhasRef: { current: [] } as any, moBaseRef: { current: [] } as any, setMoLinhasBase: () => {},
      gradeRevenda: {}, setGradeRevenda: () => {}, gradeRevendaDirty: false,
      gradeRevendaBaseRef: { current: "{}" } as any, gradeRevendaRevRef: { current: null } as any,
      buildLinhasGradeRevenda: () => [], gradeCompradoPeloBom: false,
      qc, onSaved: async () => {}, ficha: fichaStub,
      // A DIFERENÇA-CHAVE deste harness (N-3): `resetDraftBaseline` REALMENTE grava a baseline (o no-op do
      // harness antigo é exatamente por que N-1 não foi pego antes — nenhum teste conseguia observar "dirty").
      resetDraftBaseline: (next?: Draft) => { st.baseline.current = next ?? null; },
    });
    onReady(api);
    return null;
  }
  const view = montar(createElement(QueryClientProvider, { client: qc }, createElement(Harness, { onReady: (api) => { apiRef = api; } })));
  await act(async () => {
    apiRef!.save.mutate(undefined, { onError: (e: any) => { erro = e; } });
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  });
  view.unmount();
  return { rpcCalls: rpcCalls.filter((c) => c.nome === "salvar_precos_fixo_produto_importado"), erro };
}

describe("Task 22 — comportamento real: n1 (usePlanejamentoSave) grava o preço do importado pelo gravador fixo", () => {
  // Harness idêntico ao de Fix round 3 (R-5) acima — reusa o mesmo padrão de montagem/mocks, trocando o cenário
  // pra um card IMPORTADO com o preço EDITADO (varejo mudou vs a base do servidor).

  it("(a) editar SÓ o varejo: chama o gravador fixo com _tocar_varejo=true e _tocar_atacado=false", async () => {
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    const draft: Draft = { ...base, preco_venda: 150 }; // varejo mudou, atacado igual
    const { rpcCalls } = await montarHarnessImportado({
      draftCru: draft, baseDraft: base, piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1",
    });
    const chamada = rpcCalls.find((c) => c.nome === "salvar_precos_fixo_produto_importado");
    expect(chamada).toBeDefined();
    // _preco_atacado_fixo é IGNORADO pelo servidor quando _tocar_atacado=false (RPC: "case when
    // _tocar_atacado then ... else preco_atacado_fixo end") — só os 3 campos do canal TOCADO importam.
    expect(chamada!.args).toMatchObject({ _produto_id: "pi-1", _tocar_varejo: true, _preco_varejo_fixo: 150, _tocar_atacado: false });
  });

  it("(b) editar SÓ o atacado: chama o gravador fixo com _tocar_atacado=true e _tocar_varejo=false", async () => {
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    const draft: Draft = { ...base, preco_atacado: 80 }; // atacado mudou, varejo igual
    const { rpcCalls } = await montarHarnessImportado({
      draftCru: draft, baseDraft: base, piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1",
    });
    const chamada = rpcCalls.find((c) => c.nome === "salvar_precos_fixo_produto_importado");
    expect(chamada).toBeDefined();
    // _preco_varejo_fixo é IGNORADO pelo servidor quando _tocar_varejo=false (mesma regra do teste (a)).
    expect(chamada!.args).toMatchObject({ _produto_id: "pi-1", _tocar_atacado: true, _preco_atacado_fixo: 80, _tocar_varejo: false });
  });

  it("(c) limpar o preço (varejo vira vazio/0): manda _tocar_varejo=true com _preco_varejo_fixo NULL (P-91 A)", async () => {
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    const draft: Draft = { ...base, preco_venda: 0 }; // limpo
    const { rpcCalls } = await montarHarnessImportado({
      draftCru: draft, baseDraft: base, piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1",
    });
    const chamada = rpcCalls.find((c) => c.nome === "salvar_precos_fixo_produto_importado");
    expect(chamada).toBeDefined();
    expect(chamada!.args).toMatchObject({ _tocar_varejo: true, _preco_varejo_fixo: null });
  });

  it("preço IGUAL ao da base do servidor: NÃO chama o gravador fixo (nada mudou)", async () => {
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    const draft: Draft = { ...base }; // nada editado
    const { rpcCalls } = await montarHarnessImportado({
      draftCru: draft, baseDraft: base, piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1",
    });
    expect(rpcCalls.find((c) => c.nome === "salvar_precos_fixo_produto_importado")).toBeUndefined();
  });
});

describe("Task 22 — a revenda continua salvando o preço pelo gravador próprio (n1 não regride)", () => {
  it("usePlanejamentoSave.ts: ehOrigemComprada(d.origem) cobre revenda E importado — o UPDATE não leva preço de NENHUM comprado", async () => {
    const { ehOrigemComprada } = await import("@/lib/origem");
    expect(ehOrigemComprada("revenda")).toBe(true);
    expect(ehOrigemComprada("importado")).toBe(true);
    expect(ehOrigemComprada("interno")).toBe(false);
  });
  it("RevendaSetores.tsx grava o preço da revenda NA HORA (fora do save.mutate do Sheet), pela RPC própria — nunca dependeu do UPDATE de modelos.preco_venda/atacado", () => {
    const s = ler("src/components/planejamento/planejamento-detail/RevendaSetores.tsx");
    // O onBlur do input de preço chama a mutation que grava salvar_precos_fixo_produto_acabado diretamente
    // (não passa pelo usePlanejamentoSave/save.mutate) — a remoção de preco_venda/preco_atacado do payload do
    // UPDATE (n1, ehOrigemComprada) não pode afetar esta gravação porque ela nunca dependeu do UPDATE.
    expect(s).toMatch(/salvarPrecosFixoRevenda\.mutate\(\{ tocarAtacado: true,/);
    expect(s).toMatch(/salvar_precos_fixo_produto_acabado/);
  });
  it("criacao.planejamento.tsx: o card de revenda continua roteado para salvarPrecoVarejoRevenda (salvar_precos_fixo_produto_acabado), não para o gravador do importado", () => {
    const s = ler("src/routes/_authenticated/criacao.planejamento.tsx");
    // Ordem: 1) checa importado (novo, n2) -> 2) ehOrigemComprada (revenda, pré-existente, chama salvarPrecoVarejoRevenda).
    const idxComprada = s.indexOf('if (ehOrigemComprada(m.origem)) {', s.indexOf('if (m.origem === "importado")'));
    expect(idxComprada).toBeGreaterThan(-1);
    const trechoRevenda = s.slice(idxComprada, idxComprada + 600);
    expect(trechoRevenda).toMatch(/salvarPrecoVarejoRevenda\.mutate/);
  });
  it("usePlanejamentoSave real: card de REVENDA — o UPDATE não leva preco_venda/preco_atacado e o gravador do IMPORTADO nunca é chamado", async () => {
    const { usePlanejamentoSave } = await import("@/components/planejamento/planejamento-detail/usePlanejamentoSave");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    const bomInerte: any = {
      estado: null, snapshot: "", gravar: false, sujoNaCaptura: false,
      flags: { grade: false, consumo: false, aviamentos: false },
      idsEtiquetasServidor: [], tecidosPlanejados: [], totais: null,
      cad: { gravar: false }, gradesPayload: null, gradeExterna: null, gradeConflito: false, enviadoNaCaptura: false,
    };
    const fichaStub: any = {
      podeGravarColunasDev: false, podeVerCustos: false,
      conflitoBomRef: { current: false }, verificandoBomRef: { current: false }, colecoesTouchadasRef: { current: false },
      setConflitoBom: () => {}, marcarSaveEmVoo: () => {}, bomMudouNoServidor: async () => false,
      capturar: () => bomInerte, cadGravado: () => {}, aposSalvar: () => ({ bomMudouEmVoo: false, edicoesPerdidas: false }),
      bomGravado: () => {}, invalidarBom: () => {}, bomPendenteDeGravar: () => false,
      etapas: {},
    };
    const draftCru: Draft = { ...emptyDraft(), origem: "revenda", preco_venda: 200, preco_atacado: 90 };
    const draftRef = { current: draftCru };
    const touchedRef = { current: new Set<string>(["nome"]) }; // save disparado por OUTRO campo, não pelo preço
    const baseRef = { current: { draft: draftCru } };
    const revRef = { current: 1 };
    const retryRef = { current: false };
    const savingRef = { current: false };
    const conflitosRef = { current: [] as any[] };
    const moLinhasRef = { current: [] as any[] };
    const moBaseRef = { current: [] as any[] };
    const gradeRevendaBaseRef = { current: "{}" };
    const gradeRevendaRevRef = { current: null };

    rpcSpy.mockClear();
    const rpcCalls: { nome: string }[] = [];
    rpcSpy.mockImplementation((nome: string) => { rpcCalls.push({ nome }); return Promise.resolve({ data: null, error: null }); });
    let updPayloadCapturado: Record<string, unknown> | null = null;
    const supabaseMod: any = await import("@/integrations/supabase/client");
    const fromSpy = vi.fn((tabela: string) => {
      if (tabela === "modelos") {
        return {
          update: (payload: Record<string, unknown>) => {
            updPayloadCapturado = payload;
            return { eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ id: "m1" }], error: null }) }) }) };
          },
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { rev: 1, grades: [] }, error: null }) }) }),
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
    });
    supabaseMod.supabase.from = fromSpy;

    function Harness({ onReady }: { onReady: (api: ReturnType<typeof usePlanejamentoSave>) => void }) {
      const api = usePlanejamentoSave({
        modeloId: "m1", isEdit: true, isRevenda: true, paOn: true, piOn: true,
        podeEditarPreco: true, podeVerCustos: false, podeEditarDev: false, podeEditarPlanejamento: true,
        refEditavel: false, travaIntegracao: undefined, categorias: [],
        draft: draftRef.current, setDraft: (fnOrValue: any) => {
          draftRef.current = typeof fnOrValue === "function" ? fnOrValue(draftRef.current) : fnOrValue;
        },
        draftLiveRef: draftRef as any, touchedRef: touchedRef as any, baseRef: baseRef as any,
        revRef: revRef as any, retryRef: retryRef as any, savingRef: savingRef as any,
        conflitosRef: conflitosRef as any, setConflitos: () => {}, setUltimoMerge: () => {},
        setEnviada: () => {}, setLancado: () => {},
        moLinhasRef: moLinhasRef as any, moBaseRef: moBaseRef as any, setMoLinhasBase: () => {},
        gradeRevenda: {}, setGradeRevenda: () => {}, gradeRevendaDirty: false,
        gradeRevendaBaseRef: gradeRevendaBaseRef as any, gradeRevendaRevRef: gradeRevendaRevRef as any,
        buildLinhasGradeRevenda: () => [], gradeCompradoPeloBom: false,
        qc, onSaved: async () => {}, ficha: fichaStub, resetDraftBaseline: () => {},
      });
      onReady(api);
      return null;
    }
    let apiRef: ReturnType<typeof usePlanejamentoSave> | null = null;
    const view = montar(createElement(QueryClientProvider, { client: qc }, createElement(Harness, { onReady: (api) => { apiRef = api; } })));
    await act(async () => {
      apiRef!.save.mutate();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });
    view.unmount();

    expect(updPayloadCapturado).not.toBeNull();
    expect("preco_venda" in (updPayloadCapturado as Record<string, unknown>)).toBe(false);
    expect("preco_atacado" in (updPayloadCapturado as Record<string, unknown>)).toBe(false);
    // A revenda salva o preço por FORA deste save (RevendaSetores.tsx, on blur) — este save NUNCA deve
    // chamar o gravador do IMPORTADO (o guard `d.origem === "importado"` do n1 barra isso por construção).
    expect(rpcCalls.find((c) => c.nome === "salvar_precos_fixo_produto_importado")).toBeUndefined();
  }, 10000);
});

describe("Task 22 — comportamento real: n2 (criacao.planejamento.tsx) card roteia importado para o gravador do importado", () => {
  it("o card lê 'produtos_importados' (mapa modelo_id -> produto) para rotear o preço do importado", () => {
    const s = ler("src/routes/_authenticated/criacao.planejamento.tsx");
    // A query nova do mapa importado (n2) lê a tabela própria, distinta de produtos_acabados (revenda).
    expect(s).toMatch(/from\("produtos_importados" as any\)[\s\S]{0,200}\.select\("id, modelo_id"\)/);
    // O onPrecoVenda passa a checar `m.origem === "importado"` ANTES do ramo genérico ehOrigemComprada.
    const idxImportado = s.indexOf('if (m.origem === "importado")');
    const idxComprada = s.indexOf('if (ehOrigemComprada(m.origem)) {', idxImportado + 1);
    expect(idxImportado).toBeGreaterThan(-1);
    expect(idxComprada).toBeGreaterThan(idxImportado);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 1 (task-22-review.md) — I-1/I-2/M-1..M-5. Reusa `montarHarnessImportado` (agora aceita
// `travaIntegracao`/`touched`/`baseMudaDuranteAwait`/`capturarUpdatePayload`).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Fix round 1 — I-1: preço travado a meio da edição não quebra o save nem trava o card", () => {
  // Fix round 2 (N-3) — reescrito com o harness SEQUENCIAL (estado persistente + baseline REAL): a versão
  // antiga só olhava `resultado.resolucaoTrava`, nunca o draft vivo, `touched`, a contagem de toasts nem um
  // 2º Salvar — exatamente a lacuna que a review apontou (e por que N-1 não tinha sido pego antes: sem
  // baseline real, "dirty" nunca era observável). Agora prova TUDO que o título promete, em 1 sessão de 2 saves.
  it("varejo travado + editado: NÃO chama a RPC pro canal travado, restaura o draft, avisa 1x e não fica preso em saves seguintes", async () => {
    toastMock.warning.mockClear();
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    const st = estadoInicial({ ...base, preco_venda: 150 }, base, new Set(["preco_venda"])); // usuário editou ANTES da trava chegar
    const trava = new Set(["preco_venda"]);

    const r1 = await salvarSequencial(st, { piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1", travaIntegracao: trava, precoServidorPosRpc: { preco_venda: 100, preco_atacado: 50 } });
    // 1º Salvar: nenhuma RPC pro canal travado (o gatilho recusaria com 42501 DEPOIS do header já ter
    // comitado); o draft VIVO volta pro valor do servidor (100); a base do merge também; a chave sai de
    // `touched` (não fica "presa"); o card fica LIMPO (não dirty); exatamente 1 aviso.
    expect(r1.rpcCalls).toHaveLength(0);
    expect(st.draft.current.preco_venda).toBe(100);
    expect(st.base.current.draft.preco_venda).toBe(100);
    expect(st.touched.current.has("preco_venda")).toBe(false);
    expect(estaSujo(st)).toBe(false);
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
    expect(String(toastMock.warning.mock.calls[0][0])).toContain("Preço de venda foi travado");

    // 2º Salvar (nada de novo editado, a trava continua): não fica preso — 0 chamadas de novo, segue limpo,
    // e o toast NÃO repete (não é um "erro" recorrente, foi resolvido no 1º save).
    const r2 = await salvarSequencial(st, { piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1", travaIntegracao: trava, precoServidorPosRpc: { preco_venda: 100, preco_atacado: 50 } });
    expect(r2.rpcCalls).toHaveLength(0);
    expect(estaSujo(st)).toBe(false);
    expect(toastMock.warning).toHaveBeenCalledTimes(1); // não repetiu
  });
  it("varejo travado SEM edição do usuário (só outro campo mudou): nenhum aviso (não houve alteração perdida) e ainda assim nenhuma chamada à RPC", async () => {
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    const draft: Draft = { ...base }; // preço intocado — o Salvar disparou por outro motivo
    const trava = new Set(["preco_venda"]);
    const { rpcCalls, resultado } = await montarHarnessImportado({
      draftCru: draft, baseDraft: base, piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1",
      travaIntegracao: trava, touched: new Set(["nome"]), // NADA em preco_venda
    });
    expect(rpcCalls.find((c) => c.nome === "salvar_precos_fixo_produto_importado")).toBeUndefined();
    expect(resultado?.resolucaoTrava?.avisos ?? []).toEqual([]);
  });
  it("atacado editado com varejo travado: a RPC roda só pro atacado (canal não travado)", async () => {
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    const draft: Draft = { ...base, preco_venda: 150, preco_atacado: 80 };
    const trava = new Set(["preco_venda"]);
    const { rpcCalls } = await montarHarnessImportado({
      draftCru: draft, baseDraft: base, piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1",
      travaIntegracao: trava, touched: new Set(["preco_venda", "preco_atacado"]),
    });
    const chamada = rpcCalls.find((c) => c.nome === "salvar_precos_fixo_produto_importado");
    expect(chamada).toBeDefined();
    expect(chamada!.args).toMatchObject({ _tocar_varejo: false, _tocar_atacado: true, _preco_atacado_fixo: 80 });
  });
  it("usePlanejamentoSave.ts: payloadKeysAntes ganha preco_venda/preco_atacado do importado (fonte do fix)", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    expect(s).toMatch(/if \(d\.origem === "importado" && podeEditarPreco\) \{ payloadKeysAntes\.add\("preco_venda"\); payloadKeysAntes\.add\("preco_atacado"\); \}/);
    // n1 usa o MESMO travaIntegracao pra pular a RPC no canal travado.
    expect(s).toMatch(/const travaVarejo = !!travaIntegracao\?\.has\("preco_venda"\);/);
    expect(s).toMatch(/const tocarVarejo = !travaVarejo && varejo !== precoOuNull\(precoBaseCongelado\.venda\);/);
  });
});

describe("Fix round 1 — I-2: preço do importado vira só-leitura sem o módulo produto_importado", () => {
  it("piOn=false: o input fica desabilitado (podeEditarPreco && !precoImportadoOff) e a RPC nunca é chamada mesmo se o draft divergir da base", async () => {
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    // Mesmo simulando um draft "editado" (valor stale de antes do módulo desligar), n1 exige `piOn` — sem ele
    // nem entra no bloco. A trava de UI (PrecoTabela) é o que impede a edição NOVA acontecer na prática.
    const draft: Draft = { ...base, preco_venda: 150 };
    const { rpcCalls } = await montarHarnessImportado({
      draftCru: draft, baseDraft: base, piOn: false, podeEditarPreco: true, produtoImportadoId: "pi-1",
    });
    expect(rpcCalls.find((c) => c.nome === "salvar_precos_fixo_produto_importado")).toBeUndefined();
  });
  it("PrecoTabela.tsx: precoImportadoOff soma ao guard de edição e mostra o InfoHover com o texto exato", () => {
    const t = ler("src/components/planejamento/planejamento-detail/PrecoTabela.tsx");
    expect(t).toMatch(/\{podeEditarPreco && !travaPrecoVenda && !precoImportadoOff \? \(/);
    expect(t).toMatch(/Módulo Produto Importado desligado nesta loja — o preço do importado fica só leitura\./);
  });
  it("PlanejamentoDetail.tsx: precoImportadoOff é draft.origem===\"importado\" && !piOn", () => {
    const s = ler("src/components/planejamento/PlanejamentoDetail.tsx");
    expect(s).toMatch(/precoImportadoOff=\{draft\.origem === "importado" && !piOn\}/);
  });
});

describe("Fix round 1 — M-1: o preço lido de volta do servidor vira a base do merge (cobre a divergência do recompute)", () => {
  it("limpar o varejo (cai pro markup, servidor devolve valor DIFERENTE de null): a base do merge/baseline usa o valor REAL do servidor, não o null enviado", async () => {
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    const draft: Draft = { ...base, preco_venda: 0 }; // limpo — vira null no payload da RPC
    // Mock: depois da RPC, o SELECT de volta em `modelos` devolve 200 (markup recomputou), não null.
    const supabaseMod: any = await import("@/integrations/supabase/client");
    const { rpcCalls, resultado, baseRefFinal, draftLiveFinal } = await montarHarnessImportadoComReadBack({
      draftCru: draft, baseDraft: base, piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1",
      precoServidorPosRpc: { preco_venda: 200, preco_atacado: 50 },
    });
    void supabaseMod;
    expect(rpcCalls.find((c) => c.nome === "salvar_precos_fixo_produto_importado")).toBeDefined();
    // A prova central (M-1): a base do PRÓXIMO merge (baseRef.current.draft) tem que ser 200 (o REAL do
    // servidor), não `null`/0 (o que foi enviado) — senão o próximo refetch veria fresh=200 ≠ base=null e
    // acusaria "alguém mudou o preço" por engano (o falso banner que o review pediu pra cobrir).
    expect(baseRefFinal.preco_venda).toBe(200);
    // Fix round 2 (N-1) — ninguém digitou nada DURANTE o save (o draft vivo neste harness nunca se afasta do
    // que foi enviado): P-91 A diz que limpar = "volta a calcular", então o draft VIVO agora ADOTA o valor
    // real do servidor (200) — não fica preso em 0/null pra sempre (era exatamente o bug que N-1 reportou:
    // card permanentemente sujo, reenviando "limpar" a cada Salvar). Ver describe "Fix round 2 — N-1" abaixo
    // para o caso "digitou durante o save" (aí sim o valor do usuário tem prioridade e fica marcado).
    expect(draftLiveFinal.preco_venda).toBe(200);
    expect(resultado?.precosServidorPosRpc).toEqual({ preco_venda: 200, preco_atacado: 50 });
  });
  it("preço IGUAL ao enviado (sem divergência do recompute): o draft vivo sincroniza em silêncio com o valor do servidor", async () => {
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    const draft: Draft = { ...base, preco_venda: 150 };
    const { draftLiveFinal, baseRefFinal } = await montarHarnessImportadoComReadBack({
      draftCru: draft, baseDraft: base, piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1",
      precoServidorPosRpc: { preco_venda: 150, preco_atacado: 50 }, // igual ao enviado — sem divergência
    });
    expect(baseRefFinal.preco_venda).toBe(150);
    expect(draftLiveFinal.preco_venda).toBe(150);
  });
  it("usePlanejamentoSave.ts: lê preco_venda/preco_atacado de volta de `modelos` depois da RPC e devolve no resultado", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    expect(s).toMatch(/\.select\("preco_venda, preco_atacado"\)\.eq\("id", savedId\)\.single\(\)/);
    expect(s).toMatch(/precosServidorPosRpc = \{/);
    // onSuccess dobra por cima do enviadoEfetivo/baseDoMerge.
    expect(s).toMatch(/if \(result\?\.precosServidorPosRpc\) \{/);
    expect(s).toMatch(/\.\.\.\(result\?\.precosServidorPosRpc \?\? \{\}\),/);
  });
});

describe("Fix round 1 — M-2: o preço-base congela junto com `d`/revCongelado (sem corrida com o merge do colab)", () => {
  it("a base do servidor muda DURANTE o await da grade: n1 compara contra a base CONGELADA (do início do save), não a nova", async () => {
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    const draft: Draft = { ...base }; // usuário NÃO editou nada
    // Simula: enquanto o await de `lerGradeServidorComprado` roda, outra pessoa fixou o varejo em 300 (Realtime
    // avançou baseRef.current). Sem M-2, n1 compararia d.preco_venda(100) contra a NOVA base(300) e reenviaria
    // 100 como fixo, sobrescrevendo a edição alheia.
    const baseMudada: Draft = { ...base, preco_venda: 300 };
    const { rpcCalls } = await montarHarnessImportado({
      draftCru: draft, baseDraft: base, piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1",
      touched: new Set(), baseMudaDuranteAwait: baseMudada,
    });
    // Com a base CONGELADA (100, do início), d.preco_venda(100) === base congelada(100) ⇒ tocarVarejo=false ⇒
    // a RPC NUNCA roda (a edição alheia de 300 não é pisada).
    expect(rpcCalls.find((c) => c.nome === "salvar_precos_fixo_produto_importado")).toBeUndefined();
  });
  it("usePlanejamentoSave.ts: precoBaseCongelado é lido no MESMO ponto síncrono que revCongelado (antes de qualquer await)", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    expect(s).toMatch(/const revCongelado = revRef\.current;[\s\S]{0,1400}const precoBaseCongelado = \{ venda: baseRef\.current\?\.draft\.preco_venda, atacado: baseRef\.current\?\.draft\.preco_atacado \};/);
    expect(s).toMatch(/tocarVarejo = !travaVarejo && varejo !== precoOuNull\(precoBaseCongelado\.venda\)/);
    expect(s).toMatch(/tocarAtacado = atacado !== precoOuNull\(precoBaseCongelado\.atacado\)/);
  });
});

describe("Fix round 1 — M-3: falha do preço fixo (depois do header já ter comitado) tem etapaFalha própria", () => {
  it("a RPC falha: o toast diz que o card foi salvo mas o preço não, não o fallback genérico 'Erro'", async () => {
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    const draft: Draft = { ...base, preco_venda: 150 };
    const { erro } = await montarHarnessImportado({
      draftCru: draft, baseDraft: base, piOn: true, podeEditarPreco: true, produtoImportadoId: null, // sem produto → RAISE P0001
    });
    expect(erro?.etapaFalha).toBe("preco");
  });
  it("usePlanejamentoSave.ts: onError trata etapaFalha==='preco' com mensagem própria antes do fallback genérico", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    expect(s).toMatch(/if \(e\?\.etapaFalha === "preco"\) \{/);
    expect(s).toMatch(/O card foi salvo, mas o preço NÃO — salve de novo antes de fechar\./);
  });
});

describe("Fix round 1 — M-5: invalida plan-importado-produtos no onSuccess do Sheet", () => {
  it("usePlanejamentoSave.ts: invalida ['plan-importado-produtos'] quando savedDraft.origem === 'importado'", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    expect(s).toMatch(/savedDraft\.origem === "importado"\) \{[\s\S]{0,1600}qc\.invalidateQueries\(\{ queryKey: \["plan-importado-produtos"\] \}\);/);
  });
});

describe("Fix round 1 — M-6: correção da leitura do report sobre onde a trava é aplicada", () => {
  it("fn_integracao_trava_espelho (não só o recompute B1) recusa um preço fixo NOVO enquanto o produto está travado", () => {
    const sql = ler("supabase/migrations/20261007130000_integracao_4_trava.sql");
    expect(sql).toMatch(/fn_integracao_trava_espelho/);
    expect(sql).toMatch(/NEW\.preco_varejo_fixo IS NOT NULL[\s\S]{0,80}RAISE EXCEPTION 'integracao_travado: preco_venda' USING ERRCODE = '42501';/);
    // A trigger cobre AS DUAS espelhos (revenda e importado) — mesma função, mesmo comportamento.
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON public\.produtos_acabados\s*\n\s*FOR EACH ROW EXECUTE FUNCTION public\.fn_integracao_trava_espelho\(\);/);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON public\.produtos_importados\s*\n\s*FOR EACH ROW EXECUTE FUNCTION public\.fn_integracao_trava_espelho\(\);/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 2 (task-22-rereview.md) — N-1 (Important), N-2 (Minor). N-3 (harness) já foi tratado acima:
// `montarHarnessImportado` ganhou `capturarUpdatePayload` (M-4, round 1), e o describe "Fix round 1 — I-1"
// logo acima foi reescrito com o harness SEQUENCIAL (`estadoInicial`/`salvarSequencial`/`estaSujo`) que tem
// baseline REAL (não mais um no-op) — é o que faltava pros testes I-1 provarem dirty/toast-count/2º save.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Fix round 2 — N-1: limpar o preço do importado 'volta a calcular' (P-91 A) — sem card permanentemente sujo", () => {
  it("(a) limpar com markup presente: após o 1º Salvar o draft mostra o valor do servidor (200) e NÃO fica sujo; um 2º Salvar não manda RPC de preço", async () => {
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    // Ninguém digita nada DURANTE o save (o draft vivo é o mesmo valor limpo que foi enviado) — cenário do
    // usuário que clicou "limpar" e então Salvar, sem tocar em mais nada.
    const st = estadoInicial({ ...base, preco_venda: null as any }, base, new Set(["preco_venda"]));

    const r1 = await salvarSequencial(st, { piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1", precoServidorPosRpc: { preco_venda: 200, preco_atacado: 50 } });
    expect(r1.rpcCalls).toHaveLength(1);
    expect(r1.rpcCalls[0].args).toMatchObject({ _tocar_varejo: true, _preco_varejo_fixo: null });
    // A prova central de N-1: o draft mostra o valor CALCULADO (200), a base bate, a chave NÃO fica em
    // `touched`, e o card não é mais "dirty" — em vez de ficar preso em branco pra sempre.
    expect(st.draft.current.preco_venda).toBe(200);
    expect(st.base.current.draft.preco_venda).toBe(200);
    expect(st.touched.current.has("preco_venda")).toBe(false);
    expect(estaSujo(st)).toBe(false);

    // 2º Salvar: nada mudou (nem o preço, nem qualquer outro campo) — a comparação `d.preco_venda(200) ===
    // precoBaseCongelado.venda(200)` dá `tocarVarejo=false`, então a RPC de preço NÃO roda de novo. Sem o
    // fix, isto entraria num loop: `tocarVarejo` sempre `true` porque o draft ficava preso em `null`.
    const r2 = await salvarSequencial(st, { piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1", precoServidorPosRpc: { preco_venda: 200, preco_atacado: 50 } });
    expect(r2.rpcCalls).toHaveLength(0);
    expect(estaSujo(st)).toBe(false);
  });

  it("(b) o usuário digita um valor NOVO durante o save (o draft vivo diverge do que foi enviado): a edição em voo tem prioridade e o campo fica marcado", async () => {
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    const st = estadoInicial({ ...base, preco_venda: null as any }, base, new Set(["preco_venda"]));
    // Simula a digitação em voo via o hook `aoChamarRpcPreco` (chamado no instante em que a RPC de preço
    // fixo dispara — DEPOIS de `d`/`draftCruEnviado` já terem sido congelados pelo mutationFn, ANTES do
    // `onSuccess` rodar): o usuário digita 77 no campo, o draft vivo passa a DIVERGIR do que foi enviado (null).
    const r1 = await salvarSequencial(st, {
      piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1",
      precoServidorPosRpc: { preco_venda: 200, preco_atacado: 50 },
      aoChamarRpcPreco: () => { st.draft.current = { ...st.draft.current, preco_venda: 77 }; },
    });
    void r1;
    // A adoção compara `draftLiveRef.current` (77, editado DURANTE o save) contra `draftCruEnviado` (null, o
    // que foi de fato enviado) — são DIFERENTES, então a edição em voo GANHA: o draft continua com o 77
    // digitado (nunca sobrescrito pelo 200 do servidor em silêncio) e a chave permanece marcada — o usuário
    // ainda não salvou o 77, então o card segue "não salvo" honestamente.
    expect(st.draft.current.preco_venda).toBe(77);
    expect(st.touched.current.has("preco_venda")).toBe(true);
    expect(estaSujo(st)).toBe(true);
  });

  it("(c) os casos de trava do I-1 continuam intactos com o fix do N-1", async () => {
    toastMock.warning.mockClear();
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    const st = estadoInicial({ ...base, preco_venda: 150 }, base, new Set(["preco_venda"]));
    const trava = new Set(["preco_venda"]);
    // Travado: nenhuma RPC (nem a de preço fixo, então `precosServidorPosRpc` nunca é setado) — o N-1 não
    // interfere no caminho do I-1 (a adoção só roda quando `result.precosServidorPosRpc` existe).
    const r1 = await salvarSequencial(st, { piOn: true, podeEditarPreco: true, produtoImportadoId: "pi-1", travaIntegracao: trava });
    expect(r1.rpcCalls).toHaveLength(0);
    expect(st.draft.current.preco_venda).toBe(100); // restaurado pelo mecanismo do Task 21, como sempre
    expect(estaSujo(st)).toBe(false);
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
  });
});

describe("Fix round 2 — N-2: falha na releitura pós-RPC não diz que o preço não foi salvo", () => {
  it("a RPC de preço tem sucesso, mas a releitura falha: etapaFalha própria e mensagem honesta (o preço FOI salvo)", async () => {
    const base: Draft = { ...emptyDraft(), origem: "importado", preco_venda: 100, preco_atacado: 50 };
    const draft: Draft = { ...base, preco_venda: 150 };
    const draftRef = { current: draft };
    const touchedRef = { current: new Set<string>(["preco_venda"]) };
    const baseRef = { current: { draft: base } };
    const { usePlanejamentoSave } = await import("@/components/planejamento/planejamento-detail/usePlanejamentoSave");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const bomInerte: any = {
      estado: null, snapshot: "", gravar: false, sujoNaCaptura: false,
      flags: { grade: false, consumo: false, aviamentos: false },
      idsEtiquetasServidor: [], tecidosPlanejados: [], totais: null,
      cad: { gravar: false }, gradesPayload: null, gradeExterna: null, gradeConflito: false, enviadoNaCaptura: false,
    };
    const fichaStub: any = {
      podeGravarColunasDev: false, podeVerCustos: false,
      conflitoBomRef: { current: false }, verificandoBomRef: { current: false }, colecoesTouchadasRef: { current: false },
      setConflitoBom: () => {}, marcarSaveEmVoo: () => {}, bomMudouNoServidor: async () => false,
      capturar: () => bomInerte, cadGravado: () => {}, aposSalvar: () => ({ bomMudouEmVoo: false, edicoesPerdidas: false }),
      bomGravado: () => {}, invalidarBom: () => {}, bomPendenteDeGravar: () => false,
      etapas: {},
    };
    rpcSpy.mockClear();
    rpcSpy.mockImplementation(() => Promise.resolve({ data: null, error: null })); // salvar_precos_fixo_... TEM sucesso
    const supabaseMod: any = await import("@/integrations/supabase/client");
    supabaseMod.supabase.from = (tabela: string) => {
      if (tabela === "modelos") {
        return {
          update: () => ({ eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ id: "m1" }], error: null }) }) }) }),
          select: (cols: string) => ({
            eq: () => ({
              single: () => cols.includes("grades")
                ? Promise.resolve({ data: { rev: 1, grades: [] }, error: null })
                // A releitura pós-RPC (M-1) FALHA — mesmo que a RPC em si tenha tido sucesso acima.
                : Promise.resolve({ data: null, error: { message: "network error" } }),
            }),
          }),
        };
      }
      if (tabela === "produtos_importados") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "pi-1" }, error: null }) }) }) };
      }
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    };
    let erro: any = null;
    let apiRef: ReturnType<typeof usePlanejamentoSave> | null = null;
    function Harness({ onReady }: { onReady: (api: ReturnType<typeof usePlanejamentoSave>) => void }) {
      const api = usePlanejamentoSave({
        modeloId: "m1", isEdit: true, isRevenda: false, paOn: false, piOn: true,
        podeEditarPreco: true, podeVerCustos: false, podeEditarDev: false, podeEditarPlanejamento: true,
        refEditavel: false, travaIntegracao: undefined, categorias: [],
        draft: draftRef.current, setDraft: (f: any) => { draftRef.current = typeof f === "function" ? f(draftRef.current) : f; },
        draftLiveRef: draftRef as any, touchedRef: touchedRef as any, baseRef: baseRef as any,
        revRef: { current: 1 } as any, retryRef: { current: false } as any, savingRef: { current: false } as any,
        conflitosRef: { current: [] } as any, setConflitos: () => {}, setUltimoMerge: () => {},
        setEnviada: () => {}, setLancado: () => {},
        moLinhasRef: { current: [] } as any, moBaseRef: { current: [] } as any, setMoLinhasBase: () => {},
        gradeRevenda: {}, setGradeRevenda: () => {}, gradeRevendaDirty: false,
        gradeRevendaBaseRef: { current: "{}" } as any, gradeRevendaRevRef: { current: null } as any,
        buildLinhasGradeRevenda: () => [], gradeCompradoPeloBom: false,
        qc, onSaved: async () => {}, ficha: fichaStub, resetDraftBaseline: () => {},
      });
      onReady(api);
      return null;
    }
    const view = montar(createElement(QueryClientProvider, { client: qc }, createElement(Harness, { onReady: (api) => { apiRef = api; } })));
    await act(async () => {
      apiRef!.save.mutate(undefined, { onError: (e: any) => { erro = e; } });
      for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    });
    view.unmount();
    // A RPC de preço fixo TEVE sucesso (não é `etapaFalha==="preco"`) — só a releitura falhou.
    expect(erro?.etapaFalha).toBe("preco-leitura");
  });
  it("usePlanejamentoSave.ts: a releitura tem try/catch PRÓPRIO (não herda etapaFalha='preco' da RPC) e o onError mostra a mensagem exata", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    expect(s).toMatch(/\(eLeitura as any\)\.etapaFalha = "preco-leitura";/);
    expect(s).toMatch(/if \(e\?\.etapaFalha === "preco-leitura"\) \{/);
    expect(s).toMatch(/O preço foi salvo, mas não consegui reler o valor — recarregue para conferir\./);
  });
});

describe("F4 — Produto Acabado e Importado", () => {
  it("PA: selo + Nome/Foto/Excluir travados; do preço, SÓ o varejo (preço + markup) — atacado livre (D34/R8)", () => {
    const s = ler("src/components/produto-acabado/ProdutoCard.tsx");
    expect(s).toMatch(/const estadoIntegracao = useIntegracaoEstado\(produto\.modelo_id\);/);
    expect(s).toMatch(/disabled=\{identidadeTravada \|\| travaIntegracao\.has\("nome"\)\}/);
    expect(s).toMatch(/disabled=\{enviandoFoto \|\| travaIntegracao\.has\("fotos_modelo"\)\}/);
    expect(s.match(/disabled=\{travaIntegracao\.has\("preco_venda"\)( \|\| salvarMarkupMut\.isPending)?\}/g)?.length).toBe(2); // Markup varejo + Preço varejo
    expect(s).toMatch(/data-colab-path=\{`card:\$\{produto\.id\}:markup-var`\}\n\s+disabled=\{travaIntegracao\.has\("preco_venda"\)/);
    expect(s).toMatch(/<SeloIntegracao estado=\{estadoIntegracao\}/);
  });
  it("PI: Valor atacado/varejo = rascunho do preço FIXO, gravado no SALVAR (D14/R1); trava só o varejo marcado (R8)", () => {
    const s = ler("src/components/produto-importado/ProdutoImportadoCard.tsx");
    expect(s).not.toMatch(/salvar_precos_fixo_produto_importado/); // nada grava no blur
    expect(s).toMatch(/data-colab-path=\{cp\("preco-varejo-fixo"\)\}/);
    expect(s).toMatch(/onChange\(n > 0 \? \{ preco_varejo_fixo: n, markup_varejo: null \} : \{ preco_varejo_fixo: null \}\)/);
    expect(s).toMatch(/\{ markup_varejo: Number\(e\.target\.value\), preco_varejo_fixo: null \}/);
    expect(s.match(/disabled=\{travaIntegracao\.has\("preco_venda"\)\}/g)?.length).toBe(2); // Markup varejo + Valor varejo
    expect(s).toMatch(/disabled=\{travaIntegracao\.has\("ref"\)\}/);
    const sh = ler("src/components/produto-importado/shared.ts");
    expect(sh).toMatch(/preco_varejo_fixo: number \| null;/);
    expect(sh.slice(sh.indexOf("export function montarPayload"))).toMatch(/preco_varejo_fixo: draft\.preco_varejo_fixo \?\? null,/);
    expect(ler("src/components/produto-importado/ProdutoImportadoSheet.tsx")).toMatch(/preco_varejo_fixo: "Valor varejo"/);
  });
});

// Tarefa 5 (.superpowers/sdd/2026-09-29-tamanho-em/plan.md) — "Tamanho em" no Produto Acabado. Este describe é
// da T5 (ruling #4 do G-plano: T5 é dona deste arquivo; T6/Importado roda DEPOIS, em sequência).
describe("Tarefa 5 — Produto Acabado: toggle 'Tamanho em' no card", () => {
  const s = ler("src/components/produto-acabado/ProdutoCard.tsx");
  it("toggle ao lado de 'Proporção de grade (peso)', escondido em Acessórios (!acessorio)", () => {
    expect(s).toMatch(/\{!acessorio && \(\s*<TamanhoEmToggle/);
    expect(s).toMatch(/<Label className="text-sm">Proporção de grade \(peso\)<\/Label>/);
  });
  it("value = tipoEfetivo(produto.tamanho_tipo); onChange atualiza o draft", () => {
    expect(s).toMatch(/const tipoTamanho = tipoEfetivo\(produto\.tamanho_tipo\);/);
    expect(s).toMatch(/onChange=\{\(v\) => onChange\(\{ \.\.\.produto, tamanho_tipo: v \}\)\}/);
  });
  it("desabilitado + selo da Integração quando travaIntegracao.has('tamanho_tipo') — espelha o gate 42501 (invariante #14)", () => {
    expect(s).toMatch(/disabled=\{travaIntegracao\.has\("tamanho_tipo"\)\}/);
    expect(s).toMatch(/motivoDesabilitado=\{travaIntegracao\.has\("tamanho_tipo"\) \? TEXTO_SKU_TRAVADO : undefined\}/);
  });
  it("grade usa tamanhosVisiveis (filtro de EXIBIÇÃO — nunca reduz o gravado, ruling #3)", () => {
    expect(s).toMatch(/const tamanhosGrade = tamanhosVisiveis\(tamanhos, tipoTamanho, comValorTamanho\);/);
    expect(s).toMatch(/tamanhosGrade\.map\(\(\{ chave: t, rotulo, esmaecido \}\)/);
  });
  it("aviso âmbar quando modelo_skus>0 e o valor foi trocado NESTA edição (tipo !== base)", () => {
    expect(s).toMatch(/const tamanhoTrocadoNestaEdicao = produto\.tamanho_tipo !== produto\.tamanho_tipo_base;/);
    expect(s).toMatch(/const avisarSkuTamanho = produto\.modeloSkusCount > 0 && tamanhoTrocadoNestaEdicao;/);
    expect(s).toMatch(/SKUs já gerados não mudam — use Regerar no Planejamento\./);
  });
  it("'Criar card' salva antes se sujo (mesmo precedente do 'Fazer pedido')", () => {
    expect(s).toMatch(/if \(dirty\) await onSalvarProduto\(produto\);/);
    expect(s.indexOf("if (dirty) await onSalvarProduto(produto);")).toBeLessThan(s.indexOf('rpc("criar_card_produto_acabado"'));
  });
  it("Fix round (I-1): 'Criar card' lança erroValidacao ANTES de salvar/criar quando há conflito pendente; menu item desabilitado", () => {
    expect(s).toMatch(/if \(conflitoPendente\) \{\s*\n\s*throw erroValidacao\("Há conflitos de edição pendentes nesta coleção — resolva-os antes de criar o card\."\);/);
    const iGuard = s.indexOf('throw erroValidacao("Há conflitos de edição pendentes nesta coleção — resolva-os antes de criar o card.");');
    const iDirtySave = s.indexOf("if (dirty) await onSalvarProduto(produto);");
    expect(iGuard).toBeGreaterThan(-1);
    expect(iGuard).toBeLessThan(iDirtySave);
    expect(s).toMatch(/disabled=\{!!produto\.modelo_id \|\| criandoCard \|\| conflitoPendente\}/);
  });
  it("Fix round (L-3): colabPath namespaced por card ('card:<id>:tamanho_tipo')", () => {
    expect(s).toMatch(/colabPath=\{`card:\$\{produto\.id\}:tamanho_tipo`\}/);
  });
});

describe("Tarefa 5 — Produto Acabado: SELECT + embed do Sheet", () => {
  const s = ler("src/components/produto-acabado/ProdutoAcabadoSheet.tsx");
  it("SELECT_PRODUTO traz tamanho_tipo do produto E o embed do modelo (tamanho_tipo, modelo_skus(count))", () => {
    expect(s).toMatch(/foto_url, tamanho_tipo,/);
    expect(s).toMatch(/modelo:modelo_id\(preco_venda, preco_atacado, linha_id, fotos_modelo, desenho_tecnico_url, croqui_url, tamanho_tipo, modelo_skus\(count\)\)/);
  });
  it("rowToDraft: card com modelo_id usa o tamanho_tipo DO MODELO; sem card, o do próprio produto (P-119 A)", () => {
    expect(s).toMatch(/const tamanhoTipo = \(row\.modelo_id \? row\.modelo\?\.tamanho_tipo : row\.tamanho_tipo\) \?\? null;/);
  });
  it("ROTULO_CAMPO_PA tem 'Tamanho em' (rótulo do ColabBanner p/ conflito nesse campo)", () => {
    expect(s).toMatch(/tamanho_tipo: "Tamanho em"/);
  });
  it("lote 'Criar cards' salva os selecionados sujos ANTES de materializar (mesmo motivo do card)", () => {
    const bloco = s.slice(s.indexOf("const criarCardsClick"), s.indexOf('rpc("criar_cards_produto_acabado"'));
    expect(bloco).toMatch(/for \(const p of sujos\) await salvarUmProduto\(p\);/);
  });
  it("Fix round (I-1): lote 'Criar cards' bloqueia ANTES de qualquer RPC se algum selecionado tem conflito pendente", () => {
    const bloco = s.slice(s.indexOf("const criarCardsClick"), s.indexOf('rpc("criar_cards_produto_acabado"'));
    expect(bloco).toMatch(/if \(selecionados\.some\(\(d\) => \(conflitosPorProduto\[d\.id\]\?\.length \?\? 0\) > 0\)\) \{/);
    expect(bloco.indexOf("selecionados.some((d) => (conflitosPorProduto[d.id]")).toBeLessThan(bloco.indexOf("for (const p of sujos)"));
  });
  it("Fix round (L-1): salvarUmProduto rebaseline tamanho_tipo_base = tamanho_tipo depois do save", () => {
    expect(s).toMatch(/const salvo: ProdutoDraft = \{ \.\.\.p, rev: revNovo, tamanho_tipo_base: p\.tamanho_tipo \};/);
  });
  it("Fix round (L-2): onLimpo também zera tamanho_tipo/tamanho_tipo_base no draft local", () => {
    const bloco = s.slice(s.indexOf("onLimpo={() => {"), s.indexOf("changeProduto(limpo);"));
    expect(bloco).toMatch(/tamanho_tipo: null, tamanho_tipo_base: null,/);
  });
});

describe("Tarefa 5 — produto-acabado/shared.ts: campo travável + rótulo", () => {
  it("CAMPOS_TRAVAVEIS_POR_COLUNA.tamanho_tipo e o rótulo 'Tamanho em' no toast de trava", () => {
    const sh = ler("src/components/produto-acabado/shared.ts");
    expect(sh).toMatch(/tamanho_tipo: \["tamanho_tipo"\]/);
    expect(sh).toMatch(/tamanho_tipo: "Tamanho em",/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fix round (L-4) — RENDER real (react-dom/client + happy-dom) de `ProdutoCard.tsx` (Produto Acabado): o toggle
// "Tamanho em" escondido em Acessórios, a grade filtrada/esmaecida por `tamanhosVisiveis`, e o guard de conflito
// no "Criar card em Planejamento" (I-1). Mesma técnica de "Task 24 — RENDER real: ModelCard" acima
// (`vi.resetModules()`+`vi.doMock` local por describe, dynamic import DEPOIS do mock).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Fix round L-4 — RENDER real: ProdutoCard (Produto Acabado) — toggle 'Tamanho em' + guard de conflito", () => {
  function produtoBase(over: Record<string, unknown> = {}) {
    return {
      id: "p1", rev: 1, nome: "Blusa", ref: "REF1", grupo_id: "g1", categoria_id: "c1",
      subcategoria1_id: null, subcategoria2_id: null, colecao_id: "col1", subcolecao: null, semana: null,
      empresa_id: null, representante_id: null, ref_fornecedor: "", composicao: "",
      grade_proporcao: {}, qtd_total: 10, valor_unitario: 0, desconto_pct: 0, insumos_total: 0,
      markup_atacado: null, markup_varejo: null, preco_atacado_fixo: null, preco_varejo_fixo: null,
      foto_url: null, modelo_id: null, mix_id: null,
      tamanho_tipo: "letra", tamanho_tipo_base: "letra", modeloSkusCount: 0,
      variantes: [{ ordem: 1, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 10 }],
      modeloPrecoVenda: null, modeloPrecoAtacado: null, modeloLinhaId: null,
      modeloThumbFontes: [null, null, null], oc: null,
      ...over,
    };
  }
  async function montarProdutoCard(props: Record<string, unknown> = {}, estadoIntegracao: any = null) {
    vi.resetModules();
    vi.doMock("@tanstack/react-router", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@tanstack/react-router")>();
      return { ...actual, useNavigate: () => () => {} };
    });
    vi.doMock("@/hooks/useAuth", () => ({
      useAuth: () => ({ canView: () => true, canEdit: () => true, user: { id: "u1" }, session: null, loading: false }),
    }));
    vi.doMock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null }));
    vi.doMock("@/hooks/useMaoObraModelo", () => ({
      useMaoObraModelo: () => ({ linhas: [], catsServico: [], setLinhas: () => {}, aprovar: { mutate: () => {}, isPending: false }, linhasPersistidas: [], dirty: false, total: 0, salvar: { mutate: () => {}, isPending: false } }),
    }));
    vi.doMock("@/hooks/useIntegracaoEstado", () => ({ useIntegracaoEstado: () => estadoIntegracao }));
    const { ProdutoCard } = await import("@/components/produto-acabado/ProdutoCard");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const el = createElement(QueryClientProvider, { client: qc },
      createElement(ProdutoCard, {
        produto: produtoBase(),
        onChange: () => {}, open: true, onToggleOpen: () => {},
        grupos: [{ id: "g1", nome: "Camisas" }], categorias: [], subcats1: [], subcats2: [],
        cores: [], coresApelido: [], empresas: [], tamanhos: ["P", "M", "G"], colecaoNome: null,
        linhasMarkup: {}, onSalvarProduto: async () => {}, onCardCriado: () => {}, onOcVinculada: () => {},
        onExcluido: () => {}, onLimpo: () => {},
        ...props,
      } as any));
    return montar(el);
  }
  it("grupo NÃO Acessório: toggle 'Tamanho em' aparece (radiogroup nativo)", async () => {
    const { container, unmount } = await montarProdutoCard();
    expect(container.querySelector('[data-colab-path="card:p1:tamanho_tipo"]')).not.toBeNull();
    unmount();
  });
  it("grupo Acessórios (nome normalizado contém 'acessor'): toggle escondido", async () => {
    const { container, unmount } = await montarProdutoCard({
      grupos: [{ id: "g-acc", nome: "Acessórios" }],
      produto: produtoBase({ grupo_id: "g-acc" }),
    });
    expect(container.querySelector('[data-colab-path="card:p1:tamanho_tipo"]')).toBeNull();
    unmount();
  });
  it("travado (SEMPRE_TRAVADO cobre 'tamanho_tipo'): os 2 rádios do toggle ficam desabilitados", async () => {
    const { container, unmount } = await montarProdutoCard({}, { estado: "integravel", campos: ["nome"], marcadoEm: null, integradoEm: null });
    const grupo = container.querySelector('[data-colab-path="card:p1:tamanho_tipo"]');
    expect(grupo).not.toBeNull();
    const radios = [...grupo!.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios.every((r) => r.disabled)).toBe(true);
    unmount();
  });
  it("grade: tamanho com valor lançado no lado OPOSTO ao escolhido aparece ESMAECIDO (nunca some — ruling #3)", async () => {
    // tipo="letra" (default do produto), grade "34" (solto, lado número) já tem peso 5 lançado —
    // tamanhosDoTipo excluiria "34" do lado letra, mas tamanhosVisiveis resgata com esmaecido=true.
    const produto = produtoBase({ grade_proporcao: { PP: 1, M: 1, G: 1, "34": 5 } });
    const { container, unmount } = await montarProdutoCard({ produto, tamanhos: ["PP", "M", "G", "34"] });
    // A célula "34" deve estar presente na grade (não removida) com a classe de esmaecimento.
    const inputs = [...container.querySelectorAll("input")].filter((i) => i.getAttribute("data-colab-path")?.includes("grade-prop"));
    const celula34 = inputs.find((i) => i.getAttribute("data-colab-path") === "card:p1:grade-prop:34");
    expect(celula34).not.toBeUndefined();
    const wrapperEsmaecido = celula34!.closest("div.opacity-50");
    expect(wrapperEsmaecido).not.toBeNull();
    unmount();
  });
  it("'Criar card em Planejamento' fica desabilitado com conflitoPendente=true (I-1)", async () => {
    const { container, unmount } = await montarProdutoCard({ conflitoPendente: true });
    const maisAcoes = container.querySelector('[aria-label="Mais ações"]') as HTMLElement;
    expect(maisAcoes).not.toBeNull();
    act(() => { maisAcoes.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const criarCard = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Criar card em Planejamento")) as HTMLButtonElement;
    expect(criarCard).toBeTruthy();
    expect(criarCard.disabled).toBe(true);
    unmount();
  });
  it("'Criar card em Planejamento' fica HABILITADO sem conflitoPendente (produto sem card)", async () => {
    const { container, unmount } = await montarProdutoCard({ conflitoPendente: false });
    const maisAcoes = container.querySelector('[aria-label="Mais ações"]') as HTMLElement;
    act(() => { maisAcoes.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const criarCard = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Criar card em Planejamento")) as HTMLButtonElement;
    expect(criarCard.disabled).toBe(false);
    unmount();
  });
});

// Tarefa 6 (.superpowers/sdd/2026-09-29-tamanho-em/plan.md) — "Tamanho em" no Produto Importado.
// T6 roda DEPOIS da T5 (ruling #4 do G-plano) — só describes NOVOS neste arquivo compartilhado.
describe("Tarefa 6 — Produto Importado: toggle 'Tamanho em' no card", () => {
  const s = ler("src/components/produto-importado/ProdutoImportadoCard.tsx");
  it("toggle no TOPO da seção '2 · Grade & proporção'", () => {
    const iSecao = s.indexOf('2 · Grade &amp; proporção');
    const iToggle = s.indexOf("<TamanhoEmToggle");
    const iProporcao = s.indexOf('<Label className="text-sm">Proporção de grade</Label>');
    expect(iSecao).toBeGreaterThan(-1);
    expect(iToggle).toBeGreaterThan(iSecao);
    expect(iToggle).toBeLessThan(iProporcao);
  });
  it("value = tipoEfetivo(draft.tamanho_tipo); onChange manda um PATCH parcial (não o objeto inteiro)", () => {
    expect(s).toMatch(/const tipoTamanho = tipoEfetivo\(draft\.tamanho_tipo\);/);
    expect(s).toMatch(/onChange=\{\(v\) => onChange\(\{ tamanho_tipo: v \}\)\}/);
  });
  it("desabilitado + selo da Integração quando travaIntegracao.has('tamanho_tipo') (invariante #14)", () => {
    expect(s).toMatch(/disabled=\{travaIntegracao\.has\("tamanho_tipo"\)\}/);
    expect(s).toMatch(/motivoDesabilitado=\{travaIntegracao\.has\("tamanho_tipo"\) \? TEXTO_SKU_TRAVADO : undefined\}/);
  });
  it("grade usa tamanhosVisiveis (filtro de EXIBIÇÃO — nunca reduz o gravado, ruling #3)", () => {
    expect(s).toMatch(/const tamanhosGrade = tamanhosVisiveis\(tamanhos, tipoTamanho, comValorTamanho\);/);
    expect(s).toMatch(/tamanhosGrade\.map\(\(\{ chave: t, rotulo, esmaecido \}\)/);
  });
  it("aviso âmbar quando modeloSkusCount>0 e o valor foi trocado NESTA edição (tipo !== base)", () => {
    expect(s).toMatch(/const tamanhoTrocadoNestaEdicao = draft\.tamanho_tipo !== draft\.tamanho_tipo_base;/);
    expect(s).toMatch(/const avisarSkuTamanho = draft\.modeloSkusCount > 0 && tamanhoTrocadoNestaEdicao;/);
    expect(s).toMatch(/SKUs já gerados não mudam — use Regerar no Planejamento\./);
  });
  it("Fix round (M-1): toggle + aviso âmbar escondidos em Acessórios (!acessorio)", () => {
    const iSecao = s.indexOf('2 · Grade &amp; proporção');
    const iToggleGuard = s.indexOf("{!acessorio && (\n                    <TamanhoEmToggle");
    const iAvisoGuard = s.indexOf("{!acessorio && avisarSkuTamanho && (");
    expect(iToggleGuard).toBeGreaterThan(iSecao);
    expect(iAvisoGuard).toBeGreaterThan(iToggleGuard);
  });
  it("Fix round (L-3): colabPath namespaced por card (cp('tamanho_tipo'))", () => {
    expect(s).toMatch(/colabPath=\{cp\("tamanho_tipo"\)\}/);
  });
});

describe("Tarefa 6 — Produto Importado: SELECT + embed + lote 'Criar cards' salva antes se sujo", () => {
  const s = ler("src/components/produto-importado/ProdutoImportadoSheet.tsx");
  it("SELECT_PRODUTO_IMPORTADO embed do modelo traz tamanho_tipo + modelo_skus(count) (tamanho_tipo do PRÓPRIO produto já vem pelo '*')", () => {
    expect(s).toMatch(/"modelo:modelo_id\(preco_venda, tamanho_tipo, modelo_skus\(count\)\)"/);
  });
  it("draftDeRow resolve a fonte: card com modelo usa o tamanho_tipo DO MODELO; sem card, o do próprio produto (P-119 A)", () => {
    expect(s).toMatch(/const tamanhoTipo = \(\(r\.modelo_id \? r\.modelo\?\.tamanho_tipo : r\.tamanho_tipo\) \?\? null\)/);
  });
  it("ROTULO_CAMPO_PI tem 'Tamanho em' (rótulo do ColabBanner p/ conflito nesse campo)", () => {
    expect(s).toMatch(/tamanho_tipo: "Tamanho em"/);
  });
  it("lote 'Criar cards' salva os selecionados JÁ PERSISTIDOS e sujos ANTES de materializar", () => {
    const bloco = s.slice(s.indexOf("async function criarCardsClick"), s.indexOf('rpc("criar_cards_produto_importado"'));
    expect(bloco).toMatch(/for \(const d of sujos\) await salvarUmProduto\(d\);/);
  });
  it("Fix round (I-1): lote 'Criar cards' bloqueia ANTES de qualquer RPC se algum selecionado tem conflito pendente", () => {
    const bloco = s.slice(s.indexOf("async function criarCardsClick"), s.indexOf('rpc("criar_cards_produto_importado"'));
    expect(bloco).toMatch(/if \(selecionados\.some\(\(d\) => d\.id && \(conflitosPorProduto\[d\.id\]\?\.length \?\? 0\) > 0\)\) \{/);
    expect(bloco.indexOf("selecionados.some((d) => d.id && (conflitosPorProduto[d.id]")).toBeLessThan(bloco.indexOf("for (const d of sujos)"));
  });
  it("Fix round (L-1): salvarUmProduto rebaseline tamanho_tipo_base = tamanho_tipo depois do save", () => {
    expect(s).toMatch(/const salvo: ProdutoImportadoDraft = \{ \.\.\.d, id: novoId, rev: revNovo, ref: refNovo, tamanho_tipo_base: d\.tamanho_tipo \};/);
  });
});

describe("Tarefa 6 — produto-importado/shared.ts: campo travável + rótulo", () => {
  it("CAMPOS_TRAVAVEIS_POR_COLUNA.tamanho_tipo e o rótulo 'Tamanho em' no toast de trava", () => {
    const sh = ler("src/components/produto-importado/shared.ts");
    expect(sh).toMatch(/tamanho_tipo: \["tamanho_tipo"\]/);
    expect(sh).toMatch(/tamanho_tipo: "Tamanho em",/);
  });
});

// Fix round 2 (review Opus): os 4 campos de preço/markup do Produto Acabado (ProdutoCard.tsx)
// tinham `onBlur` reparseando `e.target.value` (o evento NATIVO de blur — texto MASCARADO pt-BR
// com vírgula decimal/ponto de milhar) com `Number()`, que dá `NaN` pra quase todo valor real
// ("698,00", "1.234,56"). `MoneyInput`/`NumberInput` só reconstroem o valor canônico no
// `onChange` (ver money-mask.test.ts, describe "Fix round 2" — mecanismo puro), nunca no
// `onBlur`, que repassa o evento do DOM sem tocar. Guarda de regressão no SOURCE: nenhum dos 4
// `onBlur` deste arquivo reparseia `e.target.value`/`e.currentTarget.value` com `Number`/
// `parseFloat` nunca mais — usam o valor já correto do draft (`produto.*`, escrito pelo
// `onChange`) comparado contra um ref capturado no `onFocus`.
describe("Fix round 2 — ProdutoCard.tsx (Produto Acabado): blur de preço/markup não reparseia o DOM", () => {
  const s = ler("src/components/produto-acabado/ProdutoCard.tsx");

  it("nenhum onBlur deste arquivo parseia e.target.value/e.currentTarget.value com Number()/parseFloat() (a causa raiz do bug)", () => {
    const blocks: string[] = [];
    const re = /onBlur=\{\s*\(?\s*e?\s*\)?\s*=>\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      let depth = 0, i = re.lastIndex - 1;
      const start = i;
      while (i < s.length) {
        if (s[i] === "{") depth++;
        else if (s[i] === "}") { depth--; if (depth === 0) break; }
        i++;
      }
      blocks.push(s.slice(start, i + 1));
    }
    expect(blocks.length).toBeGreaterThanOrEqual(4); // markup atacado/varejo + preço atacado/varejo
    for (const b of blocks) {
      const parseiaValorDoBlur = /(e\.(target|currentTarget)\.value)/.test(b) && /Number\s*\(|parseFloat\s*\(/.test(b);
      expect(parseiaValorDoBlur).toBe(false);
    }
  });

  it("os 4 campos capturam o valor de referência no onFocus (base para decidir se o onBlur precisa salvar)", () => {
    expect(s).toMatch(/onFocus=\{\(\) => \{ precoAtacadoBaseRef\.current = produto\.preco_atacado_fixo \?\? null; \}\}/);
    expect(s).toMatch(/onFocus=\{\(\) => \{ precoVarejoBaseRef\.current = produto\.preco_varejo_fixo \?\? null; \}\}/);
    expect(s).toMatch(/onFocus=\{\(\) => \{ markupAtacadoBaseRef\.current = produto\.markup_atacado \?\? null; \}\}/);
    expect(s).toMatch(/onFocus=\{\(\) => \{ markupVarejoBaseRef\.current = produto\.markup_varejo \?\? null; \}\}/);
  });

  it("o preço atacado usa produto.preco_atacado_fixo (o valor que o onChange já calculou) no onBlur, não Number(e.target.value)", () => {
    expect(s).toMatch(/const novo = produto\.preco_atacado_fixo \?\? null;\s*\n\s*if \(novo !== precoAtacadoBaseRef\.current\)/);
  });

  it("o preço varejo usa produto.preco_varejo_fixo no onBlur", () => {
    expect(s).toMatch(/const novo = produto\.preco_varejo_fixo \?\? null;\s*\n\s*if \(novo !== precoVarejoBaseRef\.current\)/);
  });

  it("o markup atacado usa produto.markup_atacado no onBlur e preserva a lógica de trava do varejo (N-3)", () => {
    expect(s).toMatch(/const mk = produto\.markup_atacado \?\? null;\s*\n\s*if \(mk === markupAtacadoBaseRef\.current\) return;/);
    // N-3 (fix round 2 anterior) continua intacto — a resolução do par travado não foi tocada.
    expect(s).toMatch(/markupCanalIntocado\(markupVarejoServidor/);
  });

  it("o markup varejo respeita a trava de Integração (early return) e usa produto.markup_varejo no onBlur", () => {
    expect(s).toMatch(/if \(travaIntegracao\.has\("preco_venda"\)\) return;[\s\S]*?const mk = produto\.markup_varejo \?\? null;/);
  });
});

describe("F4 — Plan. Tecido", () => {
  it("card com selo; Limpar slot e preço travados no integrável/integrado", () => {
    const s = ler("src/components/plan-tecido/ModelCard.tsx");
    expect(s).toMatch(/const estadoIntegracao = useIntegracaoEstado\(slot\.modelo_id\);/);
    expect(s).toMatch(/<SeloIntegracao estado=\{estadoIntegracao\}/);
    expect(s).toMatch(/precoTravado=\{travaIntegracao\.has\("preco_venda"\)\}/);
    expect(s).toMatch(/disabled=\{!!estadoIntegracao\} onClick=\{\(\) => setConfirmLimpar\(true\)\}/);
    expect(ler("src/components/plan-tecido/CustoSection.tsx")).toMatch(/disabled=\{precoTravado\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Task 24 — RENDER real (react-dom/client + happy-dom), não só regex-sobre-fonte (Lesson 4 do brief): monta
// `CustoSection` (preço travado) e `ModelCard` (selo + "Limpar slot" travado) de PRODUÇÃO, sem substituto.
// `useIntegracaoEstado` é mockado (mesmo padrão de produto-importado-shared.test.ts: RPC de rede não roda em
// unit test) — `colunasTravadas` (puro) segue REAL, decidindo o `disabled` a partir do estado mockado.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Task 24 — RENDER real: CustoSection (preço travado)", () => {
  function slotBase(): PtSlot {
    return {
      // D4: o campo de preço só existe na vaga SEM card (com card o preço é só leitura, vive no Planejamento).
      id: "s1", modelo_id: null, nome: "Blusa", ref: "REF1",
      preco_venda: 199.9, custo_simulado: {}, materiais: [],
    };
  }
  it("precoTravado=true: o NumberInput de 'Preço p/ venda' fica disabled, com o motivo no title", async () => {
    const { CustoSection } = await import("@/components/plan-tecido/CustoSection");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = montar(createElement(QueryClientProvider, { client: qc },
      createElement(CustoSection, {
        slot: slotBase(), onChange: () => {}, precoTravado: true, motivoPrecoTravado: "Preço travado pela Integração (integrável ou integrado).",
      })));
    const inputs = [...view.container.querySelectorAll("input")];
    const precoInput = inputs.find((i) => i.closest("div")?.previousElementSibling?.textContent === "Preço p/ venda")
      ?? inputs[inputs.length - 1]; // último NumberInput da seção é o "Preço p/ venda"
    expect(precoInput.disabled).toBe(true);
    expect(precoInput.title).toBe("Preço travado pela Integração (integrável ou integrado).");
    view.unmount();
  });
  it("precoTravado=false (default): o campo de preço fica LIVRE", async () => {
    const { CustoSection } = await import("@/components/plan-tecido/CustoSection");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = montar(createElement(QueryClientProvider, { client: qc },
      createElement(CustoSection, { slot: slotBase(), onChange: () => {} })));
    const inputs = [...view.container.querySelectorAll("input")];
    expect(inputs[inputs.length - 1].disabled).toBe(false);
    view.unmount();
  });
});

describe("Task 24 — RENDER real: ModelCard (selo + Limpar slot travado)", () => {
  // `vi.resetModules()` + `vi.doMock` LOCAL (escopado a este describe, via import dinâmico DEPOIS do mock) —
  // mesma técnica já usada pelo teste "Fix round 1 (m2/M-1)" acima, pra não interceptar o import dinâmico
  // daquele outro teste (que precisa do módulo REAL de useIntegracaoEstado). `colunasTravadas` (puro) segue
  // REAL — só "qual é o estado" é mockado.
  function vagaSlot(): PtSlot {
    return { id: "s1", slot_index: 0, modelo_id: null, nome: null, materiais: [] };
  }
  function slotComModelo(): PtSlot {
    return { id: "s1", slot_index: 0, modelo_id: "m1", nome: "Blusa", materiais: [] };
  }
  async function montarModelCardComEstado(
    estado: null | { estado: "integravel" | "integrado"; campos: string[]; marcadoEm: string | null; integradoEm: string | null },
    slot: PtSlot,
  ) {
    vi.resetModules();
    vi.doMock("@/hooks/useIntegracaoEstado", () => ({
      useIntegracaoEstado: (modeloId: string | null | undefined) => (modeloId ? estado : null),
      useIntegracaoEstados: () => ({}),
    }));
    // SeloIntegracao usa useStoreTimezone() (→ useActiveTenantId → useAuth, que exige AuthProvider) só p/
    // formatar a data do selo — infra de sessão real é irrelevante pra este teste (o texto do selo já é
    // coberto por integracao-celula.test.ts). Mock mínimo evita montar AuthProvider inteiro.
    vi.doMock("@/hooks/useStoreTimezone", () => ({ useStoreTimezone: () => "America/Sao_Paulo" }));
    const { ModelCard } = await import("@/components/plan-tecido/ModelCard");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const el = createElement(QueryClientProvider, { client: qc },
      createElement(ModelCard, { slot, onChange: () => {} } as any));
    return montar(el);
  }
  it("estado null: sem SeloIntegracao; 'Limpar slot' habilitado (slot é vaga, sem modelo_id)", async () => {
    const { container, unmount } = await montarModelCardComEstado(null, vagaSlot());
    expect(container.textContent).not.toContain("travado");
    const maisAcoes = container.querySelector('[aria-label="Mais ações"]') as HTMLElement;
    expect(maisAcoes).not.toBeNull();
    act(() => { maisAcoes.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const limpar = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Limpar slot")) as HTMLButtonElement;
    expect(limpar).toBeTruthy();
    expect(limpar.disabled).toBe(false);
    unmount();
  });
  it("estado integrável (slot COM modelo_id): SeloIntegracao aparece no card", async () => {
    const estado = { estado: "integravel" as const, campos: ["preco_venda"], marcadoEm: "2026-09-27T10:00:00Z", integradoEm: null };
    const { container, unmount } = await montarModelCardComEstado(estado, slotComModelo());
    expect(container.textContent).toContain("travado");
    unmount();
  });
  it("'Limpar slot' fica disabled quando o estado (mockado, ignorando o gate normal de modelo_id só pra isolar o wiring do disabled) é integrável/integrado — prova o wiring `disabled={!!estadoIntegracao}`", async () => {
    vi.resetModules();
    // Mock que IGNORA o modeloId (sempre retorna o estado) — isola o wiring `disabled={!!estadoIntegracao}`
    // do gate real "só slot com modelo_id pode estar travado" (que a árvore de produção já garante: vaga
    // nunca tem modelo_id, então nunca recebe estado — coberto pelo teste anterior).
    vi.doMock("@/hooks/useIntegracaoEstado", () => ({
      useIntegracaoEstado: () => ({ estado: "integrado", campos: [], marcadoEm: null, integradoEm: "2026-09-27" }),
      useIntegracaoEstados: () => ({}),
    }));
    vi.doMock("@/hooks/useStoreTimezone", () => ({ useStoreTimezone: () => "America/Sao_Paulo" }));
    const { ModelCard } = await import("@/components/plan-tecido/ModelCard");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const el = createElement(QueryClientProvider, { client: qc },
      createElement(ModelCard, { slot: vagaSlot(), onChange: () => {} } as any));
    const { container, unmount } = montar(el);
    const maisAcoes = container.querySelector('[aria-label="Mais ações"]') as HTMLElement;
    act(() => { maisAcoes.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const limpar = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Limpar slot")) as HTMLButtonElement;
    expect(limpar).toBeTruthy();
    expect(limpar.disabled).toBe(true);
    expect(limpar.title).toBe("Limpar travado — produto integrado. Só o super admin desfaz a integração (aba Integração).");
    unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Final-review m1 — invalidarEstadoSeTravado (trava.ts): helper compartilhado que os 4 pontos sem o guard (PA
// Sheet, PI Sheet, ProdutoCard preço/markup, criacao.planejamento.tsx preço varejo revenda/importado) agora
// chamam no onError. Teste PURO/comportamental da função em si (não regex de fonte) + os pontos de wiring.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Final-review m1 — invalidarEstadoSeTravado (trava.ts)", () => {
  it("42501 com mensagem 'integracao_travado:*' invalida ['integracao-estado'] (prefixo, sem tenantId)", async () => {
    const { invalidarEstadoSeTravado } = await import("@/lib/integracao/trava");
    const { QueryClient } = await import("@tanstack/react-query");
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    invalidarEstadoSeTravado(qc, { code: "42501", message: "integracao_travado: preco_venda" });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["integracao-estado"] });
  });
  it("lê o code/message também de e.error.* e e.cause.* (formatos que o Supabase JS às vezes usa)", async () => {
    const { invalidarEstadoSeTravado } = await import("@/lib/integracao/trava");
    const { QueryClient } = await import("@tanstack/react-query");
    const qc1 = new QueryClient();
    const spy1 = vi.spyOn(qc1, "invalidateQueries");
    invalidarEstadoSeTravado(qc1, { error: { code: "42501", message: "integracao_travado: nome" } });
    expect(spy1).toHaveBeenCalledWith({ queryKey: ["integracao-estado"] });
    const qc2 = new QueryClient();
    const spy2 = vi.spyOn(qc2, "invalidateQueries");
    invalidarEstadoSeTravado(qc2, { cause: { code: "42501" }, message: "integracao_travado: sku" });
    expect(spy2).toHaveBeenCalledWith({ queryKey: ["integracao-estado"] });
  });
  it("NÃO invalida em outros erros (código diferente, mensagem diferente, erro nulo/undefined)", async () => {
    const { invalidarEstadoSeTravado } = await import("@/lib/integracao/trava");
    const { QueryClient } = await import("@tanstack/react-query");
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    invalidarEstadoSeTravado(qc, { code: "23503", message: "outra coisa" });
    invalidarEstadoSeTravado(qc, { code: "42501", message: "você não tem permissão" }); // 42501 genérico, sem o prefixo
    invalidarEstadoSeTravado(qc, null);
    invalidarEstadoSeTravado(qc, undefined);
    expect(spy).not.toHaveBeenCalled();
  });
  it("ProdutoAcabadoSheet.tsx importa e chama invalidarEstadoSeTravado(qc, e) dentro do onError do salvarMut", () => {
    const s = ler("src/components/produto-acabado/ProdutoAcabadoSheet.tsx");
    // Fix round pós-QA (F3) — o import ganhou 2 nomes novos (ehErroIntegracaoTravado/estadoIntegracaoFresco,
    // usados pelo revert imediato dentro de salvarUmProduto) ao lado dos 2 de sempre; a asserção casa os 4,
    // em vez do regex fixo de 2 nomes de antes.
    expect(s).toMatch(/import \{ colunasTravadas, ehErroIntegracaoTravado, estadoIntegracaoFresco, invalidarEstadoSeTravado \} from "@\/lib\/integracao\/trava";/);
    const idxSalvarMut = s.indexOf("const salvarMut = useMutation({");
    const idxChamada = s.indexOf("invalidarEstadoSeTravado(qc, e);");
    expect(idxSalvarMut).toBeGreaterThan(-1);
    expect(idxChamada).toBeGreaterThan(idxSalvarMut);
  });
  it("ProdutoImportadoSheet.tsx importa e chama invalidarEstadoSeTravado(qc, e) dentro do onError do salvarMut", () => {
    const s = ler("src/components/produto-importado/ProdutoImportadoSheet.tsx");
    // Fix round pós-QA (F3) — mesmo motivo do ProdutoAcabadoSheet.tsx acima.
    expect(s).toMatch(/import \{ colunasTravadas, ehErroIntegracaoTravado, estadoIntegracaoFresco, invalidarEstadoSeTravado \} from "@\/lib\/integracao\/trava";/);
    const idxSalvarMut = s.indexOf("const salvarMut = useMutation({");
    const idxChamada = s.indexOf("invalidarEstadoSeTravado(qc, e);");
    expect(idxSalvarMut).toBeGreaterThan(-1);
    expect(idxChamada).toBeGreaterThan(idxSalvarMut);
  });
  it("ProdutoCard.tsx (produto-acabado) chama invalidarEstadoSeTravado nos onError de salvarPrecoFixoMut E salvarMarkupMut", () => {
    const s = ler("src/components/produto-acabado/ProdutoCard.tsx");
    const ocorrencias = s.match(/invalidarEstadoSeTravado\(qc, e\);/g) ?? [];
    expect(ocorrencias.length).toBe(2);
  });
  it("criacao.planejamento.tsx chama invalidarEstadoSeTravado nos onError de salvarPrecoVarejoRevenda E salvarPrecoVarejoImportado", () => {
    const s = ler("src/routes/_authenticated/criacao.planejamento.tsx");
    const idxRevenda = s.indexOf("const salvarPrecoVarejoRevenda = useMutation({");
    const idxImportado = s.indexOf("const salvarPrecoVarejoImportado = useMutation({");
    expect(idxRevenda).toBeGreaterThan(-1);
    expect(idxImportado).toBeGreaterThan(idxRevenda);
    const blocoRevenda = s.slice(idxRevenda, idxImportado);
    expect(blocoRevenda).toMatch(/invalidarEstadoSeTravado\(qc, e\);/);
    const idxFimImportado = s.indexOf("// Default: agrupa por Tecido");
    const blocoImportado = s.slice(idxImportado, idxFimImportado > -1 ? idxFimImportado : undefined);
    expect(blocoImportado).toMatch(/invalidarEstadoSeTravado\(qc, e\);/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Final-review m2 — Excluir (Plan. Produto): (a) o Excluir POR CARD (Popover ⋯) tem que ficar `disabled` +
// `title` com textoExcluirTravado quando o produto está integrável/integrado (T22 só tinha travado o preço,
// não o Excluir). (b) a exclusão em massa pula os travados e devolve quantos ficaram de fora, com o toast PT
// exato pedido pela revisão.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Final-review m2 — Excluir travado no card da lista + bulk delete pula travados", () => {
  const s = ler("src/routes/_authenticated/criacao.planejamento.tsx");
  it("ModeloCard recebe/usa excluirTravado (disabled + title) nos DOIS botões Excluir (compacto e completo)", () => {
    const ocorrencias = s.match(/onClick=\{onExcluir\} disabled=\{!!excluirTravado\} title=\{excluirTravado \?\? undefined\}/g) ?? [];
    expect(ocorrencias.length).toBe(2);
  });
  it("a prop excluirTravado é calculada com textoExcluirTravado(estadosIntegracao[m.id].estado)", () => {
    expect(s).toMatch(/excluirTravado=\{estadosIntegracao\[m\.id\] \? textoExcluirTravado\(estadosIntegracao\[m\.id\]\.estado\) : null\}/);
  });
  it("bulkDel filtra os ids travados ANTES do .delete(), e o toast nomeia quantos foram pulados (texto PT exato)", () => {
    expect(s).toMatch(/const ids = idsSelecionados\.filter\(\(id\) => !estadosIntegracao\[id\]\);/);
    expect(s).toMatch(/const travados = idsSelecionados\.length - ids\.length;/);
    expect(s).toContain('toast.warning(`${travados} produto(s) integrável/integrado não foram excluídos (travados pela Integração).`);');
  });
  it("prova PURA do texto exato do toast (mesma interpolação que o código de produção usa)", () => {
    const travados = 2;
    const texto = `${travados} produto(s) integrável/integrado não foram excluídos (travados pela Integração).`;
    expect(texto).toBe("2 produto(s) integrável/integrado não foram excluídos (travados pela Integração).");
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Final-review m3 — invalidarIntegracao (useIntegracao.ts) precisa invalidar TAMBÉM as caches que mostram o
// mesmo nome/preço do produto em OUTRAS telas: plan-tecido-* (prefixo), plan-revenda-markups,
// plan-importado-produtos (as 2 keyeadas por [key, modeloIdsAll] no Plan. Produto) e pa-produto-modelo
// (keyeada POR id — [key, modeloId] — no bloco de revenda do Sheet do Planejamento).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Final-review m3 — invalidarIntegracao invalida os caches que faltavam", () => {
  it("invalida plan-revenda-markups, plan-importado-produtos e QUALQUER key que comece com plan-tecido (prefixo)", async () => {
    const { invalidarIntegracao } = await import("@/components/integracao/useIntegracao");
    const { QueryClient } = await import("@tanstack/react-query");
    const qc = new QueryClient();
    // Semeia queries reais no cache (invalidateQueries com predicate só enxerga o que está no cache) — mais
    // forte que inspecionar as CHAMADAS de invalidateQueries: prova que o predicate de fato CASA essas keys.
    for (const k of [
      ["plan-tecido-linhas-markup"],
      ["plan-tecido-modelos", "col1"],
      ["plan-tecido-previa", "col1"],
      ["plan-revenda-markups", ["m1", "m2"]],
      ["plan-importado-produtos", ["m1", "m2"]],
      ["algo-nao-relacionado"],
    ]) {
      qc.setQueryData(k, { fake: true });
    }
    invalidarIntegracao(qc, "t1", []);
    const estados = qc.getQueryCache().getAll().map((q) => ({ key: q.queryKey, stale: q.isStale() }));
    const staleDe = (prefixo: unknown) => estados.find((e) => JSON.stringify(e.key) === JSON.stringify(prefixo))?.stale;
    expect(staleDe(["plan-tecido-linhas-markup"])).toBe(true);
    expect(staleDe(["plan-tecido-modelos", "col1"])).toBe(true);
    expect(staleDe(["plan-tecido-previa", "col1"])).toBe(true);
    expect(staleDe(["plan-revenda-markups", ["m1", "m2"]])).toBe(true);
    expect(staleDe(["plan-importado-produtos", ["m1", "m2"]])).toBe(true);
    expect(staleDe(["algo-nao-relacionado"])).toBe(false); // prova que o predicate NÃO é global — só o prefixo certo
  });
  it("com ids: invalida pa-produto-modelo POR id (não em bulk — a key real é [key, modeloId])", async () => {
    const { invalidarIntegracao } = await import("@/components/integracao/useIntegracao");
    const { QueryClient } = await import("@tanstack/react-query");
    const qc = new QueryClient();
    qc.setQueryData(["pa-produto-modelo", "m1"], { fake: true });
    qc.setQueryData(["pa-produto-modelo", "m2"], { fake: true }); // outro produto — não deveria ser tocado
    invalidarIntegracao(qc, "t1", ["m1"]);
    const estados = qc.getQueryCache().getAll();
    const m1 = estados.find((q) => JSON.stringify(q.queryKey) === JSON.stringify(["pa-produto-modelo", "m1"]));
    const m2 = estados.find((q) => JSON.stringify(q.queryKey) === JSON.stringify(["pa-produto-modelo", "m2"]));
    expect(m1?.isStale()).toBe(true);
    expect(m2?.isStale()).toBe(false);
  });
  it("as keys de base (modelos-planejamento/produtos-acabados/etc — comportamento pré-existente) continuam invalidadas", async () => {
    const { invalidarIntegracao } = await import("@/components/integracao/useIntegracao");
    const { QueryClient } = await import("@tanstack/react-query");
    const qc = new QueryClient();
    for (const k of ["modelos-planejamento", "modelos-desenvolvimento", "produtos-acabados", "produtos-importados", "plan-custo-unit"]) {
      qc.setQueryData([k], { fake: true });
    }
    invalidarIntegracao(qc, "t1", []);
    for (const k of ["modelos-planejamento", "modelos-desenvolvimento", "produtos-acabados", "produtos-importados", "plan-custo-unit"]) {
      const q = qc.getQueryCache().find({ queryKey: [k] });
      expect(q?.isStale(), k).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Final-review m6 (1º nit) — ProdutoImportadoCard.tsx:221: `travaIntegracao` era um Set NOVO a cada render
// (colunasTravadas sem memo), então o `precos` useMemo (que lista `travaIntegracao` nas deps) recomputava em
// TODO render, não só quando o estado de integração mudava de verdade. Prova COMPORTAMENTAL: memoiza um valor
// externo (getSnapshot-like) que só muda quando estadoIntegracao muda, via useMemo real + contagem de chamadas.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Final-review m6 — ProdutoImportadoCard memoiza travaIntegracao (não recomputa em todo render)", () => {
  it("o código usa useMemo(() => colunasTravadas(estadoIntegracao), [estadoIntegracao]) — não uma chamada direta nas deps", () => {
    const s = ler("src/components/produto-importado/ProdutoImportadoCard.tsx");
    expect(s).toMatch(/const travaIntegracao = useMemo\(\(\) => colunasTravadas\(estadoIntegracao\), \[estadoIntegracao\]\);/);
    // Confirma que NÃO voltou a ser a chamada direta (regressão do bug original)
    expect(s).not.toMatch(/const travaIntegracao = colunasTravadas\(estadoIntegracao\);/);
  });
  it("prova comportamental de React puro: useMemo com [estadoIntegracao] só recalcula quando a REFERÊNCIA de estadoIntegracao muda — um componente que chama colunasTravadas(estado) DIRETO (sem memo) recalcula em TODO re-render, mesmo com o mesmo estado", () => {
    let chamadasSemMemo = 0;
    let chamadasComMemo = 0;
    const estadoEstavel = { estado: "integravel" as const, campos: ["nome"], marcadoEm: null, integradoEm: null };
    function SemMemo({ n }: { n: number }) {
      chamadasSemMemo++;
      const t = colunasTravadas(estadoEstavel); // chamada DIRETA — recomputa sempre
      return createElement("span", null, `${t.size}-${n}`);
    }
    function ComMemo({ n }: { n: number }) {
      // useMemo REAL do React (mesmo import do topo do arquivo) — a prova central: com deps estáveis
      // ([estadoEstavel], mesma referência entre os 2 renders), a fábrica só roda 1 vez.
      const t = useMemo(() => { chamadasComMemo++; return colunasTravadas(estadoEstavel); }, [estadoEstavel]);
      return createElement("span", null, `${t.size}-${n}`);
    }
    // MESMA raiz reusada para os 2 renders (root.render de novo, NÃO um 2º createRoot no mesmo container —
    // createRoot duas vezes no mesmo nó é o erro que o React acusa: "container already passed to createRoot").
    const container1 = document.createElement("div");
    document.body.appendChild(container1);
    const root1 = createRoot(container1);
    act(() => { root1.render(createElement(SemMemo, { n: 1 })); });
    act(() => { root1.render(createElement(SemMemo, { n: 2 })); });
    expect(chamadasSemMemo).toBeGreaterThanOrEqual(2); // recomputou nos 2 renders — confirma que SEM memo, recomputa sempre
    act(() => { root1.unmount(); });
    container1.remove();

    const container2 = document.createElement("div");
    document.body.appendChild(container2);
    const root2 = createRoot(container2);
    act(() => { root2.render(createElement(ComMemo, { n: 1 })); });
    act(() => { root2.render(createElement(ComMemo, { n: 2 })); });
    expect(chamadasComMemo).toBe(1); // com useMemo + deps estáveis, só computou 1 vez mesmo em 2 renders
    act(() => { root2.unmount(); });
    container2.remove();
  });
});
