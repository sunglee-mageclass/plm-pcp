// Etapas PL — Onda 3, Task 9: lógica PURA da rota /pcp/etapas (`src/lib/pcp-etapas-pl-board.ts`).
// O QA da Task 10 cobre a rota no navegador (query, Sheet de Serviços, mover ligado/desligado).
import { describe, it, expect } from "vitest";
import {
  contarPorEtapaPl, ehRecusaChaveDesligadaPl, filtrarProdutosPl, modoGravarMoverPl, montarProdutoPl, podeMoverPl,
  type FiltrosPl, type ModeloPlRow, type ProdutoPlLinha,
} from "@/lib/pcp-etapas-pl-board";
import { lerEtapasPlConfig } from "@/lib/etapas-pl-config";
import { ETAPA_PL_FILTRO_LANCADO, etapaPlFiltroOpts } from "@/lib/etapas-pl-ui";

const cfg = lerEtapasPlConfig({
  etapas_pl_automatico: true,
  etapas_pl_kanban: ["Em Modelagem", "Em Pilotagem", "Aprovado"],
  etapas_pl_requisitos: { em_modelagem: ["tem_peca_teste"] },
});
const HOJE = "2026-11-12";

const modelo = (id: string, extra: Partial<ModeloPlRow> = {}): ModeloPlRow => ({
  id, ref: `REF-${id}`, nome: `Produto ${id}`, status_etapa_pl: "em_modelagem", ...extra,
});

describe("montarProdutoPl", () => {
  it("campos básicos, foto na ordem de capa, origem padrão 'interno'", () => {
    const p = montarProdutoPl(modelo("a", {
      fotos_modelo: ["f1.jpg", "f2.jpg"], desenho_tecnico_url: "dt.png", croqui_url: "cr.png", colecao: "Verão", lancado: true,
    }), HOJE);
    expect(p).toMatchObject({ id: "a", nome: "Produto a", ref: "REF-a", status_etapa_pl: "em_modelagem", lancado: true, colecao: "Verão", origem: "interno" });
    expect(p.fotoFontes).toEqual(["f1.jpg", "dt.png", "cr.png"]);
  });
  it("sem fotos/cad: fontes null, sem atraso, sem fornecedores", () => {
    const p = montarProdutoPl(modelo("a"), HOJE);
    expect(p.fotoFontes).toEqual([null, null, null]);
    expect(p.atrasoServico).toBeNull();
    expect(p.atrasoPecaFoto).toBeNull();
    expect(p.fornecedores).toEqual([]);
    expect(p.lancado).toBe(false);
  });
  it("atraso de serviço = PIOR bloco ATIVO (inativo é ignorado); fornecedores dedup só dos ativos; cad como array OU objeto", () => {
    const blocos = [
      { ativo: true, interno: false, categorias_terceirizado: { nome: "Costura" }, empresa: { nome_fantasia: "Oficina A" }, data_prevista: "2026-11-10" },
      { ativo: true, interno: false, categorias_terceirizado: [{ nome: "Corte" }], empresa: [{ nome_fantasia: "Oficina A" }], data_prevista: "2026-11-05" },
      { ativo: false, interno: false, categorias_terceirizado: { nome: "Lavanderia" }, empresa: { nome_fantasia: "Inativa" }, data_prevista: "2026-01-01" },
    ];
    for (const cad of [[{ producao_terceirizados: blocos }], { producao_terceirizados: blocos }]) {
      const p = montarProdutoPl(modelo("a", { cad }), HOJE);
      expect(p.atrasoServico).toEqual({ estado: "atrasado", dias: 7 });
      expect(p.fornecedores).toEqual(["Oficina A"]);
    }
  });
  it("entregue / sem previsão = sem alerta; vence hoje", () => {
    const mk = (b: object) => montarProdutoPl(modelo("a", { cad: [{ producao_terceirizados: [{ ativo: true, ...b }] }] }), HOJE);
    expect(mk({ data_prevista: "2026-11-01", data_entregue: "2026-11-02" }).atrasoServico).toBeNull();
    expect(mk({}).atrasoServico).toBeNull();
    expect(mk({ data_prevista: HOJE }).atrasoServico).toEqual({ estado: "vence_hoje", dias: 0 });
  });
  it("peça de foto: só bloco EXTERNO de serviço PL com peca_foto; interno e não-PL não contam", () => {
    const pecaAtrasada = { ativo: true, peca_foto: true, peca_foto_previsao: "2026-11-09" };
    const mk = (b: object) => montarProdutoPl(modelo("a", { cad: [{ producao_terceirizados: [{ ...pecaAtrasada, ...b }] }] }), HOJE);
    expect(mk({ interno: false, categorias_terceirizado: { nome: "PL" } }).atrasoPecaFoto).toEqual({ estado: "atrasado", dias: 3 });
    expect(mk({ interno: true, categorias_terceirizado: { nome: "PL" } }).atrasoPecaFoto).toBeNull();
    expect(mk({ interno: false, categorias_terceirizado: { nome: "Costura" } }).atrasoPecaFoto).toBeNull();
    expect(mk({ interno: false, categorias_terceirizado: { nome: "PL" }, peca_foto: false }).atrasoPecaFoto).toBeNull();
    expect(mk({ interno: false, categorias_terceirizado: { nome: "PL" }, peca_foto_data: "2026-11-10" }).atrasoPecaFoto).toBeNull();
    // módulo off: o card não calcula a peça de foto
    expect(montarProdutoPl(modelo("a", { cad: [{ producao_terceirizados: [{ ...pecaAtrasada, interno: false, categorias_terceirizado: { nome: "PL" } }] }] }), HOJE, false).atrasoPecaFoto).toBeNull();
  });
});

describe("filtrarProdutosPl / contarPorEtapaPl", () => {
  const lista: ProdutoPlLinha[] = [
    montarProdutoPl(modelo("a", { colecao: "Verão", status_etapa_pl: "em_modelagem", cad: [{ producao_terceirizados: [{ ativo: true, empresa: { nome_fantasia: "F1" } }] }] }), HOJE),
    montarProdutoPl(modelo("b", { colecao: "Inverno", status_etapa_pl: "em_pilotagem", origem: "revenda" }), HOJE),
    montarProdutoPl(modelo("c", { colecao: "Verão", status_etapa_pl: "orfao_xyz" }), HOJE), // órfão = 1ª coluna
    montarProdutoPl(modelo("d", { colecao: null, status_etapa_pl: "aprovado", lancado: true }), HOJE), // lançado = Finalizado
  ];
  const vazio: FiltrosPl = { busca: "", colecao: [], fornecedor: [], origem: [], etapa: [] };
  const ids = (f: Partial<FiltrosPl>, ligado = true) => filtrarProdutosPl(lista, { ...vazio, ...f }, cfg, ligado).map((p) => p.id);

  it("sem filtro = todos", () => expect(ids({})).toEqual(["a", "b", "c", "d"]));
  it("busca por nome ou REF, sem caixa", () => {
    expect(ids({ busca: "ref-B" })).toEqual(["b"]);
    expect(ids({ busca: " produto c " })).toEqual(["c"]);
  });
  it("coleção / fornecedor / origem", () => {
    expect(ids({ colecao: ["Verão"] })).toEqual(["a", "c"]);
    expect(ids({ fornecedor: ["F1"] })).toEqual(["a"]);
    expect(ids({ origem: ["revenda"] })).toEqual(["b"]);
    expect(ids({ origem: ["interno"] })).toEqual(["a", "c", "d"]);
  });
  it("etapa: usa o MESMO selo do card — órfão cai na 1ª coluna; lançado só em Finalizado", () => {
    expect(ids({ etapa: ["em_modelagem"] })).toEqual(["a", "c"]);
    expect(ids({ etapa: ["em_pilotagem"] })).toEqual(["b"]);
    expect(ids({ etapa: ["aprovado"] })).toEqual([]); // "d" é lançado: sai da coluna
    expect(ids({ etapa: [ETAPA_PL_FILTRO_LANCADO] })).toEqual(["d"]);
    expect(ids({ etapa: ["em_modelagem", ETAPA_PL_FILTRO_LANCADO] })).toEqual(["a", "c", "d"]);
  });
  it("filtros combinam em E", () => expect(ids({ colecao: ["Verão"], etapa: ["em_modelagem"], busca: "produto a" })).toEqual(["a"]));
  it("contagem por etapa: colunas na ordem + Finalizado, mesma lógica do filtro", () => {
    const c = contarPorEtapaPl(lista, etapaPlFiltroOpts(cfg), cfg, true);
    expect(c.map((x) => [x.id, x.count])).toEqual([["em_modelagem", 2], ["em_pilotagem", 1], ["aprovado", 0], [ETAPA_PL_FILTRO_LANCADO, 1]]);
  });
});

describe("podeMoverPl", () => {
  const ok = { podeEditar: true, cfgCarregando: false, cfgErro: false, ligado: true, condicoesProntas: true, cardsErro: false };
  it("tudo certo = pode", () => expect(podeMoverPl(ok)).toBe(true));
  it("sem permissão de editar = não", () => expect(podeMoverPl({ ...ok, podeEditar: false })).toBe(false));
  it("config carregando ou com erro = não", () => {
    expect(podeMoverPl({ ...ok, cfgCarregando: true })).toBe(false);
    expect(podeMoverPl({ ...ok, cfgErro: true })).toBe(false);
  });
  it("erro ao carregar os produtos trava", () => expect(podeMoverPl({ ...ok, cardsErro: true })).toBe(false));
  it("chave LIGADA exige as condições carregadas; DESLIGADA não depende delas", () => {
    expect(podeMoverPl({ ...ok, condicoesProntas: false })).toBe(false);
    expect(podeMoverPl({ ...ok, ligado: false, condicoesProntas: false })).toBe(true);
  });
});

describe("como gravar o mover", () => {
  it("ligada = RPC; desligada = UPDATE direto (a RPC recusa com a chave off)", () => {
    expect(modoGravarMoverPl(true)).toBe("rpc");
    expect(modoGravarMoverPl(false)).toBe("direto");
  });
  it("reconhece a recusa 'etapas_pl_manual' (chave lida velha) — só P0001 com esse prefixo", () => {
    expect(ehRecusaChaveDesligadaPl({ code: "P0001", message: "etapas_pl_manual: ligue o kanban automatico das etapas" })).toBe(true);
    expect(ehRecusaChaveDesligadaPl({ code: "P0001", message: "outra coisa" })).toBe(false);
    expect(ehRecusaChaveDesligadaPl({ code: "42501", message: "etapas_pl_manual: x" })).toBe(false);
    expect(ehRecusaChaveDesligadaPl(null)).toBe(false);
  });
});
