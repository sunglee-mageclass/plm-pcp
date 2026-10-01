import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mensagemErro, TEXTO_REPROVADO_EXPLOSAO } from "@/lib/erro-mensagem";
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
  etapaRefMudouDesdeAPrevia,
  etapaRefNoSalvar,
  MENSAGEM_PREVIA_REF_MUDOU,
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
  it("sigla de ITEM descarta dígito (≡ _ref_sigla_cfg_item [^A-Za-z]); sigla de FAMÍLIA mantém (≡ _ref_sigla_familia)", () => {
    const cfg: RefConfig = {
      partes: ["familia", "grupo", "numero"],
      sigla_familia: { interno: "P2" },
      sigla_taxonomia: { g: "VE1" },
    };
    expect(siglaConfiguradaItem(cfg, "g")).toBe("VE");
    expect(siglaFamilia(cfg, "interno")).toBe("P2");
    expect(montarRef({ cfg, familia: "interno", tax, numero: 42, acessorio: false })).toBe(
      "P2VE00000042",
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
      "if (etapaRefMudouDesdeAPrevia(refEtapaConferidaRef.current, etapaRefNoSalvar(mudancas))) {",
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
