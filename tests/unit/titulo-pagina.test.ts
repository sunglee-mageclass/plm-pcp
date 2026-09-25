import { describe, it, expect } from "vitest";
import { CASOS_TITULO } from "../fixtures/titulo-pagina-casos";
import {
  TITULO_CONECTIVOS, TITULO_MAIUSC, TITULO_MINUSC, nomeEmTitulo, tituloAoDigitar, tituloExibido, tituloPaginaCalculado,
} from "@/lib/titulo-pagina";

describe("tituloPaginaCalculado — espelho de _titulo_pagina_calculado (as MESMAS fixtures rodam no SQL)", () => {
  it.each(CASOS_TITULO.map((c) => [JSON.stringify([c.nome, c.loja]), c] as const))("%s", (_rotulo, c) => {
    expect(tituloPaginaCalculado(c.nome, c.loja)).toBe(c.esperado);
  });
  it("nome vazio NUNCA vira ' | Loja' solto", () => {
    for (const nome of ["", " ", null, undefined]) expect(tituloPaginaCalculado(nome, "Ave Rara")).toBe("");
  });
  it("nomeEmTitulo sozinho", () => {
    expect(nomeEmTitulo("VESTIDO LONGO POEMA")).toBe("Vestido Longo Poema");
  });
});

describe("listas fixas (iguais às do translate() do SQL — independe do locale)", () => {
  it("51 maiúsculas pareadas com 51 minúsculas (A–Z + 25 acentos PT)", () => {
    const mai = [...TITULO_MAIUSC];
    const min = [...TITULO_MINUSC];
    expect(mai).toHaveLength(51);
    expect(min).toHaveLength(51);
    mai.forEach((c, i) => expect(c.toLowerCase()).toBe(min[i]));
  });
  it("conectivos da spec (ruling 1)", () => {
    expect(TITULO_CONECTIVOS).toEqual(["de", "da", "do", "das", "dos", "e", "com", "em", "para"]);
  });
});

describe("apoio à tela (sem espelho SQL)", () => {
  it("tituloExibido: o fixado à mão; NULL = o calculado ao vivo", () => {
    expect(tituloExibido(null, "Saia | L")).toBe("Saia | L");
    expect(tituloExibido("Meu título", "Saia | L")).toBe("Meu título");
  });
  it("tituloAoDigitar: igual ao calculado segue AUTOMÁTICO (NULL); diferente vira manual (Ruling R5)", () => {
    expect(tituloAoDigitar("Saia | L", "Saia | L")).toBeNull();
    expect(tituloAoDigitar("Saia | L!", "Saia | L")).toBe("Saia | L!");
    expect(tituloAoDigitar("", "Saia | L")).toBe(""); // vazio vira NULL no blur/Salvar (R6)
  });
});
