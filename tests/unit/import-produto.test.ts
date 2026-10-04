import { describe, it, expect } from "vitest";
import { produtoDescriptor } from "@/lib/import/entities/produto.descriptor";
import { agregar } from "@/lib/import/aggregate";
import type { EntidadeAgregada, LookupMaps, RawRow } from "@/lib/import/types";
import { descritorDaLoja } from "@/lib/import/oferta";

// grade tolerante: "38"/"P" → "38|P"
const gradeMap = new Map<string, string>();
for (const k of ["38|P", "40|M", "42|G"]) {
  const [n, s] = k.split("|");
  gradeMap.set(k.toLowerCase(), k);
  gradeMap.set(n.toLowerCase(), k);
  gradeMap.set(s.toLowerCase(), k);
}

const maps: LookupMaps = {
  grupos: new Map([["roupas", "grp-roupas"]]),
  categorias: new Map([["camisa", "cat-camisa"]]),
  sub1: new Map([["manga longa", "sub1-ml"]]),
  sub2: new Map(),
  colecoes: new Map([["verao", "col-verao"]]),
  cores: new Map([["azul", "cor-azul"], ["preto", "cor-preto"]]),
  apelidos: new Map([["cor-azul::royal", "ap-royal"]]),
  fornecedores: new Map([["silva", ["emp-silva"]]]),
  representantes: new Map(),
  tamanhos: gradeMap,
};

function row(n: number, over: Partial<Record<string, string>> = {}): RawRow {
  return { __linha: n, nome: "", ...over } as RawRow;
}

describe("produtoDescriptor.resolve — ramo por tipo", () => {
  it("REVENDA: núcleo + preço BRL; sem campos de câmbio", () => {
    const r = produtoDescriptor.resolve(row(2, {
      tipo: "revenda", nome: "Camisa", grupo: "Roupas", categoria: "Camisa",
      grade: "P:1, M:2, G:1", qtd_total: "40", valor_unitario: "29,90", markup_varejo: "2,2",
      cor_base: "Azul", peso: "1", qtd: "40",
    }), maps);
    expect(r.problemas.some((p) => p.nivel === "erro")).toBe(false);
    expect(r.cabecalho.tipo).toBe("revenda");
    expect(r.cabecalho.grupo_id).toBe("grp-roupas");
    expect(r.cabecalho.categoria_id).toBe("cat-camisa");
    expect(r.cabecalho.valor_unitario).toBe(29.9);
    expect(r.cabecalho.markup_varejo).toBe(2.2);
    expect(r.cabecalho.grade_proporcao).toEqual({ "38|P": 1, "40|M": 2, "42|G": 1 });
    expect(r.cabecalho).not.toHaveProperty("moeda_compra");
    expect(r.variantes).toHaveLength(1);
    expect(r.variantes[0].cor_id).toBe("cor-azul");
    expect(r.variantes[0].qtd).toBe(40);
  });

  it("IMPORTADO: núcleo + câmbio; moeda resolvida; sem valor_unitario BRL", () => {
    const r = produtoDescriptor.resolve(row(2, {
      tipo: "importado", nome: "Bolsa", grupo: "Roupas", categoria: "Camisa",
      moeda_compra: "USD", valor_unitario_m1: "3,5", cotacao_ref: "5,10",
      data_pedido: "15/01/2026", cor_base: "Preto", qtd: "10",
    }), maps);
    expect(r.cabecalho.tipo).toBe("importado");
    expect(r.cabecalho.moeda_compra).toBe("USD");
    expect(r.cabecalho.valor_unitario_m1).toBe(3.5);
    expect(r.cabecalho.cotacao_ref).toBe(5.1);
    expect(r.cabecalho.data_pedido).toBe("2026-01-15");
    expect(r.cabecalho).not.toHaveProperty("valor_unitario");
  });

  it("moeda por NOME ('dólar') resolve para USD", () => {
    const r = produtoDescriptor.resolve(row(2, { tipo: "importado", nome: "X", grupo: "Roupas", categoria: "Camisa", moeda_compra: "Dólar americano" }), maps);
    expect(r.cabecalho.moeda_compra).toBe("USD");
  });

  it("tipo inválido = ERRO bloqueante", () => {
    const r = produtoDescriptor.resolve(row(2, { tipo: "modelo", nome: "X", grupo: "Roupas", categoria: "Camisa" }), maps);
    expect(r.problemas.some((p) => p.nivel === "erro" && p.campo === "tipo")).toBe(true);
  });

  it("grupo/categoria não resolvidos = ERRO", () => {
    const r = produtoDescriptor.resolve(row(2, { tipo: "revenda", nome: "X", grupo: "Inexistente", categoria: "Nada" }), maps);
    expect(r.problemas.some((p) => p.nivel === "erro" && p.campo === "grupo")).toBe(true);
    expect(r.problemas.some((p) => p.nivel === "erro" && p.campo === "categoria")).toBe(true);
  });

  it("apelido resolve pela cor base; apelido errado = ERRO", () => {
    const ok = produtoDescriptor.resolve(row(2, { tipo: "revenda", nome: "X", grupo: "Roupas", categoria: "Camisa", cor_base: "Azul", cor_apelido: "Royal" }), maps);
    expect(ok.variantes[0].cor_apelido_id).toBe("ap-royal");
    const err = produtoDescriptor.resolve(row(2, { tipo: "revenda", nome: "X", grupo: "Roupas", categoria: "Camisa", cor_base: "Preto", cor_apelido: "Royal" }), maps);
    expect(err.problemas.some((p) => p.nivel === "erro" && p.campo === "cor_apelido")).toBe(true);
  });

  it("grade: tamanho fora da grade = aviso (ignorado)", () => {
    const r = produtoDescriptor.resolve(row(2, { tipo: "revenda", nome: "X", grupo: "Roupas", categoria: "Camisa", grade: "P:1, XG:3" }), maps);
    expect(r.cabecalho.grade_proporcao).toEqual({ "38|P": 1 });
    expect(r.problemas.some((p) => p.nivel === "aviso" && /XG/.test(p.mensagem))).toBe(true);
  });

  it("acessório sem grade: grade_proporcao vazia (usa só qtd)", () => {
    const r = produtoDescriptor.resolve(row(2, { tipo: "revenda", nome: "Cinto", grupo: "Roupas", categoria: "Camisa", qtd_total: "12" }), maps);
    expect(r.cabecalho.grade_proporcao).toEqual({});
    expect(r.cabecalho.qtd_total).toBe(12);
  });
});

describe("produtoDescriptor — agregação por nome (variantes de N linhas)", () => {
  it("mesmo produto, 2 cores em 2 linhas = 1 entidade, 2 variantes", () => {
    const linhas = [
      row(2, { tipo: "revenda", nome: "Camisa", grupo: "Roupas", categoria: "Camisa", cor_base: "Azul", qtd: "20" }),
      row(3, { tipo: "revenda", nome: "Camisa", grupo: "Roupas", categoria: "Camisa", cor_base: "Preto", qtd: "20" }),
    ];
    const ag = agregar(produtoDescriptor, linhas, maps);
    expect(ag.entidades).toHaveLength(1);
    expect(ag.entidades[0].variantes).toHaveLength(2);
  });

  // Regressão da revisão (MEDIUM): mesmo NOME, TIPOS diferentes = 2 entidades separadas
  // (a chave natural inclui o tipo — sem isso, o 2º se perderia na fusão).
  it("mesmo nome, tipos diferentes = 2 entidades (não funde revenda com importado)", () => {
    const linhas = [
      row(2, { tipo: "revenda", nome: "Camisa X", grupo: "Roupas", categoria: "Camisa", cor_base: "Azul", qtd: "10" }),
      row(3, { tipo: "importado", nome: "Camisa X", grupo: "Roupas", categoria: "Camisa", cor_base: "Preto", qtd: "10" }),
    ];
    const ag = agregar(produtoDescriptor, linhas, maps);
    expect(ag.entidades).toHaveLength(2);
    const tipos = ag.entidades.map((e) => e.cabecalho.tipo).sort();
    expect(tipos).toEqual(["importado", "revenda"]);
  });
});

// [modularidade R12] Bug pré-existente: o resolve gravava o fallback "revenda" no cabeçalho de um tipo inválido, então o
// `revalidar` (roda a cada edição de célula e SUBSTITUI `problemas`) deixava de ver o erro e a linha virava revenda.
describe("R12 — tipo inválido/sem módulo continua erro depois das edições de célula (nunca vira revenda)", () => {
  const base = { nome: "Camisa X", grupo: "Roupas", categoria: "Camisa" };
  const errosTipo = (ps: { nivel: string; campo?: string }[]) => ps.filter((p) => p.nivel === "erro" && p.campo === "tipo");
  /** Simula N edições de célula: cada uma refaz `problemas` pelo revalidar, como a tela de revisão faz. */
  const editaVezes = (desc: typeof produtoDescriptor, ent: EntidadeAgregada, n: number): EntidadeAgregada => {
    let atual = ent;
    for (let i = 0; i < n; i++) atual = { ...atual, problemas: desc.revalidar!(atual) };
    return atual;
  };
  const entidadeDe = (desc: typeof produtoDescriptor, tipo: string) => {
    const ag = agregar(desc, [row(2, { tipo, ...base })], maps);
    return ag.entidades[0];
  };

  it("tipo digitado inválido ('xyz', vazio, 'modelo'): o cabeçalho NÃO vira 'revenda' e o erro sobrevive a várias edições", () => {
    for (const tipo of ["xyz", "", "modelo"]) {
      const ent = entidadeDe(produtoDescriptor, tipo);
      expect(ent.cabecalho.tipo, `tipo='${tipo}'`).not.toBe("revenda");
      expect(errosTipo(ent.problemas), `resolve '${tipo}'`).toHaveLength(1);
      for (const n of [1, 2, 3]) expect(errosTipo(editaVezes(produtoDescriptor, ent, n).problemas), `'${tipo}' após ${n} edição(ões)`).toHaveLength(1);
    }
  });

  it("tipo válido segue limpo depois das edições (revenda e importado)", () => {
    for (const tipo of ["revenda", "Importado", " REVENDA "]) {
      const ent = entidadeDe(produtoDescriptor, tipo);
      expect(errosTipo(editaVezes(produtoDescriptor, ent, 3).problemas), tipo).toEqual([]);
    }
    expect(entidadeDe(produtoDescriptor, "Importado").cabecalho.tipo).toBe("importado");
  });

  it("loja só com Produto Acabado: linha 'Importado' guarda 'importado' (não 'revenda') e continua erro após as edições", () => {
    const d = descritorDaLoja(produtoDescriptor, { produto_acabado: true });
    const ent = entidadeDe(d, "Importado");
    expect(ent.cabecalho.tipo).toBe("importado");
    expect(errosTipo(ent.problemas)).toHaveLength(1);
    expect(errosTipo(editaVezes(d, ent, 3).problemas)).toHaveLength(1);
  });

  it("o resolve segue montando o ramo de revenda p/ tipo inválido (sem quebrar) e a RPC se recusa a importar tipo inválido", async () => {
    const ent = entidadeDe(produtoDescriptor, "xyz");
    expect(ent.cabecalho).toHaveProperty("valor_unitario"); // ramo revenda só p/ não quebrar o resolve
    let chamou = false;
    const sb = { rpc: async () => { chamou = true; return { data: { acao: "criado" }, error: null }; } };
    await expect(produtoDescriptor.rpc!(sb as never, ent)).rejects.toThrow(/inválido/);
    expect(chamou).toBe(false);
  });
});
