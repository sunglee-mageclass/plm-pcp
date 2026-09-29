// Fix round 1 (L-3, review) — cobertura BEHAVIORAL do revert imediato de F3 (não só source-grep, que é o que
// `integracao-trava-revert-imediato.test.ts` tinha antes). Exercita a MESMA cadeia que
// ProdutoAcabadoSheet.tsx/ProdutoImportadoSheet.tsx agora chamam dentro do catch do RPC — resolverTravaAcabado/
// resolverTravaImportado seguido de aplicarResolucaoTravaAcabado/aplicarResolucaoTrava (os helpers puros que o
// pré-save já usava, agora reusados no pós-erro em vez do spread duplicado) — com um draft que tem VÁRIOS
// campos "sujos" ao mesmo tempo, provando que o revert do campo travado (tamanho_tipo) NÃO contamina os outros
// campos tocados na mesma sessão (nome, qtd_total, markup, variantes intocadas quando a trava é só de
// tamanho_tipo).
import { describe, it, expect } from "vitest";
import {
  resolverTravaAcabado, aplicarResolucaoTravaAcabado, type ProdutoDraft, type VarianteDraft,
} from "@/components/produto-acabado/shared";
import {
  resolverTravaImportado, aplicarResolucaoTrava, emptyDraft, type ProdutoImportadoDraft,
} from "@/components/produto-importado/shared";

const vPA = (ordem: number, peso: number, qtd: number): VarianteDraft => ({ ordem, cor_id: null, cor_apelido_id: null, peso, qtd });

function draftPA(overrides: Partial<ProdutoDraft> = {}): ProdutoDraft {
  return {
    id: "p1", rev: 1, nome: "Blusa", ref: "REF1", grupo_id: "g1", categoria_id: "c1",
    subcategoria1_id: null, subcategoria2_id: null, colecao_id: "col1", subcolecao: null, semana: null,
    empresa_id: null, representante_id: null, ref_fornecedor: "", composicao: "",
    grade_proporcao: {}, qtd_total: 0, valor_unitario: 0, desconto_pct: 0, insumos_total: 0,
    markup_atacado: null, markup_varejo: null, preco_atacado_fixo: null, preco_varejo_fixo: null,
    foto_url: null, modelo_id: "m1", mix_id: null, variantes: [],
    tamanho_tipo: "letra", tamanho_tipo_base: "letra", modeloSkusCount: 0,
    modeloPrecoVenda: null, modeloPrecoAtacado: null, modeloLinhaId: null,
    modeloThumbFontes: [null, null, null], oc: null,
    ...overrides,
  } as ProdutoDraft;
}

describe("F3 revert imediato — comportamento REAL (L-3): PA reverte SÓ tamanho_tipo, os outros campos tocados na mesma sessão sobrevivem intactos", () => {
  it("cenário do achado do QA: usuário editou nome+qtd_total+markup+tamanho_tipo na mesma sessão; o card foi travado (só em tamanho_tipo) entre a carga e o Salvar — o 1o erro reverte SÓ o tamanho_tipo, mantendo nome/qtd_total/markup exatamente como o usuário deixou", () => {
    // servidorAtual = o que a sessão carregou (antes de qualquer edição do usuário)
    const servidorAtual = draftPA({
      nome: "Blusa Original", qtd_total: 10, markup_varejo: 2.0,
      variantes: [vPA(1, 1, 10)], tamanho_tipo: "letra", tamanho_tipo_base: "letra",
    });
    // p0 = o rascunho como o usuário deixou nesta sessão: editou nome, qtd_total, markup E o tamanho_tipo
    const p0 = draftPA({
      nome: "Blusa Editada", qtd_total: 25, markup_varejo: 2.5,
      variantes: [vPA(1, 1, 25)], tamanho_tipo: "numero", tamanho_tipo_base: "letra",
    });
    // travaFresca (lida DEPOIS do erro, via estadoIntegracaoFresco): só tamanho_tipo está travado — nome/qtd_
    // total/markup/variantes continuam livres (o cenário real: a Integração trava SEMPRE tamanho_tipo, mas só
    // trava os OUTROS campos se estiverem marcados no retrato — aqui nenhum outro foi marcado).
    const travaFresca = new Set(["tamanho_tipo"]);
    const touchedAgora = new Set(["nome", "qtd_total", "markup_varejo", "variantes", "tamanho_tipo"]);

    const resolucao = resolverTravaAcabado({ enviado: p0, servidor: servidorAtual, travaAtual: travaFresca, touched: touchedAgora });
    const revertido = aplicarResolucaoTravaAcabado(p0, resolucao);

    // O campo travado voltou ao valor do SERVIDOR (não ficou com o valor recusado, nem foi pro null).
    expect(revertido.tamanho_tipo).toBe("letra");
    expect(revertido.tamanho_tipo_base).toBe("letra");
    // TODOS os outros campos tocados na MESMA sessão sobrevivem — a prova central do L-3: o revert de UM
    // campo travado não pode "vazar" e reverter campos que não têm nada a ver com a trava.
    expect(revertido.nome).toBe("Blusa Editada");
    expect(revertido.qtd_total).toBe(25);
    expect(revertido.markup_varejo).toBe(2.5);
    expect(revertido.variantes).toEqual([vPA(1, 1, 25)]);
    // id/rev/ref/grupo/categoria (nunca tocados nesta sessão) também intocados — o helper não reescreve o
    // draft inteiro, só aplica o patch das colunas travadas.
    expect(revertido.id).toBe(p0.id);
    expect(revertido.rev).toBe(p0.rev);
    expect(revertido.ref).toBe(p0.ref);
  });

  it("sem NENHUM campo travado no retrato fresco (falso alarme / lock era de outro campo): nada reverte, draft sai byte-idêntico ao enviado", () => {
    const servidorAtual = draftPA({ nome: "Original", tamanho_tipo: "letra", tamanho_tipo_base: "letra" });
    const p0 = draftPA({ nome: "Editado", tamanho_tipo: "numero", tamanho_tipo_base: "letra" });
    const resolucao = resolverTravaAcabado({ enviado: p0, servidor: servidorAtual, travaAtual: new Set(), touched: new Set(["nome", "tamanho_tipo"]) });
    const revertido = aplicarResolucaoTravaAcabado(p0, resolucao);
    expect(revertido).toBe(p0); // aplicarResolucaoTravaAcabado devolve a MESMA referência quando não há nada a aplicar
  });
});

function draftPI(overrides: Partial<ProdutoImportadoDraft> = {}): ProdutoImportadoDraft {
  return { ...emptyDraft("col1", null), id: "p1", rev: 3, modelo_id: "m1", ...overrides };
}

describe("F3 revert imediato — comportamento REAL (L-3): PI reverte SÓ tamanho_tipo, campos de preço/etapas tocados sobrevivem", () => {
  it("usuário editou nome + valor_unitario_m1 + etapas + tamanho_tipo; só tamanho_tipo trava — o revert preserva os outros 3", () => {
    const servidorAtual = draftPI({
      nome: "Vestido Original", valor_unitario_m1: 8, etapas: [{ rotulo: "Produção", base: "mercadoria", percentual: 100, data_vencimento: null, cotacao: 5, ordem: 0 }],
      tamanho_tipo: "letra", tamanho_tipo_base: "letra",
    });
    const p0 = draftPI({
      nome: "Vestido Editado", valor_unitario_m1: 12, etapas: [{ rotulo: "Produção", base: "mercadoria", percentual: 100, data_vencimento: null, cotacao: 6, ordem: 0 }],
      tamanho_tipo: "numero", tamanho_tipo_base: "letra",
    });
    const travaFresca = new Set(["tamanho_tipo"]);
    const touchedAgora = new Set(["nome", "valor_unitario_m1", "etapas", "tamanho_tipo"]);

    const resolucao = resolverTravaImportado({ enviado: p0, servidor: servidorAtual, travaAtual: travaFresca, touched: touchedAgora });
    const revertido = aplicarResolucaoTrava(p0, resolucao);

    expect(revertido.tamanho_tipo).toBe("letra");
    expect(revertido.nome).toBe("Vestido Editado");
    expect(revertido.valor_unitario_m1).toBe(12);
    expect(revertido.etapas?.[0].cotacao).toBe(6);
  });

  it("produto isLocal (sem servidor ainda, id 'novo-...'): resolverTravaImportado no-opa (sem servidor, nada a comparar) — mesma guarda de sempre, sem checagem extra no caller", () => {
    const p0 = draftPI({ id: "novo-123", modelo_id: null, nome: "Recém-criado", tamanho_tipo: "numero" });
    const resolucao = resolverTravaImportado({ enviado: p0, servidor: undefined, travaAtual: new Set(), touched: new Set(["nome", "tamanho_tipo"]) });
    const revertido = aplicarResolucaoTrava(p0, resolucao);
    expect(revertido).toBe(p0); // no-op — nenhum campo revertido, mesma referência
  });
});
