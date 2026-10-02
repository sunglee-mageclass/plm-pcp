// L9 (achados LEVES; P-206 A preço da compra + P-208 A cor obrigatória) — regras puras do item da OC de Aviamento
// (src/lib/oc-aviamento-item.ts), tradução das recusas do servidor e anti-drift banco × tela.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  precoCadastroAviamento,
  precoEfetivoItem,
  itemSemCorObrigatoria,
  itemEditado,
  situacaoCorItem,
  type ItemOcAviamento,
} from "@/lib/oc-aviamento-item";
import {
  mensagemErro,
  TEXTO_OC_AVIAMENTO_PRECO_INVALIDO,
  textoOcAviamentoCorObrigatoria,
} from "@/lib/erro-mensagem";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const base: ItemOcAviamento = {
  id: "i1",
  aviamento_id: "a1",
  variante_aviamento_id: null,
  quantidade_pedida: 7,
  quantidade_recebida: null,
  cancelado: false,
  preco: null,
};

describe("precoEfetivoItem (P-206 A)", () => {
  it("preço da compra manda; vazio = cadastro; nenhum = 0", () => {
    expect(precoEfetivoItem({ preco: 1.75 }, 2.5)).toBe(1.75);
    expect(precoEfetivoItem({ preco: 0 }, 2.5)).toBe(0); // 0 digitado vale (não cai no cadastro)
    expect(precoEfetivoItem({ preco: null }, 2.5)).toBe(2.5);
    expect(precoEfetivoItem({ preco: null }, null)).toBe(0);
    expect(precoEfetivoItem({ preco: null }, undefined)).toBe(0);
  });
});

describe("precoCadastroAviamento (P-216 A: cor > 0, senão geral)", () => {
  it("cor com preço > 0 vale; cor sem preço, 0 ou negativo cai no geral; sem nenhum = null", () => {
    expect(precoCadastroAviamento(2.5, 3.1)).toBe(3.1);
    expect(precoCadastroAviamento(2.5, "3.10")).toBe(3.1);
    expect(precoCadastroAviamento(2.5, null)).toBe(2.5);
    expect(precoCadastroAviamento(2.5, undefined)).toBe(2.5);
    expect(precoCadastroAviamento(2.5, 0)).toBe(2.5);
    expect(precoCadastroAviamento(2.5, -1)).toBe(2.5);
    expect(precoCadastroAviamento(null, null)).toBeNull();
    expect(precoCadastroAviamento(null, 4)).toBe(4);
    // a cadeia completa da tela: preço da compra → cor → geral
    expect(precoEfetivoItem({ preco: null }, precoCadastroAviamento(2.5, 3.1))).toBe(3.1);
    expect(precoEfetivoItem({ preco: 1.2 }, precoCadastroAviamento(2.5, 3.1))).toBe(1.2);
  });
});

describe("cor obrigatória (P-208 A)", () => {
  it("só com 2+ cores, item ativo sem cor", () => {
    expect(itemSemCorObrigatoria(base, 2)).toBe(true);
    expect(itemSemCorObrigatoria(base, 1)).toBe(false);
    expect(itemSemCorObrigatoria(base, 0)).toBe(false);
    expect(itemSemCorObrigatoria({ ...base, variante_aviamento_id: "v1" }, 2)).toBe(false);
    expect(itemSemCorObrigatoria({ ...base, cancelado: true }, 2)).toBe(false);
    expect(itemSemCorObrigatoria({ ...base, aviamento_id: "" }, 2)).toBe(false);
  });

  it("item novo (sem id ou sem base) = editado; legado igual ao gravado = não editado (preço efetivo)", () => {
    expect(itemEditado({ ...base, id: undefined }, undefined, 4)).toBe(true);
    expect(itemEditado(base, undefined, 4)).toBe(true);
    expect(itemEditado(base, base, 4)).toBe(false);
    // a tela preenche o preço do cadastro num legado vazio: mesmo preço EFETIVO → não conta como edição
    expect(itemEditado({ ...base, preco: 4 }, base, 4)).toBe(false);
    expect(itemEditado({ ...base, preco: 3.5 }, base, 4)).toBe(true);
    expect(itemEditado({ ...base, quantidade_pedida: 8 }, base, 4)).toBe(true);
    expect(itemEditado({ ...base, quantidade_recebida: 7 }, base, 4)).toBe(true);
    expect(itemEditado({ ...base, cancelado: true }, base, 4)).toBe(true);
    expect(itemEditado(base, { ...base, variante_aviamento_id: "v1" }, 4)).toBe(true); // cor apagada
    expect(itemEditado({ ...base, aviamento_id: "a2" }, base, 4)).toBe(true);
  });

  it("situação: ok / aviso (legado não mexido, não trava) / bloqueia (novo ou editado)", () => {
    expect(situacaoCorItem(base, 2, base, 4)).toBe("aviso");
    expect(situacaoCorItem({ ...base, quantidade_pedida: 9 }, 2, base, 4)).toBe("bloqueia");
    expect(situacaoCorItem({ ...base, id: undefined }, 2, undefined, 4)).toBe("bloqueia");
    expect(situacaoCorItem({ ...base, variante_aviamento_id: "v2" }, 2, base, 4)).toBe("ok");
    expect(situacaoCorItem(base, 1, base, 4)).toBe("ok");
    expect(situacaoCorItem({ ...base, cancelado: true }, 2, base, 4)).toBe("ok");
  });
});

describe("recusas do servidor → texto PT (erro-mensagem)", () => {
  it("cor obrigatória e preço negativo (P0001 ASCII com prefixo)", () => {
    expect(
      mensagemErro({
        code: "P0001",
        message: "oc_aviamento_cor_obrigatoria: 00003118 - FRANJA COM GUIPIR 6CM",
      }),
    ).toBe(
      'Escolha a cor do aviamento "00003118 - FRANJA COM GUIPIR 6CM": ele tem 2 ou mais cores cadastradas e a cor é obrigatória no item novo ou editado.',
    );
    // nome com acento chega com "?" — não mostra o nome estragado
    expect(mensagemErro({ code: "P0001", message: "oc_aviamento_cor_obrigatoria: Z?per" })).toBe(
      textoOcAviamentoCorObrigatoria(),
    );
    expect(
      mensagemErro({
        code: "P0001",
        message: "oc_aviamento_preco_invalido: o preco do item nao pode ser negativo",
      }),
    ).toBe(TEXTO_OC_AVIAMENTO_PRECO_INVALIDO);
  });
});

describe("anti-drift banco × tela (L9)", () => {
  const MIG = readFileSync(
    ROOT + "supabase/migrations/20261029100000_oc_aviamento_preco.sql",
    "utf8",
  );
  const TELA = readFileSync(
    ROOT + "src/routes/_authenticated/entrada-saida.oc-aviamento.tsx",
    "utf8",
  );

  it("os prefixos traduzidos existem no SQL; os 3 leitores usam o preço da compra do item", () => {
    expect(MIG).toContain("'oc_aviamento_cor_obrigatoria: %'");
    expect(MIG).toContain("'oc_aviamento_preco_invalido: o preco do item nao pode ser negativo'");
    // P-216 A: preço da compra → cor (> 0) → geral, nos 3 leitores
    expect(MIG).toContain(
      "COALESCE(it.preco, CASE WHEN va.preco > 0 THEN va.preco END, a.preco, 0)), 0)",
    ); // gerar_parcelas
    expect(MIG).toContain(
      "COALESCE(it.preco, CASE WHEN va.preco > 0 THEN va.preco END, a.preco, 0)),0)",
    ); // _recalcular_parcelas_core
    expect(MIG).toContain(
      "COALESCE(i.preco, CASE WHEN va.preco > 0 THEN va.preco END, a.preco, 0))",
    ); // _dashboard_financeiro_core
    // [fix round 3, R3] a cor só vale se for DA MESMA família do aviamento (leitores = prefill do save = tela)
    expect(
      MIG.match(
        /LEFT JOIN public\.variantes_aviamento va ON va\.id = it\.variante_aviamento_id AND va\.aviamento_id = it\.aviamento_id/g,
      )?.length,
    ).toBe(2);
    expect(MIG).toContain(
      "LEFT JOIN variantes_aviamento va ON va.id = i.variante_aviamento_id AND va.aviamento_id = i.aviamento_id",
    );
    expect(MIG.match(/AND va\.aviamento_id = a\.id/g)?.length).toBe(3);
    // prefill do save core: cor > 0 senão geral (INSERT x2 + UPDATE)
    expect(
      MIG.match(/COALESCE\(CASE WHEN va\.preco > 0 THEN va\.preco END, a\.preco\)/g)?.length,
    ).toBe(3);
    // o servidor compara o preço EFETIVO (vazio = cadastro), como itemEditado
    expect(MIG).toContain(
      "COALESCE(NULLIF(e.j->>'preco','')::numeric, a.preco) IS DISTINCT FROM COALESCE(s.preco, a.preco)",
    );
  });

  it("a tela manda o preço do item, lê o preço gravado e usa a regra única nos totais/documento", () => {
    expect(TELA).toMatch(/preco: i\.preco, \/\/ L9/); // payload do salvar
    expect(TELA).toContain("preco: i.preco == null ? null : Number(i.preco)"); // itemDoServidor
    expect(TELA).toContain(
      '"oc_aviamento_id, quantidade_pedida, quantidade_recebida, aviamento_id, preco, cancelado, aviamentos(preco), variante:variante_aviamento_id(preco)"',
    );
    expect(TELA).toContain("precoEfetivoItem(i, cadastroDe(i))");
    expect(TELA).toContain("return precoCadastroAviamento(a.preco, v?.preco);"); // P-216 A
    expect(TELA).toContain("situacaoCorItem(");
    expect(TELA).not.toMatch(/const valorPrev = \(i: ItemDraft\) => Number\(aviMap/); // conta antiga (só cadastro)
  });
});
