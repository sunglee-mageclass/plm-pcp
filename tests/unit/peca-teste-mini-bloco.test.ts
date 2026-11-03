// @vitest-environment happy-dom
// R11 T6 — o bloco "Mini explosão (1 peça)" (render estático, aparência/regras do mockup v4) + o adaptador da ficha (`bomUmaPecaDaFicha`) + a
// fiação do Sheet (asserções de FONTE). O estado/payload/merge está em peca-teste-mini-estado.test.ts; o Salvar em peca-teste-mini-salvar.test.ts.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { MiniExplosaoBloco, limitarMini, LIMITE_MINI, miniEstaTravada, TEXTO_DICA_TROCA, TEXTO_PENDENTE_COM_BAIXA, TEXTO_SEM_TAMANHO_COR, type MiniBlocoProps } from "../../src/components/planejamento/planejamento-detail/MiniExplosaoBloco";
import { PecaTesteSecao } from "../../src/components/planejamento/planejamento-detail/PecaTesteSecao";
import type { CalculoMini, MiniApi } from "../../src/components/planejamento/planejamento-detail/useMiniExplosao";
import {
  ajustesParaMapa, ajusteOuNull, bomUmaPecaDaFicha, faltasPreview, insumosForaDoTamanho, linhasUmaPeca, miniNova, ordemDaVariante, tamanhoVinculadoPorChave,
  variantesDoTecido1,
  type EstoqueMini, type FichaParaMini, type MiniAjuste, type MiniPT,
} from "../../src/lib/peca-teste-mini";
import { editarMiniDaTentativa, estornosPendentes, payloadPecaTeste, tentativaVirtual, type EstadoPT, type TentativaPT, type TrilhaPT } from "../../src/lib/peca-teste";

const ROOT = path.resolve(__dirname, "../..");
const ler = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const L1 = "00000000-0000-4000-8000-0000000000a1";
const CAT = "00000000-0000-4000-8000-00000000ca01";
const V1 = "00000000-0000-4000-8000-0000000000b1";
const V2 = "00000000-0000-4000-8000-0000000000b2";
const AV = "00000000-0000-4000-8000-0000000000d1";
const ET = "00000000-0000-4000-8000-0000000000e1";
const ET2 = "00000000-0000-4000-8000-0000000000e2";
const ITEM1 = "00000000-0000-4000-8000-0000000000c1";
const ITEM2 = "00000000-0000-4000-8000-0000000000c2";
const VAV = "00000000-0000-4000-8000-0000000000f1";

const FICHA: FichaParaMini = {
  blocks: [{ tipo: "tecido", numero: 1, artigo_id: "art", consumo: 1.5, loss_percent: 10, variantes: [V1, V2], multiplicadores: [1, 1], complementas: [null, null] }],
  aviamentos: [{ aviamento_id: AV, consumo: 2 }],
  etiquetas: [{ etiqueta_id: ET, cor_id: null, consumo: 1 }, { etiqueta_id: ET2, cor_id: null, consumo: 1 }],
  nomeVarianteTecido: (id) => (id === V1 ? "Preto" : "Branco"),
  nomeAviamento: () => "Botão",
  variantesAviamento: () => [{ variante_aviamento_id: VAV, cor_id: null, rotulo: "Preto" }],
  etiqueta: (id) => (id === ET
    ? { nome: "Etiqueta M", formato_tamanho: "nenhum", tamanho_vinculado: "40|M", variantes: [] }
    : { nome: "Etiqueta G", formato_tamanho: "nenhum", tamanho_vinculado: "42|G", variantes: [] }),
};

const ESTOQUE: EstoqueMini = {
  modo: "por_oc",
  tecidos: [{ tipo: "tecido", numero: 1, ordem: 1, variante_tecido_id: V1,
    vinculos: [{ oc_tecido_item_id: ITEM1, rotulo: "OC 0001", is_rolo: false, prioridade: 1, quantidade_m: 0, saldo: 10 }],
    fifo: [{ oc_tecido_item_id: ITEM1, rotulo: "OC 0001", is_rolo: false, saldo: 10 }, { oc_tecido_item_id: ITEM2, rotulo: "Rolo R1", is_rolo: true, saldo: 4 }] }],
  aviamentos: [{ aviamento_id: AV, variantes: [{ variante_aviamento_id: VAV, rotulo: "Preto", cor_id: null, fisico: 50 }] }],
  insumos: [{ etiqueta_id: ET, tamanho: null, cor_id: null, fisico: 9 }],
};

function fakeApi(over: Partial<MiniApi> = {}, estoque: EstoqueMini = ESTOQUE): MiniApi {
  const calcular = (m: MiniPT | null): CalculoMini | null => {
    if (!m || !m.tamanho || !m.variante_tecido_id) return null;
    const bom = bomUmaPecaDaFicha(FICHA, null);
    const ordem = ordemDaVariante(FICHA, m.variante_tecido_id);
    const linhas = linhasUmaPeca(bom, m.tamanho, ordem, m.variante_tecido_id, ajustesParaMapa(m));
    const padrao = Object.fromEntries(linhasUmaPeca(bom, m.tamanho, ordem, m.variante_tecido_id, {}).map((l) => [l.chave, l]));
    return { linhas, padrao, fora: insumosForaDoTamanho(bom, m.tamanho), vinculados: tamanhoVinculadoPorChave(bom, linhas), faltas: faltasPreview(linhas, estoque, estoque.modo, m.mesma_oc) };
  };
  return {
    ativo: true, carregando: false, erro: false, tentarDeNovo: () => {}, fichaIndisponivel: false, pronta: true, semTecido1: false,
    tamanhos: [{ value: "40|M", label: "M" }, { value: "42|G", label: "G" }],
    cores: [{ value: V1, label: "Preto" }, { value: V2, label: "Branco" }],
    calcular,
    fontesTecido: () => ({
      vinculadas: [{ id: ITEM1, rotulo: "OC 0001", saldo: 10, is_rolo: false }],
      todas: [{ id: ITEM1, rotulo: "OC 0001", saldo: 10, is_rolo: false }, { id: ITEM2, rotulo: "Rolo R1", saldo: 4, is_rolo: true }],
    }),
    variantesAviamento: () => [{ value: VAV, label: "Preto" }],
    emEstoque: (l) => (l.familia === "aviamento" ? 50 : l.familia === "insumo" ? 9 : null),
    ...over,
  };
}

const mini = (o: Partial<MiniPT> = {}): MiniPT => ({ ...miniNova(), ...o });
const pronta = (o: Partial<MiniPT> = {}) => mini({ tamanho: "40|M", variante_tecido_id: V1, ...o });
const tent = (numero: number, o: Partial<TentativaPT> = {}): TentativaPT => ({ ...tentativaVirtual(numero), id: `00000000-0000-4000-8000-00000000b${numero}00`.slice(0, 36), rev: 1, ...o });
const ajuste = (chave: string, o: Partial<MiniAjuste> = {}): MiniAjuste => ({ chave, familia: "tecido", consumo: null, loss_percent: null, a_enviar: null, variante_aviamento_id: null, oc_tecido_item_id: null, ...o });
const foto = (o: Record<string, unknown> = {}) => ({ rotulo: "Tecido 1", variante: "Preto", unidade: "m" as const, consumo: 1.5, loss_percent: 10, necessaria: 1.65, a_enviar: 1.65, baixado: 1.65, faltou: 0, fontes: [], ...o });

/** inputs EDITÁVEIS (o Radix Checkbox emite um <input type=checkbox> escondido, que não conta). */
const temInput = (html: string) => /<input(?![^>]*type="checkbox")/.test(html);
const KEY_T = `t:tecido:1:1:${V1}`;

function render(over: Partial<MiniBlocoProps> & { tentativa: TentativaPT }): string {
  const props: MiniBlocoProps = {
    linhaId: L1, pathNumero: null, base: null, historico: false, podeEditar: true, api: fakeApi(), onChange: () => {}, abertoInicial: true, ...over,
  };
  return renderToStaticMarkup(createElement(MiniExplosaoBloco, props));
}

describe("bomUmaPecaDaFicha + helpers (adaptador puro da ficha)", () => {
  it("monta o BOM de 1 peça do estado da ficha: tecido por bloco×variante (ordem = slot+1), aviamento e insumo", () => {
    const bom = bomUmaPecaDaFicha(FICHA, null);
    expect(bom.tecidos).toHaveLength(1);
    expect(bom.tecidos[0].variantes.map((v) => [v.ordem, v.variante_tecido_id])).toEqual([[1, V1], [2, V2]]);
    expect(bom.aviamentos[0]).toMatchObject({ aviamento_id: AV, numero: 1, consumo: 2, nome: "Botão" });
    expect(bom.insumos.map((i) => i.nome)).toEqual(["Etiqueta M", "Etiqueta G"]);
  });
  it("bloco sem artigo, slot vazio e linha sem cadastro ficam de fora (o servidor não tem esses registros)", () => {
    const bom = bomUmaPecaDaFicha({
      ...FICHA,
      blocks: [...FICHA.blocks, { tipo: "forro", numero: 1, artigo_id: null, consumo: 1, loss_percent: 0, variantes: [V1], multiplicadores: [1], complementas: [null] }, { ...FICHA.blocks[0], numero: 2, variantes: [null, V2], multiplicadores: [1, 1], complementas: [null, null], tipo: "tecido" }],
      aviamentos: [{ aviamento_id: null, consumo: 1 }],
      etiquetas: [{ etiqueta_id: null, cor_id: null, consumo: 1 }],
    }, null);
    expect(bom.tecidos.map((b) => `${b.tipo}${b.numero}`)).toEqual(["tecido1", "tecido2"]);
    expect(bom.tecidos[1].variantes.map((v) => v.ordem)).toEqual([2]);
    expect(bom.aviamentos).toHaveLength(0);
    expect(bom.insumos).toHaveLength(0);
  });
  it("linhas da peça: Tecido 1 só da variante escolhida; insumo vinculado a OUTRO tamanho fica fora (contagem)", () => {
    const bom = bomUmaPecaDaFicha(FICHA, null);
    const ls = linhasUmaPeca(bom, "40|M", 1, V1, {});
    expect(ls.filter((l) => l.familia === "tecido")).toHaveLength(1);
    expect(ls.find((l) => l.familia === "tecido")).toMatchObject({ chave: KEY_T, necessaria: 1.65, a_enviar: 1.65 });
    expect(ls.filter((l) => l.familia === "insumo").map((l) => l.rotulo)).toEqual(["Etiqueta M"]);
    expect(insumosForaDoTamanho(bom, "40|M")).toBe(1);
    expect(insumosForaDoTamanho(bom, null)).toBe(0);
  });
  it("ordemDaVariante / variantesDoTecido1 / ajusteOuNull", () => {
    expect(ordemDaVariante(FICHA, V2)).toBe(2);
    expect(ordemDaVariante(FICHA, null)).toBeNull();
    expect(variantesDoTecido1(FICHA)).toEqual([{ id: V1, ordem: 1 }, { id: V2, ordem: 2 }]);
    expect(variantesDoTecido1({ blocks: [] })).toEqual([]);
    expect(ajusteOuNull(1.65, 1.65)).toBeNull(); // igual ao calculado = volta a seguir
    expect(ajusteOuNull(2, 1.65)).toBe(2);
    expect(ajusteOuNull(Number.NaN, 1)).toBeNull();
  });
  it("ajustesParaMapa: a variante de aviamento nula segue o padrão (a chave nem entra)", () => {
    const m = pronta({ linhas: [ajuste("a:x:1", { familia: "aviamento", a_enviar: 3 })] });
    expect(ajustesParaMapa(m)["a:x:1"]).toEqual({ consumo: null, loss_percent: null, a_enviar: 3, oc_tecido_item_id: null });
  });
});

describe("MiniExplosaoBloco — cabeçalho, selos e avisos por estado", () => {
  it("escondido quando a API diz que não há mini (loja sem Entrada e Saída / sem ver a seção)", () => {
    expect(render({ tentativa: tent(1), api: fakeApi({ ativo: false }) })).toBe("");
  });
  it("data-colab-path: atual = pt:<linha>:mini; histórico = pt:<linha>:t<n>:mini", () => {
    expect(render({ tentativa: tent(1) })).toContain(`data-colab-path="pt:${L1}:mini"`);
    expect(render({ tentativa: tent(1, { aprovacao: "reprovado", mini: pronta() }), pathNumero: 1, historico: true })).toContain(`data-colab-path="pt:${L1}:t1:mini"`);
  });
  it("título, chips Tam./cor, 'Não entra no custo do produto' (InfoHover) e a dica de trocar tamanho/cor", () => {
    const html = render({ tentativa: tent(1, { mini: pronta() }) });
    expect(html).toContain("Mini explosão (1 peça)");
    expect(html).toContain("Tam. M");
    expect(html).toContain("Preto");
    expect(html).toContain("Não entra no custo do produto");
    expect(html).toContain("Mais informação: a peça teste não entra no custo do produto");
    expect(html).toContain(TEXTO_DICA_TROCA);
  });
  it("sem tamanho e cor: selo 'Escolha tamanho e cor' + placeholder; sem Data de saída o aviso é o informativo", () => {
    const html = render({ tentativa: tent(1) });
    expect(html).toContain("Escolha tamanho e cor");
    expect(html).toContain("Escolha o tamanho e a cor da peça para carregar tecidos, aviamentos e insumos do BOM do card.");
    expect(html).toContain("A baixa acontece ao");
    expect(html).not.toContain(TEXTO_SEM_TAMANHO_COR);
  });
  it("P-349: Data de saída preenchida e sem tamanho/cor — avisa que sem eles não há baixa", () => {
    const html = render({ tentativa: tent(1, { data_saida: "2026-10-07" }) });
    expect(html).toContain("Data de saída preenchida, mas falta escolher o tamanho e a cor da peça — sem eles não há baixa.");
    expect(TEXTO_SEM_TAMANHO_COR).toContain("sem eles não há baixa");
  });
  it("pronta e sem baixa: selo 'Baixa ao Salvar'; com a Data de saída já preenchida o aviso diz que o Salvar fará a baixa", () => {
    const html = render({ tentativa: tent(1, { data_saida: "2026-10-07", mini: pronta() }), base: tent(1, { mini: pronta() }) });
    expect(html).toContain("Baixa ao Salvar");
    expect(html).toContain("A Data de saída já está preenchida: o Salvar fará a baixa.");
  });
  it("baixa salva + Data de saída em tentativa APROVADA: 'Baixa feita em <data>', banner verde e TRAVADA (a foto, nenhum input)", () => {
    const m = pronta({ baixa_em: "2026-10-07T10:00:00Z", linhas: [ajuste(KEY_T, { foto: foto({ faltou: 0.65, baixado: 1 }) })] });
    const t = tent(1, { data_saida: "2026-10-07", data_entrada: "2026-10-09", aprovacao: "aprovado", mini: m });
    const html = render({ tentativa: t, base: t });
    expect(miniEstaTravada(t, t, false)).toBe(true);
    expect(html).toContain("Baixa feita em 07/10/2026");
    expect(html).toContain("As quantidades estão travadas");
    expect(html).not.toContain('data-testid="mini-editar"');
    expect(html).toContain('data-testid="mini-foto-tecido"');
    expect(html).toContain("registrado na baixa");
    expect(html).toContain("faltou 0,65 m · registrada");
    expect(html).toContain("faltou · 1 item");
    expect(html).toContain("A falta ficou registrada na baixa.");
    expect(temInput(html)).toBe(false);
    expect(html).not.toContain("voltar ao calculado");
  });
  it("tentativa PENDENTE com baixa feita (mini igual à da baixa) NÃO trava: inputs editáveis por padrão, sem botão 'Editar', selo 'Baixa feita em' e aviso de que mudar refaz a baixa", () => {
    const m = pronta({ baixa_em: "2026-10-07T10:00:00Z", linhas: [ajuste(KEY_T, { foto: foto() })] });
    const t = tent(4, { aprovacao: null, data_saida: "2026-10-07", mini: m });
    expect(miniEstaTravada(t, t, false)).toBe(false);
    const html = render({ tentativa: t, base: t });
    expect(html).toContain("Baixa feita em 07/10/2026");
    expect(html).toContain(TEXTO_PENDENTE_COM_BAIXA);
    expect(TEXTO_PENDENTE_COM_BAIXA).toContain("a baixa será estornada e refeita");
    expect(html).not.toContain('data-testid="mini-editar"');
    expect(html).not.toContain("As quantidades estão travadas");
    expect(html).not.toContain('data-testid="mini-foto-tecido"'); // cálculo ao vivo, não a foto
    expect(html).toContain('aria-label="Metragem a enviar de Tecido 1 · Preto (m)"');
    expect(temInput(html)).toBe(true);
    // sem permissão: continua sem inputs (a regra de permissão não muda)
    expect(temInput(render({ tentativa: t, base: t, podeEditar: false }))).toBe(false);
  });
  it("baixa salva e Data de saída apagada: 'Estorno ao Salvar' + aviso de que o Salvar pede confirmação (quantidades voltam a ser editáveis)", () => {
    const base = tent(1, { data_saida: "2026-10-07", mini: pronta({ baixa_em: "2026-10-07T10:00:00Z" }) });
    const draft = { ...base, data_saida: null };
    const html = render({ tentativa: draft, base });
    expect(miniEstaTravada(draft, base, false)).toBe(false);
    expect(html).toContain("Estorno ao Salvar");
    expect(html).toContain("Ao Salvar, a baixa será estornada");
    expect(temInput(html)).toBe(true); // editável de novo
  });
  it("baixa salva, data preenchida e mini mudada (via merge/ajuste): avisa que estorna e refaz (P-365 A)", () => {
    const base = tent(1, { data_saida: "2026-10-07", mini: pronta({ baixa_em: "2026-10-07T10:00:00Z" }) });
    const draft = { ...base, mini: { ...base.mini!, mesma_oc: false } };
    expect(render({ tentativa: draft, base })).toContain("a baixa será estornada e refeita");
  });
  it("Q2=A (apagar a data → editar → preencher a data de novo): DESTRAVA, mostra o cálculo AO VIVO (não a foto velha) e o selo 'Vai estornar e baixar de novo'", () => {
    const fotoVelha = foto({ necessaria: 9.99, a_enviar: 9.99, baixado: 9.99 });
    const base = tent(1, { data_saida: "2026-10-07", mini: pronta({ baixa_em: "2026-10-07T10:00:00Z", linhas: [ajuste(KEY_T, { foto: fotoVelha })] }) });
    // a pessoa editou o "a enviar" com a data apagada e preencheu a data de novo: mini do rascunho ≠ mini da baixa, data presente
    const draft = { ...base, mini: { ...base.mini!, linhas: [ajuste(KEY_T, { a_enviar: 2 })] } };
    expect(miniEstaTravada(draft, base, false)).toBe(false);
    const html = render({ tentativa: draft, base });
    expect(html).toContain("Vai estornar e baixar de novo");
    expect(html).not.toContain("Baixa feita em");
    expect(html).not.toContain('data-testid="mini-foto-tecido"');
    expect(html).not.toContain("9,99");
    expect(html).toContain('aria-label="Metragem a enviar de Tecido 1 · Preto (m)"'); // inputs de volta
    expect(html).toContain("a baixa será estornada e refeita");
  });
  it("mini igual à da baixa, com a data de volta (nada mudou), em tentativa APROVADA: segue TRAVADA com a foto e o selo verde", () => {
    const m = pronta({ baixa_em: "2026-10-07T10:00:00Z", linhas: [ajuste(KEY_T, { foto: foto() })] });
    const base = tent(1, { aprovacao: "aprovado", data_entrada: "2026-10-09", data_saida: "2026-10-07", mini: m });
    expect(miniEstaTravada({ ...base }, base, false)).toBe(true);
    expect(render({ tentativa: base, base })).toContain("Baixa feita em 07/10/2026");
  });
  it("tentativa ATUAL reprovada (historico=false) NÃO trava a mini — dá p/ editar consumo/a enviar (bug 03/nov)", () => {
    // reprovada, sem baixa feita: a mini da tentativa atual (antes de nascer a próxima) tem de ficar editável.
    const t = tent(2, { aprovacao: "reprovado", data_saida: null, mini: pronta() });
    expect(miniEstaTravada(t, t, false)).toBe(false);
    // só APROVADA trava:
    expect(miniEstaTravada(t, tent(2, { aprovacao: "aprovado" }), false)).toBe(true);
  });
  it("pendente com baixa e a pessoa muda o 'a enviar': o selo vira 'Vai estornar e baixar de novo' sem clicar em nada (DOM, inputs sempre abertos)", async () => {
    const m = pronta({ baixa_em: "2026-10-07T10:00:00Z", linhas: [ajuste(KEY_T, { foto: foto() })] });
    const base = tent(2, { aprovacao: null, data_saida: "2026-10-07", mini: m });
    let atual = base;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const desenhar = () => act(async () => {
      root.render(createElement(MiniExplosaoBloco, { linhaId: L1, pathNumero: null, tentativa: atual, base, historico: false, podeEditar: true, api: fakeApi(), abertoInicial: true,
        onChange: (novo: MiniPT) => { atual = { ...atual, mini: novo }; void desenhar(); } }));
    });
    await desenhar();
    expect(container.querySelector('[data-testid="mini-editar"]')).toBeNull();
    expect(container.querySelector('input[aria-label^="Metragem a enviar"]')).not.toBeNull(); // editável de saída
    expect(container.textContent).toContain("Baixa feita em 07/10/2026");
    expect(atual.data_saida).toBe("2026-10-07"); // a data segue
    atual = { ...atual, mini: { ...atual.mini!, mesma_oc: false } }; // mini mudada
    await desenhar();
    expect(container.textContent).toContain("Vai estornar e baixar de novo");
    root.unmount(); container.remove();
  });
  it("APROVADA, histórico e reprovada com baixa seguem TRAVADOS (foto, sem inputs) — só a PENDENTE destrava; sem permissão não edita; sem baixa/sem data a pendente já era editável", () => {
    const m = pronta({ baixa_em: "2026-10-07T10:00:00Z", linhas: [ajuste(KEY_T, { foto: foto() })] });
    const aprovada = tent(1, { aprovacao: "aprovado", data_entrada: "2026-10-09", data_saida: "2026-10-07", mini: m });
    expect(miniEstaTravada(aprovada, aprovada, false)).toBe(true);
    expect(temInput(render({ tentativa: aprovada, base: aprovada }))).toBe(false);
    const hist = tent(1, { aprovacao: "reprovado", data_saida: "2026-10-07", mini: m });
    expect(miniEstaTravada(hist, hist, true)).toBe(true);
    const htmlHist = render({ tentativa: hist, base: hist, historico: true, pathNumero: 1 });
    expect(htmlHist).not.toContain('data-testid="mini-editar"');
    expect(temInput(htmlHist)).toBe(false);
    const reprovadaAtual = tent(2, { aprovacao: "reprovado", data_saida: "2026-10-07", mini: m });
    expect(miniEstaTravada(reprovadaAtual, reprovadaAtual, false)).toBe(true); // decidida com baixa: o servidor congela
    expect(temInput(render({ tentativa: reprovadaAtual, base: reprovadaAtual }))).toBe(false);
    const semBaixa = tent(2, { aprovacao: null, data_saida: "2026-10-07", mini: pronta() });
    expect(miniEstaTravada(semBaixa, semBaixa, false)).toBe(false);
    const semData = tent(2, { aprovacao: null, data_saida: null, mini: m });
    expect(miniEstaTravada(semData, semData, false)).toBe(false);
    const nova = tent(3, { aprovacao: null, data_saida: null, mini: pronta() });
    expect(miniEstaTravada(nova, null, false)).toBe(false); // sem linha salva
  });
  it("histórico (reprovada) fechado: 'Baixa mantida (peça gasta)', somente leitura, sem inputs; a faixa convida a clicar em Editar (baixa estornada e refeita)", () => {
    const m = pronta({ baixa_em: "2026-10-05T10:00:00Z", linhas: [ajuste(KEY_T, { foto: foto() })] });
    const t = tent(1, { aprovacao: "reprovado", data_saida: "2026-10-05", mini: m });
    const html = render({ tentativa: t, base: t, historico: true, pathNumero: 1 });
    expect(html).toContain("Baixa mantida (peça gasta)");
    expect(html).toContain("somente leitura");
    expect(html).not.toContain("não</b> é estornada");
    expect(html).toContain("clique em <b>Editar</b>");
    expect(html).toContain("estornada e refeita</b>");
    expect(temInput(html)).toBe(false);
  });
  it("histórico (reprovada) com `edicaoHistorico`: destrava os inputs, mostra o cálculo ao vivo (não a foto) e a faixa de edição; APROVADA nunca destrava", () => {
    const m = pronta({ baixa_em: "2026-10-05T10:00:00Z", linhas: [ajuste(KEY_T, { foto: foto({ necessaria: 9.99, a_enviar: 9.99, baixado: 9.99 }) })] });
    const t = tent(1, { aprovacao: "reprovado", data_saida: "2026-10-05", mini: m });
    expect(miniEstaTravada(t, t, true)).toBe(true);
    expect(miniEstaTravada(t, t, true, true)).toBe(false);
    const html = render({ tentativa: t, base: t, historico: true, edicaoHistorico: true, pathNumero: 1 });
    expect(temInput(html)).toBe(true);
    expect(html).toContain("Editando a mini da tentativa reprovada");
    expect(html).toContain("editando a reprovada");
    expect(html).not.toContain("9,99");
    expect(html).not.toContain('data-testid="mini-foto-tecido"');
    // mini mudada em edição = Salvar estorna e refaz
    const mudada = { ...t, mini: { ...m, mesma_oc: false } };
    expect(render({ tentativa: mudada, base: t, historico: true, edicaoHistorico: true, pathNumero: 1 })).toContain("Vai estornar e baixar de novo");
    // sem permissão: edição liberada mas sem inputs
    expect(temInput(render({ tentativa: t, base: t, historico: true, edicaoHistorico: true, podeEditar: false, pathNumero: 1 }))).toBe(false);
    // aprovada: nem com a flag
    const ap = tent(1, { aprovacao: "aprovado", data_saida: "2026-10-05", mini: m });
    expect(miniEstaTravada(ap, ap, true, true)).toBe(true);
    expect(miniEstaTravada(ap, ap, false, true)).toBe(true);
  });
  it("aprovada (decisão salva) trava a mini mesmo sem baixa", () => {
    const base = tent(1, { aprovacao: "aprovado", data_entrada: "2026-10-09", data_saida: "2026-10-05", mini: pronta() });
    expect(miniEstaTravada(base, base, false)).toBe(true);
    expect(temInput(render({ tentativa: base, base }))).toBe(false);
  });
});

describe("limites dos campos numéricos (espelho dos CHECKs do servidor)", () => {
  it("negativo/NaN viram 0; acima do teto vira o teto; dentro da faixa passa", () => {
    expect(limitarMini(-1, LIMITE_MINI.a_enviar)).toBe(0);
    expect(limitarMini(Number.NaN, LIMITE_MINI.consumo)).toBe(0);
    expect(limitarMini(100000, LIMITE_MINI.a_enviar)).toBe(99999);
    expect(limitarMini(10000, LIMITE_MINI.consumo)).toBe(9999);
    expect(limitarMini(101, LIMITE_MINI.loss_percent)).toBe(100);
    expect(limitarMini(12.3456, LIMITE_MINI.a_enviar)).toBe(12.3456);
    expect(limitarMini(0, LIMITE_MINI.consumo)).toBe(0);
  });
  it("os tetos batem com as migrations (consumo 9999, loss 100, a enviar 99999) e todo <Num> declara o seu", () => {
    expect(LIMITE_MINI).toEqual({ consumo: 9999, loss_percent: 100, a_enviar: 99999 });
    const src = ler("src/components/planejamento/planejamento-detail/MiniExplosaoBloco.tsx");
    const usos = src.match(/<Num [^>]*>/g) ?? [];
    expect(usos.length).toBeGreaterThanOrEqual(5);
    for (const u of usos) expect(u).toContain("max=");
  });
});

describe("a11y do cabeçalho do colapsável", () => {
  it("o 'botão' do cabeçalho abre/fecha também com Enter e Espaço (onKeyDown)", () => {
    const src = ler("src/components/planejamento/planejamento-detail/MiniExplosaoBloco.tsx");
    expect(src).toMatch(/onKeyDown=\{\(e\) => \{ if \(e\.target === e\.currentTarget && \(e\.key === "Enter" \|\| e\.key === " "\)\) \{ e\.preventDefault\(\); setAberto\(\(v\) => !v\); \} \}\}/);
  });
});

describe("MiniExplosaoBloco — tabelas, ↺, OC do card, faltas e mobile", () => {
  it("3 tabelas com as colunas do mockup; metragem necessária só leitura e a enviar editável (aria-label)", () => {
    const html = render({ tentativa: tent(1, { mini: pronta() }) });
    for (const c of ["Consumo (m)", "% Loss", "Metragem necessária (m)", "Metragem a enviar (m)", "Sai de (OC / rolo)", "Situação"]) expect(html).toContain(c);
    for (const c of ["Aviamento", "Variante", "A separar/enviar", "Em estoque"]) expect(html).toContain(c);
    expect(html).toContain("Insumos / etiquetas");
    expect(html).toContain('data-testid="mini-necessaria"');
    expect(html).toContain("1,65");
    expect(html).toContain('aria-label="Metragem a enviar de Tecido 1 · Preto (m)"');
    expect(html).toContain("A baixa desta peça (a enviar):");
  });
  it("↺ 'voltar ao calculado (x)' SÓ aparece quando o a enviar difere da necessária", () => {
    expect(render({ tentativa: tent(1, { mini: pronta() }) })).not.toContain("voltar ao calculado");
    const html = render({ tentativa: tent(1, { mini: pronta({ linhas: [ajuste(KEY_T, { a_enviar: 2 })] }) }) });
    expect(html).toContain("voltar ao calculado (1,65)");
  });
  it("'mesma OC do card' marcado: lista só leitura 1ª com saldo; sem picker", () => {
    const html = render({ tentativa: tent(1, { mini: pronta() }) });
    expect(html).toContain("Usar a mesma OC do card");
    expect(html).toContain("1ª");
    expect(html).toContain("OC 0001");
    expect(html).toContain("saldo");
    expect(html).not.toContain("Escolha a OC ou o rolo de");
    expect(html).not.toContain('aria-label="OC ou rolo de');
  });
  it("sem OC/rolo vinculado ao tecido: dizer que sai do estoque mais antigo", () => {
    const api = fakeApi({ fontesTecido: () => ({ vinculadas: [], todas: [] }) });
    expect(render({ tentativa: tent(1, { mini: pronta() }), api })).toContain("Nenhuma OC/rolo vinculado a este tecido no card");
  });
  it("desmarcado: picker OCs/Rolos por tecido + aviso âmbar 'Escolha a OC ou o rolo de: …' enquanto não escolheu", () => {
    const html = render({ tentativa: tent(1, { mini: pronta({ mesma_oc: false }) }) });
    expect(html).toContain('aria-label="OC ou rolo de Tecido 1 · Preto"');
    expect(html).toContain("Escolha a OC ou o rolo de:");
    expect(html).toContain("Sem a origem, a baixa deste tecido não é feita.");
    expect(html).toContain("Escolha a OC/rolo");
    expect(html).toContain("Desmarcado: escolha a OC ou o rolo de cada tecido");
  });
  it("desmarcado com OC escolhida: some o aviso", () => {
    const m = pronta({ mesma_oc: false, linhas: [ajuste(KEY_T, { oc_tecido_item_id: ITEM2 })] });
    const html = render({ tentativa: tent(1, { mini: m }) });
    expect(html).not.toContain("Escolha a OC ou o rolo de:");
    expect(html).not.toContain("Escolha a OC/rolo");
  });
  it("'N insumos vinculados a outro tamanho não entram nesta peça'", () => {
    const html = render({ tentativa: tent(1, { mini: pronta() }) });
    expect(html).toContain("1 insumo do card vinculado a outro tamanho não entra nesta peça (tamanho M).");
    expect(html).toContain("Só tam. M");
  });
  it("faltou estoque (prévia): selo, badge na linha e banner 'O Salvar grava mesmo assim…'", () => {
    const pouco: EstoqueMini = { ...ESTOQUE, aviamentos: [{ aviamento_id: AV, variantes: [{ variante_aviamento_id: VAV, rotulo: "Preto", cor_id: null, fisico: 0.5 }] }] };
    const api = fakeApi({}, pouco);
    api.emEstoque = (l) => (l.familia === "aviamento" ? 0.5 : null);
    const html = render({ tentativa: tent(1, { mini: pronta() }), api });
    expect(html).toContain("faltou · 1 item");
    expect(html).toContain("faltou 1,5 un");
    expect(html).toContain("Faltou estoque em 1 item");
    expect(html).toContain("O Salvar grava mesmo assim e a falta fica registrada.");
  });
  it("sem a ficha pronta: 'Carregando…' e nada é calculado; sem permissão de ver a ficha: aviso; erro do estoque: 'Tentar de novo'", () => {
    expect(render({ tentativa: tent(1, { mini: pronta() }), api: fakeApi({ pronta: false, carregando: true, calcular: () => null }) })).toContain("Carregando…");
    expect(render({ tentativa: tent(1), api: fakeApi({ pronta: false, fichaIndisponivel: true, calcular: () => null }) })).toContain("que o seu perfil não pode ver");
    const e = render({ tentativa: tent(1), api: fakeApi({ pronta: false, erro: true, calcular: () => null }) });
    expect(e).toContain("Não foi possível carregar os dados.");
    expect(e).toContain("Tentar de novo");
    expect(e).not.toContain("Carregando…");
    // durante a releitura o botão vira "Tentando…" (e fica desabilitado)
    const t = render({ tentativa: tent(1), api: fakeApi({ pronta: false, erro: true, tentando: true, calcular: () => null }) });
    expect(t).toContain("Tentando…");
  });
  it("mobile: tabela vira cartões empilhados (grid-cols-1, rótulo por célula, colunas só em xl) e inputs w-full", () => {
    const html = render({ tentativa: tent(1, { mini: pronta() }) });
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("xl:grid-cols-[");
    expect(html).toMatch(/<span class="[^"]*xl:hidden[^"]*">Metragem a enviar \(m\)<\/span>/);
    expect(html).toMatch(/<input[^>]*class="[^"]*w-full[^"]*"[^>]*aria-label="Metragem a enviar/);
    expect(html).not.toMatch(/\bmin-w-\[\d{3,}px\]/);
  });
  it("seletores Tamanho e Cor com o rótulo e a dica da grade do card; sem Tecido 1 a cor fica desabilitada", () => {
    const html = render({ tentativa: tent(1) });
    expect(html).toContain("Tamanho da peça");
    expect(html).toContain("Cor da peça (variante)");
    expect(html).toContain("Grade do card: M · G");
    expect(html).toContain("Variantes do Tecido 1 do card.");
    expect(render({ tentativa: tent(1), api: fakeApi({ semTecido1: true, cores: [] }) })).toContain("Card sem Tecido 1");
  });
  it("somente leitura (sem permissão de editar a seção): sem inputs e sem ↺", () => {
    const t = tent(1, { mini: pronta({ linhas: [ajuste(KEY_T, { a_enviar: 2 })] }) });
    const html = render({ tentativa: t, podeEditar: false });
    expect(temInput(html)).toBe(false);
    expect(html).not.toContain("voltar ao calculado");
  });
});

describe("PecaTesteSecao — o bloco sob a grade da atual e nas linhas do histórico", () => {
  const trilha = (o: Partial<TrilhaPT> = {}): TrilhaPT => ({ mo_linha_id: L1, categoria_id: CAT, categoria_nome: "PL", empresa_id: null, empresa_nome: null, mo_aprovado: true, tentativas: [], ...o });
  const renderSecao = (e: EstadoPT, over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(PecaTesteSecao, {
      estado: e, base: e, fornecedores: [], onEditarAtual: () => {}, onAprovar: () => {}, onDesfazer: () => {}, onReprovar: () => {}, onTrocarFornecedor: () => {},
      historicoAberto: true, miniAbertaInicial: true, defaultAberta: true, ...over,
    } as never));

  it("sem a prop `mini` a seção fica como na R9 (nenhum bloco)", () => {
    expect(renderSecao({ trilhas: [trilha()], outros: [] })).not.toContain("Mini explosão");
  });
  it("com `mini`: 1 bloco na tentativa atual + 1 em cada reprovada que tem mini (somente leitura)", () => {
    const e: EstadoPT = { trilhas: [trilha({ tentativas: [tent(1, { aprovacao: "reprovado", data_saida: "2026-10-01", mini: pronta({ baixa_em: "2026-10-01T10:00:00Z", linhas: [ajuste(KEY_T, { foto: foto() })] }) }), tent(2, { mini: pronta() })] })], outros: [] };
    const html = renderSecao(e, { mini: fakeApi() });
    expect((html.match(/data-testid="peca-teste-mini"/g) ?? []).length).toBe(2);
    expect(html).toContain(`data-colab-path="pt:${L1}:mini"`);
    expect(html).toContain(`data-colab-path="pt:${L1}:t1:mini"`);
    expect(html).toContain("Baixa mantida (peça gasta)");
  });
  it("reprovada SEM mini não ganha bloco no histórico (sem ruído)", () => {
    const e: EstadoPT = { trilhas: [trilha({ tentativas: [tent(1, { aprovacao: "reprovado", data_saida: "2026-10-01" })] })], outros: [] };
    const html = renderSecao(e, { mini: fakeApi() });
    expect((html.match(/data-testid="peca-teste-mini"/g) ?? []).length).toBe(1); // só a atual (virtual, nº 2)
  });
  it("avisos do merge (baixa/estorno de outra pessoa) aparecem na seção", () => {
    const html = renderSecao({ trilhas: [trilha()], outros: [] }, { avisos: ["A baixa de estoque da peça teste (tentativa 1) foi feita por outra pessoa — a mini explosão foi atualizada."] });
    expect(html).toContain("foi feita por outra pessoa");
  });
});

describe("PecaTesteSecao — Editar a mini da reprovada do histórico (fluxo completo no DOM)", () => {
  const trilha = (o: Partial<TrilhaPT> = {}): TrilhaPT => ({ mo_linha_id: L1, categoria_id: CAT, categoria_nome: "PL", empresa_id: null, empresa_nome: null, mo_aprovado: true, tentativas: [], ...o });
  const montar = (b: EstadoPT, over: Record<string, unknown> = {}) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const ref = { estado: b };
    const desenhar = () => act(async () => {
      root.render(createElement(PecaTesteSecao, {
        estado: ref.estado, base: b, fornecedores: [], onEditarAtual: () => {}, onAprovar: () => {}, onDesfazer: () => {}, onReprovar: () => {}, onTrocarFornecedor: () => {},
        historicoAberto: true, miniAbertaInicial: true, defaultAberta: true, mini: fakeApi(),
        onEditarMiniTentativa: (linhaId: string, numero: number, m: MiniPT | null) => {
          ref.estado = { ...ref.estado, trilhas: ref.estado.trilhas.map((t) => (t.mo_linha_id === linhaId ? editarMiniDaTentativa(t, numero, m) : t)) };
          void desenhar();
        },
        ...over,
      } as never));
    });
    return { container, ref, desenhar, fim: () => { root.unmount(); container.remove(); } };
  };
  const hist = (container: HTMLElement) => container.querySelector('[data-testid="peca-teste-historico"]') as HTMLElement;
  const baixa = pronta({ baixa_em: "2026-10-01T10:00:00Z", linhas: [ajuste(KEY_T, { a_enviar: 1.65, foto: foto() })] });
  const reprovada = () => tent(1, { aprovacao: "reprovado", data_saida: "2026-10-01", data_entrada: "2026-10-04", mini: baixa });
  const estadoBase = (): EstadoPT => ({ trilhas: [trilha({ tentativas: [reprovada(), tent(2, { mini: pronta() })] })], outros: [] });

  it("começa TRAVADA (sem inputs; botão Editar presente) → clicar Editar libera → editar + Salvar gera estorno_e_baixa no payload", async () => {
    const b = estadoBase();
    const { container, ref, desenhar, fim } = montar(b);
    await desenhar();
    // (a) fechada por padrão
    expect(hist(container).querySelectorAll("input[aria-label^='Metragem a enviar']").length).toBe(0);
    expect(hist(container).textContent).toContain("somente leitura");
    const editar = container.querySelector('[data-testid="peca-teste-reprovada-editar"]') as HTMLElement;
    expect(editar).not.toBeNull();
    // (b) clicar Editar libera os inputs (cálculo ao vivo no lugar da foto)
    await act(async () => { editar.click(); });
    const input = hist(container).querySelector("input[aria-label^='Metragem a enviar']") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(container.querySelector('[data-testid="peca-teste-reprovada-cancelar"]')).not.toBeNull();
    expect(hist(container).textContent).toContain("Editando a mini da tentativa reprovada");
    // sem editar nada ainda: nada a salvar
    expect(payloadPecaTeste(ref.estado, b)._trilhas).toEqual([]);
    // (c) editar o "a enviar" pelo DOM → o estado fica diferente da base
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      input.focus();
      set.call(input, "3");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const d = ref.estado;
    const t1 = d.trilhas[0].tentativas[0];
    expect(t1.mini?.linhas.find((l) => l.chave === KEY_T)?.a_enviar).toBe(3);
    expect(t1).toMatchObject({ aprovacao: "reprovado", data_saida: "2026-10-01", data_entrada: "2026-10-04" }); // datas/decisão seguem travadas
    expect(hist(container).textContent).toContain("Vai estornar e baixar de novo");
    const p = payloadPecaTeste(d, b, undefined, undefined, { confere: { [`${L1}:1`]: { [KEY_T]: 3 } } });
    const enviado = p._trilhas[0].tentativas.find((x) => x.numero === 1)!;
    expect(enviado.aprovacao).toBe("reprovado");
    expect(enviado.mini?.ajustes.find((a) => a.chave === KEY_T)?.a_enviar).toBe(3);
    expect(enviado.mini?.confere).toEqual({ [KEY_T]: 3 });
    expect(estornosPendentes(d, b)).toEqual([{ mo_linha_id: L1, servico: "PL", numero: 1, refaz: true }]); // acaoNoSalvar === "estorno_e_baixa"
    // Cancelar edição: volta à mini do servidor, fecha e some o estorno
    await act(async () => { (container.querySelector('[data-testid="peca-teste-reprovada-cancelar"]') as HTMLElement).click(); });
    expect(estornosPendentes(ref.estado, b)).toEqual([]);
    expect(payloadPecaTeste(ref.estado, b)._trilhas).toEqual([]);
    expect(hist(container).querySelectorAll("input[aria-label^='Metragem a enviar']").length).toBe(0);
    fim();
  });
  it("sem permissão de editar (somente leitura) não há botão Editar; tentativa APROVADA nunca tem (não está no histórico)", async () => {
    const b = estadoBase();
    const ro = montar(b, { somenteLeitura: true });
    await ro.desenhar();
    expect(ro.container.querySelector('[data-testid="peca-teste-reprovada-editar"]')).toBeNull();
    ro.fim();
    const ap: EstadoPT = { trilhas: [trilha({ tentativas: [tent(1, { aprovacao: "aprovado", data_saida: "2026-10-01", data_entrada: "2026-10-04", mini: baixa })] })], outros: [] };
    const a = montar(ap);
    await a.desenhar();
    expect(a.container.querySelector('[data-testid="peca-teste-reprovada-editar"]')).toBeNull();
    a.fim();
  });
  it("reprovada que só existe no rascunho (o servidor ainda não a tem como reprovada) não ganha Editar", async () => {
    const b: EstadoPT = { trilhas: [trilha({ tentativas: [tent(1, { data_saida: "2026-10-01", mini: pronta() })] })], outros: [] };
    const d: EstadoPT = { trilhas: [trilha({ tentativas: [tent(1, { aprovacao: "reprovado", data_saida: "2026-10-01", mini: baixa }), tent(2, { mini: pronta() })] })], outros: [] };
    const m = montar(b);
    m.ref.estado = d;
    await m.desenhar();
    expect(m.container.querySelector('[data-testid="peca-teste-reprovada-editar"]')).toBeNull();
    m.fim();
  });
});

describe("fiação do Sheet (fonte)", () => {
  const SHEET = ler("src/components/planejamento/PlanejamentoDetail.tsx");
  const HOOK = ler("src/components/planejamento/planejamento-detail/usePecaTeste.ts");
  const SAVE = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");
  it("o Sheet monta a mini com a ficha, passa ao usePecaTeste e à seção (com os avisos do merge)", () => {
    // só carrega quando há Peça Teste de fato (serviço que exige peça teste OU trilha já devolvida pelo servidor)
    expect(SHEET).toMatch(/useMiniExplosao\(\{ modeloId, habilitado: isEdit && podeVerPT && \(ptTemTrilha \|\| algumServicoExigePT\), ficha, tamanhoTipo: draft\.tamanho_tipo \}\)/);
    expect(SHEET).toMatch(/setPtTemTrilha\(ptTrilhasN > 0\)/);
    expect(SHEET).toMatch(/usePecaTeste\(\{[^}]*mini: miniEx/);
    expect(SHEET).toContain("mini={miniEx}");
    expect(SHEET).toContain("onEditarMini={pt.editarMini}");
    expect(SHEET).toContain("onEditarMiniTentativa={pt.editarMiniTentativa}");
    expect(SHEET).toContain("avisos={pt.avisos}");
  });
  it("o hook passa `confere` e `semTecido1` ao payload e ao dirty, e mostra os avisos do merge", () => {
    expect(HOOK).toContain("chaveConfere(t.mo_linha_id, a.numero)");
    expect(HOOK).toMatch(/payloadPecaTeste\(ef, b, undefined, ignoradasRef\.current, opcoesPT\(ef\)\)/);
    expect(HOOK).toMatch(/juntarAvisos\(r\.avisos\)/);
    expect(HOOK).toMatch(/juntarAvisos\(m\.avisos\)/);
  });
  it("invalida o saldo da mini, o extrato (prefixo) e as keys de estoque das 3 abas depois do Salvar da Peça Teste", () => {
    for (const k of ['["peca-teste-mini-estoque", modeloId]', '["estoque-extrato"]', '["estoque-tecidos"]', '["estoque-aviamentos"]', '["estoque-insumos"]']) expect(SAVE).toContain(k);
  });
});
