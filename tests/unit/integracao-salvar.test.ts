import { describe, it, expect, vi } from "vitest";
import { lerLista } from "@/lib/integracao/produtos";
import { adicionarFotos, comSkus, editar, novoRascunho } from "@/lib/integracao/rascunho";
import { salvarIntegracao, type DepsSalvar } from "@/components/integracao/salvar-integracao";
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
  it("produto sem 'Tamanho em' (tamanhoTipo null): SKU não entra na prévia/aplicação (não crasha, não assume 'letra')", async () => {
    const { d, chamadas } = falsos();
    const r = await salvarIntegracao([comSkus(novoRascunho(produtoSemTamanho("m3")), SKUS)], d);
    expect(chamadas).toEqual([]);
    expect(d.previaSkus).not.toHaveBeenCalled();
    expect(d.aplicarSkus).not.toHaveBeenCalled();
    expect(r.skusOk).toEqual([]);
    expect(r.skusFalhas).toEqual([]);
  });
});
