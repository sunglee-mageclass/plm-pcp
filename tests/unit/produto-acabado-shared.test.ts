import { describe, it, expect } from "vitest";
import {
  ehDistribuicaoProporcional,
  redistribuirVariantesPorPeso,
  variantesBatemComTotal,
  chaveDirty,
  montarDadosProduto,
  resolverTravaAcabado,
  aplicarResolucaoTravaAcabado,
  CAMPOS_TRAVAVEIS_POR_COLUNA,
  type VarianteDraft,
  type ProdutoDraft,
} from "@/components/produto-acabado/shared";

// FIX WAVE, review R1: mudar a Qtd total redistribuía as variantes por peso SEMPRE — mesmo
// quando o usuário tinha acabado de editar uma célula de qtd manualmente, descartando a
// edição em silêncio. `ehDistribuicaoProporcional` é o predicado que decide se a distribuição
// atual ainda É a saída do algoritmo (então redistribuir automaticamente é seguro) ou se foi
// tocada manualmente (então a Qtd total muda mas as qtds ficam como estavam).

const v = (ordem: number, peso: number, qtd: number): VarianteDraft => ({ ordem, cor_id: null, cor_apelido_id: null, peso, qtd });

describe("ehDistribuicaoProporcional", () => {
  it("distribuição recém-gerada por redistribuirVariantesPorPeso é proporcional (true)", () => {
    const variantes = redistribuirVariantesPorPeso([v(1, 3, 0), v(2, 1, 0), v(3, 1, 0)], 100);
    expect(ehDistribuicaoProporcional(variantes, 100)).toBe(true);
  });

  it("editar manualmente a qtd de UMA variante deixa de ser proporcional (false)", () => {
    const variantes = redistribuirVariantesPorPeso([v(1, 3, 0), v(2, 1, 0), v(3, 1, 0)], 100);
    // usuário digita um valor diferente do que o algoritmo teria posto ali
    const editadas = variantes.map((x) => (x.ordem === 2 ? { ...x, qtd: 999 } : x));
    expect(ehDistribuicaoProporcional(editadas, 100)).toBe(false);
  });

  it("lista vazia é proporcional trivialmente (nada pra desalinhar)", () => {
    expect(ehDistribuicaoProporcional([], 50)).toBe(true);
  });

  it("total zerado com todas as qtds zeradas continua proporcional", () => {
    const variantes = [v(1, 1, 0), v(2, 1, 0)];
    expect(ehDistribuicaoProporcional(variantes, 0)).toBe(true);
  });

  it("qtds que batem por coincidência com outro total (não foi editado, só nunca redistribuído p/ o total atual) ainda conta como manual se não bater com o split", () => {
    // variantes paradas em 10/10 (soma 20) mas qtd_total mudou pra 30 sem redistribuir —
    // a saída do split pra peso 1:1 e total 30 seria 15/15, então 10/10 NÃO é proporcional a 30.
    const variantes = [v(1, 1, 10), v(2, 1, 10)];
    expect(ehDistribuicaoProporcional(variantes, 30)).toBe(false);
  });
});

describe("variantesBatemComTotal (sanity — usado junto do predicado acima na UI)", () => {
  it("soma das qtds bate com qtd_total → true", () => {
    expect(variantesBatemComTotal({ variantes: [v(1, 1, 5), v(2, 1, 5)], qtd_total: 10 })).toBe(true);
  });
  it("soma difere de qtd_total (ex.: total mudou e não redistribuiu) → false", () => {
    expect(variantesBatemComTotal({ variantes: [v(1, 1, 5), v(2, 1, 5)], qtd_total: 30 })).toBe(false);
  });
});

// Tarefa 5 (.superpowers/sdd/2026-09-29-tamanho-em/plan.md) — "Tamanho em" no Produto Acabado.
function draftBase(overrides: Partial<ProdutoDraft> = {}): ProdutoDraft {
  return {
    id: "p1", rev: 1, nome: "Blusa", ref: "REF1", grupo_id: "g1", categoria_id: "c1",
    subcategoria1_id: null, subcategoria2_id: null, colecao_id: "col1", subcolecao: null, semana: null,
    empresa_id: null, representante_id: null, ref_fornecedor: "", composicao: "",
    grade_proporcao: {}, qtd_total: 0, valor_unitario: 0, desconto_pct: 0, insumos_total: 0,
    markup_atacado: null, markup_varejo: null, preco_atacado_fixo: null, preco_varejo_fixo: null,
    foto_url: null, modelo_id: null, mix_id: null, variantes: [],
    tamanho_tipo: "letra", tamanho_tipo_base: "letra", modeloSkusCount: 0,
    modeloPrecoVenda: null, modeloPrecoAtacado: null, modeloLinhaId: null,
    modeloThumbFontes: [null, null, null], oc: null,
    ...overrides,
  };
}

describe("Tarefa 5 — tamanho_tipo entra em chaveDirty", () => {
  it("trocar tamanho_tipo muda a chave dirty (acende o selo 'não salvo')", () => {
    const a = chaveDirty(draftBase({ tamanho_tipo: "letra" }));
    const b = chaveDirty(draftBase({ tamanho_tipo: "numero" }));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
  it("mesmo tamanho_tipo → mesma chave dirty", () => {
    const a = chaveDirty(draftBase({ tamanho_tipo: "numero" }));
    const b = chaveDirty(draftBase({ tamanho_tipo: "numero" }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("Tarefa 5 — montarDadosProduto manda tamanho_tipo SÓ quando difere da base", () => {
  it("sem mudança (tipo === base): a chave NÃO entra no payload (servidor só toca a coluna se a chave está presente)", () => {
    const dados = montarDadosProduto(draftBase({ tamanho_tipo: "letra", tamanho_tipo_base: "letra" }));
    expect("tamanho_tipo" in dados).toBe(false);
  });
  it("trocado nesta edição (tipo !== base): a chave entra com o valor CORRENTE", () => {
    const dados = montarDadosProduto(draftBase({ tamanho_tipo: "numero", tamanho_tipo_base: "letra" }));
    expect(dados.tamanho_tipo).toBe("numero");
  });
  it("base null (produto nunca teve o campo) + corrente 'letra' → entra (P-25, default de exibição não é o mesmo que 'nunca tocado')", () => {
    const dados = montarDadosProduto(draftBase({ tamanho_tipo: "letra", tamanho_tipo_base: null }));
    expect(dados.tamanho_tipo).toBe("letra");
  });
  it("os demais campos do payload continuam intocados (regressão — não é um rewrite do helper)", () => {
    const dados = montarDadosProduto(draftBase({ nome: "Calça", qtd_total: 12, tamanho_tipo: "letra", tamanho_tipo_base: "letra" }));
    expect(dados.nome).toBe("Calça");
    expect(dados.qtd_total).toBe(12);
  });
  it("NUNCA manda null/vazio: produto travado + tocado + servidor com tamanho_tipo NULL (nunca gravado) — o revert " +
     "do trava (resolverTravaAcabado→aplicarResolucaoTravaAcabado) igualiza tipo e base a null ANTES de montar o " +
     "payload, então a chave sai OMITIDA (o servidor recusaria null/vazio com P0001 — ver task-1-2-report.md)", () => {
    const servidor = draftBase({ tamanho_tipo: null, tamanho_tipo_base: null, modelo_id: "m1" });
    const enviado = draftBase({ tamanho_tipo: "numero", tamanho_tipo_base: null, modelo_id: "m1" });
    const resolucao = resolverTravaAcabado({
      enviado, servidor, travaAtual: new Set(["tamanho_tipo"]), touched: new Set(["tamanho_tipo"]),
    });
    const revertido = aplicarResolucaoTravaAcabado(enviado, resolucao);
    expect(revertido.tamanho_tipo).toBe(null);
    const dados = montarDadosProduto(revertido);
    expect("tamanho_tipo" in dados).toBe(false);
  });
});

describe("Tarefa 5 — CAMPOS_TRAVAVEIS_POR_COLUNA.tamanho_tipo", () => {
  it("mapeia a própria chave 'tamanho_tipo' (SEMPRE_TRAVADO guarda o literal, não um CampoKey da API)", () => {
    expect(CAMPOS_TRAVAVEIS_POR_COLUNA.tamanho_tipo).toEqual(["tamanho_tipo"]);
  });
});

describe("Tarefa 5 — resolverTravaAcabado reverte tamanho_tipo quando travado (invariante #14)", () => {
  it("travado + tocado + valor diverge do servidor → reverte pro valor do servidor e avisa 'Tamanho em'", () => {
    const servidor = draftBase({ tamanho_tipo: "letra", tamanho_tipo_base: "letra" });
    const enviado = draftBase({ tamanho_tipo: "numero", tamanho_tipo_base: "letra" });
    const r = resolverTravaAcabado({
      enviado, servidor, travaAtual: new Set(["tamanho_tipo"]), touched: new Set(["tamanho_tipo"]),
    });
    expect(r.paraServidor.tamanho_tipo).toBe("letra");
    expect(r.avisos).toEqual([{ campo: "tamanho_tipo", rotulo: "Tamanho em" }]);
  });
  it("travado, mas NÃO tocado nesta sessão → reverte ao valor do servidor em silêncio (sem aviso — nunca editou)", () => {
    const servidor = draftBase({ tamanho_tipo: "letra", tamanho_tipo_base: "letra" });
    const enviado = draftBase({ tamanho_tipo: "letra", tamanho_tipo_base: "letra" });
    const r = resolverTravaAcabado({
      enviado, servidor, travaAtual: new Set(["tamanho_tipo"]), touched: new Set(),
    });
    expect(r.paraServidor.tamanho_tipo).toBe("letra");
    expect(r.avisos).toEqual([]);
  });
  it("travado + tocado, mas o valor enviado COINCIDE com o servidor (ex.: voltou ao original) → sem aviso", () => {
    const servidor = draftBase({ tamanho_tipo: "numero", tamanho_tipo_base: "numero" });
    const enviado = draftBase({ tamanho_tipo: "numero", tamanho_tipo_base: "letra" });
    const r = resolverTravaAcabado({
      enviado, servidor, travaAtual: new Set(["tamanho_tipo"]), touched: new Set(["tamanho_tipo"]),
    });
    expect(r.avisos).toEqual([]);
  });
  it("sem trava (Set vazio) → nada revertido (produto sem card/não integrável)", () => {
    const servidor = draftBase({ tamanho_tipo: "letra" });
    const enviado = draftBase({ tamanho_tipo: "numero", tamanho_tipo_base: "letra" });
    const r = resolverTravaAcabado({ enviado, servidor, travaAtual: new Set(), touched: new Set(["tamanho_tipo"]) });
    expect("tamanho_tipo" in r.paraServidor).toBe(false);
  });
});
