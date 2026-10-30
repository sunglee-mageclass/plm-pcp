// @vitest-environment happy-dom
// [urg R13 T7] Impressão (Pedido de Compra) com VÁRIOS produtos: `OcDocumentoPrint.grades` = uma matriz por produto + os valores e o total
// do pedido; `grade` (1 produto — os outros usos) segue idêntico. Mais o construtor puro `montarDocModeloOcPa` e a fonte das telas.
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("@/hooks/useTenantBranding", () => ({ useTenantBranding: () => ({ nome: "Loja X", cnpj: null, contato: null, logoUrl: null }) }));

const { OcDocumentoPrint } = await import("@/components/shared/OcDocumentoPrint");
import type { OcDocGrade, OcDocModelo } from "@/components/shared/OcDocumentoPrint";
import { montarDocModeloOcPa } from "@/components/oc-p-acabado/doc-modelo";
import { itemDeRow } from "@/components/oc-p-acabado/itens";

const ROOT = process.cwd() + "/"; // (happy-dom: import.meta.url não é file:)
const ler = (rel: string) => readFileSync(ROOT + rel, "utf8");

let root: Root | null = null;
let host: HTMLElement | null = null;
async function imprimir(modelo: OcDocModelo) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(OcDocumentoPrint, { modelo })); });
  return (document.querySelector(".print-area")?.textContent ?? "").replace(/ /g, " ");
}
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null; host?.remove(); host = null;
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

const gradeDoc = (titulo: string, sub: string): OcDocGrade => ({
  produtoTitulo: titulo, tamanhos: ["P", "M"], proporcao: { P: 1, M: 1 },
  linhas: [{ cor: "Azul", celulas: { P: 5, M: 5 }, total: 10 }], totalPorTamanho: { P: 5, M: 5 }, totalGeral: 10,
  valores: [{ descricao: titulo, qtd: "10 pç", precoUnit: "R$ 50,00", subtotal: sub }],
});
const base = (over: Partial<OcDocModelo>): OcDocModelo => ({ numero: "BELDIV-1", familiaLabel: "Produto Acabado (Revenda)", emitidoEm: "30/10/2026", fornecedor: [], dados: [], ...over });

describe("OcDocumentoPrint — grades?: OcDocGrade[]", () => {
  it("2 produtos: uma matriz por produto, UMA tabela de Valores com uma linha por produto e o total do pedido UMA vez", async () => {
    const t = await imprimir(base({ grades: [gradeDoc("Produto: Vestido (REF A)", "R$ 500,00"), gradeDoc("Produto: Blusa (REF B)", "R$ 500,00")], totalPrevisto: "R$ 1.000,00" }));
    expect(t).toContain("Produto: Vestido (REF A)");
    expect(t).toContain("Produto: Blusa (REF B)");
    expect(t.match(/Cor \/ Variante/g)).toHaveLength(2);       // 2 matrizes
    expect(t.match(/Descrição/g)).toHaveLength(1);              // 1 tabela de valores
    expect(t.match(/Total previsto/g)).toHaveLength(1);
    expect(t).toContain("R$ 1.000,00");
  });
  it("`grade` (1 produto — OC Importado e demais usos) segue igual; `grades` vence `grade` quando as duas vêm", async () => {
    const um = await imprimir(base({ grade: gradeDoc("Produto: Unico (REF U)", "R$ 500,00"), totalPrevisto: "R$ 500,00" }));
    expect(um).toContain("Produto: Unico (REF U)");
    expect(um.match(/Cor \/ Variante/g)).toHaveLength(1);
    expect(um.match(/Total previsto/g)).toHaveLength(1);
    await act(async () => { root?.unmount(); }); root = null; host?.remove(); host = null;
    const dois = await imprimir(base({ grade: gradeDoc("Produto: Velho", "R$ 1,00"), grades: [gradeDoc("Produto: Novo", "R$ 2,00")] }));
    expect(dois).toContain("Produto: Novo");
    expect(dois).not.toContain("Produto: Velho");
  });
  it("sem grade nenhuma (tecido/aviamento/insumo) não imprime matriz nem Valores de produto", async () => {
    const t = await imprimir(base({ colunasItem: { nome: "Artigo", variante: "Cor", qtd: "Qtd" }, itens: [{ nome: "Malha", variante: "Azul", qtd: "10 m" }] }));
    expect(t).not.toContain("Cor / Variante");
    expect(t).toContain("Malha");
  });
});

describe("montarDocModeloOcPa (puro)", () => {
  const item = (id: string, nome: string, ordem: number, over: Record<string, unknown> = {}) => itemDeRow({
    id, ordem, nome_produto: nome, grupo_id: "g1", grade_proporcao: { P: 1, M: 1 },
    variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }], qtd_total: 10, valor_unitario: 50, desconto_pct: 0,
    grade_detalhe: { "1": { P: { pedida: 5, recebida: 0, defeito: 0 }, M: { pedida: 5, recebida: 0, defeito: 0 } } },
    produto: { ref: `REF-${id}` }, ...over,
  });
  const doc = montarDocModeloOcPa({
    numero: "BELDIV-00123",
    cabecalho: { data_pedido: "2026-10-02", data_prevista: "2026-10-20", prazo_pagamento: "30/60", parcelas_entrega: 2 },
    empresaNome: "Bella", representanteNome: null,
    itens: [item("A", "Vestido", 1), item("B", "Cinto", 2, { grupo_id: "acc", grade_detalhe: { "1": { UN: { pedida: 10, recebida: 0, defeito: 0 } } }, valor_unitario: 25, desconto_pct: 10 })],
    tamanhos: ["P", "M"], grupoNome: (id) => (id === "acc" ? "Acessórios" : "Feminino"),
    corNome: () => "Azul", apelidoNome: () => null, emitidoEm: "30/10/2026",
  });
  it("uma grade por produto, com título 'Produto: nome (REF …)'", () => {
    expect(doc.grades!.map((g) => g.produtoTitulo)).toEqual(["Produto: Vestido (REF REF-A)", "Produto: Cinto (REF REF-B)"]);
    expect(doc.grade).toBeUndefined();
  });
  it("acessório usa a coluna única UN; os demais, as colunas de tamanho da loja", () => {
    expect(doc.grades![0].tamanhos).toEqual(["P", "M"]);
    expect(doc.grades![1].tamanhos).toEqual(["UN"]);
    expect(doc.grades![0].totalGeral).toBe(10);
    expect(doc.grades![1].totalPorTamanho.UN).toBe(10);
  });
  it("valores por produto (cadeia do servidor) e total previsto = Σ dos produtos", () => {
    expect(doc.grades![0].valores![0]).toMatchObject({ qtd: "10 pç" });
    expect(String(doc.grades![0].valores![0].subtotal).replace(/ /g, " ")).toBe("R$ 500,00");
    expect(String(doc.grades![1].valores![0].subtotal).replace(/ /g, " ")).toBe("R$ 225,00");
    expect(String(doc.totalPrevisto).replace(/ /g, " ")).toBe("R$ 725,00");
    expect(doc.dados.find((d) => d.k === "Pagamento")!.v).toBe("30/60 · 2 parcela(s)");
  });
});

describe("fonte — a tela da OC multiproduto", () => {
  const dlg = ler("src/components/oc-p-acabado/OcPaDialog.tsx");
  const rota = ler("src/routes/_authenticated/entrada-saida.oc-p-acabado.tsx");
  it("usa as RPCs novas e NUNCA as de 1 produto (que dão versao_antiga)", () => {
    expect(dlg).toContain('"salvar_oc_p_acabado_itens"');
    expect(dlg).toContain('"receber_item_oc_p_acabado"');
    expect(dlg).not.toMatch(/rpc\("salvar_oc_p_acabado"/);
    expect(dlg).not.toMatch(/rpc\("receber_oc_p_acabado"/);
    expect(rota).toContain('"excluir_oc_p_acabado"');
  });
  it("colaboração: o mutationFn lê os REFS VIVOS (receita 2419d0f) e o retry grava o estado mesclado antes do mutate", () => {
    const i = dlg.indexOf("const mutation = useMutation({");
    const fn = dlg.slice(i, dlg.indexOf("onSuccess: async", i));
    expect(fn).toContain("draftLiveRef.current");
    expect(fn).toContain("itemsLiveRef.current");
    expect(fn).toContain("_rev_base: isEdit ? revRef.current : null");
    expect(fn).toContain("_rev_base: revRef.current");
    const onError = dlg.slice(dlg.indexOf("onError: async", i), dlg.indexOf("const disparar"));
    expect(onError).toContain("mesclarParaRetryP0409Pa");
    expect(onError.indexOf("draftLiveRef.current = r.estado.draft")).toBeGreaterThan(-1);
    expect(onError.indexOf("itemsLiveRef.current = r.estado.items")).toBeGreaterThan(-1);
    expect(onError.indexOf("statusLiveRef.current = r.estado.status")).toBeGreaterThan(-1);
    expect(onError.indexOf("mutation.mutate(acao")).toBeGreaterThan(onError.indexOf("statusLiveRef.current = r.estado.status"));
  });
  it("o onSuccess re-baseia no ENVIADO (não na closure) e remove o id removido via touchedItemIds (removidasIds)", () => {
    expect(dlg).toContain("baseRef.current = baseDe(enviado.draft, enviado.items)");
    expect(dlg).toContain("touchedItemIdsRef.current.add(id)");
    expect(dlg).toContain("idsTocados(prev, next)");
  });
  it("o status (da OC e do produto) não é do rascunho: nunca vai nos payloads", () => {
    const itens = ler("src/components/oc-p-acabado/itens.ts");
    const cab = itens.slice(itens.indexOf("export function cabecalhoParaPayload"), itens.indexOf("export function itemParaPayload"));
    expect(cab).not.toMatch(/\bstatus\b/);
    const it = itens.slice(itens.indexOf("export function itemParaPayload"), itens.indexOf("export const itensParaPayload"));
    expect(it).not.toMatch(/\bstatus\b/);
  });
  it("a lista pega os produtos dos ITENS (coluna 'Produtos') e não filtra/embeda o cabeçalho por produto", () => {
    expect(rota).toContain("itens:ocs_p_acabado_itens(id, ordem, nome_produto, status)");
    expect(rota).toContain("textoProdutosDaOc");
    const lista = rota.slice(rota.indexOf("const SELECT_LISTA"), rota.indexOf("function OcPaPage"));
    expect(lista).not.toContain("produto_acabado_id");
    expect(lista).toContain('"id, numero, empresa_id,'); // o nome do produto NÃO é mais coluna do cabeçalho (só no embed dos itens)
  });
  it("o picker filtra pelo fornecedor e pelos ITENS (sem OC) e a tela só oferece 'Adicionar' com a OC não recebida", () => {
    const pk = ler("src/components/oc-p-acabado/ProdutoAcabadoPicker.tsx");
    expect(pk).toContain("ocs_p_acabado_itens(id)");
    expect(pk).toContain('query.eq("empresa_id", empresaId)');
    expect(pk).not.toContain("ocs_p_acabado(id)");
    expect(dlg).toContain("disabled={todosRecebidos}");
  });
  it("as ações que desfazem usam o ConfirmarAcaoDialog com o texto da fonte única", () => {
    expect(dlg).toContain("textoTirarProdutoDaOc");
    expect(dlg).toContain("textoMarcarProdutoRecebido");
    expect(rota).toContain("textoExcluirOc");
    expect(rota).not.toContain("<AlertDialog"); // o AlertDialog solto saiu: a confirmação é a única do sistema
  });
});
