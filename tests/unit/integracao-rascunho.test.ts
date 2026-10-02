import { describe, it, expect } from "vitest";
import { lerLista } from "@/lib/integracao/produtos";
import {
  PREFIXO_FOTO_NOVA,
  TEXTO_FOTOS_SEM_UPLOAD,
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
  resultadoPosSalvar,
  sairTitulo,
  temAlteracao,
  tituloAutomaticoDoRascunho,
  usarNovo,
  validarRascunho,
  valoresPosSalvar,
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
// Fix round 2 (Important R1-1): novoRascunho voltou à assinatura do brief — sem nomeLoja.
const rascunho = (rev: number, r: Record<string, unknown> = {}) => novoRascunho(produto(rev, r));

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
    const r = comSkus(novoRascunho(p), {
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

  // Fix round 3 T12b — code-review "Re-check round 2" (m-S1): a computação de "o que sobra em `rascunhos`" + "quem
  // entra na espera 'salvo, aguardando lista' (ruling B-I3)" saiu de dentro de um updater de `setRascunhos`
  // (`ProdutosAba.tsx`, onde o resultado só era correto quando o React rodava o updater de forma "eager") pra uma
  // função PURA, `resultadoPosSalvar` — testável aqui sem NENHUM React/timing envolvido. Isso é o que faz "o teste
  // não depender do updater rodar de forma síncrona" (instrução explícita do controlador): não existe updater
  // nenhum pra rodar síncrono ou não — é só uma função chamada e o resultado conferido na hora.
  describe("resultadoPosSalvar (m-S1) — sobra + espera calculadas fora de qualquer updater de setState", () => {
    it("produto salvou por inteiro (sem sobra): some de proxRascunhos, entra em novosAguardando com os valores normalizados", () => {
      const r = editar(rascunho(7), "nome", "Blusa Brisa Nova "); // espaço no fim — precisa normalizar (m-S2)
      const rascunhosAtuais = { m1: r };
      const { proxRascunhos, novosAguardando } = resultadoPosSalvar(
        rascunhosAtuais,
        [r],
        { salvos: 1, revs: { m1: 8 }, fotos: {}, skusOk: [] },
        new Map(),
      );
      expect(proxRascunhos.m1).toBeUndefined(); // sumiu — nada pendente
      expect(novosAguardando.m1).toEqual({
        rev: 8,
        valores: expect.objectContaining({ nome: "Blusa Brisa Nova" }), // aparado — m-S2
      });
    });
    it("produto com SKU pendente (sobra de verdade): fica em proxRascunhos, NÃO entra em novosAguardando", () => {
      const comSku = comSkus(rascunho(7), {
        regerar: false,
        manuais: { "v1|38|P": { varianteKey: "v1", tamanhoKey: "38|P", sku: "X-1", id: "s1", rev: 2 } },
      });
      const rascunhosAtuais = { m1: comSku };
      const { proxRascunhos, novosAguardando } = resultadoPosSalvar(
        rascunhosAtuais,
        [comSku],
        { salvos: 1, revs: { m1: 8 }, fotos: {}, skusOk: [] }, // SKU não gravou (m1 não está em skusOk)
        new Map(),
      );
      expect(proxRascunhos.m1).toBeDefined();
      expect(proxRascunhos.m1?.rev).toBe(8);
      expect(novosAguardando.m1).toBeUndefined();
    });
    it("rascunho ausente do estado vivo (virou integrável/saiu da lista durante o Salvar): nunca ressuscitado, nem em proxRascunhos nem em novosAguardando (m9/m1)", () => {
      const r = editar(rascunho(7), "nome", "Editado");
      const rascunhosAtuais: Record<string, ReturnType<typeof rascunho>> = {}; // m1 já sumiu de `rascunhos`
      const { proxRascunhos, novosAguardando } = resultadoPosSalvar(
        rascunhosAtuais,
        [r], // ainda assim foi ENVIADO nesse lote (capturado antes do sumiço)
        { salvos: 1, revs: { m1: 8 }, fotos: {}, skusOk: [] },
        new Map(),
      );
      expect(proxRascunhos.m1).toBeUndefined();
      expect(novosAguardando.m1).toBeUndefined();
    });
    it("re-mescla a sobra contra um rev mais novo já em cache (I4(c)), preserva os OUTROS rascunhos intocados em proxRascunhos", () => {
      const comSku = comSkus(rascunho(7), {
        regerar: false,
        manuais: { "v1|38|P": { varianteKey: "v1", tamanhoKey: "38|P", sku: "X-1", id: "s1", rev: 2 } },
      });
      const outroIntocado = rascunho(3, { modelo_id: "m2" } as never);
      const rascunhosAtuais = { m1: comSku, m2: outroIntocado };
      const fresco = produto(9, { nome: "Nome Do Servidor Mais Novo" });
      const cache = new Map([[fresco.modeloId, fresco]]);
      const { proxRascunhos } = resultadoPosSalvar(
        rascunhosAtuais,
        [comSku],
        { salvos: 1, revs: { m1: 8 }, fotos: {}, skusOk: [] },
        cache,
      );
      expect(proxRascunhos.m1?.rev).toBe(9); // mesclou contra o rev 9 do cache, não ficou preso em 8
      expect(proxRascunhos.m2).toBe(outroIntocado); // outro rascunho, nunca tocado pelo Salvar de m1, sobrevive intacto
    });
  });

  // m-T1, CORRIGIDO de verdade na T13 fix round 1 (revisão T13 #6, task-13-review.md m2 + task-13-code-review.md
  // m4): `valoresPosSalvar` deve tirar o valor de uma coluna NÃO enviada (fora de `colunasAlteradas(r)`) de
  // `r.base[c]` CRU — sem passar por `normalizado()`. A v1 (Task 13 round 0) normalizava as duas fontes por engano:
  // como `colunasAlteradas` já EXCLUI qualquer coluna onde os dois lados normalizam igual, um `r.base[c]` JÁ
  // normalizado nunca expunha a diferença — só um valor LEGADO não-normalizado no banco (nome com espaço, preço
  // zero, texto vazio em vez de NULL) expõe: o servidor NUNCA toca essa coluna (só faz UPDATE nas enviadas), então
  // ela continua exatamente assim no banco — normalizar aqui grava, na "espera", um valor DIFERENTE do que está lá.
  describe("m-T1 (corrigido T13 fix round 1): valoresPosSalvar usa r.base[c] CRU pra colunas NÃO enviadas — nunca normalizado", () => {
    it("probe do reviewer: base legado com ncm='' e preco_anterior=0 (nunca normalizados) — só 'nome' enviado, os dois ficam CRUS no resultado", () => {
      let r = rascunho(7, { ncm: "", preco_anterior: 0 }); // legado: texto vazio / preço zero, nunca NULL
      r = editar(r, "nome", "Blusa Brisa Nova"); // única coluna de fato ENVIADA
      expect(colunasAlteradas(r)).toEqual(["nome"]);
      const v = valoresPosSalvar(r);
      expect(v.nome).toBe("Blusa Brisa Nova"); // a coluna ENVIADA passa por normalizado() normalmente
      // As colunas NÃO enviadas mantêm o CRU do banco — nunca o normalizado (`null`/`null`), que o UPDATE real
      // jamais gravaria nelas (o servidor só toca "nome" nesta chamada).
      expect(v.ncm).toBe("");
      expect(v.ncm).not.toBeNull();
      expect(v.preco_anterior).toBe(0);
      expect(v.preco_anterior).not.toBeNull();
    });
    // n2 (fix round 2 T13, revisão T13 #14, task-13-review.md "Re-review round 1"): a versão anterior deste teste
    // era TAUTOLÓGICA — montava `holdBuggy` à mão (`{...holdCru, preco_anterior: null}`) e comparava contra
    // constantes fixas; nunca chamava `valoresPosSalvar` sobre um rascunho onde `preco_anterior` estivesse
    // TOCADO no instante do merge seguinte, então nunca exercitava o caminho de CONFLITO de `mergeDraft` (só o
    // de "não tocado, adota o fresco" — que nunca gera `conflitos`, non-tautologicamente sempre `[]`). Reescrito
    // pra reproduzir o cenário de verdade descrito pelo reviewer: (1) o usuário edita "nome" e Salva com
    // preco_anterior LEGADO (0, nunca NULL) fora do payload — a espera pós-Salvar (`resultadoPosSalvar`/
    // `EsperaAguardando`, ruling B-I3) guarda `valoresPosSalvar(r)` como o `raw` que `produtoComHold`
    // (`ProdutosAba.tsx`) sobrepõe na lista enquanto a relista não alcança; (2) o rascunho que a tela mostra
    // NESSE instante nasce desse `raw` com hold (`novoRascunho`) e o usuário edita preco_anterior DE NOVO
    // (mesmo valor, 0) ANTES da relista chegar — exatamente o que marca a coluna como TOCADA pra o próximo
    // `mesclar`; (3) chega uma relista de rev estranho (outra pessoa salvou noutro campo) que NUNCA tocou
    // preco_anterior no banco — continua 0, o valor real. Com a versão CRUA (o fix), `mesclar(...).conflitos`
    // é `[]` (o servidor não mudou o campo — nada a discutir). Com a versão BUGGY (normalizado(base) — preco
    // <=0 vira `null`, régua de `normalizado()`/Minor R1-2), o `base` do hold já nasce `null` != fresh (0) —
    // como agora o campo ESTÁ tocado, `mergeDraft` gera um `conflito` de verdade contra uma mudança que nunca
    // existiu no banco. RED contra a v1 (round 0): sabotar `valoresPosSalvar` pra usar `normalizado(c,
    // r.base[c])` na branch não-enviada reproduz `conflitos.length === 1` aqui.
    it("preco_anterior TOCADO de novo durante a espera pós-Salvar + relista alheia (nunca tocou o campo no banco): mesclar(...).conflitos é [] — a versão BUGGY geraria um conflito falso", () => {
      // Passo 1: Salva só "nome"; preco_anterior (legado, 0) fica de fora do payload.
      let r = rascunho(7, { preco_anterior: 0 });
      r = editar(r, "nome", "Blusa Brisa Nova");
      const hold = valoresPosSalvar(r); // FIX: r.base[c] cru pra coluna não enviada
      expect(hold.preco_anterior).toBe(0); // o fix preserva o valor real do banco (não normaliza pra null)

      // Passo 2: enquanto a espera dura, a tela mostra o produto com o `raw` sobreposto pelo hold
      // (`produtoComHold`, ProdutosAba.tsx) — o usuário reabre a célula e edita preco_anterior DE NOVO (mesmo
      // valor 0), o que marca a coluna como TOCADA no rascunho que nasce desse hold.
      const produtoComHold = produto(7, { ...hold, nome: "Blusa Brisa Nova" });
      let rSobreHold = novoRascunho(produtoComHold);
      rSobreHold = editar(rSobreHold, "preco_anterior", 0);
      expect(colunasAlteradas(rSobreHold)).toEqual([]); // 0 == 0 normalizado: nada "alterado" a enviar
      expect(rSobreHold.tocados.has("preco_anterior")).toBe(true); // mas a coluna FICA tocada

      // Passo 3: relista de rev estranho — outra pessoa salvou "nome" de novo alhures; preco_anterior NUNCA foi
      // tocado no banco, continua 0 (o mesmo valor real, nunca NULL).
      const fresco = produto(9, { preco_anterior: 0, nome: "Blusa Brisa Nova v2" });
      const mesclado = mesclar(rSobreHold, fresco);

      // FIX: base do hold (0) == fresh (0) → NADA mudou de verdade nesse campo → SEM conflito, mesmo tocado.
      expect(mesclado.conflitos).toEqual([]);
      expect(mesclado.valores.preco_anterior).toBe(0);
    });
    it("'fotos_modelo' não enviado ignora fotosFinais (nunca aplica um upload de outra coluna) — mantém base.fotos_modelo cru", () => {
      let r = rascunho(7);
      r = editar(r, "ncm", "6109.90.00"); // só NCM tocado — fotos_modelo nunca editado
      const v = valoresPosSalvar(r, ["t/fotos_modelo/outro.jpg"]);
      expect(v.ncm).toBe("6109.90.00");
      expect(v.fotos_modelo).toEqual(r.base.fotos_modelo); // ignora `fotosFinais` — fotos não foram enviadas
    });
    it("nenhuma coluna alterada: o resultado é idêntico a r.base (referência-a-referência) em TODAS as 12 colunas", () => {
      const r = rascunho(7);
      expect(colunasAlteradas(r)).toEqual([]);
      expect(valoresPosSalvar(r)).toEqual(r.base);
    });
  });

  it("ruling G1 (revisto no fix round 1): limpar preco_anterior grava NULL (automático)", () => {
    const r2 = editar(rascunho(7), "preco_anterior", null);
    expect(r2.valores.preco_anterior).toBeNull();
    expect(payloadItem(r2)?.campos.preco_anterior).toBeNull();
  });
  it("Minor #3/fix round 3: payloadItem LANÇA com texto PT exato quando há fotos novas pendentes sem fotosFinais", () => {
    // Regressão fechada na rodada 3: o fix round 2 removeu essa guarda por engano ao trocar o texto pra PT — a
    // guarda TEM que continuar existindo (round 0 Minor #3 + round 1 item 4: "keep this throw"), só o TEXTO
    // mudou pra PT (Minor R1-5). Roda em T11 passo 1, ANTES de qualquer escrita — o catch de lá apaga os
    // uploads já feitos, então uma foto nova nunca fica órfã nem some em silêncio do payload.
    const f = adicionarFotos(rascunho(7), [{ id: "u1", file: arquivo("c.jpg") }]);
    expect(() => payloadItem(f)).toThrow(TEXTO_FOTOS_SEM_UPLOAD);
    expect(() => payloadItem(f)).toThrow(
      "Não foi possível enviar as fotos novas. Tente salvar de novo.",
    );
    // com o argumento certo (o resultado do upload), funciona normalmente — não lança
    expect(
      payloadItem(f, ["t/fotos_modelo/a.jpg", "t/fotos_modelo/b.jpg", "novo-path.jpg"]),
    ).not.toBeNull();
  });
});

describe("Minor R1-3 (fix round 2): aposSalvar NUNCA lança — degrada quando falta o resultado do upload", () => {
  it("sem fotosNovas, comportamento igual ao de sempre mesmo sem o.fotos", () => {
    const r = editar(rascunho(7), "peso_kg", 0.3);
    expect(() => aposSalvar(r, { rev: 8, skusGravados: false })).not.toThrow();
    expect(aposSalvar(r, { rev: 8, skusGravados: false })).toBeNull(); // nada de SKU pendente = some
  });
  it("com fotosNovas pendentes e SEM o.fotos: não lança, mantém rev PRÉ-salvar (o próximo merge adota do servidor)", () => {
    const comFoto = adicionarFotos(rascunho(7), [{ id: "u1", file: arquivo("c.jpg") }]);
    const comSku = comSkus(comFoto, {
      regerar: false,
      manuais: {
        "v1|38|P": { varianteKey: "v1", tamanhoKey: "38|P", sku: "X-1", id: "s1", rev: 2 },
      },
    });
    let sobra: ReturnType<typeof aposSalvar> = null;
    expect(() => {
      sobra = aposSalvar(comSku, { rev: 8, skusGravados: false }); // o.fotos OMITIDO de propósito
    }).not.toThrow();
    expect(sobra).not.toBeNull();
    // rev fica no PRÉ-salvar (7), não no 8 novo — o próximo mesclar(r, produto(8...)) vai detectar a diferença
    // de rev e adotar fotos_modelo do servidor sozinho (tocados vazio = "não tocado segue o servidor").
    expect(sobra!.rev).toBe(7);
    expect(sobra!.tocados.size).toBe(0);
    // Test-gap nit (re-review round 2): não basta provar as PRECONDIÇÕES (rev/tocados) — prova o efeito real:
    // o PRÓXIMO mesclar (vendo a rev 8 nova do servidor, já com as fotos novas gravadas lá) adota fotos_modelo
    // do servidor por inteiro, mesmo sem qualquer ação explícita de "usar o novo" do usuário.
    const doServidor = produto(8, {
      fotos_modelo: ["t/fotos_modelo/a.jpg", "t/fotos_modelo/b.jpg", "t/fotos_modelo/c.jpg"],
    });
    const merged = mesclar(sobra!, doServidor);
    expect(merged.rev).toBe(8);
    expect(merged.valores.fotos_modelo).toEqual([
      "t/fotos_modelo/a.jpg",
      "t/fotos_modelo/b.jpg",
      "t/fotos_modelo/c.jpg",
    ]);
    expect(merged.conflitos).toEqual([]); // adoção silenciosa — não é um conflito, fotos_modelo não estava tocada
  });
  it("com fotosNovas pendentes e COM o.fotos: caminho normal, adota o novo rev", () => {
    const comFoto = adicionarFotos(rascunho(7), [{ id: "u1", file: arquivo("c.jpg") }]);
    const comSku = comSkus(comFoto, {
      regerar: false,
      manuais: {
        "v1|38|P": { varianteKey: "v1", tamanhoKey: "38|P", sku: "X-1", id: "s1", rev: 2 },
      },
    });
    const sobra = aposSalvar(comSku, {
      rev: 8,
      fotos: ["t/fotos_modelo/a.jpg", "t/fotos_modelo/b.jpg", "t/fotos_modelo/c.jpg"],
      skusGravados: false,
    })!;
    expect(sobra.rev).toBe(8);
    expect(sobra.valores.fotos_modelo).toEqual([
      "t/fotos_modelo/a.jpg",
      "t/fotos_modelo/b.jpg",
      "t/fotos_modelo/c.jpg",
    ]);
  });
});

describe("Important #1/R1-1 (fix rounds 1-2): título automático — nomeLoja é argumento de chamada", () => {
  // "Blusa Brisa" → nomeEmTitulo "Blusa Brisa"; + " | " + "Loja Teste" = calculado
  const CALCULADO = "Blusa Brisa | Loja Teste";
  it("blur com o texto idêntico ao automático mantém titulo_pagina NULL", () => {
    let r = editarTitulo(rascunho(7), CALCULADO, NOME_LOJA); // digitou exatamente o automático
    expect(r.valores.titulo_pagina).toBeNull();
    r = sairTitulo(r, NOME_LOJA); // blur não muda nada (já é null)
    expect(r.valores.titulo_pagina).toBeNull();
    expect(colunasAlteradas(r)).toEqual([]); // nunca "alterado" — nasceu com titulo_pagina null também
  });
  it("redigitar o mesmo texto do automático (com espaço extra) volta a NULL no blur", () => {
    let r = editarTitulo(rascunho(7), "Um Título Manual Qualquer", NOME_LOJA);
    expect(r.valores.titulo_pagina).toBe("Um Título Manual Qualquer");
    r = editarTitulo(r, `${CALCULADO}  `, NOME_LOJA); // redigitou o automático + espaço — onChange não bate
    expect(r.valores.titulo_pagina).toBe(`${CALCULADO}  `);
    r = sairTitulo(r, NOME_LOJA); // onBlur apara e reconhece que aparado == calculado → NULL
    expect(r.valores.titulo_pagina).toBeNull();
  });
  it("um título manual de verdade permanece manual (não vira NULL)", () => {
    let r = editarTitulo(rascunho(7), "Vestido Longo Edição Especial", NOME_LOJA);
    expect(r.valores.titulo_pagina).toBe("Vestido Longo Edição Especial");
    r = sairTitulo(r, NOME_LOJA);
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
  it("R1-1: o nome da loja chega DEPOIS do rascunho criado (useTenantBranding ainda carregando) — sem staleness", () => {
    // O rascunho nasce ANTES do nome da loja carregar (nomeLoja não é mais guardado nele — é argumento de
    // chamada). Quando o nome finalmente chega, editarTitulo/sairTitulo já comparam contra "Nome | Loja" correto,
    // sem precisar de nenhum merge/refresh do rascunho — é exatamente a diferença do fix R1-1 vs a v1 (fix round 1)
    // que guardava nomeLoja no Rascunho e ficava stale.
    const r0 = rascunho(7); // nasce sem nenhuma noção de loja
    const rDepoisDoNomeChegar = editarTitulo(r0, CALCULADO, NOME_LOJA); // agora a tela já tem o nome
    expect(rDepoisDoNomeChegar.valores.titulo_pagina).toBeNull(); // reconhece como automático corretamente
  });
  it("R1-1: nomeLoja null (ainda carregando) nunca colapsa o digitado para NULL nem trata Nome puro como automático", () => {
    const r0 = rascunho(7);
    // digitar o automático "de verdade" (com loja) enquanto nomeLoja ainda é null: não tem como comparar, então
    // mantém EXATAMENTE o que foi digitado (nunca vira manual por engano nem NULL por engano).
    const r1 = editarTitulo(r0, CALCULADO, null);
    expect(r1.valores.titulo_pagina).toBe(CALCULADO); // mantido como digitado, NÃO virou NULL
    const r2 = sairTitulo(r1, null); // blur também não normaliza sem o automático calculável
    expect(r2.valores.titulo_pagina).toBe(CALCULADO);
    // digitar só o Nome (sem "| Loja") enquanto nomeLoja é null: mantém como está — NUNCA assume que é o
    // automático (que teria "| Loja" quando o nome carregar).
    const r3 = editarTitulo(rascunho(7), "Blusa Brisa", null);
    expect(r3.valores.titulo_pagina).toBe("Blusa Brisa"); // não virou NULL
  });
  it("Minor R1-1: um blur/edição que não muda nada NÃO marca titulo_pagina como tocado (nunca gera conflito por tab-through)", () => {
    const r0 = rascunho(7); // titulo_pagina já é null (automático)
    const r1 = sairTitulo(r0, NOME_LOJA); // blur sem digitar nada — resultado também é null
    expect(r1).toBe(r0); // MESMA referência — editar não foi chamado, tocados não mudou
    expect(r1.tocados.has("titulo_pagina")).toBe(false);
    // idem para editarTitulo digitando o próprio automático de novo (sem mudança real de valor)
    const rManual = editarTitulo(rascunho(7), "Manual X", NOME_LOJA);
    const rMesmoTexto = editarTitulo(rManual, "Manual X", NOME_LOJA);
    expect(rMesmoTexto).toBe(rManual); // sem mudança = mesma referência, não re-toca
  });
});

describe("Important #2/Minor R1-2 (fix rounds 1-2): preço zero/negativo nunca vai no payload nem conta como alterado", () => {
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
  it("Minor R1-2: base NULL + digitar 0 NÃO conta como 'alterado' (0 e NULL são o MESMO valor normalizado)", () => {
    // raw.preco_anterior da fixture é 179.9 (preenchido) — usamos um produto com preco_anterior NULL de base.
    const base = rascunho(7, { preco_anterior: null, preco_venda: null });
    expect(colunasAlteradas(base)).toEqual([]);
    const comZero = editar(editar(base, "preco_anterior", 0), "preco_venda", 0);
    expect(colunasAlteradas(comZero)).toEqual([]); // 0 == NULL pra fins de "alterado" (os 2 são "automático")
    expect(temAlteracao(comZero)).toBe(false);
    expect(payloadItem(comZero)).toBeNull(); // nada realmente mudou — no-op não vira update/log no servidor
  });
  it("Minor R1-2: sub-centavo não passa como 'preenchido' (arredonda a 2 casas antes do > 0)", () => {
    const base = rascunho(7, { preco_venda: null });
    const comSubCentavo = editar(base, "preco_venda", 0.001);
    expect(colunasAlteradas(comSubCentavo)).toEqual([]); // arredonda pra 0.00 = NULL, não "alterado"
  });
});

// Fix round 1 T12b — revisão A-I1(b)/B-I4(b): `aposSalvar` NUNCA baixa `rev` (Math.max, não `o.rev ?? r.rev`).
describe("Fix round 1 T12b (A-I1(b)/B-I4(b)) — aposSalvar NUNCA baixa o rev da sobra", () => {
  it("o.rev menor que o rev ATUAL do rascunho (relista em voo já avançou): a sobra mantém o rev maior", () => {
    // Simula: o rascunho já foi mesclado para rev 10 (por um refetch em voo durante o Salvar) ANTES do onSuccess
    // rodar — o servidor respondeu com revs calculado ANTES desse refetch (rev 9, mais velho).
    let r = editar(rascunho(7), "peso_kg", 0.3);
    r = mesclar(r, produto(10, { peso_kg: 0.5 })); // servidor já avançou pra 10 com OUTRO valor de peso — conflito
    const comSku = comSkus(r, {
      regerar: false,
      manuais: { "v1|38|P": { varianteKey: "v1", tamanhoKey: "38|P", sku: "X-1", id: "s1", rev: 2 } },
    });
    const sobra = aposSalvar(comSku, { rev: 9, skusGravados: false })!;
    expect(sobra).not.toBeNull();
    // Math.max(10, 9) = 10 — NUNCA 9 (que seria uma regressão de versão e prenderia o próximo Salvar em P0409).
    expect(sobra.rev).toBe(10);
  });
  it("o.rev maior que o rev atual (caminho normal): usa o.rev, como sempre", () => {
    const r = editar(rascunho(7), "peso_kg", 0.3);
    const comSku = comSkus(r, {
      regerar: false,
      manuais: { "v1|38|P": { varianteKey: "v1", tamanhoKey: "38|P", sku: "X-1", id: "s1", rev: 2 } },
    });
    const sobra = aposSalvar(comSku, { rev: 8, skusGravados: false })!;
    expect(sobra.rev).toBe(8);
  });
});

// Fix round 1 T12b — revisão A-I1(c)/B-I4(c): `mesclar` NUNCA baixa o rev do rascunho (guarda `<=`, não só `===`).
describe("Fix round 1 T12b (A-I1(c)/B-I4(c)) — mesclar NUNCA regride o rev do rascunho", () => {
  it("produto com rev MENOR que o rascunho (lista em cache mais velha que a sobra): mesclar não faz nada", () => {
    let r = editar(rascunho(7), "peso_kg", 0.3);
    r = mesclar(r, produto(10, { peso_kg: 0.5 })); // rascunho agora está em rev 10, com conflito peso_kg
    expect(r.rev).toBe(10);
    expect(r.conflitos.length).toBeGreaterThan(0);
    // uma lista em CACHE mais velha (rev 9, ex.: ainda não refletiu o commit mais recente) não pode reverter nada.
    const antesDeMesclarDeNovo = r;
    const resultado = mesclar(r, produto(9, { peso_kg: 0.28, nome: "Nome Diferente Do Cache Velho" }));
    expect(resultado).toBe(antesDeMesclarDeNovo); // MESMA referência — nada mudou
    expect(resultado.rev).toBe(10); // nunca volta pra 9
    expect(resultado.valores.peso_kg).toBe(0.3); // o valor em conflito não é substituído pelo cache velho
  });
});

// Fix round 1 T12b — revisão A-I4/B-I7 (a): pré-validação no CLIENTE espelhando as regras P0001 de
// `integracao_salvar` (nome/REF vazio, nome > 200 no comprado, faixa numérica/negativos) — nomeando o CAMPO, pra
// não deixar o usuário adivinhar qual célula bloqueia o lote atômico inteiro.
describe("Fix round 1 T12b (A-I4/B-I7 a) — validarRascunho espelha as recusas P0001 do servidor", () => {
  it("nome vazio (só quando 'nome' está entre as colunas alteradas)", () => {
    const r = editar(rascunho(7), "nome", "   ");
    expect(validarRascunho(r, "interno")).toEqual([{ coluna: "nome", texto: "O nome não pode ficar vazio." }]);
    // campo NÃO tocado com nome vazio no `raw` não entra na validação (colunasAlteradas não inclui 'nome')
    expect(validarRascunho(rascunho(7), "interno")).toEqual([]);
  });
  it("REF vazia", () => {
    const r = editar(rascunho(7), "ref", "");
    expect(validarRascunho(r, "interno")).toEqual([{ coluna: "ref", texto: "A REF não pode ficar vazia." }]);
  });
  it("nome > 200 caracteres SÓ em revenda/importado (interno não tem esse limite)", () => {
    const nomeGrande = "X".repeat(201);
    const r = editar(rascunho(7), "nome", nomeGrande);
    expect(validarRascunho(r, "revenda")).toEqual([
      { coluna: "nome", texto: "Nome muito longo para o Produto Acabado (máx. 200 caracteres)." },
    ]);
    expect(validarRascunho(r, "importado")).toEqual([
      { coluna: "nome", texto: "Nome muito longo para o Produto Importado (máx. 200 caracteres)." },
    ]);
    expect(validarRascunho(r, "interno")).toEqual([]); // interno não tem o limite de 200
  });
  // Fix round 2 T12b (minor, ambas as revisões): `.length` do JS conta unidades UTF-16, não CODE POINTS — o
  // servidor (`char_length` do Postgres) conta code points. Um emoji (fora do BMP) ocupa 2 unidades em `.length`
  // mas é 1 "caractere" de verdade — um nome com 150 emojis (150 code points, bem dentro do limite de 200) tinha
  // `.length === 300` e era recusado no CLIENTE por engano, mesmo o servidor aceitando.
  it("nome > 200: conta CODE POINTS (como o servidor), não unidades UTF-16 — emoji não conta em dobro", () => {
    const nome150Emojis = "😀".repeat(150); // 150 code points; 300 unidades UTF-16 (cada emoji usa um par surrogate)
    expect(nome150Emojis.length).toBe(300); // confirma a armadilha: `.length` cru veria 300, > 200
    const r = editar(rascunho(7), "nome", nome150Emojis);
    expect(validarRascunho(r, "revenda")).toEqual([]); // 150 code points está DENTRO do limite — nunca recusa
    const nome201Emojis = "😀".repeat(201); // 201 code points — agora sim, fora do limite
    const r2 = editar(rascunho(7), "nome", nome201Emojis);
    expect(validarRascunho(r2, "revenda")).toEqual([
      { coluna: "nome", texto: "Nome muito longo para o Produto Acabado (máx. 200 caracteres)." },
    ]);
  });
  // Fix round 2 T12b (minor m-R4): a mensagem agora NOMEIA o campo (`"Peso": …`) — antes dizia só "…este campo."
  // apesar de `erros[0].coluna` já estar disponível pro toast (`ProdutosAba.onSalvar`).
  it("valor numérico negativo", () => {
    const r = editar(rascunho(7), "peso_kg", -1);
    expect(validarRascunho(r, "interno")).toEqual([
      { coluna: "peso_kg", texto: '"Peso": valor numérico inválido (use número maior ou igual a zero).' },
    ]);
  });
  it("valor fora da escala numeric(p,s) da coluna", () => {
    const r = editar(rascunho(7), "peso_kg", 1e20); // numeric(10,3): 7 dígitos de parte inteira cabem, 1e20 não
    expect(validarRascunho(r, "interno")).toEqual([
      { coluna: "peso_kg", texto: '"Peso": valor numérico fora da faixa permitida.' },
    ]);
  });
  it("NULL nunca é inválido (é 'automático'/sem valor, não um número fora de faixa)", () => {
    const r = editar(rascunho(7, { preco_anterior: 100 }), "preco_anterior", null);
    expect(validarRascunho(r, "interno")).toEqual([]);
  });
  it("rascunho limpo (nada alterado) nunca gera erro", () => {
    expect(validarRascunho(rascunho(7), "interno")).toEqual([]);
  });
});

// Fix round 1 T12b — revisão B-Minor 12: `mesclar` normaliza (trim/nullif) igual ao servidor antes de decidir se um
// campo TOCADO virou conflito de verdade — sem isso, o PRÓPRIO save do usuário (texto com espaço a mais, que o
// servidor grava aparado) reaparecia como "Este campo mudou no servidor" contra si mesmo na relista seguinte.
describe("Fix round 1 T12b (B-Minor 12) — mesclar normaliza antes de marcar conflito (nunca falso conflito contra o PRÓPRIO save)", () => {
  it("nome com espaço a mais no rascunho X nome aparado que voltou do servidor: NÃO é conflito (mesmo valor normalizado)", () => {
    const r = editar(rascunho(7), "nome", "Blusa Brisa Nova "); // com espaço no fim
    // O servidor grava aparado — o "fresh" que a relista traz é o mesmo texto, SEM o espaço.
    const r2 = mesclar(r, produto(8, { nome: "Blusa Brisa Nova" }));
    expect(r2.conflitos).toEqual([]);
  });
  it("controle: nomes de verdade DIFERENTES (não só espaço) continuam gerando conflito normalmente", () => {
    const r = editar(rascunho(7), "nome", "Blusa Brisa Nova");
    const r2 = mesclar(r, produto(8, { nome: "Nome Completamente Diferente" }));
    expect(r2.conflitos).toEqual([{ path: "nome", meu: "Blusa Brisa Nova", dele: "Nome Completamente Diferente" }]);
  });
});

// P-155 B + R4 (G-plano da frente Preço anterior/Título por versão): na v2+ o automático é o título HERDADO da versão
// anterior — o colapso "digitou igual ao automático → NULL" compara com ELE, não com o calculado do Nome desta versão.
describe("R4 — editarTitulo/sairTitulo com o HERDADO (v2+)", () => {
  const HERDADO = "Vestido Gardenia | Loja Teste"; // o título efetivo da v1
  const PROPRIO = "Blusa Brisa | Loja Teste"; // o calculado do Nome DESTA versão (fixture: "Blusa Brisa")
  it("tituloAutomaticoDoRascunho: herdado quando há; senão o calculado (v1)", () => {
    expect(tituloAutomaticoDoRascunho(rascunho(7), NOME_LOJA, HERDADO)).toBe(HERDADO);
    expect(tituloAutomaticoDoRascunho(rascunho(7), NOME_LOJA, null)).toBe(PROPRIO);
    expect(tituloAutomaticoDoRascunho(rascunho(7), NOME_LOJA)).toBe(PROPRIO); // default = v1
  });
  it("digitar = herdado ⇒ NULL (automático)", () => {
    const r = editarTitulo(rascunho(7), HERDADO, NOME_LOJA, HERDADO);
    expect(r.valores.titulo_pagina).toBeNull();
    expect(colunasAlteradas(r)).toEqual([]);
  });
  it("digitar o calculado PRÓPRIO na v2+ fica DIGITADO (não some em silêncio virando herdado)", () => {
    let r = editarTitulo(rascunho(7), PROPRIO, NOME_LOJA, HERDADO);
    expect(r.valores.titulo_pagina).toBe(PROPRIO);
    r = sairTitulo(r, NOME_LOJA, HERDADO);
    expect(r.valores.titulo_pagina).toBe(PROPRIO);
    expect(payloadItem(r)?.campos.titulo_pagina).toBe(PROPRIO);
  });
  it("blur apara e reconhece o herdado com espaço extra ⇒ NULL", () => {
    let r = editarTitulo(rascunho(7), `${HERDADO}  `, NOME_LOJA, HERDADO);
    expect(r.valores.titulo_pagina).toBe(`${HERDADO}  `);
    r = sairTitulo(r, NOME_LOJA, HERDADO);
    expect(r.valores.titulo_pagina).toBeNull();
  });
  it("o herdado não depende do nome da loja: com nomeLoja null ainda colapsa pelo herdado", () => {
    const r = editarTitulo(rascunho(7), HERDADO, null, HERDADO);
    expect(r.valores.titulo_pagina).toBeNull();
    expect(sairTitulo(editarTitulo(rascunho(7), `${HERDADO} `, null, HERDADO), null, HERDADO).valores.titulo_pagina).toBeNull();
  });
  it("herdado '' (nenhum nível com nome): digitar vazio = automático; digitar algo = digitado", () => {
    expect(editarTitulo(rascunho(7), "", NOME_LOJA, "").valores.titulo_pagina).toBeNull();
    expect(editarTitulo(rascunho(7), "X", NOME_LOJA, "").valores.titulo_pagina).toBe("X");
  });
});
