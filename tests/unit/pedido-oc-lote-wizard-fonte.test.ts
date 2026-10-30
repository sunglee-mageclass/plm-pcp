// [urg R13 T5] Guardas de fonte do assistente (o Vitest roda em node, sem DOM): padrões do sistema que o componente tem de manter.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/shared/PedidoOcLoteWizard.tsx", "utf8");

describe("PedidoOcLoteWizard (fonte)", () => {
  it("Dialog com rodapé fixo e tela cheia no celular; confirmação em AlertDialog", () => {
    expect(src).toMatch(/<DialogContent fixedFooter mobileFull/);
    expect(src).toMatch(/<AlertDialog /);
    expect(src).toMatch(/Criar \{pedidosTexto\(totais\.ocs\)\}\?/);
  });
  it("datas só por DateField; nunca <input type=date>", () => {
    expect(src).toMatch(/<DateField/);
    expect(src).not.toMatch(/type=["']date["']/);
  });
  it("não fala com o servidor: tudo entra por props injetadas (adaptador por família)", () => {
    expect(src).not.toMatch(/@\/integrations\/supabase/);
    expect(src).not.toMatch(/\.rpc\(/);
    expect(src).toMatch(/onCriar/);
    expect(src).toMatch(/onSalvarProduto/);
  });
  it("erros pelo mensagemErro; dinheiro só por brl() (nunca R$ montado à mão)", () => {
    expect(src).toMatch(/mensagemErro\(/);
    expect(src).not.toMatch(/R\$ ?\$\{/);
    expect(src).not.toMatch(/toFixed\(/);
  });
  it("tela vazia e textos aprovados do mockup", () => {
    for (const t of ["Nº gerado ao criar", "já tem a OC", "este pedido cria uma OC nova", "Sem fornecedor (não geram OC)", "Não entram no pedido", "aplicar este cabeçalho a todas", "incluir esta OC no pedido", "Nenhum produto elegível para pedido.", "Abrir OC"]) {
      expect(src, t).toContain(t);
    }
  });
});
