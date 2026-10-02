import { describe, it, expect } from "vitest";
import {
  ehDistribuicaoProporcional,
  redistribuirVariantesPorPeso,
  variantesBatemComTotal,
  chaveDirty,
  produtosParaSalvar,
  baselinePatchDoServidor,
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

describe("Release I3 — categoria do tecido / material do aviamento no PA", () => {
  it("montarDadosProduto manda SEMPRE as 2 chaves (a do outro grupo segue como está no rascunho)", () => {
    const d = montarDadosProduto(draftBase({ categoria_tecido_id: "ct1", material_aviamento_id: "ma1" }));
    expect(d.categoria_tecido_id).toBe("ct1");
    expect(d.material_aviamento_id).toBe("ma1");
    const v = montarDadosProduto(draftBase({}));
    expect(v).toHaveProperty("categoria_tecido_id", null);
    expect(v).toHaveProperty("material_aviamento_id", null);
  });
  it("as 2 chaves entram em chaveDirty (editar acende o Salvar)", () => {
    const a = JSON.stringify(chaveDirty(draftBase({ categoria_tecido_id: null })));
    expect(JSON.stringify(chaveDirty(draftBase({ categoria_tecido_id: "ct1" })))).not.toBe(a);
    expect(JSON.stringify(chaveDirty(draftBase({ material_aviamento_id: "ma1" })))).not.toBe(a);
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

// P-135 B (fix, causa raiz "a"): "Cinto Teste" foi regravado 7× sem ninguém mexer nele — o
// Salvar em lote mandava TODOS os produtos da subcoleção, editados ou não. `produtosParaSalvar`
// é o corte que faz o Salvar mandar só quem realmente mudou desde o baseline (mesmo predicado
// que já acende o UnsavedIndicator/dirty da tela).
function draftBaseLote(over: Partial<ProdutoDraft> = {}): ProdutoDraft {
  return {
    id: "p1", rev: 1, nome: "Produto", ref: null, grupo_id: "g1", categoria_id: "c1",
    subcategoria1_id: null, subcategoria2_id: null, colecao_id: "col1", subcolecao: null,
    semana: null, empresa_id: null, representante_id: null, ref_fornecedor: "", composicao: "",
    grade_proporcao: {}, qtd_total: 10, valor_unitario: 0, desconto_pct: 0, insumos_total: 0,
    markup_atacado: null, markup_varejo: null, preco_atacado_fixo: null, preco_varejo_fixo: null,
    foto_url: null, modelo_id: "m1", mix_id: null, variantes: [v(1, 1, 10)],
    modeloPrecoVenda: null, modeloPrecoAtacado: null, modeloLinhaId: null,
    modeloThumbFontes: [null, null, null], oc: null,
    ...over,
  };
}

describe("produtosParaSalvar (P-135 B — o Salvar em lote só manda quem mudou)", () => {
  it("produto IDÊNTICO ao baseline (não editado) fica de fora — reprodução exata do 'Cinto Teste'", () => {
    const naoEditado = draftBaseLote({ id: "cinto-teste", categoria_id: "c1" });
    const baseline = { "cinto-teste": JSON.stringify(chaveDirty(naoEditado)) };
    const resultado = produtosParaSalvar([naoEditado], baseline, chaveDirty);
    expect(resultado).toEqual([]);
  });

  it("editar 1 de N produtos → payload só com o editado (falha antes do fix: mandava os N)", () => {
    const intocado1 = draftBaseLote({ id: "p-intocado-1", nome: "Intocado 1" });
    const editado = draftBaseLote({ id: "p-editado", nome: "Editado" });
    const intocado2 = draftBaseLote({ id: "p-intocado-2", nome: "Intocado 2" });
    const baseline = {
      "p-intocado-1": JSON.stringify(chaveDirty(intocado1)),
      "p-editado": JSON.stringify(chaveDirty(draftBaseLote({ id: "p-editado", nome: "Nome antigo" }))),
      "p-intocado-2": JSON.stringify(chaveDirty(intocado2)),
    };
    const resultado = produtosParaSalvar([intocado1, editado, intocado2], baseline, chaveDirty);
    expect(resultado.map((p) => p.id)).toEqual(["p-editado"]);
  });

  it("produto sem entrada no baseline (novo/ainda não seedado) é tratado como sujo — entra no Salvar", () => {
    const novo = draftBaseLote({ id: "p-novo" });
    const resultado = produtosParaSalvar([novo], {}, chaveDirty);
    expect(resultado.map((p) => p.id)).toEqual(["p-novo"]);
  });

  it("nenhum produto editado → lote vazio (zero RPCs disparadas)", () => {
    const a = draftBaseLote({ id: "a" });
    const b = draftBaseLote({ id: "b", nome: "B" });
    const baseline = { a: JSON.stringify(chaveDirty(a)), b: JSON.stringify(chaveDirty(b)) };
    expect(produtosParaSalvar([a, b], baseline, chaveDirty)).toEqual([]);
  });
});

// P-135 B — guarda de regressão no SOURCE: prova que o `mutationFn` do Salvar em lote de
// `ProdutoAcabadoSheet.tsx` filtra por `produtosParaSalvar` (não manda mais TODOS os drafts).
describe("P-135 B — guarda de regressão no SOURCE (ProdutoAcabadoSheet.tsx filtra por sujo antes de salvar em lote)", () => {
  it("mutationFn usa produtosParaSalvar(drafts ?? [], baseline, chaveDirty) — não `drafts ?? []` cru", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/components/produto-acabado/ProdutoAcabadoSheet.tsx", "utf8");
    expect(src).toContain("produtosParaSalvar(drafts ?? [], baseline, chaveDirty)");
    expect(src).not.toMatch(/const lista = drafts \?\? \[\];/);
  });
});

// Fix round 1 (review Opus, H1+M1): baselinePatchDoServidor — a regra "baseline = chaveDirty do
// SERVIDOR (fresh), nunca do merge/draft local" que corrige H1 (reconciliar P0409 sem conflito
// marcava limpo mesmo com edição não persistida) e M1 (merge de refetch/Realtime nunca
// re-baselinava, deixando produto convergido "phantom dirty").
describe("baselinePatchDoServidor (Fix round 1, H1+M1)", () => {
  it("(a) P0409 sem conflito: o produto AINDA É enviado no próximo Salvar (edição não persistida)", () => {
    // Cenário do review: A edita ref_fornecedor; B salva valor_unitario no meio (bump rev);
    // A tenta salvar, toma P0409; reconciliação funde (fresh.valor_unitario + meu ref_fornecedor).
    const base = draftBaseLote({ id: "x", ref_fornecedor: "REF-ORIGINAL", valor_unitario: 10 });
    const meuEnviado = draftBaseLote({ id: "x", ref_fornecedor: "REF-EDITADA-POR-A", valor_unitario: 10 });
    const fresh = draftBaseLote({ id: "x", ref_fornecedor: "REF-ORIGINAL", valor_unitario: 99, rev: 5 });
    // fundido = merge 3-vias: adota fresh onde eu não toquei (valor_unitario), preserva meu onde toquei (ref_fornecedor).
    const fundido = draftBaseLote({ id: "x", ref_fornecedor: "REF-EDITADA-POR-A", valor_unitario: 99, rev: 5 });
    void base; void meuEnviado;
    // H1: o baseline TEM que vir do fresh (servidor), não do fundido (merge) — senão o produto
    // "convergiria" com seu próprio estado local e desapareceria do próximo Salvar.
    const patch = baselinePatchDoServidor(["x"], new Map([["x", fresh]]), chaveDirty);
    const baselineDepois = { x: patch.x };
    // O fundido (com a edição de ref_fornecedor preservada) deve continuar DIFERENTE do baseline
    // recém-gravado — ou seja, `produtosParaSalvar` ainda o inclui no próximo lote.
    const resultado = produtosParaSalvar([fundido], baselineDepois, chaveDirty);
    expect(resultado.map((p) => p.id)).toEqual(["x"]);
  });

  it("(b) Realtime/refetch atualiza um produto NÃO tocado pelo usuário -> não é enviado depois", () => {
    // Outro usuário salvou X (ninguém aqui editou X); o merge adota o fresh inteiro (touched vazio).
    const fresh = draftBaseLote({ id: "y", nome: "Nome atualizado por outra pessoa", rev: 7 });
    // O merge, sem touched, produz exatamente o fresh como novo draft.
    const draftPosMerge = fresh;
    const patch = baselinePatchDoServidor(["y"], new Map([["y", fresh]]), chaveDirty);
    const resultado = produtosParaSalvar([draftPosMerge], patch, chaveDirty);
    expect(resultado).toEqual([]);
  });

  it("(c) Realtime/refetch atualiza um produto que o usuário EDITOU -> ainda é enviado", () => {
    // Eu editei valor_unitario localmente; o servidor mudou nome (outro campo) nesse meio tempo.
    const fresh = draftBaseLote({ id: "z", nome: "Nome novo do servidor", valor_unitario: 10, rev: 3 });
    // Merge: adota nome do fresh (não toquei), preserva meu valor_unitario editado.
    const draftPosMerge = draftBaseLote({ id: "z", nome: "Nome novo do servidor", valor_unitario: 555, rev: 3 });
    const patch = baselinePatchDoServidor(["z"], new Map([["z", fresh]]), chaveDirty);
    const resultado = produtosParaSalvar([draftPosMerge], patch, chaveDirty);
    expect(resultado.map((p) => p.id)).toEqual(["z"]);
  });

  it("preserva entradas de baseline de produtos NÃO incluídos em ids (outra subcoleção) — é um PATCH, não substitui tudo", () => {
    const freshY = draftBaseLote({ id: "y", nome: "Y atualizado" });
    const patch = baselinePatchDoServidor(["y"], new Map([["y", freshY]]), chaveDirty);
    const baselineExistente = { outro: "algum-json-antigo" };
    const baselineFinal = { ...baselineExistente, ...patch };
    expect(baselineFinal.outro).toBe("algum-json-antigo");
    expect(baselineFinal.y).toBe(JSON.stringify(chaveDirty(freshY)));
  });

  it("id sem fresh correspondente (produto sumiu do servidor) não entra no patch", () => {
    const patch = baselinePatchDoServidor(["fantasma"], new Map(), chaveDirty);
    expect(patch).toEqual({});
  });
});
