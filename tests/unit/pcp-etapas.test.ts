import { describe, it, expect } from "vitest";
import { etapaDoBloco, ETAPAS_DEFAULT, type BlocoEtapa } from "@/lib/pcp-etapas";

// [R9] A Peça Teste não é mais lida do bloco (`pt_*` ignoradas): vem do card do produto (ver etapas-peca-teste.test.ts).
// Para o BLOCO de serviço a etapa conta como cumprida → o bloco começa em Separação de Materiais.
const base: BlocoEtapa = { data_enviado:null, data_entregue:null, qtd_recebida:null, grade_detalhe:null };

describe("etapaDoBloco", () => {
  it("sem nada preenchido → separação de materiais (a peça teste vem do card do produto)", () => {
    expect(etapaDoBloco(base, ETAPAS_DEFAULT)).toEqual({ key:"separacao", reprovada:false });
  });
  it("pt_* do bloco são IGNORADAS (aprovada, reprovada ou vazia dão a mesma etapa)", () => {
    const aprovada = { ...base, pt_data_saida:"2026-07-28", pt_data_entrada:"2026-08-04", pt_aprovacao:"aprovado" as const };
    const reprovada = { ...base, pt_data_saida:"2026-07-20", pt_data_entrada:"2026-07-27", pt_aprovacao:"reprovado" as const };
    expect(etapaDoBloco(aprovada, ETAPAS_DEFAULT)).toEqual({ key:"separacao", reprovada:false });
    expect(etapaDoBloco(reprovada, ETAPAS_DEFAULT)).toEqual({ key:"separacao", reprovada:false }); // nunca reprovada:true
  });
  it("data_enviado preenchida → retorno de grade", () => {
    const b = { ...base, data_enviado:"2026-08-08" };
    expect(etapaDoBloco(b, ETAPAS_DEFAULT).key).toBe("retorno_grade");
  });
  it("grade cortada retornada → oficina", () => {
    const b = { ...base, data_enviado:"x", grade_detalhe:{ "v1":{ "M":{ cortada:10 } } } };
    expect(etapaDoBloco(b, ETAPAS_DEFAULT).key).toBe("oficina");
  });
  it("entregue + recebida → finalização", () => {
    const b = { ...base, data_enviado:"x", grade_detalhe:{ "v1":{ "M":{ cortada:10 } } }, data_entregue:"2026-09-01", qtd_recebida:10 };
    expect(etapaDoBloco(b, ETAPAS_DEFAULT).key).toBe("finalizacao");
  });
  it("etapa 3 desativada → separação pula direto p/ oficina qdo data_enviado preenchida", () => {
    const etapas = ETAPAS_DEFAULT.map(e => e.key==="retorno_grade" ? { ...e, ativa:false } : e);
    const b = { ...base, data_enviado:"x" };
    expect(etapaDoBloco(b, etapas).key).toBe("oficina");
  });
  it("peça teste desativada na config → o bloco também começa em separação", () => {
    const etapas = ETAPAS_DEFAULT.map(e => e.key==="peca_teste" ? { ...e, ativa:false } : e);
    expect(etapaDoBloco(base, etapas).key).toBe("separacao");
  });
});
