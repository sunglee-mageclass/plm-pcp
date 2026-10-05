import { describe, it, expect } from "vitest";
import {
  COLUNAS_PAGINA,
  colunasDoErro,
  montarMudancas,
  rebasearBaseRaw,
  rotuloColuna,
  serializarColuna,
  type ConfigLojaColab,
} from "@/lib/config-loja-colab";
import { KANBAN_COLS, pickKanban, type KanbanColsValor } from "@/lib/kanban-auto-config";

// Config "completa" de referência — mesmo shape de ConfigState (DEFAULTS) da tela, só os campos
// que este módulo toca. Serve de base para os testes de montarMudancas/paridade de serialização.
function cfgBase(): ConfigLojaColab {
  return {
    timezone: "America/Sao_Paulo",
    modo_baixa_estoque: "por_oc",
    modo_oc_rolo: "ambos",
    explosao_envio_status: "",
    ref_exibir_status: "",
    markup_analise_faixa: false,
    leadtime: { etapas: [], slaServico: null },
    pcp_etapas: [],
    revenda_campos: {},
    ref_config: null,
    keywords: "",
    status_kanban: ["Em Modelagem", "Aprovado"],
    kanban_requisitos: {},
    kanban_requisitos_excecoes: {},
    revenda_kanban_colunas: [],
    revenda_kanban_requisitos: {},
    insumos_padrao: [],
  };
}

describe("COLUNAS_PAGINA — 17 colunas (19 da lista branca da RPC menos tab_labels/campos_editaveis)", () => {
  it("tem exatamente 17 chaves (16 + insumos_padrao), sem tab_labels/campos_editaveis", () => {
    expect(COLUNAS_PAGINA).toHaveLength(17);
    expect(COLUNAS_PAGINA).toContain("insumos_padrao");
    expect(COLUNAS_PAGINA).not.toContain("tab_labels");
    expect(COLUNAS_PAGINA).not.toContain("campos_editaveis");
  });
  it("inclui as 5 colunas de kanban (RP3) dentro das 17", () => {
    for (const c of KANBAN_COLS) expect(COLUNAS_PAGINA).toContain(c);
  });
});

describe("serializarColuna — paridade byte-a-byte com o mutationFn de hoje", () => {
  // explosao_envio_status / ref_exibir_status: "" (Aprovado/ausência) → null.
  it('explosao_envio_status: "" → null; string não-vazia passa direto', () => {
    expect(serializarColuna("explosao_envio_status", "")).toBeNull();
    expect(serializarColuna("explosao_envio_status", "em_ajuste")).toBe("em_ajuste");
  });
  it('ref_exibir_status: "" → null; string não-vazia passa direto', () => {
    expect(serializarColuna("ref_exibir_status", "")).toBeNull();
    expect(serializarColuna("ref_exibir_status", "aprovado")).toBe("aprovado");
  });
  // ref_config "vazio" (sem partes, ou partes=[]) → null — mesmo espírito do "" → null.
  it("ref_config: null, sem partes, ou partes=[] → null", () => {
    expect(serializarColuna("ref_config", null)).toBeNull();
    expect(serializarColuna("ref_config", {})).toBeNull();
    expect(serializarColuna("ref_config", { partes: [] })).toBeNull();
  });
  it("ref_config: com partes preenchidas → passa o objeto inteiro", () => {
    const v = { partes: ["ref", "cor_base"], separador: "-" };
    expect(serializarColuna("ref_config", v)).toEqual(v);
  });
  // keywords: só espaços (inclusive "") → null; texto com conteúdo vai APARADO (espelha o btrim do banco —
  // revisão T3/T4 I2).
  it('keywords: "" ou só espaços → null', () => {
    expect(serializarColuna("keywords", "")).toBeNull();
    expect(serializarColuna("keywords", "   ")).toBeNull();
    expect(serializarColuna("keywords", "\t\n ")).toBeNull();
  });
  it("keywords: texto com conteúdo vai APARADO nas bordas (miolo intacto)", () => {
    expect(serializarColuna("keywords", "  moda feminina  ")).toBe("moda feminina");
    expect(serializarColuna("keywords", "linha 1\nlinha 2 ")).toBe("linha 1\nlinha 2");
    expect(serializarColuna("keywords", "linho")).toBe("linho");
  });
  it("keywords: valor não-string (defensivo) → null", () => {
    expect(serializarColuna("keywords", null)).toBeNull();
    expect(serializarColuna("keywords", undefined)).toBeNull();
  });
  // Demais colunas: passa direto, sem regra especial.
  it("colunas sem regra especial passam o valor direto (mesmo objeto/array)", () => {
    expect(serializarColuna("timezone", "America/Bahia")).toBe("America/Bahia");
    expect(serializarColuna("modo_oc_rolo", "rolo")).toBe("rolo");
    expect(serializarColuna("markup_analise_faixa", true)).toBe(true);
    const leadtime = { etapas: [{ key: "a", tipo: "macro", idealDias: 3 }], slaServico: null };
    expect(serializarColuna("leadtime", leadtime)).toBe(leadtime);
    const req = { em_ajuste: ["cad_preenchido"] };
    expect(serializarColuna("kanban_requisitos", req)).toBe(req);
  });
});

describe("montarMudancas — só colunas TOCADAS, base = valor CRU do servidor", () => {
  it("nada tocado → mudancas e base vazios", () => {
    const cfg = cfgBase();
    const { mudancas, base } = montarMudancas({
      cfg,
      baseUi: cfg,
      baseRaw: { timezone: "America/Sao_Paulo" },
      kanbanBaseCfg: pickKanban(cfg),
    });
    expect(mudancas).toEqual({});
    expect(base).toEqual({});
  });

  it("só a coluna GERAL tocada entra — e vem serializada", () => {
    const baseUi = cfgBase();
    const cfg = { ...baseUi, explosao_envio_status: "" as string, keywords: "  " };
    // keywords tocada (baseUi.keywords="" → cfg.keywords="  ", ambos "vazios" mas strings distintas
    // via `igual` — precisamos de uma mudança REAL para o teste de "tocado"; usar timezone.
    const cfg2 = { ...baseUi, timezone: "America/Bahia" };
    const baseRaw = { timezone: "America/Sao_Paulo", modo_baixa_estoque: "por_oc" };
    const { mudancas, base } = montarMudancas({ cfg: cfg2, baseUi, baseRaw, kanbanBaseCfg: pickKanban(baseUi) });
    expect(mudancas).toEqual({ timezone: "America/Bahia" });
    expect(base).toEqual({ timezone: "America/Sao_Paulo" });
    // volta ao caminho não usado do cfg/keywords, sem afirmação (guard contra variável não usada)
    expect(cfg.explosao_envio_status).toBe("");
  });

  it("coluna GERAL tocada mas SERIALIZA para null (keywords só espaços) — mudancas leva null", () => {
    const baseUi = { ...cfgBase(), keywords: "antigo" };
    const cfg = { ...baseUi, keywords: "   " };
    const baseRaw = { keywords: "antigo" };
    const { mudancas, base } = montarMudancas({ cfg, baseUi, baseRaw, kanbanBaseCfg: pickKanban(baseUi) });
    expect(mudancas).toEqual({ keywords: null });
    expect(base).toEqual({ keywords: "antigo" });
  });

  it("coluna GERAL igual à base (via `igual`, não ===) não é tocada — objetos equivalentes", () => {
    const baseUi = { ...cfgBase(), revenda_campos: { s1: true, prova: false } };
    // Mesmo conteúdo, chaves em ordem diferente + objeto NOVO (referência distinta).
    const cfg = { ...baseUi, revenda_campos: { prova: false, s1: true } };
    const { mudancas } = montarMudancas({ cfg, baseUi, baseRaw: {}, kanbanBaseCfg: pickKanban(baseUi) });
    expect(mudancas).toEqual({});
  });

  it("colunas de KANBAN usam diffKanban (não `igual`) contra kanbanBaseCfg — RP3", () => {
    const baseUi = cfgBase();
    const kanbanBaseCfg = pickKanban(baseUi); // simula kanbanBase.cfg (pode divergir de baseUi se outra aba editou)
    const cfg = { ...baseUi, status_kanban: ["Em Modelagem", "Em Ajuste", "Aprovado"] };
    const baseRaw = { status_kanban: ["Em Modelagem", "Aprovado"] };
    const { mudancas, base } = montarMudancas({ cfg, baseUi, baseRaw, kanbanBaseCfg });
    expect(mudancas).toEqual({ status_kanban: ["Em Modelagem", "Em Ajuste", "Aprovado"] });
    expect(base).toEqual({ status_kanban: ["Em Modelagem", "Aprovado"] });
  });

  it("kanban: coluna ausente de baseRaw entra em base como null (nunca omitida)", () => {
    const baseUi = cfgBase();
    const cfg = { ...baseUi, kanban_requisitos: { em_ajuste: ["x"] } };
    const { mudancas, base } = montarMudancas({ cfg, baseUi, baseRaw: {}, kanbanBaseCfg: pickKanban(baseUi) });
    expect(mudancas).toEqual({ kanban_requisitos: { em_ajuste: ["x"] } });
    expect(base).toEqual({ kanban_requisitos: null });
  });

  it("toda chave de mudancas TEM par em base (invariante do contrato da RPC)", () => {
    const baseUi = cfgBase();
    const cfg: ConfigLojaColab = {
      ...baseUi,
      timezone: "America/Bahia",
      modo_oc_rolo: "rolo",
      keywords: "novo",
      status_kanban: ["X"],
      revenda_kanban_colunas: ["em_ajuste"],
    };
    const baseRaw = { timezone: "America/Sao_Paulo", modo_oc_rolo: "ambos", keywords: null };
    const { mudancas, base } = montarMudancas({ cfg, baseUi, baseRaw, kanbanBaseCfg: pickKanban(baseUi) });
    for (const k of Object.keys(mudancas)) {
      expect(Object.prototype.hasOwnProperty.call(base, k)).toBe(true);
    }
    expect(Object.keys(mudancas).sort()).toEqual(
      ["timezone", "modo_oc_rolo", "keywords", "status_kanban", "revenda_kanban_colunas"].sort(),
    );
  });

  it("colunas NÃO tocadas não aparecem em mudancas nem em base (payload mínimo)", () => {
    const baseUi = cfgBase();
    const cfg = { ...baseUi, timezone: "America/Bahia" };
    const { mudancas, base } = montarMudancas({ cfg, baseUi, baseRaw: { pcp_etapas: [{ key: "a" }] }, kanbanBaseCfg: pickKanban(baseUi) });
    expect(mudancas).not.toHaveProperty("pcp_etapas");
    expect(base).not.toHaveProperty("pcp_etapas");
    expect(Object.keys(mudancas)).toEqual(["timezone"]);
  });
});

describe("base RAW vs base NORMALIZADA — loja com status_kanban NULL não conflita para sempre", () => {
  it("baseRaw usa o valor CRU do servidor (null), não os DEFAULTS", () => {
    const baseUi = cfgBase(); // baseUi.status_kanban já normalizado pela tela (DEFAULTS aplicados)
    const kanbanBaseCfg: KanbanColsValor = pickKanban({ status_kanban: null }); // servidor NUNCA gravou
    const cfg = { ...baseUi, status_kanban: ["Nova Coluna"] };
    const baseRawCru = { status_kanban: null }; // *** CRU, não normalizado ***
    const { mudancas, base } = montarMudancas({ cfg, baseUi, baseRaw: baseRawCru, kanbanBaseCfg });
    expect(mudancas.status_kanban).toEqual(["Nova Coluna"]);
    // base é o CRU (null), nunca os DEFAULTS que a tela usaria para exibir.
    expect(base.status_kanban).toBeNull();
  });

  it("sem mudança de status_kanban, a coluna nem entra (não force conflito eterno)", () => {
    const baseUi = cfgBase();
    // kanbanBase.cfg é sempre o valor NORMALIZADO (a tela nunca guarda null aqui — só `baseRaw`,
    // lido cru do servidor, pode ser null); com kanbanBaseCfg == cfg (nada tocado), o diff dá
    // vazio mesmo com baseRaw.status_kanban=null no servidor.
    const cfg = { ...baseUi };
    const kanbanBaseCfg: KanbanColsValor = pickKanban(cfg);
    const { mudancas } = montarMudancas({ cfg, baseUi, baseRaw: { status_kanban: null }, kanbanBaseCfg });
    expect(mudancas).not.toHaveProperty("status_kanban");
  });
});

describe("rebasearBaseRaw", () => {
  const COMPLETO = Object.fromEntries(COLUNAS_PAGINA.map((k) => [k, `v0:${k}`]));

  it("sem conflito e sem proteção de kanban: tudo re-baseia para o fresh", () => {
    const fresh = Object.fromEntries(COLUNAS_PAGINA.map((k) => [k, `fresh:${k}`]));
    const out = rebasearBaseRaw(COMPLETO, fresh, new Set(), false);
    for (const k of COLUNAS_PAGINA) expect(out[k]).toBe(`fresh:${k}`);
  });

  it("coluna em conflito NÃO re-baseia — mantém o valor anterior", () => {
    const fresh = Object.fromEntries(COLUNAS_PAGINA.map((k) => [k, `fresh:${k}`]));
    const out = rebasearBaseRaw(COMPLETO, fresh, new Set(["timezone", "keywords"]), false);
    expect(out.timezone).toBe("v0:timezone");
    expect(out.keywords).toBe("v0:keywords");
    expect(out.modo_oc_rolo).toBe("fresh:modo_oc_rolo"); // não está em conflito → re-baseia
  });

  it("protegidoKanban=true: as 5 colunas de kanban NÃO re-baseiam mesmo fora de emConflito", () => {
    const fresh = Object.fromEntries(COLUNAS_PAGINA.map((k) => [k, `fresh:${k}`]));
    const out = rebasearBaseRaw(COMPLETO, fresh, new Set(), true);
    for (const c of KANBAN_COLS) expect(out[c]).toBe(`v0:${c}`);
    // colunas gerais (fora do kanban) continuam re-baseando normalmente.
    expect(out.timezone).toBe("fresh:timezone");
  });

  it("protegidoKanban=false: kanban re-baseia como qualquer coluna (sujeito só a emConflito)", () => {
    const fresh = Object.fromEntries(COLUNAS_PAGINA.map((k) => [k, `fresh:${k}`]));
    const out = rebasearBaseRaw(COMPLETO, fresh, new Set(["status_kanban"]), false);
    expect(out.status_kanban).toBe("v0:status_kanban"); // em conflito → não re-baseia
    expect(out.kanban_requisitos).toBe("fresh:kanban_requisitos"); // sem conflito, sem proteção → re-baseia
  });

  it("coluna ausente em rawFresh entra como null (não `undefined`, não mantém o anterior)", () => {
    const out = rebasearBaseRaw(COMPLETO, {}, new Set(), false);
    for (const k of COLUNAS_PAGINA) expect(out[k]).toBeNull();
  });

  it("não introduz nem remove chaves fora de COLUNAS_PAGINA", () => {
    const anterior = { ...COMPLETO, outra_coisa: "fica" };
    const out = rebasearBaseRaw(anterior, {}, new Set(), false);
    expect(out.outra_coisa).toBe("fica");
    expect(Object.keys(out).sort()).toEqual([...COLUNAS_PAGINA, "outra_coisa"].sort());
  });
});

describe("colunasDoErro — parsing do details do P0409 conflito_versao: config_loja", () => {
  it("parseia details 'a,b,c' com espaços e filtra pela lista branca", () => {
    const e = { code: "P0409", message: "conflito_versao: config_loja", details: "timezone, keywords ,ruido_desconhecido" };
    expect(colunasDoErro(e)).toEqual(["timezone", "keywords"]);
  });
  it("aceita 'detail' (minúsculo) e 'DETAIL' (maiúsculo) como aliases de details", () => {
    expect(colunasDoErro({ code: "P0409", message: "conflito_versao: config_loja", detail: "timezone" })).toEqual(["timezone"]);
    expect(colunasDoErro({ code: "P0409", message: "conflito_versao: config_loja", DETAIL: "keywords" })).toEqual(["keywords"]);
  });
  it("uma coluna só", () => {
    const e = { code: "P0409", message: "conflito_versao: config_loja", details: "status_kanban" };
    expect(colunasDoErro(e)).toEqual(["status_kanban"]);
  });
  it("code diferente de P0409 → vazio", () => {
    const e = { code: "P0001", message: "conflito_versao: config_loja", details: "timezone" };
    expect(colunasDoErro(e)).toEqual([]);
  });
  it("P0409 de outro domínio (ex.: keywords_mudou do integracao_salvar) → vazio", () => {
    const e = { code: "P0409", message: "keywords_mudou: outra pessoa mudou", details: "timezone" };
    expect(colunasDoErro(e)).toEqual([]);
  });
  it("sem details/detail → vazio", () => {
    const e = { code: "P0409", message: "conflito_versao: config_loja" };
    expect(colunasDoErro(e)).toEqual([]);
  });
  it("details vazio ou só espaços → vazio", () => {
    expect(colunasDoErro({ code: "P0409", message: "conflito_versao: config_loja", details: "" })).toEqual([]);
    expect(colunasDoErro({ code: "P0409", message: "conflito_versao: config_loja", details: "   " })).toEqual([]);
  });
  it("entrada nula/indefinida/não-objeto → vazio, sem lançar", () => {
    expect(colunasDoErro(null)).toEqual([]);
    expect(colunasDoErro(undefined)).toEqual([]);
    expect(colunasDoErro("erro qualquer")).toEqual([]);
    expect(colunasDoErro(42)).toEqual([]);
  });
});

describe("rotuloColuna — rótulos PT das 17 colunas + tab_labels/campos_editaveis", () => {
  it("cobre todas as 17 colunas da página com rótulo próprio (não cai no fallback = chave)", () => {
    for (const k of COLUNAS_PAGINA) {
      const r = rotuloColuna(k);
      expect(r).not.toBe(k);
      expect(r.length).toBeGreaterThan(0);
    }
  });
  it("rótulos batem com os textos/cards que a tela mostra hoje", () => {
    expect(rotuloColuna("timezone")).toBe("Fuso horário");
    expect(rotuloColuna("modo_oc_rolo")).toBe("Modo de OC/rolo");
    expect(rotuloColuna("modo_baixa_estoque")).toBe("Baixa de estoque");
    expect(rotuloColuna("explosao_envio_status")).toBe("Envio à Explosão");
    expect(rotuloColuna("ref_exibir_status")).toBe("Revelar REF");
    expect(rotuloColuna("markup_analise_faixa")).toBe("Análise de markup por faixa");
    expect(rotuloColuna("leadtime")).toBe("Leadtime");
    expect(rotuloColuna("pcp_etapas")).toBe("Etapas do PCP");
    expect(rotuloColuna("revenda_campos")).toBe("Fluxo de Revenda — campos");
    expect(rotuloColuna("ref_config")).toBe("Formato da REF");
    expect(rotuloColuna("keywords")).toBe("Keywords");
    expect(rotuloColuna("status_kanban")).toBe("Colunas do kanban");
    expect(rotuloColuna("kanban_requisitos")).toBe("Requisitos do kanban");
    expect(rotuloColuna("kanban_requisitos_excecoes")).toBe("Exceções dos requisitos");
    expect(rotuloColuna("revenda_kanban_colunas")).toBe("Fluxo de Revenda — colunas");
    expect(rotuloColuna("revenda_kanban_requisitos")).toBe("Fluxo de Revenda — requisitos");
    expect(rotuloColuna("insumos_padrao")).toBe("Insumos padrão");
  });
  it("tab_labels/campos_editaveis (fora da página, mas usados por mensagens de Nomenclaturas) também têm rótulo", () => {
    expect(rotuloColuna("tab_labels")).toBe("Nomes das abas");
    expect(rotuloColuna("campos_editaveis")).toBe("Campos editáveis");
  });
  it("chave desconhecida cai no fallback = a própria chave", () => {
    expect(rotuloColuna("coluna_inexistente")).toBe("coluna_inexistente");
  });
});

// T5 — janela Nomenclaturas: parser com lista própria + merge POR NOME.
import { colunasDoErro as colunasDoErroT5, COLUNAS_NOMENCLATURAS, limparNomes, mesclarNomes } from "@/lib/config-loja-colab";
describe("T5 — Nomenclaturas (puro)", () => {
  const erro = (details: string) => ({ code: "P0409", message: "conflito_versao: config_loja", details });
  it("colunasDoErro: default = colunas da PÁGINA (descarta tab_labels); com a lista da janela, aceita os 2 mapas", () => {
    expect(colunasDoErroT5(erro("tab_labels,timezone"))).toEqual(["timezone"]);
    expect(colunasDoErroT5(erro("campos_editaveis,tab_labels,timezone"), COLUNAS_NOMENCLATURAS)).toEqual(["campos_editaveis", "tab_labels"]);
  });
  it("limparNomes: em branco/só espaços = nome padrão (sai); apara as pontas", () => {
    expect(limparNomes({ a: " X ", b: "", c: "   ", d: 5 as any })).toEqual({ a: "X" });
    expect(limparNomes(null)).toEqual({});
  });
  it("mesclarNomes: nome não tocado adota o servidor; tocado fica meu; mesmo nome mudado dos 2 lados = conflito", () => {
    const base = { a: "A", b: "B", c: "C" };
    const meu = { a: "A meu", b: "B", c: "C", d: "D meu" };
    const fresh = { a: "A dele", b: "B dele", e: "E dele" }; // c apagado pelo outro
    const r = mesclarNomes(base, meu, fresh, "nom:tab:");
    expect(r.valor).toEqual({ a: "A meu", b: "B dele", d: "D meu", e: "E dele" });
    expect(r.conflitos).toEqual([{ path: "nom:tab:a", meu: "A meu", dele: "A dele" }]);
    expect(r.atualizados.sort()).toEqual(["b", "c", "e"]);
  });
  it("mesclarNomes: convergido (os dois puseram o mesmo nome) não é conflito; vazio ≡ ausente", () => {
    const r = mesclarNomes({ a: "A" }, { a: "Novo", z: "" }, { a: "Novo" }, "nom:campo:");
    expect(r.conflitos).toEqual([]);
    expect(r.valor).toEqual({ a: "Novo" });
  });
});

describe("Revisão T3/T4 (I2) — só espaço nas pontas não é mudança", () => {
  it("montarMudancas: keywords 'Moda ' vs base 'Moda' → nada a salvar; '' vs null idem", () => {
    const b = { keywords: "Moda" } as any;
    const kb = pickKanban({});
    expect(montarMudancas({ cfg: { keywords: "Moda " } as any, baseUi: b, baseRaw: b, kanbanBaseCfg: kb }).mudancas).toEqual({});
    expect(montarMudancas({ cfg: { explosao_envio_status: "" } as any, baseUi: { explosao_envio_status: null } as any, baseRaw: {}, kanbanBaseCfg: kb }).mudancas).toEqual({});
    expect(montarMudancas({ cfg: { keywords: " Novo " } as any, baseUi: b, baseRaw: b, kanbanBaseCfg: kb }).mudancas).toEqual({ keywords: "Novo" });
  });
});
