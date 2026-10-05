import { describe, it, expect, vi } from "vitest";
import { RecusaEsperadaError, TEXTO_CATEGORIA_ACESSORIO_PEDIDO } from "../../src/lib/categoria-card-produto";
import {
  mensagemBackend,
  mensagemErro,
  PREFIXO_NAO_ENCONTRADO,
  TEXTO_NAO_ENCONTRADO_GENERICO,
  TEXTOS_NAO_ENCONTRADO,
} from "../../src/lib/erro-mensagem";
import { BK3_MSG } from "../integration/bk-3-dados";

describe("mensagemErro", () => {
  it("P0409 (conflito de versão) vira mensagem PT amigável", () => {
    expect(mensagemErro({ code: "P0409", message: "conflito_versao: x" }, "fallback"))
      .toMatch(/Outra pessoa salvou/);
  });
  it("P0001 continua passando a mensagem da RPC", () => {
    expect(mensagemErro({ code: "P0001", message: "Coleção de outra loja." }, "fb"))
      .toBe("Coleção de outra loja.");
  });

  // Regressão: o RAISE de falta/sobra do direcionamento (confirmar estrito por tamanho)
  // usava ERRCODE 23514 — vencia pra mensagem genérica de POR_CODIGO e o usuário nunca via
  // o tamanho/diferença. Fix: código virou P0001 (padrão do repo pra RAISE em PT), que passa
  // a mensagem da RPC direto.
  const msgFalta = "Falta direcionar 1 peça(s) no tamanho P (variante 1) — direcionado 4, grade real 5.";
  it("mensagem detalhada de falta no direcionamento sobrevive com P0001", () => {
    expect(mensagemErro({ code: "P0001", message: msgFalta })).toBe(msgFalta);
  });
  it("a MESMA mensagem seria engolida pela genérica se o código fosse 23514 (documenta o bug corrigido)", () => {
    expect(mensagemErro({ code: "23514", message: msgFalta }))
      .toBe("Um dos valores informados é inválido.");
  });
  it("Backend B1: 42501 lancado_protegido (gravação direta de modelos.lancado) vira texto PT", () => {
    expect(
      mensagemErro(
        { code: "42501", message: "lancado_protegido: use o botao Lancar do card" },
        "fb",
      ),
    ).toBe("O lançamento só muda pelo botão Lançar (foguete) do card.");
  });

  it("Backend B4: 23505 no índice integracao_linhas_produto_unico vira texto PT próprio; outro 23505 segue o genérico", () => {
    expect(
      mensagemErro(
        {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "integracao_linhas_produto_unico"',
        },
        "fb",
      ),
    ).toBe(
      "Este produto já tem a linha de produto no espelho da Integração (só pode haver 1 por card). Recarregue a tela e confira o estado do produto.",
    );
    expect(
      mensagemErro(
        { code: "23505", message: 'duplicate key value violates unique constraint "outra_key"' },
        "fb",
      ),
    ).toBe("Já existe um registro com esses dados (valor duplicado).");
  });
});

describe("mensagemErro — Kanban automático (RPCs da F1)", () => {
  const PROPRIAS_42501 = [
    "Apenas o administrador da loja pode ver a prévia do Kanban automático.",
    "Apenas o administrador da loja pode ligar ou desligar o Kanban automático.",
    "Apenas o administrador da loja pode restaurar as colunas do Kanban.",
    "Sem permissão para mover cards do Desenvolvimento.",
  ];
  it("42501 com mensagem PRÓPRIA do kanban passa direto (não vira a genérica)", () => {
    for (const m of PROPRIAS_42501) expect(mensagemErro({ code: "42501", message: m }, "fb")).toBe(m);
  });
  it("42501 de outra origem continua genérico", () => {
    expect(mensagemErro({ code: "42501", message: "permission denied for table modelos" }, "fb"))
      .toBe("Você não tem permissão para esta ação.");
    expect(mensagemErro({ code: "42501", message: "Loja inativa ou sem tenant — operação não permitida." }, "fb"))
      .toBe("Você não tem permissão para esta ação.");
  });
  it("P0001 e P0002 do kanban passam direto", () => {
    for (const m of [
      "O Kanban automático está desligado nesta loja.",
      "Desligue o Kanban automático antes de restaurar as colunas.",
      "Este lote já foi restaurado.",
      'A etapa "zzz" não faz parte do fluxo deste modelo.',
    ]) expect(mensagemErro({ code: "P0001", message: m }, "fb")).toBe(m);
    for (const m of ["Modelo não encontrado.", "Lote de colunas não encontrado.", "Configuração da loja não encontrada."])
      expect(mensagemErro({ code: "P0002", message: m }, "fb")).toBe(m);
  });
});

describe("mensagemErro — \"Tamanho em\" nos cards (20261014100000)", () => {
  it("P0001 'tamanho_tipo invalido: …' (ASCII do banco) vira texto PT", () => {
    expect(mensagemErro({ code: "P0001", message: "tamanho_tipo invalido: use letra ou numero" }, "fb"))
      .toBe('O "Tamanho em" precisa ser Letra ou Número.');
  });
  it("outros P0001 seguem passando a mensagem da RPC", () => {
    expect(mensagemErro({ code: "P0001", message: "Informe o nome do produto." }, "fb")).toBe("Informe o nome do produto.");
  });
});

describe("mensagemErro — recusas esperadas do P-137 não vão pro console como erro", () => {
  const spy = () => vi.spyOn(console, "error").mockImplementation(() => {});
  it("RecusaEsperadaError (pré-checagem do front): devolve o texto e NÃO loga", () => {
    const s = spy();
    expect(mensagemErro(new RecusaEsperadaError("Não dá para trocar a Categoria."), "fb")).toBe("Não dá para trocar a Categoria.");
    expect(s).not.toHaveBeenCalled();
    s.mockRestore();
  });
  it("RecusaEsperadaError SEM acento (validação do front da OC) aparece como está; Error comum sem acento segue no fallback", () => {
    const s = spy();
    expect(mensagemErro(new RecusaEsperadaError("Informe o Fornecedor."), "Erro ao salvar")).toBe("Informe o Fornecedor.");
    expect(mensagemErro(new RecusaEsperadaError("Escolha a cor de: X - o aviamento tem 2 ou mais cores."), "fb")).toBe("Escolha a cor de: X - o aviamento tem 2 ou mais cores.");
    expect(mensagemErro(new Error("Informe o Fornecedor."), "Erro ao salvar")).toBe("Erro ao salvar");
    s.mockRestore();
  });
  it("P0001 categoria_acessorio_com_pedido (gatilho do banco): texto PT e NÃO loga", () => {
    const s = spy();
    expect(mensagemErro({ code: "P0001", message: "categoria_acessorio_com_pedido: x" }, "fb")).toBe(TEXTO_CATEGORIA_ACESSORIO_PEDIDO);
    expect(s).not.toHaveBeenCalled();
    s.mockRestore();
  });
  it("erro inesperado continua sendo logado", () => {
    const s = spy();
    mensagemErro(new Error("boom"), "fb");
    expect(s).toHaveBeenCalledTimes(1);
    s.mockRestore();
  });
});

// Frente Backend B3 (20261103147000): os 11 RAISE … P0002 "não encontrado" vêm em ASCII `nao_encontrado: <entidade>` (o
// PostgREST devolve P0002 como 500; com acento o code sumia). A tela traduz pelo prefixo, só para code P0002.
describe("mensagemErro — P0002 nao_encontrado: (Backend B3)", () => {
  it("cada entidade vira o texto PT próprio", () => {
    for (const [ent, texto] of Object.entries(TEXTOS_NAO_ENCONTRADO))
      expect(mensagemErro({ code: "P0002", message: `nao_encontrado: ${ent}` }, "fb")).toBe(texto);
    expect(mensagemErro({ code: "P0002", message: "nao_encontrado: oc" }, "fb")).toMatch(/Esta OC não existe mais/);
    expect(mensagemErro({ code: "P0002", message: "nao_encontrado: modelo" }, "fb")).toMatch(/Este card não existe mais/);
  });
  it("as mensagens que a migration grava (bk-3-dados) têm TODAS tradução específica (anti-drift)", () => {
    const novas = new Set(Object.values(BK3_MSG).map((m) => m.depois));
    expect(novas.size).toBe(5);
    for (const m of novas) {
      expect(m.startsWith(PREFIXO_NAO_ENCONTRADO), m).toBe(true);
      const ent = m.slice(PREFIXO_NAO_ENCONTRADO.length).trim();
      expect(TEXTOS_NAO_ENCONTRADO[ent], m).toBeTruthy();
      expect(mensagemBackend("P0002", m)).toBe(TEXTOS_NAO_ENCONTRADO[ent]);
    }
  });
  it("entidade desconhecida → texto genérico; outro code com o mesmo prefixo não é traduzido aqui", () => {
    expect(mensagemErro({ code: "P0002", message: "nao_encontrado: xyz" }, "fb")).toBe(TEXTO_NAO_ENCONTRADO_GENERICO);
    expect(mensagemErro({ code: "P0002", message: "nao_encontrado: constructor" }, "fb")).toBe(TEXTO_NAO_ENCONTRADO_GENERICO);
    expect(mensagemBackend("P0001", "nao_encontrado: oc")).toBeNull();
    // P0001 de outras frentes com prefixo parecido seguem as traduções delas
    expect(mensagemErro({ code: "P0001", message: "oc_nao_encontrada: x" }, "fb")).toMatch(/A OC desta parcela/);
  });
  it("banco ainda sem a B3 (texto PT acentuado com P0002) continua passando direto", () => {
    expect(mensagemErro({ code: "P0002", message: "OC não encontrada." }, "fb")).toBe("OC não encontrada.");
  });
});
