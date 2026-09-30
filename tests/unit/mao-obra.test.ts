import { describe, it, expect } from "vitest";
import { moLiberada, estadoMO, somaAprovada, somaTotal, type MoLinha } from "@/lib/mao-obra";

const L = (aprovado: boolean | null, valor = 0): MoLinha => ({ categoria_terceirizado_id: "x", aprovado, valor });

describe("mao-obra helpers", () => {
  it("moLiberada: vazio = liberada", () => { expect(moLiberada([])).toBe(true); });
  it("moLiberada: todas true = liberada", () => { expect(moLiberada([L(true), L(true)])).toBe(true); });
  it("moLiberada: uma pendente = bloqueada", () => { expect(moLiberada([L(true), L(null)])).toBe(false); });
  it("moLiberada: uma reprovada = bloqueada", () => { expect(moLiberada([L(true), L(false)])).toBe(false); });

  it("estadoMO: sem linha", () => { expect(estadoMO([])).toBe("sem_servico"); });
  it("estadoMO: reprovada tem prioridade", () => { expect(estadoMO([L(true), L(false), L(null)])).toBe("reprovada"); });
  it("estadoMO: pendente antes de aprovada", () => { expect(estadoMO([L(true), L(null)])).toBe("pendente"); });
  it("estadoMO: todas aprovadas", () => { expect(estadoMO([L(true), L(true)])).toBe("aprovada"); });

  it("somaAprovada: só as aprovadas", () => { expect(somaAprovada([L(true, 10), L(false, 5), L(null, 7)])).toBe(10); });
  it("somaTotal: tudo", () => { expect(somaTotal([L(true, 10), L(false, 5), L(null, 7)])).toBe(22); });
});

import { somaAprovadaVigente } from "@/lib/mao-obra";
describe("somaAprovadaVigente", () => {
  const base: MoLinha[] = [
    { id: "a", categoria_terceirizado_id: "x", aprovado: true, valor: 10 },
    { id: "b", categoria_terceirizado_id: "y", aprovado: true, valor: 5 },
  ];
  it("sem edição = soma das aprovadas", () => { expect(somaAprovadaVigente(base, base)).toBe(15); });
  it("linha aprovada com valor editado não conta (vai reabrir)", () => {
    expect(somaAprovadaVigente([{ ...base[0], valor: 99 }, base[1]], base)).toBe(5);
  });
  it("linha nova/pendente não conta; sem base conta aprovadas", () => {
    expect(somaAprovadaVigente([...base, { categoria_terceirizado_id: "z", aprovado: null, valor: 7 }], base)).toBe(15);
    expect(somaAprovadaVigente(base, undefined)).toBe(15);
  });
});
