// [camada C1 · P-77 A / P-262 A / P-268 A] Tela × banco: (1) os nomes das marcas "apagar tudo" que a tela manda são os que a
// migration 20261103160000 lê; (2) os RAISE novos (`estado_vazio_recusado: <entidade> <n>`, `servico_com_parcela_paga: …`)
// viram texto PT em mensagemErro — toda entidade que a migration usa tem texto próprio (nunca o genérico).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mensagemErro, textoEstadoVazio } from "@/lib/erro-mensagem";
import { MARCA_APAGAR_TUDO_ITENS_OC, MARCA_APAGAR_TUDO_SERVICOS } from "@/lib/apagar-tudo";

const MIG = readFileSync("supabase/migrations/20261103160000_camada_estado_vazio.sql", "utf8");
const GAT = readFileSync("supabase/migrations/20261103161000_camada_parcela_paga.sql", "utf8");

describe("camada C1 — marcas 'apagar tudo' (tela × migration)", () => {
  it("salvar_terceirizados lê _rev_base->>'<marca de serviços>' e as 3 OCs leem _oc->>'<marca de itens>'", () => {
    expect(MIG).toContain(`COALESCE(_rev_base->>'${MARCA_APAGAR_TUDO_SERVICOS}', '') <> 'true'`);
    expect(
      MIG.split(`COALESCE(_oc->>'${MARCA_APAGAR_TUDO_ITENS_OC}', '') <> 'true'`).length - 1,
    ).toBe(3);
  });
});

describe("camada C1 — mensagens PT", () => {
  it("estado_vazio_recusado: por entidade, com singular/plural", () => {
    expect(
      mensagemErro({ code: "P0001", message: "estado_vazio_recusado: servicos 3" }, "fb"),
    ).toBe(
      "Nada foi apagado: a lista de serviços chegou vazia ao servidor, mas este modelo tem 3 serviços salvos. Recarregue a tela e confira antes de salvar de novo.",
    );
    expect(
      mensagemErro({ code: "P0001", message: "estado_vazio_recusado: servicos 1" }, "fb"),
    ).toContain("tem 1 serviço salvo.");
    expect(
      mensagemErro({ code: "P0001", message: "estado_vazio_recusado: itens_oc 2" }, "fb"),
    ).toBe(
      "Nada foi apagado: a lista de itens chegou vazia ao servidor, mas esta OC tem 2 itens salvos. Recarregue a tela e confira antes de salvar de novo.",
    );
    expect(
      mensagemErro({ code: "P0001", message: "estado_vazio_recusado: itens_oc 1" }, "fb"),
    ).toContain("tem 1 item salvo.");
    expect(
      mensagemErro({ code: "P0001", message: "estado_vazio_recusado: direcionamento 4" }, "fb"),
    ).toBe(
      "Nada foi apagado: o Direcionamento chegou vazio ao servidor, mas este modelo tem 4 linhas de loja salvas. Recarregue a tela e confira antes de salvar de novo.",
    );
    // sem número / entidade desconhecida: texto sem a contagem / genérico — nunca o texto cru do banco
    expect(mensagemErro({ code: "P0001", message: "estado_vazio_recusado: servicos" }, "fb")).toBe(
      "Nada foi apagado: a lista de serviços chegou vazia ao servidor. Recarregue a tela e confira antes de salvar de novo.",
    );
    expect(mensagemErro({ code: "P0001", message: "estado_vazio_recusado: outra 2" }, "fb")).toBe(
      "Nada foi apagado: a lista chegou vazia ao servidor. Recarregue a tela e confira antes de salvar de novo.",
    );
  });

  it("toda entidade dos RAISE da migration tem texto próprio", () => {
    const ents = [...MIG.matchAll(/'estado_vazio_recusado: ([a-z_]+) %'/g)].map((m) => m[1]);
    expect(new Set(ents)).toEqual(new Set(["servicos", "direcionamento", "itens_oc"]));
    for (const e of ents) expect(textoEstadoVazio(e, 2), e).not.toBe(textoEstadoVazio("??", 2));
  });

  it("servico_com_parcela_paga: diz QUAIS e como resolver", () => {
    expect(
      mensagemErro(
        {
          code: "P0001",
          message:
            "servico_com_parcela_paga: Costura - Oficina X: parcela 1, 2; Lavanderia: parcela 1",
        },
        "fb",
      ),
    ).toBe(
      "Não é possível excluir serviço com parcela já paga (Costura - Oficina X: parcela 1, 2; Lavanderia: parcela 1). Para excluir, desmarque o pagamento no Financeiro antes.",
    );
    expect(mensagemErro({ code: "P0001", message: "servico_com_parcela_paga: " }, "fb")).toBe(
      "Não é possível excluir serviço com parcela já paga. Para excluir, desmarque o pagamento no Financeiro antes.",
    );
    // o gatilho e o salvar_terceirizados usam o mesmo prefixo
    expect(GAT).toContain("'servico_com_parcela_paga: %: parcela %'");
    expect(MIG).toContain("'servico_com_parcela_paga: %'");
  });

  it("outro código com o mesmo texto não é traduzido por aqui", () => {
    expect(
      mensagemErro({ code: "42501", message: "estado_vazio_recusado: servicos 3" }, "fb"),
    ).not.toContain("Nada foi apagado");
  });
});
