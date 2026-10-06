// R9 T5 — Cadastro › Atributos › Categoria do Serviço: switch "Exige peça teste" (`AttributeTabConfig.extraToggles`) + permissão de
// seção `criacao_planejamento:peca_teste` no catálogo/editor + tipos do banco + texto de reprovar.
//  (a) lógica PURA dos switches extras (`@/lib/attribute-extra-toggles`) — o "Novo" manda false por padrão e true ligado; edição
//      inline e Sheet mobile mandam o valor; selo "Exige"/"Não exige" (render estático);
//  (b) fontes: o AttributeTab liga as 3 superfícies (tabela, Sheet, Dialog Novo) ao mesmo helper e `colCount` soma;
//  (c) catálogo de permissões (`ALL_PAGE_KEYS`, módulos, `hint` no editor);
//  (d) tipos (`types.ts`) e `textoReprovarTentativa`.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  algumToggleLigado,
  payloadExtraToggles,
  rotulosTogglesLigados,
  textoDoToggle,
  togglesDaLinha,
  togglesMudaram,
  togglesPadrao,
  type ExtraToggle,
} from "@/lib/attribute-extra-toggles";
import { ExtraToggleCell, ExtraToggleField } from "@/components/attribute-extra-toggle";
import { ALL_PAGE_KEYS, PAGES_CATALOG, modulosExigidosDaPagina, paginaComModuloDesligado } from "@/lib/permissions-catalog";
import { rotuloPaginaPermissao } from "@/lib/erro-mensagem";
import { textoReprovarTentativa } from "@/lib/confirmacoes-textos";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");

const PT: ExtraToggle = {
  field: "exige_peca_teste",
  label: "Exige peça teste",
  hint: "Ligado: todo produto com este serviço na mão de obra precisa de peça teste aprovada (seção Peça Teste do card). Desligar não apaga tentativas já lançadas.",
  textoLigado: "Exige",
  textoDesligado: "Não exige",
};
const OUTRO: ExtraToggle = { field: "outro_flag", label: "Outro", textoLigado: "Sim", textoDesligado: "Não" };

describe("extraToggles — payload do Novo / edição inline / Sheet mobile", () => {
  it('o "Novo" manda exige_peca_teste:false por padrão e true ligado', () => {
    const padrao = togglesPadrao([PT]);
    expect(padrao).toEqual({ exige_peca_teste: false });
    expect(payloadExtraToggles([PT], padrao)).toEqual({ exige_peca_teste: false });
    expect(payloadExtraToggles([PT], { ...padrao, exige_peca_teste: true })).toEqual({ exige_peca_teste: true });
    // estado vazio/desconhecido também vira false (nunca omite a chave, nunca manda undefined)
    expect(payloadExtraToggles([PT], {})).toEqual({ exige_peca_teste: false });
  });

  it("a edição inline e o Sheet mobile partem do valor gravado e mandam o valor (coluna ausente/nula = desligado)", () => {
    expect(togglesDaLinha([PT], { id: "1", exige_peca_teste: true })).toEqual({ exige_peca_teste: true });
    expect(togglesDaLinha([PT], { id: "1", exige_peca_teste: false })).toEqual({ exige_peca_teste: false });
    expect(togglesDaLinha([PT], { id: "1" })).toEqual({ exige_peca_teste: false });
    expect(togglesDaLinha([PT], { id: "1", exige_peca_teste: null })).toEqual({ exige_peca_teste: false });
    const linha = { id: "1", exige_peca_teste: false };
    const ligado = { ...togglesDaLinha([PT], linha), exige_peca_teste: true };
    expect(payloadExtraToggles([PT], ligado)).toEqual({ exige_peca_teste: true });
  });

  it("selo 'não salvo' do Sheet: só muda quando difere do gravado; o Novo só fica sujo se alguém ligou", () => {
    const linha = { exige_peca_teste: false };
    expect(togglesMudaram([PT], { exige_peca_teste: false }, linha)).toBe(false);
    expect(togglesMudaram([PT], { exige_peca_teste: true }, linha)).toBe(true);
    expect(togglesMudaram([PT], { exige_peca_teste: false }, { exige_peca_teste: true })).toBe(true);
    expect(togglesMudaram([PT], { exige_peca_teste: false }, {})).toBe(false); // ausente = desligado
    expect(algumToggleLigado([PT], togglesPadrao([PT]))).toBe(false);
    expect(algumToggleLigado([PT], { exige_peca_teste: true })).toBe(true);
  });

  it("sem extraToggles tudo é neutro (as outras abas do Cadastro não mudam)", () => {
    expect(togglesPadrao(undefined)).toEqual({});
    expect(payloadExtraToggles(undefined, { x: true })).toEqual({});
    expect(togglesMudaram(undefined, {}, { x: true })).toBe(false);
    expect(algumToggleLigado(undefined, {})).toBe(false);
    expect(rotulosTogglesLigados(undefined, { x: true })).toEqual([]);
  });

  it("vários switches convivem (um payload com todos os campos)", () => {
    const e = { exige_peca_teste: true, outro_flag: false };
    expect(payloadExtraToggles([PT, OUTRO], e)).toEqual({ exige_peca_teste: true, outro_flag: false });
    expect(rotulosTogglesLigados([PT, OUTRO], { exige_peca_teste: true, outro_flag: false })).toEqual(["Exige peça teste"]);
  });
});

describe("extraToggles — render (Badge na leitura, Switch na edição, campo do Novo/Sheet)", () => {
  it('leitura: selo "Exige" (ligado) e "Não exige" (desligado)', () => {
    const on = renderToStaticMarkup(createElement(ExtraToggleCell, { toggle: PT, valor: true, editando: false }));
    const off = renderToStaticMarkup(createElement(ExtraToggleCell, { toggle: PT, valor: false, editando: false }));
    expect(on).toContain("Exige");
    expect(on).not.toContain("Não exige");
    expect(off).toContain("Não exige");
    expect(textoDoToggle(PT, true)).toBe("Exige");
    expect(textoDoToggle(PT, false)).toBe("Não exige");
    // é o StatusBadge do sistema (tom por token), não um Badge solto com cor à mão
    expect(on).toContain("--tone-info-bg");
    expect(off).toContain("--tone-neutral-bg");
  });

  it("edição inline: Switch com o rótulo acessível e o texto ao lado", () => {
    const html = renderToStaticMarkup(createElement(ExtraToggleCell, { toggle: PT, valor: true, editando: true, onChange: () => {} }));
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="Exige peça teste"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Exige");
    const desligado = renderToStaticMarkup(createElement(ExtraToggleCell, { toggle: PT, valor: false, editando: true, onChange: () => {} }));
    expect(desligado).toContain('aria-checked="false"');
    expect(desligado).toContain("Não exige");
  });

  it("Novo/Sheet: Switch + rótulo + 'i' com a dica (nunca texto fixo embaixo do campo)", () => {
    const html = renderToStaticMarkup(createElement(ExtraToggleField, { toggle: PT, valor: false, onChange: () => {}, idPrefix: "novo" }));
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("Exige peça teste");
    expect(html).toContain('aria-label="O que é &quot;Exige peça teste&quot;"');
    // a dica só aparece no hover do InfoHover (não fica no markup estático)
    expect(html).not.toContain("tentativas já lançadas");
  });
});

describe("AttributeTab / Cadastro — fiação nas 3 superfícies", () => {
  const TAB = ler("src/components/attribute-tab.tsx");
  const ATRIB = ler("src/routes/_authenticated/cadastro.atributos.tsx");

  it("config: cat_terceirizado liga exige_peca_teste com a dica aprovada e os selos Exige/Não exige", () => {
    const i = ATRIB.indexOf('value: "cat_terceirizado"');
    const bloco = ATRIB.slice(i, ATRIB.indexOf('value: "grade_tamanhos"'));
    expect(bloco).toContain("extraToggles: [");
    expect(bloco).toContain('field: "exige_peca_teste"');
    expect(bloco).toContain('label: "Exige peça teste"');
    expect(bloco).toContain(
      'hint: "Ligado: todo produto com este serviço na mão de obra precisa de peça teste aprovada (seção Peça Teste do card). Desligar não apaga tentativas já lançadas."',
    );
    expect(bloco).toContain('textoLigado: "Exige"');
    expect(bloco).toContain('textoDesligado: "Não exige"');
    // nenhuma OUTRA aba ganhou o switch
    expect(ATRIB.split("extraToggles: [").length - 1).toBe(1);
    // texto explicativo da aba (mockup, aba 3)
    expect(ATRIB).toContain("Ligar “Exige peça teste” faz o serviço ganhar uma trilha na seção Peça Teste de todo card cuja mão de obra o tenha.");
  });

  it("colCount soma os switches; o Novo, a edição inline e o Sheet mandam o payload do helper", () => {
    expect(TAB).toContain("(config.extraToggles?.length ?? 0)");
    expect(TAB).toContain("Object.assign(payload, payloadExtraToggles(config.extraToggles, newToggles))");
    expect(TAB).toContain("Object.assign(payload, payloadExtraToggles(config.extraToggles, editToggles))");
    expect(TAB).toContain("Object.assign(payload, payloadExtraToggles(config.extraToggles, sheetToggles))");
    // estado inicial do Novo = desligado; a linha em edição/Sheet partem do valor gravado; Novo limpo depois de criar
    expect(TAB).toContain("useState<ExtraTogglesEstado>(() => togglesPadrao(config.extraToggles))");
    expect(TAB).toContain("setEditToggles(togglesDaLinha(config.extraToggles, row))");
    expect(TAB).toContain("setSheetToggles(togglesDaLinha(config.extraToggles, row))");
    expect(TAB).toContain("setNewToggles(togglesPadrao(config.extraToggles))");
    // guardas de "não salvo": Sheet e Novo
    expect(TAB).toContain("togglesMudaram(config.extraToggles, sheetToggles, sheetRow)");
    expect(TAB).toContain("algumToggleLigado(config.extraToggles, newToggles)");
  });

  it("as 3 superfícies renderizam os componentes compartilhados (coluna + Sheet + Novo)", () => {
    expect(TAB).toContain("<ExtraToggleCell");
    expect(TAB.split("<ExtraToggleField").length - 1).toBe(2); // Dialog Novo + Sheet mobile
    expect(TAB).toContain('idPrefix="novo"');
    expect(TAB).toContain('idPrefix="sheet"');
    // cabeçalho da coluna com o "i" da dica
    expect(TAB).toContain("config.extraToggles?.map((t) => (");
    expect(TAB).toContain("<InfoHover");
  });
});

describe("permissão da seção criacao_planejamento:peca_teste", () => {
  const CHAVE = "criacao_planejamento:peca_teste";
  const HINT = "Leitor vê a seção no card; Editor lança tentativas, datas e aprovação. Sem Leitor, a seção some do card.";

  it("a chave está em ALL_PAGE_KEYS, sob Planejamento de Produto, com rótulo e dica", () => {
    expect(ALL_PAGE_KEYS).toContain(CHAVE);
    const plan = PAGES_CATALOG.flatMap((m) => m.pages).find((p) => p.key === "criacao_planejamento")!;
    const sec = plan.sections!.find((s) => s.key === CHAVE);
    expect(sec).toEqual({ key: CHAVE, label: "Peça Teste", hint: HINT });
    // as 2 seções antigas seguem iguais (sem hint) e a nova entra por último
    expect(plan.sections!.map((s) => s.key)).toEqual([
      "criacao_planejamento:custos",
      "criacao_planejamento:preco_venda",
      CHAVE,
    ]);
    expect(new Set(ALL_PAGE_KEYS).size).toBe(ALL_PAGE_KEYS.length);
  });

  it('módulos exigidos da seção = ["criacao"] (como a página-mãe) e módulo desligado esmaece', () => {
    expect(modulosExigidosDaPagina(CHAVE)).toEqual(["criacao"]);
    expect(modulosExigidosDaPagina(CHAVE)).toEqual(modulosExigidosDaPagina("criacao_planejamento"));
    expect(paginaComModuloDesligado(CHAVE, { criacao: false })).toBe(true);
    expect(paginaComModuloDesligado(CHAVE, { criacao: true })).toBe(false);
  });

  it('o rótulo da chave (usado pelo tradutor do servidor) é "<módulo da Criação> › Planejamento de Produto › Peça Teste"', () => {
    const moduloCriacao = PAGES_CATALOG.find((m) => m.module === "criacao")!.label;
    expect(rotuloPaginaPermissao(CHAVE)).toEqual({ modulo: moduloCriacao, pagina: "Planejamento de Produto › Peça Teste" });
  });

  it("os 2 editores (usuário e papel) mostram a dica em texto muted sob a seção", () => {
    const MODAL = ler("src/components/admin/PermissoesModal.tsx");
    expect(MODAL.split("{s.hint && <span").length - 1).toBe(2);
    expect(ler("src/lib/permissions-catalog.ts")).toContain("export type SectionDef = { key: PageKey; label: string; hint?: string };");
  });
});

describe("tipos do banco (types.ts)", () => {
  const TIPOS = ler("src/integrations/supabase/types.ts");
  it("coluna exige_peca_teste nas 3 formas de categorias_terceirizado", () => {
    const i = TIPOS.indexOf("      categorias_terceirizado: {");
    const bloco = TIPOS.slice(i, TIPOS.indexOf("      colaboradores: {"));
    expect(bloco).toContain("exige_peca_teste: boolean");
    expect(bloco.split("exige_peca_teste?: boolean").length - 1).toBe(2); // Insert + Update
  });
  it("tabela modelo_peca_teste_tentativas (Row/Insert/Update + 5 FKs) e as 3 RPCs", () => {
    const i = TIPOS.indexOf("      modelo_peca_teste_tentativas: {");
    expect(i).toBeGreaterThan(0);
    const bloco = TIPOS.slice(i, TIPOS.indexOf("      modelo_prova_comentarios: {"));
    for (const col of ["aprovacao", "categoria_terceirizado_id", "data_entrada", "data_saida", "empresa_id", "mo_linha_id", "numero", "rev", "origem"]) {
      expect(bloco).toContain(`${col}`);
    }
    expect(bloco.split("foreignKeyName:").length - 1).toBe(5);
    expect(TIPOS).toContain("peca_teste_modelo: { Args: { _modelo_id: string }; Returns: Json }");
    expect(TIPOS).toContain("peca_teste_quadro: { Args: never; Returns: Json }");
    expect(TIPOS).toMatch(/salvar_peca_teste: \{\s+Args: \{ _modelo_id: string; _rev_base: Json; _trilhas: Json \}\s+Returns: undefined/);
  });
});

describe("textoReprovarTentativa (confirmação de Reprovado, P-313 B)", () => {
  it("texto aprovado: título, corpo com nº, fornecedor, serviço e a próxima tentativa; ação Reprovar", () => {
    const t = textoReprovarTentativa({ numero: 2, servico: "PL", fornecedor: "Oficina Alfa" });
    expect(t.titulo).toBe("Reprovar a peça teste?");
    expect(t.descricao).toBe(
      "A tentativa 2 (Oficina Alfa) vai para o histórico como Reprovada e nasce a tentativa 3 com o mesmo serviço (PL) e o mesmo fornecedor, com as datas em branco.",
    );
    expect(t.confirmar).toBe("Reprovar");
    expect(t.cancelar).toBe("Cancelar");
    expect(t.destrutivo).toBe(true);
  });
  it("sem o dado, vale a frase sem o parêntese (nenhuma consulta nova)", () => {
    expect(textoReprovarTentativa({ numero: 1 }).descricao).toBe(
      "A tentativa 1 vai para o histórico como Reprovada e nasce a tentativa 2 com o mesmo serviço e o mesmo fornecedor, com as datas em branco.",
    );
    expect(textoReprovarTentativa({ numero: 1, servico: "PL", fornecedor: "—" }).descricao).toBe(
      "A tentativa 1 vai para o histórico como Reprovada e nasce a tentativa 2 com o mesmo serviço (PL) e o mesmo fornecedor, com as datas em branco.",
    );
  });
});
