import { describe, it, expect } from "vitest";
import { modeloDescriptor } from "@/lib/import/entities/modelo.descriptor";
import { agregar } from "@/lib/import/aggregate";
import type { LookupMaps, RawRow } from "@/lib/import/types";

const gradeMap = new Map<string, string>();
for (const k of ["38|P", "40|M", "42|G"]) {
  const [n, s] = k.split("|");
  gradeMap.set(k.toLowerCase(), k);
  gradeMap.set(n.toLowerCase(), k);
  gradeMap.set(s.toLowerCase(), k);
}

const maps: LookupMaps = {
  categorias: new Map([["camisa", "cat-camisa"]]),
  sub1: new Map(), sub2: new Map(),
  colecoes: new Map([["verao", "col-verao"]]),
  linhas: new Map([["basica", "linha-basica"]]),
  meses: new Map(), anos: new Map(),
  cores: new Map([["azul", "cor-azul"], ["branco", "cor-branco"]]),
  apelidos: new Map([["cor-azul::royal", "ap-royal"]]),
  artigos: new Map([["malha fiore", "art-malha"], ["forro x", "art-forro"]]),
  aviamentos: new Map([["botao 15mm", "avi-botao"]]),
  etiquetas: new Map([["etiqueta lavagem", "etq-lav"]]),
  servicos: new Map([["costura", "svc-costura"]]),
  // variante de tecido: chave "artigo::cor::apelido"
  variantesTecido: new Map([
    ["art-malha::cor-azul::", "var-malha-azul"],
    ["art-malha::cor-azul::ap-royal", "var-malha-royal"],
    ["art-forro::cor-branco::", "var-forro-branco"],
  ]),
  tamanhos: gradeMap,
};

function row(n: number, over: Partial<Record<string, string>> = {}): RawRow {
  return { __linha: n, nome: "", ...over } as RawRow;
}

describe("modeloDescriptor — linhas-filhas agregam BOM por nome do modelo", () => {
  it("modelo + tecido + aviamento + insumo + servico = 1 entidade com BOM completo", () => {
    const linhas = [
      row(2, { tipo_linha: "modelo", nome: "Camisa X", categoria: "Camisa", colecao: "Verao", linha: "Basica", grade: "P:16, M:16, G:8", preco_venda: "199,90" }),
      row(3, { tipo_linha: "tecido", nome: "Camisa X", material: "Malha Fiore", cor_base: "Azul", consumo: "1,5" }),
      row(4, { tipo_linha: "aviamento", nome: "Camisa X", material: "Botao 15mm", consumo: "6" }),
      row(5, { tipo_linha: "insumo", nome: "Camisa X", material: "Etiqueta Lavagem", cor_base: "Branco", consumo: "1" }),
      row(6, { tipo_linha: "servico", nome: "Camisa X", material: "Costura", valor: "5,50" }),
    ];
    const ag = agregar(modeloDescriptor, linhas, maps);
    expect(ag.entidades).toHaveLength(1);
    const cab = ag.entidades[0].cabecalho as Record<string, unknown>;
    // cabeçalho
    expect(cab.nome).toBe("Camisa X");
    expect(cab.categoria_principal_id).toBe("cat-camisa");
    expect(cab.colecao_id).toBe("col-verao");
    expect(cab.linha_id).toBe("linha-basica");
    expect(cab.preco_venda).toBe(199.9);
    // BOM
    expect((cab._tecidos as unknown[]).length).toBe(1);
    expect((cab._aviamentos as unknown[]).length).toBe(1);
    expect((cab._etiquetas as unknown[]).length).toBe(1);
    expect((cab._servicos as unknown[]).length).toBe(1);
    // grade
    expect((cab._grades as { grade_total: number }[])[0].grade_total).toBe(40);
    // sem erro bloqueante
    expect(ag.entidades[0].problemas.some((p) => p.nivel === "erro")).toBe(false);
  });

  it("tecido resolve variante por artigo+cor+apelido", () => {
    const linhas = [
      row(2, { tipo_linha: "modelo", nome: "M", categoria: "Camisa" }),
      row(3, { tipo_linha: "tecido", nome: "M", material: "Malha Fiore", cor_base: "Azul", cor_apelido: "Royal", consumo: "1" }),
    ];
    const ag = agregar(modeloDescriptor, linhas, maps);
    const tec = (ag.entidades[0].cabecalho._tecidos as { variantes: string[] }[])[0];
    expect(tec.variantes).toEqual(["var-malha-royal"]);
  });

  it("tecido sem apelido resolve a variante base", () => {
    const ag = agregar(modeloDescriptor, [
      row(2, { tipo_linha: "modelo", nome: "M", categoria: "Camisa" }),
      row(3, { tipo_linha: "tecido", nome: "M", material: "Malha Fiore", cor_base: "Azul", consumo: "1" }),
    ], maps);
    expect((ag.entidades[0].cabecalho._tecidos as { variantes: string[] }[])[0].variantes).toEqual(["var-malha-azul"]);
  });

  it("material não encontrado = erro bloqueante", () => {
    const ag = agregar(modeloDescriptor, [
      row(2, { tipo_linha: "modelo", nome: "M", categoria: "Camisa" }),
      row(3, { tipo_linha: "tecido", nome: "M", material: "Inexistente", cor_base: "Azul", consumo: "1" }),
    ], maps);
    expect(ag.entidades[0].problemas.some((p) => p.nivel === "erro" && p.campo === "material")).toBe(true);
  });

  it("categoria obrigatória na linha modelo", () => {
    const ag = agregar(modeloDescriptor, [row(2, { tipo_linha: "modelo", nome: "M" })], maps);
    expect(ag.entidades[0].problemas.some((p) => p.nivel === "erro" && p.campo === "categoria")).toBe(true);
  });

  it("2 modelos diferentes = 2 entidades", () => {
    const ag = agregar(modeloDescriptor, [
      row(2, { tipo_linha: "modelo", nome: "A", categoria: "Camisa" }),
      row(3, { tipo_linha: "tecido", nome: "A", material: "Malha Fiore", cor_base: "Azul", consumo: "1" }),
      row(4, { tipo_linha: "modelo", nome: "B", categoria: "Camisa" }),
      row(5, { tipo_linha: "tecido", nome: "B", material: "Forro X", cor_base: "Branco", consumo: "2" }),
    ], maps);
    expect(ag.entidades).toHaveLength(2);
    expect((ag.entidades[0].cabecalho._tecidos as unknown[]).length).toBe(1);
    expect((ag.entidades[1].cabecalho._tecidos as unknown[]).length).toBe(1);
  });

  it("2 tecidos no mesmo modelo NÃO deduplicam (baldes concatenam)", () => {
    const ag = agregar(modeloDescriptor, [
      row(2, { tipo_linha: "modelo", nome: "M", categoria: "Camisa" }),
      row(3, { tipo_linha: "tecido", nome: "M", material: "Malha Fiore", cor_base: "Azul", consumo: "1" }),
      row(4, { tipo_linha: "tecido", nome: "M", material: "Forro X", cor_base: "Branco", consumo: "0,8" }),
    ], maps);
    expect((ag.entidades[0].cabecalho._tecidos as unknown[]).length).toBe(2);
  });

  // Regressão da revisão (LOW): 2 linhas "modelo" de mesmo nome, ambas com grade/BOM → a 2ª é
  // ignorada e NÃO contribui (senão duplicaria a grade — modelo_grades não tem unique).
  it("2 linhas modelo de mesmo nome: a 2ª é ignorada (não duplica grade/BOM)", () => {
    const ag = agregar(modeloDescriptor, [
      row(2, { tipo_linha: "modelo", nome: "M", categoria: "Camisa", grade: "P:10" }),
      row(3, { tipo_linha: "tecido", nome: "M", material: "Malha Fiore", cor_base: "Azul", consumo: "1" }),
      row(4, { tipo_linha: "modelo", nome: "M", categoria: "Camisa", grade: "M:20" }),
    ], maps);
    expect(ag.entidades).toHaveLength(1);
    const cab = ag.entidades[0].cabecalho as Record<string, unknown>;
    expect((cab._grades as unknown[]).length).toBe(1); // só a grade da 1ª linha modelo
    expect((cab._grades as { grade_total: number }[])[0].grade_total).toBe(10);
    expect((cab._tecidos as unknown[]).length).toBe(1); // o tecido (linha-filha) entra normal
    expect(ag.entidades[0].problemas.some((p) => p.nivel === "aviso" && /2ª linha/.test(p.mensagem))).toBe(true);
  });

  it("linha-filha ANTES do cabeçalho: cabeçalho preenchido quando a linha modelo chega", () => {
    // ordem invertida: tecido primeiro, modelo depois — o mesclar copia o cabeçalho ao chegar
    const ag = agregar(modeloDescriptor, [
      row(2, { tipo_linha: "tecido", nome: "M", material: "Malha Fiore", cor_base: "Azul", consumo: "1" }),
      row(3, { tipo_linha: "modelo", nome: "M", categoria: "Camisa" }),
    ], maps);
    expect(ag.entidades[0].cabecalho.categoria_principal_id).toBe("cat-camisa");
    expect((ag.entidades[0].cabecalho._tecidos as unknown[]).length).toBe(1);
  });
});
