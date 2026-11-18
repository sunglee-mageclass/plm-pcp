import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { conteudoDaTela } from "@/lib/manual/tipos-conteudo";
import { moduloGuiaGeral } from "@/lib/manual/estrutura";

const src = readFileSync("src/lib/manual/conteudo/colaboracao.ts", "utf8");
const secoes = conteudoDaTela("manual");
const texto = JSON.stringify(secoes);

describe("Manual: seção de colaboração em tempo real", () => {
  it("existe no agregador, ancorada no pageKey `manual`, com os títulos dos 3 pontos", () => {
    expect(secoes.map((s) => s.id)).toEqual([
      "equipe-atualiza-sozinha",
      "equipe-quem-esta-editando",
      "equipe-mesmo-lugar",
    ]);
  });
  it("explica a atualização automática (sem recarregar / F5)", () => {
    expect(texto).toMatch(/sozinha/);
    expect(texto).toMatch(/F5/);
  });
  it("explica o anel/cor/quem está editando", () => {
    expect(texto).toMatch(/anel/i);
    expect(texto).toMatch(/cor própria/);
    expect(texto).toMatch(/em qual campo/);
  });
  it("explica o aviso de conflito (manter o meu / usar o novo / nada apagado em silêncio)", () => {
    expect(texto).toMatch(/outra pessoa salvou/);
    expect(texto).toMatch(/Manter o meu/);
    expect(texto).toMatch(/Usar o novo/);
    expect(texto).toMatch(/Nada é apagado em silêncio/);
  });
  it("não promete co-edição ao vivo (Onda 3 futura)", () => {
    expect(texto).not.toMatch(/enquanto (ela )?digita[^.]*você (vê|acompanha)/i);
    expect(texto).toMatch(/Você não vê o que ela está digitando/);
  });
  it("o Guia geral só aparece quando há conteúdo e é universal (sem pageKey de permissão)", () => {
    expect(moduloGuiaGeral(false)).toBeNull();
    const g = moduloGuiaGeral(true)!;
    expect(g.telas[0].pageKey).toBe("manual");
    expect(src).toMatch(/manual: TRABALHAR_EM_EQUIPE/);
  });
});
