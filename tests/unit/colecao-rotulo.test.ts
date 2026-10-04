import { describe, it, expect } from "vitest";
import { rotuloColecao } from "@/lib/colecao-rotulo";

// Fixtures do espelho de `_modelo_colecao_rotulo` (SQL): coalesce(nome da coleção da loja, nullif(btrim(coalesce(texto,'')), '')).
describe("rotuloColecao (Modularidade P12 — espelho de _modelo_colecao_rotulo)", () => {
  it.each([
    [{ colecao: "Verão 26", colecaoNome: "Inverno 26" }, "Inverno 26"], // nome da coleção do OTB vence o texto
    [{ colecao: "", colecaoNome: "Inverno 26" }, "Inverno 26"], // card só com o id
    [{ colecao: null, colecaoNome: "Inverno 26" }, "Inverno 26"],
    [{ colecao: "Verão 26", colecaoNome: null }, "Verão 26"], // sem coleção do OTB: o texto livre
    [{ colecao: "  Verão 26  " }, "Verão 26"], // trim (btrim)
    [{ colecao: "" }, null], // vazio = null
    [{ colecao: "   " }, null],
    [{ colecao: null, colecaoNome: null }, null],
    [{}, null],
    [{ colecao: "x", colecaoNome: "" }, ""], // coalesce do SQL: nome não-NULL (mesmo vazio) vence
  ] as const)("%j → %j", (entrada, esperado) => {
    expect(rotuloColecao(entrada)).toBe(esperado);
  });
});
