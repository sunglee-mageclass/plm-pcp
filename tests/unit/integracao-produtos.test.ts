import { describe, it, expect } from "vitest";
import { brl } from "@/lib/format";
import {
  TEXTO_PRECISA_CUSTO,
  acoesEmMassa,
  avisoRetrato,
  faixaPagina,
  filtrosParaRpc,
  fmtDataHora,
  formatarValor,
  lerLista,
  motivoIntegrar,
  motivoVoltar,
  rotuloEstado,
  textoFaltas,
  valorCelula,
  type ProdutoLista,
} from "@/lib/integracao/produtos";

const gate = (ok: boolean, motivo: string | null = null) => ({ ok, motivo });
// Ruling do controlador (gate finding d2-M3): `gates` do servidor agora tem a chave BOOLEANA `modulo_bloqueado` ao
// lado dos gates-objeto — precisa entrar em toda fixture pra bater com o shape real de _integracao_gates.
const G = {
  modulo_bloqueado: false,
  compartilhado: gate(true),
  planejamento: gate(true),
  preco: gate(false, "Precisa da permissão de preço de venda."),
  ref: gate(false, 'A REF aparece a partir da etapa "Aprovado" do kanban.'),
  sku: gate(true),
  keywords: gate(true),
};
const linha = (valores: Record<string, string | null>, fotos: string[] = []) => ({
  tipo: "produto",
  ordem: 0,
  valores,
  fotos,
});
const cru = (o: Record<string, unknown> = {}) => ({
  modelo_id: "m1",
  origem: "interno",
  colecao: "Verão 27",
  etapa: "aprovado",
  estado: "nao_integravel",
  marcado_em: null,
  integrado_em: null,
  rev: 7,
  // Ruling do controlador (gate finding G1): titulo_pagina/preco_anterior NULL = AUTOMÁTICO no servidor (não é mais
  // uma falta crua). A falta de exemplo do brief (:49, titulo_pagina:null → falta "titulo") ficou trocada por NCM,
  // que continua sendo uma falta de verdade quando ausente.
  raw: {
    nome: "Blusa Brisa",
    ref: "BLBR0087",
    preco_anterior: 179.9,
    preco_venda: 159.9,
    peso_kg: 0.22,
    ncm: null,
    titulo_pagina: null,
    descricao_produto: null,
    comprimento_cm: 68,
    largura_cm: 42,
    altura_cm: 2,
    fotos_modelo: ["t/fotos_modelo/a.jpg"],
    tamanho_tipo: "letra",
  },
  vivo: {
    v: 1,
    campos: ["nome", "preco_custo", "peso", "foto"],
    linhas: [
      linha({ nome: "Blusa Brisa", preco_custo: "62.10", peso: "0.220" }, ["t/fotos_modelo/a.jpg"]),
      {
        tipo: "variante",
        ordem: 1,
        variante_key: "v1",
        tamanho_key: "38|P",
        valores: { nome: "Blusa Brisa P", preco_custo: "62.10" },
        fotos: [],
      },
    ],
  },
  faltas: [
    { campo: "ncm", texto: "NCM" },
    { campo: "ref_sku", texto: "1 variante sem SKU (Branco, tam. M)" },
  ],
  completo: false,
  sublinhas: [
    {
      variante_key: "v1",
      tamanho_key: "38|P",
      variante_ordem: 1,
      tamanho_ordem: 1,
      cor_nome: "Branco",
      apelido_nome: "Off-white",
      tamanho: "P",
      sku_id: "s1",
      sku: "BLBR0087-BCO-P",
      sku_rev: 2,
      manual: false,
    },
  ],
  retrato: null,
  retrato_difere: [],
  gates: G,
  ...o,
});
const lista = (produtos: unknown[]) =>
  lerLista({
    pagina: 1,
    por_pagina: 50,
    total: produtos.length,
    contagens: { nao_integrados: 5, integrados: 1, todos: 6 },
    campos: ["foto", "nome", "preco_custo", "peso", "xyz"],
    rotulos: {},
    opcoes: { colecoes: ["Verão 27"], etapas: [{ key: "aprovado", label: "Aprovado" }] },
    pode: { editar: true, ver_custos: true, super: false, keywords: true },
    keywords: "moda feminina, roupas",
    produtos,
  });

describe("lerLista — tolerante, gates fail-closed", () => {
  it("lê a página, ordena os campos na ordem fixa e descarta desconhecidos", () => {
    const l = lista([cru()]);
    expect(l.campos).toEqual(["nome", "peso", "preco_custo", "foto"]);
    expect(l.contagens).toEqual({ nao_integrados: 5, integrados: 1, todos: 6 });
    const p = l.produtos[0];
    expect(p.raw.preco_venda).toBe(159.9);
    expect(p.sublinhas[0]).toMatchObject({
      varianteKey: "v1",
      tamanhoKey: "38|P",
      sku: "BLBR0087-BCO-P",
      skuRev: 2,
      corNome: "Branco",
    });
    expect(p.gates.preco).toEqual({ ok: false, motivo: "Precisa da permissão de preço de venda." });
  });
  it("gate ausente/estranho = fechado (nunca libera edição por engano)", () => {
    const p = lista([cru({ gates: { compartilhado: "sim" } })]).produtos[0];
    expect(p.gates.compartilhado.ok).toBe(false);
    expect(p.gates.planejamento.ok).toBe(false);
  });
  it("estado desconhecido = não integrável", () => {
    expect(lista([cru({ estado: "???" })]).produtos[0].estado).toBe("nao_integravel");
  });
  it("gate finding d2-M3: lê modulo_bloqueado como booleano estrito (true só quando === true)", () => {
    expect(lista([cru()]).produtos[0].moduloBloqueado).toBe(false);
    expect(
      lista([cru({ gates: { ...G, modulo_bloqueado: true } })]).produtos[0].moduloBloqueado,
    ).toBe(true);
    // qualquer coisa que não seja true literal = false (fail-closed do lado "está bloqueado" também é seguro:
    // nunca afirma bloqueio por engano, e nunca destrava por engano — string/number/null tudo vira false).
    expect(
      lista([cru({ gates: { ...G, modulo_bloqueado: "true" as unknown as boolean } })]).produtos[0]
        .moduloBloqueado,
    ).toBe(false);
    expect(
      lista([cru({ gates: { ...G, modulo_bloqueado: undefined } })]).produtos[0].moduloBloqueado,
    ).toBe(false);
    // a chave não é um GateKey — não pode aparecer em `gates` nem quebrar o loop sobre as chaves de gate
    expect(Object.keys(lista([cru()]).produtos[0].gates)).not.toContain("modulo_bloqueado");
  });
});

describe("formatação e retrato (N10)", () => {
  it("formata o texto canônico do retrato em BR", () => {
    expect(formatarValor("preco_venda", "179.90")).toBe(brl(179.9));
    expect(formatarValor("peso", "0.310")).toBe("0,310 kg");
    expect(formatarValor("comprimento", "68")).toBe("68 cm");
    expect(formatarValor("ncm", null)).toBe("—");
  });
  it("não integrável mostra o VIVO; foto = contagem", () => {
    const p = lista([cru()]).produtos[0];
    expect(valorCelula(p, "preco_custo", null)).toBe(brl(62.1));
    expect(valorCelula(p, "foto", null)).toBe("1 foto");
    expect(valorCelula(p, "nome", 0)).toBe("Blusa Brisa P");
    expect(valorCelula(p, "foto", 0)).toBe("—");
  });
  it("integrável mostra o RETRATO e avisa quando o vivo difere", () => {
    const p = lista([
      cru({
        estado: "integravel",
        retrato: { v: 1, campos: ["preco_custo"], linhas: [linha({ preco_custo: "97.00" })] },
        vivo: { v: 1, campos: ["preco_custo"], linhas: [linha({ preco_custo: "101.20" })] },
        retrato_difere: ["preco_custo"],
      }),
    ]).produtos[0];
    expect(valorCelula(p, "preco_custo", null)).toBe(brl(97));
    expect(avisoRetrato(p, "preco_custo")).toBe(
      `O custo mudou depois do retrato (hoje ${brl(101.2)}) — a API recebe o valor do retrato (${brl(97)}).`,
    );
    expect(avisoRetrato(p, "nome")).toBeNull();
  });
  it("estado com data no fuso da loja", () => {
    expect(fmtDataHora("2026-09-26T17:35:00Z", "America/Sao_Paulo")).toBe("26/09 14:35");
    expect(fmtDataHora("2026-09-26T17:35:00Z", "America/Sao_Paulo", true)).toBe("26/09/2026 14:35");
    expect(
      rotuloEstado(
        { estado: "integrado", integradoEm: "2026-09-26T17:35:00Z" },
        "America/Sao_Paulo",
      ),
    ).toBe("Integrado em 26/09 14:35");
    expect(rotuloEstado({ estado: "integravel", integradoEm: null }, "America/Sao_Paulo")).toBe(
      "Integrável",
    );
  });
  it("faltas e faixa da página", () => {
    expect(textoFaltas(lista([cru()]).produtos[0].faltas)).toBe(
      "Faltam: NCM · 1 variante sem SKU (Branco, tam. M)",
    );
    expect(faixaPagina(lista([cru(), cru({ modelo_id: "m2" })]))).toBe(
      "Mostrando 1–2 de 2 produtos",
    );
  });
  it("filtros vazios não vão para a RPC", () => {
    expect(
      filtrosParaRpc({
        colecao: null,
        etapa: "aprovado",
        origem: null,
        estado: null,
        busca: "  duna ",
      }),
    ).toEqual({ etapa: "aprovado", busca: "duna" });
  });
  it("Minor #4 (comportamental): titulo_pagina/preco_anterior NULL mostram o valor AUTOMÁTICO na célula, não '—'", () => {
    // O comportamento de verdade a provar não é "a fixture não tem falta 'titulo'" (isso é reler a própria
    // fixture — tautológico). É: com raw.titulo_pagina NULL e o servidor mandando o automático calculado no
    // vivo, valorCelula EXIBE esse automático (nunca "—", que seria a leitura ingênua de "campo vazio").
    const semAutomaticoAinda = lista([cru()]).produtos[0]; // fixture cru(): vivo não tem "titulo" nos campos
    expect(valorCelula(semAutomaticoAinda, "titulo", null)).toBe("—"); // sem o campo no vivo, não há o que mostrar
    const comAutomatico = lista([
      cru({
        vivo: {
          v: 1,
          campos: ["nome", "preco_custo", "peso", "foto", "titulo"],
          linhas: [
            linha(
              {
                nome: "Blusa Brisa",
                preco_custo: "62.10",
                peso: "0.220",
                titulo: "Blusa Brisa | Loja Teste",
              },
              ["t/fotos_modelo/a.jpg"],
            ),
          ],
        },
      }),
    ]).produtos[0];
    // prova a diferença: o MESMO produto (raw.titulo_pagina continua null), só que agora o servidor mandou o
    // automático no vivo — e a célula muda de "—" para o texto automático. Isso é o comportamento do ruling G1,
    // não uma releitura de campo estático.
    expect(valorCelula(comAutomatico, "titulo", null)).toBe("Blusa Brisa | Loja Teste");
    // e continua SEM falta "titulo" mesmo com raw NULL (o servidor não marcaria — aqui só confirmamos que o lado
    // TS não inventa uma falta que o servidor não mandou).
    expect(comAutomatico.faltas.some((f) => f.campo === "titulo")).toBe(false);
  });
  it("Minor #1: tamanho_tipo NULL nunca vira 'letra' em silêncio", () => {
    const p = lista([cru({ raw: { ...cru().raw, tamanho_tipo: null } })]).produtos[0];
    expect(p.raw.tamanho_tipo).toBeNull();
  });
  it("Minor #6: texto malformado no retrato nunca vira 'R$ NaN'/'NaN kg'/'NaN cm' — cai em '—'", () => {
    expect(formatarValor("preco_venda", "abc")).toBe("—");
    expect(formatarValor("peso", "não é número")).toBe("—");
    expect(formatarValor("comprimento", "")).toBe("—");
    expect(formatarValor("preco_custo", "NaN")).toBe("—");
  });
});

describe("faltas em keys que não são coluna (ruling: sem cela pra destacar)", () => {
  it("tamanho_tipo e variantes aparecem em textoFaltas mesmo sem CampoDef/coluna", () => {
    const p = lista([
      cru({
        faltas: [
          { campo: "tamanho_tipo", texto: "Tamanho em" },
          { campo: "variantes", texto: "variantes cor × tamanho" },
        ],
      }),
    ]).produtos[0];
    expect(p.faltas.map((f) => f.campo)).toEqual(["tamanho_tipo", "variantes"]);
    expect(textoFaltas(p.faltas)).toBe("Faltam: Tamanho em · variantes cor × tamanho");
    // nenhuma dessas keys é uma CampoKey válida — valorCelula não deve ser chamada para elas, e o valor de
    // formatarValor/CAMPO_BY_KEY para uma key desconhecida não deve estourar (fail-closed, não é o alvo da falta).
  });
});

describe("estado vem de `estado`, nunca de marcado_em/marcado_por (ruling)", () => {
  it("rotuloEstado ignora marcado_em quando o estado não é integravel/integrado", () => {
    const p = lista([
      cru({
        estado: "nao_integravel",
        marcado_em: "2020-01-01T00:00:00Z", // rastro velho de um voltar/desfazer — não deve aparecer
      }),
    ]).produtos[0];
    expect(p.estado).toBe("nao_integravel");
    expect(p.marcadoEm).toBe("2020-01-01T00:00:00Z"); // o dado cru é lido (não escondido), só não vira exibição
    // Owner (set/2026): "não integrável" agora tem 2 textos (faltam dados vs completo, via `p.completo`) — a
    // fixture `cru()` tem faltas (NCM + SKU), então `completo=false` e o rótulo é o vermelho. Nunca "em 01/01/2020".
    expect(p.completo).toBe(false);
    expect(rotuloEstado(p, "America/Sao_Paulo")).toBe("Faltam dados");
    // motivoIntegrar/motivoVoltar também não devem citar essa data velha em lugar nenhum do texto.
    const ctx = {
      podeEditar: true,
      precisaVerCustos: false,
      podeVerCustos: true,
      temRascunho: false,
    };
    const motivo = motivoIntegrar(p, ctx);
    expect(motivo).not.toContain("2020");
  });
  it("integravel/integrado SEGUEM podendo mostrar marcado_em/integrado_em", () => {
    const p = lista([cru({ estado: "integrado", integrado_em: "2026-09-26T17:35:00Z" })])
      .produtos[0];
    expect(rotuloEstado(p, "America/Sao_Paulo")).toBe("Integrado em 26/09 14:35");
  });
});

describe("ruling P-99 A (controlador, Task 12a): integracao_listar agora manda 'reprovado' por produto", () => {
  it("reprovado: true SÓ quando o servidor manda === true (fail-closed nos dois sentidos)", () => {
    const p1 = lista([cru({ estado: "integravel", completo: true, faltas: [], reprovado: true })])
      .produtos[0];
    expect(p1.reprovado).toBe(true);
    // O servidor já filtra: 'nao_integravel' reprovado some da lista; 'integravel'/'integrado' reprovado CONTINUA
    // visível — o badge (Task 12a) mostra ao lado do estado, mas o produto segue integrável/integrado normalmente.
    expect(p1.estado).toBe("integravel");
    expect(motivoVoltar(p1, true)).toBeNull();
  });
  it("ausente/string/number nunca acende o badge por engano", () => {
    expect(lista([cru({})]).produtos[0].reprovado).toBe(false);
    expect(lista([cru({ reprovado: "true" })]).produtos[0].reprovado).toBe(false);
    expect(lista([cru({ reprovado: 1 })]).produtos[0].reprovado).toBe(false);
    expect(lista([cru({ reprovado: false })]).produtos[0].reprovado).toBe(false);
  });
});

describe("motivos de integrar/voltar (P-75 A, mockup 2 e 4)", () => {
  const ctx = { podeEditar: true, precisaVerCustos: true, podeVerCustos: true, temRascunho: false };
  const completo = (o: Record<string, unknown> = {}) =>
    lista([cru({ completo: true, faltas: [], ...o })]).produtos[0];
  it("ordem: permissão → estado → módulo bloqueado → rascunho → custos → faltas", () => {
    expect(motivoIntegrar(completo(), { ...ctx, podeEditar: false })).toBe(
      "Precisa da permissão de editar a Integração.",
    );
    expect(motivoIntegrar(completo({ estado: "integravel" }), ctx)).toBe("Já está integrável.");
    expect(motivoIntegrar(completo(), { ...ctx, temRascunho: true })).toBe(
      "Salve as alterações antes de integrar.",
    );
    expect(motivoIntegrar(completo(), { ...ctx, podeVerCustos: false })).toBe(TEXTO_PRECISA_CUSTO);
    expect(motivoIntegrar(lista([cru()]).produtos[0], ctx)).toMatch(/^Faltam: /);
    expect(motivoIntegrar(completo(), ctx)).toBeNull();
    // Minor #4 (comportamental, não tautológico): TEXTO_PRECISA_CUSTO é usado DE VERDADE pelo motivo acima quando
    // a permissão de custos falta — já provado na linha `podeVerCustos: false` acima (mesma constante, sem
    // reafirmar o literal String isoladamente).
  });
  it("Important #3: moduloBloqueado trava integrar ANTES do rascunho/custos/faltas — reusa o texto do servidor", () => {
    const p = completo({
      gates: {
        compartilhado: {
          ok: false,
          motivo:
            "O módulo da origem deste produto (Produto Acabado/Importado) está desligado nesta loja.",
        },
        planejamento: { ok: false, motivo: null },
        preco: { ok: false, motivo: null },
        ref: { ok: false, motivo: null },
        sku: { ok: false, motivo: null },
        keywords: { ok: false, motivo: null },
        modulo_bloqueado: true,
      },
    });
    expect(p.moduloBloqueado).toBe(true);
    // trava mesmo com tudo mais OK (completo, sem rascunho, pode ver custos) — o motivo é o do servidor
    expect(motivoIntegrar(p, ctx)).toBe(
      "O módulo da origem deste produto (Produto Acabado/Importado) está desligado nesta loja.",
    );
  });
  it("Important #3: sem motivo do servidor, cai no texto local (nunca undefined/quebra)", () => {
    const p = completo({
      gates: {
        compartilhado: { ok: false, motivo: null },
        planejamento: { ok: false, motivo: null },
        preco: { ok: false, motivo: null },
        ref: { ok: false, motivo: null },
        sku: { ok: false, motivo: null },
        keywords: { ok: false, motivo: null },
        modulo_bloqueado: true,
      },
    });
    expect(motivoIntegrar(p, ctx)).toBe("O módulo desta origem está desligado na loja.");
  });
  it("voltar só de integrável", () => {
    expect(motivoVoltar(completo({ estado: "integravel" }), true)).toBeNull();
    expect(motivoVoltar(completo({ estado: "integrado" }), true)).toBe(
      "Voltar só se aplica a produtos integráveis.",
    );
  });
  it("em massa: rascunho pendente trava integrar com o nome (texto do mockup)", () => {
    const a: ProdutoLista = completo({
      modelo_id: "a",
      raw: { ...cru().raw, nome: "Macacão Tramonto" },
    });
    const b: ProdutoLista = completo({ modelo_id: "b" });
    const m = acoesEmMassa([a, b], { ...ctx, rascunhos: new Set(["a"]) });
    expect(m.motivoIntegrar).toBe(
      "Salve as alterações antes de integrar — Macacão Tramonto tem edição pendente.",
    );
    expect(m.integrar).toEqual([]);
    expect(m.motivoVoltar).toBe(
      'Nenhum selecionado está "Integrável" — Voltar só se aplica a produtos integráveis.',
    );
    const ok = acoesEmMassa([b, completo({ modelo_id: "c", estado: "integravel" })], {
      ...ctx,
      rascunhos: new Set(),
    });
    expect(ok).toMatchObject({
      integrar: ["b"],
      voltar: ["c"],
      motivoIntegrar: null,
      motivoVoltar: null,
    });
  });
  it("Important #3: em massa, produto com módulo bloqueado NUNCA entra em integrar — não aborta o lote inteiro", () => {
    const bloqueado: ProdutoLista = completo({
      modelo_id: "blk",
      origem: "revenda",
      gates: {
        compartilhado: {
          ok: false,
          motivo:
            "O módulo da origem deste produto (Produto Acabado/Importado) está desligado nesta loja.",
        },
        planejamento: { ok: false, motivo: null },
        preco: { ok: false, motivo: null },
        ref: { ok: false, motivo: null },
        sku: { ok: false, motivo: null },
        keywords: { ok: false, motivo: null },
        modulo_bloqueado: true,
      },
    });
    const ok: ProdutoLista = completo({ modelo_id: "ok" });
    const m = acoesEmMassa([bloqueado, ok], { ...ctx, rascunhos: new Set() });
    // o produto bloqueado é EXCLUÍDO do lote — o "ok" segue integrável normalmente (o lote não aborta por causa dele)
    expect(m.integrar).toEqual(["ok"]);
    expect(m.integrar).not.toContain("blk");
    expect(m.motivoIntegrar).toBeNull(); // há pelo menos 1 integrável no lote — a ação segue disponível
  });
  const gateBloqueado = (motivo: string) => ({
    compartilhado: { ok: false, motivo },
    planejamento: { ok: false, motivo: null },
    preco: { ok: false, motivo: null },
    ref: { ok: false, motivo: null },
    sku: { ok: false, motivo: null },
    keywords: { ok: false, motivo: null },
    modulo_bloqueado: true,
  });
  it("Minor R1-4: 1 selecionado bloqueado por módulo — a mensagem em massa usa o motivo REAL dele", () => {
    const MOTIVO =
      "O módulo da origem deste produto (Produto Acabado/Importado) está desligado nesta loja.";
    const soBloqueado: ProdutoLista = completo({
      modelo_id: "blk",
      origem: "revenda",
      gates: gateBloqueado(MOTIVO),
    });
    const m = acoesEmMassa([soBloqueado], { ...ctx, rascunhos: new Set() });
    expect(m.integrar).toEqual([]);
    expect(m.motivoIntegrar).toBe(MOTIVO); // NUNCA o texto genérico — o usuário vê a causa real
  });
  it("Minor R1-4: todos os selecionados bloqueados por módulo — a mensagem genérica cita 'módulo desligado'", () => {
    const b1: ProdutoLista = completo({
      modelo_id: "b1",
      origem: "revenda",
      gates: gateBloqueado("m1"),
    });
    const b2: ProdutoLista = completo({
      modelo_id: "b2",
      origem: "importado",
      gates: gateBloqueado("m2"),
    });
    const m = acoesEmMassa([b1, b2], { ...ctx, rascunhos: new Set() });
    expect(m.integrar).toEqual([]);
    expect(m.motivoIntegrar).toContain("módulo desligado");
  });
  it("Minor R1-4: mistura de bloqueado por módulo com outro incompleto — a mensagem genérica menciona as duas causas", () => {
    const bloqueado: ProdutoLista = completo({
      modelo_id: "blk",
      origem: "revenda",
      gates: gateBloqueado("m1"),
    });
    const incompleto: ProdutoLista = lista([cru({ modelo_id: "inc" })]).produtos[0]; // completo:false
    const m = acoesEmMassa([bloqueado, incompleto], { ...ctx, rascunhos: new Set() });
    expect(m.integrar).toEqual([]);
    expect(m.motivoIntegrar).toContain("módulo desligado");
    expect(m.motivoIntegrar).toContain("incompleto");
  });
});
