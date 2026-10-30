// [urg R13 T6] Guardas de FONTE do canvas e dos cards (o Vitest roda em node, sem DOM): o que não pode voltar.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chavesCacheOcDoProduto } from "@/components/shared/OcVinculadaProduto";

const ler = (p: string) => readFileSync(p, "utf8");
const SHEET_PA = ler("src/components/produto-acabado/ProdutoAcabadoSheet.tsx");
const SHEET_PI = ler("src/components/produto-importado/ProdutoImportadoSheet.tsx");
const CARD_PA = ler("src/components/produto-acabado/ProdutoCard.tsx");
const CARD_PI = ler("src/components/produto-importado/ProdutoImportadoCard.tsx");
const PEDIDO_PA = ler("src/components/produto-acabado/pedido.ts");
const PEDIDO_PI = ler("src/components/produto-importado/pedido.ts");
const SECAO = ler("src/components/shared/OcVinculadaProduto.tsx");

describe("canvas e cards NÃO criam mais a OC de 1 produto (o servidor recusa `versao_antiga`)", () => {
  it("nenhum Sheet/Card chama salvar_oc_* nem monta payload de OC; o pedido sai SÓ por fazer_pedido_*", () => {
    for (const src of [SHEET_PA, SHEET_PI, CARD_PA, CARD_PI]) {
      expect(src).not.toMatch(/salvar_oc_p_acabado|salvar_oc_importado|montarDadosOc|criarOcProduto|executarPedidosEmSequencia|PedidoEmLoteDialog/);
    }
    expect(PEDIDO_PA).toMatch(/rpc\("fazer_pedido_p_acabado"/);
    expect(PEDIDO_PI).toMatch(/rpc\("fazer_pedido_importado"/);
    expect(PEDIDO_PA).not.toMatch(/salvar_oc_/);
    expect(PEDIDO_PI).not.toMatch(/salvar_oc_/);
  });
  it("os 2 Sheets usam o MESMO assistente da T5 (rodapé, selecionados e card)", () => {
    for (const src of [SHEET_PA, SHEET_PI]) {
      expect(src).toMatch(/<PedidoOcLoteWizard/);
      expect(src).toMatch(/abrirPedidoLote\("rodape"\)/);
      expect(src).toMatch(/abrirPedidoLote\("selecionados"\)/);
      expect(src).toMatch(/abrirPedidoLote\("card", /);
      expect(src).toMatch(/onFazerPedido=\{/);
    }
  });
});

describe("a OC do produto vem do ITEM (embed `oc_item`), fora do `chaveDirty`", () => {
  it("nenhum Sheet embeda `ocs:ocs_*(` a partir do produto", () => {
    expect(SHEET_PA).not.toMatch(/ocs:\s*ocs_p_acabado\s*\(/);
    expect(SHEET_PI).not.toMatch(/ocs:\s*ocs_importado\s*\(/);
    expect(SHEET_PA).toMatch(/EMBED_OC_ITEM_PA/);
    expect(SHEET_PI).toMatch(/EMBED_OC_ITEM_PI/);
  });
  it("`oc` não entra no chaveDirty de nenhuma das duas famílias", () => {
    const sharedPA = ler("src/components/produto-acabado/shared.ts");
    const sharedPI = ler("src/components/produto-importado/shared.ts");
    const bloco = (src: string, nome: string) => src.slice(src.indexOf(`export function ${nome}`), src.indexOf("\n}\n", src.indexOf(`export function ${nome}`)));
    expect(bloco(sharedPA, "chaveDirty")).not.toMatch(/\boc\b/);
    expect(bloco(sharedPI, "chaveDirty")).not.toMatch(/\boc\b/);
  });
});

describe("a seção/bloco da OC é UM componente para as duas famílias", () => {
  it("PA e PI usam OcVinculadaSecao + OcChipProduto (chip fora do botão do cabeçalho)", () => {
    for (const src of [CARD_PA, CARD_PI]) {
      expect(src).toMatch(/<OcVinculadaSecao/);
      expect(src).toMatch(/<OcChipProduto/);
    }
  });
  it("vincular/desvincular só pelas RPCs do servidor; desvincular manda _produto_id NULL; sem R$ montado à mão", () => {
    expect(SECAO).toMatch(/vincular_oc_p_acabado/);
    expect(SECAO).toMatch(/vincular_oc_importado/);
    expect(SECAO).toMatch(/chamarVincular\(familia, oc!\.id, null\)/);
    expect(SECAO).not.toMatch(/R\$ ?\$\{|toFixed\(/);
    expect(SECAO).not.toMatch(/type=["']date["']/);
  });
});

describe("cache: depois de vincular/desvincular invalida os produtos, as OCs e a contagem das abas", () => {
  it("chavesCacheOcDoProduto", () => {
    const pa = chavesCacheOcDoProduto("acabado").map((c) => c[0]);
    expect(pa).toEqual(expect.arrayContaining(["produtos-acabados", "ocs_p_acabado", "oc-p-acabado", "sidebar-badges"]));
    const pi = chavesCacheOcDoProduto("importado").map((c) => c[0]);
    expect(pi).toEqual(expect.arrayContaining(["produtos-importados", "ocs_importado", "oc-importado", "sidebar-badges"]));
  });
});
