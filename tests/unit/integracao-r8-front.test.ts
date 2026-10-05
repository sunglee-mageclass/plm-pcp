// @vitest-environment happy-dom
// R8 front (urg, lane 2): Manual da API amarrado ao espelho TS do título da sublinha, aviso "sublinhas" cita o título e
// aparece na coluna Título, e o Título da sublinha é SOMENTE LEITURA (calculado no servidor; nada de input na sublinha).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CAMPO_BY_KEY } from "@/lib/integracao/campos";
import { AVISO_SUBLINHAS, avisoSublinhas, colunaAvisoSublinhas, lerLista, type ProdutoLista } from "@/lib/integracao/produtos";
import { novoRascunho } from "@/lib/integracao/rascunho";
import { montarManual, respostaExemplo, TEXTO_TITULO_SUBLINHA } from "@/components/integracao/manual-conteudo";
import { tituloSublinha } from "@/lib/integracao/titulo-sublinha";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canView: () => true }) }));
vi.mock("@/hooks/useTenantBranding", () => ({ useTenantBranding: () => ({ nome: "Loja Teste" }) }));
const { CelulaCampo } = await import("@/components/integracao/CelulaCampo");

const ler = (p: string) => readFileSync(process.cwd() + "/" + p, "utf8");
const c = (k: string) => CAMPO_BY_KEY.get(k as never)!;
const g = (ok: boolean) => ({ ok, motivo: null });

describe("M1 — exemplo do Manual: o título da variante vem do espelho TS (não é hard-coded)", () => {
  it("TESTE: variante = título do produto + cor base (mesmo literal da fixture de _integracao_exemplo)", () => {
    const p = respostaExemplo("teste", "https://site").produtos[0];
    expect(p.titulo).toBe("Produto Exemplo 1 - exemplo");
    expect(p.variantes[0].titulo).toBe(tituloSublinha(p.titulo as string, p.variantes[0].cor_base as string, p.variantes[0].cor_apelido as string, "cor_base"));
    expect(p.variantes[0].titulo).toBe("Produto Exemplo 1 - exemplo Cor Exemplo");
  });
  it("NORMAL: variante = título do produto + cor base, e nunca igual ao do produto", () => {
    const p = respostaExemplo("normal", "https://site").produtos[0];
    expect(p.variantes[0].titulo).toBe(tituloSublinha(p.titulo as string, p.variantes[0].cor_base as string, null, "cor_base"));
    expect(p.variantes[0].titulo).toBe("Saia Marola Godê Preto");
    expect(p.variantes[0].titulo).not.toBe(p.titulo);
  });
  it("o Manual não carrega o título da variante escrito à mão: usa tituloSublinha", () => {
    expect(ler("src/components/integracao/manual-conteudo.ts")).toMatch(/tituloSublinha\(/);
  });
});

describe("Fix round 1 — o Manual publica o texto do título da sublinha (B1/B2)", () => {
  it("montarManual inclui TEXTO_TITULO_SUBLINHA", () => {
    expect(JSON.stringify(montarManual("https://site", null))).toContain(TEXTO_TITULO_SUBLINHA);
  });
  it("o texto diz qual cor entra: a mesma do nome da variante (cor base ou apelido, por Config da Loja)", () => {
    expect(TEXTO_TITULO_SUBLINHA).toMatch(/Cor base/);
    expect(TEXTO_TITULO_SUBLINHA).toMatch(/Apelido/);
    expect(TEXTO_TITULO_SUBLINHA).toMatch(/mesma cor do nome da variante/);
  });
});

describe("B3 — texto do aviso de sublinhas cita o título", () => {
  it("AVISO_SUBLINHAS menciona título (e segue mencionando SKU, cor, tamanho, nome)", () => {
    expect(AVISO_SUBLINHAS).toMatch(/título/);
    for (const w of ["SKU", "cor", "tamanho", "nome"]) expect(AVISO_SUBLINHAS).toContain(w);
  });
});

function produtoComSublinha(o: Record<string, unknown> = {}): ProdutoLista {
  return lerLista({
    campos: [],
    produtos: [{
      modelo_id: "m1", origem: "interno", estado: "nao_integravel", rev: 1,
      raw: { nome: "Blusa Teste", ref: "BLTS0001", tamanho_tipo: "letra" },
      gates: { compartilhado: g(true), planejamento: g(true), preco: g(true), ref: g(true), sku: g(true), keywords: g(true) },
      vivo: {
        campos: ["titulo"],
        linhas: [{ tipo: "variante", ordem: 1, variante_key: "v1", tamanho_key: "P", valores: { titulo: "Blusa Teste Azul | Loja" } }],
      },
      sublinhas: [{
        variante_key: "v1", tamanho_key: "P", variante_ordem: 1, tamanho_ordem: 1,
        cor_nome: "Azul", apelido_nome: null, tamanho: "P", sku_id: "sku-1", sku: "BLTS0001-AZ-P", sku_rev: 3, manual: false,
      }],
      ...o,
    }],
  }).produtos[0];
}
function montar(campo: string, pr: ProdutoLista, avisoEm?: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(CelulaCampo, {
      campo: c(campo), produto: pr, indice: 0, rascunho: novoRascunho(pr), previa: undefined, salvando: false,
      onAtualizar: () => {}, onKeywords: () => {}, onFotos: () => {},
      colunaAvisoSublinhas: avisoEm,
    }));
  });
  return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}
const retrato = { campos: ["titulo"], linhas: [{ tipo: "variante", ordem: 1, variante_key: "v1", tamanho_key: "P", valores: { titulo: "Blusa Teste Azul | Loja" } }] };
const ARIA = "[aria-label='Sublinhas mudaram depois do retrato']";

describe("B4 — o 'i' de sublinhas também aparece na coluna Título da sublinha", () => {
  it("retrato_difere com 'sublinhas': a célula Título da sublinha mostra o 'i' com o texto", () => {
    const pr = produtoComSublinha({ estado: "integrado", retrato, retrato_difere: ["sublinhas"] });
    expect(avisoSublinhas(pr)).toBe(AVISO_SUBLINHAS);
    const v = montar("titulo", pr);
    expect(v.container.querySelector(ARIA)).not.toBeNull();
    v.unmount();
  });
  it("sem 'sublinhas' em retrato_difere: nenhum aviso na célula Título da sublinha", () => {
    const v = montar("titulo", produtoComSublinha({ estado: "integrado", retrato, retrato_difere: [] }));
    expect(v.container.querySelector(ARIA)).toBeNull();
    v.unmount();
  });
});

describe("Fix round 1 (B3) — o 'i' de sublinhas aparece UMA vez por linha", () => {
  it("colunaAvisoSublinhas: a 1ª coluna exibida entre REF/SKU e Título (ordem da tabela); nenhuma → null", () => {
    expect(colunaAvisoSublinhas(["nome", "ref_sku", "titulo"])).toBe("ref_sku");
    expect(colunaAvisoSublinhas(["titulo", "nome", "ref_sku"])).toBe("titulo");
    expect(colunaAvisoSublinhas(["nome", "titulo"])).toBe("titulo");
    expect(colunaAvisoSublinhas(["nome", "ref_sku"])).toBe("ref_sku");
    expect(colunaAvisoSublinhas(["nome", "peso"])).toBeNull();
  });
  it("com as 2 colunas exibidas, só a célula escolhida desenha o 'i'", () => {
    const pr = produtoComSublinha({ estado: "integrado", retrato, retrato_difere: ["sublinhas"] });
    const tit = montar("titulo", pr, "ref_sku");
    expect(tit.container.querySelector(ARIA)).toBeNull();
    tit.unmount();
    const sku = montar("ref_sku", pr, "ref_sku");
    expect(sku.container.querySelectorAll(ARIA)).toHaveLength(1);
    sku.unmount();
    const tit2 = montar("titulo", pr, "titulo");
    expect(tit2.container.querySelectorAll(ARIA)).toHaveLength(1);
    tit2.unmount();
  });
});

describe("Concern 5 — Título da sublinha é calculado e SOMENTE LEITURA", () => {
  it("renderiza o título calculado do servidor, sem input/textarea/botão de edição (produto editável)", () => {
    const v = montar("titulo", produtoComSublinha());
    expect(v.container.textContent).toContain("Blusa Teste Azul | Loja");
    expect(v.container.querySelector("input, textarea, select, [contenteditable]")).toBeNull();
    v.unmount();
  });
  it("fonte: CelulaTitulo (editável) só é montada na linha do produto; CelulaSublinha não tem caminho de edição do título", () => {
    const src = ler("src/components/integracao/CelulaCampo.tsx");
    const iSub = src.indexOf("if (indice !== null)");
    const iTit = src.indexOf("<CelulaTitulo ");
    expect(iSub).toBeGreaterThan(-1);
    expect(iTit).toBeGreaterThan(iSub); // a única montagem vem depois do return da sublinha
    expect(src.match(/<CelulaTitulo /g)).toHaveLength(1);
    const ini = src.indexOf("function CelulaSublinha(");
    const fim = src.indexOf("/** Quanto tempo esperar");
    const corpo = src.slice(ini, fim);
    expect(corpo).not.toMatch(/editarTitulo|sairTitulo|<CelulaTitulo|<input|<Input|<Textarea/);
  });
  it("fonte: o rascunho não tem campo de título por sublinha", () => {
    const rasc = ler("src/lib/integracao/rascunho.ts");
    expect(rasc).not.toMatch(/titulos?Sub|tituloSublinha|sublinhaTitulo/i);
  });
});
