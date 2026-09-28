// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { colunasTravadas, lerEstados, textoExcluirTravado, textoSelo } from "@/lib/integracao/trava";
import { omitirColunasTravadas, restaurarColunasTravadas, toastDescartadasPelaIntegracao } from "@/components/planejamento/planejamento-detail/usePlanejamentoSave";
import { emptyDraft, type Draft } from "@/components/planejamento/modelo-shared";
import { InfoGeraisSecao } from "@/components/planejamento/planejamento-detail/InfoGeraisSecao";

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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

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
    expect(s).toMatch(/const estadoIntegracao = useIntegracaoEstado\(isEdit \? modeloId : null\);/);
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
    expect(t).toMatch(/\{podeEditarPreco && !travaPrecoVenda \? \(/);
    const r = ler("src/components/planejamento/planejamento-detail/RevendaSetores.tsx");
    expect(r.match(/disabled=\{planBloqueado \|\| travaVarejo\}/g)?.length).toBe(2); // Markup varejo + Preço varejo
    expect(r.match(/disabled=\{planBloqueado\}\n/g)?.length).toBe(2); // Markup atacado + Preço atacado: LIVRES
    expect(r).toMatch(/\{podeEditarPreco && !travaPrecoAnterior \? \(/);
    expect(r).toMatch(/markup_varejo: travaVarejo \? \(produtoRevenda\?\.markup_varejo \?\? null\) : markupVarejoInput/);
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
// Fix round 1 — I2/I-2 (RULING): coluna travada com valor DIVERGENTE do servidor não pode virar "enviada" —
// restaurarColunasTravadas é a peça PURA (mirror de draftEnviadoComColunasDev, save-ficha.ts); o teste de
// integração real (nenhum falso "outra pessoa mudou" + nenhum selo "não salvo" perdido) é impraticável sem
// montar o Sheet inteiro com Supabase mockado — a prova aqui é a mesma unidade que o onSuccess usa, mais um
// teste de posição de fonte confirmando que ela é chamada nos dois pontos certos (enviadoEfetivo e baseDoMerge).
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Fix round 1 (I2/I-2) — restaurarColunasTravadas (pura)", () => {
  it("campo travado com valor IGUAL ao servidor: nada descartado, mesma referência", () => {
    const enviado = { nome: "Blusa", ncm: "6204.43.00" };
    const servidor = { nome: "Blusa", ncm: "6204.43.00" };
    const r = restaurarColunasTravadas(enviado, servidor, new Set(["ncm"]), (c) => c);
    expect(r.descartadas).toEqual([]);
    expect(r.draft).toBe(enviado);
  });
  it("campo travado com valor DIVERGENTE do servidor: restaura do servidor e reporta a coluna+rótulo", () => {
    const enviado = { nome: "Blusa Editada", ncm: "6204.43.00" };
    const servidor = { nome: "Blusa Antiga", ncm: "6204.43.00" };
    const r = restaurarColunasTravadas(enviado, servidor, new Set(["nome"]), (c) => (c === "nome" ? "Nome" : c));
    expect(r.descartadas).toEqual([{ coluna: "nome", rotulo: "Nome" }]);
    expect(r.draft).toEqual({ nome: "Blusa Antiga", ncm: "6204.43.00" });
    expect(r.draft).not.toBe(enviado); // cópia — não muta o original
  });
  it("várias colunas travadas divergentes: todas restauradas e reportadas", () => {
    const enviado = { nome: "X novo", ncm: "111", preco_venda: 50 };
    const servidor = { nome: "X velho", ncm: "222", preco_venda: 50 };
    const r = restaurarColunasTravadas(enviado, servidor, new Set(["nome", "ncm", "preco_venda"]), (c) => c);
    expect(r.descartadas.map((d) => d.coluna).sort()).toEqual(["ncm", "nome"]);
    expect(r.draft).toEqual({ nome: "X velho", ncm: "222", preco_venda: 50 });
  });
  it("sem trava (undefined) ou sem servidor (null/undefined): no-op, mesma referência", () => {
    const enviado = { nome: "X" };
    expect(restaurarColunasTravadas(enviado, { nome: "Y" }, undefined, (c) => c)).toEqual({ draft: enviado, descartadas: [] });
    expect(restaurarColunasTravadas(enviado, null, new Set(["nome"]), (c) => c)).toEqual({ draft: enviado, descartadas: [] });
  });
  it("coluna travada que não existe no Draft (sku/variantes/excluir): ignorada, sem quebrar", () => {
    const enviado = { nome: "X" };
    const servidor = { nome: "X" };
    const r = restaurarColunasTravadas(enviado, servidor, new Set(["sku", "variantes", "excluir"]), (c) => c);
    expect(r).toEqual({ draft: enviado, descartadas: [] });
  });
  it("fotos_modelo (array) — compara por VALOR, não por referência: arrays iguais não contam como divergência", () => {
    const enviado = { fotos_modelo: ["a.jpg", "b.jpg"] };
    const servidor = { fotos_modelo: ["a.jpg", "b.jpg"] }; // outra referência, mesmo conteúdo
    const r = restaurarColunasTravadas(enviado, servidor, new Set(["fotos_modelo"]), (c) => c);
    expect(r.descartadas).toEqual([]);
    expect(r.draft).toBe(enviado);
  });
  it("fotos_modelo divergente de verdade: restaura o array do servidor", () => {
    const enviado = { fotos_modelo: ["a.jpg", "NOVA.jpg"] };
    const servidor = { fotos_modelo: ["a.jpg"] };
    const r = restaurarColunasTravadas(enviado, servidor, new Set(["fotos_modelo"]), () => "Foto");
    expect(r.descartadas).toEqual([{ coluna: "fotos_modelo", rotulo: "Foto" }]);
    expect(r.draft).toEqual({ fotos_modelo: ["a.jpg"] });
  });
});

describe("Fix round 1 (I2/I-2) — toastDescartadasPelaIntegracao (texto PT)", () => {
  it("1 coluna: singular", () => {
    expect(toastDescartadasPelaIntegracao([{ coluna: "nome", rotulo: "Nome" }]))
      .toBe("Nome foi travado pela Integração enquanto você editava — essa alteração não foi salva.");
  });
  it("2+ colunas: plural, junta com 'e'", () => {
    expect(toastDescartadasPelaIntegracao([{ coluna: "nome", rotulo: "Nome" }, { coluna: "ncm", rotulo: "NCM" }]))
      .toBe("Nome e NCM foram travados pela Integração enquanto você editava — essa alteração não foi salva.");
  });
});

describe("Fix round 1 (I2/I-2) — usePlanejamentoSave.ts: captura ANTES do omit, restaura no onSuccess, avisa", () => {
  it("descartadasPelaTrava é calculado com restaurarColunasTravadas ANTES de omitirColunasTravadas apagar a chave", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    const idxRestaurar = s.indexOf("descartadasPelaTrava = restaurarColunasTravadas(d, baseRef.current?.draft, travaIntegracao");
    const idxOmitir = s.indexOf("omitirColunasTravadas(payload, travaIntegracao);");
    expect(idxRestaurar).toBeGreaterThan(-1);
    expect(idxOmitir).toBeGreaterThan(-1);
    expect(idxRestaurar).toBeLessThan(idxOmitir);
  });
  it("o resultado da mutation devolve descartadasPelaTrava", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    expect(s).toMatch(/consumoOuAviamento: bom\.gravar[\s\S]*?descartadasPelaTrava,\n\s*};/);
  });
  it("onSuccess restaura enviadoEfetivo/baseDoMerge com restaurarColunasTravadas e avisa com toast.warning ANTES de resetDraftBaseline", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    const idxRestauraEnviado = s.indexOf("restaurarColunasTravadas(enviadoEfetivo, baseAntesDoSave, travaIntegracao");
    const idxToast = s.indexOf("toast.warning(toastDescartadasPelaIntegracao(descartadasPelaTrava));");
    const idxResetBaseline = s.indexOf("resetDraftBaseline(enviadoEfetivo);");
    const idxBaseDoMerge = s.indexOf("descartadasPelaTrava.length > 0\n          ? Object.fromEntries");
    expect(idxRestauraEnviado).toBeGreaterThan(-1);
    expect(idxToast).toBeGreaterThan(-1);
    expect(idxResetBaseline).toBeGreaterThan(-1);
    expect(idxBaseDoMerge).toBeGreaterThan(-1);
    expect(idxRestauraEnviado).toBeLessThan(idxToast);
    expect(idxToast).toBeLessThan(idxResetBaseline);
    expect(idxResetBaseline).toBeLessThan(idxBaseDoMerge);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fix round 1 — m2/M-1 (revisões): a trava não pode ficar até 30s velha quando o Sheet abre; e um 42501
// `integracao_travado:` no Salvar tem que invalidar a query pro PRÓXIMO clique já vir certo.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Fix round 1 (m2/M-1) — refetch da trava ao abrir o Sheet e ao levar 42501", () => {
  it("useIntegracaoEstados usa refetchOnMount: 'always' (Sheet aberto de novo não fica com a trava stale até 30s)", () => {
    const s = ler("src/hooks/useIntegracaoEstado.ts");
    expect(s).toMatch(/refetchOnMount: "always"/);
  });
  it("usePlanejamentoSave.ts invalida ['integracao-estado'] no onError quando o code é 42501 e a mensagem começa com integracao_travado:", () => {
    const s = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
    expect(s).toMatch(/codigo === "42501" && mensagem\.startsWith\("integracao_travado:"\)/);
    expect(s).toMatch(/qc\.invalidateQueries\(\{ queryKey: \["integracao-estado"\] \}\);/);
    // A checagem tem que estar DENTRO do onError (antes do primeiro uso do onError, não em outro handler).
    const idxOnError = s.indexOf("onError: async (e: any) => {");
    const idxInvalidar = s.indexOf('qc.invalidateQueries({ queryKey: ["integracao-estado"] });');
    expect(idxOnError).toBeGreaterThan(-1);
    expect(idxInvalidar).toBeGreaterThan(idxOnError);
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
    expect(preco).toMatch(/mesmo travado pela Integração\./);
    expect(revenda).toMatch(/mesmo travado pela Integração\./);
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
