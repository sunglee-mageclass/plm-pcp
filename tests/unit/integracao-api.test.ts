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
  const d: DepsRota = {
    hashChave: vi.fn(async (c: string) => `h(${c.length})`),
    ler: vi.fn(async () => OK),
    assinarFotos: vi.fn(async (c: string[]) => new Map(c.map((p) => [p, p.endsWith("sumiu.jpg") ? null : `https://s/${p}?t=1`]))),
    confirmar: vi.fn(async () => ({ status: "ok", confirmados: [{ modelo_id: "m1", integrado_em: "2026-09-26T17:35:00.000Z" }] })),
    limpar: vi.fn(async () => {}),
    depois: vi.fn((p: Promise<unknown>) => { void p; }),
    tetoIp: vi.fn(async () => true),
    agora: () => new Date("2026-09-26T20:48:00.000Z"),
    origem: "https://site",
    ...o,
  };
  return { d };
}
const req = (q = "", auth: string | null = `Bearer ${CHAVE}`, headers: Record<string, string> = {}) =>
  new Request(`https://site/api/integracao/v1/produtos${q}`, { headers: { ...(auth ? { authorization: auth } : {}), "cf-connecting-ip": "203.0.113.5", ...headers } });
const corpo = async (r: Response) => JSON.parse(await r.text());
// small helper for a promise that never settles (used to prove non-blocking cleanup)
const pendente = () => new Promise<void>(() => {});

describe("parâmetros", () => {
  it("padrões e validação", () => {
    expect(lerParametros(new URL("https://s/x"))).toEqual({ modo: "normal", incluir: false, limite: null, cursor: null });
    expect(lerParametros(new URL("https://s/x?modo=teste&incluir_integrados=1&limite=100&cursor=eyJkZXBvaXMiOiJ4In0="))).toEqual(
      { modo: "teste", incluir: true, limite: 100, cursor: "eyJkZXBvaXMiOiJ4In0=" });
    for (const q of ["modo=xpto", "incluir_integrados=talvez", "limite=0", "limite=abc", "limite=99999", "cursor=%3Cscript%3E"]) {
      expect(lerParametros(new URL(`https://s/x?${q}`)), q).toBeNull();
    }
  });
  it("I3 (ruling): parâmetro desconhecido ou repetido => null; m5: valor vazio = ausente nos 4", () => {
    for (const q of ["MODO=teste", "mode=teste", "modo=teste&modo=xpto", "limite=1&limite=abc", "_=123", "cursor=x&cursor=y", "incluir_integrados=1&incluir_integrados=1"]) {
      expect(lerParametros(new URL(`https://s/x?${q}`)), q).toBeNull();
    }
    // m5: empty value = absent, for all 4 known params (não mais 400 pra modo=/incluir_integrados=)
    expect(lerParametros(new URL("https://s/x?limite="))).toEqual({ modo: "normal", incluir: false, limite: null, cursor: null });
    expect(lerParametros(new URL("https://s/x?cursor="))).toEqual({ modo: "normal", incluir: false, limite: null, cursor: null });
    expect(lerParametros(new URL("https://s/x?modo="))).toEqual({ modo: "normal", incluir: false, limite: null, cursor: null });
    expect(lerParametros(new URL("https://s/x?incluir_integrados="))).toEqual({ modo: "normal", incluir: false, limite: null, cursor: null });
  });
  it("edge cases adicionais: negativo, 0, não-numérico, acima do máximo", () => {
    for (const q of ["limite=-1", "limite=0", "limite=abc", "limite=99999"]) {
      expect(lerParametros(new URL(`https://s/x?${q}`)), q).toBeNull();
    }
    // dentro do range de dígitos mas acima do "razoável" ainda é aceito localmente (o banco aplica least());
    // só o formato é validado aqui.
    expect(lerParametros(new URL("https://s/x?limite=999"))).toEqual({ modo: "normal", incluir: false, limite: 999, cursor: null });
  });
  it("m6 gap: cursor com mais de 200 caracteres => 400", () => {
    const cursorGigante = "a".repeat(201);
    expect(lerParametros(new URL(`https://s/x?cursor=${cursorGigante}`))).toBeNull();
    // exatamente 200 (limite) ainda é válido
    const cursorNoLimite = "a".repeat(200);
    expect(lerParametros(new URL(`https://s/x?cursor=${cursorNoLimite}`))).toEqual(
      { modo: "normal", incluir: false, limite: null, cursor: cursorNoLimite });
  });
  it("m6 gap: incluir_integrados=true|false são ACEITOS pela regra atual do parser (não é 400)", () => {
    // A regra atual de lerParametros aceita literalmente "0"/"1"/"false"/"true"; só "true" vira incluir=true.
    expect(lerParametros(new URL("https://s/x?incluir_integrados=true"))).toEqual(
      { modo: "normal", incluir: true, limite: null, cursor: null });
    expect(lerParametros(new URL("https://s/x?incluir_integrados=false"))).toEqual(
      { modo: "normal", incluir: false, limite: null, cursor: null });
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
    expect(c.d.hashChave).not.toHaveBeenCalled();
  });
  it("teto do Workers (binding) estourado = 429 sem tocar no banco nem no hash", async () => {
    const { d } = deps({ tetoIp: vi.fn(async () => false) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
    expect(d.ler).not.toHaveBeenCalled();
    expect(d.hashChave).not.toHaveBeenCalled();
  });
  it("erro inesperado = 500 com corpo ASCII mínimo; a chave nunca aparece", async () => {
    const { d } = deps({ ler: vi.fn(async () => { throw new Error(`boom ${CHAVE} relation "x" does not exist`); }) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(500);
    const t = await r.text();
    expect(t).toBe('{"erro":"erro_interno"}');
    expect(t).not.toContain(CHAVE);
  });
  it("ip_bloqueado (banco) => 429 + Retry-After", async () => {
    const { d } = deps({ ler: vi.fn(async () => ({ status: "ip_bloqueado", retry_after: 42 }) as RespostaLer) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("42");
    expect(await corpo(r)).toEqual({ erro: "ip_bloqueado" });
  });
  it("ler devolve status desconhecido (nem no mapa) => 500 erro_interno", async () => {
    const { d } = deps({ ler: vi.fn(async () => ({ status: "algo_novo_do_banco" }) as unknown as RespostaLer) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(500);
    expect(await corpo(r)).toEqual({ erro: "erro_interno" });
  });
  it("m8: status com nome de propriedade do protótipo (constructor/toString/__proto__) => 500, não cai na cadeia do protótipo", async () => {
    for (const s of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const { d } = deps({ ler: vi.fn(async () => ({ status: s }) as unknown as RespostaLer) });
      const r = await tratarRequisicao(req(), d);
      expect(r.status, s).toBe(500);
      expect(await corpo(r), s).toEqual({ erro: "erro_interno" });
    }
  });
  it("m4 (ruling): ip = cf-connecting-ip trim/slice(64) || 'desconhecido'; X-Forwarded-For nunca é usado", async () => {
    const { d } = deps();
    await tratarRequisicao(new Request("https://site/api/integracao/v1/produtos", {
      headers: { authorization: `Bearer ${CHAVE}`, "cf-connecting-ip": "  203.0.113.9  ", "x-forwarded-for": "9.9.9.9" },
    }), d);
    expect(vi.mocked(d.tetoIp).mock.calls[0][0]).toBe("203.0.113.9");
    expect(vi.mocked(d.ler).mock.calls[0][0]).toMatchObject({ ip: "203.0.113.9" });

    const { d: d2 } = deps();
    await tratarRequisicao(new Request("https://site/api/integracao/v1/produtos", {
      headers: { authorization: `Bearer ${CHAVE}`, "x-forwarded-for": "9.9.9.9" },
    }), d2);
    expect(vi.mocked(d2.tetoIp).mock.calls[0][0]).toBe("desconhecido");

    const { d: d3 } = deps();
    await tratarRequisicao(new Request("https://site/api/integracao/v1/produtos", {
      headers: { authorization: `Bearer ${CHAVE}`, "cf-connecting-ip": "" },
    }), d3);
    expect(vi.mocked(d3.tetoIp).mock.calls[0][0]).toBe("desconhecido");
  });
  it("m9 (ruling): resposta do banco com modo diferente do pedido => 500, nunca chama confirmar", async () => {
    const { d } = deps({ ler: vi.fn(async () => ({ ...OK, modo: "teste" }) as RespostaLer) });
    const r = await tratarRequisicao(req("?modo=normal"), d);
    expect(r.status).toBe(500);
    expect(await corpo(r)).toEqual({ erro: "erro_interno" });
    expect(d.confirmar).not.toHaveBeenCalled();
  });
  it("N4: direção perigosa do m9 -- pediu modo=teste, banco responde normal => 500, confirmar NUNCA chamado, sem linhas", async () => {
    const { d } = deps({ ler: vi.fn(async () => ({ ...OK, modo: "normal" }) as RespostaLer) });
    const r = await tratarRequisicao(req("?modo=teste"), d);
    expect(r.status).toBe(500);
    const j = await corpo(r);
    expect(j).toEqual({ erro: "erro_interno" });
    expect(j.linhas).toBeUndefined();
    expect(d.confirmar).not.toHaveBeenCalled();
  });
  it("m10/M9: headers de segurança sempre presentes; WWW-Authenticate só no 401", async () => {
    const { d } = deps();
    const ok = await tratarRequisicao(req(), d);
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    const { d: d401 } = deps({ ler: vi.fn(async () => ({ status: "chave_invalida" }) as RespostaLer) });
    const r401 = await tratarRequisicao(req(), d401);
    expect(r401.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r401.headers.get("www-authenticate")).toBe("Bearer");
    const { d: d500 } = deps({ ler: vi.fn(async () => { throw new Error("boom"); }) });
    const r500 = await tratarRequisicao(req(), d500);
    expect(r500.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("rota — I1/m1: guarda de caminho de foto (fail closed, sem travessia)", () => {
  it("tenant_id ausente/inválido => todas as fotos descartadas, nada assinado", async () => {
    const semTenant: RespostaLer = { ...OK, tenant_id: undefined };
    const { d } = deps({ ler: vi.fn(async () => semTenant) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(200);
    expect(d.assinarFotos).not.toHaveBeenCalled();
    const j = await corpo(r);
    expect(j.linhas[0].valores[1]).toEqual([null, null, null]);
    expect(vi.mocked(d.confirmar).mock.calls[0][2]).toMatchObject({ fotos_descartadas: 3 });
  });
  it("N3: tenant_id ausente/inválido -- caminho LITERAL que o código antigo (startsWith cru) TERIA assinado", async () => {
    // N3: fixture discriminante -- com tenant_id ausente, o prefixo antigo virava "undefined/" (via template
    // string) e "undefined/x.jpg".startsWith("undefined/") é true; com tenant_id="nao-uuid" (formato inválido,
    // não-uuid), "nao-uuid/x.jpg".startsWith("nao-uuid/") também é true. Os dois caminhos abaixo são literais
    // que o código ANTIGO assinava; o novo (fail-closed por uuid) tem que descartar os dois.
    const semTenant: RespostaLer = { ...OK, tenant_id: undefined, produtos: [
      { modelo_id: "m1", estado: "integravel", assinatura: "s1", integrado_em: null, linhas: [
        { tipo: "produto", loja_nome: "Loja X", valores: ["Saia", ["undefined/x.jpg"]] }] },
    ] };
    const { d: d1 } = deps({ ler: vi.fn(async () => semTenant) });
    const r1 = await tratarRequisicao(req(), d1);
    expect(r1.status).toBe(200);
    expect(d1.assinarFotos).not.toHaveBeenCalled();
    expect(vi.mocked(d1.assinarFotos).mock.calls).toEqual([]);

    const tenantInvalido: RespostaLer = { ...OK, tenant_id: "nao-uuid", produtos: [
      { modelo_id: "m1", estado: "integravel", assinatura: "s1", integrado_em: null, linhas: [
        { tipo: "produto", loja_nome: "Loja X", valores: ["Saia", ["nao-uuid/x.jpg"]] }] },
    ] };
    const { d: d2 } = deps({ ler: vi.fn(async () => tenantInvalido) });
    const r2 = await tratarRequisicao(req(), d2);
    expect(r2.status).toBe(200);
    expect(d2.assinarFotos).not.toHaveBeenCalled();
    expect(vi.mocked(d2.assinarFotos).mock.calls).toEqual([]);
  });
  it("travessia (../), barra dupla e barra invertida são rejeitadas mesmo com o prefixo certo", async () => {
    const comTravessia: RespostaLer = { ...OK, produtos: [
      { modelo_id: "m1", estado: "integravel", assinatura: "s1", integrado_em: null, linhas: [
        { tipo: "produto", loja_nome: "Loja X", valores: ["Saia", [
          `${T}/../outra-loja/fotos_modelo/x.jpg`,
          `${T}//fotos_modelo/a.jpg`,
          `${T}/a\\..\\b.jpg`,
          `${T}/fotos_modelo/ok.jpg`,
        ]] }] },
    ] };
    const { d } = deps({ ler: vi.fn(async () => comTravessia) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(200);
    // só o caminho canônico (sem .. , sem //, sem \) é assinado
    expect(vi.mocked(d.assinarFotos).mock.calls[0][0]).toEqual([`${T}/fotos_modelo/ok.jpg`]);
    const j = await corpo(r);
    expect(j.linhas[0].valores[1]).toEqual([null, null, null, `https://s/${T}/fotos_modelo/ok.jpg?t=1`]);
    expect(vi.mocked(d.confirmar).mock.calls[0][2]).toMatchObject({ fotos_descartadas: 3 });
  });
  it("N6: caractere DEL (\\u007f) no caminho também é rejeitado", async () => {
    const comDel: RespostaLer = { ...OK, produtos: [
      { modelo_id: "m1", estado: "integravel", assinatura: "s1", integrado_em: null, linhas: [
        { tipo: "produto", loja_nome: "Loja X", valores: ["Saia", [
          `${T}/fotos_modelo/a\u007fb.jpg`,
          `${T}/fotos_modelo/ok.jpg`,
        ]] }] },
    ] };
    const { d } = deps({ ler: vi.fn(async () => comDel) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(200);
    expect(vi.mocked(d.assinarFotos).mock.calls[0][0]).toEqual([`${T}/fotos_modelo/ok.jpg`]);
    expect(vi.mocked(d.confirmar).mock.calls[0][2]).toMatchObject({ fotos_descartadas: 1 });
  });
});

describe("rota — I2/M3: limpeza isolada da resposta", () => {
  it("limpar lança de forma síncrona: a resposta ainda é 200 com as linhas", async () => {
    const { d } = deps({ limpar: vi.fn(() => { throw new Error("boom sync"); }) as any });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(200);
    const j = await corpo(r);
    expect(j.linhas.length).toBeGreaterThan(0);
  });
  it("N2: limpar rejeita (função PLAIN, não vi.fn) -- 200 E nenhum unhandledRejection escapa", async () => {
    // vi.fn() por si só já anexa um .then/.catch interno para rastrear settledResults, o que faz a promise
    // rejeitada parecer "tratada" mesmo sem nenhuma proteção no código sob teste (falso positivo). Uma função
    // PLAIN não tem esse efeito colateral -- só ela prova de verdade que o handler intercepta a rejeição.
    let capturada: unknown = null;
    const onUnhandled = (reason: unknown) => { capturada = reason; };
    process.on("unhandledRejection", onUnhandled);
    try {
      const limparPlano = () => Promise.reject(new Error("boom async plain"));
      const { d } = deps({ limpar: limparPlano });
      const r = await tratarRequisicao(req(), d);
      expect(r.status).toBe(200);
      // dá tempo para qualquer unhandledRejection pendente disparar: um microtask (a própria rejeição)
      // seguido de uma volta de macrotask (é quando o Node/V8 relata unhandledRejection).
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(capturada).toBeNull();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
  it("limpar nunca resolve: o handler ainda retorna (não trava esperando)", async () => {
    const { d } = deps({ limpar: vi.fn(() => pendente()) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(200);
  });
  it("depois lança de forma síncrona: ainda 200 com linhas", async () => {
    const { d } = deps({ depois: vi.fn(() => { throw new Error("boom depois"); }) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(200);
    const j = await corpo(r);
    expect(j.linhas.length).toBeGreaterThan(0);
  });
  it("prova de não-bloqueio: limpar NUNCA é aguardado pela resposta (mesmo pendente para sempre)", async () => {
    let chamou = false;
    const { d } = deps({ limpar: vi.fn(() => { chamou = true; return pendente(); }) });
    const antes = Date.now();
    const r = await tratarRequisicao(req(), d);
    const depois = Date.now();
    expect(r.status).toBe(200);
    expect(chamou).toBe(true);
    expect(depois - antes).toBeLessThan(1000); // se estivesse esperando `limpar`, isto nunca resolveria
  });
});

describe("rota — m2 (ruling): confirmar com status diferente de ok/chave_invalida/loja_inativa", () => {
  it("confirmar devolve loja_inativa => 403", async () => {
    const { d } = deps({ confirmar: vi.fn(async () => ({ status: "loja_inativa", confirmados: [] })) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(403);
  });
  it("confirmar devolve parametro_invalido (inconsistência de protocolo interna) => 500, NÃO 400", async () => {
    const { d } = deps({ confirmar: vi.fn(async () => ({ status: "parametro_invalido", confirmados: [] })) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(500);
    expect(await corpo(r)).toEqual({ erro: "erro_interno" });
  });
  it("confirmar devolve outro status desconhecido => 500", async () => {
    const { d } = deps({ confirmar: vi.fn(async () => ({ status: "limite_excedido", confirmados: [] })) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(500);
  });
});

describe("rota — M3: formato de linhas/valores fora do contrato falha fechado", () => {
  it("produtos[].linhas não é array => 500 erro_interno (não itera silenciosamente uma string)", async () => {
    const linhasString: RespostaLer = { ...OK, produtos: [
      { modelo_id: "m1", estado: "integravel", assinatura: "s1", integrado_em: null, linhas: "nao-e-array" as any },
    ] };
    const { d } = deps({ ler: vi.fn(async () => linhasString) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(500);
    expect(await corpo(r)).toEqual({ erro: "erro_interno" });
    expect(d.confirmar).not.toHaveBeenCalled();
  });
  it("linhas[].valores não é array => 500 erro_interno", async () => {
    const valoresString: RespostaLer = { ...OK, produtos: [
      { modelo_id: "m1", estado: "integravel", assinatura: "s1", integrado_em: null, linhas: [
        { tipo: "produto", loja_nome: "Loja X", valores: "nao-e-array" as any }] },
    ] };
    const { d } = deps({ ler: vi.fn(async () => valoresString) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(500);
    expect(await corpo(r)).toEqual({ erro: "erro_interno" });
    expect(d.confirmar).not.toHaveBeenCalled();
  });
  it("produtos não é array => 500 erro_interno", async () => {
    const produtosString: RespostaLer = { ...OK, produtos: "nao-e-array" as any };
    const { d } = deps({ ler: vi.fn(async () => produtosString) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(500);
    expect(await corpo(r)).toEqual({ erro: "erro_interno" });
  });
});

describe("rota — m3: Retry-After sempre sano em 429", () => {
  it("retry_after não numérico do banco => cai para 60, nunca NaN", async () => {
    const { d } = deps({ ler: vi.fn(async () => ({ status: "limite_excedido", retry_after: Number.NaN }) as RespostaLer) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
  });
  it("429 sem retry_after nenhum ainda carrega o header (fallback 60)", async () => {
    const { d } = deps({ ler: vi.fn(async () => ({ status: "ip_bloqueado" }) as RespostaLer) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("60");
  });
  it("retry_after fora da faixa (0, negativo, gigante) é clampado entre 1 e 3600", async () => {
    const { d: d0 } = deps({ ler: vi.fn(async () => ({ status: "limite_excedido", retry_after: 0 }) as RespostaLer) });
    expect((await tratarRequisicao(req(), d0)).headers.get("retry-after")).toBe("1");
    const { d: dneg } = deps({ ler: vi.fn(async () => ({ status: "limite_excedido", retry_after: -5 }) as RespostaLer) });
    expect((await tratarRequisicao(req(), dneg)).headers.get("retry-after")).toBe("1");
    const { d: dgig } = deps({ ler: vi.fn(async () => ({ status: "limite_excedido", retry_after: 999999 }) as RespostaLer) });
    expect((await tratarRequisicao(req(), dgig)).headers.get("retry-after")).toBe("3600");
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
  it("confirmar diz chave inválida (revogada no meio) = 401, corpo exato e sem linhas", async () => {
    const { d } = deps({ confirmar: vi.fn(async () => ({ status: "chave_invalida", confirmados: [] })) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(401);
    const j = await corpo(r);
    expect(j).toEqual({ erro: "chave_invalida" });
    expect(j.linhas).toBeUndefined();
  });
  it("m6/M8: ler recebe o HASH (nunca a chave crua)", async () => {
    const { d } = deps();
    await tratarRequisicao(req(), d);
    expect(vi.mocked(d.ler).mock.calls[0][0].hash).toBe(`h(${CHAVE.length})`);
    expect(JSON.stringify(vi.mocked(d.ler).mock.calls)).not.toContain(CHAVE);
  });
  it("m7/N5: fotos_descartadas e fotos_ausentes contam sobre o MESMO conjunto (caminhos únicos válidos + inválidos)", async () => {
    // 'a.jpg' duplicado (2x, válido) + 'sumiu.jpg' ausente (válido, único) + caminho de OUTRA loja duplicado 2x
    // (inválido). Antes do fix, `descartadas` contava OCORRÊNCIA bruta (2 para o path de outra loja repetido);
    // agora conta por CAMINHO ÚNICO -- o mesmo path de outra loja repetido 2x só descarta 1.
    const comDuplicata: RespostaLer = { ...OK, produtos: [
      { modelo_id: "m1", estado: "integravel", assinatura: "s1", integrado_em: null, linhas: [
        { tipo: "produto", loja_nome: "Loja X", valores: ["Saia", [
          `${T}/fotos_modelo/a.jpg`, `${T}/fotos_modelo/a.jpg`, `${T}/fotos_modelo/sumiu.jpg`,
          `outra-loja/x.jpg`, `outra-loja/x.jpg`,
        ]] }] },
    ] };
    const { d } = deps({ ler: vi.fn(async () => comDuplicata) });
    await tratarRequisicao(req(), d);
    // 1 caminho ÚNICO de outra loja descartado (não 2, mesmo repetido 2x); sumiu.jpg é único e ausente
    expect(vi.mocked(d.confirmar).mock.calls[0][2]).toMatchObject({ fotos_descartadas: 1, fotos_ausentes: 1 });
  });
  it("sem coluna Foto (idxFoto < 0): não assina nada, confirma normalmente", async () => {
    const semFoto: RespostaLer = { ...OK, chaves_colunas: ["nome"], colunas: ["Nome"] };
    const { d } = deps({ ler: vi.fn(async () => semFoto) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(200);
    expect(d.assinarFotos).not.toHaveBeenCalled();
    expect(vi.mocked(d.confirmar).mock.calls[0][2]).toMatchObject({ fotos_descartadas: 0, fotos_ausentes: 0 });
  });
  it("valor de foto null (coluna fora do retrato do produto): preservado como null, não tenta assinar", async () => {
    const fotoNula: RespostaLer = { ...OK, produtos: [
      { modelo_id: "m1", estado: "integravel", assinatura: "s1", integrado_em: null, linhas: [
        { tipo: "produto", loja_nome: "Loja X", valores: ["Saia", null] }] },
    ] };
    const { d } = deps({ ler: vi.fn(async () => fotoNula) });
    const r = await tratarRequisicao(req(), d);
    expect(r.status).toBe(200);
    expect(d.assinarFotos).not.toHaveBeenCalled();
    const j = await corpo(r);
    expect(j.linhas[0].valores[1]).toBeNull();
  });
  it("validade_foto_dias ausente: default de 7 dias é usado na assinatura", async () => {
    const semValidade: RespostaLer = { ...OK, validade_foto_dias: undefined };
    const { d } = deps({ ler: vi.fn(async () => semValidade) });
    await tratarRequisicao(req(), d);
    expect(vi.mocked(d.assinarFotos).mock.calls[0][1]).toBe(7 * 86400);
  });
  it("depois é chamado também no modo teste e nos caminhos de erro do banco", async () => {
    const { d: dTeste } = deps({ ler: vi.fn(async () => ({ ...OK, modo: "teste" }) as RespostaLer) });
    await tratarRequisicao(req("?modo=teste"), dTeste);
    expect(dTeste.depois).toHaveBeenCalledTimes(1);
    const { d: dErro } = deps({ ler: vi.fn(async () => ({ status: "loja_inativa", tenant_id: T }) as RespostaLer) });
    await tratarRequisicao(req(), dErro);
    expect(dErro.depois).toHaveBeenCalledTimes(1);
  });
});
