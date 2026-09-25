import { describe, it, expect } from "vitest";
import {
  agruparPorVariante, avisoSku, deveGerarPrimeiraVez, lerMatriz, resumoGeracao, rotuloTamanho, rotuloVariante,
  seloCodigos, siglasDoGrupo, situacaoSku, skuDigitadoParaSalvar, type LinhaSku, type MatrizSkus,
} from "@/components/planejamento/planejamento-detail/codigos/sku-card";

// F3.6 — seção "4. Códigos" (F3.5b do SKU, spec 2026-09-24 §4.3): regras PURAS sobre a matriz que as RPCs da F3.5a
// (`skus_modelo`/`gerar_skus_modelo`, migration 20261003100000) devolvem. O SKU é gerado e gravado SÓ no servidor.
const linha = (p: Partial<LinhaSku> = {}): LinhaSku => ({
  variante_key: "k1", variante_ordem: 1, cor_nome: "Amarelo", apelido_nome: null, tamanho_key: "34|PPP", tamanho_ordem: 1,
  id: null, sku: null, manual: false, rev: null, sku_previsto: "REF1-AM34", faltas: [], avisos: [], conflito_com: null,
  estado: "pendente", ...p,
});
const matriz = (p: Partial<MatrizSkus> = {}): MatrizSkus => ({
  status: "ok", tamanho_tipo: "numero", tamanho_tipo_card: null, linhas: [], faltas: [], avisos: [], ...p,
});

describe("lerMatriz — jsonb das RPCs da F3.5a", () => {
  it("status ok: lê a linha inteira", () => {
    const m = lerMatriz({
      status: "ok", tamanho_tipo: "numero", tamanho_tipo_card: "letra", faltas: [], avisos: [],
      linhas: [{
        variante_key: "k1", variante_ordem: 2, cor_nome: "Verde", apelido_nome: "Musgo", tamanho_key: "36|PP", tamanho_ordem: 2,
        id: "s1", sku: "REF1VD36", manual: true, rev: 3, sku_previsto: "REF1VD36",
        faltas: [{ atributo: "tamanho", id: null, nome: "36" }], avisos: [{ atributo: "cor_apelido", id: "a1", nome: "Musgo" }],
        conflito_com: { modelo_id: "m9", nome: "Blusa", ref: "REF9" }, estado: "manual",
      }],
    });
    expect(m.status).toBe("ok");
    expect(m.tamanho_tipo).toBe("numero");
    expect(m.tamanho_tipo_card).toBe("letra");
    expect(m.linhas[0]).toEqual({
      variante_key: "k1", variante_ordem: 2, cor_nome: "Verde", apelido_nome: "Musgo", tamanho_key: "36|PP", tamanho_ordem: 2,
      id: "s1", sku: "REF1VD36", manual: true, rev: 3, sku_previsto: "REF1VD36",
      faltas: [{ atributo: "tamanho", id: null, nome: "36" }], avisos: [{ atributo: "cor_apelido", id: "a1", nome: "Musgo" }],
      conflito_com: { modelo_id: "m9", nome: "Blusa", ref: "REF9" }, estado: "manual",
    });
  });
  it("status ≠ ok: linha só com id/chaves/sku/manual/rev/estado — o resto vira null/[]", () => {
    const m = lerMatriz({
      status: "aguardando_ref", tamanho_tipo: "letra", tamanho_tipo_card: null, faltas: [], avisos: [],
      linhas: [{ id: "s1", variante_key: "k1", tamanho_key: "P", sku: "X", manual: false, rev: 1, estado: "salvo" }],
    });
    expect(m.status).toBe("aguardando_ref");
    expect(m.linhas[0]).toMatchObject({
      id: "s1", sku: "X", estado: "salvo", variante_ordem: null, cor_nome: null, faltas: [], avisos: [], conflito_com: null, sku_previsto: null,
    });
  });
  it("lixo não quebra: null, estado desconhecido, tamanho_tipo inválido (sem cair em 'letra' — R10)", () => {
    expect(lerMatriz(null)).toEqual({ status: "ok", tamanho_tipo: null, tamanho_tipo_card: null, linhas: [], faltas: [], avisos: [] });
    expect(lerMatriz({ linhas: [{ estado: "xyz" }] }).linhas[0].estado).toBe("vazio");
    expect(lerMatriz({ tamanho_tipo: "cm" }).tamanho_tipo).toBeNull();
  });
  it("F3.6 (dono 25/set): status 'sem_tamanho' — card sem 'Tamanho em'; só os gravados, tipo null", () => {
    const m = lerMatriz({
      status: "sem_tamanho", tamanho_tipo: null, tamanho_tipo_card: null, faltas: [], avisos: [],
      linhas: [{ id: "s1", variante_key: "k1", tamanho_key: "34|PPP", sku: "X", manual: false, rev: 1, estado: "salvo" }],
    });
    expect(m.status).toBe("sem_tamanho");
    expect(m.tamanho_tipo).toBeNull();
    expect(m.linhas[0]).toMatchObject({ id: "s1", estado: "salvo", sku_previsto: null });
  });
});

describe("agruparPorVariante / rótulos", () => {
  it("uma linha de grupo por variante, na ordem da RPC; órfãs num grupo próprio no fim", () => {
    const g = agruparPorVariante([
      linha({ tamanho_key: "34|PPP" }), linha({ tamanho_key: "36|PP" }),
      linha({ variante_key: "k2", variante_ordem: 2, cor_nome: "Verde", apelido_nome: "Musgo", tamanho_key: "34|PPP" }),
      linha({ variante_key: "k9", variante_ordem: null, cor_nome: null, estado: "orfa", id: "s9", sku: "OLD" }),
    ]);
    expect(g.map((x) => x.linhas.length)).toEqual([2, 1, 1]);
    expect(rotuloVariante(g[0])).toBe("Variante 1 · Amarelo · sem apelido");
    expect(rotuloVariante(g[1])).toBe("Variante 2 · Verde · apelido Musgo");
    expect(rotuloVariante(g[2])).toBe("Fora da grade atual");
  });
  it("R11 — siglas do mockup por consulta própria, casadas pelo NOME (cor por loja; apelido pela cor base); sem sigla = só o nome", () => {
    const g = agruparPorVariante([
      linha({ variante_key: "k1", variante_ordem: 1, cor_nome: "Marrom", apelido_nome: "Canela" }),
      linha({ variante_key: "k2", variante_ordem: 2, cor_nome: "Preto", apelido_nome: null }),
      linha({ variante_key: "k3", variante_ordem: 3, cor_nome: "Verde", apelido_nome: "Musgo" }),
      linha({ variante_key: "k9", estado: "orfa", cor_nome: null }),
    ]);
    const cores = [{ id: "c1", nome: "Marrom", sigla: "MAR" }, { id: "c2", nome: "Preto", sigla: "PRE" }, { id: "c3", nome: "Verde", sigla: null }];
    const apelidos = [
      { cor_base_id: "c1", nome: "Canela", sigla: "CAN" },
      { cor_base_id: "c2", nome: "Musgo", sigla: "MUS" }, // apelido de OUTRA cor base: não casa com o Verde
    ];
    expect(rotuloVariante(g[0], siglasDoGrupo(g[0], cores, apelidos))).toBe("Variante 1 · Marrom (MAR) · apelido Canela (CAN)");
    expect(rotuloVariante(g[1], siglasDoGrupo(g[1], cores, apelidos))).toBe("Variante 2 · Preto (PRE) · sem apelido");
    expect(rotuloVariante(g[2], siglasDoGrupo(g[2], cores, apelidos))).toBe("Variante 3 · Verde · apelido Musgo");
    expect(siglasDoGrupo(g[3], cores, apelidos)).toEqual({ cor: null, apelido: null });
    expect(rotuloVariante(g[3], siglasDoGrupo(g[3], cores, apelidos))).toBe("Fora da grade atual");
  });
  it("tamanho pelo lado do 'Tamanho em' (par 34|PPP); tamanho solto fica como está; SEM escolha = a chave inteira", () => {
    expect(rotuloTamanho("34|PPP", "numero")).toBe("34");
    expect(rotuloTamanho("34|PPP", "letra")).toBe("PPP");
    expect(rotuloTamanho("UN", "numero")).toBe("UN");
    expect(rotuloTamanho("34|PPP", null)).toBe("34|PPP");
  });
});

describe("situacaoSku / avisoSku", () => {
  it("cada estado da RPC vira um texto/tom", () => {
    expect(situacaoSku(linha({ estado: "ok" }))).toEqual({ tom: "neutral", texto: "automático", cadastrar: false });
    expect(situacaoSku(linha({ estado: "manual" })).texto).toBe("editado à mão");
    expect(situacaoSku(linha({ estado: "salvo" })).texto).toBe("gravado");
    expect(situacaoSku(linha({ estado: "pendente" })).texto).toBe("a gerar");
    expect(situacaoSku(linha({ estado: "divergente", sku_previsto: "REF1AM34" })).texto).toBe("Regerar muda para REF1AM34");
    expect(situacaoSku(linha({ estado: "falta", faltas: [{ atributo: "cor_base", id: "c1", nome: "Amarelo" }] })))
      .toEqual({ tom: "warning", texto: "Falta sigla: Cor base Amarelo", cadastrar: true });
    expect(situacaoSku(linha({ estado: "conflito", conflito_com: { modelo_id: "m2", nome: "Saia", ref: " " } })))
      .toEqual({ tom: "danger", texto: "já existe em Saia (REF —)", cadastrar: false });
    expect(situacaoSku(linha({ estado: "orfa", manual: false })).texto).toBe("fora da grade — sai no Regerar");
    expect(situacaoSku(linha({ estado: "orfa", manual: true })).texto).toBe("fora da grade — editado à mão, fica");
    expect(situacaoSku(linha({ estado: "vazio" })).texto).toBe("—");
  });
  it("aviso D4 (apelido sem sigla) não bloqueia — só texto", () => {
    expect(avisoSku(linha({ avisos: [{ atributo: "cor_apelido", id: "a1", nome: "Musgo" }] }))).toBe("Falta sigla na cor apelido: Musgo");
    expect(avisoSku(linha())).toBeNull();
  });
});

describe("deveGerarPrimeiraVez (1ª geração pós-Salvar — spec SKU §4.2, Ruling R12)", () => {
  it("só com REF (status ok), linhas a gerar e NENHUM SKU gravado", () => {
    expect(deveGerarPrimeiraVez(matriz({ linhas: [linha(), linha({ tamanho_key: "36|PP" })] }))).toBe(true);
    expect(deveGerarPrimeiraVez(matriz({ linhas: [linha(), linha({ id: "s1", sku: "X", estado: "ok" })] }))).toBe(false);
    expect(deveGerarPrimeiraVez(matriz({ status: "aguardando_ref" }))).toBe(false);
    expect(deveGerarPrimeiraVez(matriz({ linhas: [linha({ estado: "falta", sku_previsto: null })] }))).toBe(false);
    expect(deveGerarPrimeiraVez(matriz())).toBe(false);
  });
});

describe("skuDigitadoParaSalvar (RPC salvar_sku_manual — normalização espelhada do SQL)", () => {
  it("vazio numa linha sem SKU = nada; igual ao gravado (depois de normalizar) = nada", () => {
    expect(skuDigitadoParaSalvar(linha(), "  ")).toEqual({ acao: "nada" });
    expect(skuDigitadoParaSalvar(linha({ sku: "REF1AM34" }), "ref1am34")).toEqual({ acao: "nada" });
  });
  it("normaliza (sem espaço/acento, MAIÚSCULAS) e salva", () => {
    expect(skuDigitadoParaSalvar(linha(), "ref 1-ãm34")).toEqual({ acao: "salvar", sku: "REF1-AM34" });
  });
  it("caractere inválido, ou apagar um SKU gravado, é erro em PT (o servidor não apaga SKU)", () => {
    expect(skuDigitadoParaSalvar(linha(), "REF#1")).toEqual({ acao: "erro", erro: "SKU inválido: use só letras, números e - . _ /." });
    expect(skuDigitadoParaSalvar(linha({ sku: "X1" }), "")).toEqual({ acao: "erro", erro: "Informe o SKU." });
  });
});

describe("resumoGeracao", () => {
  it("sem conflito: contagens; com conflito: a 1ª mensagem do servidor", () => {
    expect(resumoGeracao({ criados: 2, atualizados: 1, removidos: 0, conflitos: [] }))
      .toEqual({ erro: false, texto: "SKUs gerados: 2 novo(s), 1 atualizado(s), 0 removido(s)." });
    expect(resumoGeracao({ conflitos: [{ mensagem: "SKU X já existe em Saia (REF R1). Edite este SKU à mão ou mude a sigla." }] }))
      .toEqual({ erro: true, texto: "1 SKU não gravado: SKU X já existe em Saia (REF R1). Edite este SKU à mão ou mude a sigla." });
  });
});

describe("seloCodigos (selo da seção — spec §5.3)", () => {
  it("vazia (nenhuma linha) ⇒ sem selo, nem 'aguardando REF' nem 'escolha Tamanho em' (regra de seção vazia do dono, 25/set)", () => {
    expect(seloCodigos(matriz({ status: "aguardando_ref" }))).toBeUndefined();
    expect(seloCodigos(matriz({ status: "sem_tamanho", tamanho_tipo: null }))).toBeUndefined();
    expect(seloCodigos(undefined)).toBeUndefined();
  });
  it("R23 — SKUs gravados e card SEM 'Tamanho em' ⇒ cinza 'escolha Tamanho em'", () => {
    expect(seloCodigos(matriz({ status: "sem_tamanho", tamanho_tipo: null, linhas: [linha({ estado: "salvo", id: "s", sku: "X" })] })))
      .toEqual({ tone: "muted", texto: "escolha Tamanho em" });
  });
  it("falta sigla ⇒ âmbar 'N SKU(s) sem sigla' (vence o resto)", () => {
    const m = matriz({
      linhas: [linha({ estado: "falta" }), linha({ estado: "falta", tamanho_key: "36|PP" }), linha({ estado: "conflito" })],
      faltas: [{ atributo: "tamanho", id: null, nome: "36" }],
    });
    expect(seloCodigos(m)).toEqual({ tone: "warn", texto: "2 SKUs sem sigla", title: "Falta sigla: Tamanho 36" });
  });
  it("conflito ⇒ âmbar; aguardando REF / sem formato / a gerar ⇒ cinza; só aviso ⇒ info; tudo gravado ⇒ ok", () => {
    expect(seloCodigos(matriz({ linhas: [linha({ estado: "conflito" })] }))).toEqual({ tone: "warn", texto: "1 em conflito" });
    expect(seloCodigos(matriz({ status: "aguardando_ref", linhas: [linha({ estado: "salvo", id: "s", sku: "X" })] })))
      .toEqual({ tone: "muted", texto: "aguardando REF" });
    expect(seloCodigos(matriz({ status: "sem_formato", linhas: [linha({ estado: "salvo", id: "s", sku: "X" })] })))
      .toEqual({ tone: "muted", texto: "sem formato de SKU" });
    expect(seloCodigos(matriz({ linhas: [linha()] }))).toEqual({ tone: "muted", texto: "1 a gerar" });
    expect(seloCodigos(matriz({
      linhas: [linha({ estado: "ok", id: "s", sku: "X" })], avisos: [{ atributo: "cor_apelido", id: "a", nome: "Musgo" }],
    }))).toEqual({ tone: "info", texto: "aviso: apelido sem sigla", title: "Falta sigla na cor apelido: Musgo" });
    expect(seloCodigos(matriz({
      linhas: [linha({ estado: "ok", id: "s", sku: "X" }), linha({ estado: "manual", id: "t", sku: "Y", tamanho_key: "36|PP" })],
    }))).toEqual({ tone: "ok", texto: "2 SKUs" });
  });
});
