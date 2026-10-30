// R9 (Peça Teste, T7) — o quadro PCP › Etapas lê a coluna "Peça Teste" do CARD do produto (RPC `peca_teste_quadro`), o painel
// "Etapas PL" sai do PCP › Serviços e as colunas `pt_*` de `producao_terceirizados` viram só pass-through (ninguém as lê nem as edita).
// Regra do quadro (Ruling 20): 1 card PT por produto (chave `pt:<modeloId>`); "PL" = `isServicoPL`; em teste aparece antes/depois da
// Explosão; aprovada (TODAS as trilhas PL) só até a Explosão; reprovada sai (o servidor não manda); lançado fora; etapa desativada = sem card.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { montarCards, montarCardsPecaTeste, type PecaTesteQuadroItem } from "@/lib/pcp-etapas-kanban";
import { etapaDoBloco, ETAPAS_DEFAULT, type BlocoEtapa } from "@/lib/pcp-etapas";
import { blocoDeLinha, blocoParaPayload, montarPayloadEdicaoRapida, type CampoRapido } from "@/lib/servicos-payload";
import { abertoPorCima, rotuloTelaBreadcrumb } from "@/components/planejamento/planejamento-detail/contexto";

const ler = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

type Trilha = NonNullable<PecaTesteQuadroItem["trilhas"]>[number];
const trilha = (over: Partial<Trilha> = {}): Trilha => ({
  categoria_nome: "PL", empresa_nome: "Bela Vista", status: "em_teste", data_saida: "2026-10-05", ...over,
});
const item = (over: Partial<PecaTesteQuadroItem> = {}): PecaTesteQuadroItem => ({
  modelo_id: "m1", ref: "FEVLO-1", nome: "Vestido", origem: "interno", colecao: "Verão",
  fotos_fontes: ["f.jpg", null, null], explodido: false, trilhas: [trilha()], ...over,
});

// Modelo com bloco PL já explodido (cad enviado ao corte) — o que `montarCards` recebe de `modelos`.
const modelo = (over: Record<string, unknown> = {}) => ({
  id: "m1", ref: "FEVLO-1", nome: "Vestido", fotos_modelo: ["f.jpg"], desenho_tecnico_url: null, croqui_url: null,
  cad: [{ id: "c1", enviado_corte: true, producao_terceirizados: [
    { id: "b1", ativo: true, interno: false, categoria_terceirizado_id: "cat_pl", categorias_terceirizado: { nome: "PL" },
      empresa: { nome_fantasia: "Bela Vista" }, data_enviado: null, data_entregue: null, quantidade_recebida: null, grade_detalhe: null },
  ] }], ...over,
});

describe("montarCardsPecaTeste — a coluna Peça Teste vem do card do produto", () => {
  it("em teste ANTES da Explosão (sem CAD) → 1 card PT com a menor Data de saída", () => {
    const cards = montarCardsPecaTeste([item({ explodido: false, trilhas: [trilha({ data_saida: "2026-10-09" }), trilha({ categoria_nome: "PL", empresa_nome: "Outra", data_saida: "2026-10-05" })] })], ETAPAS_DEFAULT);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      tipo: "peca_teste", blocoId: "pt:m1", modeloId: "m1", ref: "FEVLO-1", nome: "Vestido", origem: "interno", etapa: "peca_teste",
      empresa: "Bela Vista", pecaTeste: { status: "em_teste", dataSaida: "2026-10-05" },
    });
    expect(cards[0].pecaTeste!.servicos).toEqual(["PL · Bela Vista", "PL · Outra"]);
    expect(cards[0].fotoFontes).toEqual(["f.jpg", null, null]);
  });
  it("aprovada SEM Explosão → card PT com status aprovada (selo \"Aprovada — aguardando Explosão\")", () => {
    const cards = montarCardsPecaTeste([item({ explodido: false, trilhas: [trilha({ status: "aprovada" })] })], ETAPAS_DEFAULT);
    expect(cards).toHaveLength(1);
    expect(cards[0].pecaTeste).toMatchObject({ status: "aprovada", dataSaida: null });
  });
  it("aprovada e JÁ explodida → sem card PT; os blocos do produto vão para Separação de Materiais", () => {
    const it1 = item({ explodido: true, trilhas: [trilha({ status: "aprovada" })] });
    expect(montarCardsPecaTeste([it1], ETAPAS_DEFAULT)).toHaveLength(0);
    const blocos = montarCards([modelo() as any], ETAPAS_DEFAULT, new Set());
    expect(blocos).toHaveLength(1);
    expect(blocos[0]).toMatchObject({ tipo: "bloco", blocoId: "b1", etapa: "separacao" });
  });
  it("em teste E explodido → só o card PT (o bloco do mesmo produto não duplica)", () => {
    const pt = montarCardsPecaTeste([item({ explodido: true })], ETAPAS_DEFAULT);
    expect(pt).toHaveLength(1);
    const suprimir = new Set(pt.filter((c) => c.pecaTeste!.status === "em_teste").map((c) => c.modeloId));
    expect(montarCards([modelo() as any], ETAPAS_DEFAULT, suprimir)).toHaveLength(0);
    // outro produto não é afetado
    expect(montarCards([modelo({ id: "m2" }) as any], ETAPAS_DEFAULT, suprimir)).toHaveLength(1);
  });
  it("reprovada (o servidor não manda item) → nada; item só com trilha pendente → nada", () => {
    expect(montarCardsPecaTeste([], ETAPAS_DEFAULT)).toEqual([]);
    expect(montarCardsPecaTeste([item({ trilhas: [trilha({ status: "pendente", data_saida: null })] })], ETAPAS_DEFAULT)).toEqual([]);
    expect(montarCardsPecaTeste([item({ trilhas: [] })], ETAPAS_DEFAULT)).toEqual([]);
    expect(montarCardsPecaTeste([item({ trilhas: null })], ETAPAS_DEFAULT)).toEqual([]);
  });
  it("2 trilhas PL (uma aprovada, outra em teste) → \"em teste\"", () => {
    const cards = montarCardsPecaTeste([item({ trilhas: [
      trilha({ status: "aprovada", empresa_nome: "A", data_saida: "2026-10-01" }),
      trilha({ status: "em_teste", empresa_nome: "B", data_saida: "2026-10-07" }),
    ] })], ETAPAS_DEFAULT);
    expect(cards[0].pecaTeste).toMatchObject({ status: "em_teste", dataSaida: "2026-10-07" });
    expect(cards[0].empresa).toBe("B");
    expect(cards[0].pecaTeste!.servicos).toEqual(["PL · B"]); // só as que estão em teste
  });
  it("2 trilhas PL: uma aprovada e outra PENDENTE (sem saída) → ainda não é \"aprovada\" (Ruling 20: todas) → sem card", () => {
    expect(montarCardsPecaTeste([item({ trilhas: [
      trilha({ status: "aprovada" }), trilha({ status: "pendente", data_saida: null }),
    ] })], ETAPAS_DEFAULT)).toEqual([]);
  });
  it("2 trilhas PL aprovadas (todas) → card aprovada", () => {
    const cards = montarCardsPecaTeste([item({ trilhas: [trilha({ status: "aprovada" }), trilha({ status: "aprovada", empresa_nome: "B" })] })], ETAPAS_DEFAULT);
    expect(cards[0].pecaTeste!.status).toBe("aprovada");
    expect(cards[0].pecaTeste!.servicos).toEqual(["PL · Bela Vista", "PL · B"]);
  });
  it("serviço NÃO-PL é ignorado (não conta nem para em teste nem para \"todas aprovadas\")", () => {
    // só trilha não-PL em teste → nada
    expect(montarCardsPecaTeste([item({ trilhas: [trilha({ categoria_nome: "Lavanderia" })] })], ETAPAS_DEFAULT)).toEqual([]);
    // PL aprovada + Lavanderia pendente → "todas as PL aprovadas" = card aprovada
    const cards = montarCardsPecaTeste([item({ trilhas: [trilha({ status: "aprovada" }), trilha({ categoria_nome: "Lavanderia", status: "pendente", data_saida: null })] })], ETAPAS_DEFAULT);
    expect(cards).toHaveLength(1);
    expect(cards[0].pecaTeste!.status).toBe("aprovada");
    // PL pendente + Lavanderia em teste → nada (o em teste não é PL)
    expect(montarCardsPecaTeste([item({ trilhas: [trilha({ status: "pendente", data_saida: null }), trilha({ categoria_nome: "Lavanderia" })] })], ETAPAS_DEFAULT)).toEqual([]);
  });
  it("\"Private Label\" também é PL (mesmo critério do isServicoPL)", () => {
    expect(montarCardsPecaTeste([item({ trilhas: [trilha({ categoria_nome: "Private Label" })] })], ETAPAS_DEFAULT)).toHaveLength(1);
  });
  it("etapa peca_teste DESATIVADA na config → sem card PT", () => {
    const etapas = ETAPAS_DEFAULT.map((e) => (e.key === "peca_teste" ? { ...e, ativa: false } : e));
    expect(montarCardsPecaTeste([item()], etapas)).toEqual([]);
  });
  it("lançado → nada (defesa: o servidor já exclui)", () => {
    expect(montarCardsPecaTeste([item({ lancado: true })], ETAPAS_DEFAULT)).toEqual([]);
  });
  it("sem empresa na trilha → o serviço aparece só pelo nome e `empresa` fica null", () => {
    const cards = montarCardsPecaTeste([item({ trilhas: [trilha({ empresa_nome: null })] })], ETAPAS_DEFAULT);
    expect(cards[0].empresa).toBeNull();
    expect(cards[0].pecaTeste!.servicos).toEqual(["PL"]);
  });
  it("vários produtos: 1 card por produto, com chave única pt:<modeloId>", () => {
    const cards = montarCardsPecaTeste([item(), item({ modelo_id: "m2", ref: "X-2" })], ETAPAS_DEFAULT);
    expect(cards.map((c) => c.blocoId)).toEqual(["pt:m1", "pt:m2"]);
  });
});

describe("blocos — a etapa Peça Teste é alimentada pelo card; pt_* são IGNORADAS", () => {
  const base: BlocoEtapa = { data_enviado: null, data_entregue: null, qtd_recebida: null, grade_detalhe: null };
  it("bloco sem nada começa em Separação de Materiais (Peça Teste conta como cumprida)", () => {
    expect(etapaDoBloco(base, ETAPAS_DEFAULT)).toEqual({ key: "separacao", reprovada: false });
  });
  it("pt_* no bloco não mudam nada — nem o legado 'reprovado' tira o bloco do quadro", () => {
    const legado = { ...base, pt_data_saida: "2026-07-20", pt_data_entrada: "2026-07-27", pt_aprovacao: "reprovado" as const };
    expect(etapaDoBloco(legado, ETAPAS_DEFAULT)).toEqual({ key: "separacao", reprovada: false });
    const m = modelo(); (m as any).cad[0].producao_terceirizados[0].pt_aprovacao = "reprovado";
    const cards = montarCards([m as any], ETAPAS_DEFAULT);
    expect(cards).toHaveLength(1); // o bloco legado reprovado NÃO some mais
    expect(cards[0].etapa).toBe("separacao");
  });
  it("lançado: o bloco vai para a coluna terminal Finalizado, como antes", () => {
    expect(montarCards([modelo({ lancado: true }) as any], ETAPAS_DEFAULT)[0].etapa).toBe("__finalizado__");
  });
  it("bloco só depois de enviado_corte (como hoje)", () => {
    const m = modelo(); (m as any).cad[0].enviado_corte = false;
    expect(montarCards([m as any], ETAPAS_DEFAULT)).toHaveLength(0);
  });
  it("etapa Peça Teste desativada: o bloco também começa em Separação", () => {
    const etapas = ETAPAS_DEFAULT.map((e) => (e.key === "peca_teste" ? { ...e, ativa: false } : e));
    expect(etapaDoBloco(base, etapas).key).toBe("separacao");
  });
});

describe("edição rápida — nunca grava pt_*; o servidor fica intocado (pass-through)", () => {
  it("CampoRapido = só data_enviado (fonte + tipo)", () => {
    const src = ler("src/lib/servicos-payload.ts");
    expect(src).toMatch(/export type CampoRapido = "data_enviado";/);
    const c: CampoRapido = "data_enviado";
    expect(c).toBe("data_enviado");
    expect(src).not.toMatch(/CampoRapido =[^;]*pt_/);
  });
  it("blocoParaPayload(blocoDeLinha(linha)) preserva os pt_* LIDOS da linha (interno limpa, como sempre)", () => {
    const linha = {
      id: "b1", categoria_terceirizado_id: "c", interno: false, empresa_id: "e",
      pt_data_saida: "2026-09-25", pt_data_entrada: "2026-09-30", pt_aprovacao: "reprovado",
    };
    const p = blocoParaPayload(blocoDeLinha(linha));
    expect([p.pt_data_saida, p.pt_data_entrada, p.pt_aprovacao]).toEqual(["2026-09-25", "2026-09-30", "reprovado"]);
    const interno = blocoParaPayload(blocoDeLinha({ ...linha, interno: true }));
    expect([interno.pt_data_saida, interno.pt_data_entrada, interno.pt_aprovacao]).toEqual([null, null, null]);
  });
  it("a edição rápida de data_enviado manda os pt_* lidos de TODOS os blocos sem mexer neles", () => {
    const linhas = [
      { id: "a", rev: 1, ativo: true, interno: false, categoria_terceirizado_id: "c", pt_data_saida: "2026-09-25", pt_data_entrada: null, pt_aprovacao: null },
      { id: "b", rev: 2, ativo: true, interno: false, categoria_terceirizado_id: "c", pt_data_saida: "2026-09-20", pt_data_entrada: "2026-09-22", pt_aprovacao: "aprovado" },
    ];
    const { _blocos } = montarPayloadEdicaoRapida({ linhas, blocoId: "a", campo: "data_enviado", valor: "2026-10-07" });
    expect(_blocos[0]).toMatchObject({ data_enviado: "2026-10-07", pt_data_saida: "2026-09-25", pt_data_entrada: null, pt_aprovacao: null });
    expect(_blocos[1]).toMatchObject({ pt_data_saida: "2026-09-20", pt_data_entrada: "2026-09-22", pt_aprovacao: "aprovado" });
  });
  it("useSalvarEtapaRapida e o card não editam pt_* (fonte)", () => {
    const hook = ler("src/components/producao/etapas/useSalvarEtapaRapida.ts");
    const view = ler("src/components/producao/etapas/EtapaCardView.tsx");
    expect(hook).not.toMatch(/pt_data|pt_aprovacao/);
    expect(view).not.toMatch(/pt_data|pt_aprovacao|textoReprovarPecaTeste|useConfirmacao/);
  });
});

describe("telas — fonte", () => {
  it("PCP › Serviços NÃO importa nem renderiza EtapasPlPanel/ReprovadasPl; o filtro de reprovados saiu", () => {
    const src = ler("src/routes/_authenticated/pcp.servicos.$modeloId.tsx");
    expect(src).not.toMatch(/EtapasPlPanel|ReprovadasPl|reprovadosPl/);
    // Notas Fiscais e Peça de foto FICAM
    expect(src).toContain("Notas Fiscais");
    expect(src).toContain("Peça de foto");
    // o bloco legado reprovado volta à lista principal: nenhum filtro por pt_aprovacao
    expect(src).not.toMatch(/pt_aprovacao\s*===/);
  });
  it("os 2 arquivos do painel antigo ficam (faxina depois), marcados como ocultos", () => {
    for (const f of ["src/components/producao/EtapasPlPanel.tsx", "src/components/producao/ReprovadasPl.tsx"])
      expect(ler(f).split("\n").slice(0, 3).join("\n"), f).toContain("R9: oculto");
  });
  it("useEtapasCards: lê o RPC peca_teste_quadro (key com a loja), não seleciona pt_* e mantém os filtros nas 2 fontes", () => {
    const src = ler("src/components/producao/etapas/useEtapasCards.ts");
    expect(src).toContain('rpc("peca_teste_quadro"');
    expect(src).toContain('"etapas-peca-teste"');
    expect(src).not.toMatch(/pt_data|pt_aprovacao/);
    expect(src).toContain("montarCardsPecaTeste(");
    expect(src).toMatch(/montarCards\(\s*filtered,\s*etapas,\s*suprimir\s*\)/);
  });
  it("pcp.etapas abre o Sheet do Planejamento para o card PT (contexto pcp-etapas, só com acesso) e o de Serviços para os blocos", () => {
    const src = ler("src/routes/_authenticated/pcp.etapas.tsx");
    expect(src).toContain('contexto="pcp-etapas"');
    expect(src).toContain("<PlanejamentoDetail");
    expect(src).toContain('canView("criacao_planejamento")');
    expect(src).toContain('canView("criacao_desenvolvimento")');
    expect(src).toContain("<TerceirizadosDetail");
    expect(src).toContain('queryKey: ["etapas-peca-teste"]');
  });
  it("contexto pcp-etapas: aberto por cima; o breadcrumb segue \"Planejamento de Produto\"", () => {
    expect(abertoPorCima("pcp-etapas")).toBe(true);
    expect(rotuloTelaBreadcrumb("pcp-etapas")).toBe("Planejamento de Produto");
    expect(abertoPorCima("planejamento")).toBe(false);
  });
  it("Config da Loja › Etapas do PCP: 5 etapas e a nota na Peça Teste", () => {
    const src = ler("src/routes/_authenticated/admin/configuracoes.tsx");
    expect(src).toContain("vem do card do produto (seção Peça Teste)");
  });
  it("card PT: sem acesso não clica e explica", () => {
    const view = ler("src/components/producao/etapas/EtapaCardView.tsx");
    expect(view).toContain("Abra pelo Planejamento de Produto (sem acesso ao card)");
    expect(view).toContain("Aprovada — aguardando Explosão");
    expect(view).toContain('tone="success"');
  });
});
