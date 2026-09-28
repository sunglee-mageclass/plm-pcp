import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { colunasTravadas, lerEstados, textoExcluirTravado, textoSelo } from "@/lib/integracao/trava";
import { omitirColunasTravadas } from "@/components/planejamento/planejamento-detail/usePlanejamentoSave";

const ler = (p: string) => readFileSync(p, "utf8");

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
