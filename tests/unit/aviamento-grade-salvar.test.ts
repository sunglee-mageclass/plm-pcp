/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase */
// Regra de gravação da grade de Aviamentos (PURA/`supabase` mockado): payload do UPDATE direto (sem rev, 3 FKs no próprio UPDATE),
// textos PT do 23505, conjunto COMPLETO de variantes do lote (leitura fresca + só os campos tocados por cima) e a ordem do UM Salvar.
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const lido: any = { variantes: [] as any[], erro: null as any };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => {
      const c: any = {
        select: () => c,
        order: () => c,
        eq: () => c,
        then: (res: any) => res({ data: lido.erro ? null : lido.variantes, error: lido.erro }),
      };
      return c;
    },
  },
}));

import {
  aviamentoParaDraft,
  ErroGrade,
  mensagemSalvarAviamento,
  mensagemSalvarVariantes,
  montarConjuntoVariantes,
  montarPayloadAviamento,
  salvarEmOrdem,
  salvarLoteVariantes,
  textoErroSalvar,
  textoResultadoSalvar,
  varianteParaDraft,
  type AviamentoParaDraft,
  type ItemAviamento,
  type ItemVariante,
} from "@/lib/aviamento-grade/salvar";

const av: AviamentoParaDraft = {
  codigo: "BOT-0001",
  codigo_nome: "Botão",
  empresa_id: "e1",
  representante_id: "r1",
  preco: 2,
  ncm: "9606",
  categoria_aviamento_id: "c1",
  subcategoria_aviamento_id: "s1",
  material_aviamento_id: "m1",
  composicao: "Poliéster",
  intervalo_largura_id: "i1",
  largura_exata: 1.5,
  observacoes: null,
};

describe("aviamentoParaDraft", () => {
  it("espelha as colunas; vazio ('' ou só espaço) vira null e nome ausente vira ''", () => {
    expect(
      aviamentoParaDraft({
        ...av,
        ncm: "  ",
        composicao: "",
        observacoes: null,
        codigo_nome: null,
      }),
    ).toMatchObject({
      codigo: "BOT-0001",
      codigo_nome: "",
      ncm: null,
      composicao: null,
      observacoes: null,
      representante_id: "r1",
      preco: 2,
      largura_exata: 1.5,
    });
    expect(aviamentoParaDraft({ ...av, preco: "7.5" as any }).preco).toBe(7.5);
  });
});

describe("montarPayloadAviamento (UPDATE direto, sem rev)", () => {
  const base = aviamentoParaDraft(av);
  it("só os campos TOCADOS, normalizados (trim, vazio = null)", () => {
    expect(
      montarPayloadAviamento(
        { codigo_nome: "  Novo ", ncm: " 123 ", composicao: "  ", observacoes: "  obs  " },
        base,
      ),
    ).toEqual({
      codigo_nome: "Novo",
      ncm: "123",
      composicao: null,
      observacoes: "obs",
    });
    expect(montarPayloadAviamento({ preco: null, largura_exata: 2.25 }, base)).toEqual({
      preco: null,
      largura_exata: 2.25,
    });
  });
  it("nome é opcional: vazio grava '' (o identificador é o código)", () => {
    expect(montarPayloadAviamento({ codigo_nome: "" }, base)).toEqual({ codigo_nome: "" });
  });
  it("categoria/subcategoria/material/intervalo: 3 FKs + intervalo no próprio UPDATE; vazio = null", () => {
    expect(
      montarPayloadAviamento(
        {
          categoria_aviamento_id: "c2",
          subcategoria_aviamento_id: null,
          material_aviamento_id: "m2",
          intervalo_largura_id: null,
        },
        base,
      ),
    ).toEqual({
      categoria_aviamento_id: "c2",
      subcategoria_aviamento_id: null,
      material_aviamento_id: "m2",
      intervalo_largura_id: null,
    });
  });
  it("fornecedor e representante andam JUNTOS: tocar um manda os dois (o do rascunho, senão o da base)", () => {
    expect(montarPayloadAviamento({ empresa_id: "e2", representante_id: null }, base)).toEqual({
      empresa_id: "e2",
      representante_id: null,
    });
    expect(montarPayloadAviamento({ representante_id: "r9" }, base)).toEqual({
      empresa_id: "e1",
      representante_id: "r9",
    });
    expect(montarPayloadAviamento({ empresa_id: "e2" }, base)).toEqual({
      empresa_id: "e2",
      representante_id: "r1",
    });
  });
  it("código: com trim; vazio é recusado (o gatilho que gera só roda no INSERT)", () => {
    expect(montarPayloadAviamento({ codigo: " X-1 " }, base)).toEqual({ codigo: "X-1" });
    expect(() => montarPayloadAviamento({ codigo: null }, base)).toThrow(ErroGrade);
    expect(() => montarPayloadAviamento({ codigo: "  " }, base)).toThrow(
      "O código não pode ficar vazio.",
    );
  });
  it("nunca manda rev nem o que não foi tocado", () => {
    expect(montarPayloadAviamento({ ncm: "1" }, base)).not.toHaveProperty("rev");
    expect(Object.keys(montarPayloadAviamento({ ncm: "1" }, base))).toEqual(["ncm"]);
  });
});

describe("textos PT do erro", () => {
  it("23505: desambigua código (tenant_codigo) × nome no fornecedor", () => {
    expect(
      mensagemSalvarAviamento({
        code: "23505",
        message: 'violates unique constraint "ux_aviamentos_tenant_codigo"',
      }),
    ).toBe("Este código já está em uso. Escolha outro.");
    expect(
      mensagemSalvarAviamento({
        code: "23505",
        message: 'violates unique constraint "uq_aviamento_codigo_fornecedor"',
      }),
    ).toBe("Este nome já existe neste fornecedor.");
    expect(
      mensagemSalvarAviamento({
        code: "23505",
        message: "x",
        details: "Key (tenant_id, codigo)=... tenant_codigo",
      }),
    ).toBe("Este código já está em uso. Escolha outro.");
  });
  it("outro erro cai no texto genérico PT", () => {
    expect(mensagemSalvarAviamento(new Error("boom"))).toBeTruthy();
    expect(mensagemSalvarVariantes({ code: "23505" })).toBe(
      "Já existe uma variante com essa cor e apelido neste aviamento.",
    );
    expect(textoErroSalvar(new ErroGrade("X"))).toBe("X");
  });
});

describe("montarConjuntoVariantes: conjunto COMPLETO sobre a leitura fresca", () => {
  const frescas = [
    {
      id: "v1",
      cor_id: "c1",
      cor_apelido_id: null,
      nome_variante: "A",
      codigo_variante: "CV1",
      preco: 2,
    },
    {
      id: "v2",
      cor_id: "c2",
      cor_apelido_id: "ap1",
      nome_variante: null,
      codigo_variante: null,
      preco: null,
    },
    {
      id: "v9",
      cor_id: "c9",
      cor_apelido_id: null,
      nome_variante: "criada por outra pessoa",
      codigo_variante: null,
      preco: "4" as any,
    },
  ];
  it("manda TODAS (inclusive a que outra pessoa criou e a intocada) e põe só os campos tocados por cima", () => {
    const r = montarConjuntoVariantes(
      frescas,
      new Map([["v1", { nome_variante: " B ", preco: 5 }]]),
    );
    expect(r).toEqual([
      {
        id: "v1",
        cor_id: "c1",
        cor_apelido_id: null,
        nome_variante: "B",
        codigo_variante: "CV1",
        preco: 5,
      },
      {
        id: "v2",
        cor_id: "c2",
        cor_apelido_id: "ap1",
        nome_variante: null,
        codigo_variante: null,
        preco: null,
      },
      {
        id: "v9",
        cor_id: "c9",
        cor_apelido_id: null,
        nome_variante: "criada por outra pessoa",
        codigo_variante: null,
        preco: 4,
      },
    ]);
  });
  it("trocar a cor base e limpar o apelido; vazio vira null", () => {
    const r = montarConjuntoVariantes(
      frescas.slice(0, 2),
      new Map([["v2", { cor_id: "c3", cor_apelido_id: "", nome_variante: "" }]]),
    );
    expect(r[1]).toEqual({
      id: "v2",
      cor_id: "c3",
      cor_apelido_id: null,
      nome_variante: null,
      codigo_variante: null,
      preco: null,
    });
  });
  it("cor tocada que o servidor não tem mais (excluída por outra pessoa) = ErroGrade, nada vai", () => {
    expect(() =>
      montarConjuntoVariantes(frescas, new Map([["v-sumiu", { nome_variante: "x" }]])),
    ).toThrow(ErroGrade);
  });
  it("cor tocada sem cor base é recusada (a RPC ignoraria a linha em silêncio)", () => {
    expect(() => montarConjuntoVariantes(frescas, new Map([["v1", { cor_id: "" }]]))).toThrow(
      "Escolha a cor base da variante.",
    );
  });
  it("cor legada SEM cor base e intocada passa como está (a RPC a mantém)", () => {
    const r = montarConjuntoVariantes(
      [
        {
          id: "v0",
          cor_id: null,
          cor_apelido_id: null,
          nome_variante: null,
          codigo_variante: null,
          preco: null,
        },
      ],
      new Map([["v0", {}]]),
    );
    expect(r).toHaveLength(1);
    expect(r[0].cor_id).toBeNull();
  });
});

describe("varianteParaDraft", () => {
  it("ids em texto ('' = nenhum), vazio vira null, preço numérico", () => {
    expect(
      varianteParaDraft({
        cor_id: null,
        cor_apelido_id: null,
        nome_variante: " ",
        codigo_variante: "X",
        preco: "3" as any,
      }),
    ).toEqual({
      cor_id: "",
      cor_apelido_id: "",
      nome_variante: null,
      codigo_variante: "X",
      preco: 3,
    });
  });
});

describe("salvarLoteVariantes (leitura fresca + RPC de lote)", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
    lido.erro = null;
    lido.variantes = [
      {
        id: "v1",
        cor_id: "c1",
        cor_apelido_id: null,
        nome_variante: null,
        codigo_variante: null,
        preco: null,
      },
    ];
  });
  it("chama salvar_variantes_aviamento com o aviamento e o conjunto completo", async () => {
    await salvarLoteVariantes("A1", [{ id: "v1", mudancas: { preco: 9 } }]);
    expect(rpc).toHaveBeenCalledWith("salvar_variantes_aviamento", {
      _aviamento_id: "A1",
      _variantes: [
        {
          id: "v1",
          cor_id: "c1",
          cor_apelido_id: null,
          nome_variante: null,
          codigo_variante: null,
          preco: 9,
        },
      ],
    });
  });
  it("falha da leitura fresca ou da RPC vira ErroGrade PT e nada é enviado em falha de leitura", async () => {
    lido.erro = { message: "rede" };
    await expect(
      salvarLoteVariantes("A1", [{ id: "v1", mudancas: { preco: 9 } }]),
    ).rejects.toBeInstanceOf(ErroGrade);
    expect(rpc).not.toHaveBeenCalled();
    lido.erro = null;
    rpc.mockResolvedValue({ error: { code: "23505", message: "x" } });
    await expect(salvarLoteVariantes("A1", [{ id: "v1", mudancas: { preco: 9 } }])).rejects.toThrow(
      "Já existe uma variante com essa cor e apelido neste aviamento.",
    );
  });
});

describe("salvarEmOrdem (UM Salvar, resultado parcial)", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
    lido.erro = null;
    lido.variantes = [
      {
        id: "v1",
        cor_id: "c1",
        cor_apelido_id: null,
        nome_variante: null,
        codigo_variante: null,
        preco: null,
      },
      {
        id: "v2",
        cor_id: "c2",
        cor_apelido_id: null,
        nome_variante: null,
        codigo_variante: null,
        preco: null,
      },
      {
        id: "v3",
        cor_id: "c3",
        cor_apelido_id: null,
        nome_variante: null,
        codigo_variante: null,
        preco: null,
      },
    ];
  });
  const item = (id: string, log: string[], falha = false, sujo = true): ItemAviamento => ({
    id,
    dirty: () => sujo,
    salvar: async () => {
      log.push(`av:${id}`);
      if (falha) throw new Error("x");
    },
  });
  const cor = (id: string, aviamentoId: string, log: string[], sujo = true): ItemVariante => ({
    id,
    aviamentoId,
    dirty: () => sujo,
    mudancas: () => ({ preco: 1 }),
    salvar: async (ctx) => {
      log.push(`cor:${id}:${ctx.lote?.erro ? "erro" : "ok"}`);
      if (ctx.lote?.erro) throw ctx.lote.erro;
    },
  });
  it("aviamentos ANTES das cores; só os sujos; uma chamada de lote por aviamento tocado", async () => {
    const log: string[] = [];
    rpc.mockImplementation(async () => {
      log.push("rpc");
      return { error: null };
    });
    const r = await salvarEmOrdem(
      [item("A", log), item("B", log, false, false)],
      [cor("v1", "A", log), cor("v2", "A", log), cor("v3", "B", log, false)],
    );
    expect(log).toEqual(["av:A", "rpc", "cor:v1:ok", "cor:v2:ok"]);
    expect(r).toEqual({ ok: 3, erro: 0 });
  });
  it("a falha de um aviamento não derruba os outros nem as cores; a falha do lote atinge só as cores daquele aviamento", async () => {
    const log: string[] = [];
    rpc
      .mockResolvedValueOnce({ error: { message: "em uso" } })
      .mockResolvedValueOnce({ error: null });
    const r = await salvarEmOrdem(
      [item("A", log, true), item("B", log)],
      [cor("v1", "A", log), cor("v3", "B", log)],
    );
    expect(log).toEqual(["av:A", "av:B", "cor:v1:erro", "cor:v3:ok"]);
    expect(r).toEqual({ ok: 2, erro: 2 });
  });
  it("textoResultadoSalvar: 'N salvos, M com erro' e o tom", () => {
    expect(textoResultadoSalvar({ ok: 1, erro: 0 })).toEqual({ tom: "sucesso", texto: "1 salvo." });
    expect(textoResultadoSalvar({ ok: 3, erro: 0 })).toEqual({
      tom: "sucesso",
      texto: "3 salvos.",
    });
    expect(textoResultadoSalvar({ ok: 1, erro: 1 })).toEqual({
      tom: "aviso",
      texto: "1 salvo, 1 com erro. Veja o aviso na linha.",
    });
    expect(textoResultadoSalvar({ ok: 0, erro: 2 }).tom).toBe("erro");
    expect(textoResultadoSalvar({ ok: 0, erro: 0 })).toEqual({
      tom: "aviso",
      texto: "Nada para salvar.",
    });
  });
});
