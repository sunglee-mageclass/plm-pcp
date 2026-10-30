// R9 T6 — a SEÇÃO "Peça Teste" do Sheet do Planejamento: render estático do componente (aparência/regras de tela) + asserções de FONTE na
// fiação do Sheet (ordem, permissão, trava por seção, Salvar). A lógica pura está em peca-teste.test.ts; o Salvar em peca-teste-salvar.test.ts.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PecaTesteSecao, TEXTO_TROCA_FORNECEDOR, TEXTO_TROCA_FORNECEDOR_REABRE, TEXTO_FORNECEDOR_TRAVADO } from "../../src/components/planejamento/planejamento-detail/PecaTesteSecao";
import { ORDEM_SECOES_SHEET, numerarSecoes, selosSecoesSheet, CONDICOES_SECAO_SHEET, type SecaoSheetKey, type EntradaSelosSheet } from "../../src/components/planejamento/planejamento-detail/ficha/selos-secoes";
import { tentativaVirtual, type EstadoPT, type TentativaPT, type TrilhaPT } from "../../src/lib/peca-teste";

const ROOT = path.resolve(__dirname, "../..");
const ler = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const FONTE_SHEET = ler("src/components/planejamento/PlanejamentoDetail.tsx");
const FONTE_SAVE = ler("src/components/planejamento/planejamento-detail/usePlanejamentoSave.ts");

const L1 = "00000000-0000-4000-8000-0000000000a1";
const L2 = "00000000-0000-4000-8000-0000000000a2";
const CAT = "00000000-0000-4000-8000-00000000ca01";
const F1 = "00000000-0000-4000-8000-0000000000f1";
const F2 = "00000000-0000-4000-8000-0000000000f2";
const T1 = "00000000-0000-4000-8000-0000000000b1";
const FORNS = [{ id: F1, nome_fantasia: "Oficina Um" }, { id: F2, nome_fantasia: "Oficina Dois" }];

const tent = (numero: number, o: Partial<TentativaPT> = {}): TentativaPT => ({ ...tentativaVirtual(numero), id: T1.slice(0, -2) + "0" + numero, rev: 1, ...o });
const trilha = (o: Partial<TrilhaPT> = {}): TrilhaPT => ({
  mo_linha_id: L1, categoria_id: CAT, categoria_nome: "PL", empresa_id: F1, empresa_nome: "Oficina Um", mo_aprovado: true, tentativas: [], ...o,
});
const estado = (...t: TrilhaPT[]): EstadoPT => ({ trilhas: t, outros: [] });

type Props = Parameters<typeof PecaTesteSecao>[0];
function render(over: Partial<Props> & { estado: EstadoPT | null }): string {
  const noop = () => {};
  const props: Props = {
    numero: 12, selo: undefined, base: over.estado, fornecedores: FORNS,
    onEditarAtual: noop, onAprovar: noop, onDesfazer: noop, onReprovar: noop, onTrocarFornecedor: noop,
    ...over,
  };
  return renderToStaticMarkup(createElement(PecaTesteSecao, props));
}
/** A tag <button …> do campo (Select/DateField) cujo `data-colab-path` é `pt:<linha>:<campo>` — atributos em qualquer ordem. */
function tagDoCampo(html: string, linha: string, campo: string): string {
  const m = new RegExp(`<(?:button|input)[^>]*data-colab-path="pt:${linha}:${campo}"[^>]*>`).exec(html);
  if (!m) throw new Error(`campo ${campo} não encontrado`);
  return m[0];
}
const desabilitado = (tag: string) => /\sdisabled(=|\s|>)/.test(tag);

describe("PecaTesteSecao — resumo, requisito e cabeçalho da trilha", () => {
  it("resumo 'N de M serviços com peça teste aprovada' + 'Necessária para enviar à Explosão' + banner de falta com o motivo", () => {
    const e = estado(
      trilha({ mo_linha_id: L1, categoria_nome: "PL", tentativas: [tent(1, { aprovacao: "aprovado", empresa_id: F1, data_saida: "2026-09-22", data_entrada: "2026-09-29" })] }),
      trilha({ mo_linha_id: L2, categoria_nome: "Bordado", mo_aprovado: null }),
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

  it("cabeçalho: serviço · 'M.O.: <fornecedor>' · selo âmbar 'M.O. pendente'/'M.O. reprovada' · selo de status", () => {
    const pend = render({ estado: estado(trilha({ mo_aprovado: null })) });
    expect(pend).toContain("M.O.: Oficina Um");
    expect(pend).toContain("M.O. pendente");
    expect(pend).toContain("Aguardando saída");
    expect(render({ estado: estado(trilha({ mo_aprovado: false })) })).toContain("M.O. reprovada");
    expect(render({ estado: estado(trilha({ mo_aprovado: true })) })).not.toContain("M.O. pendente");
    const emTeste = render({ estado: estado(trilha({ tentativas: [tent(1, { data_saida: "2026-09-22" })] })) });
    expect(emTeste).toContain("Em teste");
    const rep = render({ estado: estado(trilha({ tentativas: [tent(1, { aprovacao: "reprovado", data_saida: "2026-09-08", data_entrada: "2026-09-15", empresa_id: F1, empresa_nome: "Oficina Um" })] })) });
    expect(rep).toContain("Reprovada — nova tentativa");
    expect(rep).toContain("Tentativa 2 (atual)");
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
    expect(desabilitado(tagDoCampo(html, L1, "aprovacao"))).toBe(true);
    expect(html).toContain("Preencha a Data de saída e a Data de entrada para decidir.");
    // com as 2 datas e o fornecedor salvo: habilitada, sem dica
    const ok = render({ estado: estado(trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29" })] })) });
    expect(desabilitado(tagDoCampo(ok, L1, "aprovacao"))).toBe(false);
    expect(ok).not.toContain("Preencha a Data de saída");
  });

  it("linha SEM fornecedor salvo: Aprovação desabilitada com a dica 'Defina o fornecedor da M.O. antes.'", () => {
    const t = trilha({ empresa_id: null, empresa_nome: null, tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29" })] });
    const html = render({ estado: estado(t) });
    expect(desabilitado(tagDoCampo(html, L1, "aprovacao"))).toBe(true);
    expect(html).toContain("Defina o fornecedor da M.O. antes.");
    // fornecedor escolhido no rascunho mas ainda não salvo: pede salvar antes
    const rasc = render({ estado: estado({ ...t, empresa_id: F2, empresa_nome: "Oficina Dois" }), base: estado(t) });
    expect(rasc).toContain("Salve o card com o fornecedor antes de decidir.");
  });

  it("Peça aprovada trava fornecedor e datas (cadeado + 'Peça aprovada: fornecedor travado.'); a Aprovação continua aberta para desfazer", () => {
    const aprovada = trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29", aprovacao: "aprovado", empresa_id: F1 })] });
    const html = render({ estado: estado(aprovada) });
    expect(TEXTO_FORNECEDOR_TRAVADO).toBe("Peça aprovada: fornecedor travado.");
    expect(html).toContain("Peça aprovada: fornecedor travado.");
    expect(html).toContain('data-testid="peca-teste-forn-travado"');
    expect(desabilitado(tagDoCampo(html, L1, "fornecedor"))).toBe(true);
    expect(desabilitado(tagDoCampo(html, L1, "data_saida"))).toBe(true);
    expect(desabilitado(tagDoCampo(html, L1, "data_entrada"))).toBe(true);
    expect(desabilitado(tagDoCampo(html, L1, "aprovacao"))).toBe(false);
    expect(html).toContain("Aprovada");
  });

  it("aviso âmbar quando o fornecedor foi trocado: reabre a M.O. se a linha está decidida; senão só avisa que troca na mão de obra", () => {
    const base = estado(trilha({ mo_aprovado: true }));
    const trocado = estado(trilha({ mo_aprovado: true, empresa_id: F2, empresa_nome: "Oficina Dois" }));
    const html = render({ estado: trocado, base });
    expect(html).toContain(TEXTO_TROCA_FORNECEDOR_REABRE);
    expect(html).toContain("ela volta para pendente e precisa de nova aprovação.");
    // M.O. ainda pendente na base: sem a parte "volta para pendente"
    const basePend = estado(trilha({ mo_aprovado: null }));
    const htmlPend = render({ estado: estado(trilha({ mo_aprovado: null, empresa_id: F2, empresa_nome: "Oficina Dois" })), base: basePend });
    expect(htmlPend).toContain(TEXTO_TROCA_FORNECEDOR);
    expect(htmlPend).not.toContain("volta para pendente");
    // sem troca: sem aviso
    expect(render({ estado: base, base })).not.toContain("Trocar o fornecedor aqui troca também");
    // aprovar junto da troca não vale (o servidor recusa): "Aprovado" desabilitado + dica
    const dec = estado(trilha({ empresa_id: F2, empresa_nome: "Oficina Dois", tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29" })] }));
    const htmlDec = render({ estado: dec, base: estado(trilha({ tentativas: [tent(1, { data_saida: "2026-09-22", data_entrada: "2026-09-29" })] })) });
    expect(htmlDec).toContain("Salve a troca de fornecedor antes de aprovar.");
  });

  it("dica âmbar NÃO bloqueante quando a entrada é anterior à saída (Ruling 24)", () => {
    const html = render({ estado: estado(trilha({ tentativas: [tent(1, { data_saida: "2026-09-29", data_entrada: "2026-09-22" })] })) });
    expect(html).toContain('data-testid="peca-teste-dica-datas"');
    expect(desabilitado(tagDoCampo(html, L1, "aprovacao"))).toBe(false);
  });

  it("data-colab-path nos 4 campos de cada trilha (anel de presença): pt:<mo_linha_id>:<campo>", () => {
    const html = render({ estado: estado(trilha({ mo_linha_id: L1 }), trilha({ mo_linha_id: L2, categoria_nome: "Bordado" })) });
    for (const l of [L1, L2]) for (const c of ["fornecedor", "data_saida", "data_entrada", "aprovacao"]) {
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

  it("'Tentativas anteriores (N)': só leitura, com fornecedor congelado, as 2 datas e o selo Reprovado", () => {
    const e = estado(trilha({ tentativas: [reprovada, tent(2, { data_saida: "2026-09-22" })] }));
    expect(render({ estado: e })).toContain("Tentativas anteriores (1)");
    const html = render({ estado: e, historicoAberto: true });
    const m = /<ul[^>]*data-testid="peca-teste-historico"[^>]*>([\s\S]*?)<\/ul>/.exec(html);
    expect(m).not.toBeNull();
    const lista = m![1];
    expect(lista).toContain("Tentativa 1");
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

  it("linha cujo TIPO mudou no rascunho: a trilha antiga vira aviso até salvar", () => {
    const html = render({ estado: estado(trilha()), bloqueadasPorTipo: new Set([L1]) });
    expect(html).toContain("Salve o card para atualizar a peça teste de PL.");
    expect(html).not.toContain('data-trilha="');
  });

  it("rodapé 'não aparece aqui' lista serviço + fornecedor (nunca valor) dos que não exigem peça teste", () => {
    const e: EstadoPT = { trilhas: [trilha()], outros: [{ categoria_nome: "Lavanderia", empresa_nome: "Lava Tudo" }] };
    const html = render({ estado: e });
    expect(html).toContain("Lavanderia");
    expect(html).toContain("(Lava Tudo)");
    expect(html).toContain("não aparece aqui: o tipo de serviço não exige peça teste (Cadastro › Atributos › Categoria do Serviço).");
    expect(html).not.toMatch(/R\$/);
  });

  it("conflito de seção inline com 'manter meu' / 'usar o novo' e rótulo legível", () => {
    const html = render({
      estado: estado(trilha()),
      conflitos: [{ path: `pt:${L1}:data_entrada`, meu: "29/09/2026", dele: "02/10/2026" }],
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
    for (const c of ["fornecedor", "data_saida", "data_entrada", "aprovacao"]) expect(desabilitado(tagDoCampo(html, L1, c)), c).toBe(true);
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
    expect(desabilitado(tagDoCampo(nova, L1, "aprovacao"))).toBe(true);
    expect(nova).toContain("Salve as datas antes de decidir.");
    // virtual (sem nada) também: a dica é a das datas
    // gravada (id) com só a saída + entrada preenchida no rascunho: habilitada
    const gravada = render({ estado: estado(trilha({ tentativas: [tent(1, { data_saida: "2026-10-01", data_entrada: "2026-10-03" })] })) });
    expect(desabilitado(tagDoCampo(gravada, L1, "aprovacao"))).toBe(false);
    // a seguinte a uma reprovada é virtual de novo: mesma regra
    const rep = tent(1, { aprovacao: "reprovado", data_saida: "2026-09-08", data_entrada: "2026-09-15", empresa_id: F1 });
    const prox = render({ estado: estado(trilha({ tentativas: [rep, { ...tentativaVirtual(2), data_saida: "2026-10-01", data_entrada: "2026-10-03" }] })) });
    expect(desabilitado(tagDoCampo(prox, L1, "aprovacao"))).toBe(true);
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

  it("fornecedor único: o editor da M.O. recebe as linhas travadas e a troca na seção também troca na M.O. (quando editável)", () => {
    expect(FONTE_SHEET).toMatch(/fornecedorTravado=\{fornecedorTravadoMO\}/);
    expect(FONTE_SHEET).toMatch(/const espelharFornecedorNaMO[\s\S]*?if \(!\(moBlocoVisivel && podeEditarMO\)\) return;[\s\S]*?setMoLinhas/);
    expect(FONTE_SHEET).toMatch(/fornecedorMo/);
  });

  it("achado 5 — erro de leitura NÃO esconde a seção; achado 4 — o editor da M.O. também escreve no rascunho da seção", () => {
    expect(FONTE_SHEET).toMatch(/ptLinhasNovas\.length > 0 \|\| pt\.erro/);
    expect(FONTE_SHEET).toMatch(/onChangeLinhas=\{aoMudarLinhasMO\}/);
    expect(FONTE_SHEET).toMatch(/const aoMudarLinhasMO[\s\S]*?pt\.trocarFornecedor\(l\.id[\s\S]*?setMoLinhas\(ls\)/);
    expect(FONTE_SHEET).toMatch(/linhasIgnoradas: ptBloqueadasPorTipo/);
  });

  it("a lista de tipos de serviço lê exige_peca_teste (para 'Salve o card para lançar…')", () => {
    expect(FONTE_SHEET).toMatch(/\.select\("id, nome, ativo, valor_padrao, exige_peca_teste"\)/);
  });

  it("MaoObraEditor: prop fornecedorTravado desabilita o Select do fornecedor da linha com a dica", () => {
    const mo = ler("src/components/planejamento/MaoObraEditor.tsx");
    expect(mo).toMatch(/fornecedorTravado\?: ReadonlySet<string>/);
    expect(mo).toContain("Peça teste aprovada: fornecedor travado");
    expect(mo).toMatch(/disabled=\{linhaId != null && !!fornecedorTravado\?\.has\(linhaId\)\}/);
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
