import { describe, it, expect } from "vitest";
import { colunaRegressaoAlvo } from "@/lib/kanban-condicoes";

// FASE 2 — regressão automática. Estes testes travam a lógica TS que é ESPELHADA em SQL
// (`_kanban_regredir_modelo`, migration 20260906120000). Os cenários replicam exatamente os
// provados transacionalmente no banco (tenant 20c84a36: pcp/ficha_de_explosao exigem
// servico_aprovado; em_modelagem exige ordem_criacao_enviada).

// Board do tenant de teste, na ordem real do board.
const ORDEM = [
  "desenvolvimento_de_produto", "ficha_tecnica", "em_modelagem", "em_pilotagem",
  "prova_de_roupa", "em_ajuste", "stand_by", "reprovado", "cadastro_do_modelo",
  "grade", "liberacao_de_modelagem", "cad", "aprovacao_de_custo", "ficha_de_explosao", "pcp",
];
const REQS: Record<string, string[]> = {
  pcp: ["servico_aprovado"],
  aprovado: ["anexo_modelo"],
  em_modelagem: ["ordem_criacao_enviada"],
  ficha_de_explosao: ["servico_aprovado"],
};

describe("kanban regressão — colunaRegressaoAlvo (espelho de _kanban_regredir_modelo)", () => {
  it("card em pcp com servico_aprovado desfeito → volta p/ ficha_de_explosao (1ª que exige)", () => {
    // ordem_criacao_enviada satisfeito (card já passou de em_modelagem); só servico_aprovado caiu.
    const cond = { ordem_criacao_enviada: true, servico_aprovado: false, anexo_modelo: true };
    expect(colunaRegressaoAlvo("pcp", ORDEM, REQS, cond)).toBe("ficha_de_explosao");
  });

  it("vários requisitos caem → volta p/ a coluna mais ATRÁS (a primeira que falha)", () => {
    // ordem_criacao_enviada (em_modelagem, ord 3) E servico_aprovado (ficha_de_explosao, ord 14) caem.
    const cond = { ordem_criacao_enviada: false, servico_aprovado: false };
    expect(colunaRegressaoAlvo("pcp", ORDEM, REQS, cond)).toBe("em_modelagem");
  });

  it("card já ATRÁS da coluna que falha → não regride (null)", () => {
    // card em em_modelagem (ord 3); em_modelagem exige ordem_criacao_enviada que caiu → alvo=em_modelagem,
    // mas o card já ESTÁ nele (não está à frente) → null.
    const cond = { ordem_criacao_enviada: false };
    expect(colunaRegressaoAlvo("em_modelagem", ORDEM, REQS, cond)).toBeNull();
  });

  it("nenhum requisito caiu → não regride (null)", () => {
    const cond = { ordem_criacao_enviada: true, servico_aprovado: true, anexo_modelo: true };
    expect(colunaRegressaoAlvo("pcp", ORDEM, REQS, cond)).toBeNull();
  });

  it("status fora do board conhecido → não regride (null)", () => {
    const cond = { servico_aprovado: false };
    expect(colunaRegressaoAlvo("coluna_inexistente", ORDEM, REQS, cond)).toBeNull();
  });

  it("exceção na coluna neutraliza o requisito herdado (não regride por ele)", () => {
    // servico_aprovado caiu, mas 'pcp' tem exceção que remove servico_aprovado herdado de ficha_de_explosao.
    // ficha_de_explosao ainda exige próprio servico_aprovado → alvo continua ficha_de_explosao.
    // (Exceção só afeta a coluna que a declara — aqui prova que ela NÃO vaza p/ ficha_de_explosao.)
    const cond = { ordem_criacao_enviada: true, servico_aprovado: false, anexo_modelo: true };
    const exc = { pcp: ["servico_aprovado"] };
    expect(colunaRegressaoAlvo("pcp", ORDEM, REQS, cond, exc)).toBe("ficha_de_explosao");
  });
});
