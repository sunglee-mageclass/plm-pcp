import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { MAX_GERAR_JSON, gerarJson, resultadoParaRede, type DepsGerarJson } from "@/lib/integracao/api/gerar-json";
import type { RespostaLer } from "@/lib/integracao/api/resposta";
import {
  MOTIVO_FORA_GERAR_JSON, classificarGerarJson, completarFora, entramGerarJson, motivoGerarJson, passamAIntegrado, reexportacaoGerarJson, resumoResultadoGerarJson, nomeArquivoJson, tetoDaTela, tetoGerarJson,
} from "@/lib/integracao/gerar-json";
import type { ProdutoLista } from "@/lib/integracao/produtos";

const T = "11111111-1111-4111-8111-111111111111";
const ENTRADA = { modelo_ids: ["m1", "m2"], loja: T };
const LER: RespostaLer = {
  status: "ok", modo: "manual", acesso_id: "ac1", tenant_id: T, loja: { id: T, nome: "Loja X" },
  colunas: ["Nome", "REF/SKU", "Foto"], chaves_colunas: ["nome", "ref_sku", "foto"], proximo_cursor: null, validade_foto_dias: 5,
  pagina: { limite: 2, maximo: 50 },
  produtos: [
    { modelo_id: "m1", estado: "integravel", assinatura: "s1", integrado_em: null, linhas: [
      { tipo: "produto", loja_nome: "Loja X", valores: ["Saia", "SAI001", [`${T}/fotos_modelo/a.jpg`, `outra-loja/fotos_modelo/x.jpg`, `${T}/../x.jpg`, `${T}/fotos_modelo/sumiu.jpg`]] },
      { tipo: "variante", loja_nome: "Loja X", valores: ["Saia P", "SAI001-P", []] }] },
    { modelo_id: "m2", estado: "integravel", assinatura: "s2", integrado_em: null, linhas: [{ tipo: "produto", valores: ["Blusa", "BLU002", []] }] },
  ],
  fora: [{ modelo_id: "m9", nome: "Calça", ref: "CAL9", motivo: "nao_integravel" }],
};
function deps(o: Partial<DepsGerarJson> = {}) {
  const d: DepsGerarJson = {
    ler: vi.fn(async () => LER),
    assinarFotos: vi.fn(async (c: string[]) => new Map(c.map((p) => [p, p.endsWith("sumiu.jpg") ? null : `https://s/${p}?t=1`]))),
    confirmar: vi.fn(async () => ({
      status: "ok", confirmados: [{ modelo_id: "m1", integrado_em: "2026-10-04T18:32:10.214532+00:00" }, { modelo_id: "m2", integrado_em: "2026-10-01T10:00:00+00:00" }],
      novos: 1, relidos: 1,
    })),
    agora: () => new Date("2026-10-04T18:32:09.871Z"),
    ...o,
  };
  return d;
}

describe("gerarJson — orquestração (deps falsas)", () => {
  it("assina SÓ os caminhos da loja (outra loja e '..' são descartados e contados) e confirma com acesso_id + contadores", async () => {
    const d = deps();
    const r = await gerarJson(ENTRADA, d);
    expect(d.assinarFotos).toHaveBeenCalledTimes(1);
    expect(d.assinarFotos).toHaveBeenCalledWith([`${T}/fotos_modelo/a.jpg`, `${T}/fotos_modelo/sumiu.jpg`], 5 * 86400);
    expect(d.confirmar).toHaveBeenCalledWith("ac1", {
      produtos: [{ modelo_id: "m1", assinatura: "s1" }, { modelo_id: "m2", assinatura: "s2" }],
      fotos_descartadas: 2, fotos_ausentes: 1,
    });
    expect(r.ok && !r.vazio).toBe(true);
    if (!r.ok || r.vazio) return;
    expect(r.novos).toBe(1);
    expect(r.relidos).toBe(1);
    expect(r.validadeFotoDias).toBe(5);
    // links: o assinado vai; o ausente (storage sem o arquivo), o de outra loja e o com '..' viram null (como na API)
    expect(r.json.produtos[0].foto).toEqual([`https://s/${T}/fotos_modelo/a.jpg?t=1`, null, null, null]);
  });
  it("json: modo manual, proximo_cursor null, pagina repassada, integrado_em da confirmação, SEM `fora` no arquivo", async () => {
    const r = await gerarJson(ENTRADA, deps());
    if (!r.ok || r.vazio) throw new Error("esperava json");
    expect(r.json.versao).toBe(1);
    expect(r.json.modo).toBe("manual");
    expect(r.json.proximo_cursor).toBeNull();
    expect(r.json.pagina).toEqual({ limite: 2, maximo: 50 });
    expect(r.json.gerado_em).toBe("2026-10-04T18:32:09.871Z");
    expect(r.json.produtos.map((p) => p.integrado_em)).toEqual(["2026-10-04T18:32:10.214532+00:00", "2026-10-01T10:00:00+00:00"]);
    expect(r.json.produtos[0].variantes).toHaveLength(1);
    // nota 2 do revisor: o `fora` NUNCA vai para o arquivo (nem no topo, nem nos produtos)
    expect(Object.keys(r.json)).not.toContain("fora");
    expect(JSON.stringify(r.json)).not.toContain("nao_integravel");
    expect(JSON.stringify(r.json)).not.toContain("Calça");
    // ...mas vai no resultado para a tela
    expect(r.fora).toEqual([{ modelo_id: "m9", nome: "Calça", ref: "CAL9", motivo: "nao_integravel" }]);
  });
  it("produto não confirmado sai do JSON e entra no `fora` com `mudou` (nome/ref da linha lida)", async () => {
    const d = deps({ confirmar: vi.fn(async () => ({ status: "ok", confirmados: [{ modelo_id: "m1", integrado_em: "2026-10-04T18:32:10+00:00" }], novos: 1, relidos: 0 })) });
    const r = await gerarJson(ENTRADA, d);
    if (!r.ok || r.vazio) throw new Error("esperava json");
    expect(r.json.produtos.map((p) => p.produto_id)).toEqual(["m1"]);
    expect(r.fora).toEqual([
      { modelo_id: "m9", nome: "Calça", ref: "CAL9", motivo: "nao_integravel" },
      { modelo_id: "m2", nome: "Blusa", ref: "BLU002", motivo: "mudou" },
    ]);
  });
  it("M1: confirmou 0 (todos voltaram/foram desfeitos entre as fases) => vazio, com os `mudou` no fora — nunca um arquivo vazio", async () => {
    const d = deps({ confirmar: vi.fn(async () => ({ status: "ok", confirmados: [], novos: 0, relidos: 0 })) });
    const r = await gerarJson(ENTRADA, d);
    expect(r).toEqual({ ok: true, vazio: true, fora: [
      { modelo_id: "m9", nome: "Calça", ref: "CAL9", motivo: "nao_integravel" },
      { modelo_id: "m1", nome: "Saia", ref: "SAI001", motivo: "mudou" },
      { modelo_id: "m2", nome: "Blusa", ref: "BLU002", motivo: "mudou" },
    ] });
  });
  it("M5: `tenant_id` da leitura diferente da loja pedida => falha fechado ANTES de assinar fotos ou confirmar", async () => {
    const d = deps({ ler: vi.fn(async () => ({ ...LER, tenant_id: "22222222-2222-4222-8222-222222222222" })) });
    expect(await gerarJson(ENTRADA, d)).toEqual({ ok: false, erro: { code: "ERRO_INTERNO", message: "gerar_json_falhou" } });
    expect(d.assinarFotos).not.toHaveBeenCalled();
    expect(d.confirmar).not.toHaveBeenCalled();
  });
  it("vazio: sem produtos elegíveis => vazio:true com o fora do banco, sem assinar nem confirmar", async () => {
    const d = deps({ ler: vi.fn(async () => ({ ...LER, acesso_id: undefined, produtos: [], pagina: { limite: 0, maximo: 50 } })) });
    const r = await gerarJson(ENTRADA, d);
    expect(r).toEqual({ ok: true, vazio: true, fora: LER.fora });
    expect(d.assinarFotos).not.toHaveBeenCalled();
    expect(d.confirmar).not.toHaveBeenCalled();
  });
  it("erro de `ler` (PostgrestError) vira {ok:false, erro:{code,message}} com code e message preservados (nunca lança)", async () => {
    const d = deps({ ler: vi.fn(async () => { throw { code: "P0001", message: "gerar_json_itens: envie de 1 a 50 produtos", details: null }; }) });
    expect(await gerarJson(ENTRADA, d)).toEqual({ ok: false, erro: { code: "P0001", message: "gerar_json_itens: envie de 1 a 50 produtos" } });
    expect(d.confirmar).not.toHaveBeenCalled();
  });
  it("erro de `confirmar` também preserva code/message (ex.: 42501 se a permissão caiu entre as fases)", async () => {
    const d = deps({ confirmar: vi.fn(async () => { throw { code: "42501", message: "Sem permissão para editar a Integração." }; }) });
    expect(await gerarJson(ENTRADA, d)).toEqual({ ok: false, erro: { code: "42501", message: "Sem permissão para editar a Integração." } });
  });
  it("erro inesperado (Error comum) vira ERRO_INTERNO / gerar_json_falhou — sem vazar a mensagem", async () => {
    const d = deps({ ler: vi.fn(async () => { throw new Error("connection string postgres://segredo"); }) });
    expect(await gerarJson(ENTRADA, d)).toEqual({ ok: false, erro: { code: "ERRO_INTERNO", message: "gerar_json_falhou" } });
    const d2 = deps({ assinarFotos: vi.fn(async () => { throw new Error("storage caiu"); }) });
    expect(await gerarJson(ENTRADA, d2)).toEqual({ ok: false, erro: { code: "ERRO_INTERNO", message: "gerar_json_falhou" } });
  });
  it("nota 3 do revisor: confirmar sem reserva (`parametro_invalido`, HTTP 200) é FALHA, nunca sucesso", async () => {
    const d = deps({ confirmar: vi.fn(async () => ({ status: "parametro_invalido", confirmados: [] })) });
    const r = await gerarJson(ENTRADA, d);
    expect(r).toEqual({ ok: false, erro: { code: "P0001", message: "gerar_json_falhou: confirmacao" } });
  });
  it("modo diferente de manual (ou status != ok) falha fechado, sem confirmar", async () => {
    for (const ler of [{ ...LER, modo: "normal" as const }, { ...LER, modo: undefined }, { ...LER, status: "limite_excedido" as const }]) {
      const d = deps({ ler: vi.fn(async () => ler) });
      expect(await gerarJson(ENTRADA, d)).toEqual({ ok: false, erro: { code: "ERRO_INTERNO", message: "gerar_json_falhou" } });
      expect(d.confirmar).not.toHaveBeenCalled();
    }
  });
  it("sem acesso_id com produtos: falha fechado (nunca confirma às cegas)", async () => {
    const d = deps({ ler: vi.fn(async () => ({ ...LER, acesso_id: undefined })) });
    expect(await gerarJson(ENTRADA, d)).toEqual({ ok: false, erro: { code: "ERRO_INTERNO", message: "gerar_json_falhou" } });
    expect(d.confirmar).not.toHaveBeenCalled();
  });
  it("formato inválido do validarFormato (2 linhas de produto) falha fechado antes de assinar/confirmar", async () => {
    const ruim: RespostaLer = { ...LER, produtos: [{ modelo_id: "m1", estado: "integravel", assinatura: "s", integrado_em: null, linhas: [
      { tipo: "produto", valores: ["A", "A1", []] }, { tipo: "produto", valores: ["B", "B1", []] }] }] };
    const d = deps({ ler: vi.fn(async () => ruim) });
    expect(await gerarJson(ENTRADA, d)).toEqual({ ok: false, erro: { code: "ERRO_INTERNO", message: "gerar_json_falhou" } });
    expect(d.assinarFotos).not.toHaveBeenCalled();
    expect(d.confirmar).not.toHaveBeenCalled();
  });
  it("`resultadoParaRede`: o texto é o JSON formatado UMA vez, sem `fora`", async () => {
    const r = await gerarJson(ENTRADA, deps());
    const rede = resultadoParaRede(r);
    if (!rede.ok || rede.vazio) throw new Error("esperava texto");
    expect(rede.geradoEm).toBe("2026-10-04T18:32:09.871Z");
    const parsed = JSON.parse(rede.texto);
    expect(parsed.modo).toBe("manual");
    expect(parsed).not.toHaveProperty("fora");
    expect(rede.texto).toBe(JSON.stringify(parsed, null, 2));
    expect(resultadoParaRede({ ok: false, erro: { code: "x", message: "y" } })).toEqual({ ok: false, erro: { code: "x", message: "y" } });
  });
});

const prod = (o: Partial<ProdutoLista> & { id: string }): ProdutoLista => ({
  modeloId: o.id, origem: "interno", colecao: null, etapa: null, estado: "integravel", marcadoEm: null, integradoEm: null, rev: 1,
  raw: { nome: `P ${o.id}`, ref: `R${o.id}` } as ProdutoLista["raw"], vivo: null, faltas: [], completo: true, sublinhas: [],
  retrato: { campos: ["nome"], linhas: [] }, retratoDifere: [], retratoDifereSublinhas: false, gates: {} as ProdutoLista["gates"],
  moduloBloqueado: false, reprovado: false, ...o,
}) as ProdutoLista;
const comCusto = { campos: ["nome", "preco_custo"], linhas: [] } as unknown as ProdutoLista["retrato"];

describe("classificarGerarJson / motivoGerarJson / tetoGerarJson", () => {
  it("4 classes e prioridade nao_integravel > reprovado > sem_custo", () => {
    const sel = [
      prod({ id: "a" }), prod({ id: "b", estado: "integrado" }), prod({ id: "c", estado: "nao_integravel", reprovado: true }),
      prod({ id: "d", reprovado: true, retrato: comCusto }), prod({ id: "e", retrato: comCusto }),
    ];
    const c = classificarGerarJson(sel, { podeVerCustos: false });
    expect(c.novos.map((p) => p.modeloId)).toEqual(["a"]);
    expect(c.reexportar.map((p) => p.modeloId)).toEqual(["b"]);
    expect(c.fora.map((f) => [f.p.modeloId, f.motivo])).toEqual([["c", "nao_integravel"], ["d", "reprovado"], ["e", "sem_custo"]]);
    // quem vê custos: o `e` entra
    expect(classificarGerarJson(sel, { podeVerCustos: true }).novos.map((p) => p.modeloId)).toEqual(["a", "e"]);
  });
  it("integrado reprovado CONTINUA entrando (o banco faz igual); integrado com custo e sem ver custos fica sem_custo", () => {
    const c = classificarGerarJson([prod({ id: "x", estado: "integrado", reprovado: true }), prod({ id: "y", estado: "integrado", retrato: comCusto })], { podeVerCustos: false });
    expect(c.reexportar.map((p) => p.modeloId)).toEqual(["x"]);
    expect(c.fora.map((f) => [f.p.modeloId, f.motivo])).toEqual([["y", "sem_custo"]]);
  });
  it("motivoGerarJson: 0 selecionados, sem editar, acima do teto, nenhum elegível, ok", () => {
    const vazio = classificarGerarJson([], { podeVerCustos: true });
    expect(motivoGerarJson([], vazio, true)).toBe("Selecione produtos.");
    const um = [prod({ id: "a" })];
    const cUm = classificarGerarJson(um, { podeVerCustos: true });
    expect(motivoGerarJson(um, cUm, false)).toBe("Precisa da permissão de editar a Integração.");
    expect(motivoGerarJson(um, cUm, true)).toBeNull();
    const muitos = Array.from({ length: MAX_GERAR_JSON + 1 }, (_, i) => prod({ id: `p${i}` }));
    expect(motivoGerarJson(muitos, classificarGerarJson(muitos, { podeVerCustos: true }), true)).toBe(`Máximo de ${MAX_GERAR_JSON} produtos por arquivo.`);
    // teto menor da loja (nota 1 do revisor): a mensagem usa o número recebido, nunca uma constante
    const tres = Array.from({ length: 3 }, (_, i) => prod({ id: `q${i}` }));
    expect(motivoGerarJson(tres, classificarGerarJson(tres, { podeVerCustos: true }), true, 2)).toBe("Máximo de 2 produtos por arquivo.");
    const nao = [prod({ id: "n", estado: "nao_integravel" })];
    expect(motivoGerarJson(nao, classificarGerarJson(nao, { podeVerCustos: true }), true)).toBe("Nenhum selecionado está Integrável ou Integrado.");
  });
  it("tetoGerarJson = min(absoluto, máx. por página da loja); sem config vale o absoluto", () => {
    expect(tetoGerarJson(undefined)).toBe(MAX_GERAR_JSON);
    expect(tetoGerarJson(null)).toBe(MAX_GERAR_JSON);
    expect(tetoGerarJson(50)).toBe(50);
    expect(tetoGerarJson(500)).toBe(MAX_GERAR_JSON);
    expect(tetoGerarJson(0)).toBe(MAX_GERAR_JSON);
  });
  it("I1: o teto da tela vem da RPC para todos — carregando = null (botão desabilitado com motivo); erro = absoluto", () => {
    expect(tetoDaTela(undefined, false)).toBeNull();
    expect(tetoDaTela(null, false)).toBeNull();
    expect(tetoDaTela(undefined, true)).toBe(MAX_GERAR_JSON);
    expect(tetoDaTela(50, false)).toBe(50);
    expect(tetoDaTela(500, false)).toBe(MAX_GERAR_JSON);
    const um = [prod({ id: "a" })];
    const c = classificarGerarJson(um, { podeVerCustos: true });
    expect(motivoGerarJson(um, c, true, null)).toBe("Carregando o limite por arquivo…");
    expect(motivoGerarJson([], classificarGerarJson([], { podeVerCustos: true }), true, null)).toBe("Selecione produtos.");
    expect(motivoGerarJson(um, c, false, null)).toBe("Precisa da permissão de editar a Integração.");
    const tres = Array.from({ length: 3 }, (_, i) => prod({ id: `t${i}` }));
    expect(motivoGerarJson(tres, classificarGerarJson(tres, { podeVerCustos: true }), true, 50)).toBeNull();
    const cinquentaUm = Array.from({ length: 51 }, (_, i) => prod({ id: `u${i}` }));
    expect(motivoGerarJson(cinquentaUm, classificarGerarJson(cinquentaUm, { podeVerCustos: true }), true, 50)).toBe("Máximo de 50 produtos por arquivo.");
  });
  it("M4: completarFora preenche nome/REF ausentes pelos produtos da tela (por modelo_id) e não toca no que já veio", () => {
    const fora = [
      { modelo_id: "a", nome: null, ref: null, motivo: "mudou" as const },
      { modelo_id: "b", nome: "Do banco", ref: "RB", motivo: "mudou" as const },
      { modelo_id: "zz", nome: null, ref: null, motivo: "mudou" as const },
    ];
    expect(completarFora(fora, [prod({ id: "a" }), prod({ id: "b" })])).toEqual([
      { modelo_id: "a", nome: "P a", ref: "Ra", motivo: "mudou" },
      { modelo_id: "b", nome: "Do banco", ref: "RB", motivo: "mudou" },
      { modelo_id: "zz", nome: null, ref: null, motivo: "mudou" },
    ]);
  });
  it("MOTIVO_FORA_GERAR_JSON cobre os 4 motivos", () => {
    expect(Object.keys(MOTIVO_FORA_GERAR_JSON).sort()).toEqual(["mudou", "nao_integravel", "reprovado", "sem_custo"]);
  });
});

describe("nomeArquivoJson", () => {
  it("acento e espaço viram slug ASCII; data/hora no fuso da loja", () => {
    // 02:30 UTC de 05/out = 23:30 de 04/out em America/Sao_Paulo (UTC-3)
    expect(nomeArquivoJson("Loja Têste  & Cia", new Date("2026-10-05T02:30:00Z"), "America/Sao_Paulo")).toBe("integracao-loja-teste-cia-2026-10-04-2330.json");
    expect(nomeArquivoJson("Ave Rara", new Date("2026-10-04T09:05:00Z"), "UTC")).toBe("integracao-ave-rara-2026-10-04-0905.json");
  });
  it("meia-noite não vira 24h; loja nula ou só símbolos vira `loja`", () => {
    expect(nomeArquivoJson(null, new Date("2026-10-04T03:00:00Z"), "America/Sao_Paulo")).toBe("integracao-loja-2026-10-04-0000.json");
    expect(nomeArquivoJson("###", new Date("2026-10-04T12:00:00Z"), "UTC")).toBe("integracao-loja-2026-10-04-1200.json");
  });
});

describe("Gerar JSON — fronteira servidor/navegador (fonte)", () => {
  const ler = (f: string) => readFileSync(f, "utf8");
  it("a server function importa o `.server` SÓ por import dinâmico (o service role nunca vai ao bundle do navegador)", () => {
    const f = ler("src/lib/integracao/gerar-json.functions.ts");
    expect(f).toMatch(/await import\("@\/lib\/integracao\/api\/gerar-json\.server"\)/);
    expect(f).not.toMatch(/^import .*\.server/m);
    expect(f).not.toMatch(/client\.server/);
    expect(f).toMatch(/requireSupabaseAuth/);
  });
  it("ler/confirmar vão pelo cliente do USUÁRIO (JWT), nunca pelo service role; o service role só assina fotos", () => {
    const s = ler("src/lib/integracao/api/gerar-json.server.ts");
    expect(s).not.toMatch(/supabaseAdmin/);
    expect(s).not.toMatch(/client\.server/);
    expect(s).toMatch(/rpc\("integracao_gerar_json_ler"/);
    expect(s).toMatch(/rpc\("integracao_gerar_json_confirmar"/);
    const f = ler("src/lib/integracao/api/fotos.server.ts");
    const usos = [...f.matchAll(/supabaseAdmin\.[A-Za-z.]+/g)].map((m) => m[0]);
    expect(usos).toEqual(["supabaseAdmin.storage.from"]);
    expect(f).toMatch(/from\("modelos"\)\.createSignedUrls\(/);
  });
  it("fonte ÚNICA: a rota da API e o Gerar JSON usam o MESMO `entregar` (nenhum dos dois reimplementa fotos/confirmar)", () => {
    expect(ler("src/lib/integracao/api/rota.ts")).toMatch(/export async function entregar\(/);
    expect(ler("src/lib/integracao/api/rota.ts")).toMatch(/await entregar\(/);
    const g = ler("src/lib/integracao/api/gerar-json.ts");
    expect(g).toMatch(/await entregar\(/);
    expect(g).not.toMatch(/createSignedUrls|daLoja|caminhosFoto/);
  });
  it("M3: o bloco `createSignedUrls` de fotos.server.ts é equivalente ao de rota.server.ts (bucket + mapeamento path → link)", () => {
    const bloco = (f: string) => {
      const m = /supabaseAdmin\.storage\.from\("modelos"\)\.createSignedUrls\(caminhos, validade\);\s*if \(error\) throw error;\s*return new Map\(\(data \?\? \[\]\)\.map\(\(d\) => \[d\.path \?\? "", d\.error \? null : \(d\.signedUrl \?\? null\)\]\)\);/.exec(ler(f));
      expect(m, f).not.toBeNull();
      return m![0].replace(/\s+/g, " ");
    };
    expect(bloco("src/lib/integracao/api/fotos.server.ts")).toBe(bloco("src/lib/integracao/api/rota.server.ts"));
  });
  it("I1: a tela lê o teto pela RPC `integracao_gerar_json_teto` (todos), nunca pela config da API (`api` só vem para o super admin)", () => {
    const pa = ler("src/components/integracao/ProdutosAba.tsx");
    expect(pa).toMatch(/useTetoGerarJson\(\)/);
    expect(pa).not.toMatch(/useIntegracaoConfig|max_por_pagina/);
    expect(ler("src/components/integracao/useIntegracao.ts")).toMatch(/rpc\("integracao_gerar_json_teto"/);
  });
});

describe("concordância de número nos textos do diálogo", () => {
  it("singular e plural", () => {
    expect(resumoResultadoGerarJson(1, 1, 0)).toBe("1 passou a Integrado · 1 reexportado · 0 fora");
    expect(resumoResultadoGerarJson(0, 2, 3)).toBe("0 passaram a Integrado · 2 reexportados · 3 fora");
    expect(resumoResultadoGerarJson(5, 0, 1)).toBe("5 passaram a Integrado · 0 reexportados · 1 fora");
    expect([1, 2].map(entramGerarJson)).toEqual(["Entra", "Entram"]);
    expect([1, 2].map(passamAIntegrado)).toEqual(["passa a Integrado", "passam a Integrado"]);
    expect([1, 2].map(reexportacaoGerarJson)).toEqual(["reexportação (já integrado)", "reexportações (já integrados)"]);
  });
  it("a key do teto é invalidada ao salvar Campos/API e a query tem retry: 1 (fonte)", () => {
    const ler = (f: string) => readFileSync(f, "utf8");
    for (const f of ["ApiAba", "CamposAba"]) expect(ler(`src/components/integracao/${f}.tsx`)).toMatch(/invalidateQueries\(\{ queryKey: chaveTetoGerarJson\(tenantId\) \}\)/);
    const u = ler("src/components/integracao/useIntegracao.ts");
    expect(u.slice(u.indexOf("function useTetoGerarJson"), u.indexOf("export type ConfigIntegracao"))).toMatch(/retry: 1/);
  });
});
