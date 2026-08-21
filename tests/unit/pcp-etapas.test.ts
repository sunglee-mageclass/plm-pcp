import { describe, it, expect } from "vitest";
import { etapaDoBloco, ETAPAS_DEFAULT, type BlocoEtapa } from "@/lib/pcp-etapas";

const base: BlocoEtapa = { pt_data_saida:null, pt_data_entrada:null, pt_aprovacao:null, data_enviado:null, data_entregue:null, qtd_recebida:null, grade_detalhe:null };

describe("etapaDoBloco", () => {
  it("sem nada preenchido → peça teste", () => {
    expect(etapaDoBloco(base, ETAPAS_DEFAULT)).toEqual({ key:"peca_teste", reprovada:false });
  });
  it("peça teste aprovada → separação", () => {
    const b = { ...base, pt_data_saida:"2026-07-28", pt_data_entrada:"2026-08-04", pt_aprovacao:"aprovado" as const };
    expect(etapaDoBloco(b, ETAPAS_DEFAULT)).toEqual({ key:"separacao", reprovada:false });
  });
  it("reprovada → fica em peça teste com reprovada=true", () => {
    const b = { ...base, pt_data_saida:"2026-07-20", pt_data_entrada:"2026-07-27", pt_aprovacao:"reprovado" as const };
    expect(etapaDoBloco(b, ETAPAS_DEFAULT)).toEqual({ key:"peca_teste", reprovada:true });
  });
  it("data_enviado preenchida (aprovada) → retorno de grade", () => {
    const b = { ...base, pt_data_saida:"a", pt_data_entrada:"b", pt_aprovacao:"aprovado" as const, data_enviado:"2026-08-08" };
    expect(etapaDoBloco(b, ETAPAS_DEFAULT).key).toBe("retorno_grade");
  });
  it("grade cortada retornada → oficina", () => {
    const b = { ...base, pt_data_saida:"a", pt_data_entrada:"b", pt_aprovacao:"aprovado" as const, data_enviado:"x", grade_detalhe:{ "v1":{ "M":{ cortada:10 } } } };
    expect(etapaDoBloco(b, ETAPAS_DEFAULT).key).toBe("oficina");
  });
  it("entregue + recebida → finalização", () => {
    const b = { ...base, pt_data_saida:"a", pt_data_entrada:"b", pt_aprovacao:"aprovado" as const, data_enviado:"x", grade_detalhe:{ "v1":{ "M":{ cortada:10 } } }, data_entregue:"2026-09-01", qtd_recebida:10 };
    expect(etapaDoBloco(b, ETAPAS_DEFAULT).key).toBe("finalizacao");
  });
  it("etapa 3 desativada → separação pula direto p/ oficina qdo data_enviado preenchida", () => {
    const etapas = ETAPAS_DEFAULT.map(e => e.key==="retorno_grade" ? { ...e, ativa:false } : e);
    const b = { ...base, pt_data_saida:"a", pt_data_entrada:"b", pt_aprovacao:"aprovado" as const, data_enviado:"x" };
    expect(etapaDoBloco(b, etapas).key).toBe("oficina");
  });
});
