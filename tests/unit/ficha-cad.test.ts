import { describe, it, expect } from "vitest";
import { calcCusto } from "@/components/producao/cad/types";
import { makeEmptyBlocks, type TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import {
  assinaturaCad, assinaturaCadServidor, atualizarLinhaCad, atualizarVarianteCad, cadDivergeDaReferencia, calcularFolhasAuto,
  deveGravarCad, faltasCad, hidratarCad, idsVariantesDosBlocos, linhasParaGravar, montarCadPayload, propagarBlocoParaCad,
  sincronizarCadComBlocos, snapshotCad, type CadRowDb, type CadTecidoRow,
} from "@/components/planejamento/planejamento-detail/ficha/ficha-cad";
import { deveHidratarCarga, type TecidoRowDb, type VarianteRowDb } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";

// F3.3 — trava as contas PORTADAS da seção "CAD" do Desenvolvimento (ModeloDetailPanel.tsx:1040-1386, :2062-2119,
// :2441-2456) + as melhorias locais do plano (§7 T3–T6) + a regra de quando o Salvar grava o CAD (§3 P2).
const A = "art-a", F = "art-forro";
const V1 = "v-a-1", V2 = "v-a-2", VF = "v-forro-1";
const artigoMap = {
  [A]: { nome: "Linho", preco_por_metro: 30, largura_estimada: 1.4 },
  [F]: { nome: "Viscose", preco_por_metro: 18, largura_estimada: 1.5 },
};
const ctx = { artigoMap, frozen: {} as Record<string, number> };

function bloco(tipo: TecidoBlock["tipo"], numero: number, patch: Partial<TecidoBlock> = {}): TecidoBlock {
  const base = makeEmptyBlocks().find((b) => b.tipo === tipo && b.numero === numero)!;
  return { ...base, ...patch };
}
function blocos(...bs: TecidoBlock[]): TecidoBlock[] {
  return makeEmptyBlocks().map((e) => bs.find((b) => b.tipo === e.tipo && b.numero === e.numero) ?? e);
}
const vars = (...ids: (string | null)[]) => [...ids, ...Array(10 - ids.length).fill(null)] as (string | null)[];

const bomT1: TecidoRowDb = { id: "mt1", tipo: "tecido", numero: 1, artigo_id: A, consumo: 1.85, loss_percent: 3, custo_previsto: 57.17 };
const bomF1: TecidoRowDb = { id: "mf1", tipo: "forro", numero: 1, artigo_id: F, consumo: 0.9, loss_percent: 2, custo_previsto: 16.52 };
const bomVars: VarianteRowDb[] = [
  { modelo_tecido_id: "mt1", variante_tecido_id: V1, ordem: 1, multiplicador: 1, complementa_variante_ids: null },
  { modelo_tecido_id: "mt1", variante_tecido_id: V2, ordem: 2, multiplicador: 1, complementa_variante_ids: null },
  { modelo_tecido_id: "mf1", variante_tecido_id: VF, ordem: 1, multiplicador: 1, complementa_variante_ids: [V1, V2] },
];
const cadServidor: CadRowDb = {
  id: "cad-1",
  cad_tecidos: [{
    id: "ct1", numero: 1, tipo: "tecido", artigo_id: A, consumo_cad: 1.85, loss_percent_cad: 3, custo_cad: 57.17, tamanho_folha: 1.2,
    artigos: { nome: "Linho", preco_por_metro: 30, unidade_medida: "metro", etiqueta_lavagem_urls: [], largura_estimada: 1.4 },
    cad_tecido_variantes: [{
      id: "cv1", variante_tecido_id: V1, ordem: 1, multiplicador: 1, quantidade_folhas: 4, metragem_planejada: 45.73,
      metragem_enviada: 0, complementa_variante_ids: null,
      variantes_tecido: { nome_variante: "Areia", codigo_variante: "AR", cor: { nome: "Bege" }, apelido: null },
    }],
  }],
};
const hidratadoComCad = () => hidratarCad({ cad: cadServidor, bomTecidos: [bomT1, bomF1], bomVariantes: bomVars, artigoMap, frozen: {} });

describe("hidratarCad — carga (Dev :1040-1174)", () => {
  it("sem CAD: semeia do BOM, folhas/metragem zeradas, Tecido antes do Forro", () => {
    const out = hidratarCad({ cad: null, bomTecidos: [bomF1, bomT1], bomVariantes: bomVars, artigoMap, frozen: {} });
    expect(out.map((t) => `${t.tipo}${t.numero}`)).toEqual(["tecido1", "forro1"]);
    const t1 = out[0];
    expect(t1.id).toBeUndefined();
    expect(t1).toMatchObject({ artigo_id: A, consumo_cad: 1.85, loss_percent_cad: 3, tamanho_folha: 0, preco: 30, largura: 1.4, artigo_nome: "Linho" });
    expect(t1.custo_cad).toBe(calcCusto(1.85, 3, 30));
    expect(t1.variantes.map((v) => [v.variante_tecido_id, v.ordem, v.quantidade_folhas, v.metragem_planejada])).toEqual([[V1, 1, 0, 0], [V2, 2, 0, 0]]);
    expect(out[1].variantes[0].complementa_variante_ids).toEqual([V1, V2]);
  });
  it("com CAD: do servidor (valores e rótulos) + mescla a variante e o bloco do BOM que o CAD ainda não tem", () => {
    const out = hidratadoComCad();
    expect(out.map((t) => `${t.tipo}${t.numero}:${t.id ?? "-"}`)).toEqual(["tecido1:ct1", "forro1:-"]);
    const t1 = out[0];
    expect(t1.tamanho_folha).toBe(1.2);
    expect(t1.artigo_nome).toBe("Linho [metro]");
    expect(t1.variantes.map((v) => [v.variante_tecido_id, v.quantidade_folhas, v.variante_nome, v.variante_cor])).toEqual([
      [V1, 4, "Areia", "Bege"], [V2, 0, null, null],
    ]);
  });
  it("preço congelado pela OC vinculada (tipo|numero) vence o do artigo", () => {
    const out = hidratarCad({ cad: cadServidor, bomTecidos: [bomT1], bomVariantes: bomVars, artigoMap, frozen: { "tecido|1": 25 } });
    expect(out[0].preco).toBe(25);
  });
});

describe("sincronizarCadComBlocos — BOM → CAD (Dev :1314-1386 + T4)", () => {
  it("variantes seguem o bloco: remove a que saiu, mantém o digitado, leva multiplicador e casamento", () => {
    const b = blocos(
      bloco("tecido", 1, { artigo_id: A, variantes: vars(V1) }),
      bloco("forro", 1, { artigo_id: F, variantes: vars(VF), multiplicadores: [2, ...Array(9).fill(1)], complementas: [[V1], ...Array(9).fill(null)] }),
    );
    const out = sincronizarCadComBlocos(hidratadoComCad(), b, {}, ctx);
    expect(out[0].variantes.map((v) => [v.variante_tecido_id, v.quantidade_folhas])).toEqual([[V1, 4]]);
    expect(out[1].variantes[0]).toMatchObject({ variante_tecido_id: VF, multiplicador: 2, complementa_variante_ids: [V1] });
  });
  it("nada mudou ⇒ devolve a MESMA referência (sem laço de efeito)", () => {
    const b = blocos(bloco("tecido", 1, { artigo_id: A, variantes: vars(V1, V2) }), bloco("forro", 1, { artigo_id: F, variantes: vars(VF), complementas: [[V1, V2], ...Array(9).fill(null)] }));
    const uma = sincronizarCadComBlocos(hidratadoComCad(), b, {}, ctx);
    expect(sincronizarCadComBlocos(uma, b, {}, ctx)).toBe(uma);
  });
  it("variante nova entra zerada e já com o rótulo", () => {
    const b = blocos(bloco("tecido", 1, { artigo_id: A, variantes: vars(V1, V2) }), bloco("forro", 1, { artigo_id: F, variantes: vars(VF), complementas: [[V1, V2], ...Array(9).fill(null)] }));
    const out = sincronizarCadComBlocos(hidratadoComCad(), b, { [V2]: { nome: "Oliva", cor: "Verde", apelido: null } }, ctx);
    expect(out[0].variantes[1]).toMatchObject({ variante_tecido_id: V2, variante_nome: "Oliva", quantidade_folhas: 0, metragem_planejada: 0 });
  });
  it("T4: bloco com artigo sem linha no CAD ganha a linha (sem id); linha SEM id sai quando o bloco perde o artigo; linha do servidor fica", () => {
    const b = blocos(
      bloco("tecido", 1, { artigo_id: null, variantes: vars() }),
      bloco("tecido", 2, { artigo_id: A, consumo: 1.1, loss_percent: 0, variantes: vars(V1) }),
      bloco("forro", 1, { artigo_id: null, variantes: vars() }),
    );
    const out = sincronizarCadComBlocos(hidratadoComCad(), b, {}, ctx);
    expect(out.map((t) => `${t.tipo}${t.numero}:${t.id ?? "-"}`)).toEqual(["tecido1:ct1", "tecido2:-"]);
    expect(out[0].variantes).toEqual([]);
    expect(out[1]).toMatchObject({ artigo_id: A, consumo_cad: 1.1, preco: 30, largura: 1.4, artigo_nome: "Linho" });
  });
});

describe("propagarBlocoParaCad — Dev :2441-2456 (+ artigo, T4)", () => {
  it("consumo/%loss do bloco vão para a linha do mesmo tipo+número, com o custo recalculado", () => {
    const out = propagarBlocoParaCad(hidratadoComCad(), "tecido", 1, { consumo: 2 }, ctx);
    expect(out[0].consumo_cad).toBe(2);
    expect(out[0].custo_cad).toBe(calcCusto(2, 3, 30));
    expect(out[1].consumo_cad).toBe(0.9);
  });
  it("trocar o artigo do bloco leva artigo, preço, largura e nome à linha", () => {
    const out = propagarBlocoParaCad(hidratadoComCad(), "tecido", 1, { artigo_id: F }, ctx);
    expect(out[0]).toMatchObject({ artigo_id: F, preco: 18, largura: 1.5, artigo_nome: "Viscose" });
    expect(out[0].custo_cad).toBe(calcCusto(1.85, 3, 18));
  });
  it("mesmo valor ⇒ mesma referência", () => {
    const linhas = hidratadoComCad();
    expect(propagarBlocoParaCad(linhas, "tecido", 1, { consumo: 1.85, loss_percent: 3, artigo_id: A }, ctx)).toBe(linhas);
  });
});

describe("edição direta na seção CAD (Dev :1176-1220)", () => {
  it("atualizarLinhaCad recalcula o custo", () => {
    const out = atualizarLinhaCad(hidratadoComCad(), 0, { consumo_cad: 1 });
    expect(out[0].custo_cad).toBe(calcCusto(1, 3, 30));
  });
  it("atualizarVarianteCad muda só a variante apontada", () => {
    const out = atualizarVarianteCad(hidratadoComCad(), 0, 0, { quantidade_folhas: 9 });
    expect(out[0].variantes.map((v) => v.quantidade_folhas)).toEqual([9, 0]);
  });
});

describe("calcularFolhasAuto — Dev :1222-1269 (grade × proporção × consumo × largura; casamento)", () => {
  const linhas = hidratarCad({ cad: null, bomTecidos: [bomT1, bomF1], bomVariantes: bomVars, artigoMap, frozen: {} });
  const grades = [{ variante_numero: 1, grades: {}, grade_total: 24 }, { variante_numero: 2, grades: {}, grade_total: 12 }];
  const prop = { P: 1, M: 2, G: 2, GG: 1 };
  it("Tecido 1: folhas = peças ÷ Σproporção; metragem = peças × consumo × (1+loss); folha = base ÷ folhas ÷ largura", () => {
    const [t1] = calcularFolhasAuto(linhas, grades, prop);
    expect(t1.variantes.map((v) => v.quantidade_folhas)).toEqual([4, 2]);
    expect(t1.variantes[0].metragem_planejada).toBeCloseTo(45.73, 2);
    expect(t1.variantes[1].metragem_planejada).toBeCloseTo(22.87, 2);
    expect(t1.tamanho_folha).toBeCloseTo(7.93, 2);
  });
  it("Forro casado com as 2 cores do Tecido 1 consome a Σ das grades delas", () => {
    const [, f1] = calcularFolhasAuto(linhas, grades, prop);
    expect(f1.variantes[0].quantidade_folhas).toBe(6);
    expect(f1.variantes[0].metragem_planejada).toBeCloseTo(33.05, 2);
    expect(f1.tamanho_folha).toBeCloseTo(3.6, 2);
  });
  it("idempotente ⇒ mesma referência na 2ª passada", () => {
    const uma = calcularFolhasAuto(linhas, grades, prop);
    expect(calcularFolhasAuto(uma, grades, prop)).toBe(uma);
  });
});

describe("faltasCad — Dev :1280-1295", () => {
  it("lista consumo / largura / metragem planejada que faltam; vazio sem linha", () => {
    expect(faltasCad([])).toEqual([]);
    const semLargura = { ...hidratadoComCad()[0], largura: 0 };
    expect(faltasCad([semLargura])).toEqual(["largura do tecido", "metragem planejada"]);
  });
});

describe("montarCadPayload — Dev :2062-2119", () => {
  const estado = hidratadoComCad();
  const p = montarCadPayload({
    cad: estado,
    grades: [{ variante_numero: 1, grades: { P: 4, M: 8, G: 8, GG: 4 }, grade_total: 24 }, { variante_numero: 2, grades: {}, grade_total: 0 }],
    aviamentos: [
      { aviamento_id: "av1", variante_aviamento_id: null, consumo: 2, loss_percent: 0, custo_previsto: 0 },
      { aviamento_id: null, variante_aviamento_id: null, consumo: 9, loss_percent: 0, custo_previsto: 0 },
    ],
    etiquetas: [
      { etiqueta_id: "e1", cor_id: null, consumo: 1, loss_percent: 0, custo_previsto: 0 },
      { etiqueta_id: null, cor_id: null, consumo: 5, loss_percent: 0, custo_previsto: 0 },
    ],
    proporcoes: { P: 1, M: 2, G: 2, GG: 1 },
  });
  it("grade só com valor; aviamentos/etiquetas = consumo × grade total geral; obs. do molde e envio por tamanho zerados (paridade)", () => {
    expect(p._grades.map((g) => g.variante_numero)).toEqual([1]);
    expect(p._aviamentos).toEqual([{ aviamento_id: "av1", variante_aviamento_id: null, numero: 1, consumo: 2, quantidade_enviar: 48, quantidade_separar: 48 }]);
    expect(p._etiquetas).toEqual([{ etiqueta_id: "e1", cor_id: null, consumo: 1, quantidade_planejada: 24, quantidade_enviar: 24, enviar_por_tamanho: {} }]);
    expect(p._observacoes_molde).toBeNull();
    expect(p._data_previsao_corte).toBeNull();
    expect(p._proporcoes).toEqual({ P: 1, M: 2, G: 2, GG: 1 });
  });
  it("tecidos levam consumo/%loss/folha e as variantes (ordem, multiplicador, folhas, metragens)", () => {
    expect(p._tecidos[0]).toMatchObject({ artigo_id: A, numero: 1, tipo: "tecido", consumo_cad: 1.85, loss_percent_cad: 3, tamanho_folha: 1.2 });
    expect(p._tecidos[0].variantes[0]).toEqual({ variante_tecido_id: V1, ordem: 1, multiplicador: 1, quantidade_folhas: 4, metragem_planejada: 45.73, metragem_enviada: 0 });
  });
});

describe("linhasParaGravar — linha que o servidor não tem só vai quando o BOM também grava", () => {
  const nova: CadTecidoRow = { ...hidratadoComCad()[0], id: undefined, tipo: "tecido", numero: 2 };
  const linhas = [...hidratadoComCad(), nova];
  const servidor = new Set(["tecido|1", "forro|1"]);
  it("BOM não grava ⇒ só linhas com id ou que o BOM do servidor tem", () => {
    expect(linhasParaGravar(linhas, { bomGravado: false, chavesBomServidor: servidor }).map((t) => `${t.tipo}${t.numero}`)).toEqual(["tecido1", "forro1"]);
  });
  it("BOM grava ⇒ todas", () => {
    expect(linhasParaGravar(linhas, { bomGravado: true, chavesBomServidor: servidor })).toHaveLength(3);
  });
});

describe("snapshot e assinatura do CAD", () => {
  const base = hidratadoComCad();
  it("snapshot ignora rótulos/preço/custo e muda com a folha", () => {
    const rotulo = base.map((t) => ({ ...t, artigo_nome: "outro", preco: 99, custo_cad: 1, variantes: t.variantes.map((v) => ({ ...v, variante_nome: "x" })) }));
    expect(snapshotCad(rotulo)).toBe(snapshotCad(base));
    expect(snapshotCad(atualizarVarianteCad(base, 0, 0, { quantidade_folhas: 5 }))).not.toBe(snapshotCad(base));
  });
  it("assinatura: só o que é DO CAD e ≠ 0 (consumo é do BOM; linha zerada = ausente)", () => {
    const semZeros = base.map((t) => ({ ...t, variantes: t.variantes.filter((v) => v.quantidade_folhas > 0) }));
    expect(assinaturaCad(semZeros)).toBe(assinaturaCad(base));
    expect(assinaturaCad(propagarBlocoParaCad(base, "tecido", 1, { consumo: 3 }, ctx))).toBe(assinaturaCad(base));
    expect(assinaturaCad([...base].reverse())).toBe(assinaturaCad(base));
    expect(assinaturaCad(atualizarLinhaCad(base, 0, { tamanho_folha: 2 }))).not.toBe(assinaturaCad(base));
  });
  it("escala do BANCO: qtd de folhas INTEGER, metragens e folha NUMERIC(10,2) — meio p/ longe do zero (sem conflito falso no eco)", () => {
    // O eco do servidor de 4,17 folhas / 45,734 m é 4 / 45,73 (salvar_cad_completo: ::numeric num INTEGER e num (10,2)).
    const local = atualizarVarianteCad(base, 0, 0, { quantidade_folhas: 4.17, metragem_planejada: 45.734 });
    expect(assinaturaCad(local)).toBe(assinaturaCad(base));
    expect(assinaturaCad(atualizarVarianteCad(base, 0, 0, { quantidade_folhas: 4.5 }))).not.toBe(assinaturaCad(base));
    expect(assinaturaCad(atualizarLinhaCad(base, 0, { tamanho_folha: 1.3 }))).not.toBe(assinaturaCad(base));
    // Empate decimal como o numeric (pelo expoente — mesmo método da assinaturaBom da F3.2): 1,205 → 1,21.
    expect(assinaturaCad(atualizarLinhaCad(base, 0, { tamanho_folha: 1.205 }))).toBe(assinaturaCad(atualizarLinhaCad(base, 0, { tamanho_folha: 1.21 })));
  });
  it("servidor × referência: a assinatura do servidor é a do estado hidratado; só o que é DO CAD acende", () => {
    const ref = assinaturaCad(base);
    expect(assinaturaCadServidor(cadServidor)).toBe(ref);
    expect(assinaturaCadServidor(null)).toBe("");
    expect(cadDivergeDaReferencia(ref, cadServidor)).toBe(false);
    expect(cadDivergeDaReferencia(null, cadServidor)).toBe(true);
    const outro: CadRowDb = { ...cadServidor, cad_tecidos: [{ ...cadServidor.cad_tecidos![0], tamanho_folha: 2 }] };
    expect(cadDivergeDaReferencia(ref, outro)).toBe(true);
    const soConsumo: CadRowDb = { ...cadServidor, cad_tecidos: [{ ...cadServidor.cad_tecidos![0], consumo_cad: 9 }] };
    expect(cadDivergeDaReferencia(ref, soConsumo)).toBe(false); // consumo é do BOM (já na assinaturaBom)
  });
});

describe("deveGravarCad — quando o Salvar grava o CAD (§3 P2, D2)", () => {
  const ok = { podeEditar: true, cadHidratado: true, cadExiste: true, ordemEnviada: true, linhas: 2, tocado: false, retry: false, recarregando: false };
  it("paridade com o Dev: todo Salvar regrava (1ª tentativa, sem recarga em curso)", () => {
    expect(deveGravarCad(ok)).toBe(true);
  });
  it("nunca sem editar / sem carregar / sem linha", () => {
    expect(deveGravarCad({ ...ok, podeEditar: false })).toBe(false);
    expect(deveGravarCad({ ...ok, cadHidratado: false })).toBe(false);
    expect(deveGravarCad({ ...ok, linhas: 0 })).toBe(false);
  });
  it("D2: antes da Ordem de Criação e sem CAD, não cria o CAD", () => {
    expect(deveGravarCad({ ...ok, cadExiste: false, ordemEnviada: false, tocado: true })).toBe(false);
    expect(deveGravarCad({ ...ok, cadExiste: false, ordemEnviada: true })).toBe(true);
  });
  it("sem toque, estado possivelmente velho (retry do P0409 ou recarga em curso) ⇒ não grava", () => {
    expect(deveGravarCad({ ...ok, retry: true })).toBe(false);
    expect(deveGravarCad({ ...ok, recarregando: true })).toBe(false);
  });
  it("P2: tocado ⇒ grava (o BOM grava junto), mesmo no retry e com recarga", () => {
    expect(deveGravarCad({ ...ok, tocado: true, retry: true, recarregando: true })).toBe(true);
  });
});

describe("idsVariantesDosBlocos — Dev :1274-1278", () => {
  it("todas as variantes de todos os blocos, sem repetição, ordenadas", () => {
    expect(idsVariantesDosBlocos(blocos(bloco("tecido", 1, { variantes: vars(V2, V1) }), bloco("forro", 1, { variantes: vars(V1, VF) })))).toEqual([V1, V2, VF].sort());
  });
});

describe("deveHidratarCarga — F3.3: a carga espera o CAD (Task 4)", () => {
  const prontas = { habilitada: true, bomFetching: false, tecidosData: {}, ocLinksData: [], aviamentosData: [], etiquetasData: [], gradesData: [] };
  it("CAD ainda não chegou ⇒ espera; chegou (inclusive 'sem CAD') ⇒ hidrata; sem o campo ⇒ comportamento da F3.2", () => {
    expect(deveHidratarCarga({ ...prontas, cadPronto: false })).toBe(false);
    expect(deveHidratarCarga({ ...prontas, cadPronto: true })).toBe(true);
    expect(deveHidratarCarga(prontas)).toBe(true);
  });
});
