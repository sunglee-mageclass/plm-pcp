import { describe, it, expect } from "vitest";
import { lerEtapasPlConfig, type DestinoDropPl } from "@/lib/etapas-pl-config";
import {
  RPC_ETAPAS_PL, dropBloqueadoPl, etapaDoProduto, etapaPlFiltroOpts, modoColunaPl, motorEtapasPlDisponivel,
  notaMoverPlPara, subtituloColunaPl, textoFaixaDropPl, toastDoMoverPl, ETAPA_PL_FILTRO_LANCADO,
} from "@/lib/etapas-pl-ui";

const ROW = {
  etapas_pl_automatico: true,
  etapas_pl_kanban: ["Em Modelagem", "Em Pilotagem", "Stand By", "Aprovado"],
  etapas_pl_requisitos: { em_pilotagem: ["tem_peca_teste"], aprovado: ["peca_teste_aprovada", "cq_liberado"] },
};
const cfg = lerEtapasPlConfig(ROW);
const d = (acao: DestinoDropPl["acao"], status: string | null = null, faltando: string[] = []): DestinoDropPl => ({ acao, status, faltando });

describe("RPC_ETAPAS_PL", () => {
  it("nomes das 4 RPCs", () => {
    expect(RPC_ETAPAS_PL).toEqual({
      mover: "etapas_pl_mover", definir: "etapas_pl_definir_automatico",
      previaRestauracao: "etapas_pl_previa_restauracao", restaurar: "etapas_pl_restaurar",
    });
  });
});

describe("modoColunaPl / subtituloColunaPl", () => {
  it("com requisito = automatica; sem requisito = manual", () => {
    expect(modoColunaPl(cfg, "em_pilotagem")).toBe("automatica");
    expect(modoColunaPl(cfg, "stand_by")).toBe("manual");
  });
  it("reprovado é sempre manual, mesmo com requisito", () => {
    const c = lerEtapasPlConfig({ ...ROW, etapas_pl_requisitos: { reprovado: ["tem_peca_teste"] } });
    expect(modoColunaPl(c, "reprovado")).toBe("manual");
  });
  it("subtítulo: automática lista labels; manual explica", () => {
    expect(subtituloColunaPl(cfg, "aprovado")).toBe("Entra com: Peça teste aprovada, CQ liberado");
    expect(subtituloColunaPl(cfg, "stand_by")).toMatch(/^Manual/);
  });
});

describe("dropBloqueadoPl / textoFaixaDropPl / notaMoverPlPara", () => {
  it("bloqueado só para bloquear_*", () => {
    expect(dropBloqueadoPl(d("bloquear_faltando"))).toBe(true);
    expect(dropBloqueadoPl(d("bloquear_ja_cumprida"))).toBe(true);
    for (const a of ["fixar", "soltar", "nada", "fora_do_fluxo"] as const) expect(dropBloqueadoPl(d(a))).toBe(false);
  });
  it("faixa: faltando usa labels do catálogo PL; já cumpre manda p/ coluna manual", () => {
    expect(textoFaixaDropPl(d("bloquear_faltando", null, ["tem_peca_teste", "cq_liberado"]))).toBe("Faltam: Tem peça teste, CQ liberado");
    expect(textoFaixaDropPl(d("bloquear_faltando", null, ["x_desconhecida"]))).toBe("Faltam: x_desconhecida");
    expect(textoFaixaDropPl(d("bloquear_ja_cumprida"))).toMatch(/já cumpre; use coluna manual/);
    expect(textoFaixaDropPl(d("nada"))).toBe("");
  });
  it("nota do 'Mover para…'", () => {
    expect(notaMoverPlPara(d("fixar"))).toBe("fixa aqui");
    expect(notaMoverPlPara(d("bloquear_faltando", null, ["a", "b"]))).toBe("faltam 2 dados");
    expect(notaMoverPlPara(d("bloquear_faltando", null, ["a"]))).toBe("falta 1 dado");
    expect(notaMoverPlPara(d("bloquear_ja_cumprida"))).toBe("já cumpre");
    expect(notaMoverPlPara(d("nada"))).toBe("");
  });
});

describe("toastDoMoverPl (6 ações)", () => {
  const r = (acao: string, status: string | null = null, faltando: string[] = []) => ({ acao, status, faltando, rev: 1 });
  it("fixar = ok", () => {
    const t = toastDoMoverPl(r("fixar", "stand_by"), "stand_by", cfg);
    expect(t.tipo).toBe("ok");
    expect(t.titulo).toMatch(/Fixado em "Stand By"/);
  });
  it("soltar = ok com a coluna de destino", () => {
    const t = toastDoMoverPl(r("soltar", "em_pilotagem"), "em_modelagem", cfg);
    expect(t.tipo).toBe("ok");
    expect(t.titulo).toMatch(/Em Pilotagem/);
  });
  it("nada = info", () => expect(toastDoMoverPl(r("nada", "em_modelagem"), "em_modelagem", cfg).tipo).toBe("info"));
  it("bloquear_faltando = erro com faltas", () => {
    const t = toastDoMoverPl(r("bloquear_faltando", null, ["cq_liberado"]), "aprovado", cfg);
    expect(t.tipo).toBe("erro");
    expect(t.titulo).toMatch(/CQ liberado/);
  });
  it("bloquear_ja_cumprida = info", () => {
    const t = toastDoMoverPl(r("bloquear_ja_cumprida"), "em_pilotagem", cfg);
    expect(t.tipo).toBe("info");
    expect(t.titulo).toMatch(/já cumpre/);
  });
  it("fora_do_fluxo = erro", () => expect(toastDoMoverPl(r("fora_do_fluxo"), "x", cfg).tipo).toBe("erro"));
  it("ação desconhecida não quebra", () => expect(toastDoMoverPl(r("zzz"), "x", cfg).tipo).toBe("info"));
  it("sem cfg usa a key crua", () => expect(toastDoMoverPl(r("fixar", "stand_by"), "stand_by").titulo).toMatch(/stand_by/));
});

describe("etapaDoProduto", () => {
  it("chave desligada = off, na coluna do produto", () => {
    const s = etapaDoProduto(cfg, "em_pilotagem", {}, false);
    expect(s).toMatchObject({ key: "em_pilotagem", label: "Em Pilotagem", modo: "off" });
    expect(s.color).toBeTruthy();
  });
  it("ligada + coluna automática = automatica", () => {
    expect(etapaDoProduto(cfg, "em_pilotagem", { tem_peca_teste: true }, true).modo).toBe("automatica");
  });
  it("ligada + 1ª coluna = automatica (mesmo sendo sem requisito)", () => {
    expect(etapaDoProduto(cfg, "em_modelagem", {}, true).modo).toBe("automatica");
  });
  it("ligada + coluna manual ≠ 1ª = fixado", () => {
    expect(etapaDoProduto(cfg, "stand_by", {}, true)).toMatchObject({ key: "stand_by", modo: "fixado" });
  });
  it("status órfão cai na 1ª coluna", () => {
    expect(etapaDoProduto(cfg, "coluna_removida", {}, true)).toMatchObject({ key: "em_modelagem", modo: "automatica" });
  });
  it("lançado = Finalizado (id do filtro), off", () => {
    expect(etapaDoProduto(cfg, "aprovado", { lancado: true }, true)).toMatchObject({ key: ETAPA_PL_FILTRO_LANCADO, label: "Finalizado", modo: "off" });
  });
  it("fora do PL (status nulo) = off, sem coluna", () => {
    expect(etapaDoProduto(cfg, null, {}, true).modo).toBe("off");
  });
});

describe("etapaPlFiltroOpts", () => {
  it("colunas na ordem + Finalizado no fim", () => {
    expect(etapaPlFiltroOpts(cfg)).toEqual([
      { id: "em_modelagem", label: "Em Modelagem" },
      { id: "em_pilotagem", label: "Em Pilotagem" },
      { id: "stand_by", label: "Stand By" },
      { id: "aprovado", label: "Aprovado" },
      { id: ETAPA_PL_FILTRO_LANCADO, label: "Finalizado" },
    ]);
  });
  it("board vazio = só Finalizado", () => {
    expect(etapaPlFiltroOpts(lerEtapasPlConfig({}))).toEqual([{ id: ETAPA_PL_FILTRO_LANCADO, label: "Finalizado" }]);
  });
});

describe("motorEtapasPlDisponivel", () => {
  it("board vazio / não-array = false (inércia, não cai no board do Dev)", () => {
    expect(motorEtapasPlDisponivel(lerEtapasPlConfig({}))).toBe(false);
    expect(motorEtapasPlDisponivel(lerEtapasPlConfig({ etapas_pl_kanban: [] }))).toBe(false);
    expect(motorEtapasPlDisponivel(lerEtapasPlConfig({ etapas_pl_kanban: "x" }))).toBe(false);
  });
  it("board com colunas = true", () => expect(motorEtapasPlDisponivel(cfg)).toBe(true));
});
