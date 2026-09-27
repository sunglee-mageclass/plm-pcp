import { describe, it, expect, vi } from "vitest";
import { lerLista } from "@/lib/integracao/produtos";
import { adicionarFotos, comSkus, editar, novoRascunho } from "@/lib/integracao/rascunho";
import { entradaSkus, salvarIntegracao, TEXTO_RESULTADO_DESCONHECIDO, type DepsSalvar } from "@/components/integracao/salvar-integracao";
import {
  MSG_PREVIA_DESATUALIZADA, MSG_PREVIA_DESCONHECIDA,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";

const produto = (id: string) => lerLista({ campos: [], produtos: [{ modelo_id: id, estado: "nao_integravel", rev: 3,
  raw: { nome: `Produto ${id}`, ref: "REF1", fotos_modelo: ["t/fotos_modelo/a.jpg"], tamanho_tipo: "letra" }, gates: {} }] }).produtos[0];
// T11 — adaptação à Task 10 (rascunho.ts): tamanho_tipo pode vir NULL (legado sem "Tamanho em" escolhido; a Task 10
// não força mais "letra"). `raw` omite a chave — `lerLista`/`rawDe` já tratam ausência como null (Minor #1 da T10).
const produtoSemTamanho = (id: string) => lerLista({ campos: [], produtos: [{ modelo_id: id, estado: "nao_integravel", rev: 3,
  raw: { nome: `Produto ${id}`, ref: "REF1", fotos_modelo: [] }, gates: {} }] }).produtos[0];
const SKUS = { regerar: false, manuais: { "v1|38|P": { varianteKey: "v1", tamanhoKey: "38|P", sku: "REF1-X", id: "s1", rev: 2 } } };
const ASS = "0123456789abcdef0123456789abcdef";
const previaOk = { matriz: { status: "ok", tamanho_tipo: "letra", tamanho_tipo_card: "letra", linhas: [], faltas: [], avisos: [] },
  assinatura: ASS, erros: [], nConflitos: 0, entrada: "x", desconhecida: false };
function falsos(o: Partial<DepsSalvar> = {}) {
  const chamadas: string[] = [];
  const d: DepsSalvar = {
    subirFoto: vi.fn(async (f: File) => { chamadas.push(`subir:${f.name}`); return `t/fotos_modelo/${f.name}`; }),
    apagarFotos: vi.fn(async (c: string[]) => { chamadas.push(`apagar:${c.join(",")}`); }),
    salvar: vi.fn(async (itens) => {
      chamadas.push(`salvar:${itens.map((i) => i.modelo_id).join(",")}`);
      return { salvos: itens.length, revs: Object.fromEntries(itens.map((i) => [i.modelo_id, i.rev + 1])) };
    }),
    previaSkus: vi.fn(async (id: string) => { chamadas.push(`previa:${id}`); return previaOk as never; }),
    aplicarSkus: vi.fn(async (id: string, a) => {
      chamadas.push(`aplicar:${id}:${a.modo}:${a.assinatura}`);
      return { criados: 0, atualizados: 0, removidos: 0, manuais: 1, conflitos: [] };
    }),
    ...o,
  };
  return { d, chamadas };
}
const comFoto = () => adicionarFotos(editar(novoRascunho(produto("m1")), "peso_kg", 0.3), [{ id: "u1", file: new File(["x"], "c.jpg") }]);

describe("salvarIntegracao — fotos → integracao_salvar → SKUs", () => {
  it("ordem certa; 1 chamada ao servidor com todos; marcador vira caminho na MESMA posição", async () => {
    const { d, chamadas } = falsos();
    const r = await salvarIntegracao([comFoto(), comSkus(novoRascunho(produto("m2")), SKUS)], d);
    expect(chamadas).toEqual(["subir:c.jpg", "salvar:m1", "previa:m2", `aplicar:m2:manuais:${ASS}`]);
    expect(vi.mocked(d.salvar).mock.calls[0][0][0]).toEqual({ modelo_id: "m1", rev: 3,
      campos: { peso_kg: 0.3, fotos_modelo: ["t/fotos_modelo/a.jpg", "t/fotos_modelo/c.jpg"] } });
    expect(r).toMatchObject({ salvos: 1, revs: { m1: 4 }, fotos: { m1: ["t/fotos_modelo/a.jpg", "t/fotos_modelo/c.jpg"] }, skusOk: ["m2"], skusFalhas: [] });
  });
  it("falha no integracao_salvar: apaga as fotos que ESTE Salvar subiu, repassa o erro e não mexe nos SKUs", async () => {
    const { d, chamadas } = falsos({ salvar: vi.fn(async () => { throw Object.assign(new Error("x"), { code: "P0409" }); }) });
    await expect(salvarIntegracao([comFoto(), comSkus(novoRascunho(produto("m2")), SKUS)], d)).rejects.toMatchObject({ code: "P0409" });
    expect(chamadas).toEqual(["subir:c.jpg", "apagar:t/fotos_modelo/c.jpg"]);
    expect(d.previaSkus).not.toHaveBeenCalled();
  });
  it("prévia com erro: os SKUs daquele produto não gravam (o resto fica) e o texto é o da seção Códigos", async () => {
    const { d } = falsos({ previaSkus: vi.fn(async () => ({ ...previaOk,
      erros: [{ variante_key: "v1", tamanho_key: "38|P", code: "P0001", mensagem: "SKU já usado por outro produto." }] }) as never) });
    const r = await salvarIntegracao([comSkus(novoRascunho(produto("m2")), SKUS)], d);
    expect(d.aplicarSkus).not.toHaveBeenCalled();
    expect(d.salvar).not.toHaveBeenCalled();
    expect(r.skusFalhas).toEqual([{ modeloId: "m2", nome: "Produto m2",
      texto: "O card foi salvo, mas os SKUs não foram gravados: SKU já usado por outro produto." }]);
  });
  it("prévia ilegível = não aplica; aplicar com P0409 = prévia desatualizada", async () => {
    const a = falsos({ previaSkus: vi.fn(async () => ({ ...previaOk, assinatura: null, desconhecida: true }) as never) });
    expect((await salvarIntegracao([comSkus(novoRascunho(produto("m2")), SKUS)], a.d)).skusFalhas[0].texto).toBe(MSG_PREVIA_DESCONHECIDA);
    const b = falsos({ aplicarSkus: vi.fn(async () => { throw Object.assign(new Error("x"), { code: "P0409" }); }) });
    expect((await salvarIntegracao([comSkus(novoRascunho(produto("m2")), SKUS)], b.d)).skusFalhas[0].texto).toBe(MSG_PREVIA_DESATUALIZADA);
  });
  // Fix round 1 (task-11-review.md Minor 1 / code-review.md M1): "Tamanho em" indefinido NÃO some mais em silêncio —
  // vira uma `skusFalhas` explicando o motivo (nunca crasha, nunca assume "letra").
  it("produto sem 'Tamanho em' (tamanhoTipo null): SKU não entra na prévia/aplicação, mas gera skusFalhas explicando (não crasha, não assume 'letra')", async () => {
    const { d, chamadas } = falsos();
    const r = await salvarIntegracao([comSkus(novoRascunho(produtoSemTamanho("m3")), SKUS)], d);
    expect(chamadas).toEqual([]);
    expect(d.previaSkus).not.toHaveBeenCalled();
    expect(d.aplicarSkus).not.toHaveBeenCalled();
    expect(r.skusOk).toEqual([]);
    expect(r.skusFalhas).toEqual([{ modeloId: "m3", nome: "Produto m3",
      texto: "O card foi salvo, mas os SKUs não foram gravados: defina \"Tamanho em\" no card do produto antes de gravar os SKUs." }]);
  });

  // Fix round 1 — Important 1 (task-11-review.md) / I1 (task-11-code-review.md): resultado DESCONHECIDO do passo 2
  // (a RPC foi enviada, mas o erro não carrega um código de servidor — rede caiu depois do envio) NUNCA apaga as
  // fotos que este Salvar subiu, porque o `integracao_salvar` pode já ter comitado.
  it("resultado DESCONHECIDO (erro de rede sem code): mantém as fotos subidas e avisa para recarregar/conferir", async () => {
    const { d, chamadas } = falsos({ salvar: vi.fn(async () => { throw Object.assign(new Error("Failed to fetch"), { code: "" }); }) });
    await expect(salvarIntegracao([comFoto()], d)).rejects.toMatchObject({ message: TEXTO_RESULTADO_DESCONHECIDO });
    expect(chamadas).toEqual(["subir:c.jpg"]);
    expect(d.apagarFotos).not.toHaveBeenCalled();
  });
  it("resultado DESCONHECIDO: mesmo sem `code` na propriedade do erro (undefined), mantém as fotos", async () => {
    const { d, chamadas } = falsos({ salvar: vi.fn(async () => { throw new Error("Failed to fetch"); }) });
    await expect(salvarIntegracao([comFoto()], d)).rejects.toMatchObject({ message: TEXTO_RESULTADO_DESCONHECIDO });
    expect(chamadas).toEqual(["subir:c.jpg"]);
    expect(d.apagarFotos).not.toHaveBeenCalled();
  });
  // Fix round 2 — R3 (task-11-review.md "Re-review round 1"): o erro original vira `cause` (diagnóstico), sem mudar
  // o texto que `mensagemErro` mostra pro usuário (ela só lê message/code).
  it("resultado DESCONHECIDO: preserva o erro original em `cause` (diagnóstico, sem mudar o texto mostrado)", async () => {
    const original = Object.assign(new Error("Failed to fetch"), { code: "" });
    const { d } = falsos({ salvar: vi.fn(async () => { throw original; }) });
    await expect(salvarIntegracao([comFoto()], d)).rejects.toMatchObject({ message: TEXTO_RESULTADO_DESCONHECIDO, cause: original });
  });
  it("recusa DEFINITIVA (code não-vazio, ex. 42501): apaga as fotos e repassa o erro ORIGINAL (não o texto de desconhecido)", async () => {
    const { d, chamadas } = falsos({ salvar: vi.fn(async () => { throw Object.assign(new Error("sem permissao"), { code: "42501" }); }) });
    await expect(salvarIntegracao([comFoto()], d)).rejects.toMatchObject({ code: "42501", message: "sem permissao" });
    expect(chamadas).toEqual(["subir:c.jpg", "apagar:t/fotos_modelo/c.jpg"]);
  });
  it("falha ANTES do envio (upload) nunca chama a RPC: apaga o que já subiu e repassa o erro original", async () => {
    const { d, chamadas } = falsos({
      subirFoto: vi.fn(async (f: File) => {
        if (f.name === "b.jpg") throw Object.assign(new Error("upload falhou"), { code: "" });
        chamadas.push(`subir:${f.name}`);
        return `t/fotos_modelo/${f.name}`;
      }),
    });
    const r1 = editar(novoRascunho(produto("m1")), "peso_kg", 0.3);
    const r2 = adicionarFotos(r1, [
      { id: "u1", file: new File(["x"], "a2.jpg") },
      { id: "u2", file: new File(["x"], "b.jpg") },
    ]);
    await expect(salvarIntegracao([r2], d)).rejects.toMatchObject({ message: "upload falhou" });
    // o 1º upload (a2.jpg) já tinha subido antes do 2º (b.jpg) falhar: apaga só o que subiu de verdade, e a RPC
    // nunca chega a ser chamada (o erro é de ANTES do passo 2 — `rpcEnviada` continua false).
    expect(chamadas).toEqual(["subir:a2.jpg", "apagar:t/fotos_modelo/a2.jpg"]);
    expect(d.salvar).not.toHaveBeenCalled();
  });
  it("apagarFotos rejeitando: o erro ORIGINAL do passo 2 ainda é relançado (a falha de limpeza não mascara)", async () => {
    const { d, chamadas } = falsos({
      salvar: vi.fn(async () => { throw Object.assign(new Error("x"), { code: "P0409" }); }),
      apagarFotos: vi.fn(async () => { throw new Error("falha ao limpar storage"); }),
    });
    await expect(salvarIntegracao([comFoto()], d)).rejects.toMatchObject({ code: "P0409", message: "x" });
    expect(chamadas).toEqual(["subir:c.jpg"]);
  });

  // Fix round 1 — Minor 8 (task-11-code-review.md M8): falha parcial de SKU com 2 produtos — o outro segue ok.
  it("2 produtos com SKU, 1 falha na prévia: o outro entra em skusOk normalmente (o resto fica)", async () => {
    const { d } = falsos({
      previaSkus: vi.fn(async (id: string) => {
        if (id === "m2") return { ...previaOk, erros: [{ variante_key: "v1", tamanho_key: "38|P", code: "P0001", mensagem: "SKU já usado por outro produto." }] } as never;
        return previaOk as never;
      }),
    });
    const r = await salvarIntegracao([comSkus(novoRascunho(produto("m2")), SKUS), comSkus(novoRascunho(produto("m4")), SKUS)], d);
    expect(r.skusOk).toEqual(["m4"]);
    expect(r.skusFalhas).toEqual([{ modeloId: "m2", nome: "Produto m2",
      texto: "O card foi salvo, mas os SKUs não foram gravados: SKU já usado por outro produto." }]);
  });

  // Fix round 1 — M6 (task-11-code-review.md): o toast de falha de SKU usa o nome EDITADO no mesmo Salvar, não o
  // nome antigo do servidor.
  it("SKU falha num produto renomeado NESTE Salvar: a falha usa o nome NOVO (do rascunho), não o antigo", async () => {
    const { d } = falsos({ previaSkus: vi.fn(async () => ({ ...previaOk,
      erros: [{ variante_key: "v1", tamanho_key: "38|P", code: "P0001", mensagem: "SKU já usado por outro produto." }] }) as never) });
    const renomeado = editar(comSkus(novoRascunho(produto("m2")), SKUS), "nome", "Nome Novo");
    const r = await salvarIntegracao([renomeado], d);
    expect(r.skusFalhas[0].nome).toBe("Nome Novo");
  });
});

describe("entradaSkus — narrowing sem cast (Minor 2 / M1)", () => {
  it("devolve null quando tamanhoTipo é null (nunca fabrica 'letra')", () => {
    expect(entradaSkus(novoRascunho(produtoSemTamanho("m5")))).toBeNull();
  });
  it("devolve a entrada normalmente quando tamanhoTipo é conhecido", () => {
    const e = entradaSkus(comSkus(novoRascunho(produto("m2")), SKUS));
    expect(e).toMatchObject({ ref: "REF1", tamanhoTipo: "letra", modo: "manuais" });
  });
});
