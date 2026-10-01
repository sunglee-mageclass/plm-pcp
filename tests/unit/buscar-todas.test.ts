import { describe, it, expect, vi } from "vitest";
import { buscarTodas } from "@/lib/buscar-todas";

const fake = (total: number) =>
  vi.fn(async (de: number, ate: number) => ({
    data: Array.from({ length: Math.max(0, Math.min(ate + 1, total) - de) }, (_, i) => ({
      id: de + i,
    })),
    error: null,
  }));

describe("buscarTodas", () => {
  it("1000 + 37 linhas: 2 chamadas, 1037 linhas, sem repetir", async () => {
    const pag = fake(1037);
    const r = await buscarTodas(pag);
    expect(r).toHaveLength(1037);
    expect(pag).toHaveBeenCalledTimes(2);
    expect(pag).toHaveBeenNthCalledWith(1, 0, 999);
    expect(pag).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(new Set(r.map((x: any) => x.id)).size).toBe(1037);
  });
  it("exatamente 1000 faz uma 2ª chamada vazia", async () => {
    const pag = fake(1000);
    expect(await buscarTodas(pag)).toHaveLength(1000);
    expect(pag).toHaveBeenCalledTimes(2);
  });
  it("lista curta: 1 chamada", async () => {
    const pag = fake(5);
    expect(await buscarTodas(pag)).toHaveLength(5);
    expect(pag).toHaveBeenCalledTimes(1);
  });
  it("propaga erro", async () => {
    await expect(
      buscarTodas(async () => ({ data: null, error: { message: "x" } })),
    ).rejects.toEqual({ message: "x" });
  });
});

describe("buscarTodas: dedupe", () => {
  it("descarta ids repetidos entre páginas, mantendo a parada na página curta", async () => {
    const pags = [Array.from({ length: 3 }, (_, i) => ({ id: i })), [{ id: 2 }, { id: 3 }]];
    let n = 0;
    const r = await buscarTodas(async () => ({ data: pags[n++] ?? [], error: null }), 3);
    expect(r.map((x: any) => x.id)).toEqual([0, 1, 2, 3]);
    expect(n).toBe(2);
  });
});
