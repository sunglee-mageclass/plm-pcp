import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  mensagemErro,
  TEXTO_REF_ETAPA_COM_KANBAN,
  TEXTO_REPROVADO_EXPLOSAO,
} from "@/lib/erro-mensagem";
import { KANBAN_COLS } from "@/lib/kanban-auto-config";
import { statusParaGate, type KanbanAutoConfig } from "@/lib/kanban-auto";
import { gateEnvioExplosao } from "@/components/planejamento/planejamento-detail/ficha/envio-explosao";
import {
  montarRef,
  problemaFormatoRef,
  siglaConfiguradaItem,
  siglaFamilia,
  siglaItemSemDigitos,
  TEXTO_REF_FORMATO_SEM_NUMERO,
  textoRefSiglaComDigito,
  type RefConfig,
  type RefTaxonomia,
} from "@/lib/ref-montar";
import {
  etapaRefComKanban,
  etapaRefMudouDesdeAPrevia,
  etapaRefNoSalvar,
  MENSAGEM_PREVIA_REF_AUSENTE,
  MENSAGEM_PREVIA_REF_MUDOU,
  motivoPreviaRef,
  tituloRefsReveladas,
  toastRefsReveladas,
} from "@/lib/ref-revelar";

// Leves L3 (Kanban, REF e SKU) — lado do site. O lado do banco e o anti-drift SQL × TS: tests/integration/leves-l3.test.ts.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");

describe("L3 — mensagens do banco (ASCII com prefixo) → PT", () => {
  it("reprovado na Explosão", () => {
    expect(
      mensagemErro({
        code: "P0001",
        message: "reprovado_explosao: Card reprovado nao vai a Explosao",
      }),
    ).toBe(TEXTO_REPROVADO_EXPLOSAO);
    expect(TEXTO_REPROVADO_EXPLOSAO).toBe("Card reprovado não vai à Explosão.");
  });
  it("Formato da REF sem número / sigla com dígito", () => {
    expect(
      mensagemErro({
        code: "P0001",
        message: "ref_formato_sem_numero: o formato da REF precisa da parte numero",
      }),
    ).toBe(TEXTO_REF_FORMATO_SEM_NUMERO);
    expect(mensagemErro({ code: "P0001", message: "ref_sigla_com_digito: AB1" })).toBe(
      textoRefSiglaComDigito("AB1"),
    );
  });
  it("outros P0001 seguem passando direto (não engole mensagem PT de sempre)", () => {
    expect(
      mensagemErro({
        code: "P0001",
        message:
          'O modelo precisa estar na etapa "Aprovado" (ou posterior) para ser enviado à Explosão.',
      }),
    ).toMatch(/^O modelo precisa estar na etapa/);
  });
});

describe("L3 kanban #18 — Formato da REF: número obrigatório e sigla de item só letras", () => {
  const tax: RefTaxonomia = {
    grupoId: "g",
    grupoNome: "Vestuário",
    categoriaId: "c",
    categoriaNome: "Blusa",
    sub1Id: "s1",
    sub1Nome: "Manga Curta",
    sub2Id: null,
    sub2Nome: null,
  };
  it("problemaFormatoRef: partes sem 'numero' (inclusive []) é problema; sem partes / null é ok", () => {
    expect(problemaFormatoRef(null)).toBeNull();
    expect(problemaFormatoRef({})).toBeNull();
    expect(problemaFormatoRef({ num_digitos: 6 })).toBeNull();
    expect(problemaFormatoRef({ partes: ["grupo", "numero"] })).toBeNull();
    expect(problemaFormatoRef({ partes: [] })).toBe(TEXTO_REF_FORMATO_SEM_NUMERO);
    expect(problemaFormatoRef({ partes: ["grupo", "categoria"] })).toBe(
      TEXTO_REF_FORMATO_SEM_NUMERO,
    );
  });
  it("problemaFormatoRef: sigla de taxonomia com dígito é problema (a 1ª pela ordem da chave, como o SQL)", () => {
    const cfg: RefConfig = {
      partes: ["grupo", "numero"],
      sigla_taxonomia: { b: "X2", a: "Y1", c: "OK" },
    };
    expect(problemaFormatoRef(cfg)).toBe(textoRefSiglaComDigito("Y1"));
  });
  it("siglas de ITEM e de FAMÍLIA descartam dígito (≡ _ref_sigla_cfg_item/_ref_sigla_familia [^A-Za-z]; fix round 1, B6)", () => {
    const cfg: RefConfig = {
      partes: ["familia", "grupo", "numero"],
      sigla_familia: { interno: "P2" },
      sigla_taxonomia: { g: "VE1" },
    };
    expect(siglaConfiguradaItem(cfg, "g")).toBe("VE");
    expect(siglaFamilia(cfg, "interno")).toBe("P");
    expect(montarRef({ cfg, familia: "interno", tax, numero: 42, acessorio: false })).toBe(
      "PVE00000042",
    );
  });
  it("siglaItemSemDigitos (o que a pessoa digita no FormatoRefCard)", () => {
    expect(siglaItemSemDigitos("A1b2")).toBe("Ab");
    expect(siglaItemSemDigitos("123")).toBe("");
  });
  it("FormatoRefCard: número travado + marcar a 1ª parte traz o número + dígitos descartados na sigla (fonte)", () => {
    const src = ler("src/components/configuracoes/FormatoRefCard.tsx");
    expect(src).toContain('if (parte === "numero" && !on) return;');
    expect(src).toContain('if (on && !next.includes("numero")) next = [...next, "numero"];');
    expect(src).toContain('disabled={key === "numero" && on}');
    expect(src).toContain("const v = siglaItemSemDigitos(bruto);");
    expect(src).toContain("problemaFormatoRef(value)");
  });
});

describe("L3 kanban #21 (P-211 A) — prévia da REF no Salvar da Config", () => {
  it("etapaRefNoSalvar: só quando a coluna vai no Salvar ('' já virou null)", () => {
    expect(etapaRefNoSalvar({ keywords: "x" })).toBeNull();
    expect(etapaRefNoSalvar({ ref_exibir_status: "etapa_a" })).toEqual({ valor: "etapa_a" });
    expect(etapaRefNoSalvar({ ref_exibir_status: null })).toEqual({ valor: null });
  });
  it("etapaRefMudouDesdeAPrevia: aborta se a etapa que vai ≠ a conferida (ou não conferida)", () => {
    expect(etapaRefMudouDesdeAPrevia(undefined, null)).toBe(false);
    expect(etapaRefMudouDesdeAPrevia(undefined, { valor: "a" })).toBe(true);
    expect(etapaRefMudouDesdeAPrevia({ valor: "a" }, { valor: "a" })).toBe(false);
    expect(etapaRefMudouDesdeAPrevia({ valor: "a" }, { valor: "b" })).toBe(true);
    expect(etapaRefMudouDesdeAPrevia({ valor: null }, { valor: null })).toBe(false);
    expect(MENSAGEM_PREVIA_REF_MUDOU).toMatch(/Nada foi gravado/);
  });
  it("textos", () => {
    expect(tituloRefsReveladas(1)).toBe("1 REF será revelada");
    expect(tituloRefsReveladas(3)).toBe("3 REFs serão reveladas");
    expect(toastRefsReveladas(0)).toBeNull();
    expect(toastRefsReveladas(2)).toBe("Configurações salvas — 2 REFs reveladas.");
  });
  it("Config da Loja: prévia antes de confirmar, conferência no mutationFn e diálogo (fonte)", () => {
    const src = ler("src/routes/_authenticated/admin/configuracoes.tsx");
    expect(src).toContain("const p = await refPreviaRevelar(data.tenantId, etapaRef.valor);");
    expect(src).toContain("if (p.total > 0) { setPreviaRef(p); return; }");
    expect(src).toContain(
      "const motivoRef = motivoPreviaRef(refEtapaConferidaRef.current, etapaRefNoSalvar(mudancas));",
    );
    expect(src).toContain("<RefRevelarDialog");
    expect(src).toContain("void continuarSalvar(true);");
  });
});

describe("L3 kanban #3 (P-210 A) — exceções de requisito OCULTAS (código guardado)", () => {
  it("configuracoes.tsx não passa o editor (onExcecoesChange) quando oculto; o diálogo trava o herdado sem editor", () => {
    const src = ler("src/routes/_authenticated/admin/configuracoes.tsx");
    expect(src).toContain("const EXCECOES_REQUISITO_OCULTAS = true;");
    expect(src).toContain("onExcecoesChange={EXCECOES_REQUISITO_OCULTAS ? undefined : (next) =>");
    const dlg = ler("src/components/admin/RequisitosStatusDialog.tsx");
    expect(dlg).toContain("const herdadoTravado = ehHerdado && !onExcecoesChange;");
    expect(dlg).toContain("disabled={na || herdadoTravado}");
  });
});

describe("L3 fix round 1 — site", () => {
  it("B6: problemaFormatoRef recusa sigla de FAMÍLIA com dígito (depois da taxonomia, como o SQL)", () => {
    expect(
      problemaFormatoRef({ partes: ["familia", "numero"], sigla_familia: { interno: "P2" } }),
    ).toBe(textoRefSiglaComDigito("P2"));
    expect(
      problemaFormatoRef({
        partes: ["numero"],
        sigla_taxonomia: { a: "X1" },
        sigla_familia: { interno: "P2" },
      }),
    ).toBe(textoRefSiglaComDigito("X1"));
  });
  it("M2: etapa da REF + coluna do kanban no mesmo Salvar = recusa; mensagem do servidor traduzida", () => {
    expect(etapaRefComKanban({ ref_exibir_status: "a", status_kanban: [] }, KANBAN_COLS)).toBe(
      true,
    );
    expect(
      etapaRefComKanban({ ref_exibir_status: "a", kanban_requisitos_excecoes: {} }, KANBAN_COLS),
    ).toBe(true);
    expect(etapaRefComKanban({ ref_exibir_status: "a", keywords: "x" }, KANBAN_COLS)).toBe(false);
    expect(etapaRefComKanban({ status_kanban: [] }, KANBAN_COLS)).toBe(false);
    expect(
      mensagemErro({
        code: "P0001",
        message: "ref_etapa_com_kanban: salve a etapa da REF e o kanban em dois passos",
      }),
    ).toBe(TEXTO_REF_ETAPA_COM_KANBAN);
    expect(TEXTO_REF_ETAPA_COM_KANBAN).toMatch(/dois passos/);
  });
  it("B8: sem prévia × prévia de outra etapa dão textos diferentes", () => {
    expect(motivoPreviaRef(undefined, null)).toBeNull();
    expect(motivoPreviaRef({ valor: "a" }, { valor: "a" })).toBeNull();
    expect(motivoPreviaRef(undefined, { valor: "a" })).toBe(MENSAGEM_PREVIA_REF_AUSENTE);
    expect(motivoPreviaRef({ valor: "a" }, { valor: "b" })).toBe(MENSAGEM_PREVIA_REF_MUDOU);
  });
  it("A1: reprovado no Planejamento ⇒ sem posição em qualquer chave; gate da Explosão diz 'reprovado'", () => {
    expect(statusParaGate(false, null, "aprovado", "reprovado")).toBeNull();
    expect(statusParaGate(true, null, "aprovado", " Reprovado ")).toBeNull();
    expect(statusParaGate(false, null, "aprovado", "planejado")).toBe("aprovado");
    const cfg: KanbanAutoConfig = {
      kanban_automatico: false,
      status_kanban: [
        { key: "entrada", label: "Entrada" },
        { key: "aprovado", label: "Aprovado" },
      ],
      kanban_requisitos: {},
      kanban_requisitos_excecoes: {},
      revenda_kanban_colunas: [],
      revenda_kanban_requisitos: {},
    };
    const g = gateEnvioExplosao({
      cfg,
      explosaoEnvioStatus: null,
      statusCru: "aprovado",
      derivacao: null,
      condProntas: true,
      statusPlanejamento: "reprovado",
    });
    expect([g.ok, g.reprovado, g.motivo]).toEqual([false, true, TEXTO_REPROVADO_EXPLOSAO]);
    const g2 = gateEnvioExplosao({
      cfg,
      explosaoEnvioStatus: null,
      statusCru: "aprovado",
      derivacao: null,
      condProntas: true,
    });
    expect(g2.ok).toBe(true);
  });
  it("useFichaKanban passa o status_planejamento ao gate da REF; RequisitosStatusDialog não diz 'valem aqui' com exceção gravada", () => {
    const src = ler("src/components/planejamento/planejamento-detail/ficha/useFichaKanban.ts");
    expect(src).toContain(
      "refVisivelFicha({ cfg: kanbanCfg, refExibirStatus, statusEfetivo: statusCru, derivacao, statusPlanejamento })",
    );
    const dlg = ler("src/components/admin/RequisitosStatusDialog.tsx");
    expect(dlg).toContain("Os marcados como “exceção” (configurada antes) não são exigidos aqui");
    const cfgSrc = ler("src/routes/_authenticated/admin/configuracoes.tsx");
    expect(cfgSrc).toContain(
      "if (etapaRefComKanban(mudancas, KANBAN_COLS)) { toast.error(TEXTO_REF_ETAPA_COM_KANBAN); return; }",
    );
  });
});
