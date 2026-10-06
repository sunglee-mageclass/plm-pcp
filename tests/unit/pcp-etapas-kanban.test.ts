import { describe, it, expect } from "vitest";
import { montarCards } from "@/lib/pcp-etapas-kanban";
import { ETAPAS_DEFAULT } from "@/lib/pcp-etapas";

const modelo = (over = {}) => ({
  id:"m1", ref:"FEVLO-1", nome:"Vestido", fotos_modelo:["f.jpg"], desenho_tecnico_url:null, croqui_url:null,
  cad:[{ id:"c1", enviado_corte:true, producao_terceirizados:[
    { id:"b1", ativo:true, interno:false, categoria_terceirizado_id:"cat_pl", categorias_terceirizado:{ nome:"PL" },
      empresa:{ nome_fantasia:"Bela Vista" },
      data_enviado:null, data_entregue:null, quantidade_recebida:null, grade_detalhe:null },
  ]}], ...over,
});

describe("montarCards", () => {
  it("bloco PL vira 1 card (tipo bloco) na etapa separacao — a peça teste vem do card do produto [R9]", () => {
    const cards = montarCards([modelo() as any], ETAPAS_DEFAULT);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ tipo:"bloco", blocoId:"b1", modeloId:"m1", empresa:"Bela Vista", etapa:"separacao" });
  });
  it("bloco interno (não-PL) é ignorado", () => {
    const m = modelo(); (m as any).cad[0].producao_terceirizados[0].interno = true;
    expect(montarCards([m as any], ETAPAS_DEFAULT)).toHaveLength(0);
  });
  it("categoria não-PL é ignorada", () => {
    const m = modelo(); (m as any).cad[0].producao_terceirizados[0].categorias_terceirizado.nome = "Oficina";
    expect(montarCards([m as any], ETAPAS_DEFAULT)).toHaveLength(0);
  });
  it("[R9] pt_aprovacao='reprovado' legado no bloco NÃO tira o bloco do quadro (a reprovação mora no card do produto)", () => {
    const m = modelo(); const b = (m as any).cad[0].producao_terceirizados[0];
    b.pt_data_saida="a"; b.pt_data_entrada="b"; b.pt_aprovacao="reprovado";
    const cards = montarCards([m as any], ETAPAS_DEFAULT);
    expect(cards).toHaveLength(1);
    expect(cards[0].etapa).toBe("separacao");
  });
  it("[R9] produto na lista `suprimir` (card de Peça Teste em teste) não repete os blocos", () => {
    expect(montarCards([modelo() as any], ETAPAS_DEFAULT, new Set(["m1"]))).toHaveLength(0);
    expect(montarCards([modelo() as any], ETAPAS_DEFAULT, new Set(["outro"]))).toHaveLength(1);
  });
  it("cad não enviado ao corte é ignorado", () => {
    const m = modelo(); (m as any).cad[0].enviado_corte = false;
    expect(montarCards([m as any], ETAPAS_DEFAULT)).toHaveLength(0);
  });
  it("[urg R5] o card carrega os prazos crus (servico + peca de foto) p/ os alertas de atraso", () => {
    const m = modelo(); const b = (m as any).cad[0].producao_terceirizados[0];
    b.data_prevista = "2026-10-01"; b.peca_foto = true; b.peca_foto_previsao = "2026-10-03"; b.peca_foto_data = null;
    expect(montarCards([m as any], ETAPAS_DEFAULT)[0].prazos).toEqual({
      data_prevista: "2026-10-01", data_entregue: null, peca_foto: true, peca_foto_previsao: "2026-10-03", peca_foto_data: null,
    });
  });
  it("[urg R5] bloco sem as colunas novas (select antigo) = prazos vazios, sem quebrar", () => {
    expect(montarCards([modelo() as any], ETAPAS_DEFAULT)[0].prazos).toEqual({
      data_prevista: null, data_entregue: null, peca_foto: false, peca_foto_previsao: null, peca_foto_data: null,
    });
  });
});
