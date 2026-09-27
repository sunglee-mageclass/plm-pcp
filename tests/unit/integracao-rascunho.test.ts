import { describe, it, expect } from "vitest";
import { lerLista } from "@/lib/integracao/produtos";
import {
  PREFIXO_FOTO_NOVA, adicionarFotos, aposSalvar, colunasAlteradas, comSkus, editar, linhaSkuDaSublinha, manterMeu, mesclar,
  novoRascunho, payloadItem, removerFoto, temAlteracao, usarNovo,
} from "@/lib/integracao/rascunho";

const raw = { nome: "Blusa Brisa", ref: "BLBR0087", preco_anterior: 179.9, preco_venda: 159.9, peso_kg: 0.22, ncm: "6109.10.00",
  titulo_pagina: null, descricao_produto: "Blusa.", comprimento_cm: 68, largura_cm: 42, altura_cm: 2,
  fotos_modelo: ["t/fotos_modelo/a.jpg", "t/fotos_modelo/b.jpg"], tamanho_tipo: "letra" };
const produto = (rev: number, r: Record<string, unknown> = {}) => lerLista({ campos: [], produtos: [{
  modelo_id: "m1", origem: "interno", estado: "nao_integravel", rev, raw: { ...raw, ...r }, faltas: [], completo: true,
  sublinhas: [{ variante_key: "v1", tamanho_key: "38|P", variante_ordem: 1, tamanho_ordem: 1, cor_nome: "Branco", apelido_nome: null,
    tamanho: "P", sku_id: "s1", sku: "BLBR0087-BCO-P", sku_rev: 2, manual: false }], retrato_difere: [], gates: {} }] }).produtos[0];
const arquivo = (nome: string) => new File(["x"], nome, { type: "image/jpeg" });

describe("rascunho por produto (staging)", () => {
  it("nasce igual ao servidor; editar marca a coluna e o alterado", () => {
    const r0 = novoRascunho(produto(7));
    expect(temAlteracao(r0)).toBe(false);
    const r1 = editar(r0, "peso_kg", 0.25);
    expect(colunasAlteradas(r1)).toEqual(["peso_kg"]);
    expect(colunasAlteradas(editar(r1, "peso_kg", 0.22))).toEqual([]); // voltou ao valor do servidor = não alterado
  });
  it("fotos: nova entra como marcador na ordem; remover some do rascunho e da fila de upload", () => {
    const r = adicionarFotos(novoRascunho(produto(7)), [{ id: "u1", file: arquivo("c.jpg") }]);
    expect(r.valores.fotos_modelo).toEqual(["t/fotos_modelo/a.jpg", "t/fotos_modelo/b.jpg", `${PREFIXO_FOTO_NOVA}u1`]);
    const r2 = removerFoto(removerFoto(r, `${PREFIXO_FOTO_NOVA}u1`), "t/fotos_modelo/a.jpg");
    expect(r2.fotosNovas).toEqual([]);
    expect(r2.valores.fotos_modelo).toEqual(["t/fotos_modelo/b.jpg"]);
  });
  it("payload: só as colunas alteradas; textos aparados; vazio = null (exceto nome/REF, que o servidor recusa)", () => {
    let r = novoRascunho(produto(7));
    r = editar(r, "ncm", "  ");
    r = editar(r, "nome", "  Blusa Brisa Nova ");
    r = editar(r, "comprimento_cm", null);
    expect(payloadItem(r)).toEqual({ modelo_id: "m1", rev: 7, campos: { nome: "Blusa Brisa Nova", ncm: null, comprimento_cm: null } });
    expect(payloadItem(novoRascunho(produto(7)))).toBeNull();
    const f = adicionarFotos(novoRascunho(produto(7)), [{ id: "u1", file: arquivo("c.jpg") }]);
    expect(payloadItem(f, ["t/fotos_modelo/a.jpg", "t/fotos_modelo/b.jpg", "t/fotos_modelo/c.jpg"])?.campos)
      .toEqual({ fotos_modelo: ["t/fotos_modelo/a.jpg", "t/fotos_modelo/b.jpg", "t/fotos_modelo/c.jpg"] });
  });
  it("merge 3-vias: campo NÃO tocado segue o servidor; tocado e mudado lá = conflito", () => {
    let r = editar(novoRascunho(produto(7)), "peso_kg", 0.3);
    r = mesclar(r, produto(8, { peso_kg: 0.28, ncm: "6204.52.00" }));
    expect(r.rev).toBe(8);
    expect(r.valores.ncm).toBe("6204.52.00");
    expect(r.valores.peso_kg).toBe(0.3);
    expect(r.conflitos).toEqual([{ path: "peso_kg", meu: 0.3, dele: 0.28 }]);
    expect(manterMeu(r, "peso_kg").conflitos).toEqual([]);
    const u = usarNovo(r, "peso_kg");
    expect(u.valores.peso_kg).toBe(0.28);
    expect(colunasAlteradas(u)).toEqual([]);
    expect(mesclar(r, produto(8))).toBe(r); // mesmo rev = nada muda
  });
  it("SKU à mão: a sublinha vira LinhaSku; SKUs a gravar contam como alteração", () => {
    const p = produto(7);
    const l = linhaSkuDaSublinha(p.sublinhas[0]);
    expect(l).toMatchObject({ variante_key: "v1", tamanho_key: "38|P", id: "s1", rev: 2, sku: "BLBR0087-BCO-P", estado: "ok" });
    const r = comSkus(novoRascunho(p), { regerar: false, manuais: { "v1|38|P": { varianteKey: "v1", tamanhoKey: "38|P", sku: "X-1", id: "s1", rev: 2 } } });
    expect(temAlteracao(r)).toBe(true);
    expect(payloadItem(r)).toBeNull(); // SKU não vai no integracao_salvar (vai no passo 3)
  });
  it("depois do Salvar: some o rascunho; sobra só SKU que não gravou", () => {
    const r = editar(novoRascunho(produto(7)), "peso_kg", 0.3);
    expect(aposSalvar(r, { rev: 8, skusGravados: false })).toBeNull();
    const s = comSkus(r, { regerar: false, manuais: { "v1|38|P": { varianteKey: "v1", tamanhoKey: "38|P", sku: "X-1", id: "s1", rev: 2 } } });
    const sobra = aposSalvar(s, { rev: 8, fotos: ["t/fotos_modelo/a.jpg"], skusGravados: false })!;
    expect(sobra.rev).toBe(8);
    expect(colunasAlteradas(sobra)).toEqual([]);
    expect(sobra.valores.fotos_modelo).toEqual(["t/fotos_modelo/a.jpg"]);
    expect(temAlteracao(sobra)).toBe(true);
    expect(aposSalvar(s, { rev: 8, skusGravados: true })).toBeNull();
  });
  it("ruling G1: limpar titulo_pagina/preco_anterior volta a NULL (automático) — editar(...,null) preserva o significado", () => {
    // titulo_pagina: o campo "limpar" no card grava NULL (volta a ser automático). O rascunho não deve inventar uma
    // string vazia diferente de NULL — editar(r,"titulo_pagina",null) grava exatamente null.
    let r = editar(novoRascunho(produto(7, { titulo_pagina: "Blusa Brisa | Loja X" })), "titulo_pagina", null);
    expect(r.valores.titulo_pagina).toBeNull();
    expect(colunasAlteradas(r)).toEqual(["titulo_pagina"]);
    expect(payloadItem(r)?.campos.titulo_pagina).toBeNull();
    // preco_anterior: mesma forma — limpar = null (ruling: sem a regra "digitar o automático mantém NULL" do
    // Título, já que o Sheet (helpers.ts `precoAnteriorOuNull`) só tem "vazio/0/negativo = NULL", não comparação
    // com o valor efetivo calculado). Aqui testamos só o "limpar = NULL" que É garantido nos dois campos.
    let r2 = editar(novoRascunho(produto(7)), "preco_anterior", null);
    expect(r2.valores.preco_anterior).toBeNull();
    expect(payloadItem(r2)?.campos.preco_anterior).toBeNull();
  });
});
