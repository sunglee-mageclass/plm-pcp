import { describe, it, expect } from "vitest";
import { montarCards } from "@/lib/pcp-etapas-kanban";
import { ETAPAS_DEFAULT } from "@/lib/pcp-etapas";

const modelo = (over = {}) => ({
  id:"m1", ref:"FEVLO-1", nome:"Vestido", fotos_modelo:["f.jpg"], desenho_tecnico_url:null, croqui_url:null,
  cad:[{ id:"c1", enviado_corte:true, producao_terceirizados:[
    { id:"b1", ativo:true, interno:false, categoria_terceirizado_id:"cat_pl", categorias_terceirizado:{ nome:"PL" },
      empresa:{ nome_fantasia:"Bela Vista" }, pt_data_saida:null, pt_data_entrada:null, pt_aprovacao:null,
      data_enviado:null, data_entregue:null, quantidade_recebida:null, grade_detalhe:null },
  ]}], ...over,
});

describe("montarCards", () => {
  it("bloco PL vira 1 card na etapa peca_teste", () => {
    const cards = montarCards([modelo() as any], ETAPAS_DEFAULT);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ blocoId:"b1", modeloId:"m1", empresa:"Bela Vista", etapa:"peca_teste" });
  });
  it("bloco interno (não-PL) é ignorado", () => {
    const m = modelo(); (m as any).cad[0].producao_terceirizados[0].interno = true;
    expect(montarCards([m as any], ETAPAS_DEFAULT)).toHaveLength(0);
  });
  it("categoria não-PL é ignorada", () => {
    const m = modelo(); (m as any).cad[0].producao_terceirizados[0].categorias_terceirizado.nome = "Oficina";
    expect(montarCards([m as any], ETAPAS_DEFAULT)).toHaveLength(0);
  });
  it("reprovada é EXCLUÍDA do kanban", () => {
    const m = modelo(); const b = (m as any).cad[0].producao_terceirizados[0];
    b.pt_data_saida="a"; b.pt_data_entrada="b"; b.pt_aprovacao="reprovado";
    expect(montarCards([m as any], ETAPAS_DEFAULT)).toHaveLength(0);
  });
  it("cad não enviado ao corte é ignorado", () => {
    const m = modelo(); (m as any).cad[0].enviado_corte = false;
    expect(montarCards([m as any], ETAPAS_DEFAULT)).toHaveLength(0);
  });
});
