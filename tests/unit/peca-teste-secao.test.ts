// @vitest-environment happy-dom
// R9 T6 — a SEÇÃO "Peça Teste" do Sheet do Planejamento: render estático do componente (aparência/regras de tela) + asserções de FONTE na
// fiação do Sheet (ordem, permissão, trava por seção, Salvar). A lógica pura está em peca-teste.test.ts; o Salvar em peca-teste-salvar.test.ts.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import { PecaTesteSecao, TEXTO_FORNECEDOR_TRAVADO, TEXTO_DESFAZER_DECISAO, TEXTO_SEM_MO_NO_TIPO } from "../../src/components/planejamento/planejamento-detail/PecaTesteSecao";
import { ORDEM_SECOES_SHEET, numerarSecoes, selosSecoesSheet, CONDICOES_SECAO_SHEET, type SecaoSheetKey, type EntradaSelosSheet } from "../../src/components/planejamento/planejamento-detail/ficha/selos-secoes";
import { TEXTO_APROVAR_MEIO, TEXTO_REABRIR_MEIO, TEXTO_SEM_FORNECEDOR, TEXTO_SEM_FORNECEDOR_NO_TIPO, tentativaVirtual, type EstadoPT, type TentativaPT, type TrilhaPT } from "../../src/lib/peca-teste";

const ROOT = path.resolve(__dirname, "../..");
const ler = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const FONTE_SHEET = ler("src/components/planejamento/PlanejamentoDetail.tsx");
const FONTE_SAVE = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");

const CAT = "00000000-0000-4000-8000-00000000ca01";
const CAT2 = "00000000-0000-4000-8000-00000000ca02";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const F2 = "00000000-0000-4000-8000-0000000000f2";
const T1 = "00000000-0000-4000-8000-0000000000b1";
const FORNS = [{ id: F1, nome_fantasia: "Oficina Um" }, { id: F2, nome_fantasia: "Oficina Dois" }];

const tent = (numero: number, o: Partial<TentativaPT> = {}): TentativaPT => ({ ...tentativaVirtual(numero), id: T1.slice(0, -2) + "0" + numero, rev: 1, ...o });
const trilha = (o: Partial<TrilhaPT> = {}): TrilhaPT => ({
  categoria_id: CAT, categoria_nome: "PL", tem_mo: true, mo_aprovado: true, fornecedores: FORNS, tentativas: [], excluidas: [], ...o,
});
const estado = (...t: TrilhaPT[]): EstadoPT => ({ trilhas: t, outros: [], tipos_adicionar: [] });

type Props = Parameters<typeof PecaTesteSecao>[0];
function render(over: Partial<Props> & { estado: EstadoPT | null }): string {
  const noop = () => {};
  const props: Props = {
    // A seção abre RECOLHIDA no Sheet (decisão do dono 03/nov, igual às outras); aqui o render estático força aberta p/ asseverar o conteúdo.
    numero: 12, selo: undefined, base: over.estado, defaultAberta: true,
    onEditarAtual: noop, onAprovar: noop, onDesfazer: noop, onReprovar: noop, onTrocarFornecedor: noop,
    ...over,
  };
  return renderToStaticMarkup(createElement(PecaTesteSecao, props));
}
/** A tag <button …> do campo (Select/DateField) cujo `data-colab-path` é `pt:<tipo>:<campo>` — atributos em qualquer ordem. */
function tagDoCampo(html: string, linha: string, campo: string): string {
  const m = new RegExp(`<(?:button|input)[^>]*data-colab-path="pt:${linha}:${campo}"[^>]*>`).exec(html);
  if (!m) throw new Error(`campo ${campo} não encontrado`);
  return m[0];
}
const desabilitado = (tag: string) => /\sdisabled(=|\s|>)/.test(tag);

describe("PecaTesteSecao — resumo, requisito e cabeçalho da trilha", () => {
  it("resumo 'N de M serviços com peça teste aprovada' + 'Necessária para enviar à Explosão' + banner de falta com o motivo", () => {
    const e = estado(
      trilha({ categoria_nome: "PL", tentativas: [tent(1, { aprovacao: "aprovado", empresa_id: F1, data_saida: "2026-09-22", data_entrada: "2026-09-29" })] }),
      trilha({ categoria_id: CAT2, categoria_nome: "Bordado", mo_aprovado: null }),
    );
    const html = render({ estado: e });
    expect(html).toContain("1 de 2");
    expect(html).toContain("serviços com peça teste aprovada");
    expect(html).toContain("Necessária para enviar à Explosão (requisito do kanban).");
    expect(html).toContain("Falta para o requisito do kanban:");
    expect(html).toContain("Bordado (peça teste e M.O.)");
  });

  it("requisito cumprido: banner verde", () => {
    const e = estado(trilha({ tentativas: [tent(1, { aprovacao: "aprovado", empresa_id: F1, data_saida: "2026-09-22", data_entrada: "2026-09-29" })] }));
    const html = render({ estado: e });
    expect(html).toContain("1 de 1");
    expect(html).toContain("cumprido");
    expect(html).not.toContain("Falta para o requisito do kanban");
  });

  it("cabeçalho: 'PL — Tentativa N' · selo âmbar 'M.O. pendente'/'M.O. reprovada' (só com M.O. do tipo) · selo de status", () => {
    const pend = render({ estado: estado(trilha({ mo_aprovado: null })) });
    expect(pend).toContain("PL — Tentativa 1");
    expect(pend).toContain("M.O. pendente");
    expect(pend).toContain("Aguardando saída");
    expect(pend).not.toContain("M.O.: ");
    expect(render({ estado: estado(trilha({ mo_aprovado: false })) })).toContain("M.O. reprovada");
    expect(render({ estado: estado(trilha({ mo_aprovado: true })) })).not.toContain("M.O. pendente");
    const emTeste = render({ estado: estado(trilha({ tentativas: [tent(1, { data_saida: "2026-09-22" })] })) });
    expect(emTeste).toContain("Em teste");
    const rep = render({ estado: estado(trilha({ tentativas: [tent(1, { aprovacao: "reprovado", data_saida: "2026-09-08", data_entrada: "2026-09-15", empresa_id: F1, empresa_nome: "Oficina Um" })] })) });
    expect(rep).toContain("Reprovada — nova tentativa");
    expect(rep).toContain("PL — Tentativa 2");
  });

  it("DOIS contadores no título: 'PL — Tentativa 3 (2ª com Oficina Um)'", () => {
    const e = estado(trilha({ tentativas: [
      tent(1, { aprovacao: "reprovado", data_saida: "2026-09-08", data_entrada: "2026-09-15", empresa_id: F1, empresa_nome: "Oficina Um" }),
      tent(2, { aprovacao: "reprovado", data_saida: "2026-09-16", data_entrada: "2026-09-18", empresa_id: F2, empresa_nome: "Oficina Dois" }),
      tent(3, { data_saida: "2026-09-22", empresa_id: F1, empresa_nome: "Oficina Um" }),
    ] }));
    expect(render({ estado: e })).toContain("PL — Tentativa 3 (2ª com Oficina Um)");
  });

  it("trilha de tipo SEM linha de M.O. (adicionada à mão): avisa que não trava o kanban e não conta no 'N de M'", () => {
    const html = render({ estado: estado(trilha({ tem_mo: false, mo_aprovado: null })) });
    expect(html).toContain(TEXTO_SEM_MO_NO_TIPO);
    expect(html).not.toContain("serviços com peça teste aprovada");
    expect(html).not.toContain("M.O. pendente");
  });

  it("sem trilhas (nem linha nova): nenhum resumo; carregando e erro têm texto próprio", () => {
    const vazio = render({ estado: estado() });
    expect(vazio).not.toContain("serviços com peça teste aprovada");
    expect(render({ estado: null, carregando: true })).toContain("Carregando a peça teste");
    const err = render({ estado: null, erro: true });
    expect(err).toContain("Não foi possível carregar a peça teste");
    expect(err).toContain("Tentar de novo");
  });
});

describe("PecaTesteSecao — a tentativa atual", () => {
  it("Aprovação desabilitada sem as 2 datas, com a dica 'Preencha a Data de saída e a Data de entrada para decidir.'", () => {
    const html = render({ estado: estado(trilha({ tentativas: [tent(1, { data_saida: "2026-09-22" })] })) });
    expect(desabilitado(tagDoCampo(html, CAT, "aprovacao"))).toBe(true);
    expect(html).toContain("Preencha a Data de saída e a Data de entrada para decidir.");
    // com as 2 datas e o fornecedor salvo: habilitada, sem dica
    const ok = render({ estado: estado(trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29", empresa_id: F1, empresa_nome: "Oficina Um" })] })) });
    expect(desabilitado(tagDoCampo(ok, CAT, "aprovacao"))).toBe(false);
    expect(ok).not.toContain("Preencha a Data de saída");
  });

  it("tentativa SEM fornecedor: Aprovação desabilitada com a dica 'Escolha o fornecedor desta tentativa antes de decidir.'; com fornecedor, habilita", () => {
    const t = trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29" })] });
    const html = render({ estado: estado(t) });
    expect(desabilitado(tagDoCampo(html, CAT, "aprovacao"))).toBe(true);
    expect(html).toContain(TEXTO_SEM_FORNECEDOR);
    const ok = render({ estado: estado(trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29", empresa_id: F1, empresa_nome: "Oficina Um" })] })) });
    expect(desabilitado(tagDoCampo(ok, CAT, "aprovacao"))).toBe(false);
    expect(ok).not.toContain(TEXTO_SEM_FORNECEDOR);
  });

  it("(Review) tipo SEM fornecedor vinculado: aviso 'vincule em Cadastro', Select de fornecedor desabilitado, e as DATAS seguem editáveis (não bloqueia a trilha)", () => {
    const html = render({ estado: estado(trilha({ fornecedores: [], tentativas: [tent(1, { data_saida: "2026-09-22" })] })) });
    expect(html).toContain(TEXTO_SEM_FORNECEDOR_NO_TIPO);
    expect(html).toContain('data-testid="peca-teste-sem-fornecedor-no-tipo"');
    expect(desabilitado(tagDoCampo(html, CAT, "empresa_id"))).toBe(true);
    expect(desabilitado(tagDoCampo(html, CAT, "data_saida"))).toBe(false);
    expect(desabilitado(tagDoCampo(html, CAT, "data_entrada"))).toBe(false);
    expect(render({ estado: estado(trilha()) })).not.toContain(TEXTO_SEM_FORNECEDOR_NO_TIPO);
  });

  it("Peça aprovada trava fornecedor e datas (cadeado + 'Peça aprovada: fornecedor travado.'); a Aprovação continua aberta para desfazer", () => {
    const aprovada = trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29", aprovacao: "aprovado", empresa_id: F1 })] });
    const html = render({ estado: estado(aprovada) });
    expect(TEXTO_FORNECEDOR_TRAVADO).toBe("Peça aprovada: fornecedor travado.");
    expect(html).toContain("Peça aprovada: fornecedor travado.");
    expect(html).toContain('data-testid="peca-teste-forn-travado"');
    expect(desabilitado(tagDoCampo(html, CAT, "empresa_id"))).toBe(true);
    expect(desabilitado(tagDoCampo(html, CAT, "data_saida"))).toBe(true);
    expect(desabilitado(tagDoCampo(html, CAT, "data_entrada"))).toBe(true);
    expect(desabilitado(tagDoCampo(html, CAT, "aprovacao"))).toBe(false);
    expect(html).toContain("Aprovada");
  });

  it("'Desfazer' visível ao lado do selo 'Aprovada' da tentativa ATUAL: clicar chama onDesfazer(linha) e NÃO aparece pendente, no histórico nem sem permissão", async () => {
    const aprovada = trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29", aprovacao: "aprovado", empresa_id: F1 })] });
    const html = render({ estado: estado(aprovada) });
    expect(html).toContain('data-testid="peca-teste-desfazer"');
    expect(html).toContain("Desfazer");
    expect(TEXTO_DESFAZER_DECISAO).toContain("A baixa de material já feita não é devolvida");
    // pendente (nada a desfazer)
    const pend = render({ estado: estado(trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29" })] })) });
    expect(pend).not.toContain('data-testid="peca-teste-desfazer"');
    // sem permissão
    expect(render({ estado: estado(aprovada), somenteLeitura: true })).not.toContain('data-testid="peca-teste-desfazer"');
    // reprovada vai ao histórico; a atual (nova, pendente) não tem Desfazer — e o histórico não o tem
    const repro = trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29", aprovacao: "reprovado" }), tent(2, { data_saida: "2026-10-01" })] });
    expect(render({ estado: estado(repro) })).not.toContain('data-testid="peca-teste-desfazer"');
    // clique real chama onDesfazer com a linha
    const chamadas: string[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(PecaTesteSecao, {
        numero: 12, selo: undefined, base: estado(aprovada), estado: estado(aprovada), defaultAberta: true,
        onEditarAtual: () => {}, onAprovar: () => {}, onDesfazer: (l: string) => { chamadas.push(l); }, onReprovar: () => {}, onTrocarFornecedor: () => {},
      } as Props));
    });
    const btn = container.querySelector('[data-testid="peca-teste-desfazer"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    await act(async () => { btn.click(); });
    // reabrir uma aprovação JÁ SALVA pede confirmação (o card regride no kanban): só ao confirmar chama onDesfazer(tipo)
    expect(chamadas).toEqual([]);
    const dialogoDesfazer = document.body.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialogoDesfazer.textContent).toContain("Reabrir a tentativa 1?");
    expect(dialogoDesfazer.textContent).toContain("deixa de estar aprovada");
    await act(async () => { [...dialogoDesfazer.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Reabrir")!.click(); });
    expect(chamadas).toEqual([CAT]);
    root.unmount(); container.remove();
  });

  it("Desfazer uma aprovação que SÓ existe no rascunho (a base ainda não a tem) NÃO pede confirmação: nada mudou no servidor", async () => {
    const aprovada = trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29", aprovacao: "aprovado", empresa_id: F1 })] });
    const naBase = estado(trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29", empresa_id: F1 })] }));
    const chamadas: string[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(PecaTesteSecao, {
        numero: 12, base: naBase, estado: estado(aprovada), defaultAberta: true,
        onEditarAtual: () => {}, onAprovar: () => {}, onDesfazer: (l: string) => { chamadas.push(l); }, onReprovar: () => {}, onTrocarFornecedor: () => {},
      } as Props));
    });
    await act(async () => { (container.querySelector('[data-testid="peca-teste-desfazer"]') as HTMLButtonElement).click(); });
    expect(document.body.querySelector('[role="alertdialog"]')).toBeNull();
    expect(chamadas).toEqual([CAT]);
    root.unmount(); container.remove();
  });

  it("dica âmbar NÃO bloqueante quando a entrada é anterior à saída (Ruling 24)", () => {
    const html = render({ estado: estado(trilha({ tentativas: [tent(1, { data_saida: "2026-09-29", data_entrada: "2026-09-22", empresa_id: F1, empresa_nome: "Oficina Um" })] })) });
    expect(html).toContain('data-testid="peca-teste-dica-datas"');
    expect(desabilitado(tagDoCampo(html, CAT, "aprovacao"))).toBe(false);
  });

  it("data-colab-path nos 4 campos de cada trilha (anel de presença): pt:<tipo>:<campo>", () => {
    const html = render({ estado: estado(trilha(), trilha({ categoria_id: CAT2, categoria_nome: "Bordado" })) });
    for (const l of [CAT, CAT2]) for (const c of ["empresa_id", "data_saida", "data_entrada", "aprovacao"]) {
      expect(html, `${l}:${c}`).toContain(`data-colab-path="pt:${l}:${c}"`);
    }
    expect((html.match(/data-colab-path="pt:/g) ?? []).length).toBe(8);
  });

  it("DateField (nunca <input type=date>) e Selects w-full; grade responsiva grid-cols-1 sm:2 lg:4", () => {
    const html = render({ estado: estado(trilha()) });
    expect(html).not.toMatch(/type="date"/);
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("sm:grid-cols-2");
    expect(html).toContain("lg:grid-cols-4");
    expect(html).toContain("dd/mm/aaaa");
  });
});

describe("PecaTesteSecao — histórico, linhas novas, rodapé, conflito e só leitura", () => {
  const reprovada = tent(1, { aprovacao: "reprovado", data_saida: "2026-09-08", data_entrada: "2026-09-15", empresa_id: F1, empresa_nome: "Oficina Um" });

  it("'Tentativas anteriores (N)': SEM permissão de editar = só leitura (fornecedor da tentativa, as 2 datas, o selo Reprovado e o 2º contador)", () => {
    const e = estado(trilha({ tentativas: [reprovada, tent(2, { data_saida: "2026-09-22" })] }));
    expect(render({ estado: e })).toContain("Tentativas anteriores (1)");
    const html = render({ estado: e, historicoAberto: true, somenteLeitura: true });
    const m = /<ul[^>]*data-testid="peca-teste-historico"[^>]*>([\s\S]*?)<\/ul>/.exec(html);
    expect(m).not.toBeNull();
    const lista = m![1];
    expect(lista).toContain("Tentativa 1 (1ª com Oficina Um)");
    expect(lista).toContain("Oficina Um");
    expect(lista).toContain("08/09/2026");
    expect(lista).toContain("15/09/2026");
    expect(lista).toContain("Reprovado");
    expect(lista).not.toMatch(/<input|<select|combobox|<button/);
  });

  it("linha de M.O. NOVA (ainda não salva) cujo tipo exige: 'Salve o card para lançar a peça teste de <serviço>.' (Ruling 12)", () => {
    const html = render({ estado: estado(), linhasNovas: ["Bordado"] });
    expect(html).toContain("Salve o card para lançar a peça teste de Bordado.");
  });

  it("(A3) histórico editável: com permissão e a tentativa JÁ salva como reprovada aparecem Editar / Aprovar / Reabrir / Excluir; sem permissão não", () => {
    const e = estado(trilha({ tentativas: [reprovada, tent(2, { data_saida: "2026-09-22" })] }));
    const com = render({ estado: e, historicoAberto: true, onExcluir: () => {}, onMudarDecisao: () => {}, onCorrigir: () => {} });
    for (const id of ["peca-teste-reprovada-editar", "peca-teste-aprovar-hist", "peca-teste-reabrir", "peca-teste-excluir"]) expect(com, id).toContain(`data-testid="${id}"`);
    const sem = render({ estado: e, historicoAberto: true, somenteLeitura: true, onExcluir: () => {}, onMudarDecisao: () => {}, onCorrigir: () => {} });
    for (const id of ["peca-teste-reprovada-editar", "peca-teste-aprovar-hist", "peca-teste-reabrir", "peca-teste-excluir"]) expect(sem, id).not.toContain(`data-testid="${id}"`);
    // reprovada que só existe no rascunho (a base ainda a tem como pendente): sem ações
    const baseSemDecisao = estado(trilha({ tentativas: [tent(1, { data_saida: "2026-09-08", data_entrada: "2026-09-15", empresa_id: F1 })] }));
    const soRascunho = render({ estado: e, base: baseSemDecisao, historicoAberto: true, onExcluir: () => {}, onMudarDecisao: () => {}, onCorrigir: () => {} });
    expect(soRascunho).not.toContain('data-testid="peca-teste-excluir"');
  });

  it("(Review) aprovar/reabrir a tentativa do MEIO (há seguintes) fica DESABILITADO com o motivo; a última reprovada pode", () => {
    const meio = estado(trilha({ tentativas: [reprovada, tent(2, { aprovacao: "reprovado", data_saida: "2026-09-16", data_entrada: "2026-09-18", empresa_id: F2, empresa_nome: "Oficina Dois" }), tent(3, { data_saida: "2026-09-22" })] }));
    const html = render({ estado: meio, historicoAberto: true, onExcluir: () => {}, onMudarDecisao: () => {}, onCorrigir: () => {} });
    const li1 = /<li[^>]*data-testid="peca-teste-hist-1"[^>]*>([\s\S]*?)<\/li>/.exec(html)![1];
    expect(desabilitado(/<button[^>]*data-testid="peca-teste-aprovar-hist"[^>]*>/.exec(li1)![0])).toBe(true);
    expect(desabilitado(/<button[^>]*data-testid="peca-teste-reabrir"[^>]*>/.exec(li1)![0])).toBe(true);
    expect(li1).toContain(TEXTO_APROVAR_MEIO);
    expect(li1).toContain(TEXTO_REABRIR_MEIO);
    const ultima = estado(trilha({ tentativas: [reprovada] }));
    const html2 = render({ estado: ultima, historicoAberto: true, onExcluir: () => {}, onMudarDecisao: () => {}, onCorrigir: () => {} });
    expect(desabilitado(/<button[^>]*data-testid="peca-teste-aprovar-hist"[^>]*>/.exec(html2)![0])).toBe(false);
    expect(desabilitado(/<button[^>]*data-testid="peca-teste-reabrir"[^>]*>/.exec(html2)![0])).toBe(false);
  });

  it("(A3) Excluir pede CONFIRMAÇÃO (AlertDialog); só ao confirmar chama onExcluir(tipo, nº); Cancelar não chama", async () => {
    const e = estado(trilha({ tentativas: [reprovada, tent(2, { data_saida: "2026-09-22" })] }));
    const chamadas: [string, number][] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(PecaTesteSecao, {
        numero: 12, base: e, estado: e, defaultAberta: true, historicoAberto: true,
        onEditarAtual: () => {}, onAprovar: () => {}, onDesfazer: () => {}, onReprovar: () => {}, onTrocarFornecedor: () => {},
        onExcluir: (c: string, n: number) => { chamadas.push([c, n]); }, onMudarDecisao: () => {}, onCorrigir: () => {},
      } as Props));
    });
    const btn = container.querySelector('[data-testid="peca-teste-excluir"]') as HTMLButtonElement;
    await act(async () => { btn.click(); });
    const dialogo = document.body.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialogo).not.toBeNull();
    expect(dialogo.textContent).toContain("Excluir a tentativa 1?");
    expect(chamadas).toEqual([]); // abrir o diálogo NÃO exclui
    const botoes = [...dialogo.querySelectorAll("button")];
    await act(async () => { botoes.find((b) => b.textContent?.trim() === "Cancelar")!.click(); });
    expect(chamadas).toEqual([]);
    await act(async () => { (container.querySelector('[data-testid="peca-teste-excluir"]') as HTMLButtonElement).click(); });
    const d2 = document.body.querySelector('[role="alertdialog"]') as HTMLElement;
    await act(async () => { [...d2.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Excluir")!.click(); });
    expect(chamadas).toEqual([[CAT, 1]]);
    root.unmount(); container.remove();
  });

  it("(A2) 'Adicionar peça teste': aparece com permissão + handler + tipos disponíveis; some sem permissão, sem handler ou sem tipos", () => {
    const e: EstadoPT = { trilhas: [trilha()], outros: [], tipos_adicionar: [{ categoria_id: CAT2, categoria_nome: "Bordado", fornecedores: FORNS }] };
    expect(render({ estado: e, onAdicionarTrilha: () => {} })).toContain('data-testid="peca-teste-adicionar"');
    expect(render({ estado: e })).not.toContain('data-testid="peca-teste-adicionar"');
    expect(render({ estado: e, onAdicionarTrilha: () => {}, somenteLeitura: true })).not.toContain('data-testid="peca-teste-adicionar"');
    expect(render({ estado: { ...e, tipos_adicionar: [] }, onAdicionarTrilha: () => {} })).not.toContain('data-testid="peca-teste-adicionar"');
  });

  it("rodapé 'não aparece aqui' lista serviço + fornecedor (nunca valor) dos que não exigem peça teste", () => {
    const e: EstadoPT = { trilhas: [trilha()], outros: [{ categoria_nome: "Lavanderia", empresa_nome: "Lava Tudo" }], tipos_adicionar: [] };
    const html = render({ estado: e });
    expect(html).toContain("Lavanderia");
    expect(html).toContain("(Lava Tudo)");
    expect(html).toContain("não aparece aqui: o tipo de serviço não exige peça teste (Cadastro › Atributos › Categoria do Serviço).");
    expect(html).not.toMatch(/R\$/);
  });

  it("conflito de seção inline com 'manter meu' / 'usar o novo' e rótulo legível", () => {
    const html = render({
      estado: estado(trilha()),
      conflitos: [{ path: `pt:${CAT}:data_entrada`, meu: "29/09/2026", dele: "02/10/2026" }],
      onResolverConflito: () => {},
    });
    expect(html).toContain("1 conflito a resolver");
    expect(html).toContain("Peça Teste — PL — Data de entrada");
    expect(html).toContain("manter meu");
    expect(html).toContain("usar o novo");
  });

  it("sem permissão de EDITAR a seção: tudo só leitura (fieldset desabilitado e controles desabilitados), sem dicas de edição", () => {
    const t = trilha({ tentativas: [tent(1, { data_saida: "2026-09-22" })] });
    const html = render({ estado: estado(t), somenteLeitura: true });
    const tagFs = /<fieldset[^>]*data-testid="peca-teste-grade"[^>]*>/.exec(html)?.[0] ?? "";
    expect(desabilitado(tagFs)).toBe(true);
    for (const c of ["empresa_id", "data_saida", "data_entrada", "aprovacao"]) expect(desabilitado(tagDoCampo(html, CAT, c)), c).toBe(true);
    expect(html).not.toContain("Preencha a Data de saída");
  });

  it("achado 2 — quem só VÊ: o histórico colapsável e o 'Tentar de novo' ficam FORA de qualquer fieldset desabilitado", () => {
    const reprovada = tent(1, { aprovacao: "reprovado", data_saida: "2026-09-08", data_entrada: "2026-09-15", empresa_id: F1, empresa_nome: "Oficina Um" });
    const html = render({ estado: estado(trilha({ tentativas: [reprovada, tent(2, { data_saida: "2026-09-22" })] })), somenteLeitura: true });
    expect(html).toContain("Tentativas anteriores (1)");
    for (const m of html.matchAll(/<fieldset[^>]*>([\s\S]*?)<\/fieldset>/g)) {
      expect(m[1]).not.toContain("Tentativas anteriores");
    }
    const err = render({ estado: null, erro: true, somenteLeitura: true });
    expect(/<fieldset/.test(err)).toBe(false);
    expect(err).toContain("Tentar de novo");
  });

  it("achado 2 (fix round 2) — Leitor do Sheet INTEIRO (fieldset desabilitado do SheetContent acima): histórico já aberto e 'Tentar de novo' sem <button>", () => {
    const reprovada = tent(1, { aprovacao: "reprovado", data_saida: "2026-09-08", data_entrada: "2026-09-15", empresa_id: F1, empresa_nome: "Oficina Um" });
    const dentro = (html: string) => `<fieldset disabled="">${html}</fieldset>`;
    const h = dentro(render({ estado: estado(trilha({ tentativas: [reprovada, tent(2, { data_saida: "2026-09-22" })] })), somenteLeitura: true }));
    expect(h).toContain('data-testid="peca-teste-historico"');
    expect(h).toContain("08/09/2026");
    const e = dentro(render({ estado: null, erro: true, somenteLeitura: true }));
    expect(e).not.toMatch(/<button[^>]*>[^<]*Tentar de novo/);
    expect(e).toMatch(/<span role="button"[^>]*>Tentar de novo<\/span>/);
    // quem EDITA a seção mantém o histórico fechado por padrão
    expect(render({ estado: estado(trilha({ tentativas: [reprovada, tent(2, { data_saida: "2026-09-22" })] })) })).not.toContain('data-testid="peca-teste-historico"');
  });

  it("N1 (fix round 2) — tentativa ainda NÃO salva (id nulo) não decide: Aprovação desabilitada com 'Salve as datas antes de decidir.'; a gravada com só a saída decide junto da entrada", () => {
    const comDatas = { ...tentativaVirtual(1), data_saida: "2026-10-01", data_entrada: "2026-10-03" };
    const nova = render({ estado: estado(trilha({ tentativas: [comDatas] })) });
    expect(desabilitado(tagDoCampo(nova, CAT, "aprovacao"))).toBe(true);
    expect(nova).toContain("Salve as datas antes de decidir.");
    // virtual (sem nada) também: a dica é a das datas
    // gravada (id) com só a saída + entrada preenchida no rascunho: habilitada
    const gravada = render({ estado: estado(trilha({ tentativas: [tent(1, { data_saida: "2026-10-01", data_entrada: "2026-10-03", empresa_id: F1, empresa_nome: "Oficina Um" })] })) });
    expect(desabilitado(tagDoCampo(gravada, CAT, "aprovacao"))).toBe(false);
    // a seguinte a uma reprovada é virtual de novo: mesma regra
    const rep = tent(1, { aprovacao: "reprovado", data_saida: "2026-09-08", data_entrada: "2026-09-15", empresa_id: F1 });
    const prox = render({ estado: estado(trilha({ tentativas: [rep, { ...tentativaVirtual(2), data_saida: "2026-10-01", data_entrada: "2026-10-03" }] })) });
    expect(desabilitado(tagDoCampo(prox, CAT, "aprovacao"))).toBe(true);
  });
});

describe("numeração, ordem e selo da seção", () => {
  it("ORDEM_SECOES_SHEET: 'peca_teste' logo DEPOIS de 'preco'", () => {
    const i = ORDEM_SECOES_SHEET.indexOf("preco");
    expect(i).toBeGreaterThan(-1);
    expect(ORDEM_SECOES_SHEET[i + 1]).toBe("peca_teste");
  });

  it("numerarSecoes numera 'peca_teste' depois de 'preco' quando visível; sem ela os números de antes não mudam", () => {
    const base: SecaoSheetKey[] = ["info", "colecao", "preco", "anexos"];
    const sem = numerarSecoes(new Set(base));
    const com = numerarSecoes(new Set<SecaoSheetKey>([...base, "peca_teste"]));
    expect(com.preco).toBe(sem.preco);
    expect(com.peca_teste).toBe((sem.preco ?? 0) + 1);
    expect(com.anexos).toBe((sem.anexos ?? 0) + 1);
    expect(sem.peca_teste).toBeUndefined();
  });

  it("CONDICOES_SECAO_SHEET.peca_teste = ['peca_teste_aprovada']", () => {
    expect(CONDICOES_SECAO_SHEET.peca_teste).toEqual(["peca_teste_aprovada"]);
  });

  const entradaBase = (pt: EntradaSelosSheet["pecaTeste"]): EntradaSelosSheet => ({
    requeridas: new Set(), satisfeitas: null, podeVerCustos: false, infoCompleta: false, infoVazia: true, colecaoResumo: "",
    desenvolvimentoCompleto: false, desenvolvimentoVazia: true, preco: null, maoObraAviso: null,
    anexos: { fotoModelo: false, fotoReferencia: false, desenho: false, croqui: false }, lancamento: { lancado: false, data: null }, pecaTeste: pt,
  });
  it("selo próprio 'N de M aprovadas': verde quando cumprido, âmbar senão, ausente sem trilhas", () => {
    expect(selosSecoesSheet(entradaBase({ aprovadas: 2, total: 2, ok: true })).peca_teste).toMatchObject({ tone: "ok", texto: "2 de 2 aprovadas" });
    expect(selosSecoesSheet(entradaBase({ aprovadas: 1, total: 2, ok: false })).peca_teste).toMatchObject({ tone: "warn", texto: "1 de 2 aprovadas" });
    expect(selosSecoesSheet(entradaBase({ aprovadas: 0, total: 0, ok: true })).peca_teste).toBeUndefined();
    expect(selosSecoesSheet(entradaBase(null)).peca_teste).toBeUndefined();
  });
});

describe("fiação no Sheet (fonte)", () => {
  it("vis.peca_teste: card salvo + permissão de ver + (trilha OU linha nova que exige); a seção fica entre 'Preço e Custos' e as seções seguintes", () => {
    expect(FONTE_SHEET).toMatch(/peca_teste:\s*isEdit && !!modeloId && podeVerPT && \(\(pt\.estado\?\.trilhas\.length \?\? 0\) > 0 \|\| ptLinhasNovas\.length > 0 \|\| pt\.erro\)/);
    const iPreco = FONTE_SHEET.indexOf("{vis.preco && (");
    const iPT = FONTE_SHEET.indexOf("{vis.peca_teste && (");
    const iPA = FONTE_SHEET.indexOf("{vis.produto_acabado && (isRevenda");
    expect(iPreco).toBeGreaterThan(-1);
    expect(iPT).toBeGreaterThan(iPreco);
    expect(iPA).toBeGreaterThan(iPT);
  });

  it("permissão: canView/canEdit de criacao_planejamento:peca_teste; o ReadOnlyScope do Sheet = sheetSomenteLeitura && !podeEditarPT", () => {
    expect(FONTE_SHEET).toMatch(/const podeVerPT = canView\(PERM_PECA_TESTE\)/);
    expect(FONTE_SHEET).toMatch(/const podeEditarPT = canEdit\(PERM_PECA_TESTE\)/);
    expect(ler("src/components/planejamento/planejamento-detail/usePecaTeste.ts")).toContain('"criacao_planejamento:peca_teste"');
    expect(FONTE_SHEET).toMatch(/<ReadOnlyScope value=\{perm\.sheetSomenteLeitura && !podeEditarPT\}>\s*<Sheet open/);
  });

  it("TODO o resto fica sob a trava de sempre: cabeçalho, grupo antes, grupo depois e ações do rodapé; a seção usa a própria permissão", () => {
    for (const id of ["sheet-fora-peca-teste-cabecalho", "sheet-grupo-antes-peca-teste", "sheet-grupo-depois-peca-teste", "sheet-rodape-acoes"]) {
      const m = new RegExp(`<fieldset disabled=\\{perm\\.sheetSomenteLeitura\\}[^>]*data-testid="${id}"`).exec(FONTE_SHEET);
      expect(m, id).not.toBeNull();
      // e o ReadOnlyScope do MESMO valor logo antes (Radix/AlertDialog dentro herdam)
      const antes = FONTE_SHEET.slice(Math.max(0, (m?.index ?? 0) - 200), m?.index ?? 0);
      expect(antes, id).toMatch(/<ReadOnlyScope value=\{perm\.sheetSomenteLeitura\}>\s*$/);
    }
    const sec = ler("src/components/planejamento/planejamento-detail/PecaTesteSecao.tsx");
    expect(sec).toMatch(/<ReadOnlyScope value=\{somenteLeitura\}>/);
    expect(FONTE_SHEET).toMatch(/somenteLeitura=\{!podeEditarPT\}/);
  });

  it("quem só edita a seção: pointer-events-none FORA da seção (o disabled do fieldset não segura o Radix no pointerdown)", () => {
    expect(FONTE_SHEET).toMatch(/const barraPonteiroFora = perm\.sheetSomenteLeitura && podeEditarPT \? "pointer-events-none" : undefined/);
    expect((FONTE_SHEET.match(/barraPonteiroFora\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("Salvar aparece/habilita com !sheetSomenteLeitura OU (podeEditarPT E seção suja); Voltar e Salvar ficam fora do fieldset das ações", () => {
    expect(FONTE_SHEET).toMatch(/disabled=\{\(perm\.sheetSomenteLeitura && !\(podeEditarPT && pt\.dirty\)\) \|\| save\.isPending/);
    const iAcoes = FONTE_SHEET.indexOf('data-testid="sheet-rodape-acoes"');
    const iFim = FONTE_SHEET.indexOf("</fieldset>", iAcoes);
    const iSalvar = FONTE_SHEET.indexOf('aria-label="Salvar"');
    const iVoltar = FONTE_SHEET.indexOf('aria-label="Voltar"');
    expect(iVoltar).toBeLessThan(iAcoes);
    expect(iSalvar).toBeGreaterThan(iFim);
  });

  it("dirty do Sheet (guarda de saída, selo 'não salvo', 'Salve antes de enviar') inclui o da Peça Teste", () => {
    expect(FONTE_SHEET).toMatch(/const dirty = [^;]*\|\| pt\.dirty;/);
  });

  it("Salvar do card recebe a API da seção e o modo só-Peça-Teste", () => {
    expect(FONTE_SHEET).toMatch(/pecaTeste: pt\.pecaTesteSave,\s*somentePecaTeste: perm\.sheetSomenteLeitura && podeEditarPT/);
  });

  it("(reforma) o fornecedor é da TENTATIVA: o Sheet não espelha mais M.O. ⇄ seção (sem fornecedorMo, linhasIgnoradas, espelharFornecedorNaMO, fornecedorTravadoMO)", () => {
    for (const morto of ["fornecedorMo", "linhasIgnoradas", "espelharFornecedorNaMO", "aoMudarLinhasMO", "trocarFornecedorPT", "resolverConflitoPT", "fornecedorTravadoMO", "ptBloqueadasPorTipo"]) {
      expect(FONTE_SHEET, morto).not.toContain(morto);
    }
    expect(FONTE_SHEET).toMatch(/onChangeLinhas=\{setMoLinhas\}/);
    expect(FONTE_SHEET).toMatch(/onTrocarFornecedor=\{pt\.trocarFornecedor\}/);
    expect(FONTE_SHEET).toMatch(/onAdicionarTrilha=\{pt\.adicionarTrilha\}/);
    expect(ler("src/components/planejamento/planejamento-detail/usePecaTeste.ts")).not.toMatch(/fornecedorMo|linhasIgnoradas|comFornecedoresDaMo/);
  });

  it("achado 5 — erro de leitura NÃO esconde a seção; 'Salve o card para lançar…' vem dos tipos da M.O. que ainda não têm trilha", () => {
    expect(FONTE_SHEET).toMatch(/ptLinhasNovas\.length > 0 \|\| pt\.erro/);
    expect(FONTE_SHEET).toMatch(/const jaTem = new Set\(pt\.estado\.trilhas\.map\(\(t\) => t\.categoria_id\)\)/);
  });

  it("a lista de tipos de serviço lê exige_peca_teste (para 'Salve o card para lançar…')", () => {
    expect(FONTE_SHEET).toMatch(/\.select\("id, nome, ativo, valor_padrao, exige_peca_teste"\)/);
  });

  it("MaoObraEditor: sem o freio nem a prop fornecedorTravado (a trava de fornecedor mora na tentativa)", () => {
    const mo = ler("src/components/planejamento/MaoObraEditor.tsx");
    expect(mo).not.toContain("fornecedorTravado");
    expect(mo).not.toContain("Peça teste aprovada: fornecedor travado");
  });

  it("aprovar/reprovar M.O. (grava na hora) invalida também a seção", () => {
    expect(ler("src/components/planejamento/planejamento-detail/helpers.ts")).toContain('qc.invalidateQueries({ queryKey: ["peca-teste", modeloId] })');
  });

  it("realtime: categorias_terceirizado invalida ['peca-teste']", () => {
    const mapa = ler("src/lib/realtime-invalidation-map.ts");
    expect(mapa).toMatch(/categorias_terceirizado: \[[\s\S]*?"peca-teste",[\s\S]*?\],/);
  });

  it("o Salvar não ganhou nenhuma escrita direta fora da RPC salvar_peca_teste", () => {
    expect(FONTE_SAVE).not.toMatch(/from\("modelo_peca_teste_tentativas"/);
    expect(ler("src/components/planejamento/planejamento-detail/usePecaTeste.ts")).toContain('supabase.rpc("salvar_peca_teste"');
  });
});
