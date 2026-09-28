import { describe, it, expect, vi } from "vitest";
import { lerParametros } from "@/lib/integracao/api/parametros";
import { tratarRequisicao, type DepsRota } from "@/lib/integracao/api/rota";
import type { RespostaLer } from "@/lib/integracao/api/resposta";

const CHAVE = "wish_live_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
const T = "11111111-1111-4111-8111-111111111111";
const OK: RespostaLer = {
  status: "ok", modo: "normal", acesso_id: "ac1", chave_id: "k1", tenant_id: T, loja: { id: T, nome: "Loja X" },
  colunas: ["Nome", "Foto"], chaves_colunas: ["nome", "foto"], proximo_cursor: null, validade_foto_dias: 7,
  pagina: { limite: 50, maximo: 50 },
  produtos: [
    { modelo_id: "m1", estado: "integravel", assinatura: "s1", integrado_em: null, linhas: [
      { tipo: "produto", loja_nome: "Loja X", valores: ["Saia", [`${T}/fotos_modelo/a.jpg`, `outra-loja/fotos_modelo/x.jpg`, `${T}/fotos_modelo/sumiu.jpg`]] },
      { tipo: "variante", loja_nome: "Loja X", valores: ["Saia P", []] }] },
    { modelo_id: "m2", estado: "integravel", assinatura: "s2", integrado_em: null, linhas: [{ tipo: "produto", valores: ["Blusa", []] }] },
  ],
};
function deps(o: Partial<DepsRota> = {}) {
  const log: string[] = [];
  const d: DepsRota = {
    hashChave: vi.fn(async (c: string) => `h(${c.length})`),
    ler: vi.fn(async () => OK),
    assinarFotos: vi.fn(async (c: string[]) => new Map(c.map((p) => [p, p.endsWith("sumiu.jpg") ? null : `https://s/${p}?t=1`]))),
    confirmar: vi.fn(async () => ({ status: "ok", confirmados: [{ modelo_id: "m1", integrado_em: "2026-09-26T17:35:00.000Z" }] })),
    limpar: vi.fn(async () => { log.push("limpar"); }),
    depois: vi.fn((p: Promise<unknown>) => { void p; }),
    tetoIp: vi.fn(async () => true),
    agora: () => new Date("2026-09-26T20:48:00.000Z"),
    origem: "https://site",
    ...o,
  };
  return { d, log };
}
const req = (q = "", auth: string | null = `Bearer ${CHAVE}`) =>
  new Request(`https://site/api/integracao/v1/produtos${q}`, { headers: { ...(auth ? { authorization: auth } : {}), "cf-connecting-ip": "203.0.113.5" } });
const corpo = async (r: Response) => JSON.parse(await r.text());

describe("parâmetros", () => {
  it("padrões e validação", () => {
    expect(lerParametros(new URL("https://s/x"))).toEqual({ modo: "normal", incluir: false, limite: null, cursor: null });
    expect(lerParametros(new URL("https://s/x?modo=teste&incluir_integrados=1&limite=100&cursor=eyJkZXBvaXMiOiJ4In0="))).toEqual(
      { modo: "teste", incluir: true, limite: 100, cursor: "eyJkZXBvaXMiOiJ4In0=" });
    for (const q of ["modo=xpto", "incluir_integrados=talvez", "limite=0", "limite=abc", "limite=99999", "cursor=%3Cscript%3E"]) {
      expect(lerParametros(new URL(`https://s/x?${q}`)), q).toBeNull();
    }
  });
});

describe("rota — códigos HTTP e corpo mínimo ASCII", () => {
  it("sem Authorization: registra a tentativa (hash de vazio) e devolve 401", async () => {
    const { d } = deps({ ler: vi.fn(async () => ({ status: "chave_invalida" }) as RespostaLer) });
    const r = await tratarRequisicao(req("", null), d);
    expect(r.status).toBe(401);
    expect(await corpo(r)).toEqual({ erro: "chave_invalida" });
    expect(d.hashChave).toHaveBeenCalledWith("");
    expect(vi.mocked(d.ler).mock.calls[0][0]).toMatchObject({ ip: "203.0.113.5", modo: "normal" });
  });
  it("status do banco → HTTP (403, 429 + Retry-After), parâmetro inválido = 400 SEM consultar o banco", async () => {
    const a = deps({ ler: vi.fn(async () => ({ status: "loja_inativa" }) as RespostaLer) });
    expect((await tratarRequisicao(req(), a.d)).status).toBe(403);
    const b = deps({ ler: vi.fn(async () => ({ status: "limite_excedido", retry_after: 17 }) as RespostaLer) });
    const rb = await tratarRequisicao(req(), b.d);
    expect(rb.status).toBe(429);
    expect(rb.headers.get("retry-after")).toBe("17");
    expect(await corpo(rb)).toEqual({ erro: "limite_excedido" });
    const c = deps();
    expect((await tratarRequisicao(req("?limite=abc"), c.d)).status).toBe(400);
    expect(c.d.ler).not.toHaveBeenCalled();
  });
  it("teto do Workers (binding) estourado = 429 sem tocar no banco", async () => {
    const { d } = deps({ tetoIp: vi.fn(async () => false) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
    expect(d.ler).not.toHaveBeenCalled();
  });
  it("erro inesperado = 500 com corpo ASCII mínimo; a chave nunca aparece", async () => {
    const { d } = deps({ ler: vi.fn(async () => { throw new Error(`boom ${CHAVE} relation "x" does not exist`); }) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(500);
    const t = await r.text();
    expect(t).toBe('{"erro":"erro_interno"}');
    expect(t).not.toContain(CHAVE);
  });
});

describe("rota — 2 fases (R7): ler → fotos → confirmar → só os confirmados", () => {
  it("normal: foto de outra loja descartada, inexistente = null, contagens vão ao confirmar; só m1 sai", async () => {
    const { d } = deps();
    const r = await tratarRequisicao(req("?limite=50"), d);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(vi.mocked(d.assinarFotos).mock.calls[0]).toEqual([[`${T}/fotos_modelo/a.jpg`, `${T}/fotos_modelo/sumiu.jpg`], 7 * 86400]);
    expect(vi.mocked(d.confirmar).mock.calls[0]).toEqual(["k1", "ac1", {
      produtos: [{ modelo_id: "m1", assinatura: "s1" }, { modelo_id: "m2", assinatura: "s2" }], fotos_descartadas: 1, fotos_ausentes: 1 }]);
    const j = await corpo(r);
    expect(j).toMatchObject({ versao: 1, modo: "normal", loja: { id: T, nome: "Loja X" }, colunas: ["Nome", "Foto"],
      gerado_em: "2026-09-26T20:48:00.000Z", pagina: { limite: 50, maximo: 50 }, proximo_cursor: null }); // D39
    expect(j.linhas.map((l: any) => l.produto_id)).toEqual(["m1", "m1"]);
    expect(j.linhas[0].valores[1]).toEqual([`https://s/${T}/fotos_modelo/a.jpg?t=1`, null, null]);
    expect(j.linhas[0].integrado_em).toBe("2026-09-26T17:35:00.000Z");
    expect(j.linhas[1].valores[1]).toEqual([]);
    expect(d.depois).toHaveBeenCalledTimes(1);
  });
  it("teste: nunca confirma; foto = endereço público de exemplo", async () => {
    const T2: RespostaLer = { ...OK, modo: "teste", produtos: [{ modelo_id: "exemplo-0001", estado: "teste", assinatura: null, integrado_em: null,
      linhas: [{ tipo: "produto", valores: ["Produto Exemplo 1", ["exemplo"]] }] }] };
    const { d } = deps({ ler: vi.fn(async () => T2) });
    const j = await corpo(await tratarRequisicao(req("?modo=teste"), d));
    expect(d.confirmar).not.toHaveBeenCalled();
    expect(d.assinarFotos).not.toHaveBeenCalled();
    expect(j.modo).toBe("teste");
    expect(j.linhas[0].valores[1]).toEqual(["https://site/integracao/exemplo-produto.svg"]);
  });
  it("confirmar diz chave inválida (revogada no meio) = 401 e nada sai", async () => {
    const { d } = deps({ confirmar: vi.fn(async () => ({ status: "chave_invalida", confirmados: [] })) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(401);
  });
});
