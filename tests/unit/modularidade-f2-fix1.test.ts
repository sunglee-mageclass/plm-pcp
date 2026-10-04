// [modularidade F2, fix round 1] Importar: `tipo` do Produto por loja (Ruling R9) e o editor de permissões (comportamento puro).
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { descritorDaLoja, descritoresDaLoja, tiposProdutoOferecidos, moduloQueFalta } from "@/lib/import/oferta";
import { produtoDescriptor } from "@/lib/import/entities/produto.descriptor";
import { DESCRIPTORS } from "@/lib/import/registry";
import { parseAba, headerComOpcoes } from "@/lib/import/parse";
import { baixarTemplate as _t, gerarTemplateWorkbook } from "@/lib/import/template";
import type { EntidadeAgregada, LookupMaps, RawRow } from "@/lib/import/types";
import { PAGES_CATALOG, ALL_PAGE_KEYS, paginaComModuloDesligado } from "@/lib/permissions-catalog";
import { resolverModulos } from "@/hooks/useTenantModules";
import { marcarTodosNoModulo, voltarAoPapelEstado, montarPermsPayload, PERM_VAZIA, type PermState } from "@/lib/permissoes-estado";

void _t;

const SO_PA = { produto_acabado: true };
const SO_PI = { produto_importado: true };
const AMBOS = { produto_acabado: true, produto_importado: true };

const MAPS: LookupMaps = {
  grupos: new Map([["roupas", "g1"]]),
  categorias: new Map([["camisa", "c1"]]),
  sub1: new Map(), sub2: new Map(), colecoes: new Map(), cores: new Map(), apelidos: new Map(),
  fornecedores: new Map(), representantes: new Map(), tamanhos: new Map(),
};
const linha = (tipo: string): RawRow => ({ __linha: 2, tipo, nome: "Camisa X", grupo: "Roupas", categoria: "Camisa" } as RawRow);
const errosTipo = (ps: { nivel: string; campo?: string }[]) => ps.filter((p) => p.nivel === "erro" && p.campo === "tipo");

describe("R9 — Importar: `tipo` do Produto por loja", () => {
  it("tiposProdutoOferecidos", () => {
    expect(tiposProdutoOferecidos(SO_PA)).toEqual(["revenda"]);
    expect(tiposProdutoOferecidos(SO_PI)).toEqual(["importado"]);
    expect(tiposProdutoOferecidos(AMBOS)).toEqual(["revenda", "importado"]);
    expect(tiposProdutoOferecidos({})).toEqual([]);
  });

  it("só PA: opções/hint/exemplo da coluna tipo filtrados; os dois módulos = o descritor de sempre", () => {
    const col = descritorDaLoja(produtoDescriptor, SO_PA).colunas.find((c) => c.key === "tipo")!;
    expect(col.opcoes).toEqual(["Revenda"]);
    expect(col.hint).toBe("revenda");
    expect(col.exemplo).toBe("revenda");
    expect(descritorDaLoja(produtoDescriptor, AMBOS)).toBe(produtoDescriptor);
    const colPi = descritorDaLoja(produtoDescriptor, SO_PI).colunas.find((c) => c.key === "tipo")!;
    expect(colPi.opcoes).toEqual(["Importado"]);
    expect(colPi.exemplo).toBe("importado");
  });

  it("só PA: linha 'importado' dá ERRO de módulo no resolve; 'revenda' e tipo inválido seguem como antes", () => {
    const d = descritorDaLoja(produtoDescriptor, SO_PA);
    const imp = d.resolve(linha("Importado"), MAPS);
    expect(errosTipo(imp.problemas).map((p) => (p as any).mensagem)).toEqual([
      "O módulo Produto Importado não está ligado nesta loja — esta linha (Importado) não pode ser importada.",
    ]);
    expect(errosTipo(d.resolve(linha("revenda"), MAPS).problemas)).toEqual([]);
    // inválido: só o erro original (sem o de módulo)
    expect(errosTipo(d.resolve(linha("xyz"), MAPS).problemas)).toHaveLength(1);
  });

  it("o erro sobrevive ao revalidar (que substitui `problemas` a cada edição de célula)", () => {
    const d = descritorDaLoja(produtoDescriptor, SO_PA);
    const ent = { ...d.resolve(linha("importado"), MAPS), chave: "importado::camisa x", variantes: [] } as unknown as EntidadeAgregada;
    expect(errosTipo(d.revalidar!(ent))).toHaveLength(1);
    // depois de "editar" outra coluna (revalidar de novo sobre o resultado)
    const ent2 = { ...ent, problemas: d.revalidar!(ent) } as EntidadeAgregada;
    expect(errosTipo(d.revalidar!(ent2))).toHaveLength(1);
    // revenda numa loja só-PA: sem erro de tipo
    const ok = { ...d.resolve(linha("revenda"), MAPS), variantes: [] } as unknown as EntidadeAgregada;
    expect(errosTipo(d.revalidar!(ok))).toEqual([]);
  });

  it("só PI: revenda é que fica de fora (espelho)", () => {
    const d = descritorDaLoja(produtoDescriptor, SO_PI);
    expect(errosTipo(d.resolve(linha("revenda"), MAPS).problemas)).toHaveLength(1);
    expect(errosTipo(d.resolve(linha("importado"), MAPS).problemas)).toEqual([]);
  });

  it("descritoresDaLoja: só o Produto muda; os outros voltam iguais", () => {
    const lista = descritoresDaLoja(DESCRIPTORS, { criacao: true, ...SO_PA });
    for (const d of lista) if (d.entidade !== "produto") expect(d).toBe(DESCRIPTORS.find((x) => x.entidade === d.entidade));
    expect(lista.find((d) => d.entidade === "produto")).not.toBe(produtoDescriptor);
  });

  it("parser aceita o cabeçalho ANTIGO e o FILTRADO (e o limpo) para a coluna tipo", () => {
    const filtrado = descritorDaLoja(produtoDescriptor, SO_PA);
    const gera = (header: string) => {
      const ws = XLSX.utils.aoa_to_sheet([[header, "Nome"], ["Revenda", "Camisa X"]]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Produto");
      return wb;
    };
    for (const h of ["Tipo (Revenda | Importado) *", "Tipo (Revenda) *", "Tipo", "Tipo (Importado)"]) {
      for (const desc of [filtrado, produtoDescriptor]) {
        const r = parseAba(gera(h), "Produto", desc.colunas, "nome");
        expect(r.headersDesconhecidos, `${h}`).toEqual([]);
        expect(r.linhas[0]?.tipo, `${h}`).toBe("Revenda");
      }
    }
  });

  it("o modelo de planilha da loja só-PA escreve 'Tipo (Revenda)'", () => {
    const wb = gerarTemplateWorkbook(descritoresDaLoja(DESCRIPTORS, SO_PA));
    const cel = wb.Sheets["Produto"]["A1"].v;
    expect(cel).toBe(`${headerComOpcoes(descritorDaLoja(produtoDescriptor, SO_PA).colunas[0])} *`);
    expect(cel).toBe("Tipo (Revenda) *");
  });

  it("moduloQueFalta nomeia o módulo", () => {
    expect(moduloQueFalta("modelo")).toBe("Criação");
    expect(moduloQueFalta("produto")).toBe("Produto Acabado ou Produto Importado");
  });
});

// ─── Editor de permissões: comportamento (não texto-fonte) ───────────────────────────────────────────────────────────
describe("editor de permissões — página de módulo desligado nunca muda", () => {
  const modsSemES = resolverModulos({ otb: true, produto_acabado: true, entrada_saida: false });
  const desligada = (k: string) => paginaComModuloDesligado(k, modsSemES);
  const base = (): PermState => Object.fromEntries(ALL_PAGE_KEYS.map((k) => [k, { ...PERM_VAZIA }]));
  const mod = (m: string) => PAGES_CATALOG.find((x) => x.module === m);

  it("premissa: OC Tecido está esmaecida sem E&S; Planejamento não", () => {
    expect(desligada("entrada_oc_tecido")).toBe(true);
    expect(desligada("criacao_planejamento")).toBe(false);
  });

  it("'Voltar ao papel' mantém a exceção de OC Tecido (módulo desligado) e zera a de Criação; o Salvar seguinte ainda envia a linha", () => {
    // usuário: exceção positiva em OC Tecido (E&S off) e em Planejamento (Criação on); o papel não dá nenhuma
    const state = base();
    state["entrada_oc_tecido"] = { pode_ver: true, pode_editar: false };
    state["criacao_planejamento"] = { pode_ver: true, pode_editar: true };
    const papel = base(); // papel sem nada
    const depois = voltarAoPapelEstado(state, papel, ALL_PAGE_KEYS, desligada);
    expect(depois["entrada_oc_tecido"]).toEqual({ pode_ver: true, pode_editar: false }); // mantida
    expect(depois["criacao_planejamento"]).toEqual({ pode_ver: false, pode_editar: false }); // voltou ao papel
    const payload = montarPermsPayload(ALL_PAGE_KEYS, depois);
    expect(payload).toContainEqual({ pagina: "entrada_oc_tecido", pode_ver: true, pode_editar: false });
    expect(payload.find((p) => p.pagina === "criacao_planejamento")).toBeUndefined();
  });

  it("'Voltar ao papel' também mantém a REVOGAÇÃO que o papel concedia numa página desligada", () => {
    const state = base();
    const papel = base();
    papel["entrada_oc_tecido"] = { pode_ver: true, pode_editar: true }; // papel concede
    state["entrada_oc_tecido"] = { pode_ver: false, pode_editar: false }; // exceção negativa do usuário
    const depois = voltarAoPapelEstado(state, papel, ALL_PAGE_KEYS, desligada);
    expect(depois["entrada_oc_tecido"]).toEqual({ pode_ver: false, pode_editar: false });
  });

  it("'marcar todos' (liga e desliga, Leitor e Editor) não toca a página desligada", () => {
    const m = mod("entrada_saida")!;
    const state = base();
    state["entrada_oc_tecido"] = { pode_ver: true, pode_editar: false };
    let s = state;
    for (const [f, v] of [["pode_ver", true], ["pode_editar", true], ["pode_editar", false], ["pode_ver", false]] as const) {
      s = marcarTodosNoModulo(s, m, f, v, desligada);
      for (const p of m.pages) expect(s[p.key], `${f}=${v} ${p.key}`).toEqual(state[p.key]);
    }
  });

  it("'marcar todos' segue funcionando nas páginas LIGADAS (Criação) e respeita soEdicao", () => {
    const c = mod("criacao")!;
    const s = marcarTodosNoModulo(base(), c, "pode_editar", true, desligada);
    for (const p of c.pages) expect(s[p.key].pode_editar, p.key).toBe(!desligada(p.key)); // PI está desligado nesta loja
    const p = mod("pcp")!;
    const s2 = marcarTodosNoModulo(base(), p, "pode_ver", true, () => false);
    expect(s2["producao_servico_aprovacao"]).toEqual({ pode_ver: false, pode_editar: false }); // master Leitor ignora soEdicao
  });
});
