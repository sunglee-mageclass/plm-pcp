import { describe, it, expect, vi } from "vitest";
import {
  calcularPrevia, ehTimeout, filtrarItens, gravarEmLotes, itensParaGravar, lerPaginaPrevia, lerResultadoAplicar, metadeDaPagina, resumirGravacao,
  resumirPrevia, temFormatoSku, totalAGravar, TAMANHO_PAGINA_MAXIMO, TAMANHO_PAGINA_MINIMO, TAMANHO_PAGINA_PADRAO, TEXTO_FALHA_TEMPO,
  TEXTO_FALHA_TEMPO_GRAVACAO, type ItemPrevia,
} from "@/lib/regerar-skus-loja";

// Regras PURAS do laco em paginas da "Regerar todos os SKUs da loja" (Review Focus 1: o teto de 8 s do banco nao aceita a loja inteira de uma vez).
const ASS = "a".repeat(32);
const item = (p: Partial<ItemPrevia> = {}): ItemPrevia => ({
  modeloId: "m1", nome: "Blusa", ref: "R1", origem: "interno", tamanhoTipo: "numero", estado: "muda", motivo: null, assinatura: ASS,
  criados: 0, atualizados: 4, removidos: 0, manuais: 0, conflitos: 0, linhas: [], erro: null, ...p,
});
const cru = (p: Record<string, unknown> = {}) => ({
  modelo_id: "m1", nome: "Blusa", ref: "R1", origem: "interno", tamanho_tipo: "numero", estado: "muda", assinatura: ASS, criados: 0, atualizados: 4,
  removidos: 0, manuais: 1, conflitos: 0, linhas: [], ...p,
});
const pagina = (ids: string[], proximo: string | null, total: number | null = null) => ({
  formato_ok: true, total_modelos: total, proximo, itens: ids.map((id) => cru({ modelo_id: id })),
});
const timeout = () => Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });

describe("lerPaginaPrevia - leitura tolerante do jsonb do servidor", () => {
  it("le os campos, as linhas (so acoes conhecidas) e o cursor", () => {
    const p = lerPaginaPrevia({
      formato_ok: true, total_modelos: 9, proximo: "m9",
      itens: [cru({ linhas: [
        { variante_key: "k1", cor_nome: "Preto", apelido_nome: "Black", tamanho_key: "34|PPP", acao: "muda", sku_de: "A", sku_para: "B", mensagem: null },
        { acao: "invalida" },
      ] })],
    });
    expect(p).toMatchObject({ formatoOk: true, totalModelos: 9, proximo: "m9" });
    expect(p.itens[0]).toMatchObject({ modeloId: "m1", estado: "muda", assinatura: ASS, manuais: 1, tamanhoTipo: "numero" });
    expect(p.itens[0].linhas).toEqual([{ varianteKey: "k1", corNome: "Preto", apelidoNome: "Black", tamanhoKey: "34|PPP", acao: "muda", skuDe: "A", skuPara: "B", mensagem: null }]);
  });
  it("FAIL-CLOSED: estado desconhecido, ou 'muda' sem assinatura md5, vira 'erro' (nunca e gravado); 'erro' do servidor traz codigo e detalhe", () => {
    const p = lerPaginaPrevia({ formato_ok: true, itens: [cru({ estado: "novo-estado" }), cru({ assinatura: null }), cru({ estado: "erro", codigo: "XX001", detalhe: "boom" })] });
    expect(p.itens.map((i) => i.estado)).toEqual(["erro", "erro", "erro"]);
    expect(p.itens[2].erro).toEqual({ codigo: "XX001", detalhe: "boom" });
    expect(itensParaGravar(p.itens)).toEqual([]);
  });
  it("lixo vira pagina vazia sem formato (nunca lanca)", () => {
    expect(lerPaginaPrevia(null)).toEqual({ formatoOk: false, totalModelos: null, itens: [], proximo: null });
    expect(lerPaginaPrevia("x").itens).toEqual([]);
  });
});

describe("ehTimeout / metadeDaPagina", () => {
  it("57014, 504, 408 e os textos do Postgres/gateway; erro comum nao", () => {
    expect(ehTimeout(timeout())).toBe(true);
    expect(ehTimeout({ code: "504", message: "x" })).toBe(true);
    expect(ehTimeout({ message: "Gateway Timeout" })).toBe(true);
    expect(ehTimeout({ code: "42501", message: "sem permissao" })).toBe(false);
    expect(ehTimeout(null)).toBe(false);
  });
  it("metade, nunca abaixo do minimo (25 -> 12 -> 6 -> 5 -> 5)", () => {
    expect([25, 12, 6, 5].map(metadeDaPagina)).toEqual([12, 6, 5, 5]);
    expect(TAMANHO_PAGINA_PADRAO).toBe(25);
    expect(TAMANHO_PAGINA_MAXIMO).toBe(50);
    expect(TAMANHO_PAGINA_MINIMO).toBe(5);
  });
});

describe("calcularPrevia - laco em paginas com recuo (Review Focus 1)", () => {
  it("segue o cursor ate o fim, acumula os itens, o total vem da 1a pagina e NENHUMA chamada pede a loja inteira (limite padrao 25)", async () => {
    const chamar = vi.fn(async ({ apos }: { apos: string | null }) =>
      apos === null ? pagina(["a", "b"], "b", 5) : apos === "b" ? pagina(["c", "d"], "d") : pagina(["e"], null));
    const aoPagina = vi.fn();
    const r = await calcularPrevia({ tenantId: "t", chamar, aoPagina });
    expect(r).toMatchObject({ status: "completo", proximo: null, formatoOk: true, total: 5, tamanho: 25 });
    expect(r.itens.map((i) => i.modeloId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(chamar.mock.calls.map(([a]) => [a.apos, a.limite])).toEqual([[null, 25], ["b", 25], ["d", 25]]);
    expect(aoPagina.mock.calls.map(([p]) => p.feitos)).toEqual([2, 4, 5]);
  });
  it("o tamanho inicial pedido e limitado a 50 (teto do servidor) e a 5 no minimo", async () => {
    const chamar = vi.fn(async () => pagina(["a"], null));
    await calcularPrevia({ tenantId: "t", chamar, tamanhoInicial: 500 });
    await calcularPrevia({ tenantId: "t", chamar, tamanhoInicial: 1 });
    expect(chamar.mock.calls.map(([a]) => a.limite)).toEqual([50, 5]);
  });
  it("TIMEOUT numa pagina: repete a MESMA pagina (mesmo cursor) com a metade; o tamanho menor vale para as proximas", async () => {
    let falhou = false;
    const chamar = vi.fn(async ({ apos, limite }: { apos: string | null; limite: number }) => {
      if (apos === "b" && limite === 25 && !falhou) { falhou = true; throw timeout(); }
      return apos === null ? pagina(["a", "b"], "b") : apos === "b" ? pagina(["c"], "c") : pagina(["d"], null);
    });
    const aoRecuar = vi.fn();
    const r = await calcularPrevia({ tenantId: "t", chamar, aoRecuar });
    expect(r.status).toBe("completo");
    expect(r.itens.map((i) => i.modeloId)).toEqual(["a", "b", "c", "d"]);
    expect(chamar.mock.calls.map(([a]) => [a.apos, a.limite])).toEqual([[null, 25], ["b", 25], ["b", 12], ["c", 12]]);
    expect(aoRecuar).toHaveBeenCalledWith(12);
    expect(r.tamanho).toBe(12);
  });
  it("timeout repetido: 25 -> 12 -> 6 -> 5 e PARA (falha por tempo) no cursor da pagina que falhou, com os itens ja calculados; da para continuar", async () => {
    let bloqueado = true;
    const chamar = vi.fn(async ({ apos }: { apos: string | null; limite: number }) => {
      if (apos === null) return pagina(["a"], "a");
      if (bloqueado) throw timeout();
      return pagina(["b"], null);
    });
    const r = await calcularPrevia({ tenantId: "t", chamar });
    expect(r).toMatchObject({ status: "falha", proximo: "a", tamanho: 5, falha: { tempo: true } });
    expect(r.itens.map((i) => i.modeloId)).toEqual(["a"]);
    expect(chamar.mock.calls.filter(([a]) => a.apos === "a").map(([a]) => a.limite)).toEqual([25, 12, 6, 5]);
    bloqueado = false;
    const r2 = await calcularPrevia({ tenantId: "t", chamar, continuarDe: r.proximo, jaTem: r.itens, tamanhoInicial: r.tamanho });
    expect(r2.status).toBe("completo");
    expect(r2.itens.map((i) => i.modeloId)).toEqual(["a", "b"]);
  });
  it("erro que NAO e tempo para na hora (sem recuo) e guarda o cursor", async () => {
    const chamar = vi.fn(async () => { throw Object.assign(new Error("sem permissao"), { code: "42501" }); });
    const r = await calcularPrevia({ tenantId: "t", chamar });
    expect(r).toMatchObject({ status: "falha", proximo: null, falha: { tempo: false } });
    expect(chamar).toHaveBeenCalledTimes(1);
  });
  it("cancelar entre paginas: status 'cancelado' com o cursor e o que ja foi calculado; nada mais e chamado", async () => {
    let n = 0;
    const chamar = vi.fn(async () => pagina([`x${n++}`], `x${n}`));
    const r = await calcularPrevia({ tenantId: "t", chamar, cancelado: () => n >= 1 });
    expect(r).toMatchObject({ status: "cancelado", proximo: "x1" });
    expect(r.itens).toHaveLength(1);
    expect(chamar).toHaveBeenCalledTimes(1);
  });
  it("loja sem Formato do SKU: termina sem itens e formatoOk=false", async () => {
    const chamar = vi.fn(async () => ({ formato_ok: false, total_modelos: 7, itens: [], proximo: null }));
    expect(await calcularPrevia({ tenantId: "t", chamar })).toMatchObject({ status: "completo", itens: [], formatoOk: false, total: 7 });
  });
});

describe("gravarEmLotes - lotes de ate 25 (teto 50), recuo no tempo, idempotencia", () => {
  const itens = (n: number) => Array.from({ length: n }, (_, i) => item({ modeloId: `m${i}` }));
  const ok = (ids: string[]) => ({ resultados: ids.map((id) => ({ modelo_id: id, nome: id, ref: "R", estado: "gravado", criados: 0, atualizados: 4, removidos: 0, conflitos: 0 })) });
  it("60 produtos = 3 lotes (25, 25, 10) em ordem; so os 'muda' com assinatura entram", async () => {
    const chamar = vi.fn(async ({ itens: l }: { itens: { modelo_id: string }[] }) => ok(l.map((x) => x.modelo_id)));
    const todos = [...itens(60), item({ modeloId: "igual", estado: "igual", assinatura: ASS }), item({ modeloId: "pulado", estado: "pulado" })];
    const r = await gravarEmLotes({ tenantId: "t", itens: itensParaGravar(todos), chamar });
    expect(r).toMatchObject({ status: "completo", restantes: [] });
    expect(chamar.mock.calls.map(([a]) => a.itens.length)).toEqual([25, 25, 10]);
    expect(r.resultados).toHaveLength(60);
    expect(chamar.mock.calls[0][0].itens[0]).toEqual({ modelo_id: "m0", assinatura: ASS });
  });
  it("lote que estoura o tempo volta com a metade (o mesmo lote reenviado e idempotente no servidor)", async () => {
    let falhou = false;
    const chamar = vi.fn(async ({ itens: l }: { itens: { modelo_id: string }[] }) => {
      if (!falhou) { falhou = true; throw timeout(); }
      return ok(l.map((x) => x.modelo_id));
    });
    const r = await gravarEmLotes({ tenantId: "t", itens: itens(30), chamar });
    expect(r.status).toBe("completo");
    expect(chamar.mock.calls.map(([a]) => a.itens.length)).toEqual([25, 12, 12, 6]);
    expect(r.resultados.map((x) => x.modeloId)).toEqual(itens(30).map((i) => i.modeloId));
  });
  it("falha (nao tempo) no 2o lote: o 1o FICA gravado, os restantes voltam para 'continuar'; cancelar tambem devolve os restantes", async () => {
    let n = 0;
    const chamar = vi.fn(async ({ itens: l }: { itens: { modelo_id: string }[] }) => {
      if (++n === 2) throw new Error("rede caiu");
      return ok(l.map((x) => x.modelo_id));
    });
    const r = await gravarEmLotes({ tenantId: "t", itens: itens(60), chamar });
    expect(r).toMatchObject({ status: "falha", falha: { tempo: false } });
    expect(r.resultados).toHaveLength(25);
    expect(r.restantes).toHaveLength(35);
    const c2 = vi.fn(async ({ itens: l }: { itens: { modelo_id: string }[] }) => ok(l.map((x) => x.modelo_id)));
    let cancela = false;
    const rc = await gravarEmLotes({ tenantId: "t", itens: itens(60), chamar: c2, cancelado: () => cancela, aoLote: () => { cancela = true; } });
    expect(rc).toMatchObject({ status: "cancelado" });
    expect(rc.resultados).toHaveLength(25);
    expect(rc.restantes).toHaveLength(35);
  });
  it("timeout repetido na gravacao: para no minimo (25 -> 12 -> 6 -> 5), falha por tempo, e o que ja foi gravado FICA (os restantes voltam)", async () => {
    let n = 0;
    const chamar = vi.fn(async ({ itens: l }: { itens: { modelo_id: string }[] }) => {
      if (++n === 1) return ok(l.map((x) => x.modelo_id)); // 1o lote grava
      throw timeout();
    });
    const r = await gravarEmLotes({ tenantId: "t", itens: itens(60), chamar });
    expect(r).toMatchObject({ status: "falha", tamanho: 5, falha: { tempo: true } });
    expect(r.resultados).toHaveLength(25);
    expect(r.restantes).toHaveLength(35);
    expect(chamar.mock.calls.map(([a]) => a.itens.length)).toEqual([25, 25, 12, 6, 5]);
  });
  it("lerResultadoAplicar: estado desconhecido vira 'erro'; resumirGravacao separa gravados/desatualizados/pulados/erros", () => {
    const r = lerResultadoAplicar({ resultados: [
      { modelo_id: "a", estado: "gravado", criados: 1, atualizados: 2, removidos: 3 }, { modelo_id: "b", estado: "desatualizado" },
      { modelo_id: "c", estado: "pulado", motivo: "integracao" }, { modelo_id: "d", estado: "erro", codigo: "XX001", detalhe: "boom" }, { modelo_id: "e", estado: "???" },
    ] });
    const s = resumirGravacao(r.resultados);
    expect([s.gravados.length, s.desatualizados.length, s.pulados.length, s.erros.length, s.skusGravados]).toEqual([1, 1, 1, 2, 6]);
    expect(r.resultados[2].motivo).toBe("integracao");
  });
});

describe("textos de falha por tempo - a previa nao grava nada; a gravacao deixa o que ja foi gravado", () => {
  it("o texto da PREVIA diz 'nada foi gravado'; o da GRAVACAO nunca diz isso e diz que o ja gravado fica", () => {
    expect(TEXTO_FALHA_TEMPO).toMatch(/Nada foi gravado/);
    expect(TEXTO_FALHA_TEMPO_GRAVACAO).not.toMatch(/nada foi gravado/i);
    expect(TEXTO_FALHA_TEMPO_GRAVACAO).toMatch(/já gravados? (fica|ficam)/i);
    expect(TEXTO_FALHA_TEMPO_GRAVACAO).toMatch(/continuar/i);
  });
});

describe("resumirPrevia / totalAGravar / filtrarItens - contadores do cabecalho do Dialog", () => {
  const lista: ItemPrevia[] = [
    item({ modeloId: "1", criados: 1, atualizados: 3, removidos: 2, manuais: 1, conflitos: 1 }),
    item({ modeloId: "2", criados: 0, atualizados: 2, removidos: 0, manuais: 0 }),
    item({ modeloId: "3", estado: "igual", criados: 0, atualizados: 0, removidos: 0, manuais: 2, assinatura: ASS }),
    item({ modeloId: "4", estado: "conflito", criados: 0, atualizados: 0, removidos: 0, manuais: 0, conflitos: 4 }),
    item({ modeloId: "5", estado: "pulado", motivo: "integracao", assinatura: null }),
    item({ modeloId: "6", estado: "pulado", motivo: "ja_exportado", assinatura: null }),
    item({ modeloId: "7", estado: "pulado", motivo: "sem_ref", assinatura: null }),
    item({ modeloId: "8", estado: "erro", assinatura: null, erro: { codigo: "X", detalhe: "y" } }),
  ];
  it("conta SKUs (mudam/novos/removidos/manuais/conflitos) e produtos por estado; pulados por motivo", () => {
    expect(resumirPrevia(lista)).toEqual({
      mudam: 5, novos: 1, removidos: 2, manuaisPreservados: 3, conflitos: 5, produtosMudam: 2, produtosIguais: 1, produtosConflito: 1, produtosErro: 1,
      pulados: { integracao: 1, ja_exportado: 1, sem_ref: 1, sem_tamanho: 0, sem_formato: 0, outra_loja: 0 }, totalPulados: 3,
    });
  });
  it("'Regerar N SKUs em M produtos' = tudo que o servidor grava nos produtos 'muda'", () => {
    expect(totalAGravar(lista)).toEqual({ skus: 8, produtos: 2 });
  });
  it("filtros: so os que mudam | conflitos (inclui 'muda' com conflito) | pulados | iguais | erro", () => {
    expect(filtrarItens(lista, "muda").map((i) => i.modeloId)).toEqual(["1", "2"]);
    expect(filtrarItens(lista, "conflito").map((i) => i.modeloId)).toEqual(["1", "4"]);
    expect(filtrarItens(lista, "pulados").map((i) => i.modeloId)).toEqual(["5", "6", "7"]);
    expect(filtrarItens(lista, "igual").map((i) => i.modeloId)).toEqual(["3"]);
    expect(filtrarItens(lista, "erro").map((i) => i.modeloId)).toEqual(["8"]);
  });
});

describe("temFormatoSku - o mesmo predicado do servidor", () => {
  it("sku_config nulo ou partes = [] = sem Formato; com partes (ou sem a chave partes) = com Formato", () => {
    expect(temFormatoSku(null)).toBe(false);
    expect(temFormatoSku(undefined)).toBe(false);
    expect(temFormatoSku("x")).toBe(false);
    expect(temFormatoSku({ partes: [], separadores: {}, cor_no_nome: "cor_base" })).toBe(false);
    expect(temFormatoSku({ partes: ["ref", "cor_base", "tamanho"], separadores: {} })).toBe(true);
    expect(temFormatoSku({ cor_no_nome: "cor_base" })).toBe(true); // sem a chave partes: o servidor nao a trata como []
  });
});
