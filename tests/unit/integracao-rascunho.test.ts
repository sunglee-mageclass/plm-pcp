import { describe, it, expect } from "vitest";
import { lerLista } from "@/lib/integracao/produtos";
import {
  PREFIXO_FOTO_NOVA,
  adicionarFotos,
  aposSalvar,
  colunasAlteradas,
  comSkus,
  editar,
  editarTitulo,
  linhaSkuDaSublinha,
  manterMeu,
  mesclar,
  novoRascunho,
  payloadItem,
  removerFoto,
  sairTitulo,
  temAlteracao,
  usarNovo,
} from "@/lib/integracao/rascunho";

const NOME_LOJA = "Loja Teste";
const raw = {
  nome: "Blusa Brisa",
  ref: "BLBR0087",
  preco_anterior: 179.9,
  preco_venda: 159.9,
  peso_kg: 0.22,
  ncm: "6109.10.00",
  titulo_pagina: null,
  descricao_produto: "Blusa.",
  comprimento_cm: 68,
  largura_cm: 42,
  altura_cm: 2,
  fotos_modelo: ["t/fotos_modelo/a.jpg", "t/fotos_modelo/b.jpg"],
  tamanho_tipo: "letra",
};
const produto = (rev: number, r: Record<string, unknown> = {}) =>
  lerLista({
    campos: [],
    produtos: [
      {
        modelo_id: "m1",
        origem: "interno",
        estado: "nao_integravel",
        rev,
        raw: { ...raw, ...r },
        faltas: [],
        completo: true,
        sublinhas: [
          {
            variante_key: "v1",
            tamanho_key: "38|P",
            variante_ordem: 1,
            tamanho_ordem: 1,
            cor_nome: "Branco",
            apelido_nome: null,
            tamanho: "P",
            sku_id: "s1",
            sku: "BLBR0087-BCO-P",
            sku_rev: 2,
            manual: false,
          },
        ],
        retrato_difere: [],
        gates: {},
      },
    ],
  }).produtos[0];
const arquivo = (nome: string) => new File(["x"], nome, { type: "image/jpeg" });
const rascunho = (
  rev: number,
  r: Record<string, unknown> = {},
  nomeLoja: string | null = NOME_LOJA,
) => novoRascunho(produto(rev, r), nomeLoja);

describe("rascunho por produto (staging)", () => {
  it("nasce igual ao servidor; editar marca a coluna e o alterado", () => {
    const r0 = rascunho(7);
    expect(temAlteracao(r0)).toBe(false);
    const r1 = editar(r0, "peso_kg", 0.25);
    expect(colunasAlteradas(r1)).toEqual(["peso_kg"]);
    expect(colunasAlteradas(editar(r1, "peso_kg", 0.22))).toEqual([]); // voltou ao valor do servidor = não alterado
  });
  it("fotos: nova entra como marcador na ordem; remover some do rascunho e da fila de upload", () => {
    const r = adicionarFotos(rascunho(7), [{ id: "u1", file: arquivo("c.jpg") }]);
    expect(r.valores.fotos_modelo).toEqual([
      "t/fotos_modelo/a.jpg",
      "t/fotos_modelo/b.jpg",
      `${PREFIXO_FOTO_NOVA}u1`,
    ]);
    const r2 = removerFoto(removerFoto(r, `${PREFIXO_FOTO_NOVA}u1`), "t/fotos_modelo/a.jpg");
    expect(r2.fotosNovas).toEqual([]);
    expect(r2.valores.fotos_modelo).toEqual(["t/fotos_modelo/b.jpg"]);
  });
  it("payload: só as colunas alteradas; textos aparados; vazio = null (exceto nome/REF, que o servidor recusa)", () => {
    let r = rascunho(7);
    r = editar(r, "ncm", "  ");
    r = editar(r, "nome", "  Blusa Brisa Nova ");
    r = editar(r, "comprimento_cm", null);
    expect(payloadItem(r)).toEqual({
      modelo_id: "m1",
      rev: 7,
      campos: { nome: "Blusa Brisa Nova", ncm: null, comprimento_cm: null },
    });
    expect(payloadItem(rascunho(7))).toBeNull();
    const f = adicionarFotos(rascunho(7), [{ id: "u1", file: arquivo("c.jpg") }]);
    expect(
      payloadItem(f, ["t/fotos_modelo/a.jpg", "t/fotos_modelo/b.jpg", "t/fotos_modelo/c.jpg"])
        ?.campos,
    ).toEqual({
      fotos_modelo: ["t/fotos_modelo/a.jpg", "t/fotos_modelo/b.jpg", "t/fotos_modelo/c.jpg"],
    });
  });
  it("merge 3-vias: campo NÃO tocado segue o servidor; tocado e mudado lá = conflito", () => {
    let r = editar(rascunho(7), "peso_kg", 0.3);
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
  it("merge 3-vias: nomeLoja sobrevive ao merge quando omitido, e troca quando informado", () => {
    const r = rascunho(7);
    expect(mesclar(r, produto(8)).nomeLoja).toBe(NOME_LOJA);
    expect(mesclar(r, produto(8), "Outra Loja").nomeLoja).toBe("Outra Loja");
  });
  it("Minor #5: conflito antigo que convergiu por fora (fresh já bate com o meu valor) é dropado no próximo merge", () => {
    let r = editar(rascunho(7), "peso_kg", 0.3);
    r = mesclar(r, produto(8, { peso_kg: 0.28 })); // conflito: meu 0.3 x dele 0.28
    expect(r.conflitos).toEqual([{ path: "peso_kg", meu: 0.3, dele: 0.28 }]);
    // outra aba salvou de novo, e desta vez o servidor convergiu pro MEU valor (0.3) — o conflito não faz mais
    // sentido: ele não deve ficar preso pra sempre só porque mergeDraft não o re-emite (sem NOVA divergência).
    const r2 = mesclar(r, produto(9, { peso_kg: 0.3 }));
    expect(r2.conflitos).toEqual([]);
  });
  it("SKU à mão: a sublinha vira LinhaSku; SKUs a gravar contam como alteração", () => {
    const p = produto(7);
    const l = linhaSkuDaSublinha(p.sublinhas[0]);
    expect(l).toMatchObject({
      variante_key: "v1",
      tamanho_key: "38|P",
      id: "s1",
      rev: 2,
      sku: "BLBR0087-BCO-P",
      estado: "ok",
    });
    const r = comSkus(novoRascunho(p, NOME_LOJA), {
      regerar: false,
      manuais: {
        "v1|38|P": { varianteKey: "v1", tamanhoKey: "38|P", sku: "X-1", id: "s1", rev: 2 },
      },
    });
    expect(temAlteracao(r)).toBe(true);
    expect(payloadItem(r)).toBeNull(); // SKU não vai no integracao_salvar (vai no passo 3)
  });
  it("depois do Salvar: some o rascunho; sobra só SKU que não gravou", () => {
    const r = editar(rascunho(7), "peso_kg", 0.3);
    expect(aposSalvar(r, { rev: 8, skusGravados: false })).toBeNull();
    const s = comSkus(r, {
      regerar: false,
      manuais: {
        "v1|38|P": { varianteKey: "v1", tamanhoKey: "38|P", sku: "X-1", id: "s1", rev: 2 },
      },
    });
    const sobra = aposSalvar(s, { rev: 8, fotos: ["t/fotos_modelo/a.jpg"], skusGravados: false })!;
    expect(sobra.rev).toBe(8);
    expect(colunasAlteradas(sobra)).toEqual([]);
    expect(sobra.valores.fotos_modelo).toEqual(["t/fotos_modelo/a.jpg"]);
    expect(temAlteracao(sobra)).toBe(true);
    expect(aposSalvar(s, { rev: 8, skusGravados: true })).toBeNull();
  });
  it("Minor #3: fotos novas pendentes nunca somem em silêncio — payloadItem/aposSalvar lançam sem o resultado do upload", () => {
    const f = adicionarFotos(rascunho(7), [{ id: "u1", file: arquivo("c.jpg") }]);
    expect(() => payloadItem(f)).toThrow(/fotosFinais/);
    expect(() => aposSalvar(f, { rev: 8, skusGravados: false })).toThrow(/o\.fotos/);
    // com o argumento certo, funciona normalmente (não lança)
    expect(payloadItem(f, ["x"])).not.toBeNull();
  });
  it("ruling G1 (revisto no fix round 1): limpar preco_anterior grava NULL (automático)", () => {
    const r2 = editar(rascunho(7), "preco_anterior", null);
    expect(r2.valores.preco_anterior).toBeNull();
    expect(payloadItem(r2)?.campos.preco_anterior).toBeNull();
  });
});

describe("Important #1 (fix round 1): título automático segue a mesma regra do Sheet", () => {
  // "Blusa Brisa" → nomeEmTitulo "Blusa Brisa"; + " | " + "Loja Teste" = calculado
  const CALCULADO = "Blusa Brisa | Loja Teste";
  it("blur com o texto idêntico ao automático mantém titulo_pagina NULL", () => {
    let r = editarTitulo(rascunho(7), CALCULADO); // digitou exatamente o automático
    expect(r.valores.titulo_pagina).toBeNull();
    r = sairTitulo(r); // blur não muda nada (já é null)
    expect(r.valores.titulo_pagina).toBeNull();
    expect(colunasAlteradas(r)).toEqual([]); // nunca "alterado" — nasceu com titulo_pagina null também
  });
  it("redigitar o mesmo texto do automático (com espaço extra) volta a NULL no blur", () => {
    let r = editarTitulo(rascunho(7), "Um Título Manual Qualquer");
    expect(r.valores.titulo_pagina).toBe("Um Título Manual Qualquer");
    r = editarTitulo(r, `${CALCULADO}  `); // redigitou o automático + espaço — onChange não bate (string diferente)
    expect(r.valores.titulo_pagina).toBe(`${CALCULADO}  `);
    r = sairTitulo(r); // onBlur apara e reconhece que aparado == calculado → NULL
    expect(r.valores.titulo_pagina).toBeNull();
  });
  it("um título manual de verdade permanece manual (não vira NULL)", () => {
    let r = editarTitulo(rascunho(7), "Vestido Longo Edição Especial");
    expect(r.valores.titulo_pagina).toBe("Vestido Longo Edição Especial");
    r = sairTitulo(r);
    expect(r.valores.titulo_pagina).toBe("Vestido Longo Edição Especial");
    expect(colunasAlteradas(r)).toEqual(["titulo_pagina"]);
    expect(payloadItem(r)?.campos.titulo_pagina).toBe("Vestido Longo Edição Especial");
  });
  it("renomear o produto (Nome) enquanto o título é automático mantém titulo_pagina NULL", () => {
    // nasce com titulo_pagina null (automático) — igual ao raw da fixture (titulo_pagina: null)
    let r = rascunho(7);
    expect(r.valores.titulo_pagina).toBeNull();
    r = editar(r, "nome", "Macacão Tramonto");
    expect(r.valores.titulo_pagina).toBeNull(); // continua automático — o cálculo ao vivo usa o Nome novo
    expect(colunasAlteradas(r)).toEqual(["nome"]); // só o nome está "alterado", não o título
  });
});

describe("Important #2 (fix round 1): preço zero/negativo nunca vai no payload como 0", () => {
  it("preco_anterior 0/negativo vira NULL no payload (precoAnteriorOuNull)", () => {
    const r0 = editar(rascunho(7), "preco_anterior", 0);
    expect(payloadItem(r0)?.campos.preco_anterior).toBeNull();
    const rNeg = editar(rascunho(7), "preco_anterior", -10);
    expect(payloadItem(rNeg)?.campos.preco_anterior).toBeNull();
    const rOk = editar(rascunho(7), "preco_anterior", 199.9);
    expect(payloadItem(rOk)?.campos.preco_anterior).toBe(199.9);
  });
  it("preco_venda 0/negativo NUNCA é mandado como 0 — vira NULL (o servidor recusaria 0 com P0001 e abortaria o lote)", () => {
    const r0 = editar(rascunho(7), "preco_venda", 0);
    expect(payloadItem(r0)?.campos.preco_venda).toBeNull();
    const rNeg = editar(rascunho(7), "preco_venda", -5);
    expect(payloadItem(rNeg)?.campos.preco_venda).toBeNull();
    const rOk = editar(rascunho(7), "preco_venda", 129.9);
    expect(payloadItem(rOk)?.campos.preco_venda).toBe(129.9);
  });
});
