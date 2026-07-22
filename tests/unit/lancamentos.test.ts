import { describe, it, expect } from "vitest";
import { proximoLancamento, removerLancamento, normalizar, remapChaves, MAX_LANCAMENTOS } from "@/lib/lancamentos";

describe("lancamentos — slots sequenciais contíguos", () => {
  it("proximoLancamento acrescenta o próximo ordinal contíguo", () => {
    expect(proximoLancamento([])).toBe(1);
    expect(proximoLancamento([1])).toBe(2);
    expect(proximoLancamento([1, 2, 3])).toBe(4);
  });

  it("proximoLancamento preenche o menor buraco", () => {
    expect(proximoLancamento([1, 3])).toBe(2);
    expect(proximoLancamento([2, 3])).toBe(1);
  });

  it("proximoLancamento devolve null no teto", () => {
    expect(proximoLancamento([1, 2, 3, 4, 5])).toBeNull();
    expect(MAX_LANCAMENTOS).toBe(5);
  });

  it("removerLancamento do meio renumera contíguo e remapeia", () => {
    const { ordinais, remap } = removerLancamento([1, 2, 3], 2);
    expect(ordinais).toEqual([1, 2]);
    // 1 fica 1; 3 vira 2; o removido (2) não entra no remap
    expect(remap.get(1)).toBe(1);
    expect(remap.get(3)).toBe(2);
    expect(remap.has(2)).toBe(false);
  });

  it("removerLancamento do último não desloca os anteriores", () => {
    const { ordinais, remap } = removerLancamento([1, 2, 3], 3);
    expect(ordinais).toEqual([1, 2]);
    expect(remap.get(1)).toBe(1);
    expect(remap.get(2)).toBe(2);
  });

  it("normalizar compacta buracos preservando a ordem", () => {
    const { ordinais, remap } = normalizar([1, 3, 5]);
    expect(ordinais).toEqual([1, 2, 3]);
    expect(remap.get(1)).toBe(1);
    expect(remap.get(3)).toBe(2);
    expect(remap.get(5)).toBe(3);
  });

  it("normalizar deduplica e ordena entrada bagunçada", () => {
    const { ordinais } = normalizar([3, 1, 3]);
    expect(ordinais).toEqual([1, 2]);
  });

  it("remapChaves reindexa os dados por ordinal e descarta chaves removidas", () => {
    const { remap } = removerLancamento([1, 2, 3], 2);
    const qtd = { "1": 10, "2": 20, "3": 30 };
    // 1→1 (10), 3→2 (30); o "2" (removido) some
    expect(remapChaves(qtd, remap)).toEqual({ "1": 10, "2": 30 });
  });

  it("remapChaves com normalização reindexa datas de [1,3,5]→[1,2,3]", () => {
    const { remap } = normalizar([1, 3, 5]);
    const datas = { "1": "2026-01-05", "3": "2026-01-19", "5": "2026-02-02" };
    expect(remapChaves(datas, remap)).toEqual({ "1": "2026-01-05", "2": "2026-01-19", "3": "2026-02-02" });
  });

  it("remapChaves tolera objeto nulo/vazio", () => {
    const { remap } = normalizar([1, 2]);
    expect(remapChaves({}, remap)).toEqual({});
    expect(remapChaves(undefined as any, remap)).toEqual({});
  });
});
