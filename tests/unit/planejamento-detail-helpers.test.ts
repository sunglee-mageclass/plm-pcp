import { describe, it, expect } from "vitest";
import {
  rotuloConflitoPlan,
  limparCustoSim,
  invalidarAposAprovarMO,
  CAMPOS_DEV_DRAFT,
  textoOuNull,
  aplicarRegrasCamposDev,
  camposParaDuplicar,
  draftParaSalvar,
  normalizarDraftSalvo,
  filtrarNcm,
  numeroOuNull,
  numeroDoInput,
  precoAnteriorOuNull,
  precoAnteriorExibido,
  camposNovosParaPayload,
  aplicarPrecoAnterior,
  CAMPOS_SO_PLANEJAMENTO_DRAFT,
  aplicarRegrasCamposPlanejamento,
  CAMPOS_COMPARTILHADOS_DRAFT,
} from "@/components/planejamento/planejamento-detail/helpers";
import { emptyDraft, type Draft } from "@/components/planejamento/modelo-shared";

// F3.0 (set/2026) — trava o comportamento dos helpers do detalhe do Planejamento, que saíram de
// dentro de PlanejamentoDetail.tsx. Nada aqui muda regra: é a foto do comportamento de hoje.

describe("rotuloConflitoPlan", () => {
  it("devolve o rótulo PT dos campos conhecidos do Draft", () => {
    expect(rotuloConflitoPlan("nome")).toBe("Nome do Modelo");
    expect(rotuloConflitoPlan("preco_venda")).toBe("Preço para venda");
    expect(rotuloConflitoPlan("custo_simulado")).toBe("Simulação de custo");
    expect(rotuloConflitoPlan("tecidos_planejados")).toBe("Tecido Planejado");
  });
  it("cai no próprio path quando não há rótulo", () => {
    expect(rotuloConflitoPlan("campo_inexistente")).toBe("campo_inexistente");
  });
});

describe("limparCustoSim", () => {
  it("null, undefined e objeto vazio viram null", () => {
    expect(limparCustoSim(null)).toBeNull();
    expect(limparCustoSim(undefined)).toBeNull();
    expect(limparCustoSim({})).toBeNull();
  });
  it("zero, negativo e não-número viram null (tudo null → null)", () => {
    expect(limparCustoSim({ consumo_tecido: 0, aviamento: -1, mao_obra: Number.NaN })).toBeNull();
  });
  it("mantém só valores > 0 e descarta preco_tecido_m", () => {
    expect(limparCustoSim({ consumo_tecido: 1.2, aviamento: 0, mao_obra: 10, preco_tecido_m: 30 }))
      .toEqual({ consumo_tecido: 1.2, aviamento: null, mao_obra: 10 });
  });
  it("aceita número em texto", () => {
    expect(limparCustoSim({ aviamento: "4.5" } as any))
      .toEqual({ consumo_tecido: null, aviamento: 4.5, mao_obra: null });
  });
});

describe("invalidarAposAprovarMO", () => {
  it("invalida exatamente estas 7 queryKeys, nesta ordem", () => {
    const chamadas: unknown[] = [];
    const qc = { invalidateQueries: (o: { queryKey: unknown }) => { chamadas.push(o.queryKey); } };
    invalidarAposAprovarMO(qc as any, "m1");
    expect(chamadas).toEqual([
      ["modelo", "m1"],
      ["mo-resumo", "m1"],
      ["plan-custo-unit", "m1"],
      ["modelos-planejamento"],
      ["mo-resumo-list"],
      ["modelo-mo-resumo"],
      ["modelos-desenvolvimento"],
    ]);
  });
});

// F3.1 — campos vindos do Desenvolvimento + Descrição do produto.
describe("rotuloConflitoPlan — campos da F3.1", () => {
  it("rótulos PT iguais aos do Dev e do mockup", () => {
    expect(rotuloConflitoPlan("ref")).toBe("REF");
    expect(rotuloConflitoPlan("modelista_id")).toBe("Modelista");
    expect(rotuloConflitoPlan("piloteiro1_id")).toBe("Piloteiro 1");
    expect(rotuloConflitoPlan("data_piloto3")).toBe("Data Piloto 3");
    expect(rotuloConflitoPlan("data_desenho_tecnico")).toBe("Data Desenho Técnico");
    expect(rotuloConflitoPlan("data_aprovacao")).toBe("Data Aprovação");
    expect(rotuloConflitoPlan("observacoes_tecnicas")).toBe("Observações Técnicas");
    expect(rotuloConflitoPlan("motivo_cancelamento")).toBe("Motivo do cancelamento");
    expect(rotuloConflitoPlan("ficha_medida_url")).toBe("Ficha de Medidas");
    expect(rotuloConflitoPlan("descricao_produto")).toBe("Descrição do produto");
  });
});

describe("CAMPOS_DEV_DRAFT", () => {
  it("toda chave existe no Draft e a etapa NÃO está na lista", () => {
    const d = emptyDraft();
    for (const k of CAMPOS_DEV_DRAFT) expect(d).toHaveProperty(k);
    expect(CAMPOS_DEV_DRAFT).not.toContain("status_desenvolvimento" as never);
    expect(CAMPOS_DEV_DRAFT).toContain("observacoes_gerais");
  });
});

describe("textoOuNull", () => {
  it("vazio/só-espaço/null/undefined → null; texto passa como está", () => {
    expect(textoOuNull("")).toBeNull();
    expect(textoOuNull("   ")).toBeNull();
    expect(textoOuNull(null)).toBeNull();
    expect(textoOuNull(undefined)).toBeNull();
    expect(textoOuNull(" a b ")).toBe(" a b ");
  });
});

describe("aplicarRegrasCamposDev", () => {
  const base = (): Draft => ({
    ...emptyDraft(), nome: "M", ref: " QA1234 ", modelista_id: "m1", data_piloto1: "2026-09-12", data_piloto2: "",
    observacoes_tecnicas: "", motivo_cancelamento: "Motivo", observacoes_gerais: "", ficha_medida_url: "",
  });
  it("com permissão: vazios viram NULL (data vazia daria 22007) e os preenchidos passam", () => {
    const d = base();
    const p = aplicarRegrasCamposDev({ ...d }, d, { podeEditarDev: true, refEditavel: false });
    expect(p.modelista_id).toBe("m1");
    expect(p.piloteiro1_id).toBeNull();
    expect(p.piloteiro2_id).toBeNull();
    expect(p.piloteiro3_id).toBeNull();
    expect(p.data_piloto1).toBe("2026-09-12");
    expect(p.data_piloto2).toBeNull();
    expect(p.data_piloto3).toBeNull();
    expect(p.data_desenho_tecnico).toBeNull();
    expect(p.data_aprovacao).toBeNull();
    expect(p.observacoes_tecnicas).toBeNull();
    expect(p.observacoes_gerais).toBeNull();
    expect(p.ficha_medida_url).toBeNull();
    expect(p.motivo_cancelamento).toBe("Motivo"); // nunca apagado por causa da etapa (dono, 23/set)
  });
  it("sem permissão de editar o Dev: nenhum campo do Dev (nem a REF) vai no payload", () => {
    const d = base();
    const p = aplicarRegrasCamposDev({ ...d }, d, { podeEditarDev: false, refEditavel: true });
    for (const k of CAMPOS_DEV_DRAFT) expect(p).not.toHaveProperty(k);
    expect(p).not.toHaveProperty("ref");
    expect(p.nome).toBe("M");
  });
  it("REF só vai quando editável (aparada); vazia vira NULL", () => {
    const d = base();
    expect(aplicarRegrasCamposDev({ ...d }, d, { podeEditarDev: true, refEditavel: true }).ref).toBe("QA1234");
    expect(aplicarRegrasCamposDev({ ...d }, d, { podeEditarDev: true, refEditavel: false })).not.toHaveProperty("ref");
    const v = { ...d, ref: "   " };
    expect(aplicarRegrasCamposDev({ ...v }, v, { podeEditarDev: true, refEditavel: true }).ref).toBeNull();
  });
  // A garantia "a etapa nunca vai no payload" vem do TIPO, não desta função: `Draft` não tem
  // `status_desenvolvimento` (Task 2, decisão de escopo — ver modelo-shared.ts) e o chamador
  // (usePlanejamentoSave.ts) só espalha campos do Draft no payload. Simular uma entrada COM
  // essa chave testaria um filtro que `aplicarRegrasCamposDev` não implementa (ela só toca
  // `CAMPOS_DEV_DRAFT` + `ref`; qualquer outra chave do payload passa intocada) — seria um
  // teste FALSO. O que resta a testar aqui é a pureza: não muta a entrada recebida.
  it("é pura: não muta o objeto `payload` recebido", () => {
    const d = base();
    const entrada: Record<string, unknown> = { ...d };
    const antes = { ...entrada };
    aplicarRegrasCamposDev(entrada, d, { podeEditarDev: false, refEditavel: false });
    expect(entrada).toEqual(antes);
  });
});

describe("camposParaDuplicar (decisão F3 #9)", () => {
  it("leva Planejamento + tecidos + Obs. Gerais + Descrição; tira REF/versão/base e o resto do Dev", () => {
    const d: Draft = {
      ...emptyDraft(), nome: "M", ref: "QA1", versao: 3, modelo_base_id: "b", tecidos_planejados: ["a1"],
      observacoes_gerais: "og", descricao_produto: "desc", modelista_id: "m1", data_piloto1: "2026-09-12",
      motivo_cancelamento: "x", ficha_medida_url: "f.pdf", observacoes_tecnicas: "ot",
    };
    const p = camposParaDuplicar(d);
    expect(p.nome).toBe("M");
    expect(p.tecidos_planejados).toEqual(["a1"]);
    expect(p.observacoes_gerais).toBe("og");
    expect(p.descricao_produto).toBe("desc");
    for (const k of [
      "ref", "versao", "modelo_base_id", "modelista_id", "piloteiro1_id", "piloteiro2_id", "piloteiro3_id",
      "data_piloto1", "data_piloto2", "data_piloto3", "data_desenho_tecnico", "data_aprovacao",
      "observacoes_tecnicas", "motivo_cancelamento", "ficha_medida_url",
    ]) expect(p).not.toHaveProperty(k);
  });
  it("Descrição só-espaço vira NULL na cópia", () => {
    expect(camposParaDuplicar({ ...emptyDraft(), descricao_produto: "  " }).descricao_produto).toBeNull();
  });
});

// Fix round 1 (T2) — retry do P0409 mandava um rascunho VELHO: `mutationFn` fechava sobre o
// `draft` do render em que o hook foi criado; `save.mutate()` chamado de dentro do `onError`
// (antes do próximo re-render) via o mesmo closure reenviava esse draft velho, sobrescrevendo
// no banco os campos que o merge tinha acabado de adotar do outro usuário. `draftParaSalvar`
// isola a semântica "prefira o ref vivo" que resolve isto (receita do Dev), sem precisar
// montar o hook/mutation inteiro para testar.
describe("draftParaSalvar (fix round 1 — retry do P0409 usa o rascunho vivo)", () => {
  it("com o ref vivo preenchido, usa o ref (não o draft capturado)", () => {
    const capturado: Draft = { ...emptyDraft(), nome: "capturado (velho)" };
    const vivo: Draft = { ...emptyDraft(), nome: "vivo (pós-merge)" };
    expect(draftParaSalvar(vivo, capturado)).toBe(vivo);
    expect(draftParaSalvar(vivo, capturado).nome).toBe("vivo (pós-merge)");
  });
  it("sem ref (null/undefined), cai no draft capturado", () => {
    const capturado: Draft = { ...emptyDraft(), nome: "capturado" };
    expect(draftParaSalvar(null, capturado)).toBe(capturado);
    expect(draftParaSalvar(undefined, capturado)).toBe(capturado);
  });
  it("fluxo simulado 'setDraft → mutate → mutationFn lê o ref': o mock de draftLiveRef.current\n" +
     "   muda ENTRE a criação do closure e a chamada da mutationFn, como no retry real", () => {
    // Simula o padrão real: um objeto ref mutável que o componente atualiza a cada render
    // (`draftLiveRef.current = draft`) e que o onError atualiza de novo, SÍNCRONO, após o
    // merge (`draftLiveRef.current = md.valor`) — ANTES de chamar save.mutate() de novo.
    const ref: { current: Draft | null } = { current: null };
    const draftDoRenderQueCriouOHook: Draft = { ...emptyDraft(), nome: "render 1 (velho)" };
    ref.current = draftDoRenderQueCriouOHook; // 1º render: ref reflete o draft

    // "mutationFn" é uma closure que fecha sobre `draftDoRenderQueCriouOHook` (o `draft` do
    // primeiro render) mas lê `ref.current` na hora de montar o payload — exatamente como
    // `usePlanejamentoSave`.
    const mutationFn = () => draftParaSalvar(ref.current, draftDoRenderQueCriouOHook);

    // setDraft(md.valor) do merge no onError + o espelho síncrono (draftLiveRef.current =
    // md.valor) — SEM esperar o próximo render, como a correção exige.
    const draftPosMerge: Draft = { ...emptyDraft(), nome: "pós-merge (adotado do outro usuário)" };
    ref.current = draftPosMerge;

    // O retry (save.mutate() dentro do onError) chama a MESMA mutationFn de novo, ainda
    // fechada sobre o draft do 1º render — mas o payload tem que refletir o pós-merge.
    expect(mutationFn().nome).toBe("pós-merge (adotado do outro usuário)");
  });
});

// Fix final (F3.1, item 2) — "eco do próprio Salvar": o `savedDraft` que vira `baseRef` tem que
// refletir os MESMOS valores normalizados que o payload de fato gravou (ref.trim(), descricao_produto
// trim-ou-NULL), senão o merge do refetch seguinte compara base≠fresh nesses 2 campos e mostra o
// PRÓPRIO save de quem clicou Salvar como "Alguém salvou agora".
describe("normalizarDraftSalvo (fix final — base do merge sem eco do próprio Salvar)", () => {
  it("apara a REF, igual ao que o payload manda (ref.trim())", () => {
    const d: Draft = { ...emptyDraft(), ref: "  QA1234  " };
    expect(normalizarDraftSalvo(d).ref).toBe("QA1234");
  });
  it("descricao_produto só-espaço vira string vazia (equivalente ao NULL gravado)", () => {
    const d: Draft = { ...emptyDraft(), descricao_produto: "   " };
    expect(normalizarDraftSalvo(d).descricao_produto).toBe("");
  });
  it("descricao_produto preenchida passa como está", () => {
    const d: Draft = { ...emptyDraft(), descricao_produto: "Camiseta gola V" };
    expect(normalizarDraftSalvo(d).descricao_produto).toBe("Camiseta gola V");
  });
  it("não muta os demais campos do draft", () => {
    const d: Draft = { ...emptyDraft(), nome: "M", ref: " R ", preco_venda: 10 };
    const out = normalizarDraftSalvo(d);
    expect(out.nome).toBe("M");
    expect(out.preco_venda).toBe(10);
  });
  it("é pura: não muta o objeto recebido", () => {
    const d: Draft = { ...emptyDraft(), ref: " R " };
    const antes = { ...d };
    normalizarDraftSalvo(d);
    expect(d).toEqual(antes);
  });
});

describe("rotuloConflitoPlan — F3.2 (BOM no Sheet do Planejamento)", () => {
  it("rotula a seção do BOM com o MESMO texto do Desenvolvimento", () => {
    expect(rotuloConflitoPlan("secao:bom")).toBe("Tecidos & BOM");
  });
  it("rotula as 2 colunas novas do Draft", () => {
    expect(rotuloConflitoPlan("proporcoes")).toBe("Proporções da grade");
    expect(rotuloConflitoPlan("custos_adicionais")).toBe("Custos adicionais");
  });
});

describe("CAMPOS_DEV_DRAFT — F3.2 (lista ÚNICA com a F3.1)", () => {
  const d = (): Draft => ({ ...emptyDraft(), nome: "M", proporcoes: { P: 1, M: 2 }, custos_adicionais: [{ descricao: "Bordado", valor: 3.5 }] });
  it("inclui proporcoes e custos_adicionais", () => {
    expect(CAMPOS_DEV_DRAFT).toContain("proporcoes");
    expect(CAMPOS_DEV_DRAFT).toContain("custos_adicionais");
  });
  it("sem permissão do Dev: saem do payload (aplicarRegrasCamposDev)", () => {
    const x = d();
    const p = aplicarRegrasCamposDev({ ...x }, x, { podeEditarDev: false, refEditavel: false });
    expect(p).not.toHaveProperty("proporcoes");
    expect(p).not.toHaveProperty("custos_adicionais");
    expect(p.nome).toBe("M");
  });
  it("com permissão: vão como estão (objeto/array — sem normalização, sem reescrita do draft)", () => {
    // Fix round 1, minor: o payload de entrada NÃO tem as 2 chaves (ao contrário do teste
    // original, que só provava passthrough de `{...x}` para `{...x}`) e o draft tem valores
    // DIFERENTES dos que já estavam no payload — prova que a função nem apaga (como faz sem
    // permissão) nem reescreve a partir do draft (ao contrário dos escalares acima, que SÃO
    // reescritos): fica exatamente o que veio no payload.
    const x = d();
    const payloadSemAsChaves = { nome: x.nome }; // sem proporcoes/custos_adicionais
    const p1 = aplicarRegrasCamposDev(payloadSemAsChaves, x, { podeEditarDev: true, refEditavel: false });
    expect(p1).not.toHaveProperty("proporcoes");
    expect(p1).not.toHaveProperty("custos_adicionais");

    const payloadComOutrosValores = { nome: x.nome, proporcoes: { G: 9 }, custos_adicionais: [] as { descricao: string; valor: number }[] };
    const draftComOutrosValores: Draft = { ...x, proporcoes: { P: 1, M: 2 }, custos_adicionais: [{ descricao: "Bordado", valor: 3.5 }] };
    const p2 = aplicarRegrasCamposDev(payloadComOutrosValores, draftComOutrosValores, { podeEditarDev: true, refEditavel: false });
    expect(p2.proporcoes).toEqual({ G: 9 }); // do PAYLOAD, não do draft — sem reescrita
    expect(p2.custos_adicionais).toEqual([]);
  });
  it("Duplicar (decisão F3 #9): a cópia NÃO leva proporções nem custos adicionais", () => {
    const p = camposParaDuplicar(d());
    expect(p).not.toHaveProperty("proporcoes");
    expect(p).not.toHaveProperty("custos_adicionais");
    expect(p.nome).toBe("M");
  });
});

describe("rotuloConflitoPlan — F3.6 (seção Códigos)", () => {
  it("'Tamanho em'", () => {
    expect(rotuloConflitoPlan("tamanho_tipo")).toBe("Tamanho em");
  });
});

describe("F3.6 (Parte B) — campos novos: rótulos, NCM, números e Preço anterior", () => {
  it("rótulos PT do banner de conflito", () => {
    expect(rotuloConflitoPlan("titulo_pagina")).toBe("Título para a página");
    expect(rotuloConflitoPlan("peso_kg")).toBe("Peso (kg)");
    expect(rotuloConflitoPlan("comprimento_cm")).toBe("Comprimento (cm)");
    expect(rotuloConflitoPlan("largura_cm")).toBe("Largura (cm)");
    expect(rotuloConflitoPlan("altura_cm")).toBe("Altura (cm)");
    expect(rotuloConflitoPlan("ncm")).toBe("NCM do Produto");
    expect(rotuloConflitoPlan("preco_anterior")).toBe("Preço anterior");
  });
  it("filtrarNcm: vírgula vira ponto (teclado decimal do iOS pt-BR — R30); só dígitos e pontos, até 10 (ruling 3)", () => {
    expect(filtrarNcm("6204.43.00")).toBe("6204.43.00");
    expect(filtrarNcm("6204,43,00")).toBe("6204.43.00");
    expect(filtrarNcm("62ab04.43,00x")).toBe("6204.43.00");
    expect(filtrarNcm("62044300999")).toBe("6204430099");
    expect(filtrarNcm(null)).toBe("");
  });
  // P8 (fix1, revisão Opus do Lote B1 — parqueado da T8): colar um texto com PREFIXO (ex.: "NCM: 6204.43.00") tem que
  // extrair os dígitos/pontos corretos, não truncar pelos primeiros 10 CARACTERES do texto colado (o bug era o
  // `maxLength={10}` do <Input> cortando ANTES de `filtrarNcm` rodar — aqui provamos que a função pura já filtra certo;
  // remover o `maxLength` no componente é o que deixa esse resultado chegar até o Draft).
  it("filtrarNcm: texto colado com prefixo — extrai os dígitos/pontos certos, não os 10 primeiros caracteres crus", () => {
    expect(filtrarNcm("NCM: 6204.43.00")).toBe("6204.43.00");
    expect(filtrarNcm("Código NCM 6204.43.00")).toBe("6204.43.00");
  });
  it("numeroOuNull: vazio/null/inválido = NULL; 0 VALE (CHECK >= 0); arredonda às casas da coluna", () => {
    expect(numeroOuNull("", 3)).toBeNull();
    expect(numeroOuNull(null, 2)).toBeNull();
    expect(numeroOuNull("abc", 2)).toBeNull();
    expect(numeroOuNull(0, 3)).toBe(0);
    expect(numeroOuNull("0.3456", 3)).toBe(0.346);
    expect(numeroOuNull(12.346, 2)).toBe(12.35);
  });
  it("numeroDoInput: o '' do MoneyInput = NULL (vazio), o resto vira número", () => {
    expect(numeroDoInput("")).toBeNull();
    expect(numeroDoInput("0")).toBe(0);
    expect(numeroDoInput("1.5")).toBe(1.5);
  });
  it("precoAnteriorOuNull: vazio/0 = NULL = automático (não 'preço zero' — ruling 11)", () => {
    expect(precoAnteriorOuNull(null)).toBeNull();
    expect(precoAnteriorOuNull("")).toBeNull();
    expect(precoAnteriorOuNull(0)).toBeNull();
    expect(precoAnteriorOuNull("199.9")).toBe(199.9);
    expect(precoAnteriorOuNull(199.999)).toBe(200);
  });
  it("precoAnteriorExibido: o fixado; senão o preço EFETIVO; efetivo 0 = vazio", () => {
    expect(precoAnteriorExibido(150, 199.9)).toBe(150);
    expect(precoAnteriorExibido(null, 199.9)).toBe(199.9);
    expect(precoAnteriorExibido(undefined, 0)).toBeNull();
  });
  it("camposNovosParaPayload: título aparado (vazio = NULL = automático), NCM filtrado, números normalizados", () => {
    expect(camposNovosParaPayload({
      titulo_pagina: "  Meu título  ", ncm: "6204.43.00x", peso_kg: 0.3456, comprimento_cm: 60, largura_cm: null, altura_cm: 0,
    })).toEqual({ titulo_pagina: "Meu título", ncm: "6204.43.00", peso_kg: 0.346, comprimento_cm: 60, largura_cm: null, altura_cm: 0 });
    expect(camposNovosParaPayload({
      titulo_pagina: "   ", ncm: "", peso_kg: null, comprimento_cm: null, largura_cm: null, altura_cm: null,
    })).toEqual({ titulo_pagina: null, ncm: null, peso_kg: null, comprimento_cm: null, largura_cm: null, altura_cm: null });
  });
  it("camposParaDuplicar: Título e Preço anterior voltam ao AUTOMÁTICO (fora do objeto); NCM/peso/medidas/descrição/'Tamanho em' vão", () => {
    const d = {
      ...emptyDraft(), nome: "Vestido", titulo_pagina: "Título à mão", preco_anterior: 199.9, ncm: "6204.43.00",
      peso_kg: 0.35, comprimento_cm: 60, largura_cm: 40, altura_cm: 2.5, descricao_produto: "Desc", tamanho_tipo: "numero" as const,
    };
    const out = camposParaDuplicar(d);
    expect(out).not.toHaveProperty("titulo_pagina");
    expect(out).not.toHaveProperty("preco_anterior");
    expect(out).toMatchObject({ ncm: "6204.43.00", peso_kg: 0.35, comprimento_cm: 60, largura_cm: 40, altura_cm: 2.5, descricao_produto: "Desc", tamanho_tipo: "numero" });
  });
  it("normalizarDraftSalvo: os 7 com as MESMAS regras do payload (base do merge sem eco do próprio Salvar)", () => {
    const n = normalizarDraftSalvo({
      ...emptyDraft(), titulo_pagina: "  ", ncm: "62.04x", peso_kg: 0.3456, preco_anterior: 0,
    });
    expect(n).toMatchObject({ titulo_pagina: null, ncm: "62.04", peso_kg: 0.346, preco_anterior: null });
  });
});

// Ruling R-a (revisão do Lote B1, mesmo tema da T9): `aplicarPrecoAnterior` extraída de `usePlanejamentoSave.ts`
// como função PURA — a MESMA regra de permissão do preço de venda, aplicada no MESMO ponto pros dois ramos
// (manufaturado/importado e revenda).
describe("aplicarPrecoAnterior (ruling R-a)", () => {
  it("com permissão: grava precoAnteriorOuNull(d.preco_anterior) — 0/vazio/negativo viram NULL", () => {
    const payload: Record<string, unknown> = {};
    aplicarPrecoAnterior(payload, { ...emptyDraft(), preco_anterior: 199.9 }, true);
    expect(payload.preco_anterior).toBe(199.9);

    const p0: Record<string, unknown> = {};
    aplicarPrecoAnterior(p0, { ...emptyDraft(), preco_anterior: 0 }, true);
    expect(p0.preco_anterior).toBeNull();

    const pNeg: Record<string, unknown> = {};
    aplicarPrecoAnterior(pNeg, { ...emptyDraft(), preco_anterior: -10 }, true);
    expect(pNeg.preco_anterior).toBeNull();

    const pNull: Record<string, unknown> = {};
    aplicarPrecoAnterior(pNull, { ...emptyDraft(), preco_anterior: null }, true);
    expect(pNull.preco_anterior).toBeNull();
  });
  it("sem permissão: a chave NÃO entra no payload (nem para apagar um valor já presente)", () => {
    const payload: Record<string, unknown> = { preco_anterior: 150, nome: "M" };
    aplicarPrecoAnterior(payload, { ...emptyDraft(), preco_anterior: 199.9 }, false);
    expect(payload).not.toHaveProperty("preco_anterior");
    expect(payload.nome).toBe("M");
  });
});

// Ruling R-b (revisão do Lote B1): sem `podeEditarPreco`, `normalizarDraftSalvo` NÃO normaliza `preco_anterior` —
// usa o valor CRU do servidor (o payload não o manda nesse caso), evitando o falso "Alguém salvou agora" quando
// o banco tem 0/negativo (dado legado) e quem salvou não tinha a permissão de ver/mexer no preço.
// P-53 A (set/2026) — espelho de CAMPOS_DEV_DRAFT/aplicarRegrasCamposDev, do lado do Planejamento:
// sem `podeEditarPlanejamento`, os campos SÓ do Planejamento saem do payload; os compartilhados
// (que o Dev também gravava) NUNCA são tocados por esta função.
describe("CAMPOS_SO_PLANEJAMENTO_DRAFT", () => {
  it("toda chave existe no Draft", () => {
    const d = emptyDraft();
    for (const k of CAMPOS_SO_PLANEJAMENTO_DRAFT) expect(d).toHaveProperty(k);
  });
  it("não tem interseção com CAMPOS_DEV_DRAFT (Planejamento-only vs Dev)", () => {
    const dev = new Set(CAMPOS_DEV_DRAFT as readonly string[]);
    for (const k of CAMPOS_SO_PLANEJAMENTO_DRAFT) expect(dev.has(k)).toBe(false);
  });
  it("inclui os campos-referência do brief (status, origem, título, medidas, tamanho_tipo, versão, preços, lançamento, NCM) + fix 1 (custo_simulado, descricao_produto)", () => {
    for (const k of [
      "status_planejamento", "origem", "titulo_pagina", "peso_kg", "comprimento_cm", "largura_cm", "altura_cm",
      "tamanho_tipo", "versao", "preco_venda", "preco_atacado", "preco_anterior", "data_lancamento", "ncm",
      // Fix 1 (I-1a) — Consumo de tecido/Materiais (estimativa) gravam em custo_simulado.
      "custo_simulado",
      // Fix 1 (m-4, RULING) — descricao_produto é SÓ-PLANEJAMENTO: o Dev antigo nunca teve esse campo.
      "descricao_produto",
    ]) expect(CAMPOS_SO_PLANEJAMENTO_DRAFT).toContain(k);
  });
  it("NUNCA inclui os campos compartilhados (o Dev também gravava)", () => {
    for (const k of [
      "nome", "linha_id", "estilista_id", "categoria_principal_id", "subcategoria1_id", "subcategoria2_id",
      "colecao_id", "subcolecao", "mes_id", "ano_id", "semana", "fotos_modelo",
      "fotos_referencia", "desenho_tecnico_url", "croqui_url", "ficha_medida_url", "observacoes_gerais",
      "observacoes_mao_obra", "custos_adicionais", "proporcoes",
    ]) expect(CAMPOS_SO_PLANEJAMENTO_DRAFT).not.toContain(k);
  });
});

// Fix 1 (m-6i) — classificação TOTAL: cada chave do Draft cai em EXATAMENTE uma das 3 listas
// (CAMPOS_DEV_DRAFT, CAMPOS_SO_PLANEJAMENTO_DRAFT, CAMPOS_COMPARTILHADOS_DRAFT). Uma chave nova sem
// classificação (ou classificada 2×) derruba este teste — trava a disciplina "nem ganha nem perde"
// contra o esquecimento ao adicionar campo novo ao Draft.
describe("Classificação total dos campos do Draft (P-53 A, fix 1 — m-6i)", () => {
  it("toda chave de emptyDraft() está em EXATAMENTE uma das 3 listas", () => {
    const chaves = Object.keys(emptyDraft());
    const dev = new Set(CAMPOS_DEV_DRAFT as readonly string[]);
    const plano = new Set(CAMPOS_SO_PLANEJAMENTO_DRAFT as readonly string[]);
    const compartilhado = new Set(CAMPOS_COMPARTILHADOS_DRAFT as readonly string[]);
    const naoClassificadas: string[] = [];
    const duplicadas: string[] = [];
    for (const k of chaves) {
      const n = (dev.has(k) ? 1 : 0) + (plano.has(k) ? 1 : 0) + (compartilhado.has(k) ? 1 : 0);
      if (n === 0) naoClassificadas.push(k);
      if (n > 1) duplicadas.push(k);
    }
    expect(naoClassificadas).toEqual([]);
    expect(duplicadas).toEqual([]);
  });
  it("as 3 listas juntas não têm chave fora do Draft (sem lixo/typo)", () => {
    const chaves = new Set(Object.keys(emptyDraft()));
    for (const k of [...CAMPOS_DEV_DRAFT, ...CAMPOS_SO_PLANEJAMENTO_DRAFT, ...CAMPOS_COMPARTILHADOS_DRAFT])
      expect(chaves.has(k)).toBe(true);
  });
});

describe("aplicarRegrasCamposPlanejamento", () => {
  const payloadCheio = (): Record<string, unknown> => ({
    nome: "M", linha_id: "l1", status_planejamento: "em_planejamento", origem: "interno",
    titulo_pagina: "T", peso_kg: 1, comprimento_cm: 2, largura_cm: 3, altura_cm: 4,
    tamanho_tipo: "letra", versao: 1, preco_venda: 100, preco_atacado: 80, preco_anterior: 90,
    data_lancamento: "2026-10-01", ncm: "6204.43.00",
  });
  it("com permissão: não mexe em nada (mesmas chaves e valores)", () => {
    const p = payloadCheio();
    const out = aplicarRegrasCamposPlanejamento({ ...p }, { podeEditarPlanejamento: true });
    expect(out).toEqual(p);
  });
  it("sem permissão: apaga só a lista de CAMPOS_SO_PLANEJAMENTO_DRAFT presentes no payload", () => {
    const p = payloadCheio();
    const out = aplicarRegrasCamposPlanejamento({ ...p }, { podeEditarPlanejamento: false });
    for (const k of CAMPOS_SO_PLANEJAMENTO_DRAFT) expect(out).not.toHaveProperty(k);
  });
  it("sem permissão: NUNCA apaga os campos compartilhados que vieram no payload", () => {
    const p = { ...payloadCheio(), nome: "M", linha_id: "l1", colecao_id: "c1" };
    const out = aplicarRegrasCamposPlanejamento(p, { podeEditarPlanejamento: false });
    expect(out.nome).toBe("M");
    expect(out.linha_id).toBe("l1");
    expect(out.colecao_id).toBe("c1");
  });
  // Fix 1 (I-1a/m-4) — custo_simulado e descricao_produto são SÓ-PLANEJAMENTO: apagados sem permissão.
  it("sem permissão: apaga custo_simulado e descricao_produto (fix 1 — antes ficavam sem gate)", () => {
    const p = { ...payloadCheio(), custo_simulado: { aviamento: 5 }, descricao_produto: "d" };
    const out = aplicarRegrasCamposPlanejamento(p, { podeEditarPlanejamento: false });
    expect(out).not.toHaveProperty("custo_simulado");
    expect(out).not.toHaveProperty("descricao_produto");
  });
  it("é pura: não muta o objeto `payload` recebido", () => {
    const p = payloadCheio();
    const antes = { ...p };
    aplicarRegrasCamposPlanejamento(p, { podeEditarPlanejamento: false });
    expect(p).toEqual(antes);
  });
});

describe("normalizarDraftSalvo — R-b (permissão de preço)", () => {
  it("sem permissão + servidor com 0: mantém 0 (não normaliza para NULL)", () => {
    const n = normalizarDraftSalvo({ ...emptyDraft(), preco_anterior: 0 }, false);
    expect(n.preco_anterior).toBe(0);
  });
  it("sem permissão + servidor com valor negativo (dado legado): mantém o valor cru", () => {
    const n = normalizarDraftSalvo({ ...emptyDraft(), preco_anterior: -5 }, false);
    expect(n.preco_anterior).toBe(-5);
  });
  it("com permissão (default do parâmetro): normaliza — 0 vira NULL, como antes", () => {
    const n = normalizarDraftSalvo({ ...emptyDraft(), preco_anterior: 0 });
    expect(n.preco_anterior).toBeNull();
  });
  it("com permissão explícita=true: idêntico ao default", () => {
    const n = normalizarDraftSalvo({ ...emptyDraft(), preco_anterior: 199.9 }, true);
    expect(n.preco_anterior).toBe(199.9);
  });
});
