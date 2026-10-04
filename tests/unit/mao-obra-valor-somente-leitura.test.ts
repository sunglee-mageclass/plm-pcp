// Reforço de segurança S3c — P-244 = B: os VALORES de mão de obra só mudam por quem EDITA o Planejamento E vê custos
// (salvar_modelo_servico_mo, 20261101160000 → 42501 'mao_obra_sem_permissao:'). A tela espelha: no Sheet do Planejamento
// (`MaoObraEditor`) e nos cards de Produto Acabado/Importado (`MaoObraCardMini`) o valor vira texto e somem Adicionar/Remover
// para quem não passa — aprovar/reprovar continua (outra permissão, inv. 12). Render real (react-dom/server) + anti-drift da regra
// contra o SQL (_pode_ver_custos e a migration da S3c) + tradução dos 2 prefixos novos da S3c.
import { describe, it, expect, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { MaoObraEditor } from "@/components/planejamento/MaoObraEditor";
import { MaoObraCardMini } from "@/components/planejamento/MaoObraCardMini";
import { CHAVES_VER_CUSTOS, PAGINA_EDITAR_VALOR_MO, podeEditarValorMO, podeVerCustosServidor } from "@/lib/mao-obra";
import { mensagemErro, MENSAGENS_SEG_S3, rotuloPaginaPermissao } from "@/lib/erro-mensagem";
import { ALL_PAGE_KEYS } from "@/lib/permissions-catalog";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (dir: string, re: RegExp) =>
  readdirSync(ROOT + dir).filter((f) => re.test(f)).sort().map((f) => readFileSync(ROOT + dir + "/" + f, "utf8"));
const IDA = ler("supabase/migrations", /^202611011[6-8]0000_seg_s3c_.*\.sql$/).join("\n");
const VOLTA = ler("supabase/rollback", /^202611011[6-8]0000_seg_s3c_.*_down\.sql$/).join("\n");
const prefixos = (sql: string) => new Set([...sql.matchAll(/RAISE EXCEPTION '([a-z_]+): /g)].map((m) => m[1]));
const src = (rel: string) => readFileSync(ROOT + rel, "utf8");

const LINHAS = [{ id: "l1", categoria_terceirizado_id: "c1", valor: 12.5, aprovado: null }];
const CATS = [{ id: "c1", nome: "Costura", ativo: true, valor_padrao: null }];
const base = { linhas: LINHAS, categorias: CATS, podeVerCustos: true, podeAprovar: true, onChangeLinhas: () => {},
  onAprovar: () => {}, onReprovar: () => {}, linhasPersistidas: new Set(["l1"]), linhasBase: LINHAS } as any;

describe("M.O. — valor só para quem EDITA o Planejamento E vê custos (P-244 = B)", () => {
  for (const [nome, C] of [["MaoObraEditor (Sheet do Planejamento)", MaoObraEditor], ["MaoObraCardMini (cards PA/PI)", MaoObraCardMini]] as const) {
    it(`${nome}: quem pode digita/adiciona/remove; quem não pode vê o valor em texto e ainda aprova`, () => {
      const edita = renderToStaticMarkup(h(C as any, { ...base, podeEditarValor: true }));
      expect(edita).toContain("<input");
      expect(edita).toContain('aria-label="Remover"');
      expect(edita).not.toContain("mo-valor-leitura");
      const leitura = renderToStaticMarkup(h(C as any, { ...base, podeEditarValor: false }));
      expect(leitura).not.toContain("<input");
      expect(leitura).not.toContain('aria-label="Remover"');
      expect(leitura).not.toContain("Adicionar serviço");
      expect(leitura).toContain('data-testid="mo-valor-leitura"');
      expect(leitura).toContain("12,50");
      expect(leitura).toContain('aria-label="Aprovar"'); // aprovar/reprovar é outra permissão (inv. 12)
      expect(leitura).toContain('aria-label="Reprovar"');
    });
  }

  it("a regra = a do servidor: EDITAR o Planejamento E ver custos (qualquer chave do _pode_ver_custos)", () => {
    const perfil = (ed: string[], ve: string[]) => podeEditarValorMO((k) => ed.includes(k), (k) => ve.includes(k) || ed.includes(k));
    expect(perfil(["criacao_planejamento"], [])).toBe(false);                                   // sem custos
    expect(perfil(["criacao_desenvolvimento"], ["criacao_desenvolvimento:custos"])).toBe(false); // caso Alan (só Dev)
    expect(perfil(["criacao_produto_acabado"], ["criacao_planejamento:custos"])).toBe(false);    // só o card do PA
    expect(perfil(["criacao_produto_importado"], ["criacao_planejamento:custos"])).toBe(false);  // só o card do PI
    expect(perfil(["producao_servico_aprovacao"], ["criacao_planejamento:custos"])).toBe(false); // aprovador
    for (const k of CHAVES_VER_CUSTOS) expect(perfil(["criacao_planejamento"], [k]), k).toBe(true);
    expect(podeVerCustosServidor((k) => k === "criacao_planejamento")).toBe(false); // ver a página não é ver custos
  });

  it("anti-drift: CHAVES_VER_CUSTOS = as chaves do _pode_ver_custos() (última migration que o define) e a página = a da S3c", () => {
    const DEF = "CREATE OR REPLACE FUNCTION public._pode_ver_custos()";
    const defs = ler("supabase/migrations", /\.sql$/).filter((t) => t.includes(DEF));
    expect(defs.length).toBeGreaterThan(0);
    const ultima = defs[defs.length - 1];
    const corpo = ultima.slice(ultima.lastIndexOf(DEF));
    const fim = corpo.indexOf("$$", corpo.indexOf("$$") + 2);
    const chaves = [...corpo.slice(0, fim > 0 ? fim : undefined).matchAll(/user_can_view\('([a-z_:]+)'\)/g)].map((m) => m[1]);
    expect(chaves.sort()).toEqual([...CHAVES_VER_CUSTOS].sort());
    expect(IDA).toContain(`IF NOT (public.user_can_edit('${PAGINA_EDITAR_VALOR_MO}') AND public._pode_ver_custos()) THEN`);
  });

  it("as telas usam a regra (Sheet, cards PA/PI, Dev) e o Salvar não manda a M.O. sem ela", () => {
    expect(src("src/components/planejamento/PlanejamentoDetail.tsx")).toMatch(/const podeEditarMO = podeEditarValorMO\(canEdit, canView\);/);
    expect(src("src/components/planejamento/PlanejamentoDetail.tsx")).toMatch(/podeEditarValor=\{podeEditarMO\}/);
    expect(src("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts")).toMatch(/if \(podeEditarMO && \(podeVerCustos/);
    for (const f of ["src/components/produto-acabado/ProdutoCard.tsx", "src/components/produto-importado/ProdutoImportadoCard.tsx"]) {
      const t = src(f);
      expect(t, f).toMatch(/const podeVerCustosMO = podeVerCustosServidor\(canView\);/);
      expect(t, f).toMatch(/const podeEditarMO = podeEditarValorMO\(canEdit, canView\);/);
      expect(t, f).toMatch(/podeEditarValor=\{podeEditarMO\}/);
      expect(t, f).toMatch(/\{podeEditarMO && mo\.dirty && \(/);
    }
    expect(src("src/components/desenvolvimento/ModeloDetailPanel.tsx")).toMatch(/podeEditarValor=\{podeEditarValorMO\(canEdit, canView\)\}/);
  });
});

describe("S3c — mensagens e anti-drift banco × tela", () => {
  it("os 2 prefixos novos da S3c têm tradução PT (s3c_* = guardas de deploy)", () => {
    expect(IDA.length).toBeGreaterThan(0);
    const antes = prefixos(VOLTA);
    expect([...prefixos(IDA)].filter((p) => !antes.has(p) && !p.startsWith("s3c_")).sort()).toEqual(["loja_diferente", "mao_obra_sem_permissao"]);
    expect(mensagemErro({ code: "42501", message: "mao_obra_sem_permissao: editar criacao_planejamento e ver custos" }, "fb"))
      .toBe(MENSAGENS_SEG_S3.mao_obra_sem_permissao);
    for (const col of ["modelo_id", "etiqueta_id", "cor_id"]) {
      expect(mensagemErro({ code: "P0001", message: `loja_diferente: ${col}` }, "fb")).toBe(MENSAGENS_SEG_S3.loja_diferente);
      expect(IDA).toContain(`RAISE EXCEPTION 'loja_diferente: ${col}' USING ERRCODE = 'P0001'`);
    }
  });
  it("toda chave passada ao _seg_exige_pagina na S3c existe no catálogo e tem rótulo", () => {
    const chamadas = [...IDA.matchAll(/_seg_exige_pagina\(([^;]*)\);/g)].map((m) => m[1]);
    expect(chamadas.length).toBeGreaterThanOrEqual(10 + 2);
    const chaves = new Set(chamadas.flatMap((a) => [...a.matchAll(/'([a-z0-9_:]+)'/g)].map((m) => m[1])).filter((k) => k.includes("_")));
    expect(chaves.size).toBeGreaterThanOrEqual(4);
    for (const k of chaves) {
      expect(ALL_PAGE_KEYS, k).toContain(k);
      expect(rotuloPaginaPermissao(k).modulo, k).not.toBe("");
    }
  });
});
