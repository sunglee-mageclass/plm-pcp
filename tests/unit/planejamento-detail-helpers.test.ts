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
