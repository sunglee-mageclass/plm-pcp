import { describe, it, expect } from "vitest";
import { agregar, gravaveis, temErroBloqueante } from "@/lib/import/aggregate";
import { alvosDeFoto } from "@/lib/import/foto-match";
import { aviamentoDescriptor } from "@/lib/import/entities/aviamento.descriptor";
import type { LookupMaps, RawRow, EntidadeAgregada } from "@/lib/import/types";

const EMP = "emp-silva";
const maps: LookupMaps = {
  cores: new Map([["preto", "cor-preto"], ["branco", "cor-branco"]]),
  apelidos: new Map([["cor-preto::grafite", "ap-grafite"]]),
  categorias: new Map([["ziper", "cat-ziper"]]),
  subcategorias: new Map([["metal", "sub-metal"]]),
  materiais: new Map([["poliester", "mat-poli"]]),
  intervalos: new Map([["10-20mm", "int-1020"]]),
  fornecedores: new Map([["aviamentos silva", [EMP]], ["duplicada", ["a", "b"]]]),
  representantes: new Map(),
};

function row(n: number, over: Partial<Record<string, string>> = {}): RawRow {
  return { __linha: n, nome: "", ...over } as RawRow;
}

describe("aviamentoDescriptor.resolve", () => {
  it("resolve cabeçalho (categoria/subcat/material/intervalo/fornecedor) + variante", () => {
    const r = aviamentoDescriptor.resolve(row(2, {
      nome: "Zíper Metal 20cm", categoria: "Zíper", subcategoria: "Metal", material: "Poliéster",
      fornecedor: "Aviamentos Silva", intervalo_largura: "10-20mm", preco: "2,50",
      cor_base: "Preto", cor_apelido: "Grafite",
    }), maps);
    expect(r.chave).toBe("ziper metal 20cm");
    expect(r.cabecalho.codigo_nome).toBe("Zíper Metal 20cm");
    expect(r.cabecalho.empresa_id).toBe(EMP);
    expect(r.cabecalho.categoria_aviamento_id).toBe("cat-ziper");
    expect(r.cabecalho.subcategoria_aviamento_id).toBe("sub-metal");
    expect(r.cabecalho.material_aviamento_id).toBe("mat-poli");
    expect(r.cabecalho.intervalo_largura_id).toBe("int-1020");
    expect(r.cabecalho.preco).toBe(2.5);
    expect(r.variantes[0].cor_id).toBe("cor-preto");
    expect(r.variantes[0].cor_apelido_id).toBe("ap-grafite");
    expect(r.problemas.filter((p) => p.nivel === "erro")).toHaveLength(0);
  });

  it("aviamento SEM cor = sem variante (cor é opcional)", () => {
    const r = aviamentoDescriptor.resolve(row(2, { nome: "Elástico 5cm", categoria: "Zíper" }), maps);
    expect(r.variantes).toHaveLength(0);
    expect(temErroBloqueante({ ...r } as EntidadeAgregada)).toBe(false);
  });

  it("cor base digitada mas inexistente = ERRO bloqueante", () => {
    const r = aviamentoDescriptor.resolve(row(2, { nome: "X", cor_base: "Roxo" }), maps);
    expect(r.problemas.some((p) => p.nivel === "erro" && p.campo === "cor_base")).toBe(true);
  });

  it("categoria não encontrada = AVISO (não bloqueia; código pode não gerar)", () => {
    const r = aviamentoDescriptor.resolve(row(2, { nome: "X", categoria: "Inexistente" }), maps);
    expect(r.problemas.some((p) => p.nivel === "aviso" && p.campo === "categoria")).toBe(true);
    expect(temErroBloqueante({ ...r } as EntidadeAgregada)).toBe(false);
  });

  it("foto por ENTIDADE: 1 alvo por aviamento (não por cor)", () => {
    const ag = agregar(aviamentoDescriptor, [row(2, { nome: "Zíper Metal", categoria: "Zíper", cor_base: "Preto" })], maps);
    const alvos = alvosDeFoto(aviamentoDescriptor, ag.entidades);
    expect(alvos).toHaveLength(1);
    expect(alvos[0].varIdx).toBeNull(); // modo entidade
    expect(alvos[0].chave).toBe("ziper metal");
  });
});

describe("gridColunas — tabela de análise genérica (regressão da revisão)", () => {
  it("aviamento tem gridColunas e nomeCampo=codigo_nome (nome não some/normaliza)", () => {
    expect(aviamentoDescriptor.nomeCampo).toBe("codigo_nome");
    expect(aviamentoDescriptor.gridColunas?.length).toBeGreaterThan(0);
    // toda gridColuna de lookup referencia um lookup que existe no descritor
    const lookupIds = new Set(aviamentoDescriptor.lookups.map((l) => l.id));
    for (const c of aviamentoDescriptor.gridColunas ?? []) {
      if (c.tipo === "lookup" || c.tipo === "multi-lookup") {
        if (c.lookupId) expect(lookupIds.has(c.lookupId)).toBe(true);
      }
    }
    // as colunas do aviamento incluem Categoria/Subcategoria/Material/Intervalo (campos próprios)
    const rotulos = (aviamentoDescriptor.gridColunas ?? []).map((c) => c.rotulo);
    expect(rotulos).toEqual(expect.arrayContaining(["Categoria", "Subcategoria", "Material", "Intervalo largura"]));
    // e NÃO tem Unidade/Mês/Ano (que são só do tecido)
    expect(rotulos).not.toContain("Unidade");
    expect(rotulos).not.toContain("Mês");
  });
});

describe("aviamentoDescriptor.analisarBanco (upsert)", () => {
  const fakeSb = (avs: unknown[]) => ({ from: () => ({ select: async () => ({ data: avs, error: null }) }) }) as never;
  async function analisar(linhas: RawRow[], avs: unknown[]) {
    const ag = agregar(aviamentoDescriptor, linhas, maps);
    await aviamentoDescriptor.analisarBanco!(fakeSb(avs), ag.entidades);
    return ag.entidades;
  }

  it("nome+fornecedor inexistentes = novo", async () => {
    const [e] = await analisar([row(2, { nome: "Botão Novo", fornecedor: "Aviamentos Silva" })], []);
    expect(e.estado).toBe("novo");
    expect(e.artigoAlvoId).toBeNull();
  });

  it("mesmo nome+fornecedor, cor nova = complementar", async () => {
    const avs = [{ id: "av-1", codigo_nome: "Zíper Metal", empresa_id: EMP, foto_url: "x",
      empresas: { nome_fantasia: "Aviamentos Silva" }, variantes_aviamento: [{ cor_id: "cor-branco", cor_apelido_id: null }] }];
    const [e] = await analisar([row(2, { nome: "Zíper Metal", fornecedor: "Aviamentos Silva", cor_base: "Preto" })], avs);
    expect(e.estado).toBe("complementar");
    expect(e.artigoAlvoId).toBe("av-1");
  });

  it("nome existe com fornecedor DIFERENTE = conflito_fornecedor", async () => {
    const avs = [{ id: "av-9", codigo_nome: "Zíper Metal", empresa_id: "outro", foto_url: null,
      empresas: { nome_fantasia: "Outro Forn" }, variantes_aviamento: [] }];
    const [e] = await analisar([row(2, { nome: "Zíper Metal", fornecedor: "Aviamentos Silva" })], avs);
    expect(e.estado).toBe("conflito_fornecedor");
    expect(e.fornecedorExistenteNome).toBe("Outro Forn");
  });

  it("mesmo aviamento sem foto no banco + veio foto = so_foto", async () => {
    const avs = [{ id: "av-1", codigo_nome: "Botão X", empresa_id: EMP, foto_url: null,
      empresas: { nome_fantasia: "Aviamentos Silva" }, variantes_aviamento: [] }];
    // sem variante nova (aviamento sem cor), foto do item vazia → so_foto
    const [e] = await analisar([row(2, { nome: "Botão X", fornecedor: "Aviamentos Silva" })], avs);
    expect(e.estado).toBe("so_foto");
  });
});
