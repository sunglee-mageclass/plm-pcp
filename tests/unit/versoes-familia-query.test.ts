import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { buscarVersoesFamilia, LOTE_IDS, LOTE_RAIZES } from "@/lib/versoes-familia-query";

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

function clienteFake(respostas: (url: URL) => unknown) {
  const urls: string[] = [];
  const fakeFetch = async (input: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    urls.push(u.toString());
    return new Response(JSON.stringify(respostas(u)), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = createClient("http://x.test", "k", { global: { fetch: fakeFetch as any }, auth: { persistSession: false } });
  return { client, urls };
}

describe("buscarVersoesFamilia", () => {
  it("100 raízes: lotes mantêm a URL < 5 KB e cobrem todas as raízes", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => uuid(i + 1));
    const { client, urls } = clienteFake((u) =>
      u.searchParams.has("or") ? [] : ids.map((id) => ({ id, modelo_base_id: null })));
    await buscarVersoesFamilia(client, ids);
    expect(Math.max(...urls.map((s) => s.length))).toBeLessThan(5000);
    const ors = urls.filter((s) => s.includes("or="));
    expect(ors).toHaveLength(Math.ceil(100 / LOTE_RAIZES));
    expect(LOTE_IDS).toBeGreaterThanOrEqual(100);
  });
  it("erro em qualquer SELECT rejeita (falha fechada)", async () => {
    const client = createClient("http://x.test", "k", {
      global: { fetch: (async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 })) as any },
      auth: { persistSession: false },
    });
    await expect(buscarVersoesFamilia(client, [uuid(1)])).rejects.toBeTruthy();
  });
  it("mapeia embed colecoes(nome) com fallback no texto", async () => {
    const { client } = clienteFake((u) =>
      u.searchParams.has("or")
        ? [
            { id: "a", nome: "V", versao: 1, modelo_base_id: null, colecao_id: "c", colecao: "txt", subcolecao: null, created_at: null, colecoes: { nome: "Verão" } },
            { id: "b", nome: "V", versao: 2, modelo_base_id: "a", colecao_id: null, colecao: "Legado", subcolecao: "F1", created_at: null, colecoes: null },
          ]
        : [{ id: "a", modelo_base_id: null }]);
    const r = await buscarVersoesFamilia(client, ["a"]);
    expect(r.map((x) => x.colecao)).toEqual(["Verão", "Legado"]);
  });
  it("lista vazia não consulta", async () => {
    const { client, urls } = clienteFake(() => []);
    expect(await buscarVersoesFamilia(client, [])).toEqual([]);
    expect(urls).toHaveLength(0);
  });
});
