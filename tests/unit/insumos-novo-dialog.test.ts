import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import {
  aplicarInsumosPadraoEmLote,
  estadoSecaoInsumosNovo,
  gravarInsumosIniciaisDoCard,
  linhasParaRascunho,
  mensagemInsumosIniciais,
  LIMITE_INSUMOS_INICIAIS,
  normalizarInsumosPadraoParaCard,
  payloadInsumosIniciais,
  resumoToastLote,
  textoOrfaosInsumosPadrao,
} from "@/lib/insumos-iniciais";
import { mensagemErro } from "@/lib/erro-mensagem";
import {
  numerarSecoes,
  ORDEM_SECOES_SHEET,
  type SecaoSheetKey,
} from "@/components/planejamento/planejamento-detail/ficha/selos-secoes";
import type {
  EtiquetaInfo,
  ModeloEtiquetaRow,
} from "@/components/desenvolvimento/modelo-detail/types";
import { CASOS_NORMALIZA, IP_IDS } from "../fixtures/insumos-padrao-casos";

// urg R2 T12 — "+ Novo" e "Criar vários cards" nascem com os insumos padrão da loja (interno). Rascunho até o Salvar.
const { E1, E2, C1, C2, E_OUTRA, E_INEXISTENTE } = IP_IDS;

const etq = (id: string, preco: number, cores: string[]): EtiquetaInfo => ({
  id,
  nome: `ETQ ${id.slice(-3)}`,
  formato_tamanho: "nenhum",
  preco,
  variantes: cores.map((c) => ({ cor_id: c, cor_nome: c.slice(-3), preco: null })),
});
// E1 tem as cores C1 e C2; E2 não tem variantes. E_OUTRA/E_INEXISTENTE NÃO estão no catálogo da loja.
const catalogo: Record<string, EtiquetaInfo> = {
  [E1]: etq(E1, 2, [C1, C2]),
  [E2]: etq(E2, 10, []),
};

describe("normalizarInsumosPadraoParaCard — a lista crua da loja vira linhas do card, item a item", () => {
  it("os casos válidos da fixture compartilhada saem iguais ao esperado (quando o catálogo conhece insumo e cor)", () => {
    // catálogo permissivo: todas as cores da fixture existem nos dois insumos
    const cat: Record<string, EtiquetaInfo> = {
      [E1]: etq(E1, 1, [C1, C2]),
      [E2]: etq(E2, 1, [C1, C2]),
    };
    for (const caso of CASOS_NORMALIZA) {
      const r = normalizarInsumosPadraoParaCard(caso.entrada, cat);
      expect(r.linhas, caso.nome).toEqual(caso.esperado);
      expect(r.orfaos, caso.nome).toBe(0);
    }
  });
  it("mantém a ORDEM da lista e conta os órfãos (insumo de outra loja / apagado ficam de fora)", () => {
    const r = normalizarInsumosPadraoParaCard(
      [
        { etiqueta_id: E2, cor_id: null, consumo: 1 },
        { etiqueta_id: E_OUTRA, cor_id: null, consumo: 1 },
        { etiqueta_id: E1, cor_id: C1, consumo: 2 },
        { etiqueta_id: E_INEXISTENTE, cor_id: null, consumo: 3 },
      ],
      catalogo,
    );
    expect(r.linhas.map((l) => l.etiqueta_id)).toEqual([E2, E1]);
    expect(r.orfaos).toBe(2);
  });
  it("cor que não existe mais nas variantes do insumo vira null (o insumo entra sem cor)", () => {
    const r = normalizarInsumosPadraoParaCard(
      [
        { etiqueta_id: E1, cor_id: IP_IDS.C_OUTRA, consumo: 1 },
        { etiqueta_id: E2, cor_id: C1, consumo: 1 },
      ],
      catalogo,
    );
    expect(r.linhas).toEqual([
      { etiqueta_id: E1, cor_id: null, consumo: 1 },
      { etiqueta_id: E2, cor_id: null, consumo: 1 },
    ]);
    expect(r.orfaos).toBe(0);
  });
  it("valor cru ruim NUNCA lança: não-lista => vazio; item ruim é ignorado, os bons ficam", () => {
    for (const ruim of [null, undefined, {}, "[]", 7, true]) {
      expect(normalizarInsumosPadraoParaCard(ruim, catalogo)).toEqual({ linhas: [], orfaos: 0 });
    }
    const r = normalizarInsumosPadraoParaCard(
      [
        "x",
        null,
        [E1],
        { etiqueta_id: 5, consumo: 1 },
        { etiqueta_id: E1, cor_id: C1, consumo: -1 }, // faixa
        { etiqueta_id: E1, cor_id: C1, consumo: "1.5" }, // texto
        { etiqueta_id: E1, cor_id: C1, consumo: 1.00001 }, // 5 casas
        { etiqueta_id: E1, cor_id: C1, consumo: 9999.5 }, // acima
        { etiqueta_id: E2, cor_id: null, consumo: 0.5 }, // bom
      ],
      catalogo,
    );
    expect(r.linhas).toEqual([{ etiqueta_id: E2, cor_id: null, consumo: 0.5 }]);
  });
  it("par (insumo, cor) repetido: fica o 1º; uuid em caixa alta casa com o catálogo", () => {
    const r = normalizarInsumosPadraoParaCard(
      [
        { etiqueta_id: E1.toUpperCase(), cor_id: C1, consumo: 1 },
        { etiqueta_id: E1, cor_id: C1.toUpperCase(), consumo: 9 },
      ],
      catalogo,
    );
    expect(r.linhas).toEqual([{ etiqueta_id: E1, cor_id: C1, consumo: 1 }]);
  });
  it("no máximo 20 linhas VÁLIDAS (os órfãos não ocupam vaga)", () => {
    const muitos = Array.from({ length: 30 }, (_, i) => ({
      etiqueta_id: `a9e10000-0000-4000-8000-0000000f${String(i).padStart(4, "0")}`,
      cor_id: null,
      consumo: 1,
    }));
    const cat = Object.fromEntries(muitos.map((m) => [m.etiqueta_id, etq(m.etiqueta_id, 1, [])]));
    const r = normalizarInsumosPadraoParaCard(
      [{ etiqueta_id: E_OUTRA, cor_id: null, consumo: 1 }, ...muitos],
      cat,
    );
    expect(LIMITE_INSUMOS_INICIAIS).toBe(20);
    expect(r.linhas).toHaveLength(20);
    expect(r.linhas[0].etiqueta_id).toBe(muitos[0].etiqueta_id);
    expect(r.orfaos).toBe(1);
  });
  it("aviso âmbar: texto no singular/plural e vazio sem órfãos", () => {
    expect(textoOrfaosInsumosPadrao(0)).toBe("");
    expect(textoOrfaosInsumosPadrao(1)).toBe(
      "1 insumo padrão não existe mais no cadastro e ficou de fora.",
    );
    expect(textoOrfaosInsumosPadrao(3)).toBe(
      "3 insumos padrão não existem mais no cadastro e ficaram de fora.",
    );
  });
});

describe("linhasParaRascunho / payloadInsumosIniciais", () => {
  it("linhas do rascunho = ModeloEtiquetaRow na ordem, perda 0 e custo previsto da etiqueta × consumo", () => {
    const rows = linhasParaRascunho(
      [
        { etiqueta_id: E1, cor_id: C1, consumo: 3 },
        { etiqueta_id: E2, cor_id: null, consumo: 0.5 },
      ],
      catalogo,
    );
    expect(
      rows.map((r) => [r.etiqueta_id, r.cor_id, r.consumo, r.loss_percent, r.custo_previsto]),
    ).toEqual([
      [E1, C1, 3, 0, 6],
      [E2, null, 0.5, 0, 5],
    ]);
  });
  it("payload da RPC: etiqueta_id, cor_id, consumo, loss_percent; linha sem insumo escolhido sai; arredonda 4/2 casas", () => {
    const rows: ModeloEtiquetaRow[] = [
      { etiqueta_id: E1, cor_id: C1, consumo: 1.23456, loss_percent: 10.126, custo_previsto: 0 },
      { etiqueta_id: null, cor_id: null, consumo: 5, loss_percent: 0, custo_previsto: 0 },
      { etiqueta_id: E2, cor_id: null, consumo: 2, loss_percent: 0, custo_previsto: 0 },
    ];
    expect(payloadInsumosIniciais(rows)).toEqual([
      { etiqueta_id: E1, cor_id: C1, consumo: 1.2346, loss_percent: 10.13 },
      { etiqueta_id: E2, cor_id: null, consumo: 2, loss_percent: 0 },
    ]);
  });
  it("payload: no máximo 20 e vazio => []", () => {
    expect(payloadInsumosIniciais([])).toEqual([]);
    const rows = Array.from({ length: 25 }, () => ({
      etiqueta_id: E1,
      cor_id: null,
      consumo: 1,
      loss_percent: 0,
      custo_previsto: 0,
    }));
    expect(payloadInsumosIniciais(rows)).toHaveLength(20);
  });
});

describe("estadoSecaoInsumosNovo — quando a seção existe e quando trava o Salvar (P-57)", () => {
  const base = {
    isEdit: false,
    origem: "interno",
    carregando: false,
    erro: false,
    lojaPronta: true,
  };
  it("só no Dialog Novo e só origem interna; revenda/importado/edição => some e não trava", () => {
    expect(estadoSecaoInsumosNovo(base)).toEqual({ visivel: true, bloqueiaSalvar: false });
    for (const o of ["revenda", "importado"]) {
      expect(estadoSecaoInsumosNovo({ ...base, origem: o, carregando: true, erro: true })).toEqual({
        visivel: false,
        bloqueiaSalvar: false,
      });
    }
    expect(estadoSecaoInsumosNovo({ ...base, isEdit: true, erro: true })).toEqual({
      visivel: false,
      bloqueiaSalvar: false,
    });
  });
  it("carregando, erro de rede ou loja ainda não resolvida => trava o Salvar", () => {
    expect(estadoSecaoInsumosNovo({ ...base, carregando: true }).bloqueiaSalvar).toBe(true);
    expect(estadoSecaoInsumosNovo({ ...base, erro: true }).bloqueiaSalvar).toBe(true);
    expect(estadoSecaoInsumosNovo({ ...base, lojaPronta: false }).bloqueiaSalvar).toBe(true);
  });
});

describe("gravarInsumosIniciaisDoCard — o passo do Salvar do card NOVO", () => {
  const linhas: ModeloEtiquetaRow[] = [
    { etiqueta_id: E1, cor_id: C1, consumo: 2, loss_percent: 5, custo_previsto: 0 },
  ];
  it("chama a RPC UMA vez com o id criado e as linhas do rascunho", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const n = await gravarInsumosIniciaisDoCard({ modeloId: "m1", origem: "interno", linhas, rpc });
    expect(n).toBe(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("salvar_insumos_iniciais", {
      _modelo_id: "m1",
      _linhas: [{ etiqueta_id: E1, cor_id: C1, consumo: 2, loss_percent: 5 }],
    });
  });
  it("lista vazia, revenda ou importado => NÃO chama a RPC", async () => {
    const rpc = vi.fn();
    expect(
      await gravarInsumosIniciaisDoCard({ modeloId: "m1", origem: "interno", linhas: [], rpc }),
    ).toBe(0);
    expect(
      await gravarInsumosIniciaisDoCard({
        modeloId: "m1",
        origem: "interno",
        linhas: [{ ...linhas[0], etiqueta_id: null }],
        rpc,
      }),
    ).toBe(0);
    expect(
      await gravarInsumosIniciaisDoCard({ modeloId: "m1", origem: "revenda", linhas, rpc }),
    ).toBe(0);
    expect(
      await gravarInsumosIniciaisDoCard({ modeloId: "m1", origem: "importado", linhas, rpc }),
    ).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("falha da RPC => lança o erro marcado etapaFalha='insumos' (o card já existe; o onError avisa)", async () => {
    const erro = {
      code: "P0001",
      message: "insumos_iniciais_invalidos: linha 1: insumo nao encontrado nesta loja",
    };
    const rpc = vi.fn().mockResolvedValue({ error: erro });
    await expect(
      gravarInsumosIniciaisDoCard({ modeloId: "m1", origem: "interno", linhas, rpc }),
    ).rejects.toMatchObject({ etapaFalha: "insumos", code: "P0001" });
  });
});

describe("usePlanejamentoSave — a chamada mora no INSERT real (retry/2º clique NÃO regrava) e há toast próprio", () => {
  const src = readFileSync(
    "src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts",
    "utf8",
  );
  it("gravarInsumosIniciaisDoCard roda DEPOIS de gravarTecidosIniciais e DENTRO do else do INSERT (antes do bloco da grade)", () => {
    const iTec = src.indexOf("await gravarTecidosIniciais(");
    const iIns = src.indexOf("gravarInsumosIniciaisDoCard(");
    const iGrade = src.indexOf("if (isRevenda && savedId && gradeRevendaDirty)");
    expect(iTec).toBeGreaterThan(0);
    expect(iIns).toBeGreaterThan(iTec);
    expect(iIns).toBeLessThan(iGrade);
    // a chamada fica depois do `criadoIdRef.current = savedId` (só no insert real) — nunca no ramo `if (criadoIdRef.current)`
    expect(iIns).toBeGreaterThan(src.indexOf("criadoIdRef.current = savedId;"));
    expect(src.match(/gravarInsumosIniciaisDoCard\(/g)).toHaveLength(1);
  });
  it("onError tem o ramo etapaFalha==='insumos' (o card foi criado, insumos não)", () => {
    expect(src).toMatch(/etapaFalha === "insumos"/);
    expect(src).toMatch(/O card foi criado, mas os insumos NÃO foram salvos/);
  });
  it("o Dialog novo não perde o rascunho de insumos: o save lê o rascunho por ref síncrono", () => {
    expect(src).toMatch(/insumosIniciaisRef/);
  });
});

describe("seção do Dialog — chave nova, sem número, entre Tecidos e Mão de obra", () => {
  it("insumos_novo entra em ORDEM_SECOES_SHEET logo depois de tecidos_novo e antes de mao_obra_novo", () => {
    const i = ORDEM_SECOES_SHEET.indexOf("insumos_novo" as SecaoSheetKey);
    expect(i).toBeGreaterThan(ORDEM_SECOES_SHEET.indexOf("tecidos_novo"));
    expect(i).toBeLessThan(ORDEM_SECOES_SHEET.indexOf("mao_obra_novo"));
  });
  it("no Dialog Novo a numeração não muda (só Informações e Coleção)", () => {
    const v = new Set<SecaoSheetKey>([
      "info",
      "colecao",
      "tecidos_novo",
      "insumos_novo" as SecaoSheetKey,
      "mao_obra_novo",
      "anexos",
    ]);
    expect(numerarSecoes(v, { dialogNovo: true })).toEqual({ info: 1, colecao: 2 });
  });
  it("PlanejamentoDetail usa a chave e o aviso/ação do mockup", () => {
    const src = readFileSync("src/components/planejamento/PlanejamentoDetail.tsx", "utf8");
    expect(src).toMatch(/insumos_novo/);
    expect(src).toContain("Pré-preenchido com os insumos padrão da loja");
    expect(src).toContain("Tentar de novo");
  });
});

describe("Criar vários cards — aplicarInsumosPadraoEmLote", () => {
  const linhas = [{ etiqueta_id: E1, cor_id: C1, consumo: 2 }];
  it("1 chamada por card criado, com a lista normalizada (loss_percent 0); uma falha NÃO para as outras", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({
        error: { code: "P0001", message: "insumos_iniciais_ja_existem: x" },
      })
      .mockRejectedValueOnce(new Error("rede"))
      .mockResolvedValueOnce({ error: null });
    const r = await aplicarInsumosPadraoEmLote(["a", "b", "c", "d"], linhas, rpc);
    expect(rpc).toHaveBeenCalledTimes(4);
    expect(rpc).toHaveBeenNthCalledWith(1, "salvar_insumos_iniciais", {
      _modelo_id: "a",
      _linhas: [{ etiqueta_id: E1, cor_id: C1, consumo: 2, loss_percent: 0 }],
    });
    expect(r.aplicados).toBe(2);
    expect(r.falhas.map((f) => f.id)).toEqual(["b", "c"]);
  });
  it("lista vazia ou sem ids => nenhuma chamada", async () => {
    const rpc = vi.fn();
    expect(await aplicarInsumosPadraoEmLote(["a"], [], rpc)).toEqual({ aplicados: 0, falhas: [] });
    expect(await aplicarInsumosPadraoEmLote([], linhas, rpc)).toEqual({ aplicados: 0, falhas: [] });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("resumo do toast (um só): tudo certo / parcial", () => {
    expect(resumoToastLote(3, 3, 0)).toEqual({ tipo: "success", texto: "3 cards criados" });
    expect(resumoToastLote(1, 0, 0)).toEqual({ tipo: "success", texto: "1 card criado" });
    expect(resumoToastLote(3, 3, 0, true)).toEqual({
      tipo: "success",
      texto: "3 cards criados, com os insumos padrão da loja",
    });
    expect(resumoToastLote(3, 1, 2, true)).toEqual({
      tipo: "warning",
      texto:
        "3 cards criados, mas os insumos padrão não entraram em 2 deles — adicione na seção Insumos do card.",
    });
    expect(resumoToastLote(2, 0, 2, true).texto).toContain("em 2 deles");
    expect(resumoToastLote(1, 0, 1, true).texto).toContain("no card");
  });
  it("BatchCardsDialog: insert(...).select('id'), só origem interna (sem origem no payload) e trava o Criar enquanto a lista carrega/erra", () => {
    const src = readFileSync("src/routes/_authenticated/criacao.planejamento.tsx", "utf8");
    const i = src.indexOf("function BatchCardsDialog");
    const corpo = src.slice(i);
    expect(corpo).toMatch(/\.insert\(payloads\)\.select\("id"\)/);
    expect(corpo).toContain("aplicarInsumosPadraoEmLote(");
    expect(corpo).toContain("Tentar de novo");
    expect(corpo).not.toMatch(/origem:\s*"(revenda|importado)"/);
  });
});

describe("mensagens PT dos prefixos novos (erro-mensagem)", () => {
  const e = (message: string, code = "P0001") => ({ code, message });
  it("traduz so_interno / ja_existem / invalidos / funcao_desativada", () => {
    expect(mensagemErro(e("insumos_iniciais_so_interno: o card nao e interno"))).toBe(
      mensagemInsumosIniciais("P0001", "insumos_iniciais_so_interno: x"),
    );
    expect(mensagemErro(e("insumos_iniciais_so_interno: x"))).toMatch(/interno/i);
    expect(mensagemErro(e("insumos_iniciais_ja_existem: x"))).toMatch(/já tem insumos/i);
    expect(
      mensagemErro(e("insumos_iniciais_invalidos: linha 2: insumo nao encontrado nesta loja")),
    ).toMatch(/linha 2/i);
    expect(
      mensagemErro(e("insumos_iniciais_invalidos: linha 2: insumo nao encontrado nesta loja")),
    ).toMatch(/não existe mais no cadastro/i);
    expect(
      mensagemErro(
        e("insumos_iniciais_invalidos: linha 1: consumo com no maximo 4 casas decimais"),
      ),
    ).toMatch(/4 casas/);
    expect(mensagemErro(e("funcao_desativada: salvar_insumos_iniciais"))).toMatch(/desativad/i);
  });
  it("nao_encontrado: modelo continua amigável", () => {
    expect(mensagemInsumosIniciais("P0001", "nao_encontrado: modelo")).toMatch(
      /não encontrado|não foi encontrado/i,
    );
  });
  it("mensagens fora do assunto passam (null)", () => {
    expect(mensagemInsumosIniciais("P0001", "outra coisa")).toBeNull();
  });
});
